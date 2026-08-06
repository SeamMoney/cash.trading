/// Portfolio-mode sealed vault: many markets, many positions, sized and levered per leg.
///
/// ## Why this is a separate module
///
/// `sealed_vault` is the audited single-market path and stays byte-identical. Vaults already
/// live on it keep trading, and the surface a reviewer has to reason about for the simple case
/// does not grow. This module is opt-in and shares only the platform fee tables.
///
/// ## What changed, and what did NOT
///
/// The attestor's degrees of freedom widen from one trit per bar to a bounded action vector:
/// which market (from a frozen allowlist), which side, what share of NAV, what leverage. That
/// is what makes a real strategy expressible — a strategy that cannot choose its size or its
/// instrument is a signal generator, not a manager.
///
/// It does NOT become discretionary. Every one of those choices is clamped by a bound frozen at
/// creation and published on-chain:
///
///   - the market must be in `markets`, an allowlist fixed at birth. The attestor picks from a
///     menu it cannot add to.
///   - per-leg notional ≤ `max_pct_bps` of NAV, and per-leg leverage ≤ `max_leverage_x100`.
///   - TOTAL open notional ≤ NAV × `max_portfolio_leverage_x100` / 100. Per-leg caps alone are
///     not a risk limit: N legs each inside the per-leg cap multiply to N× the exposure. This
///     aggregate check is the one that actually bounds depositor loss.
///   - at most `max_positions` legs open at once, at most one action per market per bar (so a
///     single bar cannot pyramid one market).
///   - the price of every market is read on-chain. The attestor never supplies a price.
///   - timing is still bar-spaced and forward-only, and the sequence still cannot skip silently.
///
/// And two guarantees the single-market version could not make:
///
///   - **Everything closes.** A position older than `max_hold_bars` is force-closed at the top
///     of the next tick, before any action the attestor signed is even read. The strategy does
///     not opt in to this and cannot defer it. An attestor that goes dark cannot leave a
///     position open forever — `force_close_stale` is permissionless, so anyone can flatten a
///     stale vault, and it is the depositor's remedy, not a favour from the operator.
///   - **Funding is a cost, not an afterthought.** A leg whose accrued funding exceeds
///     `max_adverse_funding_bps` of its own notional is force-closed on the same pass. A carry
///     trade that stops paying for itself does not get to sit there quietly draining NAV.
///
/// ## What is still trusted
///
/// The attestor is trusted to run the committed program honestly WITHIN these bounds, exactly
/// as before. It can pick a worse market inside the allowlist, size smaller than it should, or
/// emit no action at all. The chain constrains the damage; it does not verify the alpha.
/// Tier-2 (enclave measurement bound at creation) is what removes that trust, and the field is
/// carried here for it — see docs/SEALED-INDICATOR.md §4.
module cash_strategy::portfolio_vault {
    use std::bcs;
    use std::hash;
    use std::option;
    use std::signer;
    use std::vector;

    use aptos_framework::chain_id;
    use aptos_framework::ed25519;
    use aptos_framework::event;
    use aptos_framework::object::{Self, ExtendRef, Object};
    use aptos_framework::timestamp;

    use decibel::dex_accounts::{Self, Subaccount};
    use decibel::perp_engine_api;
    use decibel::builder_code_registry::BuilderCode;
    use decibel::perp_market::PerpMarket;
    use decibel::perp_order;
    use decibel::position_view_types;
    use decibel::public_read_api;
    use order_book::order_book_types;

    use cash_strategy::sealed_vault;

    // ─── Errors ──────────────────────────────────────────────────────

    const E_NOT_CREATOR:          u64 = 1;
    const E_PAUSED:               u64 = 2;
    const E_BAD_BPS:              u64 = 3;
    const E_NO_NAV:               u64 = 4;
    const E_NOT_SEALED:           u64 = 6;
    const E_BAD_PUBKEY:           u64 = 7;
    const E_BAD_COMMITMENT:       u64 = 8;
    const E_INVALID_SIGNATURE:    u64 = 9;
    const E_BAD_SIGNAL:           u64 = 10;
    const E_BAR_TOO_SOON:         u64 = 11;
    const E_BAR_IN_FUTURE:        u64 = 12;
    const E_BAD_MARKET_PARAMS:    u64 = 13;
    const E_BAD_LEVERAGE:         u64 = 14;
    const E_BAD_SLIPPAGE:         u64 = 15;
    const E_NO_MARKETS:           u64 = 22;
    const E_TOO_MANY_MARKETS:     u64 = 23;
    const E_BAD_MARKET_INDEX:     u64 = 24;
    const E_DUPLICATE_MARKET:     u64 = 25;
    const E_TOO_MANY_ACTIONS:     u64 = 26;
    const E_BAD_POSITION_LIMIT:   u64 = 27;
    const E_BAD_HOLD_LIMIT:       u64 = 28;
    const E_BAD_FUNDING_LIMIT:    u64 = 29;
    const E_SWAP_NOT_ANNOUNCED:   u64 = 19;
    const E_SWAP_NOT_MATURED:     u64 = 20;
    const E_ANNOUNCE_EXPIRED:     u64 = 21;

    // ─── Bounds ──────────────────────────────────────────────────────

    const MAX_SLIPPAGE_BPS: u64 = 500;
    /// Ceiling on the aggregate leverage cap a creator may set. The per-leg cap can be
    /// higher than this only in the sense that one leg may use the whole budget.
    const MAX_PORTFOLIO_LEVERAGE_X100: u64 = 1000; // 10x
    /// A vault may not watch more markets than this. Every market is priced on every tick, so
    /// the list length is a direct gas cost paid by the cranker on every bar forever.
    const MAX_MARKETS: u64 = 16;
    /// Hard ceiling on simultaneously open legs, independent of the creator's own setting.
    const MAX_OPEN_POSITIONS: u64 = 8;
    /// A position may not be held longer than this many bars under any configuration. At the
    /// 1-minute floor cadence that is ~10 days; at 1h it is over a year, so the creator's own
    /// `max_hold_bars` is the binding constraint in practice. This is the backstop against a
    /// creator setting an effectively-infinite hold.
    const MAX_HOLD_BARS: u64 = 14_400;

    const ATTESTATION_DOMAIN: vector<u8> = b"cash.trading/portfolio-vault/v1";

    const PRICE_SCALE_PX_TO_1E8: u64 = 100;
    const BPS_DENOM: u128 = 10000;
    const MAX_CLOCK_SKEW_SECS: u64 = 60;
    const BUILDER_UNITS_PER_BPS: u64 = 100;

    const SWAP_NOTICE_SECS: u64 = 86_400;
    const ANNOUNCE_VALIDITY_SECS: u64 = 7 * 86_400;

    /// Action sides. `SIDE_CLOSE` is not "do nothing" — it is an instruction to flatten this
    /// market. Omitting a market from the action vector is how a strategy says "leave it".
    const SIDE_CLOSE: u8 = 0;
    const SIDE_LONG:  u8 = 1;
    const SIDE_SHORT: u8 = 2;

    /// Why a position was closed without the strategy asking. Recorded on the event so a
    /// depositor can tell a strategy decision from a contract-enforced one.
    const CLOSE_REASON_STRATEGY: u8 = 0;
    const CLOSE_REASON_MAX_HOLD: u8 = 1;
    const CLOSE_REASON_FUNDING:  u8 = 2;
    const CLOSE_REASON_FLIP:     u8 = 3;

    // ─── Storage ─────────────────────────────────────────────────────

    /// One tradeable market plus the engine parameters an order against it must respect.
    /// Snapshotted at creation: a market whose lot size later changes keeps the vault honest
    /// about what it committed to, and the round-to-lot helpers below re-derive from the
    /// engine anyway.
    struct MarketSpec has store, drop, copy {
        market: Object<PerpMarket>,
        /// 10^size_decimals for this market.
        size_decimals_pow: u128,
        lot_size: u128,
        min_size: u128,
        ticker_size: u128,
    }

    /// A leg the vault currently holds. The vault tracks its own positions rather than
    /// re-deriving them from the engine on every read: it knows what it placed, and a
    /// partially-filled IOC leaves the engine and this record disagreeing on size. Where that
    /// matters — closing — the engine's own `get_position_size` is used, so a stale record can
    /// never cause an over-close.
    struct OpenPos has store, drop, copy {
        market_idx: u8,
        is_long: bool,
        /// Size as placed. Indicative; the engine is authoritative when closing.
        size: u64,
        opened_seq: u64,
        opened_ts: u64,
        /// Engine px units (1e6) at open.
        entry_px: u64,
    }

    /// One instruction from the strategy for one market, for one bar.
    ///
    /// This is the whole widening of the attestor's authority, and it is deliberately a flat
    /// struct of four bounded integers rather than anything expressive. There is no price
    /// field, no time-in-force, no order type, no venue: those are the contract's to choose,
    /// and handing them over would turn a bounded signal into a trading API.
    struct Action has drop, store, copy {
        /// Index into `markets`. Out of range aborts the whole tick — an attestor that
        /// cannot address the allowlist correctly is not one whose other fields should be
        /// trusted for the same bar.
        market_idx: u8,
        /// SIDE_CLOSE / SIDE_LONG / SIDE_SHORT.
        side: u8,
        /// Share of NAV for this leg, in bps. Clamped to `max_pct_bps`.
        pct_bps: u16,
        /// Leverage for this leg, ×100. Clamped to `max_leverage_x100`.
        leverage_x100: u16,
    }

    struct PortfolioVault has key {
        creator: address,

        // ── Commitment (frozen at creation) ──
        program_commitment: vector<u8>,
        attestor_pubkey: vector<u8>,
        enclave_measurement: vector<u8>,

        // ── Bindings (frozen at creation) ──
        decibel_vault_addr: address,
        /// The allowlist. The attestor chooses within it and can never add to it.
        markets: vector<MarketSpec>,

        // ── Bounds (frozen at creation) ──
        /// Per-leg share of NAV ceiling, in bps.
        max_pct_bps: u64,
        /// Per-leg leverage ceiling, ×100.
        max_leverage_x100: u64,
        /// Aggregate notional ceiling across all open legs, ×100 of NAV. The real risk limit.
        max_portfolio_leverage_x100: u64,
        /// Simultaneously open legs.
        max_positions: u64,
        /// A position older than this many bars is force-closed. Never 0.
        max_hold_bars: u64,
        /// A leg whose accrued funding cost exceeds this share of its own notional is
        /// force-closed. Never 0.
        max_adverse_funding_bps: u64,
        min_bar_interval_s: u64,
        slippage_bps: u64,

        // ── Live state ──
        input_digest: vector<u8>,
        seq: u64,
        last_bar_ts: u64,
        positions: vector<OpenPos>,
        paused: bool,
        sealed: bool,
        trades: u64,

        // ── Builder code (frozen at creation) ──
        builder_addr: address,
        builder_fee_bps: u64,

        // ── Swap notice ──
        is_swap: bool,
        announced_at: u64,

        extend_ref: ExtendRef,
    }

    /// Bounded on-chain trace, one row of prices per bar — every allowlisted market, in
    /// allowlist order, 1e8-scaled. A single-market trace would not reproduce the inputs a
    /// multi-market strategy was defined over, which is the whole point of keeping one.
    struct PriceTrace has key {
        /// Flattened: bar b, market m is at `b * markets_len + m`.
        prices: vector<u64>,
        timestamps: vector<u64>,
        markets_len: u64,
        /// Capacity in BARS, not entries.
        capacity: u64,
    }

    /// The signed message.
    ///
    /// Every field but `actions_digest` is reconstructed from chain state, so the attestor's
    /// only freedom remains the payload it committed to — now a vector rather than a trit. The
    /// digest rather than the vector itself keeps the signed message fixed-size, and the
    /// contract recomputes it from the actions actually submitted, so a cranker cannot swap
    /// the action list for a signature that was issued over a different one.
    struct PortfolioAttestation has drop {
        domain: vector<u8>,
        chain_id: u8,
        strategy_vault: address,
        program_commitment: vector<u8>,
        seq: u64,
        input_digest: vector<u8>,
        actions_digest: vector<u8>,
    }

    // ─── Events ──────────────────────────────────────────────────────

    #[event]
    struct PortfolioVaultCreated has drop, store {
        strategy_vault: address,
        creator: address,
        decibel_vault: address,
        program_commitment: vector<u8>,
        market_count: u64,
        max_positions: u64,
        max_portfolio_leverage_x100: u64,
        max_hold_bars: u64,
        max_adverse_funding_bps: u64,
        is_swap: bool,
    }

    #[event]
    struct PortfolioTick has drop, store {
        strategy_vault: address,
        program_commitment: vector<u8>,
        seq: u64,
        bar_ts: u64,
        /// One 1e8 price per allowlisted market, in allowlist order.
        prices: vector<u64>,
        prev_digest: vector<u8>,
        new_digest: vector<u8>,
        actions_digest: vector<u8>,
        action_count: u64,
        orders_placed: u64,
        open_positions: u64,
    }

    #[event]
    struct PortfolioTraded has drop, store {
        strategy_vault: address,
        decibel_vault: address,
        seq: u64,
        market_idx: u8,
        is_buy: bool,
        reduce_only: bool,
        size: u64,
        /// 1e8-scaled mark at the time of the order.
        price: u64,
        order_px: u64,
        /// CLOSE_REASON_* — STRATEGY for an opening leg.
        reason: u8,
        timestamp: u64,
    }

    #[event]
    struct PortfolioSkipped has drop, store {
        strategy_vault: address,
        seq: u64,
        market_idx: u8,
        side: u8,
        computed_size: u64,
        min_size: u64,
        /// True when the aggregate leverage cap, not the market minimum, blocked this leg.
        blocked_by_portfolio_cap: bool,
    }

    #[event]
    struct SwapAnnounced has drop, store {
        strategy_vault: address,
        creator: address,
        announced_at: u64,
        tradeable_at: u64,
    }

    // ─── Creation ────────────────────────────────────────────────────

    /// Create a sealed portfolio vault. Sealed at birth — there is no separate seal step and
    /// no window in which the rules are mutable.
    ///
    /// `market_addrs` and the four parallel parameter vectors define the allowlist. They are
    /// parallel vectors rather than a vector of structs because entry functions cannot take
    /// user-defined struct arguments.
    public entry fun create_portfolio_vault(
        creator: &signer,
        decibel_vault_addr: address,
        program_commitment: vector<u8>,
        attestor_pubkey: vector<u8>,
        enclave_measurement: vector<u8>,
        market_addrs: vector<address>,
        size_decimals_pows: vector<u64>,
        lot_sizes: vector<u64>,
        min_sizes: vector<u64>,
        ticker_sizes: vector<u64>,
        max_pct_bps: u64,
        max_leverage_x100: u64,
        max_portfolio_leverage_x100: u64,
        max_positions: u64,
        max_hold_bars: u64,
        max_adverse_funding_bps: u64,
        min_bar_interval_s: u64,
        slippage_bps: u64,
        trace_capacity: u64,
    ) {
        assert!(vector::length(&program_commitment) == 32, E_BAD_COMMITMENT);
        assert!(vector::length(&attestor_pubkey) == 32, E_BAD_PUBKEY);

        let n = vector::length(&market_addrs);
        assert!(n > 0, E_NO_MARKETS);
        assert!(n <= MAX_MARKETS, E_TOO_MANY_MARKETS);
        assert!(vector::length(&size_decimals_pows) == n, E_BAD_MARKET_PARAMS);
        assert!(vector::length(&lot_sizes) == n, E_BAD_MARKET_PARAMS);
        assert!(vector::length(&min_sizes) == n, E_BAD_MARKET_PARAMS);
        assert!(vector::length(&ticker_sizes) == n, E_BAD_MARKET_PARAMS);

        assert!(max_pct_bps > 0 && max_pct_bps <= 10000, E_BAD_BPS);
        assert!(max_leverage_x100 >= 100, E_BAD_LEVERAGE);
        // The aggregate cap is what actually bounds depositor loss, so it gets the hard
        // ceiling. A per-leg cap above the aggregate is harmless — one leg may use the whole
        // budget — so it is not separately bounded here.
        assert!(
            max_portfolio_leverage_x100 >= 100
                && max_portfolio_leverage_x100 <= MAX_PORTFOLIO_LEVERAGE_X100,
            E_BAD_LEVERAGE,
        );
        assert!(max_positions > 0 && max_positions <= MAX_OPEN_POSITIONS, E_BAD_POSITION_LIMIT);
        // Zero would mean "hold forever", which is exactly the failure this field exists to
        // prevent, so it is not an accepted value rather than a special case.
        assert!(max_hold_bars > 0 && max_hold_bars <= MAX_HOLD_BARS, E_BAD_HOLD_LIMIT);
        assert!(
            max_adverse_funding_bps > 0 && max_adverse_funding_bps <= 10000,
            E_BAD_FUNDING_LIMIT,
        );
        assert!(slippage_bps <= MAX_SLIPPAGE_BPS, E_BAD_SLIPPAGE);
        assert!(min_bar_interval_s > 0, E_BAD_MARKET_PARAMS);
        assert!(trace_capacity > 0, E_BAD_MARKET_PARAMS);

        let markets = vector::empty<MarketSpec>();
        let i = 0;
        while (i < n) {
            let pow = *vector::borrow(&size_decimals_pows, i);
            let lot = *vector::borrow(&lot_sizes, i);
            let min = *vector::borrow(&min_sizes, i);
            let tick = *vector::borrow(&ticker_sizes, i);
            assert!(pow > 0 && lot > 0 && min > 0 && tick > 0, E_BAD_MARKET_PARAMS);
            let addr = *vector::borrow(&market_addrs, i);
            // Reject a repeated market rather than dedupe it: two entries for one market
            // would let one bar carry two actions for the same book, which is the pyramiding
            // the per-bar duplicate check exists to stop.
            let j = 0;
            while (j < i) {
                assert!(*vector::borrow(&market_addrs, j) != addr, E_DUPLICATE_MARKET);
                j = j + 1;
            };
            vector::push_back(&mut markets, MarketSpec {
                market: object::address_to_object<PerpMarket>(addr),
                size_decimals_pow: (pow as u128),
                lot_size: (lot as u128),
                min_size: (min as u128),
                ticker_size: (tick as u128),
            });
            i = i + 1;
        };

        // Whether this is a SWAP is derived on chain, never taken from the caller.
        //
        // It was an argument at first, which meant the depositor-notice period was opt-in by
        // the exact party it constrains: pass `false` and a replacement strategy starts trading
        // other people's money the same second, with no notice. `sealed_vault` already derives
        // it the same way — a vault that is already licensed necessarily has a prior strategy,
        // so this one replaces it. Read BEFORE collecting the fee, because collecting is what
        // creates the licence.
        let is_swap = sealed_vault::is_licensed(decibel_vault_addr);

        // One launch fee per Decibel vault, charged by the same table the single-market path
        // uses — so a creator who already licensed their vault can move to portfolio mode for
        // free, exactly as swapping strategies is free.
        sealed_vault::collect_launch_fee_friend(creator, decibel_vault_addr);
        let (builder_addr, builder_fee_bps) = sealed_vault::builder_stamp_friend();

        let ctor = object::create_object(signer::address_of(creator));
        let extend_ref = object::generate_extend_ref(&ctor);
        let sv_signer = object::generate_signer(&ctor);
        let sv_addr = signer::address_of(&sv_signer);

        move_to(&sv_signer, PortfolioVault {
            creator: signer::address_of(creator),
            program_commitment,
            attestor_pubkey,
            enclave_measurement,
            decibel_vault_addr,
            markets,
            max_pct_bps,
            max_leverage_x100,
            max_portfolio_leverage_x100,
            max_positions,
            max_hold_bars,
            max_adverse_funding_bps,
            min_bar_interval_s,
            slippage_bps,
            // Genesis digest, NOT an empty vector. `sealed_vault` seeds the same way, the TS
            // attestor exports `portfolioGenesisDigest()` expecting it, and the signed message
            // requires a 32-byte digest — an empty one made bar 0 unsignable, so the very
            // first tick of every portfolio vault would have failed. The Move unit tests never
            // caught it because they cannot create a vault (that needs a live Decibel engine),
            // which is exactly why the testnet e2e exists.
            input_digest: hash::sha3_256(ATTESTATION_DOMAIN),
            seq: 0,
            last_bar_ts: 0,
            positions: vector::empty<OpenPos>(),
            paused: false,
            sealed: true,
            trades: 0,
            builder_addr,
            builder_fee_bps,
            is_swap,
            announced_at: 0,
            extend_ref,
        });

        // Pre-authorize the builder fee from the vault's own trading identity, exactly as
        // `sealed_vault` does at creation. Without it every single order aborts with
        // `EBUILDER_NOT_REGISTERED` — Decibel validates an attached builder code against an
        // approval recorded for the account that PLACES the order, and a vault admin cannot
        // grant it on a subaccount's behalf. This module shipped without it, so the very first
        // order of the very first portfolio vault reverted; the live clean-room run is what
        // surfaced it, because a vault that never signals never places an order and every
        // earlier test happened to see `neutral`.
        if (builder_fee_bps > 0) {
            perp_engine_api::approve_max_fee(
                &sv_signer,
                builder_addr,
                builder_fee_bps * BUILDER_UNITS_PER_BPS,
            );
        };

        move_to(&sv_signer, PriceTrace {
            prices: vector::empty<u64>(),
            timestamps: vector::empty<u64>(),
            markets_len: n,
            capacity: trace_capacity,
        });

        event::emit(PortfolioVaultCreated {
            strategy_vault: sv_addr,
            creator: signer::address_of(creator),
            decibel_vault: decibel_vault_addr,
            program_commitment,
            market_count: n,
            max_positions,
            max_portfolio_leverage_x100,
            max_hold_bars,
            max_adverse_funding_bps,
            is_swap,
        });
    }

    // ─── Swap notice ─────────────────────────────────────────────────

    /// Announce that this replacement strategy intends to start trading. Identical in intent to
    /// the single-market path: depositors who bought a different strategy get notice and a
    /// window to leave before their money is traded by a new one.
    public entry fun announce_swap(creator: &signer, sv_addr: address) acquires PortfolioVault {
        let pv = borrow_global_mut<PortfolioVault>(sv_addr);
        assert!(signer::address_of(creator) == pv.creator, E_NOT_CREATOR);
        let now = timestamp::now_seconds();
        pv.announced_at = now;
        event::emit(SwapAnnounced {
            strategy_vault: sv_addr,
            creator: pv.creator,
            announced_at: now,
            tradeable_at: now + SWAP_NOTICE_SECS,
        });
    }

    fun assert_may_trade(pv: &PortfolioVault) {
        if (!pv.is_swap) return;
        if (!sealed_vault::has_outside_depositors_friend(pv.decibel_vault_addr, pv.creator)) return;
        assert!(pv.announced_at > 0, E_SWAP_NOT_ANNOUNCED);
        let now = timestamp::now_seconds();
        assert!(now >= pv.announced_at + SWAP_NOTICE_SECS, E_SWAP_NOT_MATURED);
        assert!(now <= pv.announced_at + ANNOUNCE_VALIDITY_SECS, E_ANNOUNCE_EXPIRED);
    }

    // ─── Tick ────────────────────────────────────────────────────────

    /// Process one bar.
    ///
    /// The action vector arrives as four parallel vectors because entry functions cannot take
    /// user-defined structs. They are reassembled into `Action`s and the digest is computed
    /// over the reassembled vector, so the signature covers the same bytes the contract acts on.
    public entry fun tick_attested(
        _cranker: &signer,
        sv_addr: address,
        bar_ts: u64,
        market_idxs: vector<u8>,
        sides: vector<u8>,
        pct_bps_list: vector<u16>,
        leverage_list: vector<u16>,
        signature: vector<u8>,
    ) acquires PortfolioVault, PriceTrace {
        let pv = borrow_global_mut<PortfolioVault>(sv_addr);
        assert!(pv.sealed, E_NOT_SEALED);
        assert!(!pv.paused, E_PAUSED);
        assert_may_trade(pv);

        let now = timestamp::now_seconds();
        assert!(bar_ts <= now + MAX_CLOCK_SKEW_SECS, E_BAR_IN_FUTURE);
        assert!(
            pv.last_bar_ts == 0 || bar_ts >= pv.last_bar_ts + pv.min_bar_interval_s,
            E_BAR_TOO_SOON,
        );

        let actions = build_actions(&market_idxs, &sides, &pct_bps_list, &leverage_list);
        let market_count = vector::length(&pv.markets);
        // Cap the vector before anything else touches it: an oversized vector is a gas bomb
        // the cranker pays for, and it is not a signal a bounded strategy can legitimately
        // produce (one action per market is the most that can ever be meaningful).
        assert!(vector::length(&actions) <= market_count, E_TOO_MANY_ACTIONS);
        validate_actions(pv, &actions);

        let actions_digest = hash::sha3_256(bcs::to_bytes(&actions));

        // 1. Verify against the state the strategy was computed on.
        let prev_digest = pv.input_digest;
        verify_attestation(pv, sv_addr, prev_digest, actions_digest, signature);

        // 2. Price every market on-chain. The attestor supplies no prices at all.
        let prices = vector::empty<u64>();
        let mark_pxs = vector::empty<u64>();
        let i = 0;
        while (i < market_count) {
            let mspec = vector::borrow(&pv.markets, i);
            let mark_px = public_read_api::get_mark_price(mspec.market);
            vector::push_back(&mut mark_pxs, mark_px);
            vector::push_back(&mut prices, mark_px * PRICE_SCALE_PX_TO_1E8);
            i = i + 1;
        };

        // 3. Fold the whole row into the committed trace.
        let new_digest = fold_digest(prev_digest, bar_ts, &prices);
        pv.input_digest = new_digest;
        pv.seq = pv.seq + 1;
        pv.last_bar_ts = bar_ts;
        append_trace(sv_addr, &prices, bar_ts);

        // 4. Contract-enforced maintenance FIRST, before a single signed action is honoured.
        //    Ordering is the guarantee: if the strategy's actions ran first they could re-open
        //    a leg that the hold limit was about to close, and "everything closes eventually"
        //    would quietly become "everything closes unless the strategy objects".
        let orders = close_expired(pv, sv_addr, &mark_pxs, bar_ts);

        // 5. Then the strategy's own instructions.
        orders = orders + apply_actions(pv, sv_addr, &actions, &mark_pxs, &prices, bar_ts);

        event::emit(PortfolioTick {
            strategy_vault: sv_addr,
            program_commitment: pv.program_commitment,
            seq: pv.seq,
            bar_ts,
            prices,
            prev_digest,
            new_digest,
            actions_digest,
            action_count: vector::length(&actions),
            orders_placed: orders,
            open_positions: vector::length(&pv.positions),
        });
    }

    /// Force-close everything a contract rule says must go, with no attestation at all.
    ///
    /// Permissionless on purpose. The eventual-close guarantee is worthless if it depends on
    /// the operator's cranker still running: an attestor that goes dark would otherwise strand
    /// depositor capital in an open leveraged position indefinitely. Anyone — a depositor, a
    /// competitor, a bot — can call this, and it can only ever REDUCE exposure. There is no
    /// path through it that opens a position or moves funds anywhere but back to the vault.
    public entry fun force_close_stale(
        _caller: &signer,
        sv_addr: address,
    ) acquires PortfolioVault {
        let pv = borrow_global_mut<PortfolioVault>(sv_addr);
        assert!(pv.sealed, E_NOT_SEALED);
        let market_count = vector::length(&pv.markets);
        let mark_pxs = vector::empty<u64>();
        let i = 0;
        while (i < market_count) {
            let mspec = vector::borrow(&pv.markets, i);
            vector::push_back(&mut mark_pxs, public_read_api::get_mark_price(mspec.market));
            i = i + 1;
        };
        close_expired(pv, sv_addr, &mark_pxs, timestamp::now_seconds());
    }

    // ─── Action handling ─────────────────────────────────────────────

    fun build_actions(
        market_idxs: &vector<u8>,
        sides: &vector<u8>,
        pct_bps_list: &vector<u16>,
        leverage_list: &vector<u16>,
    ): vector<Action> {
        let n = vector::length(market_idxs);
        assert!(vector::length(sides) == n, E_BAD_SIGNAL);
        assert!(vector::length(pct_bps_list) == n, E_BAD_SIGNAL);
        assert!(vector::length(leverage_list) == n, E_BAD_SIGNAL);
        let out = vector::empty<Action>();
        let i = 0;
        while (i < n) {
            vector::push_back(&mut out, Action {
                market_idx: *vector::borrow(market_idxs, i),
                side: *vector::borrow(sides, i),
                pct_bps: *vector::borrow(pct_bps_list, i),
                leverage_x100: *vector::borrow(leverage_list, i),
            });
            i = i + 1;
        };
        out
    }

    /// Structural validation. Anything wrong here aborts the whole tick rather than skipping
    /// the offending action: a malformed action vector means the attestor is not producing
    /// what the protocol defines, and honouring its other entries for the same bar would be
    /// trusting a signature we have just shown to be describing something else.
    fun validate_actions(pv: &PortfolioVault, actions: &vector<Action>) {
        let market_count = vector::length(&pv.markets);
        let n = vector::length(actions);
        let i = 0;
        while (i < n) {
            let a = vector::borrow(actions, i);
            assert!((a.market_idx as u64) < market_count, E_BAD_MARKET_INDEX);
            assert!(a.side <= SIDE_SHORT, E_BAD_SIGNAL);
            // One action per market per bar. Without this a bar could carry N opens on one
            // book, each individually inside the per-leg cap, and pyramid straight past it.
            let j = 0;
            while (j < i) {
                assert!(vector::borrow(actions, j).market_idx != a.market_idx, E_DUPLICATE_MARKET);
                j = j + 1;
            };
            if (a.side != SIDE_CLOSE) {
                assert!(
                    (a.pct_bps as u64) > 0 && (a.pct_bps as u64) <= pv.max_pct_bps,
                    E_BAD_BPS,
                );
                assert!(
                    (a.leverage_x100 as u64) >= 100
                        && (a.leverage_x100 as u64) <= pv.max_leverage_x100,
                    E_BAD_LEVERAGE,
                );
            };
            i = i + 1;
        };
    }

    /// Close every position the contract's own rules say must go. Returns orders placed.
    ///
    /// Two rules, both frozen at creation and neither optional:
    ///   - held for `max_hold_bars` or more
    ///   - accrued funding cost exceeds `max_adverse_funding_bps` of the leg's notional
    fun close_expired(
        pv: &mut PortfolioVault,
        sv_addr: address,
        mark_pxs: &vector<u64>,
        bar_ts: u64,
    ): u64 {
        let orders = 0;
        let seq = pv.seq;
        let i = 0;
        // Walk backwards so removals do not shift entries we have yet to inspect.
        let n = vector::length(&pv.positions);
        while (i < n) {
            let idx = n - 1 - i;
            let pos = *vector::borrow(&pv.positions, idx);
            let market_idx = (pos.market_idx as u64);
            let mark_px = *vector::borrow(mark_pxs, market_idx);
            let mspec = *vector::borrow(&pv.markets, market_idx);

            let aged = seq >= pos.opened_seq + pv.max_hold_bars;
            let drained = funding_exceeded(pv, &mspec, &pos, mark_px);

            if (aged || drained) {
                let reason = if (aged) { CLOSE_REASON_MAX_HOLD } else { CLOSE_REASON_FUNDING };
                orders = orders + close_leg(pv, sv_addr, &mspec, &pos, mark_px, bar_ts, reason);
                vector::remove(&mut pv.positions, idx);
            };
            i = i + 1;
        };
        orders
    }

    /// True when this leg's accrued funding cost has eaten more than the allowed share of its
    /// own notional.
    ///
    /// The sign convention — negative means the position OWES funding — is documented at the
    /// stub in deps/decibel_perp_dex/sources/position_view_types.move and confirmed against a
    /// live position by `scripts/decibel-funding-canary.ts` before any mainnet publish. A
    /// position the engine reports no view for is treated as not drained rather than as
    /// drained, so a read failure can never cause a spurious close.
    fun funding_exceeded(
        pv: &PortfolioVault,
        mspec: &MarketSpec,
        pos: &OpenPos,
        mark_px: u64,
    ): bool {
        let account = dex_accounts::primary_subaccount_public(pv.decibel_vault_addr);
        let view = public_read_api::view_position(account, mspec.market);
        if (option::is_none(&view)) return false;
        let info = option::destroy_some(view);
        let funding = position_view_types::get_position_info_unrealized_funding_amount_before_last_update(&info);
        if (funding >= 0) return false; // being paid to hold, or flat — never a reason to close
        let owed = ((0 - funding) as u128);

        // Notional in collateral units: size × price / 10^size_decimals.
        let notional = (pos.size as u128) * (mark_px as u128) / mspec.size_decimals_pow;
        if (notional == 0) return false;
        owed * BPS_DENOM > notional * (pv.max_adverse_funding_bps as u128)
    }

    /// Apply the strategy's instructions. Returns orders placed.
    ///
    /// A leg that cannot be opened is SKIPPED with an event, not aborted: one greedy action
    /// must not brick the whole bar for the other markets, and an abort would also roll back
    /// the maintenance closes above.
    fun apply_actions(
        pv: &mut PortfolioVault,
        sv_addr: address,
        actions: &vector<Action>,
        mark_pxs: &vector<u64>,
        prices: &vector<u64>,
        bar_ts: u64,
    ): u64 {
        let orders = 0;
        let n = vector::length(actions);
        let i = 0;
        while (i < n) {
            let a = *vector::borrow(actions, i);
            let market_idx = (a.market_idx as u64);
            let mspec = *vector::borrow(&pv.markets, market_idx);
            let mark_px = *vector::borrow(mark_pxs, market_idx);
            let price = *vector::borrow(prices, market_idx);
            let held = find_position(&pv.positions, a.market_idx);

            if (a.side == SIDE_CLOSE) {
                if (option::is_some(&held)) {
                    let at = option::destroy_some(held);
                    let pos = *vector::borrow(&pv.positions, at);
                    orders = orders + close_leg(
                        pv, sv_addr, &mspec, &pos, mark_px, bar_ts, CLOSE_REASON_STRATEGY,
                    );
                    vector::remove(&mut pv.positions, at);
                };
                i = i + 1;
                continue
            };

            let want_long = a.side == SIDE_LONG;

            if (option::is_some(&held)) {
                let at = option::destroy_some(held);
                let pos = *vector::borrow(&pv.positions, at);
                // Already this way — leave it alone. Re-entering would pyramid past the
                // per-leg cap, which is per-order and cannot see an existing position.
                if (pos.is_long == want_long) {
                    i = i + 1;
                    continue
                };
                orders = orders + close_leg(
                    pv, sv_addr, &mspec, &pos, mark_px, bar_ts, CLOSE_REASON_FLIP,
                );
                vector::remove(&mut pv.positions, at);
            };

            if (vector::length(&pv.positions) >= pv.max_positions) {
                event::emit(PortfolioSkipped {
                    strategy_vault: sv_addr,
                    seq: pv.seq,
                    market_idx: a.market_idx,
                    side: a.side,
                    computed_size: 0,
                    min_size: (mspec.min_size as u64),
                    blocked_by_portfolio_cap: true,
                });
                i = i + 1;
                continue
            };

            let (size, blocked) = resolve_size(pv, &mspec, &a, mark_px, mark_pxs);
            if (size == 0) {
                event::emit(PortfolioSkipped {
                    strategy_vault: sv_addr,
                    seq: pv.seq,
                    market_idx: a.market_idx,
                    side: a.side,
                    computed_size: 0,
                    min_size: (mspec.min_size as u64),
                    blocked_by_portfolio_cap: blocked,
                });
                i = i + 1;
                continue
            };

            let open_px = limit_px(&mspec, mark_px, pv.slippage_bps, want_long);
            let trader = object::generate_signer_for_extending(&pv.extend_ref);
            let subaccount = dex_accounts::primary_subaccount_object_public(pv.decibel_vault_addr);
            place(&trader, subaccount, mspec.market, want_long, size, open_px, false,
                pv.builder_addr, pv.builder_fee_bps);
            event::emit(PortfolioTraded {
                strategy_vault: sv_addr,
                decibel_vault: pv.decibel_vault_addr,
                seq: pv.seq,
                market_idx: a.market_idx,
                is_buy: want_long,
                reduce_only: false,
                size,
                price,
                order_px: open_px,
                reason: CLOSE_REASON_STRATEGY,
                timestamp: bar_ts,
            });

            vector::push_back(&mut pv.positions, OpenPos {
                market_idx: a.market_idx,
                is_long: want_long,
                size,
                opened_seq: pv.seq,
                opened_ts: bar_ts,
                entry_px: mark_px,
            });
            pv.trades = pv.trades + 1;
            orders = orders + 1;
            i = i + 1;
        };
        orders
    }

    /// Place the reduce-only order that flattens a leg. Returns 1 if an order went out.
    ///
    /// Size comes from the ENGINE, not from our own record. A partially-filled IOC open leaves
    /// the two disagreeing, and closing our recorded size when the engine holds less would
    /// place a reduce-only order larger than the position — at best wasted, at worst rejected,
    /// leaving the leg open while our record says it closed.
    fun close_leg(
        pv: &PortfolioVault,
        sv_addr: address,
        mspec: &MarketSpec,
        pos: &OpenPos,
        mark_px: u64,
        bar_ts: u64,
        reason: u8,
    ): u64 {
        let account = dex_accounts::primary_subaccount_public(pv.decibel_vault_addr);
        // The engine reports the NET position on this market for the whole Decibel vault. If
        // another strategy is still delegated to the same vault, its legs net against ours and
        // `live` is smaller than what we opened — closing `live` would be right for the
        // account and wrong for this vault's book, and closing `pos.size` would close through
        // someone else's position. Take the smaller: never close more than the account holds,
        // never more than this vault opened.
        let live = public_read_api::get_position_size(account, mspec.market);
        let size = if (live == 0) { 0 } else if (live < pos.size) { live } else { pos.size };
        if (size == 0) return 0;

        // Dust below the market minimum cannot be closed by a reduce-only order — the engine
        // rejects it with ESIZE_NOT_RESPECTING_MIN_SIZE. Placing it anyway aborts the WHOLE
        // tick, and because `close_expired` runs before anything else, the vault would then be
        // permanently unable to tick, trade, or close: bricked by a rounding remainder. This
        // was reproduced on testnet. Drop the record and report it instead; the position stays
        // on the account, visible, and is closable once it can be netted or topped up.
        if ((size as u128) < mspec.min_size) {
            event::emit(PortfolioSkipped {
                strategy_vault: sv_addr,
                seq: pv.seq,
                market_idx: pos.market_idx,
                side: SIDE_CLOSE,
                computed_size: size,
                min_size: (mspec.min_size as u64),
                blocked_by_portfolio_cap: false,
            });
            return 0
        };

        // A long closes with a sell, so the closing order takes the opposite side and is
        // priced on that side's slippage band.
        let close_px = limit_px(mspec, mark_px, pv.slippage_bps, !pos.is_long);
        let trader = object::generate_signer_for_extending(&pv.extend_ref);
        let subaccount = dex_accounts::primary_subaccount_object_public(pv.decibel_vault_addr);
        place(&trader, subaccount, mspec.market, !pos.is_long, size, close_px, true,
            pv.builder_addr, pv.builder_fee_bps);
        event::emit(PortfolioTraded {
            strategy_vault: sv_addr,
            decibel_vault: pv.decibel_vault_addr,
            seq: pv.seq,
            market_idx: pos.market_idx,
            is_buy: !pos.is_long,
            reduce_only: true,
            size,
            price: mark_px * PRICE_SCALE_PX_TO_1E8,
            order_px: close_px,
            reason,
            timestamp: bar_ts,
        });
        1
    }

    fun find_position(positions: &vector<OpenPos>, market_idx: u8): option::Option<u64> {
        let n = vector::length(positions);
        let i = 0;
        while (i < n) {
            if (vector::borrow(positions, i).market_idx == market_idx) {
                return option::some(i)
            };
            i = i + 1;
        };
        option::none<u64>()
    }

    /// Size for one opening leg, and whether the aggregate cap is what blocked it.
    ///
    /// Three ceilings, applied in order: the action's own share of NAV, the action's own
    /// leverage, and the portfolio's remaining notional budget. The third is the one that
    /// makes multi-position safe — without it, `max_positions` legs each at the per-leg cap
    /// multiply to `max_positions ×` the intended exposure.
    fun resolve_size(
        pv: &PortfolioVault,
        mspec: &MarketSpec,
        a: &Action,
        mark_px_1e6: u64,
        mark_pxs: &vector<u64>,
    ): (u64, bool) {
        let nav = public_read_api::get_account_net_asset_value(
            dex_accounts::primary_subaccount_public(pv.decibel_vault_addr)
        );
        assert!(nav > 0, E_NO_NAV);
        let nav_u = (nav as u128);

        let mark_px = (mark_px_1e6 as u128);
        if (mark_px == 0) return (0, false);

        // Requested notional, then the per-leg leverage ceiling.
        let notional = nav_u * (a.pct_bps as u128) / BPS_DENOM;
        let leg_max = nav_u * (a.leverage_x100 as u128) / 100;
        if (notional > leg_max) notional = leg_max;

        // Remaining portfolio budget. Open legs are valued at the CURRENT mark, not their
        // entry: a position that has moved against the vault consumes more of the budget than
        // it did when opened, which is exactly when new risk should be hardest to add.
        let budget = nav_u * (pv.max_portfolio_leverage_x100 as u128) / 100;
        let used = open_notional(pv, mark_pxs);
        if (used >= budget) return (0, true);
        let remaining = budget - used;
        let capped_by_portfolio = notional > remaining;
        if (capped_by_portfolio) notional = remaining;

        let size = notional * mspec.size_decimals_pow / mark_px;
        // Floor to the lot grid, then reject below the market minimum. Never round UP to the
        // minimum: that would place an order larger than the cap allowed, which is the one
        // direction a size adjustment must never go.
        size = size / mspec.lot_size * mspec.lot_size;
        if (size < mspec.min_size) return (0, capped_by_portfolio);
        ((size as u64), capped_by_portfolio)
    }

    /// Total notional currently open, valued at the current mark.
    fun open_notional(pv: &PortfolioVault, mark_pxs: &vector<u64>): u128 {
        let total = 0u128;
        let n = vector::length(&pv.positions);
        let i = 0;
        while (i < n) {
            let pos = vector::borrow(&pv.positions, i);
            let market_idx = (pos.market_idx as u64);
            let mspec = vector::borrow(&pv.markets, market_idx);
            let mark_px = (*vector::borrow(mark_pxs, market_idx) as u128);
            total = total + (pos.size as u128) * mark_px / mspec.size_decimals_pow;
            i = i + 1;
        };
        total
    }

    /// A marketable limit price on the correct side of mark, rounded onto the engine's own
    /// tick grid by the engine's own helper — a hand-rolled rounder that disagrees by one tick
    /// produces orders the engine rejects, and a rejected order looks exactly like a strategy
    /// that chose not to trade.
    fun limit_px(mspec: &MarketSpec, mark_px: u64, slippage_bps: u64, is_buy: bool): u64 {
        let raw = if (is_buy) {
            (mark_px as u128) * (BPS_DENOM + (slippage_bps as u128)) / BPS_DENOM
        } else {
            (mark_px as u128) * (BPS_DENOM - (slippage_bps as u128)) / BPS_DENOM
        };
        public_read_api::get_market_round_price_to_ticker(mspec.market, (raw as u64), is_buy)
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

    // ─── Attestation ─────────────────────────────────────────────────

    fun verify_attestation(
        pv: &PortfolioVault,
        sv_addr: address,
        prev_digest: vector<u8>,
        actions_digest: vector<u8>,
        signature_bytes: vector<u8>,
    ) {
        let msg = PortfolioAttestation {
            domain: ATTESTATION_DOMAIN,
            chain_id: chain_id::get(),
            strategy_vault: sv_addr,
            program_commitment: pv.program_commitment,
            seq: pv.seq,
            input_digest: prev_digest,
            actions_digest,
        };
        let sig = ed25519::new_signature_from_bytes(signature_bytes);
        let pk = ed25519::new_unvalidated_public_key_from_bytes(pv.attestor_pubkey);
        assert!(
            ed25519::signature_verify_strict(&sig, &pk, bcs::to_bytes(&msg)),
            E_INVALID_SIGNATURE,
        );
    }

    /// digest_n = sha3_256(digest_{n-1} || bcs(bar_ts) || bcs(prices))
    ///
    /// The whole price row, not one market: a multi-market strategy is defined over all of
    /// them, and a digest that committed to only one would not reproduce its inputs.
    fun fold_digest(prev: vector<u8>, bar_ts: u64, prices: &vector<u64>): vector<u8> {
        let buf = prev;
        vector::append(&mut buf, bcs::to_bytes(&bar_ts));
        vector::append(&mut buf, bcs::to_bytes(prices));
        hash::sha3_256(buf)
    }

    fun append_trace(sv_addr: address, prices: &vector<u64>, ts: u64) acquires PriceTrace {
        let trace = borrow_global_mut<PriceTrace>(sv_addr);
        let width = trace.markets_len;
        let i = 0;
        while (i < width) {
            vector::push_back(&mut trace.prices, *vector::borrow(prices, i));
            i = i + 1;
        };
        vector::push_back(&mut trace.timestamps, ts);
        if (vector::length(&trace.timestamps) > trace.capacity) {
            vector::remove(&mut trace.timestamps, 0);
            let j = 0;
            while (j < width) {
                vector::remove(&mut trace.prices, 0);
                j = j + 1;
            };
        };
    }

    // ─── Admin ───────────────────────────────────────────────────────

    /// Pause blocks new ticks. It does NOT flatten open positions, and it does not disable
    /// `force_close_stale` — a paused vault still honours the eventual-close guarantee, which
    /// would be worth nothing if pausing suspended it.
    public entry fun set_paused(creator: &signer, sv_addr: address, paused: bool)
    acquires PortfolioVault {
        let pv = borrow_global_mut<PortfolioVault>(sv_addr);
        assert!(signer::address_of(creator) == pv.creator, E_NOT_CREATOR);
        pv.paused = paused;
    }

    // ─── Views ───────────────────────────────────────────────────────

    #[view]
    /// (commitment, seq, input_digest) — everything the attestor needs to sign the next bar.
    public fun get_attestation_context(
        sv_addr: address,
    ): (vector<u8>, u64, vector<u8>) acquires PortfolioVault {
        let pv = borrow_global<PortfolioVault>(sv_addr);
        (pv.program_commitment, pv.seq, pv.input_digest)
    }

    #[view]
    /// The frozen bounds, so a depositor can read the risk limits without trusting a listing.
    public fun get_bounds(sv_addr: address): (u64, u64, u64, u64, u64, u64, u64) acquires PortfolioVault {
        let pv = borrow_global<PortfolioVault>(sv_addr);
        (
            pv.max_pct_bps,
            pv.max_leverage_x100,
            pv.max_portfolio_leverage_x100,
            pv.max_positions,
            pv.max_hold_bars,
            pv.max_adverse_funding_bps,
            vector::length(&pv.markets),
        )
    }

    #[view]
    /// The market allowlist, in index order. Action `market_idx` refers to this.
    public fun get_markets(sv_addr: address): vector<address> acquires PortfolioVault {
        let pv = borrow_global<PortfolioVault>(sv_addr);
        let out = vector::empty<address>();
        let n = vector::length(&pv.markets);
        let i = 0;
        while (i < n) {
            vector::push_back(&mut out, object::object_address(&vector::borrow(&pv.markets, i).market));
            i = i + 1;
        };
        out
    }

    #[view]
    /// Open legs as parallel vectors: (market_idx, is_long, size, opened_seq, bars_held).
    /// `bars_held` is what the eventual-close rule is measured against, so it is returned
    /// rather than left for a caller to recompute and get wrong.
    public fun get_positions(
        sv_addr: address,
    ): (vector<u8>, vector<bool>, vector<u64>, vector<u64>, vector<u64>) acquires PortfolioVault {
        let pv = borrow_global<PortfolioVault>(sv_addr);
        let idxs = vector::empty<u8>();
        let longs = vector::empty<bool>();
        let sizes = vector::empty<u64>();
        let opened = vector::empty<u64>();
        let held = vector::empty<u64>();
        let n = vector::length(&pv.positions);
        let i = 0;
        while (i < n) {
            let p = vector::borrow(&pv.positions, i);
            vector::push_back(&mut idxs, p.market_idx);
            vector::push_back(&mut longs, p.is_long);
            vector::push_back(&mut sizes, p.size);
            vector::push_back(&mut opened, p.opened_seq);
            vector::push_back(&mut held, pv.seq - p.opened_seq);
            i = i + 1;
        };
        (idxs, longs, sizes, opened, held)
    }

    #[view]
    /// (seq, trades, open_positions, paused, sealed).
    public fun get_state(sv_addr: address): (u64, u64, u64, bool, bool) acquires PortfolioVault {
        let pv = borrow_global<PortfolioVault>(sv_addr);
        (pv.seq, pv.trades, vector::length(&pv.positions), pv.paused, pv.sealed)
    }

    #[view]
    /// The committed trace: (flattened prices, timestamps, markets per row).
    public fun get_trace(sv_addr: address): (vector<u64>, vector<u64>, u64) acquires PriceTrace {
        let t = borrow_global<PriceTrace>(sv_addr);
        (t.prices, t.timestamps, t.markets_len)
    }

    #[view]
    /// Whether the swap notice permits trading yet: (is_swap, announced_at, tradeable_at, now).
    public fun swap_status(sv_addr: address): (bool, u64, u64, u64) acquires PortfolioVault {
        let pv = borrow_global<PortfolioVault>(sv_addr);
        (pv.is_swap, pv.announced_at, pv.announced_at + SWAP_NOTICE_SECS, timestamp::now_seconds())
    }
    // ─── Test-only accessors ─────────────────────────────────────────
    //
    // These exist so the cross-language BCS check can run inside the VM against the SAME
    // struct definitions the production path uses. Reimplementing the layout in the test file
    // would test the test.

    #[test_only]
    public fun attestation_message_for_test(
        sv_addr: address,
        program_commitment: vector<u8>,
        seq: u64,
        input_digest: vector<u8>,
        actions_digest: vector<u8>,
        cid: u8,
    ): vector<u8> {
        bcs::to_bytes(&PortfolioAttestation {
            domain: ATTESTATION_DOMAIN,
            chain_id: cid,
            strategy_vault: sv_addr,
            program_commitment,
            seq,
            input_digest,
            actions_digest,
        })
    }

    #[test_only]
    /// sha3_256(bcs(vector<Action>)) built from the same parallel-vector form the entry
    /// function takes, so the digest under test is the one the entry path computes.
    public fun actions_digest_for_test(
        market_idxs: vector<u8>,
        sides: vector<u8>,
        pct_bps_list: vector<u16>,
        leverage_list: vector<u16>,
    ): vector<u8> {
        let actions = build_actions(&market_idxs, &sides, &pct_bps_list, &leverage_list);
        hash::sha3_256(bcs::to_bytes(&actions))
    }

    #[test_only]
    /// The digest a freshly created vault starts at.
    public fun genesis_digest_for_test(): vector<u8> {
        hash::sha3_256(ATTESTATION_DOMAIN)
    }

    #[test_only]
    public fun fold_digest_for_test(
        prev: vector<u8>,
        bar_ts: u64,
        prices: vector<u64>,
    ): vector<u8> {
        fold_digest(prev, bar_ts, &prices)
    }

}
