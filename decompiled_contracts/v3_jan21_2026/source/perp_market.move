module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market {
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::market_types;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine_types;
    use 0x1::object;
    use 0x1::option;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book_types;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_operations;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::market_bulk_order;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::single_order_types;
    use 0x1::string;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_order;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::work_unit_utils;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_placement;
    use 0x1::signer;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::order_placement_utils;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_matching_engine;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    enum PerpMarket has key {
        V1 {
            market: market_types::Market<perp_engine_types::OrderMetadata>,
        }
    }
    public fun best_ask_price(p0: object::Object<PerpMarket>): option::Option<u64>
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        market_types::best_ask_price<perp_engine_types::OrderMetadata>(&borrow_global<PerpMarket>(_v1).market)
    }
    public fun best_bid_price(p0: object::Object<PerpMarket>): option::Option<u64>
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        market_types::best_bid_price<perp_engine_types::OrderMetadata>(&borrow_global<PerpMarket>(_v1).market)
    }
    friend fun decrease_order_size(p0: object::Object<PerpMarket>, p1: address, p2: order_book_types::OrderId, p3: u64, p4: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>)
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        order_operations::decrease_order_size<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(&mut borrow_global_mut<PerpMarket>(_v1).market, p1, p2, p3, p4);
    }
    friend fun get_slippage_price(p0: object::Object<PerpMarket>, p1: bool, p2: u64): option::Option<u64>
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        order_book::get_slippage_price<perp_engine_types::OrderMetadata>(market_types::get_order_book<perp_engine_types::OrderMetadata>(&borrow_global<PerpMarket>(_v1).market), p1, p2)
    }
    friend fun is_taker_order(p0: object::Object<PerpMarket>, p1: u64, p2: bool, p3: option::Option<order_book_types::TriggerCondition>): bool
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        market_types::is_taker_order<perp_engine_types::OrderMetadata>(freeze(&mut borrow_global_mut<PerpMarket>(_v1).market), p1, p2, p3)
    }
    friend fun cancel_bulk_order(p0: object::Object<PerpMarket>, p1: &signer, p2: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>)
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        let _v2 = &mut borrow_global_mut<PerpMarket>(_v1).market;
        let _v3 = market_types::order_cancellation_reason_cancelled_by_user();
        market_bulk_order::cancel_bulk_order<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(_v2, p1, _v3, p2);
    }
    public fun get_remaining_size(p0: object::Object<PerpMarket>, p1: order_book_types::OrderId): u64
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        order_book::get_single_remaining_size<perp_engine_types::OrderMetadata>(market_types::get_order_book<perp_engine_types::OrderMetadata>(&borrow_global<PerpMarket>(_v1).market), p1)
    }
    friend fun place_bulk_order(p0: object::Object<PerpMarket>, p1: address, p2: u64, p3: vector<u64>, p4: vector<u64>, p5: vector<u64>, p6: vector<u64>, p7: perp_engine_types::OrderMetadata, p8: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>): order_book_types::OrderId
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        market_bulk_order::place_bulk_order<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(&mut borrow_global_mut<PerpMarket>(_v1).market, p1, p2, p3, p4, p5, p6, p7, p8)
    }
    friend fun take_ready_price_based_orders(p0: object::Object<PerpMarket>, p1: u64, p2: u32): vector<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        let _v2 = &mut borrow_global_mut<PerpMarket>(_v1).market;
        let _v3 = p2 as u64;
        market_types::take_ready_price_based_orders<perp_engine_types::OrderMetadata>(_v2, p1, _v3)
    }
    friend fun take_ready_time_based_orders(p0: object::Object<PerpMarket>, p1: u32): vector<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        let _v2 = &mut borrow_global_mut<PerpMarket>(_v1).market;
        let _v3 = p1 as u64;
        market_types::take_ready_time_based_orders<perp_engine_types::OrderMetadata>(_v2, _v3)
    }
    friend fun cancel_order(p0: object::Object<PerpMarket>, p1: address, p2: order_book_types::OrderId, p3: bool, p4: market_types::OrderCancellationReason, p5: string::String, p6: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>): single_order_types::SingleOrder<perp_engine_types::OrderMetadata>
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        order_operations::cancel_order<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(&mut borrow_global_mut<PerpMarket>(_v1).market, p1, p2, p3, p4, p5, p6)
    }
    friend fun try_cancel_order(p0: object::Object<PerpMarket>, p1: address, p2: order_book_types::OrderId, p3: bool, p4: market_types::OrderCancellationReason, p5: string::String, p6: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>): option::Option<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        order_operations::try_cancel_order<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(&mut borrow_global_mut<PerpMarket>(_v1).market, p1, p2, p3, p4, p5, p6)
    }
    friend fun emit_event_for_order(p0: object::Object<PerpMarket>, p1: &perp_order::PerpOrderRequestExtendedArgs, p2: u64, p3: u64, p4: bool, p5: market_types::OrderStatus, p6: string::String, p7: perp_engine_types::OrderMetadata, p8: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>)
        acquires PerpMarket
    {
        let (_v0,_v1,_v2,_v3) = perp_order::extended_as_inner(p1);
        let (_v4,_v5,_v6,_v7,_v8) = perp_order::common_as_inner(_v1);
        let _v9 = p0;
        let _v10 = object::object_address<PerpMarket>(&_v9);
        let _v11 = &borrow_global<PerpMarket>(_v10).market;
        let _v12 = option::none<market_types::OrderCancellationReason>();
        market_types::emit_event_for_order<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(_v11, _v2, _v8, _v0, _v5, p2, p3, _v4, _v6, p4, p5, p6, p7, _v3, _v7, _v12, p8);
    }
    friend fun place_order_with_order_id(p0: object::Object<PerpMarket>, p1: perp_order::PerpOrderRequestExtendedArgs, p2: u64, p3: perp_engine_types::OrderMetadata, p4: &work_unit_utils::WorkUnit, p5: bool, p6: bool, p7: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>): order_placement::OrderMatchResult<perp_engine_types::OrderMatchingActions>
        acquires PerpMarket
    {
        let (_v0,_v1,_v2,_v3) = perp_order::extended_into_inner(p1);
        let (_v4,_v5,_v6,_v7,_v8) = perp_order::common_into_inner(_v1);
        let _v9 = p0;
        let _v10 = object::object_address<PerpMarket>(&_v9);
        let _v11 = &mut borrow_global_mut<PerpMarket>(_v10).market;
        let _v12 = option::some<order_book_types::OrderId>(_v2);
        let _v13 = work_unit_utils::get_max_match_limit(p4);
        order_placement::place_order_with_order_id<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(_v11, _v0, _v4, _v5, p2, _v6, _v7, _v3, p3, _v12, _v8, _v13, p5, p6, p7)
    }
    friend fun cancel_client_order(p0: object::Object<PerpMarket>, p1: &signer, p2: string::String, p3: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>)
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        let _v2 = &mut borrow_global_mut<PerpMarket>(_v1).market;
        let _v3 = signer::address_of(p1);
        let _v4 = market_types::order_cancellation_reason_cancelled_by_user();
        let _v5 = string::utf8(vector[]);
        order_operations::cancel_order_with_client_id<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(_v2, _v3, p2, _v4, _v5, p3);
    }
    public fun get_best_bid_and_ask_price(p0: object::Object<PerpMarket>): (option::Option<u64>, option::Option<u64>)
        acquires PerpMarket
    {
        let _v0 = best_bid_price(p0);
        let _v1 = best_ask_price(p0);
        (_v0, _v1)
    }
    friend fun register_market(p0: &signer, p1: market_types::Market<perp_engine_types::OrderMetadata>) {
        let _v0 = PerpMarket::V1{market: p1};
        move_to<PerpMarket>(p0, _v0);
    }
}
