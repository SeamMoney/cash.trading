module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market_config {
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0x1::option;
    use 0x1::string;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::math;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::oracle;
    use 0x1::vector;
    use 0x1::event;
    use 0x1::error;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::price_management;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::backstop_liquidator_profit_tracker;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::fee_distribution;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::trading_fees_manager;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::pending_order_tracker;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_positions;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::tp_sl_utils;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::open_interest_tracker;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_update;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::accounts_collateral;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::clearinghouse_perp;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::liquidation;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_matching_engine;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::admin_apis;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::slippage_math;
    struct MarketLiquidationConfig has copy, drop, store {
        margin_call_fee_pct: u64,
        margin_call_backstop_pct: u64,
        slippage_pcts: vector<u64>,
    }
    enum MarketMode has copy, drop, store {
        Open,
        ReduceOnly {
            reason: ReduceOnlyReason,
            allowlist: vector<address>,
        }
        AllowlistOnly {
            allowlist: vector<address>,
        }
        Halt,
        Delisting,
    }
    enum ReduceOnlyReason has copy, drop, store {
        OracleStale,
        AdminOperation,
    }
    enum MarketStatusChangeEvent has drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            mode: MarketMode,
            reason: option::Option<string::String>,
        }
    }
    enum PerpMarketConfig has key {
        V1 {
            name: string::String,
            sz_precision: math::Precision,
            min_size: u64,
            lot_size: u64,
            ticker_size: u64,
            max_leverage: u8,
            mode: MarketMode,
            previous_market_mode: option::Option<MarketMode>,
            oracle_source: oracle::OracleSource,
            adl_trigger_threshold: u64,
            liquidation_details: MarketLiquidationConfig,
        }
    }
    friend fun is_reduce_only(p0: object::Object<perp_market::PerpMarket>, p1: address): bool
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = &borrow_global<PerpMarketConfig>(_v0).mode;
        'l2: loop {
            'l1: loop {
                'l0: loop {
                    loop {
                        if (!(_v1 is Open)) {
                            if (_v1 is ReduceOnly) break;
                            if (_v1 is AllowlistOnly) break 'l0;
                            if (_v1 is Halt) break 'l1;
                            if (_v1 is Delisting) break 'l2;
                            abort 14566554180833181697
                        };
                        return false
                    };
                    let _v2 = &_v1.allowlist;
                    let _v3 = &p1;
                    return !vector::contains<address>(_v2, _v3)
                };
                return false
            };
            return false
        };
        false
    }
    friend fun register_market(p0: &signer, p1: string::String, p2: u8, p3: u64, p4: u64, p5: u64, p6: u8, p7: oracle::OracleSource) {
        assert!(p4 > 0, 2);
        assert!(p3 > 0, 1);
        assert!(p3 % p4 == 0, 1);
        assert!(p5 > 0, 3);
        let _v0 = math::new_precision(p2);
        let _v1 = MarketMode::Open{};
        let _v2 = option::none<MarketMode>();
        let _v3 = default_market_liquidation_config();
        let _v4 = PerpMarketConfig::V1{name: p1, sz_precision: _v0, min_size: p3, lot_size: p4, ticker_size: p5, max_leverage: p6, mode: _v1, previous_market_mode: _v2, oracle_source: p7, adl_trigger_threshold: 0, liquidation_details: _v3};
        move_to<PerpMarketConfig>(p0, _v4);
    }
    friend fun default_market_liquidation_config(): MarketLiquidationConfig {
        MarketLiquidationConfig{margin_call_fee_pct: 5000, margin_call_backstop_pct: 100, slippage_pcts: vector[5000, 10000, 15000]}
    }
    friend fun get_oracle_data(p0: object::Object<perp_market::PerpMarket>, p1: math::Precision): oracle::OracleData
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        oracle::get_oracle_data(&borrow_global<PerpMarketConfig>(_v0).oracle_source, p1)
    }
    friend fun update_internal_oracle_price(p0: object::Object<perp_market::PerpMarket>, p1: u64)
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        oracle::update_internal_oracle_price(&borrow_global<PerpMarketConfig>(_v0).oracle_source, p1);
    }
    friend fun update_oracle_status(p0: object::Object<perp_market::PerpMarket>, p1: math::Precision)
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        oracle::update_oracle_status(&mut borrow_global_mut<PerpMarketConfig>(_v0).oracle_source, p1);
    }
    friend fun allowlist_only(p0: object::Object<perp_market::PerpMarket>, p1: vector<address>, p2: option::Option<string::String>)
        acquires PerpMarketConfig
    {
        assert!(vector::length<address>(&p1) <= 100, 8);
        let _v0 = MarketMode::AllowlistOnly{allowlist: p1};
        set_market_mode(p0, _v0, p2);
    }
    fun set_market_mode(p0: object::Object<perp_market::PerpMarket>, p1: MarketMode, p2: option::Option<string::String>)
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global_mut<PerpMarketConfig>(_v0);
        let _v2 = &_v1.mode;
        let _v3 = &p1;
        if (_v2 == _v3) return ();
        let _v4 = &mut _v1.mode;
        *_v4 = p1;
        event::emit<MarketStatusChangeEvent>(MarketStatusChangeEvent::V1{market: p0, mode: p1, reason: p2});
    }
    friend fun can_place_order(p0: object::Object<perp_market::PerpMarket>, p1: address): bool
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = &borrow_global<PerpMarketConfig>(_v0).mode;
        'l2: loop {
            'l1: loop {
                'l0: loop {
                    loop {
                        if (!(_v1 is Open)) {
                            if (_v1 is ReduceOnly) break;
                            if (_v1 is AllowlistOnly) break 'l0;
                            if (_v1 is Halt) break 'l1;
                            if (_v1 is Delisting) break 'l2;
                            abort 14566554180833181697
                        };
                        return true
                    };
                    return true
                };
                let _v2 = &_v1.allowlist;
                let _v3 = &p1;
                return vector::contains<address>(_v2, _v3)
            };
            return false
        };
        false
    }
    friend fun can_settle_order(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: address): bool
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = &borrow_global<PerpMarketConfig>(_v0).mode;
        'l3: loop {
            'l2: loop {
                let _v2;
                'l0: loop {
                    'l1: loop {
                        loop {
                            if (!(_v1 is Open)) {
                                if (_v1 is ReduceOnly) break;
                                if (_v1 is AllowlistOnly) {
                                    _v2 = &_v1.allowlist;
                                    let _v3 = &p1;
                                    if (!vector::contains<address>(_v2, _v3)) break 'l0;
                                    break 'l1
                                };
                                if (_v1 is Halt) break 'l2;
                                if (_v1 is Delisting) break 'l3;
                                abort 14566554180833181697
                            };
                            return true
                        };
                        return true
                    };
                    return true
                };
                let _v4 = &p2;
                return vector::contains<address>(_v2, _v4)
            };
            return false
        };
        false
    }
    friend fun can_update_oracle(p0: object::Object<perp_market::PerpMarket>): bool
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = &borrow_global<PerpMarketConfig>(_v0).mode;
        'l2: loop {
            'l1: loop {
                'l0: loop {
                    loop {
                        if (!(_v1 is Open)) {
                            if (_v1 is ReduceOnly) break;
                            if (_v1 is AllowlistOnly) break 'l0;
                            if (_v1 is Halt) break 'l1;
                            if (_v1 is Delisting) break 'l2;
                            abort 14566554180833181697
                        };
                        return true
                    };
                    return true
                };
                return true
            };
            return false
        };
        false
    }
    friend fun delist_market(p0: object::Object<perp_market::PerpMarket>, p1: option::Option<string::String>)
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global_mut<PerpMarketConfig>(_v0);
        let _v2 = MarketMode::Delisting{};
        let _v3 = &mut _v1.mode;
        *_v3 = _v2;
        let _v4 = MarketMode::Delisting{};
        event::emit<MarketStatusChangeEvent>(MarketStatusChangeEvent::V1{market: p0, mode: _v4, reason: p1});
    }
    friend fun get_adl_trigger_threshold(p0: object::Object<perp_market::PerpMarket>): u64
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<PerpMarketConfig>(_v0).adl_trigger_threshold
    }
    friend fun get_lot_size(p0: object::Object<perp_market::PerpMarket>): u64
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<PerpMarketConfig>(_v0).lot_size
    }
    friend fun get_margin_call_backstop_pct(p0: object::Object<perp_market::PerpMarket>): u64
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&(&borrow_global<PerpMarketConfig>(_v0).liquidation_details).margin_call_backstop_pct
    }
    friend fun get_margin_call_fee_pct(p0: object::Object<perp_market::PerpMarket>): u64
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&(&borrow_global<PerpMarketConfig>(_v0).liquidation_details).margin_call_fee_pct
    }
    friend fun get_market_mode(p0: object::Object<perp_market::PerpMarket>): MarketMode
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<PerpMarketConfig>(_v0).mode
    }
    friend fun get_max_leverage(p0: object::Object<perp_market::PerpMarket>): u8
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<PerpMarketConfig>(_v0).max_leverage
    }
    friend fun get_min_size(p0: object::Object<perp_market::PerpMarket>): u64
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<PerpMarketConfig>(_v0).min_size
    }
    friend fun get_name(p0: object::Object<perp_market::PerpMarket>): string::String
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<PerpMarketConfig>(_v0).name
    }
    friend fun get_oracle_source(p0: object::Object<perp_market::PerpMarket>): oracle::OracleSource
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<PerpMarketConfig>(_v0).oracle_source
    }
    friend fun get_size_multiplier(p0: object::Object<perp_market::PerpMarket>): u64
        acquires PerpMarketConfig
    {
        let _v0 = get_sz_precision(p0);
        math::get_decimals_multiplier(&_v0)
    }
    friend fun get_sz_precision(p0: object::Object<perp_market::PerpMarket>): math::Precision
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<PerpMarketConfig>(_v0).sz_precision
    }
    friend fun get_slippage_and_margin_call_fee_scale(): u64 {
        1000000
    }
    friend fun get_slippage_pcts(p0: object::Object<perp_market::PerpMarket>): vector<u64>
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&(&borrow_global<PerpMarketConfig>(_v0).liquidation_details).slippage_pcts
    }
    friend fun get_sz_decimals(p0: object::Object<perp_market::PerpMarket>): u8
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        math::get_decimals(&borrow_global<PerpMarketConfig>(_v0).sz_precision)
    }
    friend fun get_ticker_size(p0: object::Object<perp_market::PerpMarket>): u64
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        *&borrow_global<PerpMarketConfig>(_v0).ticker_size
    }
    friend fun halt_market(p0: object::Object<perp_market::PerpMarket>, p1: option::Option<string::String>)
        acquires PerpMarketConfig
    {
        let _v0 = MarketMode::Halt{};
        set_market_mode(p0, _v0, p1);
    }
    friend fun is_allowlist_only(p0: object::Object<perp_market::PerpMarket>): bool
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        &borrow_global<PerpMarketConfig>(_v0).mode is AllowlistOnly
    }
    friend fun is_market_delisted(p0: object::Object<perp_market::PerpMarket>): bool
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        &borrow_global<PerpMarketConfig>(_v0).mode is Delisting
    }
    friend fun is_open(p0: object::Object<perp_market::PerpMarket>): bool
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        &borrow_global<PerpMarketConfig>(_v0).mode is Open
    }
    friend fun resume_market_to_previous_mode_from_reduce_only(p0: object::Object<perp_market::PerpMarket>)
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global_mut<PerpMarketConfig>(_v0);
        let _v2 = *&_v1.mode;
        let _v3 = &_v2;
        if (!((_v3 is ReduceOnly) && (&_v3.reason is OracleStale))) return ();
        let MarketMode::ReduceOnly{reason: _v4, allowlist: _v5} = _v2;
        let ReduceOnlyReason::OracleStale{} = _v4;
        let _v6 = option::destroy_some<MarketMode>(*&_v1.previous_market_mode);
        let _v7 = &mut _v1.mode;
        *_v7 = _v6;
        let _v8 = *&_v1.mode;
        let _v9 = option::some<string::String>(string::utf8(vector[79u8, 114u8, 97u8, 99u8, 108u8, 101u8, 32u8, 114u8, 101u8, 99u8, 111u8, 118u8, 101u8, 114u8, 101u8, 100u8, 32u8, 102u8, 114u8, 111u8, 109u8, 32u8, 115u8, 116u8, 97u8, 108u8, 101u8, 100u8, 32u8, 115u8, 116u8, 97u8, 116u8, 101u8]));
        event::emit<MarketStatusChangeEvent>(MarketStatusChangeEvent::V1{market: p0, mode: _v8, reason: _v9});
    }
    friend fun round_price_to_ticker(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: bool): u64
        acquires PerpMarketConfig
    {
        let _v0;
        let _v1 = get_ticker_size(p0);
        let _v2 = _v1;
        if (p2) {
            let _v3 = p1;
            let _v4 = _v2;
            if (_v3 == 0) if (_v4 != 0) _v0 = 0 else {
                let _v5 = error::invalid_argument(4);
                abort _v5
            } else _v0 = (_v3 - 1) / _v4 + 1
        } else _v0 = p1 / _v2;
        _v0 * _v1
    }
    friend fun set_adl_trigger_threshold(p0: object::Object<perp_market::PerpMarket>, p1: u64)
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = &mut borrow_global_mut<PerpMarketConfig>(_v0).adl_trigger_threshold;
        *_v1 = p1;
    }
    friend fun set_margin_call_backstop_pct(p0: object::Object<perp_market::PerpMarket>, p1: u64)
        acquires PerpMarketConfig
    {
        assert!(p1 <= 100, 14);
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = &mut (&mut borrow_global_mut<PerpMarketConfig>(_v0).liquidation_details).margin_call_backstop_pct;
        *_v1 = p1;
    }
    friend fun set_margin_call_fee_pct(p0: object::Object<perp_market::PerpMarket>, p1: u64)
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = &mut (&mut borrow_global_mut<PerpMarketConfig>(_v0).liquidation_details).margin_call_fee_pct;
        *_v1 = p1;
    }
    friend fun set_max_leverage(p0: object::Object<perp_market::PerpMarket>, p1: u8)
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = &mut borrow_global_mut<PerpMarketConfig>(_v0).max_leverage;
        *_v1 = p1;
    }
    friend fun set_open(p0: object::Object<perp_market::PerpMarket>, p1: option::Option<string::String>)
        acquires PerpMarketConfig
    {
        let _v0 = MarketMode::Open{};
        set_market_mode(p0, _v0, p1);
    }
    friend fun set_reduce_only(p0: object::Object<perp_market::PerpMarket>, p1: vector<address>, p2: option::Option<string::String>)
        acquires PerpMarketConfig
    {
        assert!(vector::length<address>(&p1) <= 100, 8);
        let _v0 = MarketMode::ReduceOnly{reason: ReduceOnlyReason::AdminOperation{}, allowlist: p1};
        set_market_mode(p0, _v0, p2);
    }
    friend fun set_reduce_only_on_orale_stale(p0: object::Object<perp_market::PerpMarket>, p1: vector<address>)
        acquires PerpMarketConfig
    {
        let _v0;
        assert!(vector::length<address>(&p1) <= 100, 8);
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = borrow_global_mut<PerpMarketConfig>(_v1);
        let _v3 = &_v2.mode is Open;
        loop {
            if (_v3) {
                _v0 = MarketMode::ReduceOnly{reason: ReduceOnlyReason::OracleStale{}, allowlist: p1};
                let _v4 = &_v2.mode;
                let _v5 = &_v0;
                if (!(_v4 == _v5)) break
            } else return ();
            return ()
        };
        let _v6 = option::some<MarketMode>(*&_v2.mode);
        let _v7 = &mut _v2.previous_market_mode;
        *_v7 = _v6;
        let _v8 = &mut _v2.mode;
        *_v8 = _v0;
        let _v9 = option::some<string::String>(string::utf8(vector[79u8, 114u8, 97u8, 99u8, 108u8, 101u8, 32u8, 115u8, 116u8, 97u8, 108u8, 101u8]));
        event::emit<MarketStatusChangeEvent>(MarketStatusChangeEvent::V1{market: p0, mode: _v0, reason: _v9});
    }
    friend fun set_slippage_pcts(p0: object::Object<perp_market::PerpMarket>, p1: vector<u64>)
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = &mut (&mut borrow_global_mut<PerpMarketConfig>(_v0).liquidation_details).slippage_pcts;
        *_v1 = p1;
    }
    friend fun validate_array_of_price_and_size(p0: object::Object<perp_market::PerpMarket>, p1: &vector<u64>, p2: &vector<u64>)
        acquires PerpMarketConfig
    {
        let _v0 = vector::length<u64>(p1);
        let _v1 = vector::length<u64>(p2);
        assert!(_v0 == _v1, 13);
        let _v2 = 0;
        let _v3 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v4 = borrow_global<PerpMarketConfig>(_v3);
        let _v5 = *&_v4.ticker_size;
        let _v6 = *&_v4.lot_size;
        let _v7 = *&_v4.min_size;
        let _v8 = math::get_decimals_multiplier(&_v4.sz_precision) as u128;
        'l0: loop {
            'l1: loop {
                'l2: loop {
                    'l3: loop {
                        'l4: loop {
                            'l5: loop {
                                loop {
                                    if (!(_v2 < _v0)) break 'l0;
                                    let _v9 = *vector::borrow<u64>(p1, _v2);
                                    let _v10 = *vector::borrow<u64>(p2, _v2);
                                    let _v11 = _v9;
                                    if (!(_v11 > 0)) break 'l1;
                                    if (!(_v11 % _v5 == 0)) break 'l2;
                                    let _v12 = _v10;
                                    if (!(_v12 > 0)) break 'l3;
                                    if (!(_v12 % _v6 == 0)) break 'l4;
                                    if (!(_v12 >= _v7)) break 'l5;
                                    let _v13 = _v9 as u128;
                                    let _v14 = _v10 as u128;
                                    let _v15 = _v13 * _v14;
                                    let _v16 = 9223372036854775807u128 * _v8;
                                    if (!(_v15 <= _v16)) break;
                                    _v2 = _v2 + 1;
                                    continue
                                };
                                abort 12
                            };
                            abort 4
                        };
                        abort 5
                    };
                    abort 11
                };
                abort 6
            };
            abort 10
        };
    }
    friend fun validate_price(p0: object::Object<perp_market::PerpMarket>, p1: u64)
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = *&borrow_global<PerpMarketConfig>(_v0).ticker_size;
        assert!(p1 > 0, 10);
        assert!(p1 % _v1 == 0, 6);
    }
    friend fun validate_price_and_size(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64, p3: bool)
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global<PerpMarketConfig>(_v0);
        let _v2 = *&_v1.ticker_size;
        let _v3 = p1;
        assert!(_v3 > 0, 10);
        assert!(_v3 % _v2 == 0, 6);
        let _v4 = *&_v1.lot_size;
        let _v5 = *&_v1.min_size;
        let _v6 = p2;
        assert!(_v6 > 0, 11);
        assert!(_v6 % _v4 == 0, 5);
        if (!p3) {
            assert!(_v6 >= _v5, 4)};
        let _v7 = p1 as u128;
        let _v8 = p2 as u128;
        let _v9 = _v7 * _v8;
        let _v10 = math::get_decimals_multiplier(&_v1.sz_precision) as u128;
        let _v11 = 9223372036854775807u128 * _v10;
        assert!(_v9 <= _v11, 12);
    }
    friend fun validate_price_and_size_allow_below_min_size(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64)
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global<PerpMarketConfig>(_v0);
        let _v2 = *&_v1.ticker_size;
        let _v3 = p1;
        assert!(_v3 > 0, 10);
        assert!(_v3 % _v2 == 0, 6);
        let _v4 = *&_v1.lot_size;
        let _v5 = *&_v1.min_size;
        let _v6 = p2;
        assert!(_v6 > 0, 11);
        assert!(_v6 % _v4 == 0, 5);
        let _v7 = p1 as u128;
        let _v8 = p2 as u128;
        let _v9 = _v7 * _v8;
        let _v10 = math::get_decimals_multiplier(&_v1.sz_precision) as u128;
        let _v11 = 9223372036854775807u128 * _v10;
        assert!(_v9 <= _v11, 12);
    }
    friend fun validate_size(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: bool)
        acquires PerpMarketConfig
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global<PerpMarketConfig>(_v0);
        let _v2 = *&_v1.lot_size;
        let _v3 = *&_v1.min_size;
        assert!(p1 > 0, 11);
        assert!(p1 % _v2 == 0, 5);
        if (!p2) {
            assert!(p1 >= _v3, 4);
            return ()
        };
    }
}
