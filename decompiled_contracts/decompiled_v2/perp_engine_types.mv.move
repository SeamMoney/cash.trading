module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine_types {
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_book_types;
    use 0x1::option;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::builder_code_registry;
    use 0x1::bcs;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::pending_order_tracker;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::tp_sl_utils;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::clearinghouse_perp;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::order_placement_utils;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::liquidation;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::async_matching_engine;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine;
    enum ChildTpSlOrder has copy, drop, store {
        V1 {
            trigger_price: u64,
            parent_order_id: order_book_types::OrderIdType,
            limit_price: option::Option<u64>,
        }
    }
    struct OrderActions has copy, drop, store {
        actions: vector<SingleOrderAction>,
    }
    enum SingleOrderAction has copy, drop, store {
        CancelOrder {
            account: address,
            order_id: order_book_types::OrderIdType,
        }
        ReduceOrderSize {
            account: address,
            order_id: order_book_types::OrderIdType,
            size_delta: u64,
        }
    }
    enum OrderMatchingActions has copy, drop, store {
        SettleTradeMatchingActions {
            _0: OrderActions,
        }
        PlaceMakerOrderActions {
            _0: OrderActions,
        }
    }
    enum OrderMetadata has copy, drop, store {
        V1_RETAIL {
            is_reduce_only: bool,
            use_backstop_liquidation_margin: bool,
            twap: option::Option<TwapMetadata>,
            tp_sl: TpSlMetadata,
            builder_code: option::Option<builder_code_registry::BuilderCode>,
        }
        V1_BULK {
            builder_code: option::Option<builder_code_registry::BuilderCode>,
        }
    }
    enum TwapMetadata has copy, drop, store {
        V1 {
            start_time_seconds: u64,
            frequency_seconds: u64,
            end_time_seconds: u64,
        }
    }
    enum TpSlMetadata has copy, drop, store {
        V1 {
            tp: option::Option<ChildTpSlOrder>,
            sl: option::Option<ChildTpSlOrder>,
        }
    }
    friend fun is_reduce_only(p0: &OrderMetadata): bool {
        loop {
            if (!(p0 is V1_RETAIL)) {
                if (p0 is V1_BULK) break;
                abort 14566554180833181697
            };
            return *&p0.is_reduce_only
        };
        false
    }
    friend fun use_backstop_liquidation_margin(p0: &OrderMetadata): bool {
        loop {
            if (!(p0 is V1_BULK)) {
                if (p0 is V1_RETAIL) break;
                abort 14566554180833181697
            };
            return false
        };
        *&p0.use_backstop_liquidation_margin
    }
    friend fun get_order_metadata_bytes(p0: &OrderMetadata): vector<u8> {
        bcs::to_bytes<OrderMetadata>(p0)
    }
    friend fun destroy_cancel_order_action(p0: SingleOrderAction): (address, order_book_types::OrderIdType) {
        let SingleOrderAction::CancelOrder{account: _v0, order_id: _v1} = p0;
        (_v0, _v1)
    }
    friend fun destroy_child_tp_sl_order(p0: ChildTpSlOrder): (u64, option::Option<u64>, order_book_types::OrderIdType) {
        let ChildTpSlOrder::V1{trigger_price: _v0, parent_order_id: _v1, limit_price: _v2} = p0;
        (_v0, _v2, _v1)
    }
    friend fun destroy_order_matching_actions(p0: OrderMatchingActions): vector<SingleOrderAction> {
        *&(&(&p0)._0).actions
    }
    friend fun destroy_reduce_order_size_action(p0: SingleOrderAction): (address, order_book_types::OrderIdType, u64) {
        let SingleOrderAction::ReduceOrderSize{account: _v0, order_id: _v1, size_delta: _v2} = p0;
        (_v0, _v1, _v2)
    }
    friend fun get_builder_code_from_metadata(p0: &OrderMetadata): option::Option<builder_code_registry::BuilderCode> {
        let _v0;
        if (p0 is V1_RETAIL) _v0 = &p0.builder_code else _v0 = &p0.builder_code;
        *_v0
    }
    friend fun get_sl_from_metadata(p0: &OrderMetadata): option::Option<ChildTpSlOrder> {
        loop {
            if (!(p0 is V1_RETAIL)) {
                if (p0 is V1_BULK) break;
                abort 14566554180833181697
            };
            return *&(&p0.tp_sl).sl
        };
        option::none<ChildTpSlOrder>()
    }
    friend fun get_tp_from_metadata(p0: &OrderMetadata): option::Option<ChildTpSlOrder> {
        loop {
            if (!(p0 is V1_RETAIL)) {
                if (p0 is V1_BULK) break;
                abort 14566554180833181697
            };
            return *&(&p0.tp_sl).tp
        };
        option::none<ChildTpSlOrder>()
    }
    friend fun get_twap_from_metadata(p0: &OrderMetadata): (u64, u64, u64) {
        let _v0 = option::destroy_some<TwapMetadata>(*&p0.twap);
        let _v1 = *&(&_v0).start_time_seconds;
        let _v2 = *&(&_v0).frequency_seconds;
        let _v3 = *&(&_v0).end_time_seconds;
        (_v1, _v2, _v3)
    }
    friend fun is_cancel_order_action(p0: &SingleOrderAction): bool {
        p0 is CancelOrder
    }
    friend fun is_reduce_order_size_action(p0: &SingleOrderAction): bool {
        p0 is ReduceOrderSize
    }
    friend fun new_bulk_order_metadata(p0: option::Option<builder_code_registry::BuilderCode>): OrderMetadata {
        OrderMetadata::V1_BULK{builder_code: p0}
    }
    friend fun new_cancel_order_action(p0: address, p1: order_book_types::OrderIdType): SingleOrderAction {
        SingleOrderAction::CancelOrder{account: p0, order_id: p1}
    }
    friend fun new_child_tp_sl_order(p0: u64, p1: option::Option<u64>, p2: order_book_types::OrderIdType): ChildTpSlOrder {
        ChildTpSlOrder::V1{trigger_price: p0, parent_order_id: p2, limit_price: p1}
    }
    friend fun new_default_order_metadata(): OrderMetadata {
        let _v0 = option::none<TwapMetadata>();
        let _v1 = new_tp_sl_empty_metadata();
        let _v2 = option::none<builder_code_registry::BuilderCode>();
        OrderMetadata::V1_RETAIL{is_reduce_only: false, use_backstop_liquidation_margin: false, twap: _v0, tp_sl: _v1, builder_code: _v2}
    }
    friend fun new_tp_sl_empty_metadata(): TpSlMetadata {
        let _v0 = option::none<ChildTpSlOrder>();
        let _v1 = option::none<ChildTpSlOrder>();
        TpSlMetadata::V1{tp: _v0, sl: _v1}
    }
    friend fun new_liquidation_metadata(): OrderMetadata {
        let _v0 = option::none<TwapMetadata>();
        let _v1 = new_tp_sl_empty_metadata();
        let _v2 = option::none<builder_code_registry::BuilderCode>();
        OrderMetadata::V1_RETAIL{is_reduce_only: false, use_backstop_liquidation_margin: true, twap: _v0, tp_sl: _v1, builder_code: _v2}
    }
    friend fun new_order_metadata(p0: bool, p1: option::Option<TwapMetadata>, p2: option::Option<ChildTpSlOrder>, p3: option::Option<ChildTpSlOrder>, p4: option::Option<builder_code_registry::BuilderCode>): OrderMetadata {
        let _v0 = TpSlMetadata::V1{tp: p2, sl: p3};
        OrderMetadata::V1_RETAIL{is_reduce_only: p0, use_backstop_liquidation_margin: false, twap: p1, tp_sl: _v0, builder_code: p4}
    }
    friend fun new_place_maker_order_actions(p0: vector<SingleOrderAction>): OrderMatchingActions {
        OrderMatchingActions::PlaceMakerOrderActions{_0: OrderActions{actions: p0}}
    }
    friend fun new_reduce_order_size_action(p0: address, p1: order_book_types::OrderIdType, p2: u64): SingleOrderAction {
        SingleOrderAction::ReduceOrderSize{account: p0, order_id: p1, size_delta: p2}
    }
    friend fun new_settle_trade_actions(p0: vector<SingleOrderAction>): OrderMatchingActions {
        OrderMatchingActions::SettleTradeMatchingActions{_0: OrderActions{actions: p0}}
    }
    friend fun new_twap_metadata(p0: u64, p1: u64, p2: u64): TwapMetadata {
        TwapMetadata::V1{start_time_seconds: p0, frequency_seconds: p1, end_time_seconds: p2}
    }
}
