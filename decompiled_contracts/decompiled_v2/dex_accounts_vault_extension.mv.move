module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::dex_accounts_vault_extension {
    use 0x1::fungible_asset;
    use 0x1::object;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::dex_accounts;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine;
    use 0x1::signer;
    enum ExternalCallbacks has key {
        V1 {
            vault_contribute_funds_f: |&signer, address, fungible_asset::FungibleAsset| has copy + drop + store,
            vault_redeem_and_deposit_to_dex_f: |&signer, address, u64| has copy + drop + store,
        }
    }
    public entry fun contribute_to_vault(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: address, p3: object::Object<fungible_asset::Metadata>, p4: u64)
        acquires ExternalCallbacks
    {
        let _v0 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_vault_trading(p0, p1);
        let _v1 = perp_engine::withdraw_fungible(&_v0, p3, p4);
        assert!(exists<ExternalCallbacks>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 3);
        let _v2 = &_v0;
        let _v3 = *&borrow_global<ExternalCallbacks>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).vault_contribute_funds_f;
        _v3(_v2, p2, _v1);
    }
    public entry fun redeem_from_vault(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: address, p3: u64)
        acquires ExternalCallbacks
    {
        let _v0 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_vault_trading(p0, p1);
        assert!(exists<ExternalCallbacks>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 3);
        let _v1 = &_v0;
        let _v2 = *&borrow_global<ExternalCallbacks>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).vault_redeem_and_deposit_to_dex_f;
        _v2(_v1, p2, p3);
    }
    public fun register_vault_callbacks(p0: &signer, p1: |&signer, address, fungible_asset::FungibleAsset| has copy + drop + store, p2: |&signer, address, u64| has copy + drop + store) {
        assert!(signer::address_of(p0) == @0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75, 1);
        if (exists<ExternalCallbacks>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75)) abort 2;
        let _v0 = ExternalCallbacks::V1{vault_contribute_funds_f: p1, vault_redeem_and_deposit_to_dex_f: p2};
        move_to<ExternalCallbacks>(p0, _v0);
    }
}
