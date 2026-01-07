module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::fee_treasury {
    use 0x1::object;
    use 0x1::fungible_asset;
    use 0x1::signer;
    use 0x1::primary_fungible_store;
    use 0x1::error;
    use 0x1::dispatchable_fungible_asset;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::fee_distribution;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::accounts_collateral;
    enum FeeVault has store, key {
        V1 {
            asset_type: object::Object<fungible_asset::Metadata>,
            store: object::Object<fungible_asset::FungibleStore>,
            store_extend_ref: object::ExtendRef,
        }
    }
    friend fun initialize(p0: &signer, p1: object::Object<fungible_asset::Metadata>) {
        if (!(signer::address_of(p0) == @0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844)) {
            let _v0 = error::invalid_argument(3);
            abort _v0
        };
        let _v1 = object::create_named_object(p0, vector[102u8, 101u8, 101u8, 95u8, 118u8, 97u8, 117u8, 108u8, 116u8]);
        let _v2 = object::generate_extend_ref(&_v1);
        let _v3 = primary_fungible_store::ensure_primary_store_exists<fungible_asset::Metadata>(object::address_from_constructor_ref(&_v1), p1);
        let _v4 = FeeVault::V1{asset_type: p1, store: _v3, store_extend_ref: _v2};
        move_to<FeeVault>(p0, _v4);
    }
    friend fun deposit_fees(p0: fungible_asset::FungibleAsset)
        acquires FeeVault
    {
        let _v0 = borrow_global<FeeVault>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        let _v1 = fungible_asset::metadata_from_asset(&p0);
        let _v2 = *&_v0.asset_type;
        assert!(_v1 == _v2, 14566554180833181696);
        if (!(fungible_asset::amount(&p0) > 0)) {
            let _v3 = error::invalid_argument(1);
            abort _v3
        };
        dispatchable_fungible_asset::deposit<fungible_asset::FungibleStore>(*&_v0.store, p0);
    }
    public fun get_balance(): u64
        acquires FeeVault
    {
        fungible_asset::balance<fungible_asset::FungibleStore>(*&borrow_global<FeeVault>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).store)
    }
    friend fun withdraw_fees(p0: u64): fungible_asset::FungibleAsset
        acquires FeeVault
    {
        if (!(p0 > 0)) {
            let _v0 = error::invalid_argument(1);
            abort _v0
        };
        let _v1 = borrow_global<FeeVault>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        let _v2 = object::generate_signer_for_extending(&_v1.store_extend_ref);
        let _v3 = &_v2;
        let _v4 = *&_v1.store;
        dispatchable_fungible_asset::withdraw<fungible_asset::FungibleStore>(_v3, _v4, p0)
    }
}
