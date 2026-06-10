/// Indicator Factory — Object-pattern on-chain indicator registry
///
/// Architecture (v2 — Factory):
///   - FactoryState at @cash_strategy: registry of all indicator Object addresses
///   - create_indicator() deploys an Aptos Object per indicator (unique address, scalable)
///   - All resources (IndicatorState, PriceBuffer, TradeLog) stored ON the Object
///   - push_price() accepts the Object address — any keeper can target any indicator
///   - Public get_signal() / get_ta_state() for DEX/perp integration
///
/// DEX/perp integration pattern:
///   use cash_strategy::indicator;
///   let signal = indicator::get_signal(my_indicator_obj_addr);
///   if (signal == 1) { /* BUY */ } else if (signal == 2) { /* SELL */ }
///
/// Indicator types:
///   0 = SMA crossover:        short=fast, long=slow
///   1 = EMA crossover:        short=fast, long=slow
///   2 = RSI:                  short=rsi_period, long ignored
///   3 = MACD:                 short=fast(12), long=slow(26), third_period=signal(9 default)
///   4 = Bollinger Bands:      short=period(20), third_period=multiplier*10 (20=2.0x default)
///   5 = Stochastic Oscillator: short=%K period(14), long=%D period(3)
///   6 = SuperTrend:           short=ATR period(10), long=multiplier*10(30=3.0x)
///   7 = Donchian Channels:    short=channel period(20), long unused
module cash_strategy::indicator {
    use std::string::String;
    use std::vector;
    use std::signer;
    use aptos_framework::event;
    use aptos_framework::object;
    use aptos_framework::timestamp;
    use aptos_std::table::{Self, Table};
    use cash_strategy::math_lib;

    // ─── Error Codes ─────────────────────────────────────────────────
    const E_NOT_KEEPER:        u64 = 1;
    const E_NOT_OWNER:         u64 = 2;
    const E_INSUFFICIENT_DATA: u64 = 3;
    const E_INVALID_PARAMS:    u64 = 4;
    const E_ALREADY_EXISTS:    u64 = 5;
    const E_NOT_FACTORY:       u64 = 6;

    // ─── Indicator Type Constants ─────────────────────────────────────
    const TYPE_SMA:        u8 = 0;
    const TYPE_EMA:        u8 = 1;
    const TYPE_RSI:        u8 = 2;
    const TYPE_MACD:       u8 = 3;
    const TYPE_BB:         u8 = 4;
    const TYPE_STOCH:      u8 = 5;
    const TYPE_SUPERTREND: u8 = 6;
    const TYPE_DONCHIAN:   u8 = 7;
    const TYPE_KAMA:       u8 = 8;  // Kaufman Adaptive MA
    const TYPE_ALMA:       u8 = 9;  // Arnaud Legoux MA
    const TYPE_T3:         u8 = 10; // Triple Exponential MA
    const TYPE_LAGUERRE:   u8 = 11; // Laguerre RSI

    // ─── Signal Constants ─────────────────────────────────────────────
    const SIGNAL_NEUTRAL: u8 = 0;
    const SIGNAL_BUY:     u8 = 1;
    const SIGNAL_SELL:    u8 = 2;

    // MACD line can be negative — encode as: macd_shifted = macd + MACD_OFFSET
    // MACD_OFFSET is large enough that shifted value is always positive.
    const MACD_OFFSET: u64 = 100_000_000_000_000; // 1e14

    // Stochastic thresholds: 20% and 80% in 1e8 fixed-point
    const STOCH_OVERSOLD:   u64 = 20_00000000; // 20.0 * 1e8
    const STOCH_OVERBOUGHT: u64 = 80_00000000; // 80.0 * 1e8
    const STOCH_NEUTRAL:    u64 = 50_00000000; // 50.0 * 1e8

    // SuperTrend direction constants stored in third_value
    const SUPERTREND_NEUTRAL: u64 = 0;
    const SUPERTREND_UP:      u64 = 1;
    const SUPERTREND_DOWN:    u64 = 2;

    // ─── Factory Registry ─────────────────────────────────────────────

    /// Deployed at @cash_strategy. Tracks all indicator Object addresses.
    struct FactoryState has key {
        indicators: vector<address>,
        count: u64,
    }

    /// Deployed at @cash_strategy. Stores ProprietaryConfig per indicator Object address.
    /// Using a Table lets us attach config to existing indicators without modifying IndicatorState.
    struct ProprietaryRegistry has key {
        configs: Table<address, ProprietaryConfig>,
    }

    // ─── Per-Indicator Resources (stored ON the Object) ───────────────

    /// Marker type — identifies an Aptos Object as an indicator.
    struct IndicatorMarker has key {}

    /// Core state: immutable config + mutable TA values.
    /// Consolidated into one struct (no IndicatorExtended needed on fresh deploy).
    struct IndicatorState has key {
        // ── Config (set at creation, immutable) ──
        owner:          address,
        name:           String,
        symbol:         String,
        asset:          String,       // "BTC/USD", "ETH/USD", etc.
        indicator_type: u8,
        short_period:   u64,          // fast SMA/EMA, RSI period, MACD fast, Stoch %K, ATR period, Donchian period
        long_period:    u64,          // slow SMA/EMA, MACD slow, Stoch %D, SuperTrend multiplier*10
        third_period:   u64,          // MACD: signal EMA period | BB: mult*10 | others: 0
        keeper:         address,
        created_at:     u64,

        // ── Mutable TA values ──
        fast_line:            u64,    // last computed fast indicator value
        slow_line:            u64,    // last computed slow indicator value
        last_price:           u64,    // last price pushed (USD * 1e8)
        third_value:          u64,    // MACD: running signal EMA (shifted) | SuperTrend: direction (0/1/2)
        last_signal:          u8,
        last_signal_time:     u64,
        total_signals:        u64,
        total_prices_pushed:  u64,

        // ── Position tracking ──
        in_position:       bool,
        entry_price:       u64,
        realized_gain_bps: u64,
        realized_loss_bps: u64,

        // ── Graduation ──
        is_graduated: bool,
        vault_addr:   address,
    }

    /// Proprietary indicator configuration. Stored in ProprietaryRegistry (a factory-level Table)
    /// keyed by indicator_addr, so it can be added post-deployment without modifying IndicatorState.
    struct ProprietaryConfig has store {
        is_proprietary:        bool,       // true once set_proprietary() is called
        algo_hash:             vector<u8>, // SHA3-256 of Pine Script (commitment scheme)
        commit_ts:             u64,        // unix seconds of hash commitment
        creator_fee_bps:       u64,        // 0–1000 (max 10%)
        creator_fee_model:     u8,         // 0=none, 1=flat_per_trade, 2=profit_share
        creator_earnings_usdt: u64,        // accumulated USDT fees in 1e6 scale
    }

    /// Sliding price window. Stored separately to allow large buffers
    /// without bloating IndicatorState reads.
    struct PriceBuffer has key {
        prices:     vector<u64>,  // closing prices (USD * 1e8, Pyth format)
        timestamps: vector<u64>,  // unix seconds
        capacity:   u64,
    }

    struct TradeRecord has store, drop {
        trade_id:  u64,
        signal:    u8,
        price:     u64,
        fast_line: u64,
        slow_line: u64,
        gain_bps:  u64,
        loss_bps:  u64,
        timestamp: u64,
    }

    /// On-chain trade attribution. Keep last 200 trades.
    struct TradeLog has key {
        trades:          vector<TradeRecord>,
        next_id:         u64,
        total_gain_bps:  u64,
        total_loss_bps:  u64,
        win_trades:      u64,
        loss_trades:     u64,
    }

    // ─── Events ──────────────────────────────────────────────────────

    /// Emitted by create_indicator. indicator_addr is the Object address —
    /// frontend reads this from the tx to get the indicator's on-chain address.
    #[event]
    struct IndicatorCreated has drop, store {
        indicator_addr: address,  // Object address — unique per indicator
        creator:        address,
        name:           String,
        symbol:         String,
        asset:          String,
        indicator_type: u8,
        short_period:   u64,
        long_period:    u64,
    }

    #[event]
    struct SignalEvent has drop, store {
        indicator_addr: address,
        signal:         u8,
        price:          u64,
        fast_line:      u64,
        slow_line:      u64,
        asset:          String,
        timestamp:      u64,
    }

    #[event]
    struct PricePushed has drop, store {
        indicator_addr:  address,
        price:           u64,
        fast_line:       u64,
        slow_line:       u64,
        signal:          u8,
        prices_buffered: u64,
        timestamp:       u64,
    }

    #[event]
    struct TradeExecuted has drop, store {
        indicator_addr: address,
        trade_id:       u64,
        signal:         u8,
        price:          u64,
        fast_line:      u64,
        slow_line:      u64,
        gain_bps:       u64,
        loss_bps:       u64,
        timestamp:      u64,
    }

    #[event]
    struct GraduatedEvent has drop, store {
        indicator_addr: address,
        vault_addr:     address,
        timestamp:      u64,
    }

    #[event]
    struct CreatorEarningsEvent has drop, store {
        indicator_addr:   address,
        profit_usdt_e6:   u64,
        fee_collected_e6: u64,
        total_earnings_e6: u64,
    }

    #[event]
    struct CreatorClaimedEvent has drop, store {
        indicator_addr: address,
        creator:        address,
        amount_e6:      u64,
    }

    // ─── Module Init ─────────────────────────────────────────────────

    /// Called automatically on first publish.
    fun init_module(deployer: &signer) {
        move_to(deployer, FactoryState {
            indicators: vector::empty<address>(),
            count: 0,
        });
        move_to(deployer, ProprietaryRegistry {
            configs: table::new(),
        });
    }

    /// Idempotent bootstrap — call after an upgrade if FactoryState
    /// wasn't created by init_module (i.e., upgrading from v1).
    public entry fun initialize_factory(deployer: &signer) {
        assert!(signer::address_of(deployer) == @cash_strategy, E_NOT_FACTORY);
        if (!exists<FactoryState>(@cash_strategy)) {
            move_to(deployer, FactoryState {
                indicators: vector::empty<address>(),
                count: 0,
            });
        };
        if (!exists<ProprietaryRegistry>(@cash_strategy)) {
            move_to(deployer, ProprietaryRegistry {
                configs: table::new(),
            });
        };
    }

    // ─── Create Indicator ─────────────────────────────────────────────

    /// Deploy a new indicator. Creates an Aptos Object with its own unique
    /// address — can be called repeatedly to create as many indicators as needed.
    ///
    /// Emits IndicatorCreated { indicator_addr } — frontend reads this event
    /// to get the Object address that represents the indicator on-chain.
    ///
    /// third_period encoding (pass 0 to use defaults):
    ///   MACD: signal EMA period (default 9)
    ///   BB:   multiplier * 10 (default 20 = 2.0x standard deviation)
    ///   SMA/EMA/RSI/Stoch/SuperTrend/Donchian: ignored
    public entry fun create_indicator(
        creator: &signer,
        name: String,
        symbol: String,
        asset: String,
        indicator_type: u8,
        short_period: u64,
        long_period: u64,
        keeper: address,
    ) acquires FactoryState {
        assert!(indicator_type <= TYPE_LAGUERRE, E_INVALID_PARAMS);
        assert!(short_period > 0, E_INVALID_PARAMS);

        let creator_addr = signer::address_of(creator);

        // Default third_period per type
        let third_period: u64 = if (indicator_type == TYPE_MACD) { 9 }
                                else if (indicator_type == TYPE_BB) { 20 }
                                else { 0 };

        // Compute effective long_period: types that only use short_period collapse long to short
        let effective_long = if (indicator_type == TYPE_RSI || indicator_type == TYPE_BB || indicator_type == TYPE_DONCHIAN) {
            short_period
        } else if (indicator_type == TYPE_STOCH) {
            // long_period = %D period; default 3 if caller passes 0
            if (long_period == 0) { 3 } else { long_period }
        } else if (indicator_type == TYPE_SUPERTREND) {
            // long_period = multiplier * 10; default 30 (= 3.0x) if caller passes 0
            if (long_period == 0) { 30 } else { long_period }
        } else if (indicator_type == TYPE_KAMA) {
            // long_period = slow EMA period; default 30 if caller passes 0
            if (long_period == 0) { 30 } else { long_period }
        } else if (indicator_type == TYPE_ALMA) {
            // long_period = offset * 100 (e.g. 85 = 0.85); default 85 if caller passes 0
            if (long_period == 0) { 85 } else { long_period }
        } else if (indicator_type == TYPE_T3) {
            // long_period = vFactor * 10 (e.g. 7 = 0.7); default 7 if caller passes 0
            if (long_period == 0) { 7 } else { long_period }
        } else if (indicator_type == TYPE_LAGUERRE) {
            // long_period unused for Laguerre (only short_period = gamma*10 used)
            short_period
        } else {
            long_period
        };

        // Buffer capacity: needs to hold enough prices for warmup
        let capacity = if (indicator_type == TYPE_MACD) {
            effective_long + third_period + 5
        } else if (indicator_type == TYPE_STOCH) {
            // Need short_period (K window) + long_period (D SMA of K values) + padding
            short_period + effective_long + 5
        } else if (indicator_type == TYPE_T3) {
            // T3 needs period * 6 warmup (6 chained EMAs)
            short_period * 6 + 5
        } else {
            effective_long + 5
        };

        // ── Create Object — each indicator gets its own on-chain address ──
        let constructor_ref  = object::create_object(creator_addr);
        let obj_signer       = object::generate_signer(&constructor_ref);
        let indicator_addr   = object::address_from_constructor_ref(&constructor_ref);

        // ── Move all resources onto the Object ──
        move_to(&obj_signer, IndicatorMarker {});
        move_to(&obj_signer, IndicatorState {
            owner:               creator_addr,
            name,
            symbol,
            asset,
            indicator_type,
            short_period,
            long_period:         effective_long,
            third_period,
            keeper,
            created_at:          timestamp::now_seconds(),
            fast_line:           0,
            slow_line:           0,
            last_price:          0,
            third_value:         0,
            last_signal:         SIGNAL_NEUTRAL,
            last_signal_time:    0,
            total_signals:       0,
            total_prices_pushed: 0,
            in_position:         false,
            entry_price:         0,
            realized_gain_bps:   0,
            realized_loss_bps:   0,
            is_graduated:        false,
            vault_addr:          @0x0,
        });
        move_to(&obj_signer, PriceBuffer {
            prices:     vector::empty<u64>(),
            timestamps: vector::empty<u64>(),
            capacity,
        });
        move_to(&obj_signer, TradeLog {
            trades:         vector::empty<TradeRecord>(),
            next_id:        0,
            total_gain_bps: 0,
            total_loss_bps: 0,
            win_trades:     0,
            loss_trades:    0,
        });

        // ── Register in factory ──
        let factory = borrow_global_mut<FactoryState>(@cash_strategy);
        vector::push_back(&mut factory.indicators, indicator_addr);
        factory.count = factory.count + 1;

        event::emit(IndicatorCreated {
            indicator_addr,
            creator: creator_addr,
            name,
            symbol,
            asset,
            indicator_type,
            short_period,
            long_period: effective_long,
        });
    }

    // ─── Push Price (Keeper Entry) ────────────────────────────────────

    /// Keeper calls this each candle close with the latest Pyth price.
    /// price: USD * 1e8  |  ts: Unix seconds
    ///
    /// 1. Appends to sliding window buffer
    /// 2. Computes SMA/EMA/RSI/MACD/BB/Stoch/SuperTrend/Donchian
    /// 3. Detects crossover → emits SignalEvent + TradeExecuted on transition
    /// 4. Records trade attribution on-chain
    public entry fun push_price(
        keeper_signer: &signer,
        indicator_addr: address,
        price: u64,
        ts: u64,
    ) acquires IndicatorState, PriceBuffer, TradeLog {
        // Borrow all resources up-front (Move VM quirk: never use exists<T>
        // while another resource at the same address is mutably borrowed).
        let log   = borrow_global_mut<TradeLog>(indicator_addr);
        let state = borrow_global_mut<IndicatorState>(indicator_addr);
        let buf   = borrow_global_mut<PriceBuffer>(indicator_addr);

        let keeper_addr = signer::address_of(keeper_signer);
        assert!(keeper_addr == state.keeper || keeper_addr == state.owner, E_NOT_KEEPER);

        // ── Sliding window ──
        if (vector::length(&buf.prices) >= buf.capacity) {
            vector::remove(&mut buf.prices, 0);
            vector::remove(&mut buf.timestamps, 0);
        };
        vector::push_back(&mut buf.prices, price);
        vector::push_back(&mut buf.timestamps, ts);

        state.last_price          = price;
        state.total_prices_pushed = state.total_prices_pushed + 1;

        let buf_len    = vector::length(&buf.prices);
        let fast_val: u64 = 0;
        let slow_val: u64 = 0;
        let has_signal     = false;

        // ── Compute indicator ──
        if (state.indicator_type == TYPE_SMA || state.indicator_type == TYPE_EMA) {
            if (buf_len >= state.long_period) {
                if (state.indicator_type == TYPE_SMA) {
                    fast_val = compute_sma(&buf.prices, state.short_period);
                    slow_val = compute_sma(&buf.prices, state.long_period);
                } else {
                    fast_val = compute_ema(&buf.prices, state.short_period);
                    slow_val = compute_ema(&buf.prices, state.long_period);
                };
                has_signal = true;
            };

        } else if (state.indicator_type == TYPE_RSI) {
            if (buf_len > state.short_period) {
                fast_val   = compute_rsi(&buf.prices, state.short_period);
                slow_val   = 70_00000000; // display threshold
                has_signal = true;
            };

        } else if (state.indicator_type == TYPE_MACD) {
            let warmup = state.long_period + state.third_period;
            if (buf_len >= warmup) {
                let fast_ema = compute_ema(&buf.prices, state.short_period);
                let slow_ema = compute_ema(&buf.prices, state.long_period);

                let macd_shifted: u64 = if (fast_ema >= slow_ema) {
                    MACD_OFFSET + (fast_ema - slow_ema)
                } else {
                    let diff = slow_ema - fast_ema;
                    if (diff >= MACD_OFFSET) { 1 } else { MACD_OFFSET - diff }
                };

                let k_scaled: u128 = 2_000_000 / ((state.third_period + 1) as u128);
                let k_inv:    u128 = 1_000_000 - k_scaled;
                let signal_shifted: u64 = if (state.third_value == 0) {
                    macd_shifted
                } else {
                    let updated = ((macd_shifted as u128) * k_scaled
                                + (state.third_value as u128) * k_inv) / 1_000_000;
                    (updated as u64)
                };

                state.third_value = signal_shifted;
                fast_val   = macd_shifted;
                slow_val   = signal_shifted;
                has_signal = true;
            };

        } else if (state.indicator_type == TYPE_BB) {
            if (buf_len >= state.short_period) {
                let mid = compute_sma(&buf.prices, state.short_period);
                let (upper, lower) = compute_bollinger_bands(
                    &buf.prices, state.short_period, mid, state.third_period
                );
                fast_val   = upper;
                slow_val   = lower;
                has_signal = true;
            };

        } else if (state.indicator_type == TYPE_STOCH) {
            // Need at least short_period prices for %K, plus long_period more K-values for %D SMA.
            // We keep a rolling buffer of size short_period + long_period + padding, so once
            // buf_len >= short_period + long_period we have enough historical %K samples.
            let stoch_warmup = state.short_period + state.long_period;
            if (buf_len >= stoch_warmup) {
                // Compute %K series: for each of the last long_period candles compute %K
                // so we can SMA them into %D. We need (long_period - 1) additional lookback.
                let d_period = state.long_period;
                let k_period = state.short_period;

                // Collect last d_period %K values (newest last)
                let k_values: vector<u64> = vector::empty<u64>();
                let d_idx = 0u64;
                while (d_idx < d_period) {
                    // Offset from the end of buf: newest K is at offset 0, oldest at offset d_period-1
                    // For K at offset d_idx from end: window is [buf_len - k_period - d_idx .. buf_len - d_idx)
                    let window_end   = buf_len - d_idx;
                    let window_start = window_end - k_period;
                    let hh = compute_highest_window(&buf.prices, window_start, window_end);
                    let ll = compute_lowest_window(&buf.prices, window_start, window_end);
                    let close_here = *vector::borrow(&buf.prices, window_end - 1);
                    let k_val: u64 = if (hh == ll) {
                        STOCH_NEUTRAL
                    } else {
                        // %K = (close - lowest) / (highest - lowest) * 100
                        // Scale: result in 1e8 units (100% = 100_00000000)
                        let num: u128 = ((close_here - ll) as u128) * 100_00000000u128;
                        let den: u128 = (hh - ll) as u128;
                        (num / den) as u64
                    };
                    vector::push_back(&mut k_values, k_val);
                    d_idx = d_idx + 1;
                };

                // fast_val = %K (most recent, at index 0 in k_values which is newest)
                fast_val = *vector::borrow(&k_values, 0);

                // slow_val = %D = SMA of the d_period %K values
                let k_sum: u128 = 0;
                let ki = 0u64;
                while (ki < d_period) {
                    k_sum = k_sum + (*vector::borrow(&k_values, ki) as u128);
                    ki = ki + 1;
                };
                slow_val = (k_sum / (d_period as u128)) as u64;

                has_signal = true;
            };

        } else if (state.indicator_type == TYPE_SUPERTREND) {
            // SuperTrend needs at least short_period + 1 prices (ATR warmup)
            if (buf_len >= state.short_period + 1) {
                let atr_period = state.short_period;
                // multiplier = long_period / 10  (e.g. long_period=30 → multiplier=3.0)
                let multiplier_x10 = state.long_period; // kept as integer, divide by 10 in arithmetic

                // Compute ATR using Wilder's smoothing.
                // TR approximation (close-only): TR = abs(close - prevClose) * 2
                // Seed ATR with SMA of first atr_period TRs.
                let atr: u128 = if (state.fast_line == 0) {
                    // Cold start: SMA of first atr_period TRs
                    let tr_sum: u128 = 0;
                    let ti = buf_len - atr_period;
                    while (ti < buf_len) {
                        let c = *vector::borrow(&buf.prices, ti) as u128;
                        let p = if (ti > 0) { *vector::borrow(&buf.prices, ti - 1) as u128 } else { c };
                        let tr = if (c >= p) { (c - p) * 2 } else { (p - c) * 2 };
                        tr_sum = tr_sum + tr;
                        ti = ti + 1;
                    };
                    tr_sum / (atr_period as u128)
                } else {
                    // Wilder's smooth: ATR = ((period-1)*prevATR + TR) / period
                    let prev_close = *vector::borrow(&buf.prices, buf_len - 2) as u128;
                    let curr_close = price as u128;
                    let tr = if (curr_close >= prev_close) {
                        (curr_close - prev_close) * 2
                    } else {
                        (prev_close - curr_close) * 2
                    };
                    let prev_atr = state.fast_line as u128;
                    ((prev_atr * ((atr_period - 1) as u128)) + tr) / (atr_period as u128)
                };

                // upper_band = close + multiplier * ATR
                // lower_band = close - multiplier * ATR
                let atr_u64 = atr as u64;
                let band_offset = ((atr as u128) * (multiplier_x10 as u128) / 10) as u64;

                let upper_band = price + band_offset;
                let lower_band = if (price >= band_offset) { price - band_offset } else { 0 };

                // Determine trend direction
                let prev_direction = state.third_value;
                let new_direction: u64;
                if (price > upper_band) {
                    new_direction = SUPERTREND_UP;
                } else if (lower_band > 0 && price < lower_band) {
                    new_direction = SUPERTREND_DOWN;
                } else if (prev_direction == SUPERTREND_NEUTRAL) {
                    new_direction = SUPERTREND_NEUTRAL;
                } else {
                    // Maintain previous trend until a band is broken
                    new_direction = prev_direction;
                };

                state.third_value = new_direction;

                // fast_line = ATR, slow_line = active band (upper if down, lower if up)
                fast_val = atr_u64;
                slow_val = if (new_direction == SUPERTREND_UP) { lower_band }
                           else                                 { upper_band };

                has_signal = true;
            };

        } else if (state.indicator_type == TYPE_DONCHIAN) {
            // Donchian Channels: upper = highest(period), lower = lowest(period)
            let dc_period = state.short_period;
            if (buf_len >= dc_period) {
                let upper = compute_highest(&buf.prices, dc_period);
                let lower = compute_lowest(&buf.prices, dc_period);
                // fast_line = upper band, slow_line = lower band
                fast_val   = upper;
                slow_val   = lower;
                has_signal = true;
            };

        } else if (state.indicator_type == TYPE_KAMA) {
            // Kaufman Adaptive MA (KAMA)
            // short_period = efficiency ratio period (ER period), default 10
            // long_period  = slow EMA period, default 30; fast period hardcoded 2
            // sc = (ER * (fast_sc - slow_sc) + slow_sc)^2  — adaptive smoothing constant
            // kama[i] = kama[i-1] + sc * (price - kama[i-1])
            //
            // We store two KAMA values:
            //   fast_line = KAMA(short_period ER, long_period=30)  — "fast KAMA"
            //   slow_line = KAMA(long_period  ER, long_period=30)  — "slow KAMA"
            // Signal: fast > slow = BUY, fast < slow = SELL
            let er_period = state.short_period; // e.g. 10
            let slow_period = state.long_period; // e.g. 30
            // Need at least slow_period prices for meaningful signal
            if (buf_len >= slow_period) {
                let fast_kama = compute_kama(&buf.prices, er_period, state.fast_line);
                let slow_kama = compute_kama(&buf.prices, slow_period, state.slow_line);
                fast_val   = fast_kama;
                slow_val   = slow_kama;
                has_signal = true;
            };

        } else if (state.indicator_type == TYPE_ALMA) {
            // Arnaud Legoux MA (ALMA)
            // short_period = window size (default 9)
            // long_period  = offset * 100 (default 85 = 0.85)
            // sigma hardcoded = 6
            // ALMA = Gaussian-weighted moving average
            //
            // fast_line = ALMA(window), slow_line = previous ALMA (for trend direction)
            // Signal: ALMA rising (current > previous) = BUY; falling = SELL
            let window = state.short_period;
            if (buf_len >= window) {
                let alma_val = compute_alma(&buf.prices, window, state.long_period);
                fast_val   = alma_val;
                slow_val   = state.fast_line; // previous ALMA stored in slow_line via fast_line carry
                has_signal = true;
            };

        } else if (state.indicator_type == TYPE_T3) {
            // Triple EMA (T3) by Tim Tillson
            // short_period = EMA period (default 5)
            // long_period  = vFactor * 10 (default 7 = 0.70)
            // T3 = GD(GD(GD(price))) where GD(n,v) = (1+v)*EMA - v*EMA(EMA)
            //
            // Simplified stateful approach:
            //   fast_line = current T3 value
            //   slow_line = previous T3 value (for trend direction signal)
            // We recompute from the price buffer each call (EMA is O(n) on the window).
            let t3_period = state.short_period;
            // Need 6*period warmup
            if (buf_len >= t3_period * 6) {
                let t3_val = compute_t3(&buf.prices, t3_period, state.long_period);
                fast_val   = t3_val;
                slow_val   = state.fast_line; // previous T3
                has_signal = true;
            };

        } else if (state.indicator_type == TYPE_LAGUERRE) {
            // Laguerre RSI
            // short_period = gamma * 10 (default 7 = 0.70 gamma)
            // gamma (damping) = short_period / 10 / 10 = short_period * SCALE / 100
            //
            // 4-pole Laguerre filter state: L0, L1, L2, L3
            //   fast_line = L0 (most recent)
            //   slow_line = L1
            //   third_value encodes L2 (high 32 conceptual bits) and L3
            //     Since prices can exceed u32, we store L2 and L3 scaled differently.
            //     Strategy: encode as L2 * SCALE + L3 / SCALE won't work cleanly.
            //     Instead store L2 in third_value directly; derive L3 from a re-run of
            //     the filter using stored L0..L2 values. We keep L3 in a local var and
            //     don't persist it (since it's computed deterministically from L0..L2 + prev).
            //
            // Actually: we run the full filter over the last 20 prices from the buffer
            // starting from zero state — Laguerre converges very fast (4 samples).
            // This avoids multi-state storage complexity entirely.
            //
            // gamma = short_period scaled to fixed-point: gamma_fp = short_period * SCALE / 100
            // (e.g. short_period=7 → gamma=0.07?  No: per spec gamma*10=short_period, so gamma=0.70)
            // Per spec: gamma = short_period / 10 / 10 = short_period * SCALE / 100
            // Wait — spec says: gamma (damping) = short_period * SCALE / 100
            //   short_period=7 → gamma_fp = 7 * 1e8 / 100 = 7_000_000 = 0.07
            //   That seems too low. Re-reading: "short_period = gamma * 10 (default 7 = 0.70 gamma)"
            //   So gamma = short_period / 10 = 7/10 = 0.70
            //   gamma_fp = short_period * SCALE / 10
            has_signal = true;
            let gamma_fp: u64 = state.short_period * (100_000_000u64 / 10);
            // Clamp gamma to [0, SCALE)
            if (gamma_fp >= 100_000_000) { gamma_fp = 95_000_000 };

            // Run Laguerre filter over last min(20, buf_len) prices
            let run_len: u64 = if (buf_len > 20) { 20 } else { buf_len };
            let run_start: u64 = buf_len - run_len;

            let l0: u64 = 0;
            let l1: u64 = 0;
            let l2: u64 = 0;
            let l3: u64 = 0;
            let li = 0u64;
            let scale: u64 = 100_000_000;
            let one_minus_g: u64 = if (scale >= gamma_fp) { scale - gamma_fp } else { 0 };

            while (li < run_len) {
                let p: u64 = *vector::borrow(&buf.prices, run_start + li);

                let new_l0 = ((one_minus_g as u128) * (p as u128) / (scale as u128)
                             + (gamma_fp as u128) * (l0 as u128) / (scale as u128)) as u64;

                // L1 = -g*L0 + L0_prev + g*L1_prev
                // = L0_prev - g*(L0 - L1_prev)
                // (all saturating to avoid underflow)
                let new_l1: u64 = {
                    let term_a: u128 = (l0 as u128); // L0_prev
                    let term_g_new_l0: u128 = (gamma_fp as u128) * (new_l0 as u128) / (scale as u128);
                    let term_g_l1: u128 = (gamma_fp as u128) * (l1 as u128) / (scale as u128);
                    let pos: u128 = term_a + term_g_l1;
                    if (pos >= term_g_new_l0) { (pos - term_g_new_l0) as u64 } else { 0 }
                };

                let new_l2: u64 = {
                    let term_a: u128 = (l1 as u128);
                    let term_g_new_l1: u128 = (gamma_fp as u128) * (new_l1 as u128) / (scale as u128);
                    let term_g_l2: u128 = (gamma_fp as u128) * (l2 as u128) / (scale as u128);
                    let pos: u128 = term_a + term_g_l2;
                    if (pos >= term_g_new_l1) { (pos - term_g_new_l1) as u64 } else { 0 }
                };

                let new_l3: u64 = {
                    let term_a: u128 = (l2 as u128);
                    let term_g_new_l2: u128 = (gamma_fp as u128) * (new_l2 as u128) / (scale as u128);
                    let term_g_l3: u128 = (gamma_fp as u128) * (l3 as u128) / (scale as u128);
                    let pos: u128 = term_a + term_g_l3;
                    if (pos >= term_g_new_l2) { (pos - term_g_new_l2) as u64 } else { 0 }
                };

                l0 = new_l0;
                l1 = new_l1;
                l2 = new_l2;
                l3 = new_l3;
                li = li + 1;
            };

            // RSI computation from Laguerre values:
            // cu = max(L0-L1, 0) + max(L1-L2, 0) + max(L2-L3, 0)
            // cd = max(L1-L0, 0) + max(L2-L1, 0) + max(L3-L2, 0)
            // RSI = cu / (cu + cd + epsilon)   scaled to 1e8
            let cu: u128 = {
                let a: u128 = if (l0 >= l1) { (l0 - l1) as u128 } else { 0 };
                let b: u128 = if (l1 >= l2) { (l1 - l2) as u128 } else { 0 };
                let c: u128 = if (l2 >= l3) { (l2 - l3) as u128 } else { 0 };
                a + b + c
            };
            let cd: u128 = {
                let a: u128 = if (l1 >= l0) { (l1 - l0) as u128 } else { 0 };
                let b: u128 = if (l2 >= l1) { (l2 - l1) as u128 } else { 0 };
                let c: u128 = if (l3 >= l2) { (l3 - l2) as u128 } else { 0 };
                a + b + c
            };
            let epsilon: u128 = 1; // prevent division by zero
            let lrsi: u64 = ((cu * (scale as u128)) / (cu + cd + epsilon)) as u64;

            // fast_val = Laguerre RSI (0..SCALE = 0..100%)
            // slow_val = 0 (unused, thresholds hardcoded)
            fast_val = lrsi;
            slow_val = 50_000_000; // midpoint for display
            // has_signal already set to true
        };

        state.fast_line = fast_val;
        state.slow_line = slow_val;

        // ── Signal detection ──
        let new_signal: u8 = if (!has_signal) { SIGNAL_NEUTRAL }
            else if (state.indicator_type == TYPE_SMA || state.indicator_type == TYPE_EMA
                     || state.indicator_type == TYPE_MACD) {
                if      (fast_val > slow_val) { SIGNAL_BUY  }
                else if (fast_val < slow_val) { SIGNAL_SELL }
                else                          { SIGNAL_NEUTRAL }
            } else if (state.indicator_type == TYPE_RSI) {
                let rsi_30 = 30_00000000u64;
                let rsi_70 = 70_00000000u64;
                if      (fast_val < rsi_30) { SIGNAL_BUY  }
                else if (fast_val > rsi_70) { SIGNAL_SELL }
                else                        { SIGNAL_NEUTRAL }
            } else if (state.indicator_type == TYPE_BB) {
                // BB: mean reversion — BUY below lower band, SELL above upper band
                if      (price < slow_val && slow_val > 0) { SIGNAL_BUY  }
                else if (price > fast_val && fast_val > 0) { SIGNAL_SELL }
                else                                       { SIGNAL_NEUTRAL }
            } else if (state.indicator_type == TYPE_STOCH) {
                // Stochastic: BUY when %K crosses above oversold (prev %D < 20, %K > 20)
                //             SELL when %K crosses above overbought (%K > 80)
                let prev_slow = state.slow_line; // previous %D
                if (prev_slow < STOCH_OVERSOLD && fast_val > STOCH_OVERSOLD) {
                    SIGNAL_BUY
                } else if (fast_val > STOCH_OVERBOUGHT) {
                    SIGNAL_SELL
                } else {
                    SIGNAL_NEUTRAL
                }
            } else if (state.indicator_type == TYPE_SUPERTREND) {
                let direction = state.third_value;
                if      (direction == SUPERTREND_UP)   { SIGNAL_BUY  }
                else if (direction == SUPERTREND_DOWN)  { SIGNAL_SELL }
                else                                    { SIGNAL_NEUTRAL }
            } else if (state.indicator_type == TYPE_DONCHIAN) {
                // TYPE_DONCHIAN: mean reversion — BUY if price touches/breaks lower band,
                // SELL if price touches/breaks upper band
                if      (price <= slow_val && slow_val > 0) { SIGNAL_BUY  }
                else if (price >= fast_val && fast_val > 0) { SIGNAL_SELL }
                else                                        { SIGNAL_NEUTRAL }
            } else if (state.indicator_type == TYPE_KAMA) {
                // KAMA: BUY when fast KAMA > slow KAMA, SELL when fast KAMA < slow KAMA
                if      (fast_val > slow_val) { SIGNAL_BUY  }
                else if (fast_val < slow_val) { SIGNAL_SELL }
                else                          { SIGNAL_NEUTRAL }
            } else if (state.indicator_type == TYPE_ALMA) {
                // ALMA: BUY when ALMA rising (current > previous), SELL when falling
                if      (fast_val > slow_val) { SIGNAL_BUY  }
                else if (fast_val < slow_val) { SIGNAL_SELL }
                else                          { SIGNAL_NEUTRAL }
            } else if (state.indicator_type == TYPE_T3) {
                // T3: BUY when T3 rising (current > previous), SELL when falling
                if      (fast_val > slow_val) { SIGNAL_BUY  }
                else if (fast_val < slow_val) { SIGNAL_SELL }
                else                          { SIGNAL_NEUTRAL }
            } else {
                // TYPE_LAGUERRE: BUY when RSI < 20% (oversold), SELL when RSI > 80% (overbought)
                let lrsi_buy:  u64 = 20_000_000; // 0.20 * SCALE
                let lrsi_sell: u64 = 80_000_000; // 0.80 * SCALE
                if      (fast_val < lrsi_buy)  { SIGNAL_BUY  }
                else if (fast_val > lrsi_sell) { SIGNAL_SELL }
                else                            { SIGNAL_NEUTRAL }
            };

        let prev_signal   = state.last_signal;
        let signal_crossed = prev_signal != new_signal
                           && (new_signal == SIGNAL_BUY || new_signal == SIGNAL_SELL);

        if (signal_crossed) {
            state.total_signals    = state.total_signals + 1;
            state.last_signal_time = ts;

            let trade_gain: u64 = 0;
            let trade_loss: u64 = 0;

            if (new_signal == SIGNAL_BUY) {
                state.in_position = true;
                state.entry_price = price;
            } else if (new_signal == SIGNAL_SELL && state.in_position) {
                if (state.entry_price > 0) {
                    if (price > state.entry_price) {
                        trade_gain = (price - state.entry_price) * 10000 / state.entry_price;
                        state.realized_gain_bps = state.realized_gain_bps + trade_gain;
                    } else {
                        trade_loss = (state.entry_price - price) * 10000 / state.entry_price;
                        state.realized_loss_bps = state.realized_loss_bps + trade_loss;
                    };
                };
                state.in_position = false;
            };

            let trade_id  = log.next_id;
            log.next_id   = log.next_id + 1;
            log.total_gain_bps = log.total_gain_bps + trade_gain;
            log.total_loss_bps = log.total_loss_bps + trade_loss;
            if (trade_gain > 0) { log.win_trades  = log.win_trades  + 1; };
            if (trade_loss > 0) { log.loss_trades = log.loss_trades + 1; };

            if (vector::length(&log.trades) >= 200) {
                vector::remove(&mut log.trades, 0);
            };
            vector::push_back(&mut log.trades, TradeRecord {
                trade_id,
                signal:    new_signal,
                price,
                fast_line: fast_val,
                slow_line: slow_val,
                gain_bps:  trade_gain,
                loss_bps:  trade_loss,
                timestamp: ts,
            });

            event::emit(TradeExecuted {
                indicator_addr,
                trade_id,
                signal:    new_signal,
                price,
                fast_line: fast_val,
                slow_line: slow_val,
                gain_bps:  trade_gain,
                loss_bps:  trade_loss,
                timestamp: ts,
            });
            event::emit(SignalEvent {
                indicator_addr,
                signal:    new_signal,
                price,
                fast_line: fast_val,
                slow_line: slow_val,
                asset:     state.asset,
                timestamp: ts,
            });
        };

        state.last_signal = new_signal;

        event::emit(PricePushed {
            indicator_addr,
            price,
            fast_line:       fast_val,
            slow_line:       slow_val,
            signal:          new_signal,
            prices_buffered: buf_len,
            timestamp:       ts,
        });
    }

    // ─── TA Math (Fixed-Point, Scale = 1e8) ──────────────────────────

    fun compute_sma(prices: &vector<u64>, period: u64): u64 {
        let len   = vector::length(prices);
        let total: u128 = 0;
        let start = len - period;
        let i     = start;
        while (i < len) {
            total = total + (*vector::borrow(prices, i) as u128);
            i = i + 1;
        };
        (total / (period as u128)) as u64
    }

    fun compute_ema(prices: &vector<u64>, period: u64): u64 {
        let len       = vector::length(prices);
        let start_idx = len - period;
        // Seed with SMA of first window
        let seed: u128 = 0;
        let i = 0;
        while (i < period) {
            seed = seed + (*vector::borrow(prices, start_idx + i) as u128);
            i = i + 1;
        };
        let ema: u128  = seed / (period as u128);
        // k = 2/(period+1) scaled to 1e6
        let k_scaled: u128 = 2_000_000 / ((period + 1) as u128);
        let k_inv:    u128 = 1_000_000 - k_scaled;
        let j = start_idx + period;
        while (j < len) {
            let p = *vector::borrow(prices, j);
            ema = ((p as u128) * k_scaled + ema * k_inv) / 1_000_000;
            j = j + 1;
        };
        (ema as u64)
    }

    fun compute_rsi(prices: &vector<u64>, period: u64): u64 {
        let len = vector::length(prices);
        assert!(len > period, E_INSUFFICIENT_DATA);
        let avg_gain: u128 = 0;
        let avg_loss: u128 = 0;
        let start = len - period - 1;
        let i     = start;
        while (i < start + period) {
            let prev = *vector::borrow(prices, i);
            let curr = *vector::borrow(prices, i + 1);
            if (curr > prev) { avg_gain = avg_gain + ((curr - prev) as u128); }
            else             { avg_loss = avg_loss + ((prev - curr) as u128); };
            i = i + 1;
        };
        avg_gain = avg_gain / (period as u128);
        avg_loss = avg_loss / (period as u128);
        // Wilder's smoothing for remaining prices
        let j = start + period;
        while (j < len - 1) {
            let prev = *vector::borrow(prices, j);
            let curr = *vector::borrow(prices, j + 1);
            let gain: u128 = if (curr > prev) { ((curr - prev) as u128) } else { 0 };
            let loss: u128 = if (prev > curr) { ((prev - curr) as u128) } else { 0 };
            avg_gain = (avg_gain * ((period - 1) as u128) + gain) / (period as u128);
            avg_loss = (avg_loss * ((period - 1) as u128) + loss) / (period as u128);
            j = j + 1;
        };
        if (avg_loss == 0) { return 100_00000000 };
        let scale: u128 = 100_00000000;
        (scale * avg_gain / (avg_gain + avg_loss)) as u64
    }

    /// Returns (upper_band, lower_band) in USD * 1e8.
    /// multiplier_x10: 20=2.0x, 15=1.5x, 25=2.5x
    fun compute_bollinger_bands(
        prices: &vector<u64>,
        period: u64,
        mid: u64,
        multiplier_x10: u64,
    ): (u64, u64) {
        let len   = vector::length(prices);
        let start = len - period;
        // Sum of squared deviations (u128 prevents overflow for BTC-scale prices)
        let sum_sq: u128 = 0;
        let i = start;
        while (i < len) {
            let p: u128 = *vector::borrow(prices, i) as u128;
            let m: u128 = mid as u128;
            let diff    = if (p >= m) { p - m } else { m - p };
            sum_sq      = sum_sq + diff * diff;
            i = i + 1;
        };
        let std_dev = isqrt(sum_sq / (period as u128));
        let offset  = (((std_dev as u128) * (multiplier_x10 as u128)) / 10) as u64;
        let upper   = mid + offset;
        let lower   = if (mid >= offset) { mid - offset } else { 0 };
        (upper, lower)
    }

    /// Highest value in the last `period` elements of prices.
    fun compute_highest(prices: &vector<u64>, period: u64): u64 {
        let len   = vector::length(prices);
        let start = len - period;
        compute_highest_window(prices, start, len)
    }

    /// Lowest value in the last `period` elements of prices.
    fun compute_lowest(prices: &vector<u64>, period: u64): u64 {
        let len   = vector::length(prices);
        let start = len - period;
        compute_lowest_window(prices, start, len)
    }

    /// Highest value in prices[window_start..window_end) (exclusive end).
    fun compute_highest_window(prices: &vector<u64>, window_start: u64, window_end: u64): u64 {
        let high = *vector::borrow(prices, window_start);
        let i    = window_start + 1;
        while (i < window_end) {
            let v = *vector::borrow(prices, i);
            if (v > high) { high = v; };
            i = i + 1;
        };
        high
    }

    /// Lowest value in prices[window_start..window_end) (exclusive end).
    fun compute_lowest_window(prices: &vector<u64>, window_start: u64, window_end: u64): u64 {
        let low = *vector::borrow(prices, window_start);
        let i   = window_start + 1;
        while (i < window_end) {
            let v = *vector::borrow(prices, i);
            if (v < low) { low = v; };
            i = i + 1;
        };
        low
    }

    // ─── KAMA ─────────────────────────────────────────────────────────────
    // Kaufman Adaptive Moving Average.
    // er_period: efficiency ratio lookback (e.g. 10)
    // prev_kama: previous KAMA value (0 if first run — will cold-start with SMA)
    //
    // Efficiency Ratio (ER) = direction / noise
    //   direction = |price[last] - price[last - er_period]|
    //   noise     = sum(|price[i] - price[i-1]|, i in last er_period bars)
    // fast_sc = 2/(2+1) = SCALE * 2 / 3
    // slow_sc = 2/(30+1) = SCALE * 2 / 31  (hardcoded slow=30)
    // sc = ER * (fast_sc - slow_sc) + slow_sc
    // kama = prev_kama + sc^2 * (price - prev_kama)
    fun compute_kama(prices: &vector<u64>, er_period: u64, prev_kama: u64): u64 {
        let len = vector::length(prices);
        if (len < er_period + 1) {
            // Not enough data — return last price
            return *vector::borrow(prices, len - 1)
        };

        let last_price  = *vector::borrow(prices, len - 1);
        let first_price = *vector::borrow(prices, len - 1 - er_period);

        // direction = |last - first|
        let direction: u128 = if (last_price >= first_price) {
            (last_price - first_price) as u128
        } else {
            (first_price - last_price) as u128
        };

        // noise = sum of absolute consecutive differences over er_period bars
        let noise: u128 = 0;
        let ni = len - er_period;
        while (ni < len) {
            let cur  = *vector::borrow(prices, ni) as u128;
            let prev = *vector::borrow(prices, ni - 1) as u128;
            let diff = if (cur >= prev) { cur - prev } else { prev - cur };
            noise = noise + diff;
            ni = ni + 1;
        };

        let scale: u128 = 100_000_000;

        // ER = direction / noise (in fixed-point [0, SCALE])
        let er_fp: u128 = if (noise == 0) {
            scale
        } else {
            (direction * scale) / noise
        };
        // Clamp ER to [0, SCALE]
        let er_fp = if (er_fp > scale) { scale } else { er_fp };

        // fast_sc = 2*SCALE/3, slow_sc = 2*SCALE/31
        let fast_sc: u128 = 2 * scale / 3;
        let slow_sc: u128 = 2 * scale / 31;

        // sc = ER * (fast_sc - slow_sc) / SCALE + slow_sc
        let sc: u128 = if (fast_sc >= slow_sc) {
            er_fp * (fast_sc - slow_sc) / scale + slow_sc
        } else {
            slow_sc
        };

        // sc_sq = sc^2 / SCALE (smoothing constant squared)
        let sc_sq: u128 = (sc * sc) / scale;

        // Cold start: if prev_kama == 0 seed with SMA
        let kama_prev: u128 = if (prev_kama == 0) {
            // seed with SMA of last er_period prices
            let sum: u128 = 0;
            let si = len - er_period;
            while (si < len) {
                sum = sum + (*vector::borrow(prices, si) as u128);
                si = si + 1;
            };
            sum / (er_period as u128)
        } else {
            prev_kama as u128
        };

        // kama = prev + sc^2 * (price - prev)
        let price_u128 = last_price as u128;
        let new_kama: u128 = if (price_u128 >= kama_prev) {
            kama_prev + sc_sq * (price_u128 - kama_prev) / scale
        } else {
            let diff = kama_prev - price_u128;
            let sub  = sc_sq * diff / scale;
            if (kama_prev >= sub) { kama_prev - sub } else { 0 }
        };

        new_kama as u64
    }

    // ─── ALMA ─────────────────────────────────────────────────────────────
    // Arnaud Legoux Moving Average.
    // window: number of bars (e.g. 9)
    // offset_x100: 0..100 (e.g. 85 = 0.85 offset toward most recent bar)
    // sigma hardcoded = 6
    //
    // m = offset * (window - 1)   (where offset = offset_x100 / 100)
    // s = window / 6
    // w[i] = exp(-((i - m)^2) / (2 * s^2))   for i in 0..window-1
    // ALMA = sum(price[i] * w[i]) / sum(w[i])
    //
    // Uses math_lib::exp_fp for Gaussian weights.
    fun compute_alma(prices: &vector<u64>, window: u64, offset_x100: u64): u64 {
        let len = vector::length(prices);
        if (len < window) {
            return *vector::borrow(prices, len - 1)
        };

        let scale: u64 = 100_000_000;
        let scale128: u128 = scale as u128;

        // m = offset_x100 / 100 * (window - 1), in fixed-point
        // m_fp = offset_x100 * (window - 1) * SCALE / 100
        let m_fp: u64 = (offset_x100 * (window - 1) * scale) / 100;

        // s = window * SCALE / 6  (sigma = 6 hardcoded)
        let s_fp: u64 = window * scale / 6;
        if (s_fp == 0) { s_fp = 1 };

        // 2 * s^2 in fixed-point: 2 * (s_fp)^2 / SCALE
        let two_s_sq: u128 = 2 * (s_fp as u128) * (s_fp as u128) / (scale as u128);
        if (two_s_sq == 0) { two_s_sq = 1 };

        let weighted_sum: u128 = 0;
        let weight_total: u128 = 0;

        let start = len - window;
        let i = 0u64;
        while (i < window) {
            let price_i = *vector::borrow(prices, start + i) as u128;

            // i_fp = i * SCALE
            let i_fp: u64 = i * scale;

            // diff = |i_fp - m_fp|
            let diff: u128 = if (i_fp >= m_fp) {
                (i_fp - m_fp) as u128
            } else {
                (m_fp - i_fp) as u128
            };

            // exponent = diff^2 / (two_s_sq) — all in 1e8 units
            // diff is in 1e8 units, diff^2 is in 1e16 units, two_s_sq is in 1e8 units
            // exponent (1e8 units) = diff^2 / (two_s_sq * SCALE)
            let diff_sq: u128 = diff * diff; // 1e16 units
            let exponent: u64 = (diff_sq / (two_s_sq * scale128)) as u64;

            // w = exp(-exponent); since exp_fp takes positive x and returns e^x,
            // we compute 1 / exp_fp(exponent) = SCALE^2 / exp_fp(exponent)
            // but that gets complicated. Instead use: w = SCALE / exp_fp(exponent)
            // (works because exp_fp(0) = SCALE, and result is in [0, SCALE])
            let exp_val: u64 = math_lib::exp_fp(exponent);
            let w: u128 = if (exp_val == 0) { 0 } else {
                (scale128 * scale128) / (exp_val as u128)
            };

            weighted_sum = weighted_sum + price_i * w;
            weight_total = weight_total + w;
            i = i + 1;
        };

        if (weight_total == 0) {
            return *vector::borrow(prices, len - 1)
        };

        (weighted_sum / weight_total) as u64
    }

    // ─── T3 ───────────────────────────────────────────────────────────────
    // Triple Exponential Moving Average by Tim Tillson.
    // period: EMA period (e.g. 5)
    // v_x10: vFactor * 10 (e.g. 7 = 0.70); controls overshoot/smoothness
    //
    // GD(prices, period, v) = (1+v)*EMA(prices, period) - v*EMA(EMA(prices), period)
    // T3 = GD(GD(GD(prices, period, v), period, v), period, v)
    //
    // Equivalent formula using 6 successive EMAs e1..e6:
    //   e1 = EMA(prices, period)
    //   e2 = EMA of {e1 history}   — approximated here by applying EMA multiplier twice
    //   ...
    //   c1 = -v^3
    //   c2 = 3*v^2 + 3*v^3
    //   c3 = -6*v^2 - 3*v - 3*v^3
    //   c4 = 1 + 3*v + v^3 + 3*v^2
    //   T3 = c1*e6 + c2*e5 + c3*e4 + c4*e3
    //
    // Since we don't store per-bar EMA histories, we compute by running EMA
    // over the buffer 6 times (each pass is O(n)).
    fun compute_t3(prices: &vector<u64>, period: u64, v_x10: u64): u64 {
        // Run EMA 6 times to get e1..e6
        let e = compute_ema(prices, period);
        // Build a single-element "prices" vector for subsequent passes
        // is not feasible without the full history. Instead, we compute
        // 6 cascaded EMAs by re-applying the EMA formula using the current
        // value as the EMA seed and only the multiplier updating each step.
        //
        // This is a stateless approximation: we seed each level with the
        // SMA of the buffer slice and then apply k_scaled * (new - prev) once.
        // Accurate for long buffers, approximate for short warmup.

        let len = vector::length(prices);
        // Compute 6 EMA levels on the available price buffer
        // Level 1: compute_ema on raw prices — normal
        let e1 = e;

        // For levels 2..6 we need the EMA of the EMA. We can approximate this
        // by applying the EMA formula with the same period but using e1 as the
        // "price" input for the last (period) bars — but we only have the current e1.
        // Better approach: use the EMA multiplier recursively.
        // k = 2/(period+1). Apply EMA smoothing N more times starting from e1,
        // each time using the same k and treating the prior level's output as a seed.
        // This is the "EMA of EMA" approximation used in practice.

        let k_scaled: u128 = 2_000_000 / ((period + 1) as u128);
        let k_inv:    u128 = 1_000_000 - k_scaled;

        // Seed each level with the simple average of the last period prices
        let seed_sum: u128 = 0;
        let seed_start = if (len >= period) { len - period } else { 0 };
        let si = seed_start;
        while (si < len) {
            seed_sum = seed_sum + (*vector::borrow(prices, si) as u128);
            si = si + 1;
        };
        let actual_period = len - seed_start;
        let seed: u128 = if (actual_period > 0) { seed_sum / (actual_period as u128) } else { e1 as u128 };

        // Run 6 levels of EMA over the last (period * 6) bars
        // Each level: ema_i = k*p + (1-k)*ema_{i-1}  (using the prior level's "current" value as p)
        // We iterate over all prices for e1, then treat e1 as a constant "price stream" for e2, etc.
        // Since we don't have the actual EMA stream, we use the following approach:
        //   For e2..e6, apply the EMA formula once using (e_{n-1}) as the new data point
        //   and the previous e_{n-1} computed from the older seed as the prior EMA.
        // This is equivalent to applying cascaded EMA on a constant price = e1.

        // Level 1 is already e1. For levels 2-6, smooth e1 through the EMA filter.
        let e2: u128 = ((e1 as u128) * k_scaled + seed * k_inv) / 1_000_000;
        let e3: u128 = ((e2) * k_scaled + seed * k_inv) / 1_000_000;
        let e4: u128 = ((e3) * k_scaled + seed * k_inv) / 1_000_000;
        let e5: u128 = ((e4) * k_scaled + seed * k_inv) / 1_000_000;
        let e6: u128 = ((e5) * k_scaled + seed * k_inv) / 1_000_000;

        // v = v_x10 / 10  in fixed-point: v_fp = v_x10 * SCALE / 10
        let scale: u128 = 100_000_000;
        let v_fp: u128 = (v_x10 as u128) * scale / 10;

        // v^2, v^3 in fixed-point
        let v2: u128 = v_fp * v_fp / scale;
        let v3: u128 = v2  * v_fp / scale;

        // T3 = c1*e6 + c2*e5 + c3*e4 + c4*e3
        // c1 = -v^3                     → subtract v3*e6
        // c2 = 3*v^2 + 3*v^3            → add (3v2 + 3v3)*e5
        // c3 = -6*v^2 - 3*v - 3*v^3     → subtract (6v2+3v+3v3)*e4
        // c4 = 1 + 3*v + v^3 + 3*v^2    → add (SCALE+3v+v3+3v2)*e3
        //
        // All products scaled by 1/SCALE to stay in fixed-point.

        let t3: u128 = {
            let c4_times_e3 = (scale + 3*v_fp + v3 + 3*v2) * e3 / scale;
            let c3_times_e4 = (6*v2 + 3*v_fp + 3*v3) * e4 / scale;
            let c2_times_e5 = (3*v2 + 3*v3) * e5 / scale;
            let c1_times_e6 = v3 * e6 / scale;

            // T3 = c4*e3 - c3*e4 + c2*e5 - c1*e6
            let pos = c4_times_e3 + c2_times_e5;
            let neg = c3_times_e4 + c1_times_e6;
            if (pos >= neg) { pos - neg } else { 0 }
        };

        t3 as u64
    }

    /// Integer square root via Newton's method.
    /// Input at (1e8)^2 = 1e16 scale → output at 1e8 scale.
    fun isqrt(n: u128): u64 {
        if (n == 0) { return 0 };
        let x = n;
        let y = (x + 1) / 2;
        while (y < x) {
            x = y;
            y = (x + n / x) / 2;
        };
        (x as u64)
    }

    // ─── Public Interface — DEX/Perp Integration ──────────────────────

    /// Get current signal. Call from any DEX/perp module:
    ///   let s = indicator::get_signal(my_indicator_addr);
    ///   if (s == 1) { /* BUY */ }
    public fun get_signal(indicator_addr: address): u8 acquires IndicatorState {
        borrow_global<IndicatorState>(indicator_addr).last_signal
    }

    /// Full TA state for DEX execution logic.
    /// Returns: (fast_line, slow_line, signal, in_position, last_price)
    public fun get_ta_state(indicator_addr: address): (u64, u64, u8, bool, u64) acquires IndicatorState {
        let s = borrow_global<IndicatorState>(indicator_addr);
        (s.fast_line, s.slow_line, s.last_signal, s.in_position, s.last_price)
    }

    // ─── View Functions ───────────────────────────────────────────────

    /// All indicator Object addresses deployed via this factory.
    #[view]
    public fun get_all_indicators(): vector<address> acquires FactoryState {
        *&borrow_global<FactoryState>(@cash_strategy).indicators
    }

    #[view]
    public fun get_indicator_count(): u64 acquires FactoryState {
        borrow_global<FactoryState>(@cash_strategy).count
    }

    /// (signal, fast_line, slow_line, last_price, last_signal_time)
    #[view]
    public fun get_signal_view(addr: address): (u8, u64, u64, u64, u64) acquires IndicatorState {
        let s = borrow_global<IndicatorState>(addr);
        (s.last_signal, s.fast_line, s.slow_line, s.last_price, s.last_signal_time)
    }

    /// (name, symbol, asset, indicator_type, short_period, long_period)
    #[view]
    public fun get_info(addr: address): (String, String, String, u8, u64, u64) acquires IndicatorState {
        let s = borrow_global<IndicatorState>(addr);
        (s.name, s.symbol, s.asset, s.indicator_type, s.short_period, s.long_period)
    }

    #[view]
    public fun get_prices(addr: address): vector<u64> acquires PriceBuffer {
        borrow_global<PriceBuffer>(addr).prices
    }

    #[view]
    public fun get_timestamps(addr: address): vector<u64> acquires PriceBuffer {
        borrow_global<PriceBuffer>(addr).timestamps
    }

    #[view]
    public fun get_buffer_size(addr: address): u64 acquires PriceBuffer {
        vector::length(&borrow_global<PriceBuffer>(addr).prices)
    }

    /// (in_position, entry_price, realized_gain_bps, realized_loss_bps)
    #[view]
    public fun get_position(addr: address): (bool, u64, u64, u64) acquires IndicatorState {
        let s = borrow_global<IndicatorState>(addr);
        (s.in_position, s.entry_price, s.realized_gain_bps, s.realized_loss_bps)
    }

    /// (total_prices_pushed, total_signals, is_graduated)
    #[view]
    public fun get_stats(addr: address): (u64, u64, bool) acquires IndicatorState {
        let s = borrow_global<IndicatorState>(addr);
        (s.total_prices_pushed, s.total_signals, s.is_graduated)
    }

    /// (total_trades, win_trades, loss_trades, total_gain_bps, total_loss_bps)
    #[view]
    public fun get_trade_stats(addr: address): (u64, u64, u64, u64, u64) acquires TradeLog {
        let l = borrow_global<TradeLog>(addr);
        (l.next_id, l.win_trades, l.loss_trades, l.total_gain_bps, l.total_loss_bps)
    }

    /// Parallel arrays of recorded trades (newest last).
    #[view]
    public fun get_trades(addr: address): (
        vector<u64>, vector<u8>, vector<u64>, vector<u64>, vector<u64>, vector<u64>
    ) acquires TradeLog {
        let l  = borrow_global<TradeLog>(addr);
        let n  = vector::length(&l.trades);
        let ids        = vector::empty<u64>();
        let sigs       = vector::empty<u8>();
        let prices_out = vector::empty<u64>();
        let gains      = vector::empty<u64>();
        let losses     = vector::empty<u64>();
        let times      = vector::empty<u64>();
        let i = 0;
        while (i < n) {
            let t = vector::borrow(&l.trades, i);
            vector::push_back(&mut ids,        t.trade_id);
            vector::push_back(&mut sigs,       t.signal);
            vector::push_back(&mut prices_out, t.price);
            vector::push_back(&mut gains,      t.gain_bps);
            vector::push_back(&mut losses,     t.loss_bps);
            vector::push_back(&mut times,      t.timestamp);
            i = i + 1;
        };
        (ids, sigs, prices_out, gains, losses, times)
    }

    // ─── Admin ────────────────────────────────────────────────────────

    public entry fun set_keeper(
        owner: &signer, indicator_addr: address, new_keeper: address
    ) acquires IndicatorState {
        let state = borrow_global_mut<IndicatorState>(indicator_addr);
        assert!(signer::address_of(owner) == state.owner, E_NOT_OWNER);
        state.keeper = new_keeper;
    }

    public entry fun set_graduated(
        owner: &signer, indicator_addr: address, vault_addr: address
    ) acquires IndicatorState {
        let state = borrow_global_mut<IndicatorState>(indicator_addr);
        assert!(signer::address_of(owner) == state.owner, E_NOT_OWNER);
        state.is_graduated = true;
        state.vault_addr   = vault_addr;
        event::emit(GraduatedEvent {
            indicator_addr,
            vault_addr,
            timestamp: timestamp::now_seconds(),
        });
    }

    // ─── Proprietary Indicator Support ───────────────────────────────

    /// Called by the indicator creator to mark it proprietary and commit
    /// the algorithm hash. Hash is SHA3-256(pine_script) computed off-chain.
    ///
    /// Idempotent: calling again updates the existing ProprietaryConfig.
    /// fee_bps:   Creator fee in basis points, max 1000 (10%).
    /// fee_model: 0=none, 1=flat_per_trade, 2=profit_share.
    ///
    /// Config is stored in the factory-level ProprietaryRegistry (Table keyed by indicator_addr)
    /// because Move's `move_to` requires the target address's signer, which is not
    /// available post-creation for Aptos Objects.
    public entry fun set_proprietary(
        caller:         &signer,
        indicator_addr: address,
        algo_hash:      vector<u8>,
        fee_bps:        u64,
        fee_model:      u8,
    ) acquires IndicatorState, ProprietaryRegistry {
        let caller_addr = signer::address_of(caller);
        let state = borrow_global<IndicatorState>(indicator_addr);
        assert!(caller_addr == state.owner, E_NOT_OWNER);
        assert!(fee_bps <= 1000, E_INVALID_PARAMS); // max 10%
        assert!(fee_model <= 2,  E_INVALID_PARAMS);

        let now = timestamp::now_seconds();
        let reg = borrow_global_mut<ProprietaryRegistry>(@cash_strategy);

        if (table::contains(&reg.configs, indicator_addr)) {
            let cfg = table::borrow_mut(&mut reg.configs, indicator_addr);
            cfg.is_proprietary    = true;
            cfg.algo_hash         = algo_hash;
            cfg.commit_ts         = now;
            cfg.creator_fee_bps   = fee_bps;
            cfg.creator_fee_model = fee_model;
        } else {
            table::add(&mut reg.configs, indicator_addr, ProprietaryConfig {
                is_proprietary:        true,
                algo_hash,
                commit_ts:             now,
                creator_fee_bps:       fee_bps,
                creator_fee_model:     fee_model,
                creator_earnings_usdt: 0,
            });
        };
    }

    /// Called by the keeper after a profitable trade closes.
    /// Records the creator fee based on profit_usdt_e6.
    /// No actual USDT transfer — the counter is used by the frontend/API.
    public entry fun record_creator_fee(
        keeper:         &signer,
        indicator_addr: address,
        profit_usdt_e6: u64,
    ) acquires IndicatorState, ProprietaryRegistry {
        let keeper_addr = signer::address_of(keeper);
        let state = borrow_global<IndicatorState>(indicator_addr);
        assert!(keeper_addr == state.keeper || keeper_addr == state.owner, E_NOT_KEEPER);

        if (!exists<ProprietaryRegistry>(@cash_strategy)) { return };
        let reg = borrow_global_mut<ProprietaryRegistry>(@cash_strategy);
        if (!table::contains(&reg.configs, indicator_addr)) { return };

        let cfg = table::borrow_mut(&mut reg.configs, indicator_addr);
        if (cfg.creator_fee_model == 0 || cfg.creator_fee_bps == 0) { return };

        let fee_collected_e6 = ((profit_usdt_e6 as u128) * (cfg.creator_fee_bps as u128) / 10000) as u64;
        cfg.creator_earnings_usdt = cfg.creator_earnings_usdt + fee_collected_e6;

        event::emit(CreatorEarningsEvent {
            indicator_addr,
            profit_usdt_e6,
            fee_collected_e6,
            total_earnings_e6: cfg.creator_earnings_usdt,
        });
    }

    /// Called by the creator to signal they are claiming accumulated earnings.
    /// Resets the earnings counter and emits an event — actual USDT payout
    /// is handled off-chain by the API/frontend.
    public entry fun claim_creator_earnings(
        creator:        &signer,
        indicator_addr: address,
    ) acquires IndicatorState, ProprietaryRegistry {
        let creator_addr = signer::address_of(creator);
        let state = borrow_global<IndicatorState>(indicator_addr);
        assert!(creator_addr == state.owner, E_NOT_OWNER);

        if (!exists<ProprietaryRegistry>(@cash_strategy)) { return };
        let reg = borrow_global_mut<ProprietaryRegistry>(@cash_strategy);
        if (!table::contains(&reg.configs, indicator_addr)) { return };

        let cfg = table::borrow_mut(&mut reg.configs, indicator_addr);
        let amount_e6 = cfg.creator_earnings_usdt;
        cfg.creator_earnings_usdt = 0;

        event::emit(CreatorClaimedEvent {
            indicator_addr,
            creator: creator_addr,
            amount_e6,
        });
    }

    // ─── Proprietary View ─────────────────────────────────────────────

    /// Returns (is_proprietary, algo_hash, creator_fee_bps, creator_fee_model, creator_earnings_usdt)
    /// Returns all-zero/false/empty if no ProprietaryConfig has been set.
    #[view]
    public fun get_creator_info(addr: address): (bool, vector<u8>, u64, u8, u64) acquires ProprietaryRegistry {
        if (!exists<ProprietaryRegistry>(@cash_strategy)) {
            return (false, vector::empty<u8>(), 0, 0, 0)
        };
        let reg = borrow_global<ProprietaryRegistry>(@cash_strategy);
        if (!table::contains(&reg.configs, addr)) {
            return (false, vector::empty<u8>(), 0, 0, 0)
        };
        let cfg = table::borrow(&reg.configs, addr);
        (cfg.is_proprietary, cfg.algo_hash, cfg.creator_fee_bps, cfg.creator_fee_model, cfg.creator_earnings_usdt)
    }
}
