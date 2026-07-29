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

    use decibel::dex_accounts::{Self, Subaccount};
    use decibel::perp_engine;
    use decibel::perp_market::PerpMarket;
    use decibel::perp_order;
    use order_book::order_book_types;

    // ─── Errors ──────────────────────────────────────────────────────
    const E_NOT_CREATOR:        u64 = 1;
    const E_PAUSED:             u64 = 2;
    const E_BAD_BPS:            u64 = 3;
    const E_NO_NAV:             u64 = 4;
    const E_ALREADY_SEALED:     u64 = 5;
    const E_NOT_SEALED:         u64 = 6;
    const E_BAD_PUBKEY:         u64 = 7;
    const E_BAD_COMMITMENT:     u64 = 8;
    const E_INVALID_SIGNATURE:  u64 = 9;
    const E_BAD_SIGNAL:         u64 = 10;
    const E_BAR_TOO_SOON:       u64 = 11;
    const E_BAR_IN_FUTURE:      u64 = 12;
    const E_BAD_MARKET_PARAMS:  u64 = 13;
    const E_BAD_LEVERAGE:       u64 = 14;

    // ─── Constants ───────────────────────────────────────────────────
    /// Domain separator — prevents an attestation being replayed against any other protocol,
    /// module version, or message type that happens to share a field layout.
    const ATTESTATION_DOMAIN: vector<u8> = b"cash.trading/sealed-vault/v1";

    /// Mark price is in px decimals (1e6); the committed trace is 1e8-scaled.
    const PRICE_SCALE_PX_TO_1E8: u64 = 100;
    const BPS_DENOM: u128 = 10000;

    /// Reject bars dated more than this far ahead of chain time.
    const MAX_CLOCK_SKEW_SECS: u64 = 60;

    const SIGNAL_NEUTRAL: u8 = 0;
    const SIGNAL_BUY:     u8 = 1;
    const SIGNAL_SELL:    u8 = 2;

    // ─── Storage ─────────────────────────────────────────────────────

    /// The sealed strategy binding. Lives on its own Object; the Object address is the
    /// delegated trader the Decibel vault must authorize.
    struct SealedVault has key {
        creator: address,

        // ── Commitment (frozen by seal()) ──
        /// sha3_256(canonical_pine || 0x00 || emitted_move || 0x00 || manifest_json).
        /// See docs/SEALED-INDICATOR.md §3.1 — same formula as docs/SHELBY-PIN.md.
        program_commitment: vector<u8>,
        /// ed25519 public key of the attestor that runs the committed program.
        attestor_pubkey: vector<u8>,
        /// Optional TEE measurement (PCR set) bound in at seal time. Empty in tier 1.
        enclave_measurement: vector<u8>,

        // ── Bindings (frozen by seal()) ──
        decibel_vault_addr: address,
        market: Object<PerpMarket>,
        /// 10^size_decimals for this market — passed in, not hardcoded.
        size_decimals_pow: u128,
        /// Engine lot size for this market. Orders floor to a multiple of this.
        lot_size: u128,
        /// Engine minimum order size for this market.
        min_size: u128,

        // ── Rules (frozen by seal()) ──
        /// Per-order notional as a percent of NAV, in bps. 1..=10000.
        pct_bps: u64,
        /// Hard cap on notional / NAV, ×100 (250 = 2.5x). Independent of pct_bps because
        /// a flip transiently places close+open.
        max_leverage_x100: u64,
        /// Minimum seconds between accepted bars — bounds attestor discretion over timing.
        min_bar_interval_s: u64,

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
        /// One-way. Until sealed the vault cannot trade; after sealing, config is immutable.
        sealed: bool,
        trades: u64,

        /// Mints the delegated-trader signer. Private to this module — no human holds it.
        extend_ref: ExtendRef,
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
        price: u64,
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

    // ─── Creation ────────────────────────────────────────────────────

    /// Create an unsealed vault. Config stays mutable until `seal()`; trading is impossible
    /// until then. The returned Object address is what the Decibel vault admin delegates to.
    public entry fun create_sealed_vault(
        creator: &signer,
        program_commitment: vector<u8>,
        attestor_pubkey: vector<u8>,
        decibel_vault_addr: address,
        market: Object<PerpMarket>,
        size_decimals_pow: u128,
        lot_size: u128,
        min_size: u128,
        pct_bps: u64,
        max_leverage_x100: u64,
        min_bar_interval_s: u64,
        trace_capacity: u64,
    ) {
        assert!(vector::length(&program_commitment) == 32, E_BAD_COMMITMENT);
        assert!(vector::length(&attestor_pubkey) == 32, E_BAD_PUBKEY);
        assert!(pct_bps > 0 && pct_bps <= 10000, E_BAD_BPS);
        assert!(max_leverage_x100 > 0, E_BAD_LEVERAGE);
        assert!(size_decimals_pow > 0 && lot_size > 0 && min_size > 0, E_BAD_MARKET_PARAMS);
        assert!(trace_capacity > 0, E_BAD_MARKET_PARAMS);

        let creator_addr = signer::address_of(creator);
        let ctor = object::create_object(creator_addr);
        let obj_signer = object::generate_signer(&ctor);
        let extend_ref = object::generate_extend_ref(&ctor);
        let sv_addr = signer::address_of(&obj_signer);

        move_to(&obj_signer, SealedVault {
            creator: creator_addr,
            program_commitment,
            attestor_pubkey,
            enclave_measurement: vector::empty<u8>(),
            decibel_vault_addr,
            market,
            size_decimals_pow,
            lot_size,
            min_size,
            pct_bps,
            max_leverage_x100,
            min_bar_interval_s,
            // Genesis digest: sha3_256 of the domain, so two vaults never share a starting state.
            input_digest: hash::sha3_256(ATTESTATION_DOMAIN),
            seq: 0,
            last_bar_ts: 0,
            last_signal: SIGNAL_NEUTRAL,
            is_long: false,
            in_position: false,
            paused: false,
            sealed: false,
            trades: 0,
            extend_ref,
        });

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
    }

    /// One-way seal. Freezes the commitment, the attestor key, the market binding and every
    /// rule. After this the vault can trade and nothing about its configuration can change.
    /// The deploy rail should call this as the final launch step, so "launched" == "sealed".
    public entry fun seal(
        creator: &signer,
        sv_addr: address,
        enclave_measurement: vector<u8>,
    ) acquires SealedVault {
        let sv = borrow_global_mut<SealedVault>(sv_addr);
        assert!(signer::address_of(creator) == sv.creator, E_NOT_CREATOR);
        assert!(!sv.sealed, E_ALREADY_SEALED);
        sv.enclave_measurement = enclave_measurement;
        sv.sealed = true;
        event::emit(StrategySealed {
            strategy_vault: sv_addr,
            program_commitment: sv.program_commitment,
            enclave_measurement,
            sealed_at: timestamp::now_seconds(),
        });
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
        let mark_px = perp_engine::get_mark_price(sv.market);
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
            traded = execute_flip(sv, sv_addr, signal, price, bar_ts);
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

        let size = resolve_size(sv, price);
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
        let subaccount = dex_accounts::primary_subaccount_object(sv.decibel_vault_addr);

        if (sv.in_position && sv.is_long != want_long) {
            place(&trader, subaccount, sv.market, !sv.is_long, size, price, true);
            event::emit(VaultTraded {
                strategy_vault: sv_addr,
                decibel_vault: sv.decibel_vault_addr,
                seq: sv.seq,
                signal,
                is_buy: !sv.is_long,
                reduce_only: true,
                size,
                price,
                timestamp: bar_ts,
            });
        };

        place(&trader, subaccount, sv.market, want_long, size, price, false);
        event::emit(VaultTraded {
            strategy_vault: sv_addr,
            decibel_vault: sv.decibel_vault_addr,
            seq: sv.seq,
            signal,
            is_buy: want_long,
            reduce_only: false,
            size,
            price,
            timestamp: bar_ts,
        });

        sv.in_position = true;
        sv.is_long = want_long;
        sv.trades = sv.trades + 1;
        true
    }

    /// Size = NAV × pct_bps, capped by max_leverage, floored to the lot.
    /// Returns 0 (skip the trade) when the result is below the market minimum — never clamps
    /// up, because clamping up breaches the NAV cap on small vaults.
    fun resolve_size(sv: &SealedVault, price_1e8: u64): u64 {
        let nav = perp_engine::get_account_net_asset_value(
            dex_accounts::primary_subaccount(sv.decibel_vault_addr)
        );
        assert!(nav > 0, E_NO_NAV);

        let mark_px = ((price_1e8 / PRICE_SCALE_PX_TO_1E8) as u128);
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
            option::none(),
        );
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

    /// Pre-seal only. After sealing, sizing is immutable.
    public entry fun set_sizing(
        creator: &signer,
        sv_addr: address,
        pct_bps: u64,
        max_leverage_x100: u64,
    ) acquires SealedVault {
        assert!(pct_bps > 0 && pct_bps <= 10000, E_BAD_BPS);
        assert!(max_leverage_x100 > 0, E_BAD_LEVERAGE);
        let sv = borrow_global_mut<SealedVault>(sv_addr);
        assert!(signer::address_of(creator) == sv.creator, E_NOT_CREATOR);
        assert!(!sv.sealed, E_ALREADY_SEALED);
        sv.pct_bps = pct_bps;
        sv.max_leverage_x100 = max_leverage_x100;
    }

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
