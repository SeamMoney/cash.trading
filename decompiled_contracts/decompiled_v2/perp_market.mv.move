module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market {
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::market_types;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine_types;
    use 0x1::object;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_book_types;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_book;
    use 0x1::option;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_operations;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::single_order_types;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::market_bulk_order;
    use 0x1::string;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_placement;
    use 0x1::signer;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::order_placement_utils;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::async_matching_engine;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine;
    enum PerpMarket has key {
        V1 {
            market: market_types::Market<perp_engine_types::OrderMetadata>,
        }
    }
    public fun get_remaining_size(p0: object::Object<PerpMarket>, p1: order_book_types::OrderIdType): u64
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        order_book::get_remaining_size<perp_engine_types::OrderMetadata>(market_types::get_order_book<perp_engine_types::OrderMetadata>(&borrow_global<PerpMarket>(_v1).market), p1)
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
    friend fun decrease_order_size(p0: object::Object<PerpMarket>, p1: address, p2: order_book_types::OrderIdType, p3: u64, p4: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>)
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
    friend fun take_ready_price_based_orders(p0: object::Object<PerpMarket>, p1: u64, p2: u64): vector<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        market_types::take_ready_price_based_orders<perp_engine_types::OrderMetadata>(&mut borrow_global_mut<PerpMarket>(_v1).market, p1, p2)
    }
    friend fun cancel_order(p0: object::Object<PerpMarket>, p1: address, p2: order_book_types::OrderIdType, p3: bool, p4: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>): single_order_types::SingleOrder<perp_engine_types::OrderMetadata>
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        order_operations::cancel_order<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(&mut borrow_global_mut<PerpMarket>(_v1).market, p1, p2, p3, p4)
    }
    friend fun take_ready_time_based_orders(p0: object::Object<PerpMarket>, p1: u64): vector<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        market_types::take_ready_time_based_orders<perp_engine_types::OrderMetadata>(&mut borrow_global_mut<PerpMarket>(_v1).market, p1)
    }
    friend fun try_cancel_order(p0: object::Object<PerpMarket>, p1: address, p2: order_book_types::OrderIdType, p3: bool, p4: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>): option::Option<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        order_operations::try_cancel_order<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(&mut borrow_global_mut<PerpMarket>(_v1).market, p1, p2, p3, p4)
    }
    friend fun cancel_bulk_order(p0: object::Object<PerpMarket>, p1: &signer, p2: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>)
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        market_bulk_order::cancel_bulk_order<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(&mut borrow_global_mut<PerpMarket>(_v1).market, p1, p2);
    }
    friend fun place_bulk_order(p0: object::Object<PerpMarket>, p1: address, p2: u64, p3: vector<u64>, p4: vector<u64>, p5: vector<u64>, p6: vector<u64>, p7: perp_engine_types::OrderMetadata, p8: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>): order_book_types::OrderIdType
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        market_bulk_order::place_bulk_order<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(&mut borrow_global_mut<PerpMarket>(_v1).market, p1, p2, p3, p4, p5, p6, p7, p8)
    }
    friend fun emit_event_for_order(p0: object::Object<PerpMarket>, p1: order_book_types::OrderIdType, p2: option::Option<string::String>, p3: address, p4: u64, p5: u64, p6: u64, p7: u64, p8: bool, p9: bool, p10: market_types::OrderStatus, p11: string::String, p12: perp_engine_types::OrderMetadata, p13: option::Option<order_book_types::TriggerCondition>, p14: order_book_types::TimeInForce, p15: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>)
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        market_types::emit_event_for_order<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(&borrow_global<PerpMarket>(_v1).market, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15);
    }
    friend fun place_order_with_order_id(p0: object::Object<PerpMarket>, p1: address, p2: u64, p3: u64, p4: u64, p5: bool, p6: order_book_types::TimeInForce, p7: option::Option<order_book_types::TriggerCondition>, p8: perp_engine_types::OrderMetadata, p9: order_book_types::OrderIdType, p10: option::Option<string::String>, p11: u32, p12: bool, p13: bool, p14: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>): order_placement::OrderMatchResult<perp_engine_types::OrderMatchingActions>
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        let _v2 = &mut borrow_global_mut<PerpMarket>(_v1).market;
        let _v3 = option::some<order_book_types::OrderIdType>(p9);
        order_placement::place_order_with_order_id<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(_v2, p1, p2, p3, p4, p5, p6, p7, p8, _v3, p10, p11, p12, p13, p14)
    }
    friend fun cancel_client_order(p0: object::Object<PerpMarket>, p1: &signer, p2: string::String, p3: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>)
        acquires PerpMarket
    {
        let _v0 = p0;
        let _v1 = object::object_address<PerpMarket>(&_v0);
        let _v2 = &mut borrow_global_mut<PerpMarket>(_v1).market;
        let _v3 = signer::address_of(p1);
        order_operations::cancel_order_with_client_id<perp_engine_types::OrderMetadata,perp_engine_types::OrderMatchingActions>(_v2, _v3, p2, p3);
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
