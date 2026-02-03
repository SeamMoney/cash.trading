module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::vault {
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book_types;
    use 0x1::fungible_asset;
    use 0x1::string;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::decibel_time;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::vault_share_asset;
    use 0x1::event;
    use 0x1::error;
    use 0x1::signer;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::vault_global_config;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::dex_accounts;
    use 0x1::math64;
    use 0x1::primary_fungible_store;
    use 0x1::option;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_view_types;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::slippage_math;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_order;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::builder_code_registry;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_vault_work;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::vault_api;
    enum ContributionEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            user: address,
            assets_contributed: u64,
            shares_received: u64,
            unlock_time_s: u64,
        }
    }
    enum Vault has key {
        V1 {
            admin: address,
            vault_ref: object::ExtendRef,
            contribution_asset_type: object::Object<fungible_asset::Metadata>,
            share_def: VaultShareDef,
            contribution_config: VaultContributionConfig,
            redemption_config: VaultRedemptionConfig,
            fee_config: VaultFeeConfig,
            fee_state: VaultFeeState,
            portfolio: VaultPortfolio,
        }
    }
    enum VaultShareDef has store {
        V1 {
            share_asset_type: object::Object<fungible_asset::Metadata>,
        }
    }
    enum VaultContributionConfig has store {
        V1 {
            max_outstanding_shares_when_contributing: u64,
            accepts_contributions: bool,
            contribution_lockup_duration_s: u64,
        }
    }
    enum VaultRedemptionConfig has store {
        V1 {
            use_global_redemption_slippage_adjustment: bool,
        }
    }
    enum VaultFeeConfig has store {
        V1 {
            fee_bps: u64,
            fee_recipient: address,
            fee_interval_s: u64,
        }
    }
    enum VaultFeeState has store {
        V1 {
            last_fee_distribution_time_s: u64,
            last_fee_distribution_nav: u64,
            last_fee_distribution_shares: u64,
            outstanding_fee_shares: i64,
        }
    }
    enum VaultPortfolio has drop, store {
        V1 {
            dex_primary_subaccount: address,
        }
    }
    enum ExternalCallbacks has key {
        V1,
    }
    enum FeeDistributionEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            fee_recipient: address,
            previous_nav: u64,
            previous_shares: u64,
            current_nav: u64,
            current_shares: u64,
            current_fee_amount: u64,
            accrued_during_period_fee_shares: i64,
            shares_received: u64,
            diluted_shares: u64,
            min_shares_for_manager: u64,
        }
    }
    enum ManagerRedeemptionRejectedEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            user: address,
            shares_tried_to_redeemed: u64,
            min_shares_for_manager: u64,
        }
    }
    struct OrderRef has copy, drop, store {
        market: object::Object<perp_market::PerpMarket>,
        order_id: order_book_types::OrderId,
    }
    enum RedeemptionInitiatedEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            user: address,
            shares_to_redeem: u64,
        }
    }
    enum RedeemptionSettledEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            user: address,
            shares_redeemed: u64,
            assets_received: u64,
            outstanding_fee_shares_paid: u64,
            slippage_adjustment_bps: u64,
        }
    }
    enum VaultActivatedEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            num_shares: u64,
            nav: u64,
        }
    }
    enum VaultAdminChangeRequest has key {
        V1 {
            proposed_admin: address,
        }
    }
    enum VaultAdminChangedEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            admin: address,
            new_admin: address,
        }
    }
    enum VaultContributionConfigUpdatedEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            max_outstanding_shares_when_contributing: u64,
            contribution_lockup_duration_s: u64,
        }
    }
    enum VaultCreatedEvent has drop, store {
        V1 {
            vault: address,
            creator: address,
            vault_name: string::String,
            vault_description: string::String,
            vault_social_links: vector<string::String>,
            vault_share_symbol: string::String,
            contribution_asset_type: object::Object<fungible_asset::Metadata>,
            share_asset_type: object::Object<fungible_asset::Metadata>,
            contribution_lockup_duration_s: u64,
            dex_primary_subaccount: address,
            fee_bps: u64,
            fee_recipient: address,
            fee_interval_s: u64,
        }
    }
    enum VaultFeeConfigUpdatedEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            fee_bps: u64,
            fee_recipient: address,
            fee_interval_s: u64,
        }
    }
    enum VaultMetadata has key {
        V1 {
            vault_name: string::String,
            vault_description: string::String,
            vault_social_links: vector<string::String>,
            vault_share_symbol: string::String,
        }
    }
    enum VaultRedemptionConfigUpdatedEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            use_global_redemption_slippage_adjustment: bool,
        }
    }
    fun init_module(p0: &signer) {
        register_external_callbacks(p0);
    }
    friend fun register_external_callbacks(p0: &signer) {
        let _v0 = ExternalCallbacks::V1{};
        move_to<ExternalCallbacks>(p0, _v0);
    }
    public entry fun distribute_fees(p0: object::Object<Vault>)
        acquires Vault
    {
        let _v0;
        let _v1;
        let _v2 = object::object_address<Vault>(&p0);
        let _v3 = borrow_global_mut<Vault>(_v2);
        assert!(*&(&_v3.contribution_config).accepts_contributions, 14566554180833181696);
        assert!(*&(&_v3.fee_config).fee_bps > 0, 15);
        let _v4 = &_v3.fee_config;
        let _v5 = *&(&_v3.fee_state).last_fee_distribution_time_s;
        let _v6 = decibel_time::now_seconds();
        let _v7 = _v6;
        let _v8 = *&_v4.fee_interval_s;
        let _v9 = _v5 + _v8;
        assert!(_v7 >= _v9, 8);
        _v9 = get_nav_in_contribution_asset(freeze(_v3));
        _v7 = get_num_shares(freeze(_v3));
        let _v10 = *&(&_v3.fee_state).last_fee_distribution_nav;
        let _v11 = *&(&_v3.fee_state).last_fee_distribution_shares;
        let _v12 = calculate_unrealized_fees(freeze(_v3), _v9, _v7);
        assert!(_v12 < _v9, 14566554180833181696);
        let _v13 = _v9 - _v12;
        if (!(_v13 != 0)) {
            let _v14 = error::invalid_argument(4);
            abort _v14
        };
        let _v15 = _v12 as u128;
        let _v16 = _v7 as u128;
        let _v17 = _v15 * _v16;
        let _v18 = _v13 as u128;
        let _v19 = ((_v17 / _v18) as u64) as i64;
        let _v20 = *&(&_v3.fee_state).outstanding_fee_shares;
        let _v21 = _v19 + _v20;
        if (_v21 > 0i64) {
            let _v22 = *&(&_v3.share_def).share_asset_type;
            let _v23 = *&_v4.fee_recipient;
            let _v24 = _v21 as u64;
            vault_share_asset::mint_and_deposit_without_lockup(_v22, _v23, _v24);
            _v1 = _v21 as u64;
            _v0 = 0
        } else {
            _v1 = 0;
            _v0 = (-_v21) as u64
        };
        let _v25 = freeze(_v3);
        let _v26 = _v7 + _v1;
        let _v27 = compute_min_shares_for_manager(_v25, _v26, _v9);
        let _v28 = *&(&_v3.share_def).share_asset_type;
        let _v29 = *&_v4.fee_recipient;
        let _v30 = vault_share_asset::update_manager_min_amount(_v28, _v29, _v27, true);
        let _v31 = *&_v4.fee_recipient;
        let _v32 = *&(&_v3.fee_state).outstanding_fee_shares;
        event::emit<FeeDistributionEvent>(FeeDistributionEvent::V1{vault: p0, fee_recipient: _v31, previous_nav: _v10, previous_shares: _v11, current_nav: _v9, current_shares: _v7, current_fee_amount: _v12, accrued_during_period_fee_shares: _v32, shares_received: _v1, diluted_shares: _v0, min_shares_for_manager: _v27});
        let _v33 = &mut (&mut _v3.fee_state).outstanding_fee_shares;
        *_v33 = 0i64;
        let _v34 = &mut (&mut _v3.fee_state).last_fee_distribution_nav;
        *_v34 = _v9;
        _v34 = &mut (&mut _v3.fee_state).last_fee_distribution_shares;
        *_v34 = _v7;
        _v34 = &mut (&mut _v3.fee_state).last_fee_distribution_time_s;
        *_v34 = _v6;
    }
    fun get_nav_in_contribution_asset(p0: &Vault): u64 {
        let _v0 = get_nav_in_primary_asset(p0);
        convert_asset_from_primary_to_contribution_asset(p0, _v0)
    }
    fun get_num_shares(p0: &Vault): u64 {
        let _v0 = option::destroy_some<u128>(fungible_asset::supply<fungible_asset::Metadata>(*&(&p0.share_def).share_asset_type)) as u64;
        if (*&(&p0.fee_state).outstanding_fee_shares < 0i64) {
            let _v1 = (-*&(&p0.fee_state).outstanding_fee_shares) as u64;
            assert!(_v0 >= _v1, 3);
            return _v0 - _v1
        };
        let _v2 = (*&(&p0.fee_state).outstanding_fee_shares) as u64;
        _v0 + _v2
    }
    fun calculate_unrealized_fees(p0: &Vault, p1: u64, p2: u64): u64 {
        let _v0 = *&(&p0.fee_config).fee_bps;
        'l0: loop {
            let _v1;
            let _v2;
            let _v3;
            'l1: loop {
                loop {
                    if (!(_v0 == 0)) {
                        let _v4 = *&(&p0.fee_state).last_fee_distribution_nav;
                        let _v5 = *&(&p0.fee_state).last_fee_distribution_shares;
                        assert!(_v5 > 0, 14566554180833181696);
                        if (p2 == 0) break;
                        let _v6 = p1 as u128;
                        let _v7 = _v5 as u128;
                        let _v8 = _v6 * _v7;
                        let _v9 = _v4 as u128;
                        let _v10 = p2 as u128;
                        let _v11 = _v9 * _v10;
                        if (!(_v8 > _v11)) break 'l0;
                        _v3 = _v4;
                        _v2 = p2;
                        _v1 = _v5;
                        if (_v1 != 0) break 'l1;
                        let _v12 = error::invalid_argument(4);
                        abort _v12
                    };
                    return 0
                };
                return 0
            };
            let _v13 = _v3 as u128;
            let _v14 = _v2 as u128;
            let _v15 = _v13 * _v14;
            let _v16 = _v1 as u128;
            let _v17 = (_v15 / _v16) as u64;
            _v17 = p1 - _v17;
            let _v18 = *&(&p0.fee_config).fee_bps;
            let _v19 = _v17 as u128;
            let _v20 = _v18 as u128;
            return (_v19 * _v20 / 10000u128) as u64
        };
        0
    }
    friend fun compute_min_shares_for_manager(p0: &Vault, p1: u64, p2: u64): u64 {
        let _v0;
        let _v1;
        loop {
            if (!(p1 == 0)) {
                let _v2 = vault_global_config::get_global_requirements_config();
                let _v3 = vault_global_config::get_min_manager_funds_amount(&_v2);
                _v3 = convert_asset_from_primary_to_contribution_asset(p0, _v3);
                if (_v3 > p2) _v1 = p1 else if (p2 != 0) {
                    let _v4 = p1 as u128;
                    let _v5 = _v3 as u128;
                    let _v6 = _v4 * _v5;
                    let _v7 = p2 as u128;
                    _v1 = (_v6 / _v7) as u64
                } else {
                    let _v8 = error::invalid_argument(4);
                    abort _v8
                };
                let _v9 = vault_global_config::get_min_manager_funds_fraction_bps(&_v2);
                let _v10 = p1 as u128;
                let _v11 = _v9 as u128;
                let _v12 = _v10 * _v11;
                if (_v12 == 0u128) {
                    _v0 = 0u128;
                    break
                };
                _v0 = (_v12 - 1u128) / 10000u128 + 1u128;
                break
            };
            return 0
        };
        let _v13 = _v0 as u64;
        math64::min(_v1, _v13)
    }
    friend fun activate_vault(p0: &signer, p1: object::Object<Vault>)
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global_mut<Vault>(_v0);
        let _v2 = freeze(_v1);
        let _v3 = signer::address_of(p0);
        let _v4 = *&_v2.admin;
        assert!(_v3 == _v4, 7);
        let _v5 = perp_engine::primary_asset_metadata();
        let _v6 = *&_v1.contribution_asset_type;
        assert!(_v5 == _v6, 9);
        if (*&(&_v1.contribution_config).accepts_contributions) abort 24;
        let _v7 = vault_global_config::get_global_requirements_config();
        let _v8 = get_nav_in_primary_asset(freeze(_v1));
        let _v9 = vault_global_config::get_min_funds_for_activation(&_v7);
        assert!(_v8 >= _v9, 19);
        let _v10 = &mut (&mut _v1.contribution_config).accepts_contributions;
        *_v10 = true;
        let _v11 = get_num_shares(freeze(_v1));
        let _v12 = convert_asset_from_primary_to_contribution_asset(freeze(_v1), _v8);
        assert!(_v12 > 0, 17);
        assert!(_v11 > 0, 18);
        event::emit<VaultActivatedEvent>(VaultActivatedEvent::V1{vault: p1, num_shares: _v11, nav: _v12});
        let _v13 = decibel_time::now_seconds();
        let _v14 = &mut (&mut _v1.fee_state).last_fee_distribution_time_s;
        *_v14 = _v13;
        let _v15 = &mut (&mut _v1.fee_state).last_fee_distribution_nav;
        *_v15 = _v12;
        _v15 = &mut (&mut _v1.fee_state).last_fee_distribution_shares;
        *_v15 = _v11;
    }
    fun get_nav_in_primary_asset(p0: &Vault): u64 {
        let _v0 = perp_engine::get_account_net_asset_value_fungible(*&(&p0.portfolio).dex_primary_subaccount, true);
        assert!(_v0 >= 0i64, 3);
        _v0 as u64
    }
    fun convert_asset_from_primary_to_contribution_asset(p0: &Vault, p1: u64): u64 {
        let _v0 = *&p0.contribution_asset_type;
        let _v1 = perp_engine::primary_asset_metadata();
        assert!(_v0 == _v1, 9);
        p1
    }
    friend entry fun approve_become_admin(p0: &signer, p1: object::Object<Vault>)
        acquires Vault, VaultAdminChangeRequest
    {
        let _v0 = object::object_address<Vault>(&p1);
        assert!(exists<VaultAdminChangeRequest>(_v0), 26);
        let VaultAdminChangeRequest::V1{proposed_admin: _v1} = move_from<VaultAdminChangeRequest>(_v0);
        let _v2 = _v1;
        let _v3 = signer::address_of(p0);
        assert!(_v2 == _v3, 26);
        let _v4 = *&borrow_global<Vault>(_v0).admin;
        let _v5 = &mut borrow_global_mut<Vault>(_v0).admin;
        *_v5 = _v2;
        event::emit<VaultAdminChangedEvent>(VaultAdminChangedEvent::V1{vault: p1, admin: _v4, new_admin: _v2});
    }
    friend entry fun cancel_admin_change_request(p0: &signer, p1: object::Object<Vault>)
        acquires Vault, VaultAdminChangeRequest
    {
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global<Vault>(_v0);
        let _v2 = signer::address_of(p0);
        let _v3 = *&_v1.admin;
        assert!(_v2 == _v3, 7);
        assert!(exists<VaultAdminChangeRequest>(_v0), 26);
        let VaultAdminChangeRequest::V1{proposed_admin: _v4} = move_from<VaultAdminChangeRequest>(_v0);
    }
    friend fun cancel_force_closing_order(p0: object::Object<Vault>, p1: object::Object<perp_market::PerpMarket>, p2: order_book_types::OrderId)
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p0);
        let _v1 = borrow_global<Vault>(_v0);
        let _v2 = object::generate_signer_for_extending(&_v1.vault_ref);
        let _v3 = &_v2;
        let _v4 = object::address_to_object<dex_accounts::Subaccount>(*&(&_v1.portfolio).dex_primary_subaccount);
        let _v5 = order_book_types::get_order_id_value(&p2);
        dex_accounts::cancel_perp_order_to_subaccount(_v3, _v4, _v5, p1);
    }
    friend fun contribute(p0: &signer, p1: address, p2: object::Object<Vault>, p3: u64)
        acquires Vault
    {
        assert!(p3 > 0, 12);
        let _v0 = object::object_address<Vault>(&p2);
        let _v1 = *&borrow_global<Vault>(_v0).contribution_asset_type;
        let _v2 = primary_fungible_store::withdraw<fungible_asset::Metadata>(p0, _v1, p3);
        let _v3 = borrow_global_mut<Vault>(_v0);
        contribute_verified_funds_internal(p1, p2, _v3, _v2);
    }
    fun contribute_verified_funds_internal(p0: address, p1: object::Object<Vault>, p2: &mut Vault, p3: fungible_asset::FungibleAsset) {
        let _v0;
        let _v1;
        let _v2;
        if (*&(&p2.fee_config).fee_recipient == p0) _v2 = true else _v2 = *&(&p2.contribution_config).accepts_contributions;
        assert!(_v2, 1);
        let _v3 = vault_global_config::get_global_requirements_config();
        let _v4 = fungible_asset::amount(&p3);
        let _v5 = vault_global_config::get_min_contribution_amount(&_v3);
        let _v6 = convert_asset_from_primary_to_contribution_asset(freeze(p2), _v5);
        assert!(_v4 >= _v6, 22);
        _v5 = get_num_shares(freeze(p2));
        if (_v5 == 0) _v1 = 0 else _v1 = get_nav_in_contribution_asset(freeze(p2));
        let (_v7,_v8) = convert_new_assets_to_share_count(freeze(p2), _v4, _v1, _v5);
        let _v9 = _v8;
        let _v10 = _v7;
        let _v11 = get_num_shares(freeze(p2));
        let _v12 = _v10 + _v11;
        let _v13 = *&(&p2.contribution_config).max_outstanding_shares_when_contributing;
        assert!(_v12 <= _v13, 16);
        assert!(_v10 > 0, 22);
        if (*&(&p2.contribution_config).accepts_contributions) {
            let _v14 = freeze(p2);
            let _v15 = _v5 + _v10 - _v9;
            let _v16 = fungible_asset::amount(&p3);
            let _v17 = _v1 + _v16;
            _v0 = compute_min_shares_for_manager(_v14, _v15, _v17);
            let _v18 = *&(&p2.share_def).share_asset_type;
            let _v19 = *&(&p2.fee_config).fee_recipient;
            assert!(vault_share_asset::update_manager_min_amount(_v18, _v19, _v0, false), 21)
        };
        let _v20 = object::generate_signer_for_extending(&p2.vault_ref);
        let _v21 = *&(&p2.portfolio).dex_primary_subaccount;
        let _v22 = *&(&p2.share_def).share_asset_type;
        let _v23 = option::some<address>(signer::address_of(&_v20));
        dex_accounts::deposit_funds_to_subaccount(_v21, p3, _v23);
        assert!(_v9 == 0, 23);
        let _v24 = *&(&p2.contribution_config).contribution_lockup_duration_s;
        _v0 = vault_share_asset::mint_and_deposit_with_lockup(_v22, p0, _v10, _v24);
        event::emit<ContributionEvent>(ContributionEvent::V1{vault: p1, user: p0, assets_contributed: _v4, shares_received: _v10, unlock_time_s: _v0});
    }
    friend fun contribute_funds(p0: address, p1: address, p2: fungible_asset::FungibleAsset)
        acquires Vault
    {
        let _v0 = borrow_global_mut<Vault>(p1);
        let _v1 = fungible_asset::metadata_from_asset(&p2);
        let _v2 = *&_v0.contribution_asset_type;
        assert!(_v1 == _v2, 2);
        assert!(fungible_asset::amount(&p2) > 0, 12);
        let _v3 = object::address_to_object<Vault>(p1);
        contribute_verified_funds_internal(p0, _v3, _v0, p2);
    }
    fun convert_new_assets_to_share_count(p0: &Vault, p1: u64, p2: u64, p3: u64): (u64, u64) {
        let _v0;
        let _v1;
        let _v2;
        loop {
            if (!(p3 == 0)) {
                assert!(p2 > 0, 11);
                _v2 = p1;
                _v1 = p3;
                _v0 = p2;
                if (_v0 != 0) break;
                let _v3 = error::invalid_argument(4);
                abort _v3
            };
            return (p1, 0)
        };
        let _v4 = _v2 as u128;
        let _v5 = _v1 as u128;
        let _v6 = _v4 * _v5;
        let _v7 = _v0 as u128;
        ((_v6 / _v7) as u64, 0)
    }
    fun convert_existing_shares_to_asset_amount(p0: &Vault, p1: u64, p2: u64, p3: u64): u64 {
        assert!(p3 >= p1, 10);
        let _v0 = p3;
        if (!(_v0 != 0)) {
            let _v1 = error::invalid_argument(4);
            abort _v1
        };
        let _v2 = p1 as u128;
        let _v3 = p2 as u128;
        let _v4 = _v2 * _v3;
        let _v5 = _v0 as u128;
        (_v4 / _v5) as u64
    }
    friend fun create_vault(p0: &signer, p1: option::Option<object::Object<dex_accounts::Subaccount>>, p2: object::Object<fungible_asset::Metadata>, p3: string::String, p4: string::String, p5: vector<string::String>, p6: string::String, p7: string::String, p8: string::String, p9: u64, p10: u64, p11: u64): (object::ConstructorRef, signer) {
        let _v0;
        let _v1;
        let _v2 = vault_global_config::get_global_fee_config();
        let _v3 = vault_global_config::get_creation_fee(&_v2);
        if (_v3 > 0) _v0 = vault_global_config::get_creation_fee_recipient(&_v2) != @0x0 else _v0 = false;
        if (_v0) {
            let _v4 = perp_engine::primary_asset_metadata();
            if (option::is_some<object::Object<dex_accounts::Subaccount>>(&p1)) {
                let _v5 = option::destroy_some<object::Object<dex_accounts::Subaccount>>(p1);
                let _v6 = dex_accounts::withdraw_from_subaccount(p0, _v5, _v4, _v3);
            };
            let _v7 = vault_global_config::get_creation_fee_recipient(&_v2);
            primary_fungible_store::transfer<fungible_asset::Metadata>(p0, _v4, _v7, _v3)
        };
        let _v8 = vault_global_config::create_new_vault_object(&p3);
        let _v9 = object::generate_extend_ref(&_v8);
        let _v10 = object::generate_signer_for_extending(&_v9);
        let _v11 = fungible_asset::decimals<fungible_asset::Metadata>(p2);
        let _v12 = VaultShareDef::V1{share_asset_type: vault_share_asset::create_vault_shares(&_v10, p3, p6, p7, p8, _v11)};
        if (option::is_some<object::Object<dex_accounts::Subaccount>>(&p1)) {
            let _v13 = option::destroy_some<object::Object<dex_accounts::Subaccount>>(p1);
            _v1 = object::object_address<dex_accounts::Subaccount>(&_v13)
        } else _v1 = signer::address_of(p0);
        vault_global_config::validate_contribution_lockup_duration(p11);
        let _v14 = signer::address_of(p0);
        let _v15 = VaultContributionConfig::V1{max_outstanding_shares_when_contributing: 18446744073709551615, accepts_contributions: false, contribution_lockup_duration_s: p11};
        let _v16 = VaultRedemptionConfig::V1{use_global_redemption_slippage_adjustment: false};
        let _v17 = create_vault_fee_config(p9, _v1, p10);
        let _v18 = create_vault_fee_state();
        let _v19 = create_vault_portfolio(&_v10);
        let _v20 = Vault::V1{admin: _v14, vault_ref: _v9, contribution_asset_type: p2, share_def: _v12, contribution_config: _v15, redemption_config: _v16, fee_config: _v17, fee_state: _v18, portfolio: _v19};
        let _v21 = VaultMetadata::V1{vault_name: p3, vault_description: p4, vault_social_links: p5, vault_share_symbol: p6};
        let _v22 = signer::address_of(&_v10);
        let _v23 = signer::address_of(p0);
        let _v24 = *&(&_v21).vault_name;
        let _v25 = *&(&_v21).vault_description;
        let _v26 = *&(&_v21).vault_social_links;
        let _v27 = *&(&_v21).vault_share_symbol;
        let _v28 = *&(&_v20).contribution_asset_type;
        let _v29 = *&(&(&_v20).share_def).share_asset_type;
        let _v30 = *&(&(&_v20).contribution_config).contribution_lockup_duration_s;
        let _v31 = *&(&(&_v20).portfolio).dex_primary_subaccount;
        let _v32 = *&(&(&_v20).fee_config).fee_recipient;
        let _v33 = *&(&(&_v20).fee_config).fee_bps;
        let _v34 = *&(&(&_v20).fee_config).fee_interval_s;
        event::emit<VaultCreatedEvent>(VaultCreatedEvent::V1{vault: _v22, creator: _v23, vault_name: _v24, vault_description: _v25, vault_social_links: _v26, vault_share_symbol: _v27, contribution_asset_type: _v28, share_asset_type: _v29, contribution_lockup_duration_s: _v30, dex_primary_subaccount: _v31, fee_bps: _v33, fee_recipient: _v32, fee_interval_s: _v34});
        let _v35 = &_v10;
        move_to<Vault>(_v35, _v20);
        let _v36 = &_v10;
        move_to<VaultMetadata>(_v36, _v21);
        (_v8, _v10)
    }
    fun create_vault_fee_config(p0: u64, p1: address, p2: u64): VaultFeeConfig {
        let _v0 = vault_global_config::get_global_fee_config();
        let _v1 = vault_global_config::get_max_fee_bps(&_v0);
        assert!(p0 <= _v1, 4);
        loop {
            if (p0 == 0) {
                if (p2 == 0) break;
                abort 5
            };
            let _v2 = vault_global_config::get_min_fee_interval(&_v0);
            assert!(p2 >= _v2, 5);
            let _v3 = vault_global_config::get_max_fee_interval(&_v0);
            if (p2 <= _v3) break;
            abort 5
        };
        VaultFeeConfig::V1{fee_bps: p0, fee_recipient: p1, fee_interval_s: p2}
    }
    fun create_vault_fee_state(): VaultFeeState {
        VaultFeeState::V1{last_fee_distribution_time_s: 0, last_fee_distribution_nav: 0, last_fee_distribution_shares: 0, outstanding_fee_shares: 0i64}
    }
    fun create_vault_portfolio(p0: &signer): VaultPortfolio {
        VaultPortfolio::V1{dex_primary_subaccount: dex_accounts::primary_subaccount(signer::address_of(p0))}
    }
    friend entry fun delegate_dex_actions_to(p0: &signer, p1: object::Object<Vault>, p2: address, p3: option::Option<u64>)
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global<Vault>(_v0);
        let _v2 = signer::address_of(p0);
        let _v3 = *&_v1.admin;
        assert!(_v2 == _v3, 7);
        let _v4 = &_v1.vault_ref;
        let _v5 = *&(&_v1.portfolio).dex_primary_subaccount;
        dex_accounts::delegate_onchain_account_permissions(_v4, _v5, p2, true, false, true, true, p3);
    }
    friend fun get_max_withdrawable_amount(p0: object::Object<Vault>): u64
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p0);
        let _v1 = borrow_global<Vault>(_v0);
        let _v2 = *&(&_v1.portfolio).dex_primary_subaccount;
        let _v3 = *&_v1.contribution_asset_type;
        perp_engine::max_allowed_withdraw_fungible_amount(_v2, _v3)
    }
    public fun get_order_ref_market(p0: &OrderRef): object::Object<perp_market::PerpMarket> {
        *&p0.market
    }
    public fun get_order_ref_order_id(p0: &OrderRef): order_book_types::OrderId {
        *&p0.order_id
    }
    public fun get_vault_admin(p0: object::Object<Vault>): address
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p0);
        *&borrow_global<Vault>(_v0).admin
    }
    public fun get_vault_contribution_asset_type(p0: object::Object<Vault>): object::Object<fungible_asset::Metadata>
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p0);
        *&borrow_global<Vault>(_v0).contribution_asset_type
    }
    public fun get_vault_net_asset_value(p0: object::Object<Vault>): u64
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p0);
        get_nav_in_contribution_asset(borrow_global<Vault>(_v0))
    }
    public fun get_vault_num_shares(p0: object::Object<Vault>): u64
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p0);
        get_num_shares(borrow_global<Vault>(_v0))
    }
    public fun get_vault_portfolio_subaccounts(p0: object::Object<Vault>): vector<address>
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p0);
        let _v1 = *&(&borrow_global<Vault>(_v0).portfolio).dex_primary_subaccount;
        let _v2 = 0x1::vector::empty<address>();
        0x1::vector::push_back<address>(&mut _v2, _v1);
        _v2
    }
    public fun get_vault_share_asset_type(p0: object::Object<Vault>): object::Object<fungible_asset::Metadata>
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p0);
        *&(&borrow_global<Vault>(_v0).share_def).share_asset_type
    }
    friend fun lock_for_initated_redemption(p0: address, p1: object::Object<Vault>, p2: u64)
        acquires Vault
    {
        event::emit<RedeemptionInitiatedEvent>(RedeemptionInitiatedEvent::V1{vault: p1, user: p0, shares_to_redeem: p2});
        let _v0 = object::object_address<Vault>(&p1);
        vault_share_asset::lock_for_redemption(*&(&borrow_global<Vault>(_v0).share_def).share_asset_type, p0, p2);
    }
    friend fun place_force_closing_order(p0: object::Object<Vault>, p1: address, p2: object::Object<perp_market::PerpMarket>): option::Option<OrderRef>
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p0);
        let _v1 = object::generate_signer_for_extending(&borrow_global<Vault>(_v0).vault_ref);
        let _v2 = vault_global_config::get_global_requirements_config();
        let _v3 = vault_global_config::get_closing_size_bps(&_v2);
        let _v4 = vault_global_config::get_closing_max_slippage_bps(&_v2);
        let _v5 = perp_engine::view_position(p1, p2);
        if (option::is_some<position_view_types::PositionViewInfo>(&_v5)) {
            let _v6 = option::destroy_some<position_view_types::PositionViewInfo>(_v5);
            let _v7 = position_view_types::get_position_info_size(&_v6);
            if (_v7 != 0) {
                let _v8 = !position_view_types::get_position_info_is_long(&_v6);
                let _v9 = perp_engine::get_mark_price(p2);
                let _v10 = slippage_math::compute_limit_price_with_slippage(p2, _v9, _v4, 10000, _v8);
                let _v11 = _v7 * _v3 / 10000;
                let _v12 = &_v1;
                let _v13 = object::address_to_object<dex_accounts::Subaccount>(p1);
                let _v14 = position_view_types::get_position_info_market(&_v6);
                let _v15 = order_book_types::good_till_cancelled();
                let _v16 = option::none<string::String>();
                let _v17 = perp_order::new_order_common_args(_v10, _v11, _v8, _v15, _v16);
                let _v18 = option::none<u64>();
                let _v19 = perp_order::new_empty_order_tp_sl_args();
                let _v20 = option::none<builder_code_registry::BuilderCode>();
                let _v21 = dex_accounts::place_perp_order_to_subaccount(_v12, _v13, _v14, _v17, true, _v18, _v19, _v20);
                return option::some<OrderRef>(OrderRef{market: p2, order_id: _v21})
            }
        };
        option::none<OrderRef>()
    }
    friend entry fun request_admin_change(p0: &signer, p1: object::Object<Vault>, p2: address)
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global<Vault>(_v0);
        let _v2 = signer::address_of(p0);
        let _v3 = *&_v1.admin;
        assert!(_v2 == _v3, 7);
        let _v4 = object::generate_signer_for_extending(&_v1.vault_ref);
        let _v5 = &_v4;
        let _v6 = VaultAdminChangeRequest::V1{proposed_admin: p2};
        move_to<VaultAdminChangeRequest>(_v5, _v6);
    }
    friend fun try_complete_redemption(p0: address, p1: object::Object<Vault>, p2: u64, p3: bool, p4: bool): bool
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global_mut<Vault>(_v0);
        let _v2 = get_nav_in_contribution_asset(freeze(_v1));
        let _v3 = get_num_shares(freeze(_v1));
        let _v4 = calculate_unrealized_fees(freeze(_v1), _v2, _v3);
        let _v5 = _v2;
        if (!(_v5 != 0)) {
            let _v6 = error::invalid_argument(4);
            abort _v6
        };
        let _v7 = p2 as u128;
        let _v8 = _v4 as u128;
        let _v9 = _v7 * _v8;
        let _v10 = _v5 as u128;
        let _v11 = (_v9 / _v10) as u64;
        let _v12 = p2 - _v11;
        _v12 = convert_existing_shares_to_asset_amount(freeze(_v1), _v12, _v2, _v3);
        assert!(_v12 > 0, 14);
        let _v13 = *&(&_v1.portfolio).dex_primary_subaccount;
        let _v14 = *&_v1.contribution_asset_type;
        let _v15 = perp_engine::max_allowed_withdraw_fungible_amount(_v13, _v14);
        assert!(_v15 <= _v2, 25);
        'l0: loop {
            let _v16;
            loop {
                if (!(_v12 > _v15)) {
                    let (_v17,_v18) = vault_global_config::adjust_redemption_amount_and_get_adjustment_bps(*&(&_v1.redemption_config).use_global_redemption_slippage_adjustment, _v12, _v15, _v2, p4);
                    let _v19 = _v17;
                    let _v20 = freeze(_v1);
                    let _v21 = _v3 - p2;
                    let _v22 = _v2 - _v19;
                    _v16 = compute_min_shares_for_manager(_v20, _v21, _v22);
                    let _v23 = *&(&_v1.fee_config).fee_recipient;
                    let _v24 = p0 == _v23;
                    let _v25 = *&(&_v1.share_def).share_asset_type;
                    let _v26 = *&(&_v1.fee_config).fee_recipient;
                    let _v27 = vault_share_asset::update_manager_min_amount(_v25, _v26, _v16, !_v24);
                    if (_v24) _v24 = !_v27 else _v24 = false;
                    if (_v24) break;
                    if (_v11 > 0) {
                        let _v28 = _v11 as i64;
                        let _v29 = &mut (&mut _v1.fee_state).outstanding_fee_shares;
                        *_v29 = *_v29 + _v28
                    };
                    event::emit<RedeemptionSettledEvent>(RedeemptionSettledEvent::V1{vault: p1, user: p0, shares_redeemed: p2, assets_received: _v19, outstanding_fee_shares_paid: _v11, slippage_adjustment_bps: _v18});
                    let _v30 = &_v1.vault_ref;
                    let _v31 = object::address_to_object<dex_accounts::Subaccount>(*&(&_v1.portfolio).dex_primary_subaccount);
                    let _v32 = *&_v1.contribution_asset_type;
                    let _v33 = dex_accounts::withdraw_onchain_account_funds_from_subaccount(_v30, _v31, _v32, _v19);
                    vault_share_asset::burn_redeemed_shares_from(*&(&_v1.share_def).share_asset_type, p0, p2);
                    if (p3) {
                        let _v34 = option::none<address>();
                        dex_accounts::deposit_funds_to_subaccount(p0, _v33, _v34);
                        break 'l0
                    };
                    primary_fungible_store::deposit(p0, _v33);
                    break 'l0
                };
                return false
            };
            event::emit<ManagerRedeemptionRejectedEvent>(ManagerRedeemptionRejectedEvent::V1{vault: p1, user: p0, shares_tried_to_redeemed: p2, min_shares_for_manager: _v16});
            return true
        };
        true
    }
    friend entry fun update_vault_fee_recipient_and_manager(p0: &signer, p1: object::Object<Vault>, p2: address)
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global_mut<Vault>(_v0);
        let _v2 = freeze(_v1);
        let _v3 = signer::address_of(p0);
        let _v4 = *&_v2.admin;
        assert!(_v3 == _v4, 7);
        let _v5 = *&(&_v1.share_def).share_asset_type;
        let _v6 = *&(&_v1.fee_config).fee_recipient;
        assert!(vault_share_asset::update_manager_min_amount(_v5, _v6, 0, true), 14566554180833181696);
        let _v7 = get_num_shares(freeze(_v1));
        let _v8 = get_nav_in_contribution_asset(freeze(_v1));
        _v7 = compute_min_shares_for_manager(freeze(_v1), _v7, _v8);
        assert!(vault_share_asset::update_manager_min_amount(*&(&_v1.share_def).share_asset_type, p2, _v7, true), 20);
        let _v9 = &mut (&mut _v1.fee_config).fee_recipient;
        *_v9 = p2;
        let _v10 = *&(&_v1.fee_config).fee_bps;
        let _v11 = *&(&_v1.fee_config).fee_interval_s;
        event::emit<VaultFeeConfigUpdatedEvent>(VaultFeeConfigUpdatedEvent::V1{vault: p1, fee_bps: _v10, fee_recipient: p2, fee_interval_s: _v11});
    }
    friend entry fun update_vault_max_outstanding_shares(p0: &signer, p1: object::Object<Vault>, p2: u64)
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global_mut<Vault>(_v0);
        let _v2 = freeze(_v1);
        let _v3 = signer::address_of(p0);
        let _v4 = *&_v2.admin;
        assert!(_v3 == _v4, 7);
        let _v5 = &mut (&mut _v1.contribution_config).max_outstanding_shares_when_contributing;
        *_v5 = p2;
        let _v6 = *&(&_v1.contribution_config).contribution_lockup_duration_s;
        event::emit<VaultContributionConfigUpdatedEvent>(VaultContributionConfigUpdatedEvent::V1{vault: p1, max_outstanding_shares_when_contributing: p2, contribution_lockup_duration_s: _v6});
    }
    friend entry fun update_vault_use_global_redemption_slippage_adjustment(p0: &signer, p1: object::Object<Vault>, p2: bool)
        acquires Vault
    {
        assert!(signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88, 6);
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global_mut<Vault>(_v0);
        event::emit<VaultRedemptionConfigUpdatedEvent>(VaultRedemptionConfigUpdatedEvent::V1{vault: p1, use_global_redemption_slippage_adjustment: p2});
        let _v2 = &mut (&mut _v1.redemption_config).use_global_redemption_slippage_adjustment;
        *_v2 = p2;
    }
}
