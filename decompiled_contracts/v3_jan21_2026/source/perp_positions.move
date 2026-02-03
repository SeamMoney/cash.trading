module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_positions {
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::i64_aggregator;
    use 0x1::aggregator_v2;
    use 0x1::big_ordered_map;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::price_management;
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0x1::option;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::pending_order_tracker;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book_types;
    use 0x1::string;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::builder_code_registry;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::fee_distribution;
    use 0x1::signer;
    use 0x1::error;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::trading_fees_manager;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market_config;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::adl_tracker;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::liquidation_config;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::collateral_balance_sheet;
    use 0x1::ordered_map;
    use 0x1::event;
    use 0x1::math64;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_view_types;
    use 0x1::vector;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_tp_sl;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_update;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::order_margin;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::accounts_collateral;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::clearinghouse_perp;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::liquidation;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_matching_engine;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    struct AccountInfo has key {
        primary_account_addr: address,
    }
    struct AccountStatus has copy, drop {
        collateral_balance: i64,
        unrealized_pnl: i64,
        haircutted_upnl: i64,
        margin_for_max_leverage: u64,
        margin_for_free_collateral: u64,
        total_notional_value: u64,
    }
    struct AccountStatusCache has store {
        unrealized_pnl: i64_aggregator::I64Aggregator,
        haircutted_upnl: i64_aggregator::I64Aggregator,
        margin_for_max_leverage: aggregator_v2::Aggregator<u64>,
        margin_for_free_collateral: aggregator_v2::Aggregator<u64>,
        total_notional_value: aggregator_v2::Aggregator<u64>,
    }
    struct AccountStatusDetailed has drop {
        account_balance: i64,
        margin_for_max_leverage: u64,
        margin_for_free_collateral: u64,
        liquidation_margin: u64,
        backstop_liquidator_margin: u64,
        liquidation_margin_multiplier: u64,
        liquidation_margin_divisor: u64,
        backstop_liquidation_margin_multiplier: u64,
        backstop_liquidation_margin_divisor: u64,
        total_notional_value: u64,
    }
    enum Action has copy, drop, store {
        OpenLong,
        CloseLong,
        OpenShort,
        CloseShort,
    }
    struct CachedAccountStatusKey has copy, drop {
        account: address,
        for_free_collateral: bool,
    }
    enum CachedAccountStatuses has key {
        V1 {
            cached_statuses: big_ordered_map::BigOrderedMap<address, AccountStatusCache>,
        }
    }
    enum PerpPosition has copy, drop, store {
        V1 {
            size: u64,
            entry_px_times_size_sum: u128,
            avg_acquire_entry_px: u64,
            user_leverage: u8,
            is_long: bool,
            is_isolated: bool,
            funding_index_at_last_update: price_management::AccumulativeIndex,
            unrealized_funding_amount_before_last_update: i64,
        }
    }
    struct PerpPositionWithMarket has copy, drop {
        market: object::Object<perp_market::PerpMarket>,
        position: PerpPosition,
    }
    struct PositionInfo has drop {
        size: u64,
        is_long: bool,
        user_leverage: u8,
    }
    enum PositionUpdateEvent has copy, drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            user: address,
            is_long: bool,
            size: u64,
            user_leverage: u8,
            entry_price_times_size_sum: u128,
            is_isolated: bool,
            funding_index_at_last_update: i128,
            unrealized_funding_amount_before_last_update: i64,
            full_sized_tp: option::Option<pending_order_tracker::FullSizedTpSlForEvent>,
            fixed_sized_tps: vector<pending_order_tracker::FixedSizedTpSlForEvent>,
            full_sized_sl: option::Option<pending_order_tracker::FullSizedTpSlForEvent>,
            fixed_sized_sls: vector<pending_order_tracker::FixedSizedTpSlForEvent>,
        }
    }
    enum TradeEvent has drop, store {
        V1 {
            account: address,
            market: object::Object<perp_market::PerpMarket>,
            action: Action,
            source: TradeTriggerSource,
            order_id: option::Option<order_book_types::OrderId>,
            client_order_id: option::Option<string::String>,
            size: u64,
            price: u64,
            builder_code: option::Option<builder_code_registry::BuilderCode>,
            realized_pnl: i64,
            realized_funding_cost: i64,
            fee: i64,
            fill_id: u128,
            is_taker: bool,
            fee_distribution: fee_distribution::FeeDistribution,
        }
    }
    enum TradeTriggerSource has copy, drop, store {
        OrderFill,
        MarginCall,
        BackStopLiquidation,
        ADL,
        MarketDelisted,
    }
    struct UserPositions has key {
        positions: big_ordered_map::BigOrderedMap<object::Object<perp_market::PerpMarket>, PerpPosition>,
    }
    friend fun is_long(p0: &PerpPosition): bool {
        *&p0.is_long
    }
    friend fun is_isolated(p0: &PerpPosition): bool {
        *&p0.is_isolated
    }
    friend fun initialize(p0: &signer) {
        if (!(signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88)) {
            let _v0 = error::invalid_argument(28);
            abort _v0
        };
        let _v1 = CachedAccountStatuses::V1{cached_statuses: big_ordered_map::new_with_config<address,AccountStatusCache>(64u16, 3u16, true)};
        move_to<CachedAccountStatuses>(p0, _v1);
    }
    friend fun get_market(p0: &PerpPositionWithMarket): object::Object<perp_market::PerpMarket> {
        *&p0.market
    }
    public fun get_maker_volume_in_window(p0: address): u128
        acquires AccountInfo
    {
        trading_fees_manager::get_maker_volume_in_window(*&borrow_global<AccountInfo>(p0).primary_account_addr)
    }
    public fun get_taker_volume_in_window(p0: address): u128
        acquires AccountInfo
    {
        trading_fees_manager::get_taker_volume_in_window(*&borrow_global<AccountInfo>(p0).primary_account_addr)
    }
    friend fun update_position(p0: address, p1: bool, p2: bool, p3: object::Object<perp_market::PerpMarket>, p4: option::Option<order_book_types::OrderId>, p5: option::Option<string::String>, p6: u64, p7: bool, p8: u64, p9: option::Option<builder_code_registry::BuilderCode>, p10: i64, p11: price_management::AccumulativeIndex, p12: i64, p13: i64, p14: i64, p15: u128, p16: bool, p17: TradeTriggerSource, p18: fee_distribution::FeeDistribution): (u64, bool, u8)
        acquires CachedAccountStatuses, UserPositions
    {
        let _v0;
        let _v1 = &mut borrow_global_mut<UserPositions>(p0).positions;
        let _v2 = freeze(_v1);
        let _v3 = &p3;
        let _v4 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2, _v3);
        let _v5 = &_v4;
        let _v6 = freeze(_v1);
        let _v7 = big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(_v5, _v6);
        'l0: loop {
            let _v8;
            loop {
                let _v9;
                if (!_v7) {
                    let _v10;
                    let _v11;
                    if (p2) _v11 = false else _v11 = has_account_status_cache(p0);
                    if (_v11) {
                        let _v12 = freeze(_v1);
                        _v10 = option::some<PerpPosition>(*big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v4, _v12))
                    } else _v10 = option::none<PerpPosition>();
                    let _v13 = |arg0| lambda__1__update_position(p0, p1, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18, arg0);
                    _v8 = big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>,PerpPosition,PositionInfo>(_v4, _v1, _v13);
                    if (option::is_some<PerpPosition>(&_v10)) {
                        _v9 = option::borrow<PerpPosition>(&_v10);
                        let _v14 = freeze(_v1);
                        let _v15 = big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v4, _v14);
                        update_account_status_cache_for_position_change(p0, p3, _v9, _v15);
                        break
                    };
                    break
                };
                let _v16 = p6 as u128;
                let _v17 = p8 as u128;
                let _v18 = _v16 * _v17;
                let _v19 = perp_market_config::get_max_leverage(p3);
                let _v20 = new_perp_position_with_mode(p8, p3, _v18, _v19, p7, p2);
                _v9 = &_v20;
                emit_trade_event(p0, p3, _v9, p4, p5, p7, p8, p6, p9, p13, p12, p14, p15, p16, p17, p18);
                if (!p1) {
                    let _v21 = *&(&_v20).user_leverage;
                    adl_tracker::add_position(p3, p0, p7, p6, _v21)
                };
                _v0 = *&(&_v20).user_leverage;
                big_ordered_map::add<object::Object<perp_market::PerpMarket>,PerpPosition>(_v1, p3, _v20);
                let _v22 = freeze(_v1);
                let _v23 = &p3;
                _v9 = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v22, _v23);
                emit_position_update_event(_v9, p3, p0);
                if (p2) p1 = false else p1 = has_account_status_cache(p0);
                if (p1) {
                    let _v24 = new_empty_perp_position_with_mode(p3, _v0, p2);
                    let _v25 = &_v24;
                    update_account_status_cache_for_position_change(p0, p3, _v25, _v9);
                    break 'l0
                };
                break 'l0
            };
            let _v26 = *&(&_v8).size;
            let _v27 = *&(&_v8).is_long;
            let _v28 = *&(&_v8).user_leverage;
            return (_v26, _v27, _v28)
        };
        (p8, p7, _v0)
    }
    friend fun has_account_status_cache(p0: address): bool
        acquires CachedAccountStatuses
    {
        if (exists<CachedAccountStatuses>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88)) {
            let _v0 = &borrow_global<CachedAccountStatuses>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).cached_statuses;
            let _v1 = &p0;
            return big_ordered_map::contains<address,AccountStatusCache>(_v0, _v1)
        };
        false
    }
    fun lambda__1__update_position(p0: address, p1: bool, p2: object::Object<perp_market::PerpMarket>, p3: option::Option<order_book_types::OrderId>, p4: option::Option<string::String>, p5: u64, p6: bool, p7: u64, p8: option::Option<builder_code_registry::BuilderCode>, p9: i64, p10: price_management::AccumulativeIndex, p11: i64, p12: i64, p13: i64, p14: u128, p15: bool, p16: TradeTriggerSource, p17: fee_distribution::FeeDistribution, p18: &mut PerpPosition): PositionInfo {
        let _v0 = freeze(p18);
        emit_trade_event(p0, p2, _v0, p3, p4, p6, p7, p5, p8, p12, p11, p13, p14, p15, p16, p17);
        update_single_position(p2, p0, p1, p18, p5, p6, p7, p9, p10);
        emit_position_update_event(freeze(p18), p2, p0);
        let _v1 = *&p18.size;
        let _v2 = *&p18.is_long;
        let _v3 = *&p18.user_leverage;
        PositionInfo{size: _v1, is_long: _v2, user_leverage: _v3}
    }
    fun update_account_status_cache_for_position_change(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: &PerpPosition, p3: &PerpPosition)
        acquires CachedAccountStatuses
    {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4;
        let _v5;
        let _v6;
        let _v7;
        let _v8;
        let _v9;
        let _v10;
        let _v11 = exists<CachedAccountStatuses>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        'l0: loop {
            loop {
                if (_v11) {
                    let _v12;
                    let _v13;
                    let _v14;
                    let _v15;
                    let _v16;
                    let _v17;
                    let _v18;
                    let _v19;
                    let _v20;
                    let _v21;
                    let _v22;
                    let _v23;
                    let _v24;
                    let _v25;
                    let _v26;
                    let _v27;
                    let _v28;
                    let _v29;
                    let _v30;
                    let _v31 = &mut borrow_global_mut<CachedAccountStatuses>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).cached_statuses;
                    let _v32 = freeze(_v31);
                    let _v33 = &p0;
                    let _v34 = big_ordered_map::internal_find<address,AccountStatusCache>(_v32, _v33);
                    let _v35 = &_v34;
                    let _v36 = freeze(_v31);
                    if (big_ordered_map::iter_is_end<address,AccountStatusCache>(_v35, _v36)) break;
                    _v7 = big_ordered_map::iter_borrow_mut<address,AccountStatusCache>(_v34, _v31);
                    let _v37 = price_management::get_market_state_for_position_status(p1);
                    let _v38 = &_v37;
                    if (*&p2.is_isolated) {
                        _v6 = 0i64;
                        _v5 = 0i64;
                        _v10 = 0;
                        _v9 = 0;
                        _v8 = 0
                    } else {
                        _v19 = *&p2.is_long;
                        let (_v39,_v40,_v41,_v42,_v43,_v44) = price_management::get_market_state(_v38, _v19);
                        _v17 = _v43;
                        _v3 = _v42;
                        _v4 = _v41;
                        _v2 = _v39;
                        let _v45 = (*&p2.user_leverage) as u64;
                        let _v46 = _v17 as u64;
                        _v17 = math64::min(_v45, _v46) as u8;
                        if (*&p2.size != 0) {
                            let _v47;
                            _v12 = p2;
                            _v13 = _v4;
                            _v1 = pnl_with_funding_impl(_v12, _v13, _v40, _v2);
                            _v0 = _v1;
                            _v13 = _v3;
                            if (_v0 > 0i64) {
                                _v15 = _v0;
                                _v16 = _v13;
                                let _v48 = _v15 as i128;
                                let _v49 = _v16 as i128;
                                _v47 = (_v48 * _v49 / 10000i128) as i64
                            } else _v47 = 0i64;
                            let _v50 = *&p2.size;
                            let _v51 = _v44 as u64;
                            let _v52 = _v4 * _v51;
                            if (_v52 != 0) {
                                let _v53 = _v50 as u128;
                                let _v54 = _v2 as u128;
                                _v28 = _v53 * _v54;
                                _v27 = _v52 as u128;
                                if (_v28 == 0u128) if (_v27 != 0u128) _v26 = 0u128 else {
                                    let _v55 = error::invalid_argument(4);
                                    abort _v55
                                } else _v26 = (_v28 - 1u128) / _v27 + 1u128;
                                let _v56 = _v26 as u64;
                                _v29 = *&p2.size;
                                _v30 = _v2;
                                let _v57 = _v17 as u64;
                                _v25 = _v4 * _v57;
                                if (_v25 != 0) {
                                    let _v58 = _v29 as u128;
                                    let _v59 = _v30 as u128;
                                    _v22 = _v58 * _v59;
                                    _v21 = _v25 as u128;
                                    if (_v22 == 0u128) if (_v21 != 0u128) _v20 = 0u128 else {
                                        let _v60 = error::invalid_argument(4);
                                        abort _v60
                                    } else _v20 = (_v22 - 1u128) / _v21 + 1u128;
                                    _v24 = _v20 as u64;
                                    let _v61 = *&p2.size;
                                    _v23 = _v2;
                                    _v18 = _v4;
                                    if (_v18 != 0) {
                                        let _v62 = _v61 as u128;
                                        let _v63 = _v23 as u128;
                                        let _v64 = _v62 * _v63;
                                        let _v65 = _v18 as u128;
                                        let _v66 = (_v64 / _v65) as u64;
                                        _v6 = _v1;
                                        _v5 = _v47;
                                        _v10 = _v56;
                                        _v9 = _v24;
                                        _v8 = _v66
                                    } else {
                                        let _v67 = error::invalid_argument(4);
                                        abort _v67
                                    }
                                } else {
                                    let _v68 = error::invalid_argument(4);
                                    abort _v68
                                }
                            } else {
                                let _v69 = error::invalid_argument(4);
                                abort _v69
                            }
                        } else {
                            _v6 = 0i64;
                            _v5 = 0i64;
                            _v10 = 0;
                            _v9 = 0;
                            _v8 = 0
                        }
                    };
                    _v12 = p3;
                    let _v70 = &_v37;
                    if (*&_v12.is_isolated) {
                        _v1 = 0i64;
                        _v0 = 0i64;
                        _v2 = 0;
                        _v4 = 0;
                        _v3 = 0;
                        break 'l0
                    };
                    _v19 = *&_v12.is_long;
                    let (_v71,_v72,_v73,_v74,_v75,_v76) = price_management::get_market_state(_v70, _v19);
                    _v17 = _v75;
                    _v16 = _v73;
                    _v13 = _v71;
                    let _v77 = (*&_v12.user_leverage) as u64;
                    let _v78 = _v17 as u64;
                    _v17 = math64::min(_v77, _v78) as u8;
                    if (!(*&_v12.size != 0)) {
                        _v1 = 0i64;
                        _v0 = 0i64;
                        _v2 = 0;
                        _v4 = 0;
                        _v3 = 0;
                        break 'l0
                    };
                    let _v79 = pnl_with_funding_impl(_v12, _v16, _v72, _v13);
                    _v15 = _v79;
                    if (_v15 > 0i64) {
                        let _v80 = _v15 as i128;
                        let _v81 = _v74 as i128;
                        _v14 = (_v80 * _v81 / 10000i128) as i64
                    } else _v14 = 0i64;
                    _v30 = *&_v12.size;
                    let _v82 = _v76 as u64;
                    _v29 = _v16 * _v82;
                    if (!(_v29 != 0)) {
                        let _v83 = error::invalid_argument(4);
                        abort _v83
                    };
                    let _v84 = _v30 as u128;
                    let _v85 = _v13 as u128;
                    _v28 = _v84 * _v85;
                    _v27 = _v29 as u128;
                    if (_v28 == 0u128) if (_v27 != 0u128) _v26 = 0u128 else {
                        let _v86 = error::invalid_argument(4);
                        abort _v86
                    } else _v26 = (_v28 - 1u128) / _v27 + 1u128;
                    _v25 = _v26 as u64;
                    _v24 = *&_v12.size;
                    let _v87 = _v17 as u64;
                    _v23 = _v16 * _v87;
                    if (!(_v23 != 0)) {
                        let _v88 = error::invalid_argument(4);
                        abort _v88
                    };
                    let _v89 = _v24 as u128;
                    let _v90 = _v13 as u128;
                    _v22 = _v89 * _v90;
                    _v21 = _v23 as u128;
                    if (_v22 == 0u128) if (_v21 != 0u128) _v20 = 0u128 else {
                        let _v91 = error::invalid_argument(4);
                        abort _v91
                    } else _v20 = (_v22 - 1u128) / _v21 + 1u128;
                    _v18 = _v20 as u64;
                    let _v92 = *&_v12.size;
                    let _v93 = _v16;
                    if (!(_v93 != 0)) {
                        let _v94 = error::invalid_argument(4);
                        abort _v94
                    };
                    let _v95 = _v92 as u128;
                    let _v96 = _v13 as u128;
                    let _v97 = _v95 * _v96;
                    let _v98 = _v93 as u128;
                    let _v99 = (_v97 / _v98) as u64;
                    _v1 = _v79;
                    _v0 = _v14;
                    _v2 = _v25;
                    _v4 = _v18;
                    _v3 = _v99;
                    break 'l0
                };
                return ()
            };
            return ()
        };
        let _v100 = &mut _v7.unrealized_pnl;
        let _v101 = _v1 - _v6;
        i64_aggregator::add(_v100, _v101);
        let _v102 = &mut _v7.haircutted_upnl;
        let _v103 = _v0 - _v5;
        i64_aggregator::add(_v102, _v103);
        let _v104 = aggregator_v2::try_sub<u64>(&mut _v7.margin_for_max_leverage, _v10);
        let _v105 = aggregator_v2::try_add<u64>(&mut _v7.margin_for_max_leverage, _v2);
        let _v106 = aggregator_v2::try_sub<u64>(&mut _v7.margin_for_free_collateral, _v9);
        let _v107 = aggregator_v2::try_add<u64>(&mut _v7.margin_for_free_collateral, _v4);
        let _v108 = aggregator_v2::try_sub<u64>(&mut _v7.total_notional_value, _v8);
        let _v109 = aggregator_v2::try_add<u64>(&mut _v7.total_notional_value, _v3);
    }
    friend fun new_perp_position_with_mode(p0: u64, p1: object::Object<perp_market::PerpMarket>, p2: u128, p3: u8, p4: bool, p5: bool): PerpPosition {
        let _v0;
        let _v1;
        let _v2 = perp_market_config::get_max_leverage(p1);
        if (p3 > 0u8) _v1 = p3 <= _v2 else _v1 = false;
        if (!_v1) {
            let _v3 = error::invalid_argument(2);
            abort _v3
        };
        if (p0 == 0) _v0 = 0 else {
            let _v4 = p0 as u128;
            _v0 = (p2 / _v4) as u64
        };
        let _v5 = price_management::get_accumulative_index(p1);
        PerpPosition::V1{size: p0, entry_px_times_size_sum: p2, avg_acquire_entry_px: _v0, user_leverage: p3, is_long: p4, is_isolated: p5, funding_index_at_last_update: _v5, unrealized_funding_amount_before_last_update: 0i64}
    }
    fun emit_trade_event(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: &PerpPosition, p3: option::Option<order_book_types::OrderId>, p4: option::Option<string::String>, p5: bool, p6: u64, p7: u64, p8: option::Option<builder_code_registry::BuilderCode>, p9: i64, p10: i64, p11: i64, p12: u128, p13: bool, p14: TradeTriggerSource, p15: fee_distribution::FeeDistribution) {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        if (*&p2.is_long != p5) _v1 = *&p2.size != 0 else _v1 = false;
        'l1: loop {
            let _v4;
            let _v5;
            let _v6;
            'l0: loop {
                loop {
                    if (_v1) {
                        if (*&p2.size >= p6) {
                            _v0 = p0;
                            _v2 = p1;
                            if (*&p2.is_long) {
                                _v3 = Action::CloseLong{};
                                break
                            };
                            _v3 = Action::CloseShort{};
                            break
                        };
                        if (*&p2.is_long) _v3 = Action::CloseLong{} else _v3 = Action::CloseShort{};
                        let _v7 = *&p2.size;
                        event::emit<TradeEvent>(TradeEvent::V1{account: p0, market: p1, action: _v3, source: p14, order_id: p3, client_order_id: p4, size: _v7, price: p7, builder_code: p8, realized_pnl: p9, realized_funding_cost: p10, fee: p11, fill_id: p12, is_taker: p13, fee_distribution: p15});
                        _v6 = p0;
                        _v5 = p1;
                        if (p5) {
                            _v4 = Action::OpenLong{};
                            break 'l0
                        };
                        _v4 = Action::OpenShort{};
                        break 'l0
                    };
                    _v0 = p0;
                    _v2 = p1;
                    if (p5) {
                        _v3 = Action::OpenLong{};
                        break 'l1
                    };
                    _v3 = Action::OpenShort{};
                    break 'l1
                };
                event::emit<TradeEvent>(TradeEvent::V1{account: _v0, market: _v2, action: _v3, source: p14, order_id: p3, client_order_id: p4, size: p6, price: p7, builder_code: p8, realized_pnl: p9, realized_funding_cost: p10, fee: p11, fill_id: p12, is_taker: p13, fee_distribution: p15});
                return ()
            };
            let _v8 = *&p2.size;
            let _v9 = p6 - _v8;
            let _v10 = fee_distribution::zero_fees(collateral_balance_sheet::balance_type_cross(p0));
            event::emit<TradeEvent>(TradeEvent::V1{account: _v6, market: _v5, action: _v4, source: p14, order_id: p3, client_order_id: p4, size: _v9, price: p7, builder_code: p8, realized_pnl: 0i64, realized_funding_cost: 0i64, fee: 0i64, fill_id: p12, is_taker: p13, fee_distribution: _v10});
            return ()
        };
        event::emit<TradeEvent>(TradeEvent::V1{account: _v0, market: _v2, action: _v3, source: p14, order_id: p3, client_order_id: p4, size: p6, price: p7, builder_code: p8, realized_pnl: p9, realized_funding_cost: p10, fee: p11, fill_id: p12, is_taker: p13, fee_distribution: p15});
    }
    friend fun emit_position_update_event(p0: &PerpPosition, p1: object::Object<perp_market::PerpMarket>, p2: address) {
        let _v0 = *&p0.is_long;
        let (_v1,_v2,_v3,_v4) = pending_order_tracker::get_all_tp_sls_for_event(p2, p1, _v0);
        let _v5 = *&p0.is_long;
        let _v6 = *&p0.size;
        let _v7 = *&p0.entry_px_times_size_sum;
        let _v8 = *&p0.is_isolated;
        let _v9 = *&p0.user_leverage;
        let _v10 = price_management::accumulative_index(&p0.funding_index_at_last_update);
        let _v11 = *&p0.unrealized_funding_amount_before_last_update;
        event::emit<PositionUpdateEvent>(PositionUpdateEvent::V1{market: p1, user: p2, is_long: _v5, size: _v6, user_leverage: _v9, entry_price_times_size_sum: _v7, is_isolated: _v8, funding_index_at_last_update: _v10, unrealized_funding_amount_before_last_update: _v11, full_sized_tp: _v1, fixed_sized_tps: _v3, full_sized_sl: _v2, fixed_sized_sls: _v4});
    }
    friend fun new_empty_perp_position_with_mode(p0: object::Object<perp_market::PerpMarket>, p1: u8, p2: bool): PerpPosition {
        new_perp_position_with_mode(0, p0, 0u128, p1, true, p2)
    }
    friend fun account_initialized(p0: address): bool {
        exists<UserPositions>(p0)
    }
    friend fun add_liquidation_details(p0: AccountStatus, p1: &liquidation_config::LiquidationConfig): AccountStatusDetailed {
        let AccountStatus{collateral_balance: _v0, unrealized_pnl: _v1, haircutted_upnl: _v2, margin_for_max_leverage: _v3, margin_for_free_collateral: _v4, total_notional_value: _v5} = p0;
        let _v6 = _v3;
        let _v7 = _v0 + _v1;
        let _v8 = liquidation_config::get_liquidation_margin(p1, _v6, false);
        let _v9 = liquidation_config::get_liquidation_margin(p1, _v6, true);
        let _v10 = liquidation_config::maintenance_margin_leverage_multiplier(p1);
        let _v11 = liquidation_config::maintenance_margin_leverage_divisor(p1);
        let _v12 = liquidation_config::backstop_margin_maintenance_multiplier(p1);
        let _v13 = liquidation_config::backstop_margin_maintenance_divisor(p1);
        AccountStatusDetailed{account_balance: _v7, margin_for_max_leverage: _v6, margin_for_free_collateral: _v4, liquidation_margin: _v8, backstop_liquidator_margin: _v9, liquidation_margin_multiplier: _v10, liquidation_margin_divisor: _v11, backstop_liquidation_margin_multiplier: _v12, backstop_liquidation_margin_divisor: _v13, total_notional_value: _v5}
    }
    friend fun assert_user_initialized(p0: address) {
        assert!(exists<AccountInfo>(p0), 22);
    }
    friend fun calculate_backstop_liquidation_profit(p0: i64, p1: &AccountStatusDetailed, p2: &PerpPosition, p3: object::Object<perp_market::PerpMarket>): i64 {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4 = *&p2.size;
        loop {
            if (!(_v4 == 0)) {
                let _v5;
                _v3 = pnl_with_funding(p2, p3);
                let _v6 = price_management::get_mark_price(p3);
                let _v7 = perp_market_config::get_size_multiplier(p3);
                let _v8 = *&p2.size;
                let _v9 = perp_market_config::get_max_leverage(p3) as u64;
                let _v10 = _v7 * _v9;
                if (!(_v10 != 0)) {
                    let _v11 = error::invalid_argument(4);
                    abort _v11
                };
                let _v12 = _v8 as u128;
                let _v13 = _v6 as u128;
                let _v14 = _v12 * _v13;
                let _v15 = _v10 as u128;
                if (_v14 == 0u128) if (_v15 != 0u128) _v5 = 0u128 else {
                    let _v16 = error::invalid_argument(4);
                    abort _v16
                } else _v5 = (_v14 - 1u128) / _v15 + 1u128;
                _v2 = _v5 as u64;
                _v1 = p0;
                _v0 = *&p1.margin_for_free_collateral;
                if (_v0 != 0) break;
                abort 4
            };
            return 0i64
        };
        let _v17 = _v1 as i128;
        let _v18 = _v2 as i128;
        let _v19 = _v17 * _v18;
        let _v20 = _v0 as i128;
        ((_v19 / _v20) as i64) + _v3
    }
    fun pnl_with_funding(p0: &PerpPosition, p1: object::Object<perp_market::PerpMarket>): i64 {
        let _v0 = price_management::get_market_state_for_position_status(p1);
        let _v1 = &_v0;
        let _v2 = *&p0.is_long;
        let (_v3,_v4,_v5,_v6,_v7,_v8) = price_management::get_market_state(_v1, _v2);
        pnl_with_funding_impl(p0, _v5, _v4, _v3)
    }
    friend fun configure_user_settings_for_market(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: u8)
        acquires CachedAccountStatuses, UserPositions
    {
        let _v0;
        let _v1;
        let _v2 = signer::address_of(p0);
        let _v3 = perp_market_config::get_max_leverage(p1);
        if (p3 > 0u8) _v1 = p3 <= _v3 else _v1 = false;
        assert!(_v1, 2);
        let _v4 = &mut borrow_global_mut<UserPositions>(_v2).positions;
        let _v5 = freeze(_v4);
        let _v6 = &p1;
        let _v7 = big_ordered_map::get<object::Object<perp_market::PerpMarket>,PerpPosition>(_v5, _v6);
        if (option::is_some<PerpPosition>(&_v7)) _v0 = option::some<PerpPosition>(*option::borrow<PerpPosition>(&_v7)) else _v0 = option::none<PerpPosition>();
        let _v8 = option::is_some<PerpPosition>(&_v7);
        'l0: loop {
            let _v9;
            'l1: loop {
                'l2: loop {
                    loop {
                        let _v10;
                        if (_v8) {
                            let _v11;
                            let _v12 = option::destroy_some<PerpPosition>(_v7);
                            assert!(*&(&_v12).size == 0, 17);
                            if (*&(&_v12).user_leverage == p3) _v11 = *&(&_v12).is_isolated != p2 else _v11 = false;
                            if (_v11) break;
                            let _v13 = &p1;
                            let _v14 = big_ordered_map::remove<object::Object<perp_market::PerpMarket>,PerpPosition>(_v4, _v13);
                        };
                        let _v15 = new_empty_perp_position_with_mode(p1, p3, !p2);
                        _v9 = &_v15;
                        emit_position_update_event(_v9, p1, _v2);
                        big_ordered_map::add<object::Object<perp_market::PerpMarket>,PerpPosition>(_v4, p1, _v15);
                        let _v16 = freeze(_v4);
                        let _v17 = &p1;
                        _v9 = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v16, _v17);
                        let _v18 = *&_v9.size;
                        let _v19 = *&_v9.is_long;
                        let _v20 = *&_v9.user_leverage;
                        pending_order_tracker::update_position(_v2, p1, _v18, _v19, _v20);
                        if (p2) _v10 = has_account_status_cache(_v2) else _v10 = false;
                        if (!_v10) break 'l0;
                        if (!option::is_some<PerpPosition>(&_v0)) break 'l1;
                        break 'l2
                    };
                    return ()
                };
                let _v21 = option::borrow<PerpPosition>(&_v0);
                update_account_status_cache_for_position_change(_v2, p1, _v21, _v9);
                return ()
            };
            let _v22 = *&_v9.user_leverage;
            let _v23 = new_empty_perp_position_with_mode(p1, _v22, false);
            let _v24 = &_v23;
            update_account_status_cache_for_position_change(_v2, p1, _v24, _v9);
            return ()
        };
    }
    friend fun cross_position_status(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: option::Option<object::Object<perp_market::PerpMarket>>): AccountStatus
        acquires CachedAccountStatuses, UserPositions
    {
        let _v0;
        let _v1 = has_account_status_cache(p1);
        loop {
            let _v2;
            let _v3;
            let _v4;
            let _v5;
            let _v6;
            let _v7;
            if (_v1) {
                let _v8 = &borrow_global<CachedAccountStatuses>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).cached_statuses;
                let _v9 = &p1;
                let _v10 = big_ordered_map::borrow<address,AccountStatusCache>(_v8, _v9);
                let _v11 = i64_aggregator::read(&_v10.unrealized_pnl);
                let _v12 = i64_aggregator::read(&_v10.haircutted_upnl);
                let _v13 = aggregator_v2::read<u64>(&_v10.margin_for_max_leverage);
                let _v14 = aggregator_v2::read<u64>(&_v10.margin_for_free_collateral);
                let _v15 = aggregator_v2::read<u64>(&_v10.total_notional_value);
                if (option::is_some<object::Object<perp_market::PerpMarket>>(&p2)) {
                    _v5 = option::borrow<object::Object<perp_market::PerpMarket>>(&p2);
                    _v4 = &borrow_global<UserPositions>(p1).positions;
                    if (big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PerpPosition>(_v4, _v5)) {
                        _v7 = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v4, _v5);
                        if (*&_v7.is_isolated) _v6 = false else _v6 = *&_v7.size != 0;
                        if (_v6) {
                            _v2 = *_v5;
                            let (_v16,_v17,_v18,_v19,_v20) = get_position_contribution_for_cache(_v7, _v2);
                            _v11 = _v11 - _v16;
                            _v12 = _v12 - _v17;
                            _v13 = _v13 - _v18;
                            _v14 = _v14 - _v19;
                            _v15 = _v15 - _v20
                        }
                    }
                };
                let _v21 = collateral_balance_sheet::balance_type_cross(p1);
                _v3 = AccountStatus{collateral_balance: collateral_balance_sheet::total_asset_collateral_value(p0, _v21) as i64, unrealized_pnl: _v11, haircutted_upnl: _v12, margin_for_max_leverage: _v13, margin_for_free_collateral: _v14, total_notional_value: _v15};
                let _v22 = &_v3;
            } else {
                let _v23;
                let _v24 = p1;
                let _v25 = p2;
                let _v26 = collateral_balance_sheet::balance_type_cross(_v24);
                _v0 = AccountStatus{collateral_balance: collateral_balance_sheet::total_asset_collateral_value(p0, _v26) as i64, unrealized_pnl: 0i64, haircutted_upnl: 0i64, margin_for_max_leverage: 0, margin_for_free_collateral: 0, total_notional_value: 0};
                _v4 = &borrow_global<UserPositions>(_v24).positions;
                if (option::is_none<object::Object<perp_market::PerpMarket>>(&_v25)) {
                    let _v27 = _v4;
                    let _v28 = big_ordered_map::internal_leaf_new_begin_iter<object::Object<perp_market::PerpMarket>,PerpPosition>(_v27);
                    while (!big_ordered_map::internal_leaf_iter_is_end(&_v28)) {
                        let (_v29,_v30) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index<object::Object<perp_market::PerpMarket>,PerpPosition>(_v28, _v27);
                        _v23 = _v29;
                        let _v31 = ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v23);
                        while (!ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v31, _v23)) {
                            _v5 = ordered_map::iter_borrow_key<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v31, _v23);
                            _v7 = big_ordered_map::internal_leaf_borrow_value<PerpPosition>(ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v31, _v23));
                            if (!*&_v7.is_isolated) {
                                let _v32 = &mut _v0;
                                _v2 = *_v5;
                                update_position_status_to_add_position(_v32, _v7, _v2)
                            };
                            _v31 = ordered_map::iter_next<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v31, _v23)
                        };
                        _v28 = _v30;
                        continue
                    };
                    break
                } else {
                    let _v33 = option::destroy_some<object::Object<perp_market::PerpMarket>>(_v25);
                    let _v34 = big_ordered_map::internal_leaf_new_begin_iter<object::Object<perp_market::PerpMarket>,PerpPosition>(_v4);
                    while (!big_ordered_map::internal_leaf_iter_is_end(&_v34)) {
                        let (_v35,_v36) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index<object::Object<perp_market::PerpMarket>,PerpPosition>(_v34, _v4);
                        _v23 = _v35;
                        let _v37 = ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v23);
                        while (!ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v37, _v23)) {
                            _v5 = ordered_map::iter_borrow_key<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v37, _v23);
                            _v7 = big_ordered_map::internal_leaf_borrow_value<PerpPosition>(ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v37, _v23));
                            let _v38 = &_v33;
                            if (_v5 != _v38) _v6 = !*&_v7.is_isolated else _v6 = false;
                            if (_v6) {
                                let _v39 = &mut _v0;
                                _v2 = *_v5;
                                update_position_status_to_add_position(_v39, _v7, _v2)
                            };
                            _v37 = ordered_map::iter_next<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v37, _v23);
                            continue
                        };
                        _v34 = _v36;
                        continue
                    };
                    break
                }
            };
            return _v3
        };
        _v0
    }
    fun get_position_contribution_for_cache(p0: &PerpPosition, p1: object::Object<perp_market::PerpMarket>): (i64, i64, u64, u64, u64) {
        let _v0;
        if (*&p0.is_isolated) _v0 = true else _v0 = *&p0.size == 0;
        'l0: loop {
            let _v1;
            let _v2;
            let _v3;
            let _v4;
            let _v5;
            let _v6;
            let _v7;
            loop {
                if (!_v0) {
                    let _v8;
                    let _v9;
                    let _v10 = price_management::get_market_state_for_position_status(p1);
                    let _v11 = p0;
                    let _v12 = &_v10;
                    let _v13 = *&_v11.is_long;
                    let (_v14,_v15,_v16,_v17,_v18,_v19) = price_management::get_market_state(_v12, _v13);
                    let _v20 = _v18;
                    let _v21 = _v16;
                    let _v22 = _v14;
                    let _v23 = (*&_v11.user_leverage) as u64;
                    let _v24 = _v20 as u64;
                    _v20 = math64::min(_v23, _v24) as u8;
                    if (!(*&_v11.size != 0)) break 'l0;
                    _v7 = pnl_with_funding_impl(_v11, _v21, _v15, _v22);
                    let _v25 = _v7;
                    if (_v25 > 0i64) {
                        let _v26 = _v25 as i128;
                        let _v27 = _v17 as i128;
                        _v1 = (_v26 * _v27 / 10000i128) as i64
                    } else _v1 = 0i64;
                    let _v28 = *&_v11.size;
                    let _v29 = _v19 as u64;
                    let _v30 = _v21 * _v29;
                    if (!(_v30 != 0)) {
                        let _v31 = error::invalid_argument(4);
                        abort _v31
                    };
                    let _v32 = _v28 as u128;
                    let _v33 = _v22 as u128;
                    let _v34 = _v32 * _v33;
                    let _v35 = _v30 as u128;
                    if (_v34 == 0u128) if (_v35 != 0u128) _v9 = 0u128 else {
                        let _v36 = error::invalid_argument(4);
                        abort _v36
                    } else _v9 = (_v34 - 1u128) / _v35 + 1u128;
                    _v5 = _v9 as u64;
                    let _v37 = *&_v11.size;
                    let _v38 = _v20 as u64;
                    let _v39 = _v21 * _v38;
                    if (!(_v39 != 0)) {
                        let _v40 = error::invalid_argument(4);
                        abort _v40
                    };
                    let _v41 = _v37 as u128;
                    let _v42 = _v22 as u128;
                    let _v43 = _v41 * _v42;
                    let _v44 = _v39 as u128;
                    if (_v43 == 0u128) if (_v44 != 0u128) _v8 = 0u128 else {
                        let _v45 = error::invalid_argument(4);
                        abort _v45
                    } else _v8 = (_v43 - 1u128) / _v44 + 1u128;
                    _v4 = _v8 as u64;
                    _v3 = *&_v11.size;
                    _v2 = _v22;
                    _v6 = _v21;
                    if (_v6 != 0) break;
                    let _v46 = error::invalid_argument(4);
                    abort _v46
                };
                return (0i64, 0i64, 0, 0, 0)
            };
            let _v47 = _v3 as u128;
            let _v48 = _v2 as u128;
            let _v49 = _v47 * _v48;
            let _v50 = _v6 as u128;
            let _v51 = (_v49 / _v50) as u64;
            return (_v7, _v1, _v5, _v4, _v51)
        };
        (0i64, 0i64, 0, 0, 0)
    }
    friend fun update_position_status_to_add_position(p0: &mut AccountStatus, p1: &PerpPosition, p2: object::Object<perp_market::PerpMarket>) {
        if (*&p1.size != 0) {
            let _v0;
            let _v1;
            let _v2;
            let _v3;
            let _v4;
            let _v5 = price_management::get_market_state_for_position_status(p2);
            let _v6 = p1;
            let _v7 = &_v5;
            let _v8 = *&_v6.is_long;
            let (_v9,_v10,_v11,_v12,_v13,_v14) = price_management::get_market_state(_v7, _v8);
            let _v15 = _v13;
            let _v16 = _v11;
            let _v17 = _v9;
            let _v18 = (*&_v6.user_leverage) as u64;
            let _v19 = _v15 as u64;
            _v15 = math64::min(_v18, _v19) as u8;
            if (*&_v6.size != 0) {
                let _v20;
                let _v21 = pnl_with_funding_impl(_v6, _v16, _v10, _v17);
                let _v22 = _v21;
                if (_v22 > 0i64) {
                    let _v23 = _v22 as i128;
                    let _v24 = _v12 as i128;
                    _v20 = (_v23 * _v24 / 10000i128) as i64
                } else _v20 = 0i64;
                let _v25 = *&_v6.size;
                let _v26 = _v14 as u64;
                let _v27 = _v16 * _v26;
                if (_v27 != 0) {
                    let _v28;
                    let _v29 = _v25 as u128;
                    let _v30 = _v17 as u128;
                    let _v31 = _v29 * _v30;
                    let _v32 = _v27 as u128;
                    if (_v31 == 0u128) if (_v32 != 0u128) _v28 = 0u128 else {
                        let _v33 = error::invalid_argument(4);
                        abort _v33
                    } else _v28 = (_v31 - 1u128) / _v32 + 1u128;
                    let _v34 = _v28 as u64;
                    let _v35 = *&_v6.size;
                    let _v36 = _v15 as u64;
                    let _v37 = _v16 * _v36;
                    if (_v37 != 0) {
                        let _v38;
                        let _v39 = _v35 as u128;
                        let _v40 = _v17 as u128;
                        let _v41 = _v39 * _v40;
                        let _v42 = _v37 as u128;
                        if (_v41 == 0u128) if (_v42 != 0u128) _v38 = 0u128 else {
                            let _v43 = error::invalid_argument(4);
                            abort _v43
                        } else _v38 = (_v41 - 1u128) / _v42 + 1u128;
                        let _v44 = _v38 as u64;
                        let _v45 = *&_v6.size;
                        let _v46 = _v16;
                        if (_v46 != 0) {
                            let _v47 = _v45 as u128;
                            let _v48 = _v17 as u128;
                            let _v49 = _v47 * _v48;
                            let _v50 = _v46 as u128;
                            _v4 = (_v49 / _v50) as u64;
                            _v3 = _v21;
                            _v2 = _v20;
                            _v1 = _v34;
                            _v0 = _v44
                        } else {
                            let _v51 = error::invalid_argument(4);
                            abort _v51
                        }
                    } else {
                        let _v52 = error::invalid_argument(4);
                        abort _v52
                    }
                } else {
                    let _v53 = error::invalid_argument(4);
                    abort _v53
                }
            } else {
                _v3 = 0i64;
                _v2 = 0i64;
                _v1 = 0;
                _v0 = 0;
                _v4 = 0
            };
            let _v54 = &mut p0.haircutted_upnl;
            *_v54 = *_v54 + _v2;
            _v54 = &mut p0.unrealized_pnl;
            *_v54 = *_v54 + _v3;
            let _v55 = &mut p0.margin_for_max_leverage;
            *_v55 = *_v55 + _v1;
            _v55 = &mut p0.margin_for_free_collateral;
            *_v55 = *_v55 + _v0;
            _v55 = &mut p0.total_notional_value;
            *_v55 = *_v55 + _v4;
            return ()
        };
    }
    friend fun free_collateral_for_crossed(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: i64): u64
        acquires CachedAccountStatuses, UserPositions
    {
        let _v0;
        let _v1 = option::none<object::Object<perp_market::PerpMarket>>();
        let _v2 = cross_position_status(p0, p1, _v1);
        let _v3 = get_account_balance(&_v2);
        let _v4 = *&(&_v2).haircutted_upnl;
        let _v5 = (*&(&_v2).margin_for_free_collateral) as i64;
        if (_v4 > _v5) _v0 = _v4 else _v0 = _v5;
        let _v6 = _v3 - _v0 - p2;
        if (_v6 > 0i64) return _v6 as u64;
        0
    }
    friend fun get_account_balance(p0: &AccountStatus): i64 {
        let _v0 = *&p0.collateral_balance;
        let _v1 = *&p0.unrealized_pnl;
        _v0 + _v1
    }
    friend fun free_collateral_for_crossed_and_account_status(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: i64): (u64, AccountStatus)
        acquires CachedAccountStatuses, UserPositions
    {
        let _v0;
        let _v1 = option::none<object::Object<perp_market::PerpMarket>>();
        let _v2 = cross_position_status(p0, p1, _v1);
        let _v3 = get_account_balance(&_v2);
        let _v4 = *&(&_v2).haircutted_upnl;
        let _v5 = (*&(&_v2).margin_for_free_collateral) as i64;
        if (_v4 > _v5) _v0 = _v4 else _v0 = _v5;
        let _v6 = _v3 - _v0 - p2;
        if (_v6 > 0i64) return (_v6 as u64, _v2);
        (0, _v2)
    }
    friend fun get_account_balance_from_detailed_status(p0: &AccountStatusDetailed): i64 {
        *&p0.account_balance
    }
    friend fun get_account_net_asset_value(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address): i64
        acquires UserPositions
    {
        let _v0 = collateral_balance_sheet::balance_type_cross(p1);
        let _v1 = collateral_balance_sheet::total_asset_collateral_value(p0, _v0) as i64;
        let _v2 = &borrow_global<UserPositions>(p1).positions;
        let _v3 = big_ordered_map::internal_leaf_new_begin_iter<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2);
        while (!big_ordered_map::internal_leaf_iter_is_end(&_v3)) {
            let (_v4,_v5) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, _v2);
            let _v6 = _v4;
            let _v7 = ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v6);
            while (!ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v7, _v6)) {
                let _v8 = ordered_map::iter_borrow_key<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v7, _v6);
                let _v9 = big_ordered_map::internal_leaf_borrow_value<PerpPosition>(ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v7, _v6));
                let _v10 = *_v8;
                let _v11 = get_position_net_asset_value(_v9, _v10);
                _v1 = _v1 + _v11;
                if (*&_v9.is_isolated) {
                    let _v12 = *_v8;
                    let _v13 = collateral_balance_sheet::balance_type_isolated(p1, _v12);
                    _v11 = collateral_balance_sheet::total_asset_collateral_value(p0, _v13) as i64;
                    _v1 = _v1 + _v11
                };
                _v7 = ordered_map::iter_next<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v7, _v6);
                continue
            };
            _v3 = _v5;
            continue
        };
        _v1
    }
    friend fun get_position_net_asset_value(p0: &PerpPosition, p1: object::Object<perp_market::PerpMarket>): i64 {
        if (*&p0.size != 0) {
            let _v0 = price_management::get_market_state_for_position_status(p1);
            let _v1 = &_v0;
            let _v2 = *&p0.is_long;
            let (_v3,_v4,_v5,_v6,_v7,_v8) = price_management::get_market_state(_v1, _v2);
            return pnl_with_funding_impl(p0, _v5, _v4, _v3)
        };
        0i64
    }
    friend fun get_backstop_liquidation_margin_divisor_from_detailed_status(p0: &AccountStatusDetailed): u64 {
        *&p0.backstop_liquidation_margin_divisor
    }
    friend fun get_backstop_liquidation_margin_multiplier_from_detailed_status(p0: &AccountStatusDetailed): u64 {
        *&p0.backstop_liquidation_margin_multiplier
    }
    friend fun get_backstop_liquidator_margin_from_detailed_status(p0: &AccountStatusDetailed): u64 {
        *&p0.backstop_liquidator_margin
    }
    friend fun get_entry_px_times_size_sum(p0: &PerpPosition): u128 {
        *&p0.entry_px_times_size_sum
    }
    friend fun get_fixed_sized_tp_sl_from_event(p0: &PositionUpdateEvent, p1: bool): vector<pending_order_tracker::FixedSizedTpSlForEvent> {
        if (p1) return *&p0.fixed_sized_tps;
        *&p0.fixed_sized_sls
    }
    friend fun get_full_sized_tp_sl_from_event(p0: &PositionUpdateEvent, p1: bool): option::Option<pending_order_tracker::FullSizedTpSlForEvent> {
        if (p1) return *&p0.full_sized_tp;
        *&p0.full_sized_sl
    }
    friend fun get_liquidation_margin_divisor_from_detailed_status(p0: &AccountStatusDetailed): u64 {
        *&p0.liquidation_margin_divisor
    }
    friend fun get_liquidation_margin_from_detailed_status(p0: &AccountStatusDetailed): u64 {
        *&p0.liquidation_margin
    }
    friend fun get_liquidation_margin_multiplier_from_detailed_status(p0: &AccountStatusDetailed): u64 {
        *&p0.liquidation_margin_multiplier
    }
    friend fun get_margin_for_free_collateral(p0: &AccountStatus): u64 {
        *&p0.margin_for_free_collateral
    }
    friend fun get_margin_for_max_leverage(p0: &AccountStatus): u64 {
        *&p0.margin_for_max_leverage
    }
    friend fun get_open_interest_delta_for_long(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: u64): i64
        acquires UserPositions
    {
        let _v0 = exists<UserPositions>(p0);
        'l4: loop {
            'l5: loop {
                'l1: loop {
                    let _v1;
                    'l2: loop {
                        'l3: loop {
                            'l0: loop {
                                loop {
                                    if (_v0) {
                                        let _v2 = &borrow_global<UserPositions>(p0).positions;
                                        let _v3 = &p1;
                                        let _v4 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2, _v3);
                                        if (!big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v4, _v2)) {
                                            _v1 = big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v4, _v2);
                                            if (*&_v1.is_long) {
                                                if (!p2) break 'l0;
                                                break
                                            };
                                            if (!p2) break 'l1;
                                            let _v5 = *&_v1.size;
                                            if (!(p3 < _v5)) break 'l2;
                                            break 'l3
                                        }
                                    };
                                    if (!p2) break 'l4;
                                    break 'l5
                                };
                                return p3 as i64
                            };
                            let _v6 = *&_v1.size;
                            return -(math64::min(p3, _v6) as i64)
                        };
                        return 0i64
                    };
                    let _v7 = *&_v1.size;
                    return (p3 - _v7) as i64
                };
                return 0i64
            };
            return p3 as i64
        };
        0i64
    }
    friend fun get_perp_position(p0: &PerpPositionWithMarket): &PerpPosition {
        &p0.position
    }
    fun pnl_with_funding_impl(p0: &PerpPosition, p1: u64, p2: price_management::AccumulativeIndex, p3: u64): i64 {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4 = p3 as u128;
        let _v5 = (*&p0.size) as u128;
        let _v6 = _v4 * _v5;
        let _v7 = *&p0.entry_px_times_size_sum;
        if (_v6 >= _v7) {
            _v1 = *&p0.is_long;
            let _v8 = *&p0.entry_px_times_size_sum;
            _v0 = _v6 - _v8
        } else {
            _v1 = !*&p0.is_long;
            _v0 = *&p0.entry_px_times_size_sum - _v6
        };
        let _v9 = _v0;
        let _v10 = p1 as u128;
        if (_v1) _v3 = _v9 / _v10 else {
            let _v11 = _v9;
            let _v12 = _v10;
            if (_v11 == 0u128) if (_v12 != 0u128) _v3 = 0u128 else {
                let _v13 = error::invalid_argument(4);
                abort _v13
            } else _v3 = (_v11 - 1u128) / _v12 + 1u128
        };
        p3 = _v3 as u64;
        if (_v1) _v2 = p3 as i64 else _v2 = -(p3 as i64);
        let (_v14,_v15) = get_position_funding_cost_and_index_impl(p0, p1, p2);
        _v2 - _v14
    }
    friend fun get_position_details_or_default(p0: address, p1: object::Object<perp_market::PerpMarket>): (u64, bool, u8)
        acquires UserPositions
    {
        let (_v0,_v1,_v2) = get_position_info_or_default(p0, p1, true);
        (_v0, _v1, _v2)
    }
    friend fun get_position_info_or_default(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool): (u64, bool, u8)
        acquires UserPositions
    {
        if (exists<UserPositions>(p0)) {
            let _v0 = &borrow_global<UserPositions>(p0).positions;
            let _v1 = &p1;
            let _v2 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v0, _v1);
            if (!big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v2, _v0)) {
                let _v3 = big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2, _v0);
                let _v4 = *&_v3.size;
                let _v5 = *&_v3.is_long;
                let _v6 = *&_v3.user_leverage;
                return (_v4, _v5, _v6)
            };
            let _v7 = perp_market_config::get_max_leverage(p1);
            return (0, p2, _v7)
        };
        let _v8 = perp_market_config::get_max_leverage(p1);
        (0, p2, _v8)
    }
    friend fun get_position_entry_px_times_size_sum(p0: address, p1: object::Object<perp_market::PerpMarket>): u128
        acquires UserPositions
    {
        let _v0 = p1;
        let _v1 = &borrow_global<UserPositions>(p0).positions;
        let _v2 = &_v0;
        let _v3 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v1, _v2);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v3, _v1)) {
            let _v4 = error::invalid_argument(7);
            abort _v4
        };
        *&big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, _v1).entry_px_times_size_sum
    }
    friend fun get_position_funding_cost_and_index(p0: &PerpPosition, p1: object::Object<perp_market::PerpMarket>): (i64, price_management::AccumulativeIndex) {
        let _v0 = perp_market_config::get_size_multiplier(p1);
        let _v1 = price_management::get_accumulative_index(p1);
        let (_v2,_v3) = get_position_funding_cost_and_index_impl(p0, _v0, _v1);
        (_v2, _v3)
    }
    fun get_position_funding_cost_and_index_impl(p0: &PerpPosition, p1: u64, p2: price_management::AccumulativeIndex): (i64, price_management::AccumulativeIndex) {
        let _v0 = &p0.funding_index_at_last_update;
        let _v1 = &p2;
        let _v2 = *&p0.size;
        let _v3 = *&p0.is_long;
        let _v4 = price_management::get_funding_cost(_v0, _v1, _v2, p1, _v3);
        (*&p0.unrealized_funding_amount_before_last_update + _v4, p2)
    }
    friend fun get_position_funding_index_at_last_update(p0: address, p1: object::Object<perp_market::PerpMarket>): price_management::AccumulativeIndex
        acquires UserPositions
    {
        let _v0 = p1;
        let _v1 = &borrow_global<UserPositions>(p0).positions;
        let _v2 = &_v0;
        let _v3 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v1, _v2);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v3, _v1)) {
            let _v4 = error::invalid_argument(7);
            abort _v4
        };
        *&big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, _v1).funding_index_at_last_update
    }
    friend fun get_position_is_long(p0: address, p1: object::Object<perp_market::PerpMarket>): bool
        acquires UserPositions
    {
        let _v0 = p1;
        let _v1 = &borrow_global<UserPositions>(p0).positions;
        let _v2 = &_v0;
        let _v3 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v1, _v2);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v3, _v1)) {
            let _v4 = error::invalid_argument(7);
            abort _v4
        };
        *&big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, _v1).is_long
    }
    friend fun get_position_size(p0: address, p1: object::Object<perp_market::PerpMarket>): u64
        acquires UserPositions
    {
        if (exists<UserPositions>(p0)) {
            let _v0 = &borrow_global<UserPositions>(p0).positions;
            let _v1 = &p1;
            let _v2 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v0, _v1);
            if (!big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v2, _v0)) return *&big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2, _v0).size;
            return 0
        };
        0
    }
    friend fun get_position_size_and_is_long(p0: address, p1: object::Object<perp_market::PerpMarket>): (u64, bool)
        acquires UserPositions
    {
        let _v0 = p1;
        let _v1 = &borrow_global<UserPositions>(p0).positions;
        let _v2 = &_v0;
        let _v3 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v1, _v2);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v3, _v1)) {
            let _v4 = error::invalid_argument(7);
            abort _v4
        };
        let _v5 = big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, _v1);
        let _v6 = *&_v5.size;
        let _v7 = *&_v5.is_long;
        (_v6, _v7)
    }
    friend fun get_position_unrealized_funding_amount_before_last_update(p0: address, p1: object::Object<perp_market::PerpMarket>): i64
        acquires UserPositions
    {
        let _v0 = p1;
        let _v1 = &borrow_global<UserPositions>(p0).positions;
        let _v2 = &_v0;
        let _v3 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v1, _v2);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v3, _v1)) {
            let _v4 = error::invalid_argument(7);
            abort _v4
        };
        *&big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, _v1).unrealized_funding_amount_before_last_update
    }
    friend fun get_position_unrealized_funding_cost(p0: address, p1: object::Object<perp_market::PerpMarket>): i64
        acquires UserPositions
    {
        let _v0 = p1;
        let _v1 = &borrow_global<UserPositions>(p0).positions;
        let _v2 = &_v0;
        let _v3 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v1, _v2);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v3, _v1)) {
            let _v4 = error::invalid_argument(7);
            abort _v4
        };
        let (_v5,_v6) = get_position_funding_cost_and_index(big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, _v1), p1);
        _v5
    }
    public fun get_primary_account_addr(p0: address): address
        acquires AccountInfo
    {
        *&borrow_global<AccountInfo>(p0).primary_account_addr
    }
    friend fun get_size(p0: &PerpPosition): u64 {
        *&p0.size
    }
    friend fun get_total_notional_value_from_detailed_status(p0: &AccountStatusDetailed): u64 {
        *&p0.total_notional_value
    }
    friend fun get_user_leverage(p0: &PerpPosition): u8 {
        *&p0.user_leverage
    }
    friend fun has_any_assets_or_positions(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address): bool
        acquires UserPositions
    {
        let _v0 = collateral_balance_sheet::balance_type_cross(p1);
        let _v1 = collateral_balance_sheet::has_any_assets(p0, _v0);
        'l0: loop {
            'l1: loop {
                'l3: loop {
                    'l2: loop {
                        if (!_v1) {
                            if (!exists<UserPositions>(p1)) break 'l0;
                            let _v2 = &borrow_global<UserPositions>(p1).positions;
                            let _v3 = big_ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2);
                            loop {
                                if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v3, _v2)) break 'l1;
                                let _v4 = big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, _v2);
                                if (*&_v4.size > 0) break 'l2;
                                if (*&_v4.is_isolated) {
                                    let _v5 = *big_ordered_map::iter_borrow_key<object::Object<perp_market::PerpMarket>>(&_v3);
                                    let _v6 = collateral_balance_sheet::balance_type_isolated(p1, _v5);
                                    if (collateral_balance_sheet::has_any_assets(p0, _v6)) break 'l3
                                };
                                _v3 = big_ordered_map::iter_next<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, _v2);
                                continue
                            }
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
    friend fun has_crossed_position(p0: address): bool
        acquires UserPositions
    {
        if (exists<UserPositions>(p0)) {
            let _v0 = &borrow_global<UserPositions>(p0).positions;
            let _v1 = big_ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>,PerpPosition>(_v0);
            'l0: loop {
                loop {
                    let _v2;
                    if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v1, _v0)) break 'l0;
                    let _v3 = big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v1, _v0);
                    if (*&_v3.is_isolated) _v2 = false else _v2 = *&_v3.size > 0;
                    if (_v2) break;
                    _v1 = big_ordered_map::iter_next<object::Object<perp_market::PerpMarket>,PerpPosition>(_v1, _v0);
                    continue
                };
                return true
            };
            return false
        };
        false
    }
    friend fun has_isolated_position(p0: address, p1: object::Object<perp_market::PerpMarket>): bool
        acquires UserPositions
    {
        if (exists<UserPositions>(p0)) {
            let _v0;
            let _v1 = &borrow_global<UserPositions>(p0).positions;
            let _v2 = &p1;
            if (big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PerpPosition>(_v1, _v2)) {
                let _v3 = &p1;
                let _v4 = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v1, _v3);
                if (*&_v4.is_isolated) _v0 = *&_v4.size > 0 else _v0 = false
            } else _v0 = false;
            return _v0
        };
        false
    }
    friend fun has_position(p0: address, p1: object::Object<perp_market::PerpMarket>): bool
        acquires UserPositions
    {
        if (exists<UserPositions>(p0)) {
            let _v0 = &borrow_global<UserPositions>(p0).positions;
            let _v1 = &p1;
            if (big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PerpPosition>(_v0, _v1)) {
                let _v2 = &p1;
                return *&big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v0, _v2).size > 0
            };
            return false
        };
        false
    }
    friend fun increase_collateral_balance_for_status(p0: &mut AccountStatus, p1: i64) {
        let _v0 = &mut p0.collateral_balance;
        *_v0 = *_v0 + p1;
    }
    friend fun init_account_status_cache(p0: address)
        acquires CachedAccountStatuses, UserPositions
    {
        let _v0 = &mut borrow_global_mut<CachedAccountStatuses>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).cached_statuses;
        let _v1 = freeze(_v0);
        let _v2 = &p0;
        if (!big_ordered_map::contains<address,AccountStatusCache>(_v1, _v2)) {
            let _v3 = 0i64;
            let _v4 = 0i64;
            let _v5 = 0;
            let _v6 = 0;
            let _v7 = 0;
            if (exists<UserPositions>(p0)) {
                let _v8 = &borrow_global<UserPositions>(p0).positions;
                let _v9 = big_ordered_map::internal_leaf_new_begin_iter<object::Object<perp_market::PerpMarket>,PerpPosition>(_v8);
                while (!big_ordered_map::internal_leaf_iter_is_end(&_v9)) {
                    let (_v10,_v11) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index<object::Object<perp_market::PerpMarket>,PerpPosition>(_v9, _v8);
                    let _v12 = _v10;
                    let _v13 = ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v12);
                    while (!ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v13, _v12)) {
                        let _v14 = ordered_map::iter_borrow_key<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v13, _v12);
                        let _v15 = big_ordered_map::internal_leaf_borrow_value<PerpPosition>(ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v13, _v12));
                        let _v16 = *_v14;
                        let (_v17,_v18,_v19,_v20,_v21) = get_position_contribution_for_cache(_v15, _v16);
                        _v3 = _v3 + _v17;
                        _v4 = _v4 + _v18;
                        _v5 = _v5 + _v19;
                        _v6 = _v6 + _v20;
                        _v7 = _v7 + _v21;
                        _v13 = ordered_map::iter_next<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v13, _v12);
                        continue
                    };
                    _v9 = _v11;
                    continue
                }
            };
            let _v22 = i64_aggregator::new_i64_aggregator_with_value(_v3);
            let _v23 = i64_aggregator::new_i64_aggregator_with_value(_v4);
            let _v24 = aggregator_v2::create_unbounded_aggregator_with_value<u64>(_v5);
            let _v25 = aggregator_v2::create_unbounded_aggregator_with_value<u64>(_v6);
            let _v26 = aggregator_v2::create_unbounded_aggregator_with_value<u64>(_v7);
            let _v27 = AccountStatusCache{unrealized_pnl: _v22, haircutted_upnl: _v23, margin_for_max_leverage: _v24, margin_for_free_collateral: _v25, total_notional_value: _v26};
            big_ordered_map::add<address,AccountStatusCache>(_v0, p0, _v27);
            return ()
        };
    }
    friend fun init_user_if_new(p0: &signer, p1: address)
        acquires AccountInfo
    {
        let _v0 = signer::address_of(p0);
        if (!exists<UserPositions>(_v0)) {
            let _v1 = UserPositions{positions: big_ordered_map::new_with_config<object::Object<perp_market::PerpMarket>,PerpPosition>(64u16, 16u16, false)};
            move_to<UserPositions>(p0, _v1)
        };
        if (exists<AccountInfo>(_v0)) if (*&borrow_global<AccountInfo>(_v0).primary_account_addr == p1) () else abort 27 else {
            let _v2 = AccountInfo{primary_account_addr: p1};
            move_to<AccountInfo>(p0, _v2)
        };
        pending_order_tracker::initialize_account_summary(_v0);
    }
    friend fun is_account_liquidatable(p0: &AccountStatus, p1: &liquidation_config::LiquidationConfig, p2: bool): bool {
        let _v0 = *&p0.margin_for_max_leverage;
        let _v1 = liquidation_config::get_liquidation_margin(p1, _v0, p2);
        let _v2 = get_account_balance(p0);
        let _v3 = _v1 as i64;
        _v2 < _v3
    }
    friend fun is_account_liquidatable_detailed(p0: &AccountStatusDetailed, p1: bool): bool {
        if (p1) {
            let _v0 = *&p0.account_balance;
            let _v1 = (*&p0.backstop_liquidator_margin) as i64;
            return _v0 < _v1
        };
        let _v2 = *&p0.account_balance;
        let _v3 = (*&p0.liquidation_margin) as i64;
        _v2 < _v3
    }
    friend fun is_max_allowed_withdraw_from_cross_margin_at_least(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: i64, p3: u64): bool
        acquires CachedAccountStatuses, UserPositions
    {
        max_allowed_primary_asset_withdraw_from_cross_margin(p0, p1, p2) >= p3
    }
    friend fun max_allowed_primary_asset_withdraw_from_cross_margin(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: i64): u64
        acquires CachedAccountStatuses, UserPositions
    {
        let _v0;
        let _v1;
        let _v2 = option::none<object::Object<perp_market::PerpMarket>>();
        let _v3 = cross_position_status(p0, p1, _v2);
        let _v4 = get_account_balance(&_v3);
        let _v5 = *&(&_v3).haircutted_upnl;
        let _v6 = (*&(&_v3).margin_for_free_collateral) as i64;
        if (_v5 > _v6) _v1 = _v5 else _v1 = _v6;
        let _v7 = _v4 - _v1 - p2;
        let _v8 = collateral_balance_sheet::balance_type_cross(p1);
        let _v9 = collateral_balance_sheet::balance_of_primary_asset(p0, _v8) - p2;
        let _v10 = *&(&_v3).unrealized_pnl;
        let _v11 = _v9 + _v10;
        if (_v7 < _v11) _v0 = _v7 else _v0 = _v11;
        if (_v0 > 0i64) return _v0 as u64;
        0
    }
    friend fun is_position_isolated(p0: address, p1: object::Object<perp_market::PerpMarket>): bool
        acquires UserPositions
    {
        if (exists<UserPositions>(p0)) {
            let _v0 = &borrow_global<UserPositions>(p0).positions;
            let _v1 = &p1;
            let _v2 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v0, _v1);
            if (!big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v2, _v0)) return *&big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2, _v0).is_isolated;
            return false
        };
        false
    }
    friend fun is_position_liquidatable(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: &liquidation_config::LiquidationConfig, p2: address, p3: object::Object<perp_market::PerpMarket>, p4: bool): bool
        acquires CachedAccountStatuses, UserPositions
    {
        if (!exists<UserPositions>(p2)) return false;
        let _v0 = position_status(p0, p2, p3);
        is_account_liquidatable(&_v0, p1, p4)
    }
    friend fun position_status(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: object::Object<perp_market::PerpMarket>): AccountStatus
        acquires CachedAccountStatuses, UserPositions
    {
        let _v0 = p2;
        let _v1 = &borrow_global<UserPositions>(p1).positions;
        let _v2 = &_v0;
        let _v3 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v1, _v2);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v3, _v1)) {
            let _v4 = error::invalid_argument(7);
            abort _v4
        };
        let _v5 = big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, _v1);
        if (*&_v5.is_isolated) return isolated_position_status(p0, p1, _v5, p2);
        let _v6 = option::none<object::Object<perp_market::PerpMarket>>();
        cross_position_status(p0, p1, _v6)
    }
    friend fun isolated_position_status(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: &PerpPosition, p3: object::Object<perp_market::PerpMarket>): AccountStatus {
        let _v0 = collateral_balance_sheet::balance_type_isolated(p1, p3);
        let _v1 = AccountStatus{collateral_balance: collateral_balance_sheet::total_asset_collateral_value(p0, _v0) as i64, unrealized_pnl: 0i64, haircutted_upnl: 0i64, margin_for_max_leverage: 0, margin_for_free_collateral: 0, total_notional_value: 0};
        update_position_status_to_add_position(&mut _v1, p2, p3);
        _v1
    }
    friend fun list_positions(p0: address): vector<position_view_types::PositionViewInfo>
        acquires UserPositions
    {
        let _v0 = vector::empty<position_view_types::PositionViewInfo>();
        let _v1 = &borrow_global<UserPositions>(p0).positions;
        let _v2 = big_ordered_map::internal_leaf_new_begin_iter<object::Object<perp_market::PerpMarket>,PerpPosition>(_v1);
        while (!big_ordered_map::internal_leaf_iter_is_end(&_v2)) {
            let (_v3,_v4) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2, _v1);
            let _v5 = _v3;
            let _v6 = ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v5);
            while (!ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v6, _v5)) {
                let _v7 = ordered_map::iter_borrow_key<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v6, _v5);
                let _v8 = big_ordered_map::internal_leaf_borrow_value<PerpPosition>(ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v6, _v5));
                if (*&_v8.size != 0) {
                    let _v9 = &mut _v0;
                    let _v10 = *_v7;
                    let _v11 = *&_v8.size;
                    let _v12 = *&_v8.entry_px_times_size_sum;
                    let _v13 = *&_v8.avg_acquire_entry_px;
                    let _v14 = *&_v8.user_leverage;
                    let _v15 = *&_v8.is_long;
                    let _v16 = *&_v8.is_isolated;
                    let _v17 = *&_v8.funding_index_at_last_update;
                    let _v18 = *&_v8.unrealized_funding_amount_before_last_update;
                    let _v19 = position_view_types::new_position_view_info(_v10, _v11, _v12, _v13, _v14, _v15, _v16, _v17, _v18);
                    vector::push_back<position_view_types::PositionViewInfo>(_v9, _v19)
                };
                _v6 = ordered_map::iter_next<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v6, _v5);
                continue
            };
            _v2 = _v4;
            continue
        };
        _v0
    }
    fun margin_required(p0: &PerpPosition, p1: object::Object<perp_market::PerpMarket>): u64 {
        let _v0;
        let _v1 = perp_market_config::get_size_multiplier(p1);
        let _v2 = price_management::get_mark_price(p1);
        let _v3 = *&p0.size;
        let _v4 = (*&p0.user_leverage) as u64;
        let _v5 = _v1 * _v4;
        if (!(_v5 != 0)) {
            let _v6 = error::invalid_argument(4);
            abort _v6
        };
        let _v7 = _v3 as u128;
        let _v8 = _v2 as u128;
        let _v9 = _v7 * _v8;
        let _v10 = _v5 as u128;
        if (_v9 == 0u128) if (_v10 != 0u128) _v0 = 0u128 else {
            let _v11 = error::invalid_argument(4);
            abort _v11
        } else _v0 = (_v9 - 1u128) / _v10 + 1u128;
        _v0 as u64
    }
    friend fun max_allowed_primary_asset_withdraw_from_isolated_margin(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: object::Object<perp_market::PerpMarket>): u64
        acquires UserPositions
    {
        let _v0;
        let _v1;
        let _v2 = p2;
        let _v3 = &borrow_global<UserPositions>(p1).positions;
        let _v4 = &_v2;
        let _v5 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, _v4);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v5, _v3)) {
            let _v6 = error::invalid_argument(7);
            abort _v6
        };
        let _v7 = big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v5, _v3);
        if (!*&_v7.is_isolated) {
            let _v8 = error::invalid_argument(7);
            abort _v8
        };
        let _v9 = _v7;
        let _v10 = margin_required(_v9, p2);
        let _v11 = pnl_with_funding(_v9, p2);
        let _v12 = price_management::get_unrealized_pnl_haircut_bps(p2);
        let _v13 = _v11;
        if (_v13 > 0i64) {
            let _v14 = _v13 as i128;
            let _v15 = _v12 as i128;
            _v0 = (_v14 * _v15 / 10000i128) as i64
        } else _v0 = 0i64;
        let _v16 = collateral_balance_sheet::balance_type_isolated(p1, p2);
        let _v17 = (collateral_balance_sheet::total_asset_collateral_value(p0, _v16) as i64) + _v11;
        let _v18 = _v0;
        let _v19 = _v10 as i64;
        if (_v18 > _v19) _v1 = _v18 else _v1 = _v19;
        let _v20 = _v17 - _v1;
        if (_v20 > 0i64) return _v20 as u64;
        0
    }
    friend fun may_be_find_position(p0: address, p1: object::Object<perp_market::PerpMarket>): option::Option<PerpPosition>
        acquires UserPositions
    {
        if (exists<UserPositions>(p0)) {
            let _v0 = &borrow_global<UserPositions>(p0).positions;
            let _v1 = &p1;
            return big_ordered_map::get<object::Object<perp_market::PerpMarket>,PerpPosition>(_v0, _v1)
        };
        option::none<PerpPosition>()
    }
    friend fun must_find_position_copy(p0: address, p1: object::Object<perp_market::PerpMarket>): PerpPosition
        acquires UserPositions
    {
        let _v0 = &borrow_global<UserPositions>(p0).positions;
        let _v1 = &p1;
        let _v2 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v0, _v1);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v2, _v0)) {
            let _v3 = error::invalid_argument(7);
            abort _v3
        };
        *big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2, _v0)
    }
    friend fun new_account_status(p0: i64): AccountStatus {
        AccountStatus{collateral_balance: p0, unrealized_pnl: 0i64, haircutted_upnl: 0i64, margin_for_max_leverage: 0, margin_for_free_collateral: 0, total_notional_value: 0}
    }
    friend fun new_empty_perp_position(p0: object::Object<perp_market::PerpMarket>, p1: u8): PerpPosition {
        new_perp_position_with_mode(0, p0, 0u128, p1, true, false)
    }
    friend fun new_perp_position(p0: u64, p1: object::Object<perp_market::PerpMarket>, p2: u128, p3: u8, p4: bool): PerpPosition {
        new_perp_position_with_mode(p0, p1, p2, p3, p4, false)
    }
    friend fun new_trade_trigger_source_adl(): TradeTriggerSource {
        TradeTriggerSource::ADL{}
    }
    friend fun new_trade_trigger_source_backstop_liquidation(): TradeTriggerSource {
        TradeTriggerSource::BackStopLiquidation{}
    }
    friend fun new_trade_trigger_source_margin_call(): TradeTriggerSource {
        TradeTriggerSource::MarginCall{}
    }
    friend fun new_trade_trigger_source_market_delisted(): TradeTriggerSource {
        TradeTriggerSource::MarketDelisted{}
    }
    friend fun new_trade_trigger_source_order_fill(): TradeTriggerSource {
        TradeTriggerSource::OrderFill{}
    }
    friend fun positions_to_liquidate(p0: address, p1: object::Object<perp_market::PerpMarket>): vector<PerpPositionWithMarket>
        acquires UserPositions
    {
        let _v0;
        let _v1;
        let _v2 = &borrow_global<UserPositions>(p0).positions;
        let _v3 = &p1;
        let _v4 = big_ordered_map::get<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2, _v3);
        let _v5 = option::is_some<PerpPosition>(&_v4);
        'l1: loop {
            let _v6;
            let _v7;
            'l0: loop {
                let _v8;
                loop {
                    let _v9;
                    let _v10;
                    let _v11;
                    let _v12;
                    let _v13;
                    if (_v5) {
                        _v8 = option::destroy_some<PerpPosition>(_v4);
                        if (*&(&_v8).is_isolated) break else {
                            let _v14 = big_ordered_map::keys<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2);
                            _v13 = &_v14;
                            let _v15 = vector::empty<PerpPositionWithMarket>();
                            _v12 = 0;
                            _v11 = vector::length<object::Object<perp_market::PerpMarket>>(_v13);
                            while (_v12 < _v11) {
                                _v10 = vector::borrow<object::Object<perp_market::PerpMarket>>(_v13, _v12);
                                let _v16 = &mut _v15;
                                let _v17 = *_v10;
                                let _v18 = *big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2, _v10);
                                let _v19 = PerpPositionWithMarket{market: _v17, position: _v18};
                                vector::push_back<PerpPositionWithMarket>(_v16, _v19);
                                _v12 = _v12 + 1;
                                continue
                            };
                            _v7 = vector::empty<PerpPositionWithMarket>();
                            let _v20 = _v15;
                            vector::reverse<PerpPositionWithMarket>(&mut _v20);
                            _v6 = _v20;
                            _v12 = vector::length<PerpPositionWithMarket>(&_v6);
                            loop {
                                if (!(_v12 > 0)) break 'l0;
                                let _v21 = vector::pop_back<PerpPositionWithMarket>(&mut _v6);
                                if (!*&(&(&_v21).position).is_isolated) vector::push_back<PerpPositionWithMarket>(&mut _v7, _v21);
                                _v12 = _v12 - 1;
                                continue
                            }
                        }
                    } else {
                        let _v22 = big_ordered_map::keys<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2);
                        _v13 = &_v22;
                        _v9 = vector::empty<PerpPositionWithMarket>();
                        _v12 = 0;
                        _v11 = vector::length<object::Object<perp_market::PerpMarket>>(_v13)
                    };
                    while (_v12 < _v11) {
                        _v10 = vector::borrow<object::Object<perp_market::PerpMarket>>(_v13, _v12);
                        let _v23 = &mut _v9;
                        let _v24 = *_v10;
                        let _v25 = *big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2, _v10);
                        let _v26 = PerpPositionWithMarket{market: _v24, position: _v25};
                        vector::push_back<PerpPositionWithMarket>(_v23, _v26);
                        _v12 = _v12 + 1;
                        continue
                    };
                    _v0 = vector::empty<PerpPositionWithMarket>();
                    let _v27 = _v9;
                    vector::reverse<PerpPositionWithMarket>(&mut _v27);
                    _v1 = _v27;
                    _v12 = vector::length<PerpPositionWithMarket>(&_v1);
                    loop {
                        if (!(_v12 > 0)) break 'l1;
                        let _v28 = vector::pop_back<PerpPositionWithMarket>(&mut _v1);
                        if (!*&(&(&_v28).position).is_isolated) vector::push_back<PerpPositionWithMarket>(&mut _v0, _v28);
                        _v12 = _v12 - 1;
                        continue
                    };
                    break
                };
                let _v29 = PerpPositionWithMarket{market: p1, position: _v8};
                let _v30 = vector::empty<PerpPositionWithMarket>();
                vector::push_back<PerpPositionWithMarket>(&mut _v30, _v29);
                return _v30
            };
            vector::destroy_empty<PerpPositionWithMarket>(_v6);
            return _v7
        };
        vector::destroy_empty<PerpPositionWithMarket>(_v1);
        _v0
    }
    friend fun transfer_balance_to_liquidator(p0: &mut collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: address, p3: object::Object<perp_market::PerpMarket>)
        acquires UserPositions
    {
        if (is_position_isolated(p2, p3)) {
            let _v0 = collateral_balance_sheet::balance_type_isolated(p2, p3);
            let _v1 = collateral_balance_sheet::balance_type_cross(p1);
            collateral_balance_sheet::transfer_to_backstop_liquidator(p0, _v0, _v1);
            return ()
        };
        let _v2 = collateral_balance_sheet::balance_type_cross(p2);
        let _v3 = collateral_balance_sheet::balance_type_cross(p1);
        collateral_balance_sheet::transfer_to_backstop_liquidator(p0, _v2, _v3);
    }
    friend fun transfer_margin_to_isolated_position(p0: &mut collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: object::Object<perp_market::PerpMarket>, p3: bool, p4: u64)
        acquires CachedAccountStatuses, UserPositions
    {
        assert!(is_position_isolated(p1, p2), 7);
        'l0: loop {
            loop {
                if (p3) {
                    if (is_max_allowed_withdraw_from_cross_margin_at_least(freeze(p0), p1, 0i64, p4)) break;
                    abort 6
                };
                if (max_allowed_primary_asset_withdraw_from_isolated_margin(freeze(p0), p1, p2) >= p4) break 'l0;
                abort 6
            };
            let _v0 = collateral_balance_sheet::change_type_user_movement();
            collateral_balance_sheet::transfer_from_crossed_to_isolated(p0, p1, p4, p2, _v0);
            return ()
        };
        let _v1 = collateral_balance_sheet::change_type_user_movement();
        collateral_balance_sheet::transfer_from_isolated_to_crossed(p0, p1, p4, p2, _v1);
    }
    friend fun update_account_status_cache_on_market_state_change(p0: object::Object<perp_market::PerpMarket>, p1: price_management::MarketState, p2: price_management::MarketState)
        acquires CachedAccountStatuses, UserPositions
    {
        let _v0 = exists<CachedAccountStatuses>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        'l0: loop {
            if (_v0) {
                let _v1 = &mut borrow_global_mut<CachedAccountStatuses>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).cached_statuses;
                let _v2 = big_ordered_map::internal_new_begin_iter<address,AccountStatusCache>(freeze(_v1));
                loop {
                    let _v3 = &_v2;
                    let _v4 = freeze(_v1);
                    if (big_ordered_map::iter_is_end<address,AccountStatusCache>(_v3, _v4)) break 'l0;
                    let _v5 = *big_ordered_map::iter_borrow_key<address>(&_v2);
                    let _v6 = &_v5;
                    let _v7 = big_ordered_map::iter_borrow_mut<address,AccountStatusCache>(_v2, _v1);
                    let _v8 = *_v6;
                    let _v9 = &p1;
                    let _v10 = &p2;
                    update_single_account_on_status_cache_on_market_state_change(_v8, p0, _v9, _v10, _v7);
                    let _v11 = freeze(_v1);
                    _v2 = big_ordered_map::iter_next<address,AccountStatusCache>(_v2, _v11);
                    continue
                }
            };
            return ()
        };
    }
    fun update_single_account_on_status_cache_on_market_state_change(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: &price_management::MarketState, p3: &price_management::MarketState, p4: &mut AccountStatusCache)
        acquires UserPositions
    {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4;
        let _v5;
        let _v6;
        let _v7;
        let _v8;
        let _v9;
        let _v10 = exists<UserPositions>(p0);
        'l1: loop {
            'l0: loop {
                loop {
                    if (_v10) {
                        let _v11;
                        let _v12;
                        let _v13;
                        let _v14;
                        let _v15;
                        let _v16 = &borrow_global<UserPositions>(p0).positions;
                        let _v17 = &p1;
                        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PerpPosition>(_v16, _v17)) break;
                        let _v18 = &p1;
                        let _v19 = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v16, _v18);
                        if (*&_v19.is_isolated) _v15 = true else _v15 = *&_v19.size == 0;
                        if (_v15) break 'l0;
                        let _v20 = _v19;
                        let _v21 = *&_v20.is_long;
                        let (_v22,_v23,_v24,_v25,_v26,_v27) = price_management::get_market_state(p2, _v21);
                        let _v28 = _v26;
                        let _v29 = _v24;
                        let _v30 = _v22;
                        let _v31 = (*&_v20.user_leverage) as u64;
                        let _v32 = _v28 as u64;
                        _v28 = math64::min(_v31, _v32) as u8;
                        if (*&_v20.size != 0) {
                            let _v33;
                            _v11 = _v20;
                            let _v34 = pnl_with_funding_impl(_v11, _v29, _v23, _v30);
                            let _v35 = _v34;
                            if (_v35 > 0i64) {
                                let _v36 = _v35 as i128;
                                let _v37 = _v25 as i128;
                                _v33 = (_v36 * _v37 / 10000i128) as i64
                            } else _v33 = 0i64;
                            let _v38 = *&_v20.size;
                            let _v39 = _v27 as u64;
                            let _v40 = _v29 * _v39;
                            if (_v40 != 0) {
                                let _v41;
                                let _v42 = _v38 as u128;
                                let _v43 = _v30 as u128;
                                let _v44 = _v42 * _v43;
                                let _v45 = _v40 as u128;
                                if (_v44 == 0u128) if (_v45 != 0u128) _v41 = 0u128 else {
                                    let _v46 = error::invalid_argument(4);
                                    abort _v46
                                } else _v41 = (_v44 - 1u128) / _v45 + 1u128;
                                let _v47 = _v41 as u64;
                                let _v48 = *&_v20.size;
                                let _v49 = _v28 as u64;
                                let _v50 = _v29 * _v49;
                                if (_v50 != 0) {
                                    let _v51;
                                    let _v52 = _v48 as u128;
                                    let _v53 = _v30 as u128;
                                    let _v54 = _v52 * _v53;
                                    let _v55 = _v50 as u128;
                                    if (_v54 == 0u128) if (_v55 != 0u128) _v51 = 0u128 else {
                                        let _v56 = error::invalid_argument(4);
                                        abort _v56
                                    } else _v51 = (_v54 - 1u128) / _v55 + 1u128;
                                    let _v57 = _v51 as u64;
                                    let _v58 = *&_v20.size;
                                    let _v59 = _v29;
                                    if (_v59 != 0) {
                                        let _v60 = _v58 as u128;
                                        let _v61 = _v30 as u128;
                                        let _v62 = _v60 * _v61;
                                        let _v63 = _v59 as u128;
                                        _v9 = (_v62 / _v63) as u64;
                                        _v8 = _v34;
                                        _v7 = _v33;
                                        _v6 = _v47;
                                        _v5 = _v57
                                    } else {
                                        let _v64 = error::invalid_argument(4);
                                        abort _v64
                                    }
                                } else {
                                    let _v65 = error::invalid_argument(4);
                                    abort _v65
                                }
                            } else {
                                let _v66 = error::invalid_argument(4);
                                abort _v66
                            }
                        } else {
                            _v8 = 0i64;
                            _v7 = 0i64;
                            _v6 = 0;
                            _v5 = 0;
                            _v9 = 0
                        };
                        _v11 = _v19;
                        let _v67 = *&_v11.is_long;
                        let (_v68,_v69,_v70,_v71,_v72,_v73) = price_management::get_market_state(p3, _v67);
                        let _v74 = _v72;
                        let _v75 = _v70;
                        let _v76 = _v68;
                        let _v77 = (*&_v11.user_leverage) as u64;
                        let _v78 = _v74 as u64;
                        _v74 = math64::min(_v77, _v78) as u8;
                        if (!(*&_v11.size != 0)) {
                            _v3 = 0i64;
                            _v2 = 0i64;
                            _v1 = 0;
                            _v0 = 0;
                            _v4 = 0;
                            break 'l1
                        };
                        let _v79 = pnl_with_funding_impl(_v11, _v75, _v69, _v76);
                        let _v80 = _v79;
                        if (_v80 > 0i64) {
                            let _v81 = _v80 as i128;
                            let _v82 = _v71 as i128;
                            _v14 = (_v81 * _v82 / 10000i128) as i64
                        } else _v14 = 0i64;
                        let _v83 = *&_v11.size;
                        let _v84 = _v73 as u64;
                        let _v85 = _v75 * _v84;
                        if (!(_v85 != 0)) {
                            let _v86 = error::invalid_argument(4);
                            abort _v86
                        };
                        let _v87 = _v83 as u128;
                        let _v88 = _v76 as u128;
                        let _v89 = _v87 * _v88;
                        let _v90 = _v85 as u128;
                        if (_v89 == 0u128) if (_v90 != 0u128) _v13 = 0u128 else {
                            let _v91 = error::invalid_argument(4);
                            abort _v91
                        } else _v13 = (_v89 - 1u128) / _v90 + 1u128;
                        let _v92 = _v13 as u64;
                        let _v93 = *&_v11.size;
                        let _v94 = _v74 as u64;
                        let _v95 = _v75 * _v94;
                        if (!(_v95 != 0)) {
                            let _v96 = error::invalid_argument(4);
                            abort _v96
                        };
                        let _v97 = _v93 as u128;
                        let _v98 = _v76 as u128;
                        let _v99 = _v97 * _v98;
                        let _v100 = _v95 as u128;
                        if (_v99 == 0u128) if (_v100 != 0u128) _v12 = 0u128 else {
                            let _v101 = error::invalid_argument(4);
                            abort _v101
                        } else _v12 = (_v99 - 1u128) / _v100 + 1u128;
                        let _v102 = _v12 as u64;
                        let _v103 = *&_v11.size;
                        let _v104 = _v75;
                        if (!(_v104 != 0)) {
                            let _v105 = error::invalid_argument(4);
                            abort _v105
                        };
                        let _v106 = _v103 as u128;
                        let _v107 = _v76 as u128;
                        let _v108 = _v106 * _v107;
                        let _v109 = _v104 as u128;
                        _v4 = (_v108 / _v109) as u64;
                        _v3 = _v79;
                        _v2 = _v14;
                        _v1 = _v92;
                        _v0 = _v102;
                        break 'l1
                    };
                    return ()
                };
                return ()
            };
            return ()
        };
        let _v110 = &mut p4.unrealized_pnl;
        let _v111 = _v3 - _v8;
        i64_aggregator::add(_v110, _v111);
        let _v112 = &mut p4.haircutted_upnl;
        let _v113 = _v2 - _v7;
        i64_aggregator::add(_v112, _v113);
        let _v114 = aggregator_v2::try_sub<u64>(&mut p4.margin_for_max_leverage, _v6);
        let _v115 = aggregator_v2::try_add<u64>(&mut p4.margin_for_max_leverage, _v1);
        let _v116 = aggregator_v2::try_sub<u64>(&mut p4.margin_for_free_collateral, _v5);
        let _v117 = aggregator_v2::try_add<u64>(&mut p4.margin_for_free_collateral, _v0);
        let _v118 = aggregator_v2::try_sub<u64>(&mut p4.total_notional_value, _v9);
        let _v119 = aggregator_v2::try_add<u64>(&mut p4.total_notional_value, _v4);
    }
    friend fun update_position_status_to_remove_position(p0: &mut AccountStatus, p1: &PerpPosition, p2: object::Object<perp_market::PerpMarket>) {
        if (*&p1.size != 0) {
            let _v0;
            let _v1;
            let _v2;
            let _v3;
            let _v4;
            let _v5 = price_management::get_market_state_for_position_status(p2);
            let _v6 = p1;
            let _v7 = &_v5;
            let _v8 = *&_v6.is_long;
            let (_v9,_v10,_v11,_v12,_v13,_v14) = price_management::get_market_state(_v7, _v8);
            let _v15 = _v13;
            let _v16 = _v11;
            let _v17 = _v9;
            let _v18 = (*&_v6.user_leverage) as u64;
            let _v19 = _v15 as u64;
            _v15 = math64::min(_v18, _v19) as u8;
            if (*&_v6.size != 0) {
                let _v20;
                let _v21 = pnl_with_funding_impl(_v6, _v16, _v10, _v17);
                let _v22 = _v21;
                if (_v22 > 0i64) {
                    let _v23 = _v22 as i128;
                    let _v24 = _v12 as i128;
                    _v20 = (_v23 * _v24 / 10000i128) as i64
                } else _v20 = 0i64;
                let _v25 = *&_v6.size;
                let _v26 = _v14 as u64;
                let _v27 = _v16 * _v26;
                if (_v27 != 0) {
                    let _v28;
                    let _v29 = _v25 as u128;
                    let _v30 = _v17 as u128;
                    let _v31 = _v29 * _v30;
                    let _v32 = _v27 as u128;
                    if (_v31 == 0u128) if (_v32 != 0u128) _v28 = 0u128 else {
                        let _v33 = error::invalid_argument(4);
                        abort _v33
                    } else _v28 = (_v31 - 1u128) / _v32 + 1u128;
                    let _v34 = _v28 as u64;
                    let _v35 = *&_v6.size;
                    let _v36 = _v15 as u64;
                    let _v37 = _v16 * _v36;
                    if (_v37 != 0) {
                        let _v38;
                        let _v39 = _v35 as u128;
                        let _v40 = _v17 as u128;
                        let _v41 = _v39 * _v40;
                        let _v42 = _v37 as u128;
                        if (_v41 == 0u128) if (_v42 != 0u128) _v38 = 0u128 else {
                            let _v43 = error::invalid_argument(4);
                            abort _v43
                        } else _v38 = (_v41 - 1u128) / _v42 + 1u128;
                        let _v44 = _v38 as u64;
                        let _v45 = *&_v6.size;
                        let _v46 = _v16;
                        if (_v46 != 0) {
                            let _v47 = _v45 as u128;
                            let _v48 = _v17 as u128;
                            let _v49 = _v47 * _v48;
                            let _v50 = _v46 as u128;
                            _v4 = (_v49 / _v50) as u64;
                            _v3 = _v21;
                            _v2 = _v20;
                            _v1 = _v34;
                            _v0 = _v44
                        } else {
                            let _v51 = error::invalid_argument(4);
                            abort _v51
                        }
                    } else {
                        let _v52 = error::invalid_argument(4);
                        abort _v52
                    }
                } else {
                    let _v53 = error::invalid_argument(4);
                    abort _v53
                }
            } else {
                _v3 = 0i64;
                _v2 = 0i64;
                _v1 = 0;
                _v0 = 0;
                _v4 = 0
            };
            let _v54 = &mut p0.haircutted_upnl;
            *_v54 = *_v54 - _v2;
            _v54 = &mut p0.unrealized_pnl;
            *_v54 = *_v54 - _v3;
            let _v55 = &mut p0.margin_for_max_leverage;
            *_v55 = *_v55 - _v1;
            _v55 = &mut p0.margin_for_free_collateral;
            *_v55 = *_v55 - _v0;
            _v55 = &mut p0.total_notional_value;
            *_v55 = *_v55 - _v4;
            return ()
        };
    }
    fun update_single_position(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: bool, p3: &mut PerpPosition, p4: u64, p5: bool, p6: u64, p7: i64, p8: price_management::AccumulativeIndex) {
        let _v0;
        let _v1;
        if (*&p3.size != 0) _v1 = !p2 else _v1 = false;
        if (_v1) {
            let _v2 = *&p3.is_long;
            let _v3 = *&p3.avg_acquire_entry_px;
            let _v4 = *&p3.user_leverage;
            adl_tracker::remove_position(p0, p1, _v2, _v3, _v4)
        };
        if (*&p3.is_long != p5) {
            if (*&p3.size <= p6) {
                let _v5 = *&p3.is_long;
                pending_order_tracker::cancel_all_tp_sl_for_position(p0, p1, _v5)
            }};
        update_single_position_struct(p3, p4, p5, p6, p7, p8);
        if (*&p3.size != 0) _v0 = !p2 else _v0 = false;
        if (_v0) {
            let _v6 = *&p3.is_long;
            let _v7 = *&p3.avg_acquire_entry_px;
            let _v8 = *&p3.user_leverage;
            adl_tracker::add_position(p0, p1, _v6, _v7, _v8);
            return ()
        };
    }
    friend fun update_single_position_struct(p0: &mut PerpPosition, p1: u64, p2: bool, p3: u64, p4: i64, p5: price_management::AccumulativeIndex) {
        let _v0;
        let _v1;
        if (*&p0.is_long != p2) {
            let _v2;
            if (*&p0.size >= p3) {
                let _v3;
                let _v4 = *&p0.size - p3;
                _v1 = *&p0.entry_px_times_size_sum;
                let _v5 = _v4 as u128;
                let _v6 = (*&p0.size) as u128;
                if (*&p0.is_long) {
                    let _v7;
                    let _v8 = _v6;
                    if (!(_v8 != 0u128)) {
                        let _v9 = error::invalid_argument(4);
                        abort _v9
                    };
                    let _v10 = _v1 as u256;
                    let _v11 = _v5 as u256;
                    let _v12 = _v10 * _v11;
                    let _v13 = _v8 as u256;
                    if (_v12 == 0u256) if (_v13 != 0u256) _v7 = 0u256 else {
                        let _v14 = error::invalid_argument(4);
                        abort _v14
                    } else _v7 = (_v12 - 1u256) / _v13 + 1u256;
                    _v3 = _v7 as u128
                } else if (_v6 != 0u128) {
                    let _v15 = _v1 as u256;
                    let _v16 = _v5 as u256;
                    let _v17 = _v15 * _v16;
                    let _v18 = _v6 as u256;
                    _v3 = (_v17 / _v18) as u128
                } else {
                    let _v19 = error::invalid_argument(4);
                    abort _v19
                };
                _v0 = &mut p0.entry_px_times_size_sum;
                *_v0 = _v3;
                _v2 = &mut p0.size;
                *_v2 = _v4
            } else {
                let _v20 = *&p0.size;
                let _v21 = p3 - _v20;
                let _v22 = &mut p0.size;
                *_v22 = _v21;
                let _v23 = p1 as u128;
                let _v24 = (*&p0.size) as u128;
                let _v25 = _v23 * _v24;
                let _v26 = &mut p0.entry_px_times_size_sum;
                *_v26 = _v25;
                _v2 = &mut p0.avg_acquire_entry_px;
                *_v2 = p1;
                let _v27 = &mut p0.is_long;
                *_v27 = p2
            }
        } else {
            let _v28 = p1 as u128;
            let _v29 = p3 as u128;
            let _v30 = _v28 * _v29;
            let _v31 = *&p0.entry_px_times_size_sum;
            _v1 = _v30 + _v31;
            let _v32 = *&p0.size;
            let _v33 = p3 + _v32;
            let _v34 = &mut p0.size;
            *_v34 = _v33;
            let _v35 = (*&p0.size) as u128;
            let _v36 = (_v1 / _v35) as u64;
            let _v37 = &mut p0.avg_acquire_entry_px;
            *_v37 = _v36;
            _v0 = &mut p0.entry_px_times_size_sum;
            *_v0 = _v1
        };
        let _v38 = &mut p0.unrealized_funding_amount_before_last_update;
        *_v38 = p4;
        let _v39 = &mut p0.funding_index_at_last_update;
        *_v39 = p5;
    }
    friend fun view_position(p0: address, p1: object::Object<perp_market::PerpMarket>): option::Option<position_view_types::PositionViewInfo>
        acquires UserPositions
    {
        let _v0 = &borrow_global<UserPositions>(p0).positions;
        let _v1 = &p1;
        let _v2 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v0, _v1);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v2, _v0)) return option::none<position_view_types::PositionViewInfo>();
        let _v3 = big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2, _v0);
        let _v4 = *&_v3.size;
        let _v5 = *&_v3.entry_px_times_size_sum;
        let _v6 = *&_v3.avg_acquire_entry_px;
        let _v7 = *&_v3.user_leverage;
        let _v8 = *&_v3.is_long;
        let _v9 = *&_v3.is_isolated;
        let _v10 = *&_v3.funding_index_at_last_update;
        let _v11 = *&_v3.unrealized_funding_amount_before_last_update;
        option::some<position_view_types::PositionViewInfo>(position_view_types::new_position_view_info(p1, _v4, _v5, _v6, _v7, _v8, _v9, _v10, _v11))
    }
}
