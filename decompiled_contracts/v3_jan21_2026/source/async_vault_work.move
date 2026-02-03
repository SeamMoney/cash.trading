module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_vault_work {
    use 0x1::big_ordered_map;
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::vault;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book_types;
    use 0x1::vector;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_view_types;
    use 0x1::option;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::decibel_time;
    use 0x1::transaction_context;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::vault_api;
    enum AsyncVaultWork has key {
        V1 {
            allow_sync_redemptions: bool,
            total_pending_redemptions: u64,
            pending_redemptions: big_ordered_map::BigOrderedMap<u128, RedemptionRequest>,
            orders_state: ClosingPositionsState,
        }
    }
    struct RedemptionRequest has copy, drop, store {
        user: address,
        shares: u64,
        deposit_to_dex: bool,
    }
    enum ClosingPositionsState has copy, drop, store {
        ProcessRedemptions,
        PlacingOrdersToClosePositions {
            remaining_subaccounts_to_close: vector<address>,
            cur_subaccount: address,
            cur_markets_to_close: vector<object::Object<perp_market::PerpMarket>>,
            active_orders: vector<vault::OrderRef>,
        }
        WaitingForOrdersToFill {
            time_orders_placed: u64,
            active_orders: vector<vault::OrderRef>,
        }
    }
    fun cancel_all_active_orders(p0: object::Object<vault::Vault>, p1: &mut vector<vault::OrderRef>, p2: &mut u32) {
        loop {
            let _v0;
            if (vector::length<vault::OrderRef>(freeze(p1)) > 0) _v0 = *p2 > 0u32 else _v0 = false;
            if (!_v0) break;
            let _v1 = vector::pop_back<vault::OrderRef>(p1);
            let _v2 = vault::get_order_ref_market(&_v1);
            let _v3 = vault::get_order_ref_order_id(&_v1);
            vault::cancel_force_closing_order(p0, _v2, _v3);
            let _v4 = p2;
            *_v4 = *_v4 - 1u32;
            continue
        };
    }
    fun clean_completed_orders(p0: &mut vector<vault::OrderRef>, p1: &mut u32) {
        *p1 = *p1 - 1u32;
        let _v0 = 0;
        loop {
            let _v1 = vector::length<vault::OrderRef>(freeze(p0));
            if (!(_v0 < _v1)) break;
            let _v2 = vector::borrow<vault::OrderRef>(freeze(p0), _v0);
            let _v3 = vault::get_order_ref_market(_v2);
            let _v4 = vault::get_order_ref_order_id(_v2);
            if (perp_market::get_remaining_size(_v3, _v4) > 0) {
                _v0 = _v0 + 1;
                continue
            };
            let _v5 = vector::swap_remove<vault::OrderRef>(p0, _v0);
            continue
        };
    }
    fun prepare_closing_positions(p0: object::Object<vault::Vault>): ClosingPositionsState {
        let _v0 = vault::get_vault_portfolio_subaccounts(p0);
        let _v1 = vector::pop_back<address>(&mut _v0);
        let _v2 = perp_engine::list_positions(_v1);
        let _v3 = vector::empty<object::Object<perp_market::PerpMarket>>();
        let _v4 = _v2;
        vector::reverse<position_view_types::PositionViewInfo>(&mut _v4);
        let _v5 = _v4;
        let _v6 = vector::length<position_view_types::PositionViewInfo>(&_v5);
        while (_v6 > 0) {
            let _v7 = vector::pop_back<position_view_types::PositionViewInfo>(&mut _v5);
            let _v8 = &mut _v3;
            let _v9 = position_view_types::get_position_info_market(&_v7);
            vector::push_back<object::Object<perp_market::PerpMarket>>(_v8, _v9);
            _v6 = _v6 - 1;
            continue
        };
        vector::destroy_empty<position_view_types::PositionViewInfo>(_v5);
        let _v10 = vector::empty<vault::OrderRef>();
        ClosingPositionsState::PlacingOrdersToClosePositions{remaining_subaccounts_to_close: _v0, cur_subaccount: _v1, cur_markets_to_close: _v3, active_orders: _v10}
    }
    fun process_closing_positions(p0: object::Object<vault::Vault>, p1: vector<address>, p2: address, p3: vector<object::Object<perp_market::PerpMarket>>, p4: vector<vault::OrderRef>, p5: &mut u32): ClosingPositionsState {
        'l0: loop {
            loop {
                if (!(*p5 > 0u32)) break 'l0;
                let _v0 = p5;
                *_v0 = *_v0 - 1u32;
                if (!vector::is_empty<object::Object<perp_market::PerpMarket>>(&p3)) {
                    let _v1 = vector::pop_back<object::Object<perp_market::PerpMarket>>(&mut p3);
                    let _v2 = vault::place_force_closing_order(p0, p2, _v1);
                    if (option::is_some<vault::OrderRef>(&_v2)) {
                        let _v3 = &mut p4;
                        let _v4 = option::destroy_some<vault::OrderRef>(_v2);
                        vector::push_back<vault::OrderRef>(_v3, _v4)
                    }
                };
                if (!vector::is_empty<object::Object<perp_market::PerpMarket>>(&p3)) continue;
                if (vector::is_empty<address>(&p1)) break;
                let _v5 = perp_engine::list_positions(vector::pop_back<address>(&mut p1));
                vector::reverse<position_view_types::PositionViewInfo>(&mut _v5);
                let _v6 = _v5;
                let _v7 = vector::length<position_view_types::PositionViewInfo>(&_v6);
                while (_v7 > 0) {
                    let _v8 = vector::pop_back<position_view_types::PositionViewInfo>(&mut _v6);
                    let _v9 = &mut p3;
                    let _v10 = position_view_types::get_position_info_market(&_v8);
                    vector::push_back<object::Object<perp_market::PerpMarket>>(_v9, _v10);
                    _v7 = _v7 - 1;
                    continue
                };
                vector::destroy_empty<position_view_types::PositionViewInfo>(_v6);
                continue
            };
            return ClosingPositionsState::WaitingForOrdersToFill{time_orders_placed: decibel_time::now_seconds(), active_orders: p4}
        };
        ClosingPositionsState::PlacingOrdersToClosePositions{remaining_subaccounts_to_close: p1, cur_subaccount: p2, cur_markets_to_close: p3, active_orders: p4}
    }
    public fun process_pending_work(p0: object::Object<vault::Vault>, p1: &mut u32): option::Option<u64>
        acquires AsyncVaultWork
    {
        let _v0 = object::object_address<vault::Vault>(&p0);
        let _v1 = borrow_global_mut<AsyncVaultWork>(_v0);
        let _v2 = *&_v1.orders_state;
        let _v3 = &_v2;
        'l4: loop {
            'l2: loop {
                'l3: loop {
                    'l0: loop {
                        'l1: loop {
                            loop {
                                if (_v3 is ProcessRedemptions) {
                                    let ClosingPositionsState::ProcessRedemptions{} = _v2;
                                    try_complete_redemptions(p0, _v1, p1);
                                    if (*p1 == 0u32) break;
                                    if (!(*&_v1.total_pending_redemptions > 0)) break 'l0;
                                    break 'l1
                                };
                                if (_v3 is PlacingOrdersToClosePositions) {
                                    let ClosingPositionsState::PlacingOrdersToClosePositions{remaining_subaccounts_to_close: _v4, cur_subaccount: _v5, cur_markets_to_close: _v6, active_orders: _v7} = _v2;
                                    let _v8 = process_closing_positions(p0, _v4, _v5, _v6, _v7, p1);
                                    let _v9 = &mut _v1.orders_state;
                                    *_v9 = _v8;
                                    if (!(&_v1.orders_state is WaitingForOrdersToFill)) break 'l2;
                                    break 'l3
                                };
                                assert!(_v3 is WaitingForOrdersToFill, 14566554180833181697);
                                let ClosingPositionsState::WaitingForOrdersToFill{time_orders_placed: _v10, active_orders: _v11} = _v2;
                                let _v12 = _v11;
                                let _v13 = _v10;
                                clean_completed_orders(&mut _v12, p1);
                                if (vector::length<vault::OrderRef>(&_v12) == 0) {
                                    let _v14 = ClosingPositionsState::ProcessRedemptions{};
                                    let _v15 = &mut _v1.orders_state;
                                    *_v15 = _v14;
                                    break 'l4
                                };
                                if (!(decibel_time::now_seconds() - _v13 > 30)) break 'l4;
                                let _v16 = &mut _v12;
                                cancel_all_active_orders(p0, _v16, p1);
                                if (vector::length<vault::OrderRef>(&_v12) > 0) {
                                    let _v17 = ClosingPositionsState::WaitingForOrdersToFill{time_orders_placed: _v13, active_orders: _v12};
                                    let _v18 = &mut _v1.orders_state;
                                    *_v18 = _v17;
                                    break 'l4
                                };
                                let _v19 = ClosingPositionsState::ProcessRedemptions{};
                                let _v20 = &mut _v1.orders_state;
                                *_v20 = _v19;
                                break 'l4
                            };
                            return option::some<u64>(0)
                        };
                        let _v21 = prepare_closing_positions(p0);
                        let _v22 = &mut _v1.orders_state;
                        *_v22 = _v21;
                        return option::some<u64>(0)
                    };
                    return option::none<u64>()
                };
                return option::some<u64>(1000000)
            };
            return option::some<u64>(0)
        };
        option::some<u64>(0)
    }
    fun try_complete_redemptions(p0: object::Object<vault::Vault>, p1: &mut AsyncVaultWork, p2: &mut u32) {
        'l0: loop {
            loop {
                let _v0;
                if (*&p1.total_pending_redemptions > 0) _v0 = *p2 > 0u32 else _v0 = false;
                if (!_v0) break 'l0;
                let (_v1,_v2) = big_ordered_map::borrow_front<u128,RedemptionRequest>(&p1.pending_redemptions);
                let _v3 = _v2;
                let _v4 = p2;
                *_v4 = *_v4 - 1u32;
                let _v5 = *&_v3.user;
                let _v6 = *&_v3.shares;
                let _v7 = *&_v3.deposit_to_dex;
                if (!vault::try_complete_redemption(_v5, p0, _v6, _v7, true)) break;
                let _v8 = *&_v3.shares;
                let _v9 = &mut p1.total_pending_redemptions;
                *_v9 = *_v9 - _v8;
                let (_v10,_v11) = big_ordered_map::pop_front<u128,RedemptionRequest>(&mut p1.pending_redemptions);
                continue
            };
            return ()
        };
    }
    fun queue_redemption(p0: address, p1: object::Object<vault::Vault>, p2: u64, p3: bool)
        acquires AsyncVaultWork
    {
        let _v0 = object::object_address<vault::Vault>(&p1);
        let _v1 = borrow_global_mut<AsyncVaultWork>(_v0);
        let _v2 = &mut _v1.total_pending_redemptions;
        *_v2 = *_v2 + p2;
        let _v3 = &mut _v1.pending_redemptions;
        let _v4 = transaction_context::monotonically_increasing_counter();
        let _v5 = RedemptionRequest{user: p0, shares: p2, deposit_to_dex: p3};
        big_ordered_map::add<u128,RedemptionRequest>(_v3, _v4, _v5);
    }
    friend fun register_vault(p0: &signer) {
        let _v0 = big_ordered_map::new<u128,RedemptionRequest>();
        let _v1 = ClosingPositionsState::ProcessRedemptions{};
        let _v2 = AsyncVaultWork::V1{allow_sync_redemptions: true, total_pending_redemptions: 0, pending_redemptions: _v0, orders_state: _v1};
        move_to<AsyncVaultWork>(p0, _v2);
    }
    friend fun request_redemption(p0: address, p1: object::Object<vault::Vault>, p2: u64, p3: bool): bool
        acquires AsyncVaultWork
    {
        let _v0;
        vault::lock_for_initated_redemption(p0, p1, p2);
        if (sync_redemption_allowed(p1)) _v0 = vault::try_complete_redemption(p0, p1, p2, p3, false) else _v0 = false;
        if (_v0) return true;
        queue_redemption(p0, p1, p2, p3);
        false
    }
    friend fun sync_redemption_allowed(p0: object::Object<vault::Vault>): bool
        acquires AsyncVaultWork
    {
        let _v0 = object::object_address<vault::Vault>(&p0);
        let _v1 = borrow_global<AsyncVaultWork>(_v0);
        if (*&_v1.allow_sync_redemptions) return *&_v1.total_pending_redemptions == 0;
        false
    }
}
