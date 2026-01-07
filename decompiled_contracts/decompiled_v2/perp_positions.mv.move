module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_positions {
    use 0x1::option;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::position_tp_sl_tracker;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_book_types;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::price_management;
    use 0x1::object;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::pending_order_tracker;
    use 0x1::string;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::builder_code_registry;
    use 0x1::big_ordered_map;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::trading_fees_manager;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market_config;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::adl_tracker;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::liquidation_config;
    use 0x1::error;
    use 0x1::signer;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::collateral_balance_sheet;
    use 0x1::ordered_map;
    use 0x1::event;
    use 0x1::math64;
    use 0x1::vector;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::position_update;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::order_margin;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::accounts_collateral;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::position_tp_sl;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::clearinghouse_perp;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::liquidation;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::async_matching_engine;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine;
    struct PendingTpSLs has copy, drop, store {
        full_sized: option::Option<PendingTpSlKey>,
        fixed_sized: vector<PendingTpSlKey>,
    }
    struct PendingTpSlKey has copy, drop, store {
        price_index: position_tp_sl_tracker::PriceIndexKey,
        order_id: order_book_types::OrderIdType,
    }
    struct AccountInfo has key {
        fee_tracking_addr: address,
    }
    struct AccountStatus has copy, drop {
        account_balance: i64,
        unrealized_pnl: i64,
        initial_margin: u64,
        total_notional_value: u64,
    }
    struct AccountStatusDetailed has drop {
        account_balance: i64,
        initial_margin: u64,
        liquidation_margin: u64,
        backstop_liquidator_margin: u64,
        total_notional_value: u64,
    }
    enum Action has copy, drop, store {
        OpenLong,
        CloseLong,
        OpenShort,
        CloseShort,
    }
    struct PerpPosition has copy, drop, store {
        size: u64,
        entry_px_times_size_sum: u128,
        avg_acquire_entry_px: u64,
        user_leverage: u8,
        max_allowed_leverage: u8,
        is_long: bool,
        is_isolated: bool,
        funding_index_at_last_update: price_management::AccumulativeIndex,
        unrealized_funding_amount_before_last_update: i64,
        market: object::Object<perp_market::PerpMarket>,
    }
    struct PositionInfo has drop {
        size: u64,
        is_long: bool,
        user_leverage: u8,
    }
    struct PositionUpdateEvent has copy, drop, store {
        market: object::Object<perp_market::PerpMarket>,
        user: address,
        is_long: bool,
        size: u64,
        user_leverage: u8,
        max_allowed_leverage: u8,
        entry_price_times_size_sum: u128,
        is_isolated: bool,
        funding_index_at_last_update: i128,
        unrealized_funding_amount_before_last_update: i64,
        full_sized_tp: option::Option<pending_order_tracker::FullSizedTpSlForEvent>,
        fixed_sized_tps: vector<pending_order_tracker::FixedSizedTpSlForEvent>,
        full_sized_sl: option::Option<pending_order_tracker::FullSizedTpSlForEvent>,
        fixed_sized_sls: vector<pending_order_tracker::FixedSizedTpSlForEvent>,
    }
    struct TradeEvent has drop, store {
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        action: Action,
        order_id: option::Option<order_book_types::OrderIdType>,
        client_order_id: option::Option<string::String>,
        size: u64,
        price: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        realized_pnl: i64,
        realized_funding_cost: i64,
        fee: i64,
        fill_id: u128,
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
    public fun get_maker_volume_in_window(p0: address): u128
        acquires AccountInfo
    {
        trading_fees_manager::get_maker_volume_in_window(*&borrow_global<AccountInfo>(p0).fee_tracking_addr)
    }
    public fun get_taker_volume_in_window(p0: address): u128
        acquires AccountInfo
    {
        trading_fees_manager::get_taker_volume_in_window(*&borrow_global<AccountInfo>(p0).fee_tracking_addr)
    }
    friend fun get_market(p0: &PerpPosition): object::Object<perp_market::PerpMarket> {
        *&p0.market
    }
    friend fun update_position(p0: address, p1: bool, p2: bool, p3: object::Object<perp_market::PerpMarket>, p4: option::Option<order_book_types::OrderIdType>, p5: option::Option<string::String>, p6: u64, p7: bool, p8: u64, p9: option::Option<builder_code_registry::BuilderCode>, p10: i64, p11: price_management::AccumulativeIndex, p12: i64, p13: i64, p14: i64, p15: u128): (u64, bool, u8)
        acquires UserPositions
    {
        let _v0;
        let _v1 = &mut borrow_global_mut<UserPositions>(p0).positions;
        let _v2 = freeze(_v1);
        let _v3 = &p3;
        let _v4 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2, _v3);
        let _v5 = &_v4;
        let _v6 = freeze(_v1);
        let _v7 = big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(_v5, _v6);
        loop {
            if (_v7) {
                let _v8 = p6 as u128;
                let _v9 = p8 as u128;
                let _v10 = _v8 * _v9;
                let _v11 = perp_market_config::get_max_leverage(p3);
                _v0 = new_perp_position_with_mode(p8, p3, _v10, _v11, p7, p2);
                let _v12 = &_v0;
                emit_trade_event(p0, _v12, p4, p5, p7, p8, p6, p9, p13, p12, p14, p15);
                if (p1) break;
                let _v13 = *&(&_v0).user_leverage;
                adl_tracker::add_position(p3, p0, p7, p6, _v13);
                break
            };
            let _v14 = |arg0| lambda__1__update_position(p0, p1, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, arg0);
            let _v15 = big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>,PerpPosition,PositionInfo>(_v4, _v1, _v14);
            let _v16 = *&(&_v15).size;
            let _v17 = *&(&_v15).is_long;
            let _v18 = *&(&_v15).user_leverage;
            return (_v16, _v17, _v18)
        };
        big_ordered_map::add<object::Object<perp_market::PerpMarket>,PerpPosition>(_v1, p3, _v0);
        emit_position_update_event(&_v0, p0);
        let _v19 = *&(&_v0).user_leverage;
        (p8, p7, _v19)
    }
    fun lambda__1__update_position(p0: address, p1: bool, p2: object::Object<perp_market::PerpMarket>, p3: option::Option<order_book_types::OrderIdType>, p4: option::Option<string::String>, p5: u64, p6: bool, p7: u64, p8: option::Option<builder_code_registry::BuilderCode>, p9: i64, p10: price_management::AccumulativeIndex, p11: i64, p12: i64, p13: i64, p14: u128, p15: &mut PerpPosition): PositionInfo {
        let _v0 = freeze(p15);
        emit_trade_event(p0, _v0, p3, p4, p6, p7, p5, p8, p12, p11, p13, p14);
        update_single_position(p2, p0, p1, p15, p5, p6, p7, p9, p10);
        emit_position_update_event(freeze(p15), p0);
        let _v1 = *&p15.size;
        let _v2 = *&p15.is_long;
        let _v3 = *&p15.user_leverage;
        PositionInfo{size: _v1, is_long: _v2, user_leverage: _v3}
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
        PerpPosition{size: p0, entry_px_times_size_sum: p2, avg_acquire_entry_px: _v0, user_leverage: p3, max_allowed_leverage: _v2, is_long: p4, is_isolated: p5, funding_index_at_last_update: _v5, unrealized_funding_amount_before_last_update: 0i64, market: p1}
    }
    fun emit_trade_event(p0: address, p1: &PerpPosition, p2: option::Option<order_book_types::OrderIdType>, p3: option::Option<string::String>, p4: bool, p5: u64, p6: u64, p7: option::Option<builder_code_registry::BuilderCode>, p8: i64, p9: i64, p10: i64, p11: u128) {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4;
        let _v5;
        let _v6;
        if (*&p1.is_long != p4) _v3 = *&p1.size != 0 else _v3 = false;
        'l1: loop {
            let _v7;
            let _v8;
            let _v9;
            let _v10;
            let _v11;
            let _v12;
            'l0: loop {
                loop {
                    if (_v3) {
                        if (*&p1.size >= p5) {
                            let _v13 = *&p1.market;
                            _v2 = p2;
                            _v1 = p3;
                            _v0 = p7;
                            _v6 = _v13;
                            _v5 = p0;
                            if (*&p1.is_long) {
                                _v4 = Action::CloseLong{};
                                break
                            };
                            _v4 = Action::CloseShort{};
                            break
                        };
                        let _v14 = *&p1.market;
                        if (*&p1.is_long) _v4 = Action::CloseLong{} else _v4 = Action::CloseShort{};
                        let _v15 = *&p1.size;
                        _v12 = p7;
                        _v11 = p3;
                        _v10 = p2;
                        event::emit<TradeEvent>(TradeEvent{account: p0, market: _v14, action: _v4, order_id: _v10, client_order_id: _v11, size: _v15, price: p6, builder_code: _v12, realized_pnl: p8, realized_funding_cost: p9, fee: p10, fill_id: p11});
                        let _v16 = *&p1.market;
                        _v10 = p2;
                        _v11 = p3;
                        _v12 = p7;
                        _v9 = _v16;
                        _v8 = p0;
                        if (p4) {
                            _v7 = Action::OpenLong{};
                            break 'l0
                        };
                        _v7 = Action::OpenShort{};
                        break 'l0
                    };
                    let _v17 = *&p1.market;
                    _v2 = p2;
                    _v1 = p3;
                    _v0 = p7;
                    _v6 = _v17;
                    _v5 = p0;
                    if (p4) {
                        _v4 = Action::OpenLong{};
                        break 'l1
                    };
                    _v4 = Action::OpenShort{};
                    break 'l1
                };
                event::emit<TradeEvent>(TradeEvent{account: _v5, market: _v6, action: _v4, order_id: _v2, client_order_id: _v1, size: p5, price: p6, builder_code: _v0, realized_pnl: p8, realized_funding_cost: p9, fee: p10, fill_id: p11});
                return ()
            };
            let _v18 = *&p1.size;
            let _v19 = p5 - _v18;
            event::emit<TradeEvent>(TradeEvent{account: _v8, market: _v9, action: _v7, order_id: _v10, client_order_id: _v11, size: _v19, price: p6, builder_code: _v12, realized_pnl: 0i64, realized_funding_cost: 0i64, fee: 0i64, fill_id: p11});
            return ()
        };
        event::emit<TradeEvent>(TradeEvent{account: _v5, market: _v6, action: _v4, order_id: _v2, client_order_id: _v1, size: p5, price: p6, builder_code: _v0, realized_pnl: p8, realized_funding_cost: p9, fee: p10, fill_id: p11});
    }
    friend fun emit_position_update_event(p0: &PerpPosition, p1: address) {
        let _v0 = *&p0.market;
        let _v1 = *&p0.is_long;
        let (_v2,_v3,_v4,_v5) = pending_order_tracker::get_all_tp_sls_for_event(p1, _v0, _v1);
        let _v6 = *&p0.market;
        let _v7 = *&p0.is_long;
        let _v8 = *&p0.size;
        let _v9 = *&p0.entry_px_times_size_sum;
        let _v10 = *&p0.is_isolated;
        let _v11 = *&p0.user_leverage;
        let _v12 = *&p0.max_allowed_leverage;
        let _v13 = price_management::accumulative_index(&p0.funding_index_at_last_update);
        let _v14 = *&p0.unrealized_funding_amount_before_last_update;
        event::emit<PositionUpdateEvent>(PositionUpdateEvent{market: _v6, user: p1, is_long: _v7, size: _v8, user_leverage: _v11, max_allowed_leverage: _v12, entry_price_times_size_sum: _v9, is_isolated: _v10, funding_index_at_last_update: _v13, unrealized_funding_amount_before_last_update: _v14, full_sized_tp: _v2, fixed_sized_tps: _v4, full_sized_sl: _v3, fixed_sized_sls: _v5});
    }
    friend fun account_initialized(p0: address): bool {
        exists<UserPositions>(p0)
    }
    friend fun add_liquidation_details(p0: AccountStatus, p1: &liquidation_config::LiquidationConfig): AccountStatusDetailed {
        let AccountStatus{account_balance: _v0, unrealized_pnl: _v1, initial_margin: _v2, total_notional_value: _v3} = p0;
        let _v4 = _v2;
        let _v5 = liquidation_config::get_liquidation_margin(p1, _v4, false);
        let _v6 = liquidation_config::get_liquidation_margin(p1, _v4, true);
        AccountStatusDetailed{account_balance: _v0, initial_margin: _v4, liquidation_margin: _v5, backstop_liquidator_margin: _v6, total_notional_value: _v3}
    }
    fun apply_pnl_haircut(p0: i64, p1: u64): i64 {
        if (p0 > 0i64) {
            let _v0 = (10000 - p1) as i64;
            return p0 * _v0 / 10000i64
        };
        p0
    }
    friend fun assert_user_initialized(p0: address) {
        assert!(exists<AccountInfo>(p0), 22);
    }
    friend fun calculate_backstop_liquidation_profit(p0: i64, p1: &AccountStatusDetailed, p2: &PerpPosition): i64 {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4 = *&p2.size;
        loop {
            if (!(_v4 == 0)) {
                let _v5;
                _v3 = pnl_with_funding(p2);
                let _v6 = price_management::get_mark_price(*&p2.market);
                let _v7 = perp_market_config::get_size_multiplier(*&p2.market);
                let _v8 = *&p2.size;
                let _v9 = perp_market_config::get_max_leverage(*&p2.market) as u64;
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
                _v0 = *&p1.initial_margin;
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
    fun pnl_with_funding(p0: &PerpPosition): i64 {
        let (_v0,_v1,_v2,_v3,_v4,_v5) = price_management::get_market_info_for_position_status(*&p0.market);
        pnl_with_funding_impl(p0, _v3, _v2, _v1)
    }
    friend fun configure_user_settings_for_market(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: u8)
        acquires UserPositions
    {
        let _v0;
        let _v1 = signer::address_of(p0);
        let _v2 = perp_market_config::get_max_leverage(p1);
        if (p3 > 0u8) _v0 = p3 <= _v2 else _v0 = false;
        assert!(_v0, 2);
        let _v3 = &mut borrow_global_mut<UserPositions>(_v1).positions;
        let _v4 = freeze(_v3);
        let _v5 = &p1;
        let _v6 = big_ordered_map::get<object::Object<perp_market::PerpMarket>,PerpPosition>(_v4, _v5);
        let _v7 = option::is_none<PerpPosition>(&_v6);
        if (option::is_some<PerpPosition>(&_v6)) {
            let _v8;
            let _v9;
            let _v10 = option::destroy_some<PerpPosition>(_v6);
            if (p2) _v9 = *&(&_v10).is_isolated else _v9 = false;
            if (_v9) _v8 = true else if (p2) _v8 = false else _v8 = !*&(&_v10).is_isolated;
            if (_v8) {
                assert!(*&(&_v10).size == 0, 17);
                let _v11 = &p1;
                let _v12 = big_ordered_map::remove<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, _v11);
                _v7 = true
            } else {
                let _v13 = &mut (&mut _v10).is_isolated;
                *_v13 = !p2;
                if (*&(&_v10).user_leverage != p3) {
                    let _v14;
                    if (*&(&_v10).size == 0) _v14 = true else if (*&(&_v10).user_leverage > p3) _v14 = p2 else _v14 = false;
                    if (_v14) {
                        if (*&(&_v10).size != 0) {
                            let _v15 = *&(&_v10).is_long;
                            let _v16 = *&(&_v10).avg_acquire_entry_px;
                            let _v17 = *&(&_v10).user_leverage;
                            adl_tracker::remove_position(p1, _v1, _v15, _v16, _v17)
                        };
                        let _v18 = &mut (&mut _v10).user_leverage;
                        *_v18 = p3;
                        if (*&(&_v10).size != 0) {
                            let _v19 = *&(&_v10).is_long;
                            let _v20 = *&(&_v10).avg_acquire_entry_px;
                            adl_tracker::add_position(p1, _v1, _v19, _v20, p3)
                        };
                        let _v21 = big_ordered_map::upsert<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, p1, _v10);
                        emit_position_update_event(&_v10, _v1)
                    } else if (*&(&_v10).user_leverage == p3) () else abort 17
                } else {
                    let _v22 = big_ordered_map::upsert<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, p1, _v10);
                    emit_position_update_event(&_v10, _v1)
                }
            }
        };
        if (_v7) {
            let _v23 = new_empty_perp_position_with_mode(p1, p3, !p2);
            emit_position_update_event(&_v23, _v1);
            big_ordered_map::add<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, p1, _v23)
        };
        let _v24 = freeze(_v3);
        let _v25 = &p1;
        let _v26 = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v24, _v25);
        let _v27 = *&_v26.size;
        let _v28 = *&_v26.is_long;
        let _v29 = *&_v26.user_leverage;
        pending_order_tracker::update_position(_v1, p1, _v27, _v28, _v29);
    }
    friend fun new_empty_perp_position_with_mode(p0: object::Object<perp_market::PerpMarket>, p1: u8, p2: bool): PerpPosition {
        new_perp_position_with_mode(0, p0, 0u128, p1, true, p2)
    }
    friend fun cross_position_status(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: option::Option<object::Object<perp_market::PerpMarket>>, p3: bool): AccountStatus
        acquires UserPositions
    {
        let _v0;
        let _v1;
        let _v2;
        let _v3 = collateral_balance_sheet::balance_type_cross(p1);
        let _v4 = AccountStatus{account_balance: collateral_balance_sheet::total_asset_collateral_value(p0, _v3) as i64, unrealized_pnl: 0i64, initial_margin: 0, total_notional_value: 0};
        let _v5 = &borrow_global<UserPositions>(p1).positions;
        if (option::is_none<object::Object<perp_market::PerpMarket>>(&p2)) {
            let _v6 = _v5;
            let _v7 = big_ordered_map::internal_leaf_new_begin_iter<object::Object<perp_market::PerpMarket>,PerpPosition>(_v6);
            while (!big_ordered_map::internal_leaf_iter_is_end(&_v7)) {
                let (_v8,_v9) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index<object::Object<perp_market::PerpMarket>,PerpPosition>(_v7, _v6);
                _v2 = _v8;
                let _v10 = ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v2);
                while (!ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v10, _v2)) {
                    _v1 = ordered_map::iter_borrow_key<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v10, _v2);
                    _v0 = big_ordered_map::internal_leaf_borrow_value<PerpPosition>(ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v10, _v2));
                    if (!*&_v0.is_isolated) update_position_status_for_position(&mut _v4, _v0, p3);
                    _v10 = ordered_map::iter_next<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v10, _v2)
                };
                _v7 = _v9;
                continue
            }
        } else {
            let _v11 = option::destroy_some<object::Object<perp_market::PerpMarket>>(p2);
            let _v12 = big_ordered_map::internal_leaf_new_begin_iter<object::Object<perp_market::PerpMarket>,PerpPosition>(_v5);
            while (!big_ordered_map::internal_leaf_iter_is_end(&_v12)) {
                let (_v13,_v14) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index<object::Object<perp_market::PerpMarket>,PerpPosition>(_v12, _v5);
                _v2 = _v13;
                let _v15 = ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v2);
                loop {
                    let _v16;
                    if (ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v15, _v2)) break;
                    _v1 = ordered_map::iter_borrow_key<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v15, _v2);
                    _v0 = big_ordered_map::internal_leaf_borrow_value<PerpPosition>(ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v15, _v2));
                    let _v17 = &_v11;
                    if (_v1 != _v17) _v16 = !*&_v0.is_isolated else _v16 = false;
                    if (_v16) update_position_status_for_position(&mut _v4, _v0, p3);
                    _v15 = ordered_map::iter_next<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v15, _v2);
                    continue
                };
                _v12 = _v14;
                continue
            }
        };
        _v4
    }
    friend fun update_position_status_for_position(p0: &mut AccountStatus, p1: &PerpPosition, p2: bool) {
        if (*&p1.size != 0) {
            let _v0;
            let _v1;
            let _v2;
            let _v3;
            let _v4;
            let _v5;
            let _v6;
            let _v7;
            let _v8;
            let (_v9,_v10,_v11,_v12,_v13,_v14) = price_management::get_market_info_for_position_status(*&p1.market);
            let _v15 = _v12;
            if (p2) _v2 = _v10 else _v2 = _v9;
            let _v16 = pnl_with_funding_impl(p1, _v15, _v11, _v2);
            if (p2) _v1 = apply_pnl_haircut(_v16, _v13) else _v1 = _v16;
            let _v17 = &mut p0.account_balance;
            *_v17 = *_v17 + _v1;
            _v17 = &mut p0.unrealized_pnl;
            *_v17 = *_v17 + _v1;
            if (p2) {
                _v0 = *&p1.size;
                let _v18 = (*&p1.user_leverage) as u64;
                let _v19 = _v14 as u64;
                let _v20 = (math64::min(_v18, _v19) as u8) as u64;
                _v6 = _v15 * _v20;
                if (!(_v6 != 0)) {
                    let _v21 = error::invalid_argument(4);
                    abort _v21
                };
                let _v22 = _v0 as u128;
                let _v23 = _v2 as u128;
                _v4 = _v22 * _v23;
                _v3 = _v6 as u128;
                if (_v4 == 0u128) if (_v3 != 0u128) _v5 = 0u128 else {
                    let _v24 = error::invalid_argument(4);
                    abort _v24
                } else _v5 = (_v4 - 1u128) / _v3 + 1u128;
                _v8 = _v5 as u64;
                _v7 = &mut p0.initial_margin;
                *_v7 = *_v7 + _v8
            } else {
                _v0 = *&p1.size;
                let _v25 = perp_market_config::get_max_leverage(*&p1.market) as u64;
                _v6 = _v15 * _v25;
                if (_v6 != 0) {
                    let _v26 = _v0 as u128;
                    let _v27 = _v2 as u128;
                    _v4 = _v26 * _v27;
                    _v3 = _v6 as u128;
                    if (_v4 == 0u128) if (_v3 != 0u128) _v5 = 0u128 else {
                        let _v28 = error::invalid_argument(4);
                        abort _v28
                    } else _v5 = (_v4 - 1u128) / _v3 + 1u128;
                    _v8 = _v5 as u64;
                    _v7 = &mut p0.initial_margin;
                    *_v7 = *_v7 + _v8
                } else {
                    let _v29 = error::invalid_argument(4);
                    abort _v29
                }
            };
            _v8 = *&p1.size;
            let _v30 = _v15;
            if (!(_v30 != 0)) {
                let _v31 = error::invalid_argument(4);
                abort _v31
            };
            let _v32 = _v8 as u128;
            let _v33 = _v2 as u128;
            let _v34 = _v32 * _v33;
            let _v35 = _v30 as u128;
            let _v36 = (_v34 / _v35) as u64;
            _v7 = &mut p0.total_notional_value;
            *_v7 = *_v7 + _v36;
            return ()
        };
    }
    friend fun free_collateral_for_crossed(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: i64): u64
        acquires UserPositions
    {
        let _v0 = option::none<object::Object<perp_market::PerpMarket>>();
        let _v1 = cross_position_status(p0, p1, _v0, true);
        let _v2 = *&(&_v1).account_balance - p2;
        let _v3 = (*&(&_v1).initial_margin) as i64;
        p2 = _v2 - _v3;
        if (p2 > 0i64) return p2 as u64;
        0
    }
    friend fun get_account_balance(p0: &AccountStatus): i64 {
        *&p0.account_balance
    }
    friend fun get_account_balance_from_detailed_status(p0: &AccountStatusDetailed): i64 {
        *&p0.account_balance
    }
    friend fun get_account_balance_from_status(p0: &AccountStatus): i64 {
        *&p0.account_balance
    }
    friend fun get_account_net_asset_value(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address): i64
        acquires UserPositions
    {
        let _v0 = collateral_balance_sheet::balance_type_cross(p1);
        let _v1 = AccountStatus{account_balance: collateral_balance_sheet::total_asset_collateral_value(p0, _v0) as i64, unrealized_pnl: 0i64, initial_margin: 0, total_notional_value: 0};
        let _v2 = &borrow_global<UserPositions>(p1).positions;
        let _v3 = big_ordered_map::internal_leaf_new_begin_iter<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2);
        while (!big_ordered_map::internal_leaf_iter_is_end(&_v3)) {
            let (_v4,_v5) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, _v2);
            let _v6 = _v4;
            let _v7 = ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v6);
            while (!ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v7, _v6)) {
                let _v8 = ordered_map::iter_borrow_key<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(&_v7, _v6);
                let _v9 = big_ordered_map::internal_leaf_borrow_value<PerpPosition>(ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v7, _v6));
                update_position_status_for_position(&mut _v1, _v9, false);
                if (*&_v9.is_isolated) {
                    let _v10 = *_v8;
                    let _v11 = collateral_balance_sheet::balance_type_isolated(p1, _v10);
                    let _v12 = collateral_balance_sheet::total_asset_collateral_value(p0, _v11) as i64;
                    let _v13 = &mut (&mut _v1).account_balance;
                    *_v13 = *_v13 + _v12
                };
                _v7 = ordered_map::iter_next<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PerpPosition>>(_v7, _v6);
                continue
            };
            _v3 = _v5;
            continue
        };
        *&(&_v1).account_balance
    }
    friend fun get_cross_position_markets(p0: address): vector<object::Object<perp_market::PerpMarket>>
        acquires UserPositions
    {
        big_ordered_map::keys<object::Object<perp_market::PerpMarket>,PerpPosition>(&borrow_global<UserPositions>(p0).positions)
    }
    friend fun get_entry_px_times_size_sum(p0: &PerpPosition): u128 {
        *&p0.entry_px_times_size_sum
    }
    friend fun get_fee_tracking_addr(p0: address): address
        acquires AccountInfo
    {
        *&borrow_global<AccountInfo>(p0).fee_tracking_addr
    }
    friend fun get_fixed_sized_tp_sl_from_event(p0: &PositionUpdateEvent, p1: bool): vector<pending_order_tracker::FixedSizedTpSlForEvent> {
        if (p1) return *&p0.fixed_sized_tps;
        *&p0.fixed_sized_sls
    }
    friend fun get_full_sized_tp_sl_from_event(p0: &PositionUpdateEvent, p1: bool): option::Option<pending_order_tracker::FullSizedTpSlForEvent> {
        if (p1) return *&p0.full_sized_tp;
        *&p0.full_sized_sl
    }
    friend fun get_initial_margin(p0: &AccountStatus): u64 {
        *&p0.initial_margin
    }
    friend fun get_liquidation_margin_from_detailed_status(p0: &AccountStatusDetailed): u64 {
        *&p0.liquidation_margin
    }
    friend fun get_max_allowed_leverage(p0: &PerpPosition): u8 {
        *&p0.max_allowed_leverage
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
    friend fun get_position_funding_cost_and_index(p0: &PerpPosition): (i64, price_management::AccumulativeIndex) {
        let _v0 = perp_market_config::get_size_multiplier(*&p0.market);
        let _v1 = price_management::get_accumulative_index(*&p0.market);
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
        let (_v5,_v6) = get_position_funding_cost_and_index(big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, _v1));
        _v5
    }
    friend fun get_size(p0: &PerpPosition): u64 {
        *&p0.size
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
    friend fun has_position(p0: address, p1: object::Object<perp_market::PerpMarket>): bool
        acquires UserPositions
    {
        if (exists<UserPositions>(p0)) {
            let _v0 = &borrow_global<UserPositions>(p0).positions;
            let _v1 = &p1;
            return big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PerpPosition>(_v0, _v1)
        };
        false
    }
    friend fun increase_account_balance_for_status(p0: &mut AccountStatus, p1: i64) {
        let _v0 = &mut p0.account_balance;
        *_v0 = *_v0 + p1;
    }
    friend fun init_user_if_new(p0: &signer, p1: address) {
        let _v0 = signer::address_of(p0);
        if (!exists<UserPositions>(_v0)) {
            let _v1 = UserPositions{positions: big_ordered_map::new_with_config<object::Object<perp_market::PerpMarket>,PerpPosition>(64u16, 16u16, false)};
            move_to<UserPositions>(p0, _v1)
        };
        if (!exists<AccountInfo>(_v0)) {
            let _v2 = AccountInfo{fee_tracking_addr: p1};
            move_to<AccountInfo>(p0, _v2)
        };
        pending_order_tracker::initialize_account_summary(_v0);
    }
    friend fun is_account_liquidatable(p0: &AccountStatus, p1: &liquidation_config::LiquidationConfig, p2: bool): bool {
        let _v0 = *&p0.initial_margin;
        let _v1 = liquidation_config::get_liquidation_margin(p1, _v0, p2);
        let _v2 = *&p0.account_balance;
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
    friend fun is_free_collateral_for_crossed_at_least(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: i64, p3: u64): bool
        acquires UserPositions
    {
        free_collateral_for_crossed(p0, p1, p2) >= p3
    }
    friend fun is_max_allowed_withdraw_from_cross_margin_at_least(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: i64, p3: u64): bool
        acquires UserPositions
    {
        max_allowed_primary_asset_withdraw_from_cross_margin(p0, p1, p2) >= p3
    }
    friend fun max_allowed_primary_asset_withdraw_from_cross_margin(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: i64): u64
        acquires UserPositions
    {
        let _v0;
        let _v1 = option::none<object::Object<perp_market::PerpMarket>>();
        let _v2 = cross_position_status(p0, p1, _v1, true);
        let _v3 = *&(&_v2).account_balance - p2;
        let _v4 = (*&(&_v2).initial_margin) as i64;
        let _v5 = _v3 - _v4;
        let _v6 = collateral_balance_sheet::balance_type_cross(p1);
        let _v7 = collateral_balance_sheet::balance_of_primary_asset(p0, _v6) - p2;
        let _v8 = *&(&_v2).unrealized_pnl;
        p2 = _v7 + _v8;
        if (_v5 < p2) _v0 = _v5 else _v0 = p2;
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
        acquires UserPositions
    {
        let _v0 = position_status(p0, p2, p3);
        is_account_liquidatable(&_v0, p1, p4)
    }
    friend fun position_status(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: object::Object<perp_market::PerpMarket>): AccountStatus
        acquires UserPositions
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
        if (*&_v5.is_isolated) return isolated_position_status(p0, p1, _v5, p2, false);
        let _v6 = option::none<object::Object<perp_market::PerpMarket>>();
        cross_position_status(p0, p1, _v6, false)
    }
    friend fun isolated_position_status(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: &PerpPosition, p3: object::Object<perp_market::PerpMarket>, p4: bool): AccountStatus {
        let _v0 = collateral_balance_sheet::balance_type_isolated(p1, p3);
        let _v1 = AccountStatus{account_balance: collateral_balance_sheet::total_asset_collateral_value(p0, _v0) as i64, unrealized_pnl: 0i64, initial_margin: 0, total_notional_value: 0};
        update_position_status_for_position(&mut _v1, p2, p4);
        _v1
    }
    friend fun liquidation_price(p0: &PerpPosition, p1: &AccountStatusDetailed): u64 {
        let _v0 = price_management::get_mark_price(*&p0.market);
        let _v1 = *&p1.account_balance;
        assert!(_v1 > 0i64, 1);
        let _v2 = _v1 as u64;
        let _v3 = *&p1.backstop_liquidator_margin;
        assert!(_v2 > _v3, 1);
        let _v4 = _v2 - _v3;
        let _v5 = *&p1.total_notional_value;
        if (!(_v5 != 0)) {
            let _v6 = error::invalid_argument(4);
            abort _v6
        };
        let _v7 = _v0 as u128;
        let _v8 = _v4 as u128;
        let _v9 = _v7 * _v8;
        let _v10 = _v5 as u128;
        let _v11 = (_v9 / _v10) as u64;
        if (*&p0.is_long) return _v0 - _v11;
        _v0 + _v11
    }
    fun margin_required(p0: &PerpPosition): u64 {
        let _v0;
        let _v1 = perp_market_config::get_size_multiplier(*&p0.market);
        let _v2 = price_management::get_mark_price(*&p0.market);
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
        let _v0 = p2;
        let _v1 = &borrow_global<UserPositions>(p1).positions;
        let _v2 = &_v0;
        let _v3 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PerpPosition>(_v1, _v2);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PerpPosition>(&_v3, _v1)) {
            let _v4 = error::invalid_argument(7);
            abort _v4
        };
        let _v5 = big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v3, _v1);
        if (!*&_v5.is_isolated) {
            let _v6 = error::invalid_argument(7);
            abort _v6
        };
        let _v7 = _v5;
        let _v8 = margin_required(_v7);
        let _v9 = pnl_with_funding(_v7);
        let _v10 = collateral_balance_sheet::balance_type_isolated(p1, p2);
        let _v11 = (collateral_balance_sheet::total_asset_collateral_value(p0, _v10) as i64) + _v9;
        let _v12 = _v8 as i64;
        _v9 = _v11 - _v12;
        if (_v9 > 0i64) return _v9 as u64;
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
        AccountStatus{account_balance: p0, unrealized_pnl: 0i64, initial_margin: 0, total_notional_value: 0}
    }
    friend fun new_empty_perp_position(p0: object::Object<perp_market::PerpMarket>, p1: u8): PerpPosition {
        new_perp_position_with_mode(0, p0, 0u128, p1, true, false)
    }
    friend fun new_perp_position(p0: u64, p1: object::Object<perp_market::PerpMarket>, p2: u128, p3: u8, p4: bool): PerpPosition {
        new_perp_position_with_mode(p0, p1, p2, p3, p4, false)
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
            _v3 = *&p0.is_long;
            let _v8 = *&p0.entry_px_times_size_sum;
            _v2 = _v6 - _v8
        } else {
            _v3 = !*&p0.is_long;
            _v2 = *&p0.entry_px_times_size_sum - _v6
        };
        let _v9 = _v2;
        let _v10 = p1 as u128;
        if (_v3) _v1 = _v9 / _v10 else {
            let _v11 = _v9;
            let _v12 = _v10;
            if (_v11 == 0u128) if (_v12 != 0u128) _v1 = 0u128 else {
                let _v13 = error::invalid_argument(4);
                abort _v13
            } else _v1 = (_v11 - 1u128) / _v12 + 1u128
        };
        p3 = _v1 as u64;
        if (_v3) _v0 = p3 as i64 else _v0 = -(p3 as i64);
        let (_v14,_v15) = get_position_funding_cost_and_index_impl(p0, p1, p2);
        _v0 - _v14
    }
    friend fun positions_to_liquidate(p0: address, p1: object::Object<perp_market::PerpMarket>): vector<PerpPosition>
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
                            _v12 = &_v14;
                            let _v15 = vector::empty<PerpPosition>();
                            _v11 = 0;
                            _v10 = vector::length<object::Object<perp_market::PerpMarket>>(_v12);
                            while (_v11 < _v10) {
                                _v9 = vector::borrow<object::Object<perp_market::PerpMarket>>(_v12, _v11);
                                let _v16 = &mut _v15;
                                let _v17 = *big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2, _v9);
                                vector::push_back<PerpPosition>(_v16, _v17);
                                _v11 = _v11 + 1;
                                continue
                            };
                            _v7 = vector::empty<PerpPosition>();
                            let _v18 = _v15;
                            vector::reverse<PerpPosition>(&mut _v18);
                            _v6 = _v18;
                            _v11 = vector::length<PerpPosition>(&_v6);
                            loop {
                                if (!(_v11 > 0)) break 'l0;
                                let _v19 = vector::pop_back<PerpPosition>(&mut _v6);
                                if (!*&(&_v19).is_isolated) vector::push_back<PerpPosition>(&mut _v7, _v19);
                                _v11 = _v11 - 1;
                                continue
                            }
                        }
                    } else {
                        let _v20 = big_ordered_map::keys<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2);
                        _v12 = &_v20;
                        _v13 = vector::empty<PerpPosition>();
                        _v11 = 0;
                        _v10 = vector::length<object::Object<perp_market::PerpMarket>>(_v12)
                    };
                    while (_v11 < _v10) {
                        _v9 = vector::borrow<object::Object<perp_market::PerpMarket>>(_v12, _v11);
                        let _v21 = &mut _v13;
                        let _v22 = *big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PerpPosition>(_v2, _v9);
                        vector::push_back<PerpPosition>(_v21, _v22);
                        _v11 = _v11 + 1;
                        continue
                    };
                    _v1 = vector::empty<PerpPosition>();
                    let _v23 = _v13;
                    vector::reverse<PerpPosition>(&mut _v23);
                    _v0 = _v23;
                    _v11 = vector::length<PerpPosition>(&_v0);
                    loop {
                        if (!(_v11 > 0)) break 'l1;
                        let _v24 = vector::pop_back<PerpPosition>(&mut _v0);
                        if (!*&(&_v24).is_isolated) vector::push_back<PerpPosition>(&mut _v1, _v24);
                        _v11 = _v11 - 1;
                        continue
                    };
                    break
                };
                let _v25 = vector::empty<PerpPosition>();
                vector::push_back<PerpPosition>(&mut _v25, _v8);
                return _v25
            };
            vector::destroy_empty<PerpPosition>(_v6);
            return _v7
        };
        vector::destroy_empty<PerpPosition>(_v0);
        _v1
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
        acquires UserPositions
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
                _v0 = *&p0.entry_px_times_size_sum;
                let _v5 = _v4 as u128;
                let _v6 = (*&p0.size) as u128;
                if (*&p0.is_long) {
                    let _v7;
                    let _v8 = _v6;
                    if (!(_v8 != 0u128)) {
                        let _v9 = error::invalid_argument(4);
                        abort _v9
                    };
                    let _v10 = _v0 as u256;
                    let _v11 = _v5 as u256;
                    let _v12 = _v10 * _v11;
                    let _v13 = _v8 as u256;
                    if (_v12 == 0u256) if (_v13 != 0u256) _v7 = 0u256 else {
                        let _v14 = error::invalid_argument(4);
                        abort _v14
                    } else _v7 = (_v12 - 1u256) / _v13 + 1u256;
                    _v3 = _v7 as u128
                } else if (_v6 != 0u128) {
                    let _v15 = _v0 as u256;
                    let _v16 = _v5 as u256;
                    let _v17 = _v15 * _v16;
                    let _v18 = _v6 as u256;
                    _v3 = (_v17 / _v18) as u128
                } else {
                    let _v19 = error::invalid_argument(4);
                    abort _v19
                };
                _v1 = &mut p0.entry_px_times_size_sum;
                *_v1 = _v3;
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
            _v0 = _v30 + _v31;
            let _v32 = *&p0.size;
            let _v33 = p3 + _v32;
            let _v34 = &mut p0.size;
            *_v34 = _v33;
            let _v35 = (*&p0.size) as u128;
            let _v36 = (_v0 / _v35) as u64;
            let _v37 = &mut p0.avg_acquire_entry_px;
            *_v37 = _v36;
            _v1 = &mut p0.entry_px_times_size_sum;
            *_v1 = _v0
        };
        let _v38 = &mut p0.unrealized_funding_amount_before_last_update;
        *_v38 = p4;
        let _v39 = &mut p0.funding_index_at_last_update;
        *_v39 = p5;
    }
}
