module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::vault_api {
    use 0x1::fungible_asset;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::dex_accounts_vault_extension;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::vault;
    use 0x1::option;
    use 0x1::object;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::dex_accounts;
    use 0x1::string;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::async_vault_work;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::async_vault_engine;
    use 0x1::signer;
    use 0x1::primary_fungible_store;
    fun init_module(p0: &signer) {
        let _v0: |&signer, address, fungible_asset::FungibleAsset| has copy + drop = |arg0,arg1,arg2| contribute_funds(arg0, arg1, arg2);
        let _v1: |&signer, address, u64| has copy + drop = |arg0,arg1,arg2| redeem_and_deposit_to_dex(arg0, arg1, arg2);
        dex_accounts_vault_extension::register_vault_callbacks(p0, _v0, _v1);
    }
    #[persistent]
    friend fun contribute_funds(p0: &signer, p1: address, p2: fungible_asset::FungibleAsset) {
        vault::contribute_funds(p0, p1, p2);
    }
    #[persistent]
    fun redeem_and_deposit_to_dex(p0: &signer, p1: address, p2: u64) {
        let _v0 = object::address_to_object<vault::Vault>(p1);
        redeem_internal(p0, _v0, p2, true);
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
        if (option::is_none<object::Object<dex_accounts::Subaccount>>(&p1)) {
            let _v0;
            let _v1 = dex_accounts::primary_subaccount(signer::address_of(p0));
            if (object::object_exists<dex_accounts::Subaccount>(_v1)) _v0 = option::some<object::Object<dex_accounts::Subaccount>>(object::address_to_object<dex_accounts::Subaccount>(_v1)) else _v0 = option::none<object::Object<dex_accounts::Subaccount>>();
            p1 = _v0
        };
        let _v2 = create_vault(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11);
        if (p12 > 0) {
            let _v3;
            let _v4 = vault::get_vault_contribution_asset_type(_v2);
            if (option::is_some<object::Object<dex_accounts::Subaccount>>(&p1)) _v3 = primary_fungible_store::balance<fungible_asset::Metadata>(signer::address_of(p0), _v4) < p12 else _v3 = false;
            if (_v3) {
                let _v5 = option::destroy_some<object::Object<dex_accounts::Subaccount>>(p1);
                let _v6 = dex_accounts::withdraw_from_subaccount_request(p0, _v5, _v4, p12);
            };
            vault::contribute(p0, _v2, p12)
        };
        if (p13) vault::activate_vault(p0, _v2, 0);
        if (p14) {
            let _v7 = signer::address_of(p0);
            let _v8 = option::none<u64>();
            vault::delegate_dex_actions_to(p0, _v2, _v7, _v8);
            return ()
        };
    }
    fun redeem_internal(p0: &signer, p1: object::Object<vault::Vault>, p2: u64, p3: bool) {
        assert!(p2 > 0, 1);
        if (!async_vault_work::request_redemption(signer::address_of(p0), p1, p2, p3)) {
            async_vault_engine::queue_vault_progress_if_needed(p1);
            return ()
        };
    }
}
