module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::dex_accounts_vault_extension {
    use 0x1::fungible_asset;
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::dex_accounts;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::account_management_apis;
    use 0x1::signer;
    enum ExternalCallbacks has key {
        V1 {
            vault_contribute_funds_f: |address, address, fungible_asset::FungibleAsset| has copy + drop + store,
            vault_redeem_and_deposit_to_dex_f: |&signer, address, u64|(bool) has copy + drop + store,
        }
    }
    public fun contribute_funds_to_vault(p0: object::Object<dex_accounts::Subaccount>, p1: address, p2: fungible_asset::FungibleAsset)
        acquires ExternalCallbacks
    {
        assert!(exists<ExternalCallbacks>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88), 3);
        dex_accounts::assert_subaccount_is_active(p0);
        let _v0 = object::object_address<dex_accounts::Subaccount>(&p0);
        let _v1 = *&borrow_global<ExternalCallbacks>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).vault_contribute_funds_f;
        _v1(_v0, p1, p2);
    }
    public fun contribute_to_vault(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: address, p3: object::Object<fungible_asset::Metadata>, p4: u64)
        acquires ExternalCallbacks
    {
        let _v0 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_vault_trading(p0, p1);
        let _v1 = account_management_apis::withdraw_fungible(&_v0, p3, p4);
        contribute_funds_to_vault(p1, p2, _v1);
    }
    public fun redeem_from_vault(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: address, p3: u64): bool
        acquires ExternalCallbacks
    {
        let _v0 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_vault_trading(p0, p1);
        assert!(exists<ExternalCallbacks>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88), 3);
        let _v1 = &_v0;
        let _v2 = *&borrow_global<ExternalCallbacks>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).vault_redeem_and_deposit_to_dex_f;
        _v2(_v1, p2, p3)
    }
    public fun register_vault_callbacks(p0: &signer, p1: |address, address, fungible_asset::FungibleAsset| has copy + drop + store, p2: |&signer, address, u64|(bool) has copy + drop + store) {
        assert!(signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88, 1);
        if (exists<ExternalCallbacks>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88)) abort 2;
        let _v0 = ExternalCallbacks::V1{vault_contribute_funds_f: p1, vault_redeem_and_deposit_to_dex_f: p2};
        move_to<ExternalCallbacks>(p0, _v0);
    }
}
