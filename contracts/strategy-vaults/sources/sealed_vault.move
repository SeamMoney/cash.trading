/// Sealed Vault — private, tamper-proof, on-chain-enforced strategy vaults.
///
/// The problem this solves: the V3 rail publishes the transpiled strategy as Move bytecode, so
/// the curator's alpha is public. Hashing the source doesn't help when the module executes in
/// plaintext. This module takes the other split: the strategy LOGIC runs off-chain under a
/// hash commitment, while the INPUTS, RULES, EXECUTION and TRACE all stay on-chain.
///
/// What the attestor may do: emit one trit per bar (neutral / buy / sell).
/// What the attestor may NOT do: choose the market, the size, the price, the timing, or skip a
/// bar silently — and it can never move funds. See docs/SEALED-INDICATOR.md §4.
///
/// Bar semantics: the attestation signs the digest of the price series *through the previous
/// bar*, and the resulting order executes on the current bar. This mirrors PineScript's default
/// (`calc_on_every_tick = false`: signal computed at bar close, executed on the next bar) and
/// means the attestor never has to predict the on-chain mark price — it reads exactly the series
/// the chain committed to.
///
/// Attack surface: ONE audited module for every strategy, published once. No per-strategy Move
/// is ever generated or published again.
module cash_strategy::sealed_vault {
    use std::bcs;
    use std::hash;
    use std::option;
    use std::signer;
    use std::vector;
    use aptos_framework::chain_id;
    use aptos_framework::event;
    use aptos_framework::object::{Self, Object, ExtendRef};
    use aptos_framework::timestamp;
    use aptos_std::ed25519;
    use aptos_std::table::{Self, Table};

    use aptos_framework::fungible_asset::Metadata;
    use aptos_framework::primary_fungible_store;

    use decibel::dex_accounts::{Self, Subaccount};
    // Mark price and NAV come from public_read_api, NOT perp_engine: on the current Decibel
    // package (0xe7da27…b7f) perp_engine's accessors are friend-visible and uncallable from here.
    use decibel::public_read_api;
    use decibel::perp_market::PerpMarket;
    use decibel::perp_order;
    // new_builder_code and approve_max_fee are the PUBLIC surface for builder codes;
    // builder_code_registry's own constructors are friend-visible.
    use decibel::perp_engine_api;
    use decibel::builder_code_registry::BuilderCode;
    use decibel::vault::Vault;
    use decibel::vault_read_api;
    use order_book::order_book_types;

    // ─── Errors ──────────────────────────────────────────────────────
    const E_NOT_CREATOR:        u64 = 1;
    const E_PAUSED:             u64 = 2;
    const E_BAD_BPS:            u64 = 3;
    const E_NO_NAV:             u64 = 4;
    const E_NOT_SEALED:         u64 = 6;
    const E_BAD_PUBKEY:         u64 = 7;
    const E_BAD_COMMITMENT:     u64 = 8;
    const E_INVALID_SIGNATURE:  u64 = 9;
    const E_BAD_SIGNAL:         u64 = 10;
    const E_BAR_TOO_SOON:       u64 = 11;
    const E_BAR_IN_FUTURE:      u64 = 12;
    const E_BAD_MARKET_PARAMS:  u64 = 13;
    const E_BAD_LEVERAGE:       u64 = 14;
    const E_BAD_SLIPPAGE:       u64 = 15;
    const E_NOT_ADMIN:          u64 = 16;
    const E_NO_PLATFORM_CONFIG: u64 = 17;
    const E_BAD_FEE:            u64 = 18;
    const E_SWAP_NOT_ANNOUNCED: u64 = 19;
    const E_SWAP_NOT_MATURED:   u64 = 20;
    const E_ANNOUNCE_EXPIRED:   u64 = 21;

    /// Upper bound on the slippage rule — 5%. Bounded so a curator cannot
    /// configure effectively-unlimited price tolerance.
    const MAX_SLIPPAGE_BPS: u64 = 500;

    // ─── Constants ───────────────────────────────────────────────────
    /// Domain separator — prevents an attestation being replayed against any other protocol,
    /// module version, or message type that happens to share a field layout.
    const ATTESTATION_DOMAIN: vector<u8> = b"cash.trading/sealed-vault/v1";

    /// Mark price is in px decimals (1e6); the committed trace is 1e8-scaled.
    const PRICE_SCALE_PX_TO_1E8: u64 = 100;
    const BPS_DENOM: u128 = 10000;

    /// Reject bars dated more than this far ahead of chain time.
    const MAX_CLOCK_SKEW_SECS: u64 = 60;

    /// Decibel expresses builder fees in hundredths of a basis point.
    const BUILDER_UNITS_PER_BPS: u64 = 100;
    /// Hard ceiling on the builder fee this module will ever attach, in bps. Depositors pay
    /// this on notional, so it is bounded in code and not merely in config.
    const MAX_BUILDER_FEE_BPS: u64 = 10;
    /// Hard ceiling on the one-time launch fee, in USDC micro-units (1e6). $500.
    const MAX_LAUNCH_FEE_UNITS: u64 = 500_000_000;

    /// Notice a vault's depositors get before a REPLACEMENT strategy may trade their money.
    /// 24h is meaningful here specifically because Decibel vaults launched by this module set
    /// `contribution_lockup_duration_s = 0` and allow synchronous redemptions — a depositor who
    /// dislikes the new algo can leave immediately, so the window is a real exit, not a
    /// formality.
    const SWAP_NOTICE_SECS: u64 = 86_400;
    /// How long an announcement stays usable. Without an expiry a creator could announce a
    /// replacement while their vault is still empty (no notice required, clock starts), wait
    /// for deposits to arrive, and then activate it instantly months later — the announcement
    /// would be stale but satisfied. Expiring it forces a fresh 24h notice with the depositors
    /// actually present.
    const ANNOUNCE_VALIDITY_SECS: u64 = 7 * 86_400;

    const SIGNAL_NEUTRAL: u8 = 0;
    const SIGNAL_BUY:     u8 = 1;
    const SIGNAL_SELL:    u8 = 2;

    // ─── Storage ─────────────────────────────────────────────────────

    /// The sealed strategy binding. Lives on its own Object; the Object address is the
    /// delegated trader the Decibel vault must authorize.
    struct SealedVault has key {
        creator: address,

        // ── Commitment (frozen at creation) ──
        /// sha3_256(canonical_pine || 0x00 || emitted_move || 0x00 || manifest_json).
        /// See docs/SEALED-INDICATOR.md §3.1 — same formula as docs/SHELBY-PIN.md.
        program_commitment: vector<u8>,
        /// ed25519 public key of the attestor that runs the committed program.
        attestor_pubkey: vector<u8>,
        /// Optional TEE measurement (PCR set) bound in at creation. Empty in tier 1.
        enclave_measurement: vector<u8>,

        // ── Bindings (frozen at creation) ──
        decibel_vault_addr: address,
        market: Object<PerpMarket>,
        /// 10^size_decimals for this market — passed in, not hardcoded.
        size_decimals_pow: u128,
        /// Engine lot size for this market. Orders floor to a multiple of this.
        lot_size: u128,
        /// Engine minimum order size for this market.
        min_size: u128,
        /// Engine price grid for this market (px units, 1e6). Order prices must
        /// be multiples of this.
        ticker_size: u128,

        // ── Rules (frozen at creation) ──
        /// Per-order notional as a percent of NAV, in bps. 1..=10000.
        pct_bps: u64,
        /// Hard cap on notional / NAV, ×100 (250 = 2.5x). Independent of pct_bps because
        /// a flip transiently places close+open.
        max_leverage_x100: u64,
        /// Minimum seconds between accepted bars — bounds attestor discretion over timing.
        min_bar_interval_s: u64,
        /// Price tolerance applied to IOC orders, in bps of mark. The order is
        /// priced at mark±slippage (tick-rounded), so fills survive normal
        /// spread but a moved market simply doesn't fill — never chased.
        slippage_bps: u64,

        // ── Live state ──
        /// Rolling sha3_256 over every bar processed. Commits the full input history.
        input_digest: vector<u8>,
        /// Strictly monotonic. Gaps are publicly visible — the attestor cannot hide a bar.
        seq: u64,
        last_bar_ts: u64,
        last_signal: u8,
        is_long: bool,
        in_position: bool,
        paused: bool,
        /// Always true — set at creation, never written again. Kept as an explicit field so
        /// `tick_attested` asserts it and readers can see immutability without inference.
        sealed: bool,
        trades: u64,

        // ── Builder code (frozen at creation) ──
        /// Where the builder fee on this vault's fills is paid. Snapshotted at creation so a
        /// later platform-config change can never redirect an existing vault's fees.
        builder_addr: address,
        /// Builder fee in bps of notional, bounded by MAX_BUILDER_FEE_BPS. 0 disables it.
        builder_fee_bps: u64,

        // ── Swap notice ──
        /// True when this strategy REPLACES an earlier one on a vault that was already licensed
        /// — i.e. depositors may have bought into a different strategy than this one. Frozen at
        /// creation; the first strategy on a vault is never a swap and is never gated.
        is_swap: bool,
        /// Unix seconds of the most recent public announcement, or 0. Mutable by design: an
        /// announcement can expire and be renewed. It schedules WHEN this strategy may begin
        /// trading; it can never change WHAT it does.
        announced_at: u64,

        /// Mints the delegated-trader signer. Private to this module — no human holds it.
        extend_ref: ExtendRef,
    }

    /// Platform economics, held at @cash_strategy and settable only by the admin.
    ///
    /// Both numbers are bounded in code, not just here: the launch fee cannot exceed
    /// MAX_LAUNCH_FEE_UNITS and the builder fee cannot exceed MAX_BUILDER_FEE_BPS. An admin key
    /// compromise therefore cannot turn this into an unbounded tax on depositors.
    struct PlatformConfig has key {
        admin: address,
        /// Receives the one-time launch fee.
        treasury: address,
        /// One-time fee to turn a Decibel vault into a strategy bot, in USDC micro-units.
        launch_fee_units: u64,
        /// The fee asset (USDC on the active network).
        fee_metadata: Object<Metadata>,
        /// Builder-code recipient stamped into new vaults.
        builder_addr: address,
        /// Builder fee in bps stamped into new vaults.
        builder_fee_bps: u64,
    }

    /// Marks a Decibel vault as already licensed, so the launch fee is charged ONCE per vault
    /// rather than once per strategy. This is what makes swapping the algo free: the creator
    /// pays to turn their vault into a bot, then re-points it at as many sealed strategies as
    /// they like, forever.
    struct LaunchLicense has store, drop {
        paid_by: address,
        paid_units: u64,
        licensed_at: u64,
    }

    /// Decibel vault address -> licence. Lives beside the config at @cash_strategy.
    struct LaunchLicenses has key {
        by_vault: Table<address, LaunchLicense>,
    }

    /// Bounded on-chain price trace. This is the exact series the strategy is defined over,
    /// so a later replay (after a delayed reveal) uses the same inputs the chain enforced.
    struct PriceTrace has key {
        prices: vector<u64>,
        timestamps: vector<u64>,
        capacity: u64,
    }

    /// The signed message. Every field except `signal` is reconstructed from chain state, so
    /// the attestor's only degree of freedom is the signal itself.
    struct Attestation has drop {
        domain: vector<u8>,
        chain_id: u8,
        strategy_vault: address,
        program_commitment: vector<u8>,
        seq: u64,
        /// Digest of the series through the PREVIOUS bar — the state the signal was computed on.
        input_digest: vector<u8>,
        signal: u8,
    }

    // ─── Events ──────────────────────────────────────────────────────

    #[event]
    struct SealedVaultCreated has drop, store {
        strategy_vault: address,
        creator: address,
        decibel_vault: address,
        program_commitment: vector<u8>,
        attestor_pubkey: vector<u8>,
    }

    #[event]
    struct LaunchFeeCharged has drop, store {
        decibel_vault: address,
        payer: address,
        treasury: address,
        units: u64,
    }

    /// Emitted when a strategy is created against an ALREADY-licensed Decibel vault — i.e. the
    /// creator swapped their algo and paid nothing. Makes the swap publicly auditable.
    #[event]
    struct StrategyRelaunched has drop, store {
        decibel_vault: address,
        strategy_vault: address,
        creator: address,
        program_commitment: vector<u8>,
    }

    /// A replacement strategy has been publicly scheduled. Depositors can act on this.
    #[event]
    struct SwapAnnounced has drop, store {
        decibel_vault: address,
        strategy_vault: address,
        creator: address,
        program_commitment: vector<u8>,
        announced_at: u64,
        tradable_at: u64,
        expires_at: u64,
    }

    #[event]
    struct StrategySealed has drop, store {
        strategy_vault: address,
        program_commitment: vector<u8>,
        enclave_measurement: vector<u8>,
        sealed_at: u64,
    }

    /// Emitted on EVERY accepted bar, trade or not. This is the verifiable trace: replaying the
    /// committed program over the price series must reproduce exactly this signal sequence.
    #[event]
    struct AttestedTick has drop, store {
        strategy_vault: address,
        program_commitment: vector<u8>,
        seq: u64,
        bar_ts: u64,
        price: u64,
        /// Digest the attestation was signed against (series through the previous bar).
        prev_digest: vector<u8>,
        /// Digest after folding in this bar.
        new_digest: vector<u8>,
        signal: u8,
        signature: vector<u8>,
        traded: bool,
    }

    #[event]
    struct VaultTraded has drop, store {
        strategy_vault: address,
        decibel_vault: address,
        seq: u64,
        signal: u8,
        is_buy: bool,
        reduce_only: bool,
        size: u64,
        /// 1e8-scaled trace price (what the digest committed).
        price: u64,
        /// Actual IOC limit price submitted, in engine px units (1e6).
        order_px: u64,
        timestamp: u64,
    }

    /// Emitted when a flip is skipped because NAV sizing lands below the market minimum.
    /// We skip rather than clamp UP: clamping up would breach the NAV cap on small vaults
    /// (the bug called out in docs/CURATOR-RULES.md §1, last row).
    #[event]
    struct TradeSkipped has drop, store {
        strategy_vault: address,
        seq: u64,
        signal: u8,
        computed_size: u64,
        min_size: u64,
    }

    // ─── Platform economics ──────────────────────────────────────────

    /// Publish-time setup. Callable once, by the module's own account.
    public entry fun init_platform(
        admin: &signer,
        treasury: address,
        launch_fee_units: u64,
        fee_metadata: Object<Metadata>,
        builder_addr: address,
        builder_fee_bps: u64,
    ) {
        assert!(signer::address_of(admin) == @cash_strategy, E_NOT_ADMIN);
        assert!(launch_fee_units <= MAX_LAUNCH_FEE_UNITS, E_BAD_FEE);
        assert!(builder_fee_bps <= MAX_BUILDER_FEE_BPS, E_BAD_FEE);
        move_to(admin, PlatformConfig {
            admin: signer::address_of(admin),
            treasury,
            launch_fee_units,
            fee_metadata,
            builder_addr,
            builder_fee_bps,
        });
        move_to(admin, LaunchLicenses { by_vault: table::new<address, LaunchLicense>() });
    }

    /// Update platform economics. Existing vaults are unaffected: each one snapshots the
    /// builder address and fee at creation, and its launch fee is already paid.
    public entry fun set_platform_config(
        admin: &signer,
        treasury: address,
        launch_fee_units: u64,
        builder_addr: address,
        builder_fee_bps: u64,
    ) acquires PlatformConfig {
        let cfg = borrow_global_mut<PlatformConfig>(@cash_strategy);
        assert!(signer::address_of(admin) == cfg.admin, E_NOT_ADMIN);
        assert!(launch_fee_units <= MAX_LAUNCH_FEE_UNITS, E_BAD_FEE);
        assert!(builder_fee_bps <= MAX_BUILDER_FEE_BPS, E_BAD_FEE);
        cfg.treasury = treasury;
        cfg.launch_fee_units = launch_fee_units;
        cfg.builder_addr = builder_addr;
        cfg.builder_fee_bps = builder_fee_bps;
    }

    public entry fun transfer_admin(admin: &signer, new_admin: address) acquires PlatformConfig {
        let cfg = borrow_global_mut<PlatformConfig>(@cash_strategy);
        assert!(signer::address_of(admin) == cfg.admin, E_NOT_ADMIN);
        cfg.admin = new_admin;
    }

    #[view]
    /// True when this Decibel vault has already paid — i.e. swapping its algo is free.
    public fun is_licensed(decibel_vault: address): bool acquires LaunchLicenses {
        exists<LaunchLicenses>(@cash_strategy)
            && table::contains(&borrow_global<LaunchLicenses>(@cash_strategy).by_vault, decibel_vault)
    }

    #[view]
    /// (launch_fee_units, treasury, builder_addr, builder_fee_bps). The UI quotes from this
    /// rather than hardcoding, so a config change is reflected without a redeploy.
    public fun platform_terms(): (u64, address, address, u64) acquires PlatformConfig {
        let cfg = borrow_global<PlatformConfig>(@cash_strategy);
        (cfg.launch_fee_units, cfg.treasury, cfg.builder_addr, cfg.builder_fee_bps)
    }

    /// Charge the one-time launch fee unless this Decibel vault is already licensed.
    /// Returns the builder terms to stamp into the new vault.
    fun collect_launch_fee(creator: &signer, decibel_vault: address): (address, u64)
        acquires PlatformConfig, LaunchLicenses
    {
        assert!(exists<PlatformConfig>(@cash_strategy), E_NO_PLATFORM_CONFIG);
        let cfg = borrow_global<PlatformConfig>(@cash_strategy);
        let licenses = &mut borrow_global_mut<LaunchLicenses>(@cash_strategy).by_vault;

        if (!table::contains(licenses, decibel_vault)) {
            if (cfg.launch_fee_units > 0) {
                primary_fungible_store::transfer(
                    creator,
                    cfg.fee_metadata,
                    cfg.treasury,
                    cfg.launch_fee_units,
                );
            };
            table::add(licenses, decibel_vault, LaunchLicense {
                paid_by: signer::address_of(creator),
                paid_units: cfg.launch_fee_units,
                licensed_at: timestamp::now_seconds(),
            });
            event::emit(LaunchFeeCharged {
                decibel_vault,
                payer: signer::address_of(creator),
                treasury: cfg.treasury,
                units: cfg.launch_fee_units,
            });
        };
        (cfg.builder_addr, cfg.builder_fee_bps)
    }

    // ─── Creation ────────────────────────────────────────────────────

    /// Create a vault. It is SEALED AT BIRTH: the commitment, the attestor key, the market
    /// binding and every rule are frozen by this single call and can never change.
    ///
    /// This used to be two steps — create, then a separate one-way `seal()` — and that shape was
    /// a footgun. Between them the vault was mutable and untradeable, and `seal()` would happily
    /// freeze a vault whose Decibel delegation had failed, permanently bricking it. Freezing at
    /// creation is strictly stronger (there is no mutable window at all) AND strictly safer: a
    /// vault that is not yet delegated simply cannot trade until the delegation lands, which is
    /// a recoverable state rather than a permanent one.
    ///
    /// The returned Object address is what the Decibel vault admin delegates dex actions to.
    /// `enclave_measurement` is empty for tier-1 (bare key) attestation and carries the TEE
    /// measurement for tier-2; see docs/SEALED-INDICATOR.md §4.
    public entry fun create_sealed_vault(
        creator: &signer,
        program_commitment: vector<u8>,
        attestor_pubkey: vector<u8>,
        decibel_vault_addr: address,
        market: Object<PerpMarket>,
        size_decimals_pow: u128,
        lot_size: u128,
        min_size: u128,
        ticker_size: u128,
        pct_bps: u64,
        max_leverage_x100: u64,
        min_bar_interval_s: u64,
        slippage_bps: u64,
        trace_capacity: u64,
        enclave_measurement: vector<u8>,
    ) acquires PlatformConfig, LaunchLicenses {
        assert!(vector::length(&program_commitment) == 32, E_BAD_COMMITMENT);
        assert!(vector::length(&attestor_pubkey) == 32, E_BAD_PUBKEY);
        assert!(pct_bps > 0 && pct_bps <= 10000, E_BAD_BPS);
        assert!(max_leverage_x100 > 0, E_BAD_LEVERAGE);
        assert!(size_decimals_pow > 0 && lot_size > 0 && min_size > 0, E_BAD_MARKET_PARAMS);
        assert!(ticker_size > 0, E_BAD_MARKET_PARAMS);
        assert!(slippage_bps <= MAX_SLIPPAGE_BPS, E_BAD_SLIPPAGE);
        assert!(trace_capacity > 0, E_BAD_MARKET_PARAMS);

        let creator_addr = signer::address_of(creator);

        // The one-time platform fee, charged per DECIBEL VAULT — not per strategy. A creator
        // who already turned this vault into a bot pays nothing to point it at a new algo.
        // Read the licence BEFORE collecting so the relaunch event is accurate.
        let was_licensed = is_licensed(decibel_vault_addr);
        let (builder_addr, builder_fee_bps) = collect_launch_fee(creator, decibel_vault_addr);

        let ctor = object::create_object(creator_addr);
        let obj_signer = object::generate_signer(&ctor);
        let extend_ref = object::generate_extend_ref(&ctor);
        let sv_addr = signer::address_of(&obj_signer);

        move_to(&obj_signer, SealedVault {
            creator: creator_addr,
            program_commitment,
            attestor_pubkey,
            enclave_measurement,
            decibel_vault_addr,
            market,
            size_decimals_pow,
            lot_size,
            min_size,
            ticker_size,
            pct_bps,
            max_leverage_x100,
            min_bar_interval_s,
            slippage_bps,
            // Genesis digest: sha3_256 of the domain, so two vaults never share a starting state.
            input_digest: hash::sha3_256(ATTESTATION_DOMAIN),
            seq: 0,
            last_bar_ts: 0,
            last_signal: SIGNAL_NEUTRAL,
            is_long: false,
            in_position: false,
            paused: false,
            sealed: true,
            trades: 0,
            builder_addr,
            builder_fee_bps,
            is_swap: was_licensed,
            announced_at: 0,
            extend_ref,
        });

        // Pre-authorize the builder fee from the vault's own trading identity. Decibel
        // validates a builder code against an approved maximum, and the approval must come
        // from the account the orders are placed by — the vault admin cannot grant it on a
        // vault subaccount's behalf (EBUILDER_SUBACCOUNT_NOT_FOUND). Doing it here means a
        // launched vault is immediately able to trade with the code attached.
        if (builder_fee_bps > 0) {
            perp_engine_api::approve_max_fee(
                &obj_signer,
                builder_addr,
                builder_fee_bps * BUILDER_UNITS_PER_BPS,
            );
        };

        move_to(&obj_signer, PriceTrace {
            prices: vector::empty<u64>(),
            timestamps: vector::empty<u64>(),
            capacity: trace_capacity,
        });

        event::emit(SealedVaultCreated {
            strategy_vault: sv_addr,
            creator: creator_addr,
            decibel_vault: decibel_vault_addr,
            program_commitment,
            attestor_pubkey,
        });

        // A swap — this vault already had a strategy. Emitted so depositors can see, on chain,
        // exactly when the algo behind their vault changed and to which commitment.
        if (was_licensed) {
            event::emit(StrategyRelaunched {
                decibel_vault: decibel_vault_addr,
                strategy_vault: sv_addr,
                creator: creator_addr,
                program_commitment,
            });
        };

        // Sealing is the same instant as creation, but it stays its own event so indexers,
        // the verifier and the docs keep one unambiguous "this is now immutable" marker.
        event::emit(StrategySealed {
            strategy_vault: sv_addr,
            program_commitment,
            enclave_measurement,
            sealed_at: timestamp::now_seconds(),
        });
    }

    // ─── Swap notice ─────────────────────────────────────────────────

    /// Does anyone OTHER than the creator hold shares in this vault?
    ///
    /// Total shares minus everything the creator holds. Their shares can be in either of two
    /// places and BOTH must be counted: funding a vault through `create_and_fund_vault` pays
    /// the shares into the creator's Decibel SUBACCOUNT, not their wallet. Counting only the
    /// wallet made every vault read as having outside depositors — including one the creator
    /// was alone in — so the notice period applied to every swap and the "iterate freely while
    /// nobody else is in" property silently did not exist. Verified on testnet: a solo creator's
    /// 100 shares sat entirely in the subaccount and the wallet read zero.
    ///
    /// The remaining bias is one-directional and safe: shares the creator keeps somewhere else
    /// again (a second wallet, a non-primary subaccount) read as outside holders and make the
    /// requirement STRICTER. Going the other way — hiding a real depositor — would mean that
    /// depositor moving their shares into the creator's own stores, at which point they have
    /// given the shares away and are no longer a depositor.
    fun has_outside_depositors(decibel_vault_addr: address, creator: address): bool {
        let vault = object::address_to_object<Vault>(decibel_vault_addr);
        let total = vault_read_api::get_vault_num_shares(vault);
        if (total == 0) return false;
        let share_meta = vault_read_api::get_vault_share_asset_type(vault);
        let creator_shares = primary_fungible_store::balance(creator, share_meta)
            + primary_fungible_store::balance(
                dex_accounts::primary_subaccount_public(creator),
                share_meta,
            );
        total > creator_shares
    }

    /// Publicly schedule a replacement strategy. Starts the depositor-notice clock.
    ///
    /// Anyone watching the chain sees this the moment it lands, and `SwapAnnounced` carries the
    /// exact time the new algo may begin trading. Callable repeatedly — a lapsed announcement
    /// is renewed by announcing again, which restarts the full notice period.
    public entry fun announce_swap(creator: &signer, sv_addr: address) acquires SealedVault {
        let sv = borrow_global_mut<SealedVault>(sv_addr);
        assert!(signer::address_of(creator) == sv.creator, E_NOT_CREATOR);
        let now = timestamp::now_seconds();
        sv.announced_at = now;
        event::emit(SwapAnnounced {
            decibel_vault: sv.decibel_vault_addr,
            strategy_vault: sv_addr,
            creator: sv.creator,
            program_commitment: sv.program_commitment,
            announced_at: now,
            tradable_at: now + SWAP_NOTICE_SECS,
            expires_at: now + ANNOUNCE_VALIDITY_SECS,
        });
    }

    /// The gate. A REPLACEMENT strategy may not trade other people's money until it has been
    /// publicly announced for the full notice period.
    ///
    /// This is enforced here, on the trade, and not on the delegation — because the delegation
    /// is Decibel's `vault_admin_api::delegate_dex_actions_to`, a `private entry` this module
    /// cannot hook or observe. A creator can hand this strategy trading rights whenever they
    /// like; what they cannot do is make it place an order. That makes the notice period an
    /// actual constraint rather than a convention the UI happens to follow.
    fun assert_may_trade(sv: &SealedVault) {
        // The first strategy on a vault is what depositors bought into. Nothing to notice.
        if (!sv.is_swap) return;
        // Nobody else's money at risk — the creator is free to iterate instantly.
        if (!has_outside_depositors(sv.decibel_vault_addr, sv.creator)) return;

        assert!(sv.announced_at > 0, E_SWAP_NOT_ANNOUNCED);
        let now = timestamp::now_seconds();
        assert!(now >= sv.announced_at + SWAP_NOTICE_SECS, E_SWAP_NOT_MATURED);
        // A stale announcement is not notice. See ANNOUNCE_VALIDITY_SECS.
        assert!(now <= sv.announced_at + ANNOUNCE_VALIDITY_SECS, E_ANNOUNCE_EXPIRED);
    }

    #[view]
    /// (is_swap, announced_at, tradable_at, expires_at, needs_notice). Drives the UI's swap
    /// panel and lets a depositor check the schedule themselves.
    public fun swap_status(sv_addr: address): (bool, u64, u64, u64, bool) acquires SealedVault {
        let sv = borrow_global<SealedVault>(sv_addr);
        let needs = sv.is_swap && has_outside_depositors(sv.decibel_vault_addr, sv.creator);
        (
            sv.is_swap,
            sv.announced_at,
            if (sv.announced_at == 0) { 0 } else { sv.announced_at + SWAP_NOTICE_SECS },
            if (sv.announced_at == 0) { 0 } else { sv.announced_at + ANNOUNCE_VALIDITY_SECS },
            needs,
        )
    }

    // ─── The tick ────────────────────────────────────────────────────

    /// Permissionless crank. The caller pays gas and supplies the bar timestamp, the attested
    /// signal and its signature — nothing else. The price is read on-chain; the message the
    /// signature must match is reconstructed entirely from chain state.
    ///
    /// A wrong signature aborts. A stale or out-of-order bar aborts. There is no path by which
    /// the cranker influences what trade happens.
    public entry fun tick_attested(
        _cranker: &signer,
        sv_addr: address,
        bar_ts: u64,
        signal: u8,
        signature: vector<u8>,
    ) acquires SealedVault, PriceTrace {
        assert!(signal <= SIGNAL_SELL, E_BAD_SIGNAL);

        let sv = borrow_global_mut<SealedVault>(sv_addr);
        assert!(sv.sealed, E_NOT_SEALED);
        assert!(!sv.paused, E_PAUSED);
        // A replacement strategy cannot touch depositor money before its notice period is up.
        assert_may_trade(sv);

        // Timing: strictly forward, spaced, and not from the future.
        let now = timestamp::now_seconds();
        assert!(bar_ts <= now + MAX_CLOCK_SKEW_SECS, E_BAR_IN_FUTURE);
        assert!(
            sv.last_bar_ts == 0 || bar_ts >= sv.last_bar_ts + sv.min_bar_interval_s,
            E_BAR_TOO_SOON,
        );

        // 1. Verify the attestation against the CURRENT committed state (series through the
        //    previous bar). The attestor computed this signal from exactly that series.
        let prev_digest = sv.input_digest;
        verify_attestation(sv, sv_addr, prev_digest, signal, signature);

        // 2. Read the price on-chain. The attestor never supplies it and cannot influence it.
        // mark_px is in the engine's px units (1e6); the committed trace is 1e8-scaled.
        let mark_px = public_read_api::get_mark_price(sv.market);
        let price = mark_px * PRICE_SCALE_PX_TO_1E8;

        // 3. Fold the bar into the committed trace.
        let new_digest = fold_digest(prev_digest, bar_ts, price);
        sv.input_digest = new_digest;
        sv.seq = sv.seq + 1;
        sv.last_bar_ts = bar_ts;
        append_trace(sv_addr, price, bar_ts);

        // 4. Act only on a flip to a directional signal.
        let traded = false;
        if (signal != SIGNAL_NEUTRAL && signal != sv.last_signal) {
            traded = execute_flip(sv, sv_addr, signal, mark_px, price, bar_ts);
        };
        sv.last_signal = signal;

        event::emit(AttestedTick {
            strategy_vault: sv_addr,
            program_commitment: sv.program_commitment,
            seq: sv.seq,
            bar_ts,
            price,
            prev_digest,
            new_digest,
            signal,
            signature,
            traded,
        });
    }

    fun verify_attestation(
        sv: &SealedVault,
        sv_addr: address,
        prev_digest: vector<u8>,
        signal: u8,
        signature_bytes: vector<u8>,
    ) {
        let msg = Attestation {
            domain: ATTESTATION_DOMAIN,
            chain_id: chain_id::get(),
            strategy_vault: sv_addr,
            program_commitment: sv.program_commitment,
            seq: sv.seq,
            input_digest: prev_digest,
            signal,
        };
        let sig = ed25519::new_signature_from_bytes(signature_bytes);
        let pk = ed25519::new_unvalidated_public_key_from_bytes(sv.attestor_pubkey);
        assert!(
            ed25519::signature_verify_strict(&sig, &pk, bcs::to_bytes(&msg)),
            E_INVALID_SIGNATURE,
        );
    }

    /// digest_n = sha3_256(digest_{n-1} || bcs(bar_ts) || bcs(price))
    fun fold_digest(prev: vector<u8>, bar_ts: u64, price: u64): vector<u8> {
        let buf = prev;
        vector::append(&mut buf, bcs::to_bytes(&bar_ts));
        vector::append(&mut buf, bcs::to_bytes(&price));
        hash::sha3_256(buf)
    }

    fun append_trace(sv_addr: address, price: u64, ts: u64) acquires PriceTrace {
        let trace = borrow_global_mut<PriceTrace>(sv_addr);
        vector::push_back(&mut trace.prices, price);
        vector::push_back(&mut trace.timestamps, ts);
        if ((vector::length(&trace.prices) as u64) > trace.capacity) {
            vector::remove(&mut trace.prices, 0);
            vector::remove(&mut trace.timestamps, 0);
        };
    }

    /// Close any opposing position, then open in the new direction. Returns whether an order
    /// was actually placed.
    fun execute_flip(
        sv: &mut SealedVault,
        sv_addr: address,
        signal: u8,
        mark_px: u64,
        price: u64,
        bar_ts: u64,
    ): bool {
        let want_long_check = signal == SIGNAL_BUY;
        // Already positioned this way — do nothing. Without this, a signal
        // sequence like sell → neutral → sell re-enters an open short every
        // time, pyramiding the position past max_leverage_x100 (the cap is
        // per-order, so repeated entries would compound past it).
        if (sv.in_position && sv.is_long == want_long_check) {
            return false
        };

        let size = resolve_size(sv, mark_px);
        if (size == 0) {
            event::emit(TradeSkipped {
                strategy_vault: sv_addr,
                seq: sv.seq,
                signal,
                computed_size: 0,
                min_size: (sv.min_size as u64),
            });
            return false
        };

        let want_long = signal == SIGNAL_BUY;
        let trader = object::generate_signer_for_extending(&sv.extend_ref);
        let subaccount = dex_accounts::primary_subaccount_object_public(sv.decibel_vault_addr);

        // Order prices are in the ENGINE'S px units (1e6) — NOT the 1e8 trace
        // scale. The legacy strategy_vault passed the 1e8 price as the limit,
        // so buys crossed the entire book (accidental market orders) and sells
        // sat 100x above mark and could never fill. Priced at mark±slippage
        // and rounded onto the market's tick grid (up for buys, down for
        // sells) so the order stays marketable without chasing a moved market.
        let buy_px = round_up_to_tick(
            (mark_px as u128) * ((BPS_DENOM as u128) + (sv.slippage_bps as u128)) / (BPS_DENOM as u128),
            sv.ticker_size,
        );
        let sell_px = round_down_to_tick(
            (mark_px as u128) * ((BPS_DENOM as u128) - (sv.slippage_bps as u128)) / (BPS_DENOM as u128),
            sv.ticker_size,
        );

        if (sv.in_position && sv.is_long != want_long) {
            // Closing side is opposite the position: a long closes with a sell.
            let close_px = if (sv.is_long) { sell_px } else { buy_px };
            place(&trader, subaccount, sv.market, !sv.is_long, size, close_px, true,
                sv.builder_addr, sv.builder_fee_bps);
            event::emit(VaultTraded {
                strategy_vault: sv_addr,
                decibel_vault: sv.decibel_vault_addr,
                seq: sv.seq,
                signal,
                is_buy: !sv.is_long,
                reduce_only: true,
                size,
                price,
                order_px: close_px,
                timestamp: bar_ts,
            });
        };

        let open_px = if (want_long) { buy_px } else { sell_px };
        place(&trader, subaccount, sv.market, want_long, size, open_px, false,
            sv.builder_addr, sv.builder_fee_bps);
        event::emit(VaultTraded {
            strategy_vault: sv_addr,
            decibel_vault: sv.decibel_vault_addr,
            seq: sv.seq,
            signal,
            is_buy: want_long,
            reduce_only: false,
            size,
            price,
            order_px: open_px,
            timestamp: bar_ts,
        });

        sv.in_position = true;
        sv.is_long = want_long;
        sv.trades = sv.trades + 1;
        true
    }

    fun round_up_to_tick(px: u128, tick: u128): u64 {
        (((px + tick - 1) / tick * tick) as u64)
    }

    fun round_down_to_tick(px: u128, tick: u128): u64 {
        ((px / tick * tick) as u64)
    }

    /// Size = NAV × pct_bps, capped by max_leverage, floored to the lot.
    /// Returns 0 (skip the trade) when the result is below the market minimum — never clamps
    /// up, because clamping up breaches the NAV cap on small vaults.
    fun resolve_size(sv: &SealedVault, mark_px_1e6: u64): u64 {
        let nav = public_read_api::get_account_net_asset_value(
            dex_accounts::primary_subaccount_public(sv.decibel_vault_addr)
        );
        assert!(nav > 0, E_NO_NAV);

        let mark_px = (mark_px_1e6 as u128);
        if (mark_px == 0) return 0;

        let nav_u = (nav as u128);
        let size = nav_u * (sv.pct_bps as u128) * sv.size_decimals_pow / (BPS_DENOM * mark_px);

        // Leverage cap: notional = size × price / size_pow must be ≤ nav × max_leverage/100.
        let max_notional = nav_u * (sv.max_leverage_x100 as u128) / 100;
        let max_size = max_notional * sv.size_decimals_pow / mark_px;
        if (size > max_size) size = max_size;

        // Engine rejects non-lot-multiples.
        size = size / sv.lot_size * sv.lot_size;
        if (size < sv.min_size) return 0;
        (size as u64)
    }

    fun place(
        trader: &signer,
        subaccount: Object<Subaccount>,
        market: Object<PerpMarket>,
        is_buy: bool,
        size: u64,
        price: u64,
        reduce_only: bool,
        builder_addr: address,
        builder_fee_bps: u64,
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
            option::none(),
            tpsl,
            builder_code(builder_addr, builder_fee_bps),
        );
    }

    /// The builder code attached to this vault's fills, or none when the fee is zero.
    /// Decibel prices it in hundredths of a basis point.
    fun builder_code(builder_addr: address, builder_fee_bps: u64): option::Option<BuilderCode> {
        if (builder_fee_bps == 0) {
            option::none<BuilderCode>()
        } else {
            option::some(
                perp_engine_api::new_builder_code(
                    builder_addr,
                    builder_fee_bps * BUILDER_UNITS_PER_BPS,
                ),
            )
        }
    }

    // ─── Admin ───────────────────────────────────────────────────────

    /// Pause stays available after sealing — it is a safety valve, not a config change.
    /// It blocks NEW ticks; it does not flatten an open position.
    public entry fun set_paused(creator: &signer, sv_addr: address, paused: bool)
        acquires SealedVault
    {
        let sv = borrow_global_mut<SealedVault>(sv_addr);
        assert!(signer::address_of(creator) == sv.creator, E_NOT_CREATOR);
        sv.paused = paused;
    }

    // There is deliberately no `set_sizing`. Sizing is part of the sealed rule set, chosen at
    // creation and frozen there. `set_paused` above is the only post-creation write, and it can
    // only stop the vault — never change what it does.

    // ─── Views ───────────────────────────────────────────────────────

    /// Everything the attestor needs to build its next message. Reading this plus the trace is
    /// sufficient to reproduce the signed payload byte-for-byte.
    #[view]
    public fun get_attestation_context(sv_addr: address): (vector<u8>, u64, vector<u8>, u8, u64)
        acquires SealedVault
    {
        let sv = borrow_global<SealedVault>(sv_addr);
        (sv.program_commitment, sv.seq, sv.input_digest, sv.last_signal, sv.last_bar_ts)
    }

    #[view]
    public fun get_sealed_state(sv_addr: address): (
        address, address, vector<u8>, vector<u8>, vector<u8>, u64, u64, u64, bool, bool, bool, bool, u64, u64
    ) acquires SealedVault {
        let sv = borrow_global<SealedVault>(sv_addr);
        (
            sv.creator,
            sv.decibel_vault_addr,
            sv.program_commitment,
            sv.attestor_pubkey,
            sv.enclave_measurement,
            sv.pct_bps,
            sv.max_leverage_x100,
            sv.min_bar_interval_s,
            sv.in_position,
            sv.is_long,
            sv.paused,
            sv.sealed,
            sv.trades,
            sv.seq,
        )
    }

    #[view]
    public fun get_trace(sv_addr: address): (vector<u64>, vector<u64>) acquires PriceTrace {
        let t = borrow_global<PriceTrace>(sv_addr);
        (t.prices, t.timestamps)
    }

    #[view]
    public fun get_input_digest(sv_addr: address): vector<u8> acquires SealedVault {
        borrow_global<SealedVault>(sv_addr).input_digest
    }

    /// The address the Decibel vault admin must delegate trading to (== sv_addr).
    #[view]
    public fun delegated_trader(sv_addr: address): address { sv_addr }

    // ─── Test-only helpers ───────────────────────────────────────────

    #[test_only]
    public fun attestation_message_for_test(
        sv_addr: address,
        program_commitment: vector<u8>,
        seq: u64,
        input_digest: vector<u8>,
        signal: u8,
        cid: u8,
    ): vector<u8> {
        bcs::to_bytes(&Attestation {
            domain: ATTESTATION_DOMAIN,
            chain_id: cid,
            strategy_vault: sv_addr,
            program_commitment,
            seq,
            input_digest,
            signal,
        })
    }

    #[test_only]
    public fun fold_digest_for_test(prev: vector<u8>, bar_ts: u64, price: u64): vector<u8> {
        fold_digest(prev, bar_ts, price)
    }

    #[test_only]
    public fun genesis_digest_for_test(): vector<u8> { hash::sha3_256(ATTESTATION_DOMAIN) }
}
