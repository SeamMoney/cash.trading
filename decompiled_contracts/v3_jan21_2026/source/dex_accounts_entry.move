module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::dex_accounts_entry {
    use 0x1::string;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine_api;
    use 0x1::signer;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::dex_accounts;
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0x1::option;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::account_management_apis;
    use 0x1::fungible_asset;
    use 0x1::primary_fungible_store;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book_types;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::order_apis;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::builder_code_registry;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::dex_accounts_vault_extension;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_order;
    entry fun register_referral_code(p0: &signer, p1: string::String) {
        perp_engine_api::register_referral_code(p0, p1);
    }
    entry fun register_referrer(p0: &signer, p1: string::String) {
        perp_engine_api::register_referrer(p0, p1);
        if (!dex_accounts::subaccount_exists(dex_accounts::primary_subaccount(signer::address_of(p0)))) {
            let _v0 = dex_accounts::create_primary_subaccount_object(signer::address_of(p0));
            return ()
        };
    }
    entry fun configure_user_settings_for_market(p0: &signer, p1: address, p2: object::Object<perp_market::PerpMarket>, p3: bool, p4: u8) {
        let _v0 = option::some<address>(signer::address_of(p0));
        let _v1 = dex_accounts::get_subaccount_object_unpermissioned(p1, _v0);
        let _v2 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, _v1, p2);
        account_management_apis::configure_user_settings_for_market(&_v2, p2, p3, p4);
    }
    entry fun transfer_margin_to_isolated_position(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: bool, p4: object::Object<fungible_asset::Metadata>, p5: u64) {
        let _v0 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        account_management_apis::transfer_margin_to_isolated_position(&_v0, p2, p3, p4, p5);
    }
    entry fun deposit_to_isolated_position_margin(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: object::Object<fungible_asset::Metadata>, p4: u64) {
        let _v0 = primary_fungible_store::withdraw<fungible_asset::Metadata>(p0, p3, p4);
        let _v1 = dex_accounts::get_subaccount_signer_if_owner(p0, p1);
        account_management_apis::deposit_to_isolated_position_margin(&_v1, p2, _v0);
    }
    entry fun cancel_tp_sl_order_for_position(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: u128) {
        let _v0 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v1 = &_v0;
        let _v2 = order_book_types::new_order_id_type(p3);
        order_apis::cancel_tp_sl_order_for_position(p2, _v1, _v2);
    }
    entry fun place_tp_sl_order_for_position(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: option::Option<u64>, p4: option::Option<u64>, p5: option::Option<u64>, p6: option::Option<u64>, p7: option::Option<u64>, p8: option::Option<u64>, p9: option::Option<address>, p10: option::Option<u64>) {
        let _v0;
        let _v1 = p9;
        if (option::is_some<address>(&_v1)) {
            let _v2 = option::destroy_some<address>(_v1);
            let _v3 = option::destroy_some<u64>(p10);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v2, _v3))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v4 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v5 = &_v4;
        let (_v6,_v7) = order_apis::place_tp_sl_order_for_position(p2, _v5, p3, p4, p5, p6, p7, p8, _v0);
    }
    entry fun withdraw_from_isolated_position_margin(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: object::Object<fungible_asset::Metadata>, p4: u64) {
        let _v0 = dex_accounts::get_subaccount_signer_if_owner(p0, p1);
        let _v1 = account_management_apis::withdraw_from_isolated_position_margin(&_v0, p2, p3, p4);
        primary_fungible_store::deposit(signer::address_of(p0), _v1);
    }
    entry fun deactivate_subaccount(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: bool) {
        dex_accounts::deactivate_subaccount(p0, p1, p2);
    }
    entry fun delegate_ability_to_sub_delegate_to_for_subaccount(p0: &signer, p1: address, p2: address, p3: option::Option<u64>) {
        dex_accounts::delegate_ability_to_sub_delegate_to_for_subaccount(p0, p1, p2, p3);
    }
    friend entry fun delegate_trading_to_for_subaccount(p0: &signer, p1: address, p2: address, p3: option::Option<u64>) {
        dex_accounts::delegate_trading_to_for_subaccount(p0, p1, p2, p3);
    }
    entry fun deposit_to_subaccount_at(p0: &signer, p1: address, p2: object::Object<fungible_asset::Metadata>, p3: u64) {
        dex_accounts::deposit_to_subaccount_at(p0, p1, p2, p3);
    }
    entry fun reactivate_subaccount(p0: &signer, p1: object::Object<dex_accounts::Subaccount>) {
        dex_accounts::reactivate_subaccount(p0, p1);
    }
    entry fun revoke_all_delegations(p0: &signer, p1: object::Object<dex_accounts::Subaccount>) {
        dex_accounts::revoke_all_delegations(p0, p1);
    }
    entry fun revoke_delegation(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: address) {
        dex_accounts::revoke_delegation(p0, p1, p2);
    }
    entry fun transfer_collateral_between_subaccounts(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: object::Object<dex_accounts::Subaccount>, p3: object::Object<fungible_asset::Metadata>, p4: u64) {
        dex_accounts::transfer_collateral_between_subaccounts(p0, p1, p2, p3, p4);
    }
    entry fun withdraw_from_subaccount(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: object::Object<fungible_asset::Metadata>, p3: u64) {
        let _v0 = dex_accounts::withdraw_from_subaccount(p0, p1, p2, p3);
    }
    entry fun contribute_to_vault(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: address, p3: object::Object<fungible_asset::Metadata>, p4: u64) {
        dex_accounts_vault_extension::contribute_to_vault(p0, p1, p2, p3, p4);
    }
    entry fun redeem_from_vault(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: address, p3: u64) {
        let _v0 = dex_accounts_vault_extension::redeem_from_vault(p0, p1, p2, p3);
    }
    entry fun add_delegated_trader_and_deposit_to_subaccount(p0: &signer, p1: address, p2: object::Object<fungible_asset::Metadata>, p3: u64, p4: address, p5: option::Option<u64>) {
        dex_accounts::deposit_to_subaccount_at(p0, p1, p2, p3);
        delegate_trading_to_for_subaccount(p0, p1, p4, p5);
    }
    entry fun approve_max_builder_fee_for_subaccount(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: address, p3: u64) {
        let _v0 = dex_accounts::get_subaccount_signer_if_owner(p0, p1);
        perp_engine_api::approve_max_fee(&_v0, p2, p3);
    }
    entry fun cancel_bulk_order_to_subaccount(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: object::Object<perp_market::PerpMarket>) {
        let _v0 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v1 = &_v0;
        order_apis::cancel_bulk_order(p2, _v1);
    }
    entry fun cancel_client_order_to_subaccount(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: string::String, p3: object::Object<perp_market::PerpMarket>) {
        let _v0 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p3);
        let _v1 = &_v0;
        order_apis::cancel_client_order(p3, _v1, p2);
    }
    entry fun cancel_order_to_subaccount(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: u128, p3: object::Object<perp_market::PerpMarket>) {
        dex_accounts::cancel_perp_order_to_subaccount(p0, p1, p2, p3);
    }
    entry fun cancel_twap_orders_to_subaccount(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: u128) {
        let _v0 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v1 = &_v0;
        let _v2 = order_book_types::new_order_id_type(p3);
        order_apis::cancel_twap_order(p2, _v1, _v2);
    }
    entry fun create_new_subaccount(p0: &signer) {
        let _v0 = dex_accounts::create_new_subaccount_object(p0);
    }
    entry fun place_bulk_orders_to_subaccount(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: vector<u64>, p5: vector<u64>, p6: vector<u64>, p7: vector<u64>, p8: option::Option<address>, p9: option::Option<u64>) {
        let _v0;
        let _v1 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v2 = p8;
        if (option::is_some<address>(&_v2)) {
            let _v3 = option::destroy_some<address>(_v2);
            let _v4 = option::destroy_some<u64>(p9);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v3, _v4))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v5 = &_v1;
        let _v6 = order_apis::place_bulk_order(p2, _v5, p3, p4, p5, p6, p7, _v0);
    }
    entry fun place_market_order_to_subaccount(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: bool, p5: bool, p6: option::Option<string::String>, p7: option::Option<u64>, p8: option::Option<u64>, p9: option::Option<u64>, p10: option::Option<u64>, p11: option::Option<u64>, p12: option::Option<address>, p13: option::Option<u64>) {
        let _v0;
        let _v1 = p12;
        if (option::is_some<address>(&_v1)) {
            let _v2 = option::destroy_some<address>(_v1);
            let _v3 = option::destroy_some<u64>(p13);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v2, _v3))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v4 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v5 = &_v4;
        let _v6 = perp_order::new_order_tp_sl_args(p8, p9, p10, p11);
        let _v7 = order_apis::place_market_order(p2, _v5, p3, p4, p5, p6, p7, _v6, _v0);
    }
    entry fun place_order_to_subaccount(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: u64, p5: bool, p6: u8, p7: bool, p8: option::Option<string::String>, p9: option::Option<u64>, p10: option::Option<u64>, p11: option::Option<u64>, p12: option::Option<u64>, p13: option::Option<u64>, p14: option::Option<address>, p15: option::Option<u64>) {
        let _v0;
        let _v1 = order_book_types::time_in_force_from_index(p6);
        let _v2 = perp_order::new_order_common_args(p3, p4, p5, _v1, p8);
        let _v3 = perp_order::new_order_tp_sl_args(p10, p11, p12, p13);
        let _v4 = p14;
        if (option::is_some<address>(&_v4)) {
            let _v5 = option::destroy_some<address>(_v4);
            let _v6 = option::destroy_some<u64>(p15);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v5, _v6))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v7 = dex_accounts::place_perp_order_to_subaccount(p0, p1, p2, _v2, p7, p9, _v3, _v0);
    }
    entry fun place_twap_order_to_subaccount(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: bool, p5: bool, p6: u64, p7: u64, p8: option::Option<address>, p9: option::Option<u64>) {
        let _v0;
        let _v1 = p8;
        if (option::is_some<address>(&_v1)) {
            let _v2 = option::destroy_some<address>(_v1);
            let _v3 = option::destroy_some<u64>(p9);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v2, _v3))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v4 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v5 = &_v4;
        let _v6 = option::none<string::String>();
        let _v7 = order_apis::place_twap_order(p2, _v5, p3, p4, p5, _v6, p6, p7, _v0);
    }
    entry fun place_twap_order_to_subaccount_v2(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: bool, p5: bool, p6: option::Option<string::String>, p7: u64, p8: u64, p9: option::Option<address>, p10: option::Option<u64>) {
        let _v0;
        let _v1 = p9;
        if (option::is_some<address>(&_v1)) {
            let _v2 = option::destroy_some<address>(_v1);
            let _v3 = option::destroy_some<u64>(p10);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v2, _v3))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v4 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v5 = &_v4;
        let _v6 = order_apis::place_twap_order(p2, _v5, p3, p4, p5, p6, p7, p8, _v0);
    }
    entry fun revoke_max_builder_fee_for_subaccount(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: address) {
        let _v0 = dex_accounts::get_subaccount_signer_if_owner(p0, p1);
        perp_engine_api::revoke_max_fee(&_v0, p2);
    }
    entry fun update_client_order_to_subaccount(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: string::String, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: u64, p6: bool, p7: u8, p8: bool, p9: option::Option<u64>, p10: option::Option<u64>, p11: option::Option<u64>, p12: option::Option<u64>, p13: option::Option<address>, p14: option::Option<u64>) {
        let _v0;
        let _v1 = p13;
        if (option::is_some<address>(&_v1)) {
            let _v2 = option::destroy_some<address>(_v1);
            let _v3 = option::destroy_some<u64>(p14);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v2, _v3))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v4 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p3);
        let _v5 = &_v4;
        let _v6 = order_book_types::time_in_force_from_index(p7);
        let _v7 = perp_order::new_order_tp_sl_args(p9, p10, p11, p12);
        order_apis::update_client_order(_v5, p2, p3, p4, p5, p6, _v6, p8, _v7, _v0);
    }
    entry fun update_order_to_subaccount(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: u128, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: u64, p6: bool, p7: u8, p8: bool, p9: option::Option<u64>, p10: option::Option<u64>, p11: option::Option<u64>, p12: option::Option<u64>, p13: option::Option<address>, p14: option::Option<u64>) {
        let _v0;
        let _v1 = p13;
        if (option::is_some<address>(&_v1)) {
            let _v2 = option::destroy_some<address>(_v1);
            let _v3 = option::destroy_some<u64>(p14);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v2, _v3))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v4 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p3);
        let _v5 = &_v4;
        let _v6 = order_book_types::new_order_id_type(p2);
        let _v7 = order_book_types::time_in_force_from_index(p7);
        let _v8 = perp_order::new_order_tp_sl_args(p9, p10, p11, p12);
        order_apis::update_order(_v5, _v6, p3, p4, p5, p6, _v7, p8, _v8, _v0);
    }
    entry fun update_sl_order_for_position(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: u128, p3: object::Object<perp_market::PerpMarket>, p4: option::Option<u64>, p5: option::Option<u64>, p6: option::Option<u64>) {
        let _v0 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p3);
        let _v1 = &_v0;
        let _v2 = order_book_types::new_order_id_type(p2);
        order_apis::cancel_tp_sl_order_for_position(p3, _v1, _v2);
        let _v3 = &_v0;
        let _v4 = option::none<u64>();
        let _v5 = option::none<u64>();
        let _v6 = option::none<u64>();
        let _v7 = option::none<builder_code_registry::BuilderCode>();
        let (_v8,_v9) = order_apis::place_tp_sl_order_for_position(p3, _v3, _v4, _v5, _v6, p4, p5, p6, _v7);
    }
    entry fun update_tp_order_for_position(p0: &signer, p1: object::Object<dex_accounts::Subaccount>, p2: u128, p3: object::Object<perp_market::PerpMarket>, p4: option::Option<u64>, p5: option::Option<u64>, p6: option::Option<u64>) {
        let _v0 = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p3);
        let _v1 = &_v0;
        let _v2 = order_book_types::new_order_id_type(p2);
        order_apis::cancel_tp_sl_order_for_position(p3, _v1, _v2);
        let _v3 = &_v0;
        let _v4 = option::none<u64>();
        let _v5 = option::none<u64>();
        let _v6 = option::none<u64>();
        let _v7 = option::none<builder_code_registry::BuilderCode>();
        let (_v8,_v9) = order_apis::place_tp_sl_order_for_position(p3, _v3, p4, p5, p6, _v4, _v5, _v6, _v7);
    }
}
