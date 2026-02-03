module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::account_management_apis {
    use 0x1::fungible_asset;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    public fun deposit(p0: address, p1: fungible_asset::FungibleAsset) {
        perp_engine::deposit(p0, p1);
    }
    public fun configure_user_settings_for_market(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: u8) {
        perp_engine::configure_user_settings_for_market(p0, p1, p2, p3);
    }
    public fun transfer_margin_to_isolated_position(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: object::Object<fungible_asset::Metadata>, p4: u64) {
        perp_engine::transfer_margin_to_isolated_position(p0, p1, p2, p3, p4);
    }
    public fun deposit_to_isolated_position_margin(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: fungible_asset::FungibleAsset) {
        perp_engine::deposit_to_isolated_position_margin(p0, p1, p2);
    }
    public fun withdraw_fungible(p0: &signer, p1: object::Object<fungible_asset::Metadata>, p2: u64): fungible_asset::FungibleAsset {
        perp_engine::withdraw_fungible(p0, p1, p2)
    }
    public fun withdraw_from_isolated_position_margin(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: object::Object<fungible_asset::Metadata>, p3: u64): fungible_asset::FungibleAsset {
        perp_engine::withdraw_from_isolated_position_margin(p0, p1, p2, p3)
    }
}
