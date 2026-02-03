module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_view_types {
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::price_management;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_positions;
    enum PositionViewInfo has drop {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
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
    public fun get_position_info_avg_acquire_entry_px(p0: &PositionViewInfo): u64 {
        *&p0.avg_acquire_entry_px
    }
    public fun get_position_info_entry_px_times_size_sum(p0: &PositionViewInfo): u128 {
        *&p0.entry_px_times_size_sum
    }
    public fun get_position_info_funding_index_at_last_update(p0: &PositionViewInfo): price_management::AccumulativeIndex {
        *&p0.funding_index_at_last_update
    }
    public fun get_position_info_is_isolated(p0: &PositionViewInfo): bool {
        *&p0.is_isolated
    }
    public fun get_position_info_is_long(p0: &PositionViewInfo): bool {
        *&p0.is_long
    }
    public fun get_position_info_market(p0: &PositionViewInfo): object::Object<perp_market::PerpMarket> {
        *&p0.market
    }
    public fun get_position_info_size(p0: &PositionViewInfo): u64 {
        *&p0.size
    }
    public fun get_position_info_unrealized_funding_amount_before_last_update(p0: &PositionViewInfo): i64 {
        *&p0.unrealized_funding_amount_before_last_update
    }
    public fun get_position_info_user_leverage(p0: &PositionViewInfo): u8 {
        *&p0.user_leverage
    }
    friend fun new_position_view_info(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u128, p3: u64, p4: u8, p5: bool, p6: bool, p7: price_management::AccumulativeIndex, p8: i64): PositionViewInfo {
        PositionViewInfo::V1{market: p0, size: p1, entry_px_times_size_sum: p2, avg_acquire_entry_px: p3, user_leverage: p4, is_long: p5, is_isolated: p6, funding_index_at_last_update: p7, unrealized_funding_amount_before_last_update: p8}
    }
}
