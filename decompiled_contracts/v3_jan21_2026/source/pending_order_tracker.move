module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::pending_order_tracker {
    use 0x1::big_ordered_map;
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0x1::option;
    use 0x1::table;
    use 0x1::string;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book_types;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_tp_sl_tracker;
    use 0x1::signer;
    use 0x1::error;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market_config;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine_types;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::builder_code_registry;
    use 0x1::vector;
    use 0x1::ordered_map;
    use 0x1::math128;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::price_management;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_positions;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_tp_sl;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::order_margin;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::accounts_collateral;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::clearinghouse_perp;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    struct AccountSummary has store {
        markets: big_ordered_map::BigOrderedMap<object::Object<perp_market::PerpMarket>, PendingMarketState>,
    }
    enum PendingMarketState has copy, drop, store {
        V1 {
            pending_margin: u64,
            pending_longs: PendingOrders,
            pending_shorts: PendingOrders,
            reduce_only_orders: ReduceOnlyOrders,
            tp_reqs: PendingTpSLs,
            sl_reqs: PendingTpSLs,
        }
    }
    struct PendingOrders has copy, drop, store {
        price_size_sum: u128,
        size_sum: u64,
    }
    struct ReduceOnlyOrders has copy, drop, store {
        total_size: u64,
        orders: vector<ReduceOnlyOrderInfo>,
    }
    struct PendingTpSLs has copy, drop, store {
        full_sized: option::Option<PendingTpSlKey>,
        fixed_sized: vector<PendingTpSlKey>,
        pending_order_based_tp_sl_count: u64,
    }
    struct AccountSummaryView has copy, drop {
        markets: vector<PendingMarketStateView>,
    }
    struct PendingMarketStateView has copy, drop {
        market: object::Object<perp_market::PerpMarket>,
        name: string::String,
        state: PendingMarketState,
    }
    struct FixedSizedTpSlForEvent has copy, drop, store {
        order_id: u128,
        trigger_price: u64,
        limit_price: option::Option<u64>,
        size: u64,
    }
    struct FullSizedTpSlForEvent has copy, drop, store {
        order_id: u128,
        trigger_price: u64,
        limit_price: option::Option<u64>,
    }
    enum GlobalSummary has key {
        V1 {
            summary: table::Table<address, AccountSummary>,
        }
    }
    struct ReduceOnlyOrderInfo has copy, drop, store {
        order_id: order_book_types::OrderId,
        size: u64,
    }
    struct PendingTpSlKey has copy, drop, store {
        price_index: position_tp_sl_tracker::PriceIndexKey,
        order_id: order_book_types::OrderId,
    }
    struct PendingTpSlInfo has copy, drop {
        order_id: order_book_types::OrderId,
        trigger_price: u64,
        account: address,
        limit_price: option::Option<u64>,
        size: option::Option<u64>,
    }
    friend fun initialize(p0: &signer) {
        if (!(signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88)) {
            let _v0 = error::invalid_argument(1);
            abort _v0
        };
        if (!exists<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88)) {
            let _v1 = GlobalSummary::V1{summary: table::new<address,AccountSummary>()};
            move_to<GlobalSummary>(p0, _v1);
            return ()
        };
    }
    friend fun add_non_reduce_only_order(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: u64, p4: bool, p5: u64, p6: bool, p7: u8)
        acquires GlobalSummary
    {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4 = borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v5 = table::remove<address,AccountSummary>(&mut _v4.summary, p0);
        let _v6 = &(&_v5).markets;
        let _v7 = &p1;
        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v6, _v7)) {
            let _v8 = &mut (&mut _v5).markets;
            let _v9 = PendingOrders{price_size_sum: 0u128, size_sum: 0};
            let _v10 = PendingOrders{price_size_sum: 0u128, size_sum: 0};
            let _v11 = vector::empty<ReduceOnlyOrderInfo>();
            let _v12 = ReduceOnlyOrders{total_size: 0, orders: _v11};
            let _v13 = option::none<PendingTpSlKey>();
            let _v14 = vector::empty<PendingTpSlKey>();
            let _v15 = PendingTpSLs{full_sized: _v13, fixed_sized: _v14, pending_order_based_tp_sl_count: 0};
            let _v16 = option::none<PendingTpSlKey>();
            let _v17 = vector::empty<PendingTpSlKey>();
            let _v18 = PendingTpSLs{full_sized: _v16, fixed_sized: _v17, pending_order_based_tp_sl_count: 0};
            let _v19 = PendingMarketState::V1{pending_margin: 0, pending_longs: _v9, pending_shorts: _v10, reduce_only_orders: _v12, tp_reqs: _v15, sl_reqs: _v18};
            big_ordered_map::add<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v8, p1, _v19)
        };
        let _v20 = &mut (&mut _v5).markets;
        let _v21 = &p1;
        let _v22 = big_ordered_map::remove<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v20, _v21);
        if (p4) {
            _v3 = &mut (&mut _v22).pending_longs;
            let _v23 = p2;
            let _v24 = _v23 as u128;
            let _v25 = p3 as u128;
            _v2 = _v24 * _v25;
            _v1 = &mut _v3.price_size_sum;
            *_v1 = *_v1 + _v2;
            _v0 = &mut _v3.size_sum;
            *_v0 = *_v0 + _v23
        } else {
            _v3 = &mut (&mut _v22).pending_shorts;
            let _v26 = p2 as u128;
            let _v27 = p3 as u128;
            _v2 = _v26 * _v27;
            _v1 = &mut _v3.price_size_sum;
            *_v1 = *_v1 + _v2;
            _v0 = &mut _v3.size_sum;
            *_v0 = *_v0 + p2
        };
        let _v28 = &mut _v22;
        let _v29 = perp_market_config::get_size_multiplier(p1);
        update_required_margin_for_market(_v28, p5, p6, p7, _v29);
        big_ordered_map::add<object::Object<perp_market::PerpMarket>,PendingMarketState>(&mut (&mut _v5).markets, p1, _v22);
        table::add<address,AccountSummary>(&mut _v4.summary, p0, _v5);
    }
    fun update_required_margin_for_market(p0: &mut PendingMarketState, p1: u64, p2: bool, p3: u8, p4: u64) {
        let _v0;
        let _v1 = &p0.pending_longs;
        let _v2 = &p0.pending_shorts;
        let _v3 = pending_price_size_for_market(p1, p2, _v1, _v2);
        let _v4 = p4 as u128;
        let _v5 = p3 as u128;
        let _v6 = _v4 * _v5;
        if (_v3 == 0u128) if (_v6 != 0u128) _v0 = 0u128 else {
            let _v7 = error::invalid_argument(4);
            abort _v7
        } else _v0 = (_v3 - 1u128) / _v6 + 1u128;
        let _v8 = _v0 as u64;
        let _v9 = &mut p0.pending_margin;
        *_v9 = _v8;
    }
    friend fun add_order_based_tp_sl(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: bool)
        acquires GlobalSummary
    {
        let _v0;
        let _v1 = &mut table::borrow_mut<address,AccountSummary>(&mut borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0).markets;
        let _v2 = &p1;
        let _v3 = _v1;
        let _v4 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PendingMarketState>(freeze(_v3), _v2);
        let _v5 = &_v4;
        let _v6 = freeze(_v3);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v5, _v6)) _v0 = option::none<bool>() else {
            let _v7 = |arg0| lambda__1__add_order_based_tp_sl(p2, p3, arg0);
            _v0 = option::some<bool>(big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>,PendingMarketState,bool>(_v4, _v3, _v7))
        };
        if (!option::is_some<bool>(&_v0)) {
            let _v8;
            let _v9 = *_v2;
            let _v10 = PendingOrders{price_size_sum: 0u128, size_sum: 0};
            let _v11 = PendingOrders{price_size_sum: 0u128, size_sum: 0};
            let _v12 = vector::empty<ReduceOnlyOrderInfo>();
            let _v13 = ReduceOnlyOrders{total_size: 0, orders: _v12};
            let _v14 = option::none<PendingTpSlKey>();
            let _v15 = vector::empty<PendingTpSlKey>();
            let _v16 = PendingTpSLs{full_sized: _v14, fixed_sized: _v15, pending_order_based_tp_sl_count: 0};
            let _v17 = option::none<PendingTpSlKey>();
            let _v18 = vector::empty<PendingTpSlKey>();
            let _v19 = PendingTpSLs{full_sized: _v17, fixed_sized: _v18, pending_order_based_tp_sl_count: 0};
            let _v20 = PendingMarketState::V1{pending_margin: 0, pending_longs: _v10, pending_shorts: _v11, reduce_only_orders: _v13, tp_reqs: _v16, sl_reqs: _v19};
            let _v21 = &mut _v20;
            if (p2) {
                _v8 = &mut (&mut _v21.tp_reqs).pending_order_based_tp_sl_count;
                *_v8 = *_v8 + 1
            };
            if (p3) {
                _v8 = &mut (&mut _v21.sl_reqs).pending_order_based_tp_sl_count;
                *_v8 = *_v8 + 1
            };
            big_ordered_map::add<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v1, _v9, _v20)
        };
    }
    fun lambda__1__add_order_based_tp_sl(p0: bool, p1: bool, p2: &mut PendingMarketState): bool {
        let _v0;
        if (p0) {
            _v0 = &mut (&mut p2.tp_reqs).pending_order_based_tp_sl_count;
            *_v0 = *_v0 + 1
        };
        if (p1) {
            _v0 = &mut (&mut p2.sl_reqs).pending_order_based_tp_sl_count;
            *_v0 = *_v0 + 1
        };
        true
    }
    friend fun add_reduce_only_order(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: order_book_types::OrderId, p3: u64, p4: bool, p5: u64, p6: bool): vector<perp_engine_types::SingleOrderAction>
        acquires GlobalSummary
    {
        let _v0;
        let _v1;
        let _v2 = table::borrow_mut<address,AccountSummary>(&mut borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0);
        let _v3 = &_v2.markets;
        let _v4 = &p1;
        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v3, _v4)) {
            _v0 = &mut _v2.markets;
            let _v5 = PendingOrders{price_size_sum: 0u128, size_sum: 0};
            let _v6 = PendingOrders{price_size_sum: 0u128, size_sum: 0};
            let _v7 = vector::empty<ReduceOnlyOrderInfo>();
            let _v8 = ReduceOnlyOrders{total_size: 0, orders: _v7};
            let _v9 = option::none<PendingTpSlKey>();
            let _v10 = vector::empty<PendingTpSlKey>();
            let _v11 = PendingTpSLs{full_sized: _v9, fixed_sized: _v10, pending_order_based_tp_sl_count: 0};
            let _v12 = option::none<PendingTpSlKey>();
            let _v13 = vector::empty<PendingTpSlKey>();
            let _v14 = PendingTpSLs{full_sized: _v12, fixed_sized: _v13, pending_order_based_tp_sl_count: 0};
            let _v15 = PendingMarketState::V1{pending_margin: 0, pending_longs: _v5, pending_shorts: _v6, reduce_only_orders: _v8, tp_reqs: _v11, sl_reqs: _v14};
            big_ordered_map::add<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v0, p1, _v15)
        };
        _v0 = &mut _v2.markets;
        let _v16 = &p1;
        let _v17 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PendingMarketState>(freeze(_v0), _v16);
        let _v18 = &_v17;
        let _v19 = freeze(_v0);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v18, _v19)) _v1 = option::none<vector<perp_engine_types::SingleOrderAction>>() else {
            let _v20 = |arg0| lambda__1__add_reduce_only_order(p0, p2, p3, p4, p5, p6, arg0);
            _v1 = option::some<vector<perp_engine_types::SingleOrderAction>>(big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>,PendingMarketState,vector<perp_engine_types::SingleOrderAction>>(_v17, _v0, _v20))
        };
        option::destroy_some<vector<perp_engine_types::SingleOrderAction>>(_v1)
    }
    fun lambda__1__add_reduce_only_order(p0: address, p1: order_book_types::OrderId, p2: u64, p3: bool, p4: u64, p5: bool, p6: &mut PendingMarketState): vector<perp_engine_types::SingleOrderAction> {
        let _v0 = &mut p6.reduce_only_orders;
        if (!(p3 != p5)) {
            let _v1 = error::invalid_argument(5);
            abort _v1
        };
        let _v2 = &mut _v0.orders;
        let _v3 = ReduceOnlyOrderInfo{order_id: p1, size: p2};
        vector::push_back<ReduceOnlyOrderInfo>(_v2, _v3);
        let _v4 = p2;
        let _v5 = &mut _v0.total_size;
        *_v5 = *_v5 + _v4;
        let _v6 = vector::empty<perp_engine_types::SingleOrderAction>();
        let _v7 = *&_v0.total_size;
        'l1: loop {
            let _v8;
            if (_v7 > p4) {
                _v4 = *&_v0.total_size - p4;
                _v8 = 0
            } else break;
            'l0: loop {
                loop {
                    let _v9 = vector::length<ReduceOnlyOrderInfo>(&_v0.orders);
                    if (_v8 < _v9) p3 = _v4 > 0 else p3 = false;
                    if (!p3) break 'l0;
                    let _v10 = *&vector::borrow<ReduceOnlyOrderInfo>(&_v0.orders, _v8).size;
                    if (_v4 < _v10) break;
                    let _v11 = &mut _v6;
                    let _v12 = *&vector::borrow<ReduceOnlyOrderInfo>(&_v0.orders, _v8).order_id;
                    let _v13 = perp_engine_types::new_cancel_order_action(p0, _v12);
                    vector::push_back<perp_engine_types::SingleOrderAction>(_v11, _v13);
                    let _v14 = *&vector::borrow<ReduceOnlyOrderInfo>(&_v0.orders, _v8).size;
                    _v4 = _v4 - _v14;
                    _v8 = _v8 + 1;
                    continue
                };
                let _v15 = &mut _v6;
                let _v16 = *&vector::borrow<ReduceOnlyOrderInfo>(&_v0.orders, _v8).order_id;
                let _v17 = perp_engine_types::new_reduce_order_size_action(p0, _v16, _v4);
                vector::push_back<perp_engine_types::SingleOrderAction>(_v15, _v17);
                break 'l1
            };
            break
        };
        _v6
    }
    friend fun add_tp_sl(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: order_book_types::OrderId, p3: u64, p4: option::Option<u64>, p5: option::Option<u64>, p6: bool, p7: u64, p8: bool, p9: option::Option<builder_code_registry::BuilderCode>, p10: bool)
        acquires GlobalSummary
    {
        if (!validate_tp_sl(p1, p8, p3, p6)) {
            let _v0 = error::invalid_argument(7);
            abort _v0
        };
        let _v1 = option::is_none<u64>(&p5);
        let _v2 = position_tp_sl_tracker::new_price_index_key(p3, p0, p4, _v1, p9);
        let _v3 = PendingTpSlKey{price_index: _v2, order_id: p2};
        let _v4 = table::borrow_mut<address,AccountSummary>(&mut borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0);
        let _v5 = &_v4.markets;
        let _v6 = &p1;
        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v5, _v6)) {
            let _v7 = &mut _v4.markets;
            let _v8 = PendingOrders{price_size_sum: 0u128, size_sum: 0};
            let _v9 = PendingOrders{price_size_sum: 0u128, size_sum: 0};
            let _v10 = vector::empty<ReduceOnlyOrderInfo>();
            let _v11 = ReduceOnlyOrders{total_size: 0, orders: _v10};
            let _v12 = option::none<PendingTpSlKey>();
            let _v13 = vector::empty<PendingTpSlKey>();
            let _v14 = PendingTpSLs{full_sized: _v12, fixed_sized: _v13, pending_order_based_tp_sl_count: 0};
            let _v15 = option::none<PendingTpSlKey>();
            let _v16 = vector::empty<PendingTpSlKey>();
            let _v17 = PendingTpSLs{full_sized: _v15, fixed_sized: _v16, pending_order_based_tp_sl_count: 0};
            let _v18 = PendingMarketState::V1{pending_margin: 0, pending_longs: _v8, pending_shorts: _v9, reduce_only_orders: _v11, tp_reqs: _v14, sl_reqs: _v17};
            big_ordered_map::add<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v7, p1, _v18)
        };
        let _v19 = &mut _v4.markets;
        let _v20 = &p1;
        let _v21 = big_ordered_map::remove<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v19, _v20);
        let _v22 = option::is_none<u64>(&p5);
        loop {
            if (_v22) {
                if (p6) {
                    if (option::is_some<PendingTpSlKey>(&(&(&_v21).tp_reqs).full_sized)) {
                        let _v23 = option::destroy_some<PendingTpSlKey>(*&(&(&_v21).tp_reqs).full_sized);
                        let _v24 = *&(&_v23).price_index;
                        position_tp_sl_tracker::cancel_pending_tp_sl(p1, _v24, p6, p8)
                    };
                    let _v25 = option::some<PendingTpSlKey>(_v3);
                    let _v26 = &mut (&mut (&mut _v21).tp_reqs).full_sized;
                    *_v26 = _v25;
                    break
                };
                if (option::is_some<PendingTpSlKey>(&(&(&_v21).sl_reqs).full_sized)) {
                    let _v27 = option::destroy_some<PendingTpSlKey>(*&(&(&_v21).sl_reqs).full_sized);
                    let _v28 = *&(&_v27).price_index;
                    position_tp_sl_tracker::cancel_pending_tp_sl(p1, _v28, p6, p8)
                };
                let _v29 = option::some<PendingTpSlKey>(_v3);
                let _v30 = &mut (&mut (&mut _v21).sl_reqs).full_sized;
                *_v30 = _v29;
                break
            };
            let _v31 = option::destroy_some<u64>(p5);
            if (!(p7 >= _v31)) {
                let _v32 = error::invalid_argument(10);
                abort _v32
            };
            if (p6) {
                if (p10) {
                    let _v33 = vector::length<PendingTpSlKey>(&(&(&_v21).tp_reqs).fixed_sized);
                    let _v34 = *&(&(&_v21).tp_reqs).pending_order_based_tp_sl_count;
                    if (!(_v33 + _v34 < 5)) {
                        let _v35 = error::invalid_argument(8);
                        abort _v35
                    }
                };
                vector::push_back<PendingTpSlKey>(&mut (&mut (&mut _v21).tp_reqs).fixed_sized, _v3);
                break
            };
            if (p10) {
                let _v36 = vector::length<PendingTpSlKey>(&(&(&_v21).sl_reqs).fixed_sized);
                let _v37 = *&(&(&_v21).sl_reqs).pending_order_based_tp_sl_count;
                if (!(_v36 + _v37 < 5)) {
                    let _v38 = error::invalid_argument(8);
                    abort _v38
                }
            };
            vector::push_back<PendingTpSlKey>(&mut (&mut (&mut _v21).sl_reqs).fixed_sized, _v3);
            break
        };
        position_tp_sl_tracker::add_new_tp_sl(p1, p0, p2, _v2, p4, p5, p6, p8);
        big_ordered_map::add<object::Object<perp_market::PerpMarket>,PendingMarketState>(&mut _v4.markets, p1, _v21);
    }
    friend fun validate_tp_sl(p0: object::Object<perp_market::PerpMarket>, p1: bool, p2: u64, p3: bool): bool {
        let _v0;
        let _v1;
        let _v2 = price_management::get_mark_price(p0);
        if (p1) _v1 = p3 else _v1 = false;
        if (_v1) _v0 = true else if (p1) _v0 = false else _v0 = !p3;
        'l0: loop {
            loop {
                if (_v0) if (!(p2 > _v2)) break else if (p2 < _v2) break 'l0 else break;
                return true
            };
            return false
        };
        true
    }
    friend fun cancel_all_tp_sl_for_position(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: bool)
        acquires GlobalSummary
    {
        let _v0;
        let _v1 = &mut table::borrow_mut<address,AccountSummary>(&mut borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p1).markets;
        let _v2 = &p0;
        let _v3 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PendingMarketState>(freeze(_v1), _v2);
        let _v4 = &_v3;
        let _v5 = freeze(_v1);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v4, _v5)) _v0 = option::none<bool>() else {
            let _v6 = |arg0| lambda__1__cancel_all_tp_sl_for_position(p0, p2, arg0);
            _v0 = option::some<bool>(big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>,PendingMarketState,bool>(_v3, _v1, _v6))
        };
        let _v7 = option::is_some<bool>(&_v0);
    }
    fun lambda__1__cancel_all_tp_sl_for_position(p0: object::Object<perp_market::PerpMarket>, p1: bool, p2: &mut PendingMarketState): bool {
        cancel_full_sized_tp_sl(p0, p2, true, p1);
        cancel_full_sized_tp_sl(p0, p2, false, p1);
        let _v0 = *&(&p2.tp_reqs).fixed_sized;
        vector::reverse<PendingTpSlKey>(&mut _v0);
        let _v1 = _v0;
        let _v2 = vector::length<PendingTpSlKey>(&_v1);
        while (_v2 > 0) {
            let _v3 = vector::pop_back<PendingTpSlKey>(&mut _v1);
            let _v4 = *&(&_v3).price_index;
            position_tp_sl_tracker::cancel_pending_tp_sl(p0, _v4, true, p1);
            _v2 = _v2 - 1;
            continue
        };
        vector::destroy_empty<PendingTpSlKey>(_v1);
        let _v5 = *&(&p2.sl_reqs).fixed_sized;
        vector::reverse<PendingTpSlKey>(&mut _v5);
        let _v6 = _v5;
        _v2 = vector::length<PendingTpSlKey>(&_v6);
        while (_v2 > 0) {
            let _v7 = vector::pop_back<PendingTpSlKey>(&mut _v6);
            let _v8 = *&(&_v7).price_index;
            position_tp_sl_tracker::cancel_pending_tp_sl(p0, _v8, false, p1);
            _v2 = _v2 - 1;
            continue
        };
        vector::destroy_empty<PendingTpSlKey>(_v6);
        let _v9 = vector::empty<PendingTpSlKey>();
        let _v10 = &mut (&mut p2.tp_reqs).fixed_sized;
        *_v10 = _v9;
        let _v11 = vector::empty<PendingTpSlKey>();
        let _v12 = &mut (&mut p2.sl_reqs).fixed_sized;
        *_v12 = _v11;
        true
    }
    fun cancel_full_sized_tp_sl(p0: object::Object<perp_market::PerpMarket>, p1: &mut PendingMarketState, p2: bool, p3: bool) {
        let _v0 = remove_full_sized_tp_sl(p1, p2);
        if (option::is_some<PendingTpSlKey>(&_v0)) {
            let _v1 = option::destroy_some<PendingTpSlKey>(_v0);
            let _v2 = *&(&_v1).price_index;
            position_tp_sl_tracker::cancel_pending_tp_sl(p0, _v2, p2, p3);
            return ()
        };
    }
    fun remove_full_sized_tp_sl(p0: &mut PendingMarketState, p1: bool): option::Option<PendingTpSlKey> {
        let _v0;
        if (p1) {
            _v0 = *&(&p0.tp_reqs).full_sized;
            let _v1 = option::none<PendingTpSlKey>();
            let _v2 = &mut (&mut p0.tp_reqs).full_sized;
            *_v2 = _v1
        } else {
            let _v3 = *&(&p0.sl_reqs).full_sized;
            let _v4 = option::none<PendingTpSlKey>();
            let _v5 = &mut (&mut p0.sl_reqs).full_sized;
            *_v5 = _v4;
            _v0 = _v3
        };
        _v0
    }
    friend fun cancel_tp_sl(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: order_book_types::OrderId, p3: bool): option::Option<PendingTpSlKey>
        acquires GlobalSummary
    {
        let _v0;
        let _v1 = table::borrow_mut<address,AccountSummary>(&mut borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0);
        let _v2 = &_v1.markets;
        let _v3 = &p1;
        let _v4 = big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v2, _v3);
        'l2: loop {
            let _v5;
            'l3: loop {
                let _v6;
                'l1: loop {
                    let _v7;
                    'l0: loop {
                        let _v8;
                        loop {
                            if (_v4) {
                                let _v9 = &mut _v1.markets;
                                let _v10 = &p1;
                                _v0 = big_ordered_map::remove<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v9, _v10);
                                _v8 = remove_full_sized_tp_sl_for_order_internal(&mut _v0, true, p2);
                                if (option::is_some<PendingTpSlKey>(&_v8)) break;
                                _v7 = remove_full_sized_tp_sl_for_order_internal(&mut _v0, false, p2);
                                if (option::is_some<PendingTpSlKey>(&_v7)) break 'l0;
                                _v6 = remove_fixed_sized_tp_sl_for_order_internal(&mut _v0, true, p2);
                                if (option::is_some<PendingTpSlKey>(&_v6)) break 'l1;
                                _v5 = remove_fixed_sized_tp_sl_for_order_internal(&mut _v0, false, p2);
                                if (!option::is_some<PendingTpSlKey>(&_v5)) break 'l2;
                                break 'l3
                            };
                            return option::none<PendingTpSlKey>()
                        };
                        let _v11 = option::destroy_some<PendingTpSlKey>(_v8);
                        let _v12 = *&(&_v11).price_index;
                        position_tp_sl_tracker::cancel_pending_tp_sl(p1, _v12, true, p3);
                        big_ordered_map::add<object::Object<perp_market::PerpMarket>,PendingMarketState>(&mut _v1.markets, p1, _v0);
                        return _v8
                    };
                    let _v13 = option::destroy_some<PendingTpSlKey>(_v7);
                    let _v14 = *&(&_v13).price_index;
                    position_tp_sl_tracker::cancel_pending_tp_sl(p1, _v14, false, p3);
                    big_ordered_map::add<object::Object<perp_market::PerpMarket>,PendingMarketState>(&mut _v1.markets, p1, _v0);
                    return _v7
                };
                let _v15 = option::destroy_some<PendingTpSlKey>(_v6);
                let _v16 = *&(&_v15).price_index;
                position_tp_sl_tracker::cancel_pending_tp_sl(p1, _v16, true, p3);
                big_ordered_map::add<object::Object<perp_market::PerpMarket>,PendingMarketState>(&mut _v1.markets, p1, _v0);
                return _v6
            };
            let _v17 = option::destroy_some<PendingTpSlKey>(_v5);
            let _v18 = *&(&_v17).price_index;
            position_tp_sl_tracker::cancel_pending_tp_sl(p1, _v18, false, p3);
            big_ordered_map::add<object::Object<perp_market::PerpMarket>,PendingMarketState>(&mut _v1.markets, p1, _v0);
            return _v5
        };
        big_ordered_map::add<object::Object<perp_market::PerpMarket>,PendingMarketState>(&mut _v1.markets, p1, _v0);
        option::none<PendingTpSlKey>()
    }
    fun remove_full_sized_tp_sl_for_order_internal(p0: &mut PendingMarketState, p1: bool, p2: order_book_types::OrderId): option::Option<PendingTpSlKey> {
        let _v0 = p1;
        'l1: loop {
            'l0: loop {
                loop {
                    if (_v0) {
                        if (option::is_some<PendingTpSlKey>(&(&p0.tp_reqs).full_sized)) {
                            let _v1 = option::destroy_some<PendingTpSlKey>(*&(&p0.tp_reqs).full_sized);
                            p1 = *&(&_v1).order_id == p2
                        } else p1 = false;
                        if (p1) break;
                        break 'l0
                    };
                    if (option::is_some<PendingTpSlKey>(&(&p0.sl_reqs).full_sized)) {
                        let _v2 = option::destroy_some<PendingTpSlKey>(*&(&p0.sl_reqs).full_sized);
                        p1 = *&(&_v2).order_id == p2
                    } else p1 = false;
                    if (p1) break 'l1;
                    break 'l0
                };
                return remove_full_sized_tp_sl(p0, true)
            };
            return option::none<PendingTpSlKey>()
        };
        remove_full_sized_tp_sl(p0, false)
    }
    fun remove_fixed_sized_tp_sl_for_order_internal(p0: &mut PendingMarketState, p1: bool, p2: order_book_types::OrderId): option::Option<PendingTpSlKey> {
        let _v0;
        if (p1) _v0 = &mut p0.tp_reqs else _v0 = &mut p0.sl_reqs;
        let _v1 = &_v0.fixed_sized;
        let _v2 = false;
        let _v3 = 0;
        let _v4 = 0;
        let _v5 = vector::length<PendingTpSlKey>(_v1);
        'l0: loop {
            loop {
                if (!(_v4 < _v5)) break 'l0;
                let _v6 = &vector::borrow<PendingTpSlKey>(_v1, _v4).order_id;
                let _v7 = &p2;
                if (_v6 == _v7) break;
                _v4 = _v4 + 1;
                continue
            };
            _v2 = true;
            _v3 = _v4;
            break
        };
        if (_v2) return option::some<PendingTpSlKey>(vector::swap_remove<PendingTpSlKey>(&mut _v0.fixed_sized, _v3));
        option::none<PendingTpSlKey>()
    }
    friend fun clear_reduce_only_orders(p0: address, p1: object::Object<perp_market::PerpMarket>): vector<order_book_types::OrderId>
        acquires GlobalSummary
    {
        let _v0;
        let _v1 = &mut table::borrow_mut<address,AccountSummary>(&mut borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0).markets;
        let _v2 = &p1;
        let _v3 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PendingMarketState>(freeze(_v1), _v2);
        let _v4 = &_v3;
        let _v5 = freeze(_v1);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v4, _v5)) _v0 = option::none<vector<order_book_types::OrderId>>() else {
            let _v6 = |arg0| lambda__1__clear_reduce_only_orders(arg0);
            _v0 = option::some<vector<order_book_types::OrderId>>(big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>,PendingMarketState,vector<order_book_types::OrderId>>(_v3, _v1, _v6))
        };
        if (option::is_some<vector<order_book_types::OrderId>>(&_v0)) return option::destroy_some<vector<order_book_types::OrderId>>(_v0);
        vector::empty<order_book_types::OrderId>()
    }
    fun lambda__1__clear_reduce_only_orders(p0: &mut PendingMarketState): vector<order_book_types::OrderId> {
        let _v0 = &mut p0.reduce_only_orders;
        let _v1 = vector::empty<order_book_types::OrderId>();
        let _v2 = 0;
        loop {
            let _v3 = vector::length<ReduceOnlyOrderInfo>(&_v0.orders);
            if (!(_v2 < _v3)) break;
            let _v4 = &mut _v1;
            let _v5 = *&vector::borrow<ReduceOnlyOrderInfo>(&_v0.orders, _v2).order_id;
            vector::push_back<order_book_types::OrderId>(_v4, _v5);
            _v2 = _v2 + 1;
            continue
        };
        let _v6 = &mut _v0.total_size;
        *_v6 = 0;
        let _v7 = vector::empty<ReduceOnlyOrderInfo>();
        let _v8 = &mut _v0.orders;
        *_v8 = _v7;
        _v1
    }
    friend fun decrease_reduce_only_order_size(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: order_book_types::OrderId, p3: u64)
        acquires GlobalSummary
    {
        let _v0 = &mut table::borrow_mut<address,AccountSummary>(&mut borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0).markets;
        let _v1 = &p1;
        let _v2 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PendingMarketState>(freeze(_v0), _v1);
        let _v3 = &_v2;
        let _v4 = freeze(_v0);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v3, _v4)) {
            let _v5 = error::invalid_argument(2);
            abort _v5
        };
        let _v6: |&mut PendingMarketState|bool has copy + drop = |arg0| lambda__1__decrease_reduce_only_order_size(p2, p3, arg0);
        let _v7 = big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>,PendingMarketState,bool>(_v2, _v0, _v6);
    }
    fun lambda__1__decrease_reduce_only_order_size(p0: order_book_types::OrderId, p1: u64, p2: &mut PendingMarketState): bool {
        let _v0 = &mut p2.reduce_only_orders;
        let _v1 = 0;
        'l1: loop {
            let _v2;
            'l0: loop {
                loop {
                    let _v3 = vector::length<ReduceOnlyOrderInfo>(&_v0.orders);
                    if (!(_v1 < _v3)) break;
                    let _v4 = &vector::borrow<ReduceOnlyOrderInfo>(&_v0.orders, _v1).order_id;
                    let _v5 = &p0;
                    if (_v4 == _v5) break 'l0;
                    _v1 = _v1 + 1;
                    continue
                };
                break 'l1
            };
            if (!(*&vector::borrow<ReduceOnlyOrderInfo>(&_v0.orders, _v1).size >= p1)) {
                let _v6 = error::invalid_argument(3);
                abort _v6
            };
            let _v7 = *&vector::borrow<ReduceOnlyOrderInfo>(&_v0.orders, _v1).size - p1;
            let _v8 = *&_v0.total_size;
            if (_v8 >= _v7) _v2 = _v8 - _v7 else _v2 = 0;
            let _v9 = &mut _v0.total_size;
            *_v9 = _v2;
            _v9 = &mut vector::borrow_mut<ReduceOnlyOrderInfo>(&mut _v0.orders, _v1).size;
            *_v9 = p1;
            if (*&vector::borrow<ReduceOnlyOrderInfo>(&_v0.orders, _v1).size == 0) {
                let _v10 = vector::remove<ReduceOnlyOrderInfo>(&mut _v0.orders, _v1);
                break
            };
            break
        };
        true
    }
    friend fun get_all_tp_sls_for_event(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool): (option::Option<FullSizedTpSlForEvent>, option::Option<FullSizedTpSlForEvent>, vector<FixedSizedTpSlForEvent>, vector<FixedSizedTpSlForEvent>)
        acquires GlobalSummary
    {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4;
        let _v5 = table::borrow<address,AccountSummary>(&borrow_global<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0);
        let _v6 = &_v5.markets;
        let _v7 = &p1;
        let _v8 = big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v6, _v7);
        'l1: loop {
            if (_v8) {
                let _v9 = &_v5.markets;
                let _v10 = &p1;
                let _v11 = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v9, _v10);
                let _v12 = *&(&_v11.tp_reqs).full_sized;
                if (option::is_some<PendingTpSlKey>(&_v12)) {
                    let _v13 = option::destroy_some<PendingTpSlKey>(_v12);
                    let _v14 = *&(&_v13).price_index;
                    let (_v15,_v16,_v17,_v18,_v19) = position_tp_sl_tracker::get_pending_tp_sl(p1, _v14, true, p2);
                    let _v20 = _v18;
                    let _v21 = _v16;
                    if (option::is_none<u64>(&_v20)) {
                        let _v22 = order_book_types::get_order_id_value(&_v21);
                        let _v23 = position_tp_sl_tracker::get_trigger_price(&(&_v13).price_index);
                        _v4 = option::some<FullSizedTpSlForEvent>(FullSizedTpSlForEvent{order_id: _v22, trigger_price: _v23, limit_price: _v17})
                    } else abort 10
                } else _v4 = option::none<FullSizedTpSlForEvent>();
                let _v24 = *&(&_v11.sl_reqs).full_sized;
                if (option::is_some<PendingTpSlKey>(&_v24)) {
                    let _v25 = option::destroy_some<PendingTpSlKey>(_v24);
                    let _v26 = *&(&_v25).price_index;
                    let (_v27,_v28,_v29,_v30,_v31) = position_tp_sl_tracker::get_pending_tp_sl(p1, _v26, false, p2);
                    let _v32 = _v30;
                    let _v33 = _v28;
                    if (option::is_none<u64>(&_v32)) {
                        let _v34 = order_book_types::get_order_id_value(&_v33);
                        let _v35 = position_tp_sl_tracker::get_trigger_price(&(&_v25).price_index);
                        _v3 = option::some<FullSizedTpSlForEvent>(FullSizedTpSlForEvent{order_id: _v34, trigger_price: _v35, limit_price: _v29})
                    } else abort 10
                } else _v3 = option::none<FullSizedTpSlForEvent>();
                let _v36 = vector::empty<FixedSizedTpSlForEvent>();
                let _v37 = *&(&_v11.tp_reqs).fixed_sized;
                vector::reverse<PendingTpSlKey>(&mut _v37);
                let _v38 = _v37;
                let _v39 = vector::length<PendingTpSlKey>(&_v38);
                'l0: loop {
                    loop {
                        if (!(_v39 > 0)) break 'l0;
                        let _v40 = vector::pop_back<PendingTpSlKey>(&mut _v38);
                        let _v41 = *&(&_v40).price_index;
                        let (_v42,_v43,_v44,_v45,_v46) = position_tp_sl_tracker::get_pending_tp_sl(p1, _v41, true, p2);
                        let _v47 = _v45;
                        let _v48 = _v43;
                        if (!option::is_some<u64>(&_v47)) break;
                        let _v49 = &mut _v36;
                        let _v50 = order_book_types::get_order_id_value(&_v48);
                        let _v51 = position_tp_sl_tracker::get_trigger_price(&(&_v40).price_index);
                        let _v52 = option::destroy_some<u64>(_v47);
                        let _v53 = FixedSizedTpSlForEvent{order_id: _v50, trigger_price: _v51, limit_price: _v44, size: _v52};
                        vector::push_back<FixedSizedTpSlForEvent>(_v49, _v53);
                        _v39 = _v39 - 1;
                        continue
                    };
                    abort 10
                };
                vector::destroy_empty<PendingTpSlKey>(_v38);
                _v2 = _v36;
                _v1 = vector::empty<FixedSizedTpSlForEvent>();
                let _v54 = *&(&_v11.sl_reqs).fixed_sized;
                vector::reverse<PendingTpSlKey>(&mut _v54);
                _v0 = _v54;
                _v39 = vector::length<PendingTpSlKey>(&_v0);
                loop {
                    if (!(_v39 > 0)) break 'l1;
                    let _v55 = vector::pop_back<PendingTpSlKey>(&mut _v0);
                    let _v56 = *&(&_v55).price_index;
                    let (_v57,_v58,_v59,_v60,_v61) = position_tp_sl_tracker::get_pending_tp_sl(p1, _v56, false, p2);
                    let _v62 = _v60;
                    let _v63 = _v58;
                    if (!option::is_some<u64>(&_v62)) break;
                    let _v64 = &mut _v1;
                    let _v65 = order_book_types::get_order_id_value(&_v63);
                    let _v66 = position_tp_sl_tracker::get_trigger_price(&(&_v55).price_index);
                    let _v67 = option::destroy_some<u64>(_v62);
                    let _v68 = FixedSizedTpSlForEvent{order_id: _v65, trigger_price: _v66, limit_price: _v59, size: _v67};
                    vector::push_back<FixedSizedTpSlForEvent>(_v64, _v68);
                    _v39 = _v39 - 1;
                    continue
                };
                abort 10
            };
            let _v69 = option::none<FullSizedTpSlForEvent>();
            let _v70 = option::none<FullSizedTpSlForEvent>();
            let _v71 = vector::empty<FixedSizedTpSlForEvent>();
            let _v72 = vector::empty<FixedSizedTpSlForEvent>();
            return (_v69, _v70, _v71, _v72)
        };
        vector::destroy_empty<PendingTpSlKey>(_v0);
        (_v4, _v3, _v2, _v1)
    }
    friend fun get_fixed_sized_tp_sl(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: u64, p4: option::Option<u64>, p5: option::Option<builder_code_registry::BuilderCode>, p6: bool): option::Option<order_book_types::OrderId> {
        let _v0 = position_tp_sl_tracker::new_price_index_key(p3, p0, p4, false, p5);
        position_tp_sl_tracker::get_pending_order_id(p1, _v0, p2, p6)
    }
    friend fun get_fixed_sized_tp_sl_for_key(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: u64, p4: option::Option<u64>, p5: option::Option<builder_code_registry::BuilderCode>, p6: bool): option::Option<PendingTpSlInfo>
        acquires GlobalSummary
    {
        let _v0 = table::borrow<address,AccountSummary>(&borrow_global<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0);
        let _v1 = &_v0.markets;
        let _v2 = &p1;
        let _v3 = big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v1, _v2);
        loop {
            let _v4;
            let _v5;
            if (_v3) {
                let _v6 = &_v0.markets;
                let _v7 = &p1;
                let _v8 = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v6, _v7);
                if (p2) _v5 = *&_v8.tp_reqs else _v5 = *&_v8.sl_reqs;
                let _v9 = position_tp_sl_tracker::new_price_index_key(p3, p0, p4, false, p5);
                let _v10 = &(&_v5).fixed_sized;
                let _v11 = false;
                let _v12 = 0;
                let _v13 = 0;
                let _v14 = vector::length<PendingTpSlKey>(_v10);
                'l0: loop {
                    loop {
                        if (!(_v13 < _v14)) break 'l0;
                        let _v15 = &vector::borrow<PendingTpSlKey>(_v10, _v13).price_index;
                        let _v16 = &_v9;
                        if (_v15 == _v16) break;
                        _v13 = _v13 + 1;
                        continue
                    };
                    _v11 = true;
                    _v12 = _v13;
                    break
                };
                _v4 = _v12;
                if (!_v11) break
            } else return option::none<PendingTpSlInfo>();
            let _v17 = *vector::borrow<PendingTpSlKey>(&(&_v5).fixed_sized, _v4);
            let _v18 = *&(&_v17).price_index;
            let (_v19,_v20,_v21,_v22,_v23) = position_tp_sl_tracker::get_pending_tp_sl(p1, _v18, p2, p6);
            let _v24 = *&(&_v17).order_id;
            let _v25 = position_tp_sl_tracker::get_trigger_price(&(&_v17).price_index);
            return option::some<PendingTpSlInfo>(PendingTpSlInfo{order_id: _v24, trigger_price: _v25, account: _v19, limit_price: _v21, size: _v22})
        };
        option::none<PendingTpSlInfo>()
    }
    friend fun get_fixed_sized_tp_sl_for_order_id(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: order_book_types::OrderId, p4: bool): option::Option<PendingTpSlInfo>
        acquires GlobalSummary
    {
        let _v0 = table::borrow<address,AccountSummary>(&borrow_global<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0);
        let _v1 = &_v0.markets;
        let _v2 = &p1;
        let _v3 = big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v1, _v2);
        loop {
            let _v4;
            let _v5;
            if (_v3) {
                let _v6 = &_v0.markets;
                let _v7 = &p1;
                let _v8 = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v6, _v7);
                if (p2) _v4 = *&_v8.tp_reqs else _v4 = *&_v8.sl_reqs;
                let _v9 = &(&_v4).fixed_sized;
                let _v10 = false;
                let _v11 = 0;
                let _v12 = 0;
                let _v13 = vector::length<PendingTpSlKey>(_v9);
                'l0: loop {
                    loop {
                        if (!(_v12 < _v13)) break 'l0;
                        let _v14 = &vector::borrow<PendingTpSlKey>(_v9, _v12).order_id;
                        let _v15 = &p3;
                        if (_v14 == _v15) break;
                        _v12 = _v12 + 1;
                        continue
                    };
                    _v10 = true;
                    _v11 = _v12;
                    break
                };
                _v5 = _v11;
                if (!_v10) break
            } else return option::none<PendingTpSlInfo>();
            let _v16 = *vector::borrow<PendingTpSlKey>(&(&_v4).fixed_sized, _v5);
            let _v17 = *&(&_v16).price_index;
            let (_v18,_v19,_v20,_v21,_v22) = position_tp_sl_tracker::get_pending_tp_sl(p1, _v17, p2, p4);
            let _v23 = *&(&_v16).order_id;
            let _v24 = position_tp_sl_tracker::get_trigger_price(&(&_v16).price_index);
            return option::some<PendingTpSlInfo>(PendingTpSlInfo{order_id: _v23, trigger_price: _v24, account: _v18, limit_price: _v20, size: _v21})
        };
        option::none<PendingTpSlInfo>()
    }
    friend fun get_fixed_sized_tp_sl_orders(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: bool): vector<PendingTpSlInfo>
        acquires GlobalSummary
    {
        let _v0;
        let _v1;
        let _v2 = table::borrow<address,AccountSummary>(&borrow_global<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0);
        let _v3 = &_v2.markets;
        let _v4 = &p1;
        let _v5 = big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v3, _v4);
        'l0: loop {
            if (_v5) {
                let _v6;
                let _v7 = &_v2.markets;
                let _v8 = &p1;
                let _v9 = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v7, _v8);
                if (p2) _v6 = *&_v9.tp_reqs else _v6 = *&_v9.sl_reqs;
                _v1 = vector::empty<PendingTpSlInfo>();
                let _v10 = *&(&_v6).fixed_sized;
                vector::reverse<PendingTpSlKey>(&mut _v10);
                _v0 = _v10;
                let _v11 = vector::length<PendingTpSlKey>(&_v0);
                loop {
                    if (!(_v11 > 0)) break 'l0;
                    let _v12 = vector::pop_back<PendingTpSlKey>(&mut _v0);
                    let _v13 = *&(&_v12).price_index;
                    let (_v14,_v15,_v16,_v17,_v18) = position_tp_sl_tracker::get_pending_tp_sl(p1, _v13, p2, p3);
                    let _v19 = &mut _v1;
                    let _v20 = *&(&_v12).order_id;
                    let _v21 = position_tp_sl_tracker::get_trigger_price(&(&_v12).price_index);
                    let _v22 = PendingTpSlInfo{order_id: _v20, trigger_price: _v21, account: _v14, limit_price: _v16, size: _v17};
                    vector::push_back<PendingTpSlInfo>(_v19, _v22);
                    _v11 = _v11 - 1;
                    continue
                }
            };
            return vector::empty<PendingTpSlInfo>()
        };
        vector::destroy_empty<PendingTpSlKey>(_v0);
        _v1
    }
    friend fun get_full_sized_tp_sl_order(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: bool): option::Option<PendingTpSlInfo>
        acquires GlobalSummary
    {
        let _v0 = table::borrow<address,AccountSummary>(&borrow_global<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0);
        let _v1 = &_v0.markets;
        let _v2 = &p1;
        let _v3 = big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v1, _v2);
        loop {
            let _v4;
            if (_v3) {
                let _v5 = &_v0.markets;
                let _v6 = &p1;
                let _v7 = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v5, _v6);
                if (p2) _v4 = *&_v7.tp_reqs else _v4 = *&_v7.sl_reqs;
                if (!option::is_some<PendingTpSlKey>(&(&_v4).full_sized)) break
            } else return option::none<PendingTpSlInfo>();
            let _v8 = option::destroy_some<PendingTpSlKey>(*&(&_v4).full_sized);
            let _v9 = *&(&_v8).price_index;
            let (_v10,_v11,_v12,_v13,_v14) = position_tp_sl_tracker::get_pending_tp_sl(p1, _v9, p2, p3);
            let _v15 = *&(&_v8).order_id;
            let _v16 = position_tp_sl_tracker::get_trigger_price(&(&_v8).price_index);
            return option::some<PendingTpSlInfo>(PendingTpSlInfo{order_id: _v15, trigger_price: _v16, account: _v10, limit_price: _v12, size: _v13})
        };
        option::none<PendingTpSlInfo>()
    }
    public fun get_pending_market_state(p0: address, p1: object::Object<perp_market::PerpMarket>): option::Option<PendingMarketState>
        acquires GlobalSummary
    {
        let _v0;
        let _v1 = borrow_global<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v2 = table::contains<address,AccountSummary>(&_v1.summary, p0);
        'l0: loop {
            loop {
                if (_v2) {
                    _v0 = table::borrow<address,AccountSummary>(&_v1.summary, p0);
                    let _v3 = &_v0.markets;
                    let _v4 = &p1;
                    if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v3, _v4)) break;
                    break 'l0
                };
                return option::none<PendingMarketState>()
            };
            return option::none<PendingMarketState>()
        };
        let _v5 = &_v0.markets;
        let _v6 = &p1;
        option::some<PendingMarketState>(*big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v5, _v6))
    }
    friend fun get_pending_order_margin(p0: address): u64
        acquires GlobalSummary
    {
        let _v0 = table::borrow<address,AccountSummary>(&borrow_global<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0);
        let _v1 = 0;
        let _v2 = &_v0.markets;
        let _v3 = big_ordered_map::internal_leaf_new_begin_iter<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v2);
        while (!big_ordered_map::internal_leaf_iter_is_end(&_v3)) {
            let (_v4,_v5) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v3, _v2);
            let _v6 = _v4;
            let _v7 = ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PendingMarketState>>(_v6);
            while (!ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PendingMarketState>>(&_v7, _v6)) {
                let _v8 = ordered_map::iter_borrow_key<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PendingMarketState>>(&_v7, _v6);
                let _v9 = *&big_ordered_map::internal_leaf_borrow_value<PendingMarketState>(ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PendingMarketState>>(_v7, _v6)).pending_margin;
                _v1 = _v1 + _v9;
                _v7 = ordered_map::iter_next<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PendingMarketState>>(_v7, _v6);
                continue
            };
            _v3 = _v5;
            continue
        };
        _v1
    }
    friend fun has_any_pending_orders(p0: address): bool
        acquires GlobalSummary
    {
        let _v0 = table::borrow<address,AccountSummary>(&borrow_global<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0);
        let _v1 = big_ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>,PendingMarketState>(&_v0.markets);
        'l0: loop {
            loop {
                let _v2;
                let _v3 = &_v1;
                let _v4 = &_v0.markets;
                if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v3, _v4)) break 'l0;
                let _v5 = &_v0.markets;
                let _v6 = big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v1, _v5);
                if (*&(&_v6.pending_longs).size_sum > 0) _v2 = true else _v2 = *&(&_v6.pending_shorts).size_sum > 0;
                if (_v2) break;
                let _v7 = &_v0.markets;
                _v1 = big_ordered_map::iter_next<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v1, _v7);
                continue
            };
            return true
        };
        false
    }
    friend fun increase_tp_sl_size(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: option::Option<u64>, p4: option::Option<builder_code_registry::BuilderCode>, p5: u64, p6: bool, p7: bool, p8: u64) {
        if (!validate_tp_sl(p1, p7, p2, p6)) {
            let _v0 = error::invalid_argument(7);
            abort _v0
        };
        let _v1 = position_tp_sl_tracker::new_price_index_key(p2, p0, p3, false, p4);
        position_tp_sl_tracker::increase_fixed_sized_pending_tp_sl_size(p1, _v1, p5, p6, p7, p8);
    }
    friend fun initialize_account_summary(p0: address)
        acquires GlobalSummary
    {
        let _v0 = borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        if (!table::contains<address,AccountSummary>(&_v0.summary, p0)) {
            let _v1 = &mut _v0.summary;
            let _v2 = AccountSummary{markets: big_ordered_map::new_with_config<object::Object<perp_market::PerpMarket>,PendingMarketState>(64u16, 32u16, true)};
            table::add<address,AccountSummary>(_v1, p0, _v2);
            return ()
        };
    }
    fun pending_price_size_for_market(p0: u64, p1: bool, p2: &PendingOrders, p3: &PendingOrders): u128 {
        let _v0;
        'l0: loop {
            loop {
                let _v1;
                let _v2;
                let _v3;
                let _v4;
                if (p1) {
                    let _v5 = *&p3.size_sum;
                    let _v6 = 2 * p0;
                    if (_v5 > _v6) {
                        let _v7 = *&p3.size_sum;
                        let _v8 = 2 * p0;
                        _v4 = _v7 - _v8
                    } else _v4 = 0;
                    if (*&p3.size_sum == 0) {
                        _v0 = 0u128;
                        break
                    };
                    _v3 = _v4 as u128;
                    _v2 = *&p3.price_size_sum;
                    _v1 = (*&p3.size_sum) as u128;
                    if (!(_v1 != 0u128)) {
                        let _v9 = error::invalid_argument(4);
                        abort _v9
                    };
                    let _v10 = _v3 as u256;
                    let _v11 = _v2 as u256;
                    let _v12 = _v10 * _v11;
                    let _v13 = _v1 as u256;
                    _v0 = (_v12 / _v13) as u128;
                    break
                };
                let _v14 = *&p2.size_sum;
                let _v15 = 2 * p0;
                if (_v14 > _v15) {
                    let _v16 = *&p2.size_sum;
                    let _v17 = 2 * p0;
                    _v4 = _v16 - _v17
                } else _v4 = 0;
                if (*&p2.size_sum == 0) {
                    _v0 = 0u128;
                    break 'l0
                };
                _v3 = _v4 as u128;
                _v2 = *&p2.price_size_sum;
                _v1 = (*&p2.size_sum) as u128;
                if (!(_v1 != 0u128)) {
                    let _v18 = error::invalid_argument(4);
                    abort _v18
                };
                let _v19 = _v3 as u256;
                let _v20 = _v2 as u256;
                let _v21 = _v19 * _v20;
                let _v22 = _v1 as u256;
                _v0 = (_v21 / _v22) as u128;
                break 'l0
            };
            return math128::max(*&p2.price_size_sum, _v0)
        };
        math128::max(*&p3.price_size_sum, _v0)
    }
    friend fun remove_fixed_sized_tp_sl_for_order(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: order_book_types::OrderId, p3: bool): option::Option<PendingTpSlKey>
        acquires GlobalSummary
    {
        let _v0;
        let _v1 = &mut table::borrow_mut<address,AccountSummary>(&mut borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0).markets;
        let _v2 = &p1;
        let _v3 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PendingMarketState>(freeze(_v1), _v2);
        let _v4 = &_v3;
        let _v5 = freeze(_v1);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v4, _v5)) _v0 = option::none<option::Option<PendingTpSlKey>>() else {
            let _v6 = |arg0| lambda__1__remove_fixed_sized_tp_sl_for_order(p2, p3, arg0);
            _v0 = option::some<option::Option<PendingTpSlKey>>(big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>,PendingMarketState,option::Option<PendingTpSlKey>>(_v3, _v1, _v6))
        };
        if (option::is_some<option::Option<PendingTpSlKey>>(&_v0)) return option::destroy_some<option::Option<PendingTpSlKey>>(_v0);
        option::none<PendingTpSlKey>()
    }
    fun lambda__1__remove_fixed_sized_tp_sl_for_order(p0: order_book_types::OrderId, p1: bool, p2: &mut PendingMarketState): option::Option<PendingTpSlKey> {
        remove_fixed_sized_tp_sl_for_order_internal(p2, p1, p0)
    }
    friend fun remove_full_sized_tp_sl_for_order(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: order_book_types::OrderId, p3: bool): option::Option<PendingTpSlKey>
        acquires GlobalSummary
    {
        let _v0;
        let _v1 = &mut table::borrow_mut<address,AccountSummary>(&mut borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0).markets;
        let _v2 = &p1;
        let _v3 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PendingMarketState>(freeze(_v1), _v2);
        let _v4 = &_v3;
        let _v5 = freeze(_v1);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v4, _v5)) _v0 = option::none<option::Option<PendingTpSlKey>>() else {
            let _v6 = |arg0| lambda__1__remove_full_sized_tp_sl_for_order(p2, p3, arg0);
            _v0 = option::some<option::Option<PendingTpSlKey>>(big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>,PendingMarketState,option::Option<PendingTpSlKey>>(_v3, _v1, _v6))
        };
        if (option::is_some<option::Option<PendingTpSlKey>>(&_v0)) return option::destroy_some<option::Option<PendingTpSlKey>>(_v0);
        option::none<PendingTpSlKey>()
    }
    fun lambda__1__remove_full_sized_tp_sl_for_order(p0: order_book_types::OrderId, p1: bool, p2: &mut PendingMarketState): option::Option<PendingTpSlKey> {
        remove_full_sized_tp_sl_for_order_internal(p2, p1, p0)
    }
    friend fun remove_order_based_tp_sl(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: bool)
        acquires GlobalSummary
    {
        let _v0 = &mut table::borrow_mut<address,AccountSummary>(&mut borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0).markets;
        let _v1 = &p1;
        let _v2 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PendingMarketState>(freeze(_v0), _v1);
        let _v3 = &_v2;
        let _v4 = freeze(_v0);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v3, _v4)) {
            let _v5 = error::invalid_argument(2);
            abort _v5
        };
        let _v6: |&mut PendingMarketState|bool has copy + drop = |arg0| lambda__1__remove_order_based_tp_sl(p2, p3, arg0);
        let _v7 = big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>,PendingMarketState,bool>(_v2, _v0, _v6);
    }
    fun lambda__1__remove_order_based_tp_sl(p0: bool, p1: bool, p2: &mut PendingMarketState): bool {
        let _v0;
        if (p0) {
            if (!(*&(&p2.tp_reqs).pending_order_based_tp_sl_count > 0)) {
                let _v1 = error::invalid_argument(11);
                abort _v1
            };
            _v0 = &mut (&mut p2.tp_reqs).pending_order_based_tp_sl_count;
            *_v0 = *_v0 - 1
        };
        if (p1) {
            if (!(*&(&p2.sl_reqs).pending_order_based_tp_sl_count > 0)) {
                let _v2 = error::invalid_argument(11);
                abort _v2
            };
            _v0 = &mut (&mut p2.sl_reqs).pending_order_based_tp_sl_count;
            *_v0 = *_v0 - 1
        };
        true
    }
    friend fun remove_pending_order(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: order_book_types::OrderId, p3: u64, p4: u64, p5: bool, p6: bool, p7: u64, p8: bool, p9: u8)
        acquires GlobalSummary
    {
        let _v0;
        let _v1;
        let _v2;
        loop {
            if (!p6) {
                let _v3;
                let _v4;
                let _v5;
                _v0 = table::borrow_mut<address,AccountSummary>(&mut borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0);
                let _v6 = &_v0.markets;
                let _v7 = &p1;
                if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v6, _v7)) {
                    let _v8 = error::invalid_argument(2);
                    abort _v8
                };
                let _v9 = &mut _v0.markets;
                let _v10 = &p1;
                _v2 = big_ordered_map::remove<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v9, _v10);
                if (p5) {
                    if (!(*&(&(&_v2).pending_longs).size_sum >= p3)) {
                        let _v11 = error::invalid_argument(3);
                        abort _v11
                    };
                    _v1 = p3;
                    _v5 = &mut (&mut (&mut _v2).pending_longs).size_sum;
                    *_v5 = *_v5 - _v1;
                    if (!(*&(&(&_v2).pending_longs).size_sum == 0)) {
                        let _v12 = p3 as u128;
                        let _v13 = p4 as u128;
                        _v4 = _v12 * _v13;
                        _v3 = &mut (&mut (&mut _v2).pending_longs).price_size_sum;
                        *_v3 = *_v3 - _v4;
                        break
                    };
                    let _v14 = p3 as u128;
                    let _v15 = p4 as u128;
                    let _v16 = _v14 * _v15;
                    let _v17 = *&(&(&_v2).pending_longs).price_size_sum;
                    if (!(_v16 == _v17)) {
                        let _v18 = error::invalid_argument(3);
                        abort _v18
                    };
                    let _v19 = &mut (&mut (&mut _v2).pending_longs).price_size_sum;
                    *_v19 = 0u128;
                    break
                };
                if (!(*&(&(&_v2).pending_shorts).size_sum >= p3)) {
                    let _v20 = error::invalid_argument(3);
                    abort _v20
                };
                _v1 = p3;
                _v5 = &mut (&mut (&mut _v2).pending_shorts).size_sum;
                *_v5 = *_v5 - _v1;
                if (!(*&(&(&_v2).pending_shorts).size_sum == 0)) {
                    let _v21 = p3 as u128;
                    let _v22 = p4 as u128;
                    _v4 = _v21 * _v22;
                    _v3 = &mut (&mut (&mut _v2).pending_shorts).price_size_sum;
                    *_v3 = *_v3 - _v4;
                    break
                };
                let _v23 = p3 as u128;
                let _v24 = p4 as u128;
                let _v25 = _v23 * _v24;
                let _v26 = *&(&(&_v2).pending_shorts).price_size_sum;
                if (!(_v25 == _v26)) {
                    let _v27 = error::invalid_argument(3);
                    abort _v27
                };
                let _v28 = &mut (&mut (&mut _v2).pending_shorts).price_size_sum;
                *_v28 = 0u128;
                break
            };
            remove_reduce_only_order(p0, p1, p2, p3);
            return ()
        };
        _v1 = perp_market_config::get_size_multiplier(p1);
        update_required_margin_for_market(&mut _v2, p7, p8, p9, _v1);
        big_ordered_map::add<object::Object<perp_market::PerpMarket>,PendingMarketState>(&mut _v0.markets, p1, _v2);
    }
    fun remove_reduce_only_order(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: order_book_types::OrderId, p3: u64)
        acquires GlobalSummary
    {
        let _v0;
        let _v1 = &mut table::borrow_mut<address,AccountSummary>(&mut borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0).markets;
        let _v2 = &p1;
        let _v3 = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>,PendingMarketState>(freeze(_v1), _v2);
        let _v4 = &_v3;
        let _v5 = freeze(_v1);
        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v4, _v5)) _v0 = option::none<bool>() else {
            let _v6 = |arg0| lambda__1__remove_reduce_only_order(p2, p3, arg0);
            _v0 = option::some<bool>(big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>,PendingMarketState,bool>(_v3, _v1, _v6))
        };
        let _v7 = option::is_some<bool>(&_v0);
    }
    fun lambda__1__remove_reduce_only_order(p0: order_book_types::OrderId, p1: u64, p2: &mut PendingMarketState): bool {
        let _v0 = &mut p2.reduce_only_orders;
        let _v1 = 0;
        'l1: loop {
            let _v2;
            'l0: loop {
                loop {
                    let _v3 = vector::length<ReduceOnlyOrderInfo>(&_v0.orders);
                    if (!(_v1 < _v3)) break;
                    let _v4 = &vector::borrow<ReduceOnlyOrderInfo>(&_v0.orders, _v1).order_id;
                    let _v5 = &p0;
                    if (_v4 == _v5) break 'l0;
                    _v1 = _v1 + 1;
                    continue
                };
                break 'l1
            };
            let _v6 = *&_v0.total_size;
            let _v7 = p1;
            if (_v6 >= _v7) _v2 = _v6 - _v7 else _v2 = 0;
            let _v8 = &mut _v0.total_size;
            *_v8 = _v2;
            let _v9 = *&vector::borrow<ReduceOnlyOrderInfo>(&_v0.orders, _v1).size;
            if (p1 < _v9) {
                _v8 = &mut vector::borrow_mut<ReduceOnlyOrderInfo>(&mut _v0.orders, _v1).size;
                *_v8 = *_v8 - p1;
                break
            };
            let _v10 = *&vector::borrow<ReduceOnlyOrderInfo>(&_v0.orders, _v1).size;
            if (!(p1 == _v10)) {
                let _v11 = error::invalid_argument(3);
                abort _v11
            };
            let _v12 = vector::remove<ReduceOnlyOrderInfo>(&mut _v0.orders, _v1);
            break
        };
        true
    }
    friend fun update_position(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: bool, p4: u8)
        acquires GlobalSummary
    {
        let _v0 = borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v1 = table::remove<address,AccountSummary>(&mut _v0.summary, p0);
        let _v2 = &(&_v1).markets;
        let _v3 = &p1;
        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v2, _v3)) {
            table::add<address,AccountSummary>(&mut _v0.summary, p0, _v1);
            return ()
        };
        let _v4 = &mut (&mut _v1).markets;
        let _v5 = &p1;
        let _v6 = big_ordered_map::remove<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v4, _v5);
        let _v7 = perp_market_config::get_size_multiplier(p1);
        update_required_margin_for_market(&mut _v6, p2, p3, p4, _v7);
        big_ordered_map::add<object::Object<perp_market::PerpMarket>,PendingMarketState>(&mut (&mut _v1).markets, p1, _v6);
        table::add<address,AccountSummary>(&mut _v0.summary, p0, _v1);
    }
    friend fun validate_non_reduce_only_order_placement(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: u64, p4: bool, p5: u64, p6: bool, p7: u8, p8: u64): bool
        acquires GlobalSummary
    {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4;
        let _v5 = borrow_global_mut<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v6 = table::remove<address,AccountSummary>(&mut _v5.summary, p0);
        let _v7 = &(&_v6).markets;
        let _v8 = &p1;
        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v7, _v8)) {
            let _v9 = &mut (&mut _v6).markets;
            let _v10 = PendingOrders{price_size_sum: 0u128, size_sum: 0};
            let _v11 = PendingOrders{price_size_sum: 0u128, size_sum: 0};
            let _v12 = vector::empty<ReduceOnlyOrderInfo>();
            let _v13 = ReduceOnlyOrders{total_size: 0, orders: _v12};
            let _v14 = option::none<PendingTpSlKey>();
            let _v15 = vector::empty<PendingTpSlKey>();
            let _v16 = PendingTpSLs{full_sized: _v14, fixed_sized: _v15, pending_order_based_tp_sl_count: 0};
            let _v17 = option::none<PendingTpSlKey>();
            let _v18 = vector::empty<PendingTpSlKey>();
            let _v19 = PendingTpSLs{full_sized: _v17, fixed_sized: _v18, pending_order_based_tp_sl_count: 0};
            let _v20 = PendingMarketState::V1{pending_margin: 0, pending_longs: _v10, pending_shorts: _v11, reduce_only_orders: _v13, tp_reqs: _v16, sl_reqs: _v19};
            big_ordered_map::add<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v9, p1, _v20)
        };
        _v7 = &(&_v6).markets;
        _v8 = &p1;
        let _v21 = option::destroy_some<PendingMarketState>(big_ordered_map::get<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v7, _v8));
        let _v22 = *&(&_v21).pending_longs;
        let _v23 = *&(&_v21).pending_shorts;
        if (p4) {
            let _v24 = p2 as u128;
            let _v25 = p3 as u128;
            _v4 = _v24 * _v25;
            _v3 = &mut (&mut _v22).price_size_sum;
            *_v3 = *_v3 + _v4;
            _v2 = p2;
            _v1 = &mut (&mut _v22).size_sum;
            *_v1 = *_v1 + _v2
        } else {
            let _v26 = p2 as u128;
            let _v27 = p3 as u128;
            _v4 = _v26 * _v27;
            _v3 = &mut (&mut _v23).price_size_sum;
            *_v3 = *_v3 + _v4;
            _v1 = &mut (&mut _v23).size_sum;
            *_v1 = *_v1 + p2
        };
        let _v28 = &_v22;
        let _v29 = &_v23;
        _v4 = pending_price_size_for_market(p5, p6, _v28, _v29);
        let _v30 = perp_market_config::get_size_multiplier(p1) as u128;
        let _v31 = p7 as u128;
        let _v32 = _v30 * _v31;
        if (_v4 == 0u128) if (_v32 != 0u128) _v0 = 0u128 else {
            let _v33 = error::invalid_argument(4);
            abort _v33
        } else _v0 = (_v4 - 1u128) / _v32 + 1u128;
        _v2 = _v0 as u64;
        let _v34 = 0;
        _v7 = &(&_v6).markets;
        let _v35 = big_ordered_map::internal_leaf_new_begin_iter<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v7);
        while (!big_ordered_map::internal_leaf_iter_is_end(&_v35)) {
            let (_v36,_v37) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v35, _v7);
            let _v38 = _v36;
            let _v39 = ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PendingMarketState>>(_v38);
            loop {
                let _v40;
                if (ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PendingMarketState>>(&_v39, _v38)) break;
                let _v41 = ordered_map::iter_borrow_key<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PendingMarketState>>(&_v39, _v38);
                let _v42 = big_ordered_map::internal_leaf_borrow_value<PendingMarketState>(ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PendingMarketState>>(_v39, _v38));
                let _v43 = &p1;
                if (_v41 == _v43) {
                    _v40 = _v2;
                    _v34 = _v34 + _v40
                } else {
                    _v40 = *&_v42.pending_margin;
                    _v34 = _v34 + _v40
                };
                _v39 = ordered_map::iter_next<object::Object<perp_market::PerpMarket>,big_ordered_map::Child<PendingMarketState>>(_v39, _v38);
                continue
            };
            _v35 = _v37;
            continue
        };
        table::add<address,AccountSummary>(&mut _v5.summary, p0, _v6);
        _v34 <= p8
    }
    friend fun validate_order_based_tp_sl(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: bool): bool
        acquires GlobalSummary
    {
        let _v0 = table::borrow<address,AccountSummary>(&borrow_global<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0);
        let _v1 = &_v0.markets;
        let _v2 = &p1;
        let _v3 = big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v1, _v2);
        'l0: loop {
            'l1: loop {
                loop {
                    if (_v3) {
                        let _v4;
                        let _v5 = &_v0.markets;
                        let _v6 = &p1;
                        let _v7 = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v5, _v6);
                        if (p2) {
                            let _v8 = *&(&_v7.tp_reqs).pending_order_based_tp_sl_count;
                            let _v9 = vector::length<PendingTpSlKey>(&(&_v7.tp_reqs).fixed_sized);
                            p2 = _v8 + _v9 >= 5
                        } else p2 = false;
                        if (p2) break;
                        if (p3) {
                            let _v10 = *&(&_v7.sl_reqs).pending_order_based_tp_sl_count;
                            let _v11 = vector::length<PendingTpSlKey>(&(&_v7.sl_reqs).fixed_sized);
                            _v4 = _v10 + _v11 >= 5
                        } else _v4 = false;
                        if (!_v4) break 'l0;
                        break 'l1
                    };
                    return true
                };
                return false
            };
            return false
        };
        true
    }
    friend fun validate_reduce_only_order(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: u64, p4: bool): option::Option<string::String>
        acquires GlobalSummary
    {
        'l1: loop {
            'l2: loop {
                'l0: loop {
                    loop {
                        if (!(p3 == 0)) {
                            if (p2 == p4) break;
                            let _v0 = table::borrow<address,AccountSummary>(&borrow_global<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).summary, p0);
                            let _v1 = &_v0.markets;
                            let _v2 = &p1;
                            if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v1, _v2)) break 'l0;
                            let _v3 = &_v0.markets;
                            let _v4 = &p1;
                            if (!(vector::length<ReduceOnlyOrderInfo>(&(&big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v3, _v4).reduce_only_orders).orders) == 10)) break 'l1;
                            break 'l2
                        };
                        return option::some<string::String>(string::utf8(vector[67u8, 97u8, 110u8, 110u8, 111u8, 116u8, 32u8, 112u8, 108u8, 97u8, 99u8, 101u8, 32u8, 114u8, 101u8, 100u8, 117u8, 99u8, 101u8, 32u8, 111u8, 110u8, 108u8, 121u8, 32u8, 111u8, 114u8, 100u8, 101u8, 114u8, 32u8, 119u8, 105u8, 116u8, 104u8, 32u8, 110u8, 111u8, 32u8, 112u8, 111u8, 115u8, 105u8, 116u8, 105u8, 111u8, 110u8]))
                    };
                    return option::some<string::String>(string::utf8(vector[82u8, 101u8, 100u8, 117u8, 99u8, 101u8, 32u8, 111u8, 110u8, 108u8, 121u8, 32u8, 111u8, 114u8, 100u8, 101u8, 114u8, 32u8, 100u8, 105u8, 114u8, 101u8, 99u8, 116u8, 105u8, 111u8, 110u8, 32u8, 109u8, 117u8, 115u8, 116u8, 32u8, 98u8, 101u8, 32u8, 111u8, 112u8, 112u8, 111u8, 115u8, 105u8, 116u8, 101u8, 32u8, 116u8, 111u8, 32u8, 112u8, 111u8, 115u8, 105u8, 116u8, 105u8, 111u8, 110u8, 32u8, 100u8, 105u8, 114u8, 101u8, 99u8, 116u8, 105u8, 111u8, 110u8]))
                };
                return option::none<string::String>()
            };
            return option::some<string::String>(string::utf8(vector[77u8, 97u8, 120u8, 105u8, 109u8, 117u8, 109u8, 32u8, 97u8, 108u8, 108u8, 111u8, 119u8, 101u8, 100u8, 32u8, 110u8, 117u8, 109u8, 98u8, 101u8, 114u8, 32u8, 111u8, 102u8, 32u8, 114u8, 101u8, 100u8, 117u8, 99u8, 101u8, 32u8, 111u8, 110u8, 108u8, 121u8, 32u8, 111u8, 114u8, 100u8, 101u8, 114u8, 115u8, 32u8, 101u8, 120u8, 99u8, 101u8, 101u8, 100u8, 101u8, 100u8, 32u8, 102u8, 111u8, 114u8, 32u8, 109u8, 97u8, 114u8, 107u8, 101u8, 116u8]))
        };
        option::none<string::String>()
    }
    public fun view_account_summary(p0: address): AccountSummaryView
        acquires GlobalSummary
    {
        let _v0 = vector::empty<PendingMarketStateView>();
        let _v1 = exists<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        'l0: loop {
            loop {
                if (_v1) {
                    let _v2 = borrow_global<GlobalSummary>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
                    if (!table::contains<address,AccountSummary>(&_v2.summary, p0)) break;
                    let _v3 = table::borrow<address,AccountSummary>(&_v2.summary, p0);
                    let _v4 = big_ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>,PendingMarketState>(&_v3.markets);
                    loop {
                        let _v5 = &_v4;
                        let _v6 = &_v3.markets;
                        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v5, _v6)) break 'l0;
                        let _v7 = *big_ordered_map::iter_borrow_key<object::Object<perp_market::PerpMarket>>(&_v4);
                        let _v8 = &_v3.markets;
                        let _v9 = *big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v4, _v8);
                        let _v10 = perp_market_config::get_name(_v7);
                        let _v11 = &mut _v0;
                        let _v12 = PendingMarketStateView{market: _v7, name: _v10, state: _v9};
                        vector::push_back<PendingMarketStateView>(_v11, _v12);
                        let _v13 = &_v3.markets;
                        _v4 = big_ordered_map::iter_next<object::Object<perp_market::PerpMarket>,PendingMarketState>(_v4, _v13);
                        continue
                    }
                };
                return AccountSummaryView{markets: _v0}
            };
            return AccountSummaryView{markets: _v0}
        };
        AccountSummaryView{markets: _v0}
    }
}
