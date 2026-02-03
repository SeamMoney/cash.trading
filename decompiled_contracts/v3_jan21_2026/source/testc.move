module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::testc {
    use 0x1::fungible_asset;
    use 0x1::object;
    use 0x1::primary_fungible_store;
    use 0x1::option;
    use 0x1::string;
    struct TESTCRef has key {
        mint_ref: fungible_asset::MintRef,
        burn_ref: fungible_asset::BurnRef,
        transfer_ref: fungible_asset::TransferRef,
        metadata: object::Object<fungible_asset::Metadata>,
    }
    public fun metadata(): object::Object<fungible_asset::Metadata>
        acquires TESTCRef
    {
        *&borrow_global<TESTCRef>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).metadata
    }
    public fun burn(p0: address, p1: u64)
        acquires TESTCRef
    {
        let _v0 = borrow_global<TESTCRef>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v1 = *&_v0.metadata;
        let _v2 = primary_fungible_store::ensure_primary_store_exists<fungible_asset::Metadata>(p0, _v1);
        fungible_asset::burn_from<fungible_asset::FungibleStore>(&_v0.burn_ref, _v2, p1);
    }
    public fun transfer(p0: &signer, p1: address, p2: u64)
        acquires TESTCRef
    {
        let _v0 = *&borrow_global<TESTCRef>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).metadata;
        primary_fungible_store::transfer<fungible_asset::Metadata>(p0, _v0, p1, p2);
    }
    public fun balance(p0: address): u64
        acquires TESTCRef
    {
        let _v0 = *&borrow_global<TESTCRef>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).metadata;
        primary_fungible_store::balance<fungible_asset::Metadata>(p0, _v0)
    }
    public fun deposit(p0: address, p1: fungible_asset::FungibleAsset) {
        primary_fungible_store::deposit(p0, p1);
    }
    public fun mint(p0: address, p1: u64)
        acquires TESTCRef
    {
        primary_fungible_store::mint(&borrow_global<TESTCRef>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).mint_ref, p0, p1);
    }
    public fun withdraw(p0: &signer, p1: u64): fungible_asset::FungibleAsset
        acquires TESTCRef
    {
        let _v0 = *&borrow_global<TESTCRef>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).metadata;
        primary_fungible_store::withdraw<fungible_asset::Metadata>(p0, _v0, p1)
    }
    fun init_module(p0: &signer) {
        setup_testc(p0);
    }
    public fun setup_testc(p0: &signer) {
        let _v0 = object::create_named_object(p0, vector[84u8, 69u8, 83u8, 84u8, 67u8]);
        let _v1 = &_v0;
        let _v2 = option::none<u128>();
        let _v3 = string::utf8(vector[84u8, 69u8, 83u8, 84u8, 67u8]);
        let _v4 = string::utf8(vector[84u8, 69u8, 83u8, 84u8, 67u8]);
        let _v5 = string::utf8(vector[]);
        let _v6 = string::utf8(vector[]);
        primary_fungible_store::create_primary_store_enabled_fungible_asset(_v1, _v2, _v3, _v4, 6u8, _v5, _v6);
        let _v7 = object::address_from_constructor_ref(&_v0);
        let _v8 = fungible_asset::generate_mint_ref(&_v0);
        let _v9 = fungible_asset::generate_burn_ref(&_v0);
        let _v10 = fungible_asset::generate_transfer_ref(&_v0);
        let _v11 = object::object_from_constructor_ref<fungible_asset::Metadata>(&_v0);
        let _v12 = TESTCRef{mint_ref: _v8, burn_ref: _v9, transfer_ref: _v10, metadata: _v11};
        move_to<TESTCRef>(p0, _v12);
    }
}
