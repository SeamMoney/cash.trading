module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::position_view_types {
    use 0x1::object;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_market;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_positions;
    enum PositionViewInfo has drop {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            size: u64,
            is_long: bool,
            user_leverage: u8,
            is_isolated: bool,
        }
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
    public fun get_position_info_user_leverage(p0: &PositionViewInfo): u8 {
        *&p0.user_leverage
    }
    friend fun new_position_view_info(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: bool, p3: u8, p4: bool): PositionViewInfo {
        PositionViewInfo::V1{market: p0, size: p1, is_long: p2, user_leverage: p3, is_isolated: p4}
    }
}
