module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::vault_api {
    use 0x1::fungible_asset;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::dex_accounts_vault_extension;
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::vault;
    use 0x1::option;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::dex_accounts;
    use 0x1::string;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_vault_work;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_vault_engine;
    use 0x1::signer;
    fun init_module(p0: &signer) {
        let _v0: |address, address, fungible_asset::FungibleAsset| has copy + drop = |arg0,arg1,arg2| contribute_funds(arg0, arg1, arg2);
        let _v1: |&signer, address, u64|bool has copy + drop = |arg0,arg1,arg2| redeem_and_deposit_to_dex(arg0, arg1, arg2);
        dex_accounts_vault_extension::register_vault_callbacks(p0, _v0, _v1);
    }
    #[persistent]
    friend fun contribute_funds(p0: address, p1: address, p2: fungible_asset::FungibleAsset) {
        vault::contribute_funds(p0, p1, p2);
    }
    #[persistent]
    fun redeem_and_deposit_to_dex(p0: &signer, p1: address, p2: u64): bool {
        let _v0 = object::address_to_object<vault::Vault>(p1);
        redeem_internal(p0, _v0, p2, true)
    }
    public entry fun activate_vault(p0: &signer, p1: object::Object<vault::Vault>) {
        vault::activate_vault(p0, p1);
    }
    friend fun create_vault(p0: &signer, p1: option::Option<object::Object<dex_accounts::Subaccount>>, p2: object::Object<fungible_asset::Metadata>, p3: string::String, p4: string::String, p5: vector<string::String>, p6: string::String, p7: string::String, p8: string::String, p9: u64, p10: u64, p11: u64): object::Object<vault::Vault> {
        let (_v0,_v1) = vault::create_vault(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11);
        let _v2 = _v1;
        let _v3 = _v0;
        let _v4 = object::object_from_constructor_ref<vault::Vault>(&_v3);
        async_vault_work::register_vault(&_v2);
        _v4
    }
    public entry fun process_pending_requests(p0: u32) {
        async_vault_engine::process_pending_requests(p0);
    }
    public entry fun create_and_fund_vault(p0: &signer, p1: option::Option<object::Object<dex_accounts::Subaccount>>, p2: object::Object<fungible_asset::Metadata>, p3: string::String, p4: string::String, p5: vector<string::String>, p6: string::String, p7: string::String, p8: string::String, p9: u64, p10: u64, p11: u64, p12: u64, p13: bool, p14: bool) {
        let _v0 = create_vault(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11);
        if (p12 > 0) {
            let _v1;
            p2 = vault::get_vault_contribution_asset_type(_v0);
            if (option::is_some<object::Object<dex_accounts::Subaccount>>(&p1)) {
                let _v2 = option::destroy_some<object::Object<dex_accounts::Subaccount>>(p1);
                let _v3 = dex_accounts::withdraw_from_subaccount(p0, _v2, p2, p12);
                _v1 = object::object_address<dex_accounts::Subaccount>(&_v2)
            } else _v1 = signer::address_of(p0);
            vault::contribute(p0, _v1, _v0, p12)
        };
        if (p13) vault::activate_vault(p0, _v0);
        if (p14) {
            let _v4 = signer::address_of(p0);
            let _v5 = option::none<u64>();
            vault::delegate_dex_actions_to(p0, _v0, _v4, _v5);
            return ()
        };
    }
    public fun get_max_synchronous_redemption(p0: object::Object<vault::Vault>): u64 {
        if (async_vault_work::sync_redemption_allowed(p0)) return vault::get_max_withdrawable_amount(p0);
        0
    }
    fun redeem_internal(p0: &signer, p1: object::Object<vault::Vault>, p2: u64, p3: bool): bool {
        assert!(p2 > 0, 1);
        if (!async_vault_work::request_redemption(signer::address_of(p0), p1, p2, p3)) {
            async_vault_engine::queue_vault_progress_if_needed(p1);
            return false
        };
        true
    }
}
