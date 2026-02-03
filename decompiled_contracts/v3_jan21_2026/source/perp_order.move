module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_order {
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book_types;
    use 0x1::option;
    use 0x1::string;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::order_placement_utils;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_matching_engine;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    enum PerpOrderRequestCommonArgs has copy, drop, store {
        V1 {
            price: u64,
            orig_size: u64,
            is_buy: bool,
            time_in_force: order_book_types::TimeInForce,
            client_order_id: option::Option<string::String>,
        }
    }
    enum PerpOrderRequestExtendedArgs has copy, drop, store {
        V1 {
            user: address,
            common_args: PerpOrderRequestCommonArgs,
            order_id: order_book_types::OrderId,
            trigger_condition: option::Option<order_book_types::TriggerCondition>,
        }
    }
    enum PerpOrderRequestTpSlArgs has copy, drop, store {
        V1 {
            tp_trigger_price: option::Option<u64>,
            tp_limit_price: option::Option<u64>,
            sl_trigger_price: option::Option<u64>,
            sl_limit_price: option::Option<u64>,
        }
    }
    friend fun get_price(p0: &PerpOrderRequestCommonArgs): u64 {
        *&p0.price
    }
    friend fun get_order_id(p0: &PerpOrderRequestExtendedArgs): order_book_types::OrderId {
        *&p0.order_id
    }
    friend fun get_client_order_id(p0: &PerpOrderRequestCommonArgs): option::Option<string::String> {
        *&p0.client_order_id
    }
    friend fun get_trigger_condition(p0: &PerpOrderRequestExtendedArgs): option::Option<order_book_types::TriggerCondition> {
        *&p0.trigger_condition
    }
    friend fun common_as_inner(p0: &PerpOrderRequestCommonArgs): (u64, u64, bool, order_book_types::TimeInForce, option::Option<string::String>) {
        assert!(p0 is V1, 14566554180833181697);
        let _v0 = &p0.price;
        let _v1 = &p0.orig_size;
        let _v2 = &p0.is_buy;
        let _v3 = &p0.time_in_force;
        let _v4 = &p0.client_order_id;
        let _v5 = *_v0;
        let _v6 = *_v1;
        let _v7 = *_v2;
        let _v8 = *_v3;
        let _v9 = *_v4;
        (_v5, _v6, _v7, _v8, _v9)
    }
    friend fun common_into_inner(p0: PerpOrderRequestCommonArgs): (u64, u64, bool, order_book_types::TimeInForce, option::Option<string::String>) {
        assert!(&p0 is V1, 14566554180833181697);
        let PerpOrderRequestCommonArgs::V1{price: _v0, orig_size: _v1, is_buy: _v2, time_in_force: _v3, client_order_id: _v4} = p0;
        (_v0, _v1, _v2, _v3, _v4)
    }
    friend fun extended_as_inner(p0: &PerpOrderRequestExtendedArgs): (address, &PerpOrderRequestCommonArgs, order_book_types::OrderId, option::Option<order_book_types::TriggerCondition>) {
        assert!(p0 is V1, 14566554180833181697);
        let _v0 = &p0.user;
        let _v1 = &p0.common_args;
        let _v2 = &p0.order_id;
        let _v3 = &p0.trigger_condition;
        let _v4 = *_v0;
        let _v5 = *_v2;
        let _v6 = *_v3;
        (_v4, _v1, _v5, _v6)
    }
    friend fun extended_into_inner(p0: PerpOrderRequestExtendedArgs): (address, PerpOrderRequestCommonArgs, order_book_types::OrderId, option::Option<order_book_types::TriggerCondition>) {
        assert!(&p0 is V1, 14566554180833181697);
        let PerpOrderRequestExtendedArgs::V1{user: _v0, common_args: _v1, order_id: _v2, trigger_condition: _v3} = p0;
        (_v0, _v1, _v2, _v3)
    }
    friend fun get_common_args(p0: &PerpOrderRequestExtendedArgs): &PerpOrderRequestCommonArgs {
        &p0.common_args
    }
    friend fun get_is_buy(p0: &PerpOrderRequestCommonArgs): bool {
        *&p0.is_buy
    }
    friend fun get_orig_size(p0: &PerpOrderRequestCommonArgs): u64 {
        *&p0.orig_size
    }
    friend fun get_time_in_force(p0: &PerpOrderRequestCommonArgs): order_book_types::TimeInForce {
        *&p0.time_in_force
    }
    friend fun get_user(p0: &PerpOrderRequestExtendedArgs): address {
        *&p0.user
    }
    public fun new_empty_order_tp_sl_args(): PerpOrderRequestTpSlArgs {
        let _v0 = option::none<u64>();
        let _v1 = option::none<u64>();
        let _v2 = option::none<u64>();
        let _v3 = option::none<u64>();
        PerpOrderRequestTpSlArgs::V1{tp_trigger_price: _v0, tp_limit_price: _v1, sl_trigger_price: _v2, sl_limit_price: _v3}
    }
    public fun new_order_common_args(p0: u64, p1: u64, p2: bool, p3: order_book_types::TimeInForce, p4: option::Option<string::String>): PerpOrderRequestCommonArgs {
        if (option::is_some<string::String>(&p4)) {
            assert!(string::length(option::borrow<string::String>(&p4)) <= 32, 1)};
        PerpOrderRequestCommonArgs::V1{price: p0, orig_size: p1, is_buy: p2, time_in_force: p3, client_order_id: p4}
    }
    public fun new_order_extended_args(p0: address, p1: PerpOrderRequestCommonArgs, p2: order_book_types::OrderId, p3: option::Option<order_book_types::TriggerCondition>): PerpOrderRequestExtendedArgs {
        PerpOrderRequestExtendedArgs::V1{user: p0, common_args: p1, order_id: p2, trigger_condition: p3}
    }
    public fun new_order_tp_sl_args(p0: option::Option<u64>, p1: option::Option<u64>, p2: option::Option<u64>, p3: option::Option<u64>): PerpOrderRequestTpSlArgs {
        PerpOrderRequestTpSlArgs::V1{tp_trigger_price: p0, tp_limit_price: p1, sl_trigger_price: p2, sl_limit_price: p3}
    }
    friend fun tpsl_into_inner(p0: PerpOrderRequestTpSlArgs): (option::Option<u64>, option::Option<u64>, option::Option<u64>, option::Option<u64>) {
        assert!(&p0 is V1, 14566554180833181697);
        let PerpOrderRequestTpSlArgs::V1{tp_trigger_price: _v0, tp_limit_price: _v1, sl_trigger_price: _v2, sl_limit_price: _v3} = p0;
        (_v0, _v1, _v2, _v3)
    }
}
