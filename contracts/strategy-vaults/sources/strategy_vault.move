/// Strategy Vault — trustless bridge between an on-chain indicator and a Decibel perp vault.
///
/// A StrategyVault binds:
///   - an `indicator_launchpad::indicator` Object (computes the signal on-chain), and
///   - a Decibel vault subaccount (holds depositor funds),
/// such that the *only* code able to move the vault's positions is THIS module, running its
/// audited, immutable bytecode. Depositors get a cryptographic guarantee of strategy adherence
/// instead of trusting a curator/keeper. This replaces cash.trading's current centralized bot
/// operator (lib/bot-engine.ts) for vaults that opt into on-chain enforcement.
///
/// Setup flow:
///   1. create_strategy_vault(creator, indicator_addr, decibel_vault_addr, market, order_size)
///      → deploys a StrategyVault Object; its address R is the delegated trader.
///   2. Vault admin delegates trading to R via Decibel
///      `vault_admin_api::delegate_dex_actions_to(vault, R, expiry?)`
///      (cash.trading already builds this payload in lib/decibel-vaults.ts).
///   3. Anyone calls `tick(price, ts)`. On a signal flip the module places a perp order on the vault
///      subaccount via the composable `public fun` dex_accounts::place_perp_order_to_subaccount.
module cash_strategy::strategy_vault {
    use std::signer;
    use std::option;
    use aptos_framework::event;
    use aptos_framework::object::{Self, Object, ExtendRef};

    use cash_strategy::indicator;
    use decibel::dex_accounts::{Self, Subaccount};
    use decibel::perp_engine;
    use decibel::perp_market::PerpMarket;
    use decibel::perp_order;
    use order_book::order_book_types;

    // ─── Errors ──────────────────────────────────────────────────────
    const E_NOT_CREATOR: u64 = 1;
    const E_PAUSED:      u64 = 2;
    const E_ZERO_SIZE:   u64 = 3;
    const E_BAD_BPS:     u64 = 4;
    const E_NO_NAV:      u64 = 5;

    /// Mark price uses px decimals (1e6); the indicator buffer uses 1e8.
    const PRICE_SCALE_PX_TO_1E8: u64 = 100;
    /// BTC/USD size decimals (v2 sizes for the live strategy's market).
    const SIZE_DECIMALS_POW: u128 = 100000000; // 10^8
    const BPS_DENOM: u128 = 10000;
    /// Order sizes must be lot-size multiples (testnet BTC/USD lot = 10);
    /// round NAV-derived sizes down to the lot or the engine aborts.
    const LOT_SIZE: u128 = 10;
    /// Engine minimum order size (testnet BTC/USD = 100000 = 0.001 BTC). NAV
    /// sizing clamps UP to this so small vaults stay tradeable; production
    /// should source lot/min per market instead of these constants.
    const MIN_SIZE: u128 = 100000;

    // Signal constants (mirror indicator.move).
    const SIGNAL_NEUTRAL: u8 = 0;
    const SIGNAL_BUY:     u8 = 1;
    const SIGNAL_SELL:    u8 = 2;

    /// Bound strategy ⇄ vault state. Stored on its own Object; the Object address is the delegated
    /// trader that the Decibel vault must authorize.
    struct StrategyVault has key {
        creator: address,
        /// `indicator_launchpad::indicator` Object that computes the signal.
        indicator_addr: address,
        /// Decibel vault address whose primary subaccount we trade.
        decibel_vault_addr: address,
        /// Decibel perp market this strategy trades.
        market: Object<PerpMarket>,
        /// Base size (in lots) placed per entry/flip.
        order_size: u64,
        /// Used to mint the delegated trader signer.
        extend_ref: ExtendRef,
        /// Last signal we acted on (dedupe — only trade on flips).
        last_signal: u8,
        /// Current position direction: true=long, false=short. Meaningful only when in_position.
        is_long: bool,
        in_position: bool,
        /// Creator can pause new trades without revoking delegation.
        paused: bool,
        trades: u64,
    }

    #[event]
    struct VaultTraded has drop, store {
        strategy_vault: address,
        decibel_vault: address,
        signal: u8,
        is_buy: bool,
        reduce_only: bool,
        size: u64,
        price: u64,
        timestamp: u64,
    }

    /// Create the strategy↔vault binding. The returned Object address (== sv_addr) is what the
    /// Decibel vault admin must delegate TradePerpsAllMarkets to.
    public entry fun create_strategy_vault(
        creator: &signer,
        indicator_addr: address,
        decibel_vault_addr: address,
        market: Object<PerpMarket>,
        order_size: u64,
    ) {
        assert!(order_size > 0, E_ZERO_SIZE);
        let ctor = object::create_object(signer::address_of(creator));
        let obj_signer = object::generate_signer(&ctor);
        let extend_ref = object::generate_extend_ref(&ctor);
        move_to(&obj_signer, StrategyVault {
            creator: signer::address_of(creator),
            indicator_addr,
            decibel_vault_addr,
            market,
            order_size,
            extend_ref,
            last_signal: SIGNAL_NEUTRAL,
            is_long: false,
            in_position: false,
            paused: false,
            trades: 0,
        });
    }

    /// Optional %-of-NAV sizing, stored as a SEPARATE resource on the StrategyVault
    /// object (additive — keeps the upgrade layout-compatible). When present, each
    /// order sizes to `nav * pct_bps / 10000` instead of the fixed `order_size`.
    struct SizingConfig has key {
        pct_bps: u64,
    }

    /// PREFERRED tick: reads the mark price from Decibel's own perp engine, so the
    /// price feeding the indicator (and the order limit) cannot be spoofed by the
    /// caller. Fully permissionless — anyone may crank it.
    public entry fun tick_oracle(keeper: &signer, sv_addr: address, ts: u64)
        acquires StrategyVault, SizingConfig
    {
        let market = borrow_global<StrategyVault>(sv_addr).market;
        let mark_px = perp_engine::get_mark_price(market);
        // Mark price is in px decimals (1e6); the indicator buffer is 1e8-scaled.
        tick_internal(keeper, sv_addr, mark_px * PRICE_SCALE_PX_TO_1E8, ts);
    }

    /// Test/keeper tick with an explicit price (1e8-scaled). Kept for integration
    /// tests and markets without a live oracle; production cranks use tick_oracle.
    public entry fun tick(keeper: &signer, sv_addr: address, price: u64, ts: u64)
        acquires StrategyVault, SizingConfig
    {
        tick_internal(keeper, sv_addr, price, ts);
    }

    fun tick_internal(keeper: &signer, sv_addr: address, price: u64, ts: u64)
        acquires StrategyVault, SizingConfig
    {
        let sv = borrow_global_mut<StrategyVault>(sv_addr);
        assert!(!sv.paused, E_PAUSED);

        // 1. Advance the indicator (reuses the existing on-chain TA engine).
        indicator::push_price(keeper, sv.indicator_addr, price, ts);

        // 2. Read the resulting signal.
        let sig = indicator::get_signal(sv.indicator_addr);
        if (sig == SIGNAL_NEUTRAL || sig == sv.last_signal) {
            sv.last_signal = sig;
            return
        };

        // 3. Size the order: %-of-NAV when configured, fixed lots otherwise.
        let size = resolve_order_size(sv_addr, sv.decibel_vault_addr, sv.order_size, price);

        // 4. Translate the signal flip into orders. BUY → close any short, open long.
        //    SELL → close any long, open short.
        let want_long = sig == SIGNAL_BUY;
        let trader = object::generate_signer_for_extending(&sv.extend_ref);
        let subaccount = dex_accounts::primary_subaccount_object(sv.decibel_vault_addr);

        // If flipping from an open opposite position, first reduce-only close it.
        if (sv.in_position && sv.is_long != want_long) {
            // Closing side is opposite of the current position: a long is closed with a sell.
            place(&trader, subaccount, sv.market, /*is_buy=*/ !sv.is_long, size, price, true);
            emit(sv_addr, sv.decibel_vault_addr, size, sig, !sv.is_long, true, price, ts);
        };

        // Open in the new direction.
        place(&trader, subaccount, sv.market, /*is_buy=*/ want_long, size, price, false);
        emit(sv_addr, sv.decibel_vault_addr, size, sig, want_long, false, price, ts);

        sv.in_position = true;
        sv.is_long = want_long;
        sv.last_signal = sig;
        sv.trades = sv.trades + 1;
    }

    /// size_raw = nav * pct_bps/10000 * 10^size_decimals / mark_price, computed in
    /// u128 to avoid overflow. `price_1e8` is the 1e8-scaled tick price; Decibel px
    /// decimals are 1e6, hence the /PRICE_SCALE_PX_TO_1E8.
    fun resolve_order_size(sv_addr: address, vault_addr: address, fixed_size: u64, price_1e8: u64): u64
        acquires SizingConfig
    {
        if (!exists<SizingConfig>(sv_addr)) return fixed_size;
        let pct_bps = borrow_global<SizingConfig>(sv_addr).pct_bps;
        let nav = perp_engine::get_account_net_asset_value(
            dex_accounts::primary_subaccount(vault_addr)
        );
        assert!(nav > 0, E_NO_NAV);
        let nav_u = (nav as u128);
        let mark_px = ((price_1e8 / PRICE_SCALE_PX_TO_1E8) as u128);
        if (mark_px == 0) return fixed_size;
        let size = nav_u * (pct_bps as u128) * SIZE_DECIMALS_POW / (BPS_DENOM * mark_px);
        // Engine rejects sizes that aren't lot multiples — floor to the lot,
        // then clamp up to the market minimum so small vaults stay tradeable.
        size = size / LOT_SIZE * LOT_SIZE;
        if (size < MIN_SIZE) size = MIN_SIZE;
        (size as u64)
    }

    /// Enable %-of-NAV sizing (creator only). pct_bps in 1..=10000 (100% max).
    public entry fun set_nav_sizing(creator: &signer, sv_addr: address, pct_bps: u64)
        acquires StrategyVault, SizingConfig
    {
        assert!(pct_bps > 0 && pct_bps <= 10000, E_BAD_BPS);
        let sv = borrow_global<StrategyVault>(sv_addr);
        assert!(signer::address_of(creator) == sv.creator, E_NOT_CREATOR);
        if (exists<SizingConfig>(sv_addr)) {
            borrow_global_mut<SizingConfig>(sv_addr).pct_bps = pct_bps;
        } else {
            let obj_signer = object::generate_signer_for_extending(&sv.extend_ref);
            move_to(&obj_signer, SizingConfig { pct_bps });
        }
    }

    /// Place a single marketable order (IOC at the given price = aggressive, fill-or-skip).
    fun place(
        trader: &signer,
        subaccount: Object<Subaccount>,
        market: Object<PerpMarket>,
        is_buy: bool,
        size: u64,
        price: u64,
        reduce_only: bool,
    ) {
        let tif = order_book_types::immediate_or_cancel();
        let common = perp_order::new_order_common_args(price, size, is_buy, tif, option::none());
        let tpsl = perp_order::new_empty_order_tp_sl_args();
        dex_accounts::place_perp_order_to_subaccount(
            trader,
            subaccount,
            market,
            common,
            reduce_only,
            option::none(), // stop_price
            tpsl,
            option::none(), // builder code
        );
    }

    fun emit(
        sv_addr: address, decibel_vault: address, size: u64,
        signal: u8, is_buy: bool, reduce_only: bool, price: u64, ts: u64,
    ) {
        event::emit(VaultTraded {
            strategy_vault: sv_addr,
            decibel_vault,
            signal,
            is_buy,
            reduce_only,
            size,
            price,
            timestamp: ts,
        });
    }

    // ─── Admin ───────────────────────────────────────────────────────
    public entry fun set_paused(creator: &signer, sv_addr: address, paused: bool) acquires StrategyVault {
        let sv = borrow_global_mut<StrategyVault>(sv_addr);
        assert!(signer::address_of(creator) == sv.creator, E_NOT_CREATOR);
        sv.paused = paused;
    }

    public entry fun set_order_size(creator: &signer, sv_addr: address, order_size: u64) acquires StrategyVault {
        assert!(order_size > 0, E_ZERO_SIZE);
        let sv = borrow_global_mut<StrategyVault>(sv_addr);
        assert!(signer::address_of(creator) == sv.creator, E_NOT_CREATOR);
        sv.order_size = order_size;
    }

    // ─── Views ───────────────────────────────────────────────────────
    #[view]
    public fun get_state(sv_addr: address): (address, address, u64, bool, bool, bool, u64) acquires StrategyVault {
        let sv = borrow_global<StrategyVault>(sv_addr);
        (sv.indicator_addr, sv.decibel_vault_addr, sv.order_size, sv.in_position, sv.is_long, sv.paused, sv.trades)
    }

    // The address the Decibel vault admin must delegate TradePerpsAllMarkets to (== sv_addr).
    #[view]
    public fun delegated_trader(sv_addr: address): address { sv_addr }
}
