module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::order_margin {
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::collateral_balance_sheet;
    use 0x1::object;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market;
    use 0x1::option;
    use 0x1::string;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_positions;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::pending_order_tracker;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_book_types;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine_types;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::accounts_collateral;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::clearinghouse_perp;
    friend fun validate_order_placement(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: bool, p5: u64): option::Option<string::String> {
        let (_v0,_v1,_v2) = perp_positions::get_position_info_or_default(p1, p2, p4);
        let _v3 = perp_positions::free_collateral_for_crossed(p0, p1, 0i64);
        if (pending_order_tracker::validate_non_reduce_only_order_placement(p1, p2, p3, p5, p4, _v0, _v1, _v2, _v3)) return option::none<string::String>();
        option::some<string::String>(string::utf8(vector[78u8, 111u8, 116u8, 32u8, 101u8, 110u8, 111u8, 117u8, 103u8, 104u8, 32u8, 99u8, 111u8, 108u8, 108u8, 97u8, 116u8, 101u8, 114u8, 97u8, 108u8, 32u8, 116u8, 111u8, 32u8, 112u8, 108u8, 97u8, 99u8, 101u8, 32u8, 111u8, 114u8, 100u8, 101u8, 114u8]))
    }
    friend fun add_reduce_only_order(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: order_book_types::OrderIdType, p3: u64, p4: bool): vector<perp_engine_types::SingleOrderAction> {
        let (_v0,_v1,_v2) = perp_positions::get_position_info_or_default(p0, p1, p4);
        pending_order_tracker::add_reduce_only_order(p0, p1, p2, p3, p4, _v0, _v1)
    }
    friend fun validate_reduce_only_order(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool): option::Option<string::String> {
        let (_v0,_v1,_v2) = perp_positions::get_position_info_or_default(p0, p1, p2);
        pending_order_tracker::validate_reduce_only_order(p0, p1, p2, _v0, _v1)
    }
    friend fun add_pending_order(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: bool, p4: u64) {
        let (_v0,_v1,_v2) = perp_positions::get_position_info_or_default(p0, p1, p3);
        pending_order_tracker::add_non_reduce_only_order(p0, p1, p2, p4, p3, _v0, _v1, _v2);
    }
    friend fun available_order_margin(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address): u64 {
        let _v0 = pending_order_tracker::get_pending_order_margin(p1);
        let _v1 = perp_positions::free_collateral_for_crossed(p0, p1, 0i64);
        if (_v0 >= _v1) return 0;
        _v1 - _v0
    }
}
