module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::vault {
    use 0x1::object;
    use 0x1::fungible_asset;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_market;
    use 0x1b3fa27b03773a4265a09b292c5059da10b4ae8a3dbd2972245c7504e89f52e7::order_book_types;
    use 0x1::string;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::decibel_time;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::vault_share_asset;
    use 0x1::event;
    use 0x1::error;
    use 0x1::signer;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_engine;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::vault_global_config;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::dex_accounts;
    use 0x1::primary_fungible_store;
    use 0x1::option;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::position_view_types;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::slippage_math;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::async_vault_work;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::vault_api;
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
        }
    }
    enum VaultPortfolio has drop, store {
        V1 {
            dex_primary_subaccount: address,
        }
    }
    enum ExternalCallbacks has key {
        V1 {
            deposit_funds_to_dex_f: |address, fungible_asset::FungibleAsset| has copy + drop + store,
        }
    }
    enum FeeDistributionEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            fee_recipient: address,
            previous_nav: u64,
            previous_shares: u64,
            current_nav: u64,
            current_shares: u64,
            fee_amount: u64,
            shares_received: u64,
        }
    }
    struct OrderRef has copy, drop, store {
        market: object::Object<perp_market::PerpMarket>,
        order_id: order_book_types::OrderIdType,
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
        }
    }
    enum VaultActivatedEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            num_shares: u64,
            nav: u64,
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
            vault: object::Object<Vault>,
            creator: address,
            vault_name: string::String,
            vault_description: string::String,
            vault_social_links: vector<string::String>,
            vault_share_symbol: string::String,
            contribution_asset_type: object::Object<fungible_asset::Metadata>,
            share_asset_type: object::Object<fungible_asset::Metadata>,
            fee_bps: u64,
            fee_interval_s: u64,
            contribution_lockup_duration_s: u64,
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
        }
    }
    fun init_module(p0: &signer) {
        register_external_callbacks(p0);
    }
    friend fun register_external_callbacks(p0: &signer) {
        let _v0 = ExternalCallbacks::V1{deposit_funds_to_dex_f: dex_accounts::get_deposit_funds_to_subaccount_address_method(p0)};
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
        if (!(*&(&_v3.fee_config).fee_bps > 0)) {
            let _v4 = error::invalid_argument(15);
            abort _v4
        };
        let _v5 = &_v3.fee_config;
        let _v6 = *&(&_v3.fee_state).last_fee_distribution_time_s;
        let _v7 = decibel_time::now_seconds();
        let _v8 = _v7;
        let _v9 = *&_v5.fee_interval_s;
        let _v10 = _v6 + _v9;
        if (!(_v8 >= _v10)) {
            let _v11 = error::invalid_argument(8);
            abort _v11
        };
        _v10 = get_nav_in_contribution_asset(freeze(_v3));
        _v8 = get_num_shares(freeze(_v3));
        let _v12 = *&(&_v3.fee_state).last_fee_distribution_nav;
        let _v13 = *&(&_v3.fee_state).last_fee_distribution_shares;
        assert!(_v8 > 0, 14566554180833181696);
        assert!(_v13 > 0, 14566554180833181696);
        let _v14 = _v10 as u128;
        let _v15 = _v13 as u128;
        let _v16 = _v14 * _v15;
        let _v17 = _v12 as u128;
        let _v18 = _v8 as u128;
        let _v19 = _v17 * _v18;
        if (_v16 > _v19) {
            let _v20;
            let _v21;
            if (_v8 > _v13) {
                _v21 = _v8;
                if (!(_v21 != 0)) {
                    let _v22 = error::invalid_argument(4);
                    abort _v22
                };
                let _v23 = _v10 as u128;
                let _v24 = _v13 as u128;
                let _v25 = _v23 * _v24;
                let _v26 = _v21 as u128;
                _v20 = ((_v25 / _v26) as u64) - _v12
            } else {
                _v21 = _v13;
                if (_v21 != 0) {
                    let _v27 = _v12 as u128;
                    let _v28 = _v8 as u128;
                    let _v29 = _v27 * _v28;
                    let _v30 = _v21 as u128;
                    let _v31 = (_v29 / _v30) as u64;
                    _v20 = _v10 - _v31
                } else {
                    let _v32 = error::invalid_argument(4);
                    abort _v32
                }
            };
            let _v33 = *&_v5.fee_bps;
            let _v34 = _v20 as u128;
            let _v35 = _v33 as u128;
            let _v36 = (_v34 * _v35 / 10000u128) as u64;
            if (_v36 > 0) {
                let _v37 = _v10 - _v36;
                if (_v37 != 0) {
                    let _v38 = _v36 as u128;
                    let _v39 = _v8 as u128;
                    let _v40 = _v38 * _v39;
                    let _v41 = _v37 as u128;
                    _v0 = (_v40 / _v41) as u64;
                    if (_v0 > 0) {
                        let _v42 = *&(&_v3.share_def).share_asset_type;
                        let _v43 = *&_v5.fee_recipient;
                        vault_share_asset::mint_and_deposit_without_lockup(_v42, _v43, _v0)
                    };
                    _v1 = _v36
                } else {
                    let _v44 = error::invalid_argument(4);
                    abort _v44
                }
            } else {
                _v1 = 0;
                _v0 = 0
            }
        } else {
            _v1 = 0;
            _v0 = 0
        };
        let _v45 = *&_v5.fee_recipient;
        event::emit<FeeDistributionEvent>(FeeDistributionEvent::V1{vault: p0, fee_recipient: _v45, previous_nav: _v12, previous_shares: _v13, current_nav: _v10, current_shares: _v8, fee_amount: _v1, shares_received: _v0});
        let _v46 = &mut (&mut _v3.fee_state).last_fee_distribution_nav;
        *_v46 = _v10;
        _v46 = &mut (&mut _v3.fee_state).last_fee_distribution_shares;
        *_v46 = _v8;
        _v46 = &mut (&mut _v3.fee_state).last_fee_distribution_time_s;
        *_v46 = _v7;
    }
    fun get_nav_in_contribution_asset(p0: &Vault): u64 {
        let _v0 = get_nav_in_primary_asset(p0);
        convert_nav_from_primary_to_contribution_asset(p0, _v0)
    }
    fun get_num_shares(p0: &Vault): u64 {
        option::destroy_some<u128>(fungible_asset::supply<fungible_asset::Metadata>(*&(&p0.share_def).share_asset_type)) as u64
    }
    public entry fun activate_vault(p0: &signer, p1: object::Object<Vault>, p2: u64)
        acquires Vault
    {
        if (p2 > 0) contribute(p0, p1, p2);
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global_mut<Vault>(_v0);
        let _v2 = freeze(_v1);
        let _v3 = signer::address_of(p0);
        let _v4 = *&_v2.admin;
        if (!(_v3 == _v4)) {
            let _v5 = error::invalid_argument(7);
            abort _v5
        };
        let _v6 = perp_engine::primary_asset_metadata();
        let _v7 = *&_v1.contribution_asset_type;
        if (!(_v6 == _v7)) {
            let _v8 = error::invalid_argument(9);
            abort _v8
        };
        let _v9 = vault_global_config::get_global_requirements_config();
        p2 = get_nav_in_primary_asset(freeze(_v1));
        let _v10 = vault_global_config::get_min_funds_for_activation(&_v9);
        if (!(p2 >= _v10)) {
            let _v11 = error::invalid_argument(19);
            abort _v11
        };
        let _v12 = &mut (&mut _v1.contribution_config).accepts_contributions;
        *_v12 = true;
        let _v13 = get_num_shares(freeze(_v1));
        let _v14 = convert_nav_from_primary_to_contribution_asset(freeze(_v1), p2);
        if (!(_v14 > 0)) {
            let _v15 = error::invalid_argument(17);
            abort _v15
        };
        if (!(_v13 > 0)) {
            let _v16 = error::invalid_argument(18);
            abort _v16
        };
        event::emit<VaultActivatedEvent>(VaultActivatedEvent::V1{vault: p1, num_shares: _v13, nav: _v14});
        let _v17 = decibel_time::now_seconds();
        let _v18 = &mut (&mut _v1.fee_state).last_fee_distribution_time_s;
        *_v18 = _v17;
        let _v19 = &mut (&mut _v1.fee_state).last_fee_distribution_nav;
        *_v19 = _v14;
        _v19 = &mut (&mut _v1.fee_state).last_fee_distribution_shares;
        *_v19 = _v13;
    }
    friend fun contribute(p0: &signer, p1: object::Object<Vault>, p2: u64)
        acquires Vault
    {
        assert!(p2 > 0, 12);
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global<Vault>(_v0);
        let _v2 = *&_v1.contribution_asset_type;
        let _v3 = primary_fungible_store::withdraw<fungible_asset::Metadata>(p0, _v2, p2);
        contribute_verified_funds_internal(p0, p1, _v1, _v3);
    }
    fun get_nav_in_primary_asset(p0: &Vault): u64 {
        let _v0 = perp_engine::get_account_net_asset_value_fungible(*&(&p0.portfolio).dex_primary_subaccount, true);
        if (!(_v0 >= 0i64)) {
            let _v1 = error::invalid_argument(3);
            abort _v1
        };
        _v0 as u64
    }
    fun convert_nav_from_primary_to_contribution_asset(p0: &Vault, p1: u64): u64 {
        p1
    }
    friend fun cancel_force_closing_order(p0: object::Object<Vault>, p1: object::Object<perp_market::PerpMarket>, p2: order_book_types::OrderIdType)
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p0);
        let _v1 = borrow_global<Vault>(_v0);
        let _v2 = object::generate_signer_for_extending(&_v1.vault_ref);
        let _v3 = &_v2;
        let _v4 = object::address_to_object<dex_accounts::Subaccount>(*&(&_v1.portfolio).dex_primary_subaccount);
        let _v5 = order_book_types::get_order_id_value(&p2);
        dex_accounts::cancel_order_to_subaccount(_v3, _v4, _v5, p1);
    }
    public entry fun change_admin(p0: &signer, p1: object::Object<Vault>, p2: address)
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global_mut<Vault>(_v0);
        let _v2 = freeze(_v1);
        let _v3 = signer::address_of(p0);
        let _v4 = *&_v2.admin;
        if (!(_v3 == _v4)) {
            let _v5 = error::invalid_argument(7);
            abort _v5
        };
        let _v6 = &mut _v1.admin;
        *_v6 = p2;
        let _v7 = signer::address_of(p0);
        event::emit<VaultAdminChangedEvent>(VaultAdminChangedEvent::V1{vault: p1, admin: _v7, new_admin: p2});
    }
    fun contribute_verified_funds_internal(p0: &signer, p1: object::Object<Vault>, p2: &Vault, p3: fungible_asset::FungibleAsset) {
        let _v0;
        let _v1 = *&p2.admin;
        let _v2 = signer::address_of(p0);
        if (_v1 == _v2) _v0 = true else _v0 = *&(&p2.contribution_config).accepts_contributions;
        assert!(_v0, 1);
        let _v3 = fungible_asset::amount(&p3);
        let _v4 = convert_new_assets_to_share_count(p2, _v3);
        let _v5 = get_num_shares(p2);
        let _v6 = _v4 + _v5;
        let _v7 = *&(&p2.contribution_config).max_outstanding_shares_when_contributing;
        assert!(_v6 <= _v7, 16);
        let _v8 = object::generate_signer_for_extending(&p2.vault_ref);
        let _v9 = &_v8;
        let _v10 = *&(&p2.portfolio).dex_primary_subaccount;
        dex_accounts::deposit_funds_to_subaccount_at(_v9, _v10, p3);
        let _v11 = *&(&p2.share_def).share_asset_type;
        let _v12 = signer::address_of(p0);
        let _v13 = vault_share_asset::mint_and_deposit_with_lockup(_v11, _v12, _v4);
        let _v14 = signer::address_of(p0);
        event::emit<ContributionEvent>(ContributionEvent::V1{vault: p1, user: _v14, assets_contributed: _v3, shares_received: _v4, unlock_time_s: _v13});
    }
    friend fun contribute_funds(p0: &signer, p1: address, p2: fungible_asset::FungibleAsset)
        acquires Vault
    {
        let _v0 = borrow_global<Vault>(p1);
        let _v1 = fungible_asset::metadata_from_asset(&p2);
        let _v2 = *&_v0.contribution_asset_type;
        assert!(_v1 == _v2, 2);
        assert!(fungible_asset::amount(&p2) > 0, 12);
        let _v3 = object::address_to_object<Vault>(p1);
        contribute_verified_funds_internal(p0, _v3, _v0, p2);
    }
    fun convert_new_assets_to_share_count(p0: &Vault, p1: u64): u64 {
        let _v0;
        let _v1;
        let _v2;
        let _v3 = get_num_shares(p0);
        loop {
            if (!(_v3 == 0)) {
                let _v4 = get_nav_in_contribution_asset(p0);
                if (!(_v4 > 0)) {
                    let _v5 = error::invalid_argument(11);
                    abort _v5
                };
                _v2 = p1;
                _v1 = _v3;
                _v0 = _v4;
                if (_v0 != 0) break;
                let _v6 = error::invalid_argument(4);
                abort _v6
            };
            return p1
        };
        let _v7 = _v2 as u128;
        let _v8 = _v1 as u128;
        let _v9 = _v7 * _v8;
        let _v10 = _v0 as u128;
        (_v9 / _v10) as u64
    }
    fun convert_existing_shares_to_asset_amount(p0: &Vault, p1: u64): u64 {
        let _v0 = get_num_shares(p0);
        if (!(_v0 >= p1)) {
            let _v1 = error::invalid_argument(10);
            abort _v1
        };
        let _v2 = get_nav_in_contribution_asset(p0);
        let _v3 = _v0;
        if (!(_v3 != 0)) {
            let _v4 = error::invalid_argument(4);
            abort _v4
        };
        let _v5 = p1 as u128;
        let _v6 = _v2 as u128;
        let _v7 = _v5 * _v6;
        let _v8 = _v3 as u128;
        (_v7 / _v8) as u64
    }
    friend fun create_vault(p0: &signer, p1: option::Option<object::Object<dex_accounts::Subaccount>>, p2: object::Object<fungible_asset::Metadata>, p3: string::String, p4: string::String, p5: vector<string::String>, p6: string::String, p7: string::String, p8: string::String, p9: u64, p10: u64, p11: u64): (object::ConstructorRef, signer) {
        let _v0;
        let _v1;
        let _v2 = vault_global_config::get_global_fee_config();
        let _v3 = vault_global_config::get_creation_fee(&_v2);
        if (_v3 > 0) _v1 = vault_global_config::get_creation_fee_recipient(&_v2) != @0x0 else _v1 = false;
        if (_v1) {
            let _v4;
            let _v5 = perp_engine::primary_asset_metadata();
            if (option::is_some<object::Object<dex_accounts::Subaccount>>(&p1)) _v4 = primary_fungible_store::balance<fungible_asset::Metadata>(signer::address_of(p0), _v5) < _v3 else _v4 = false;
            if (_v4) {
                let _v6 = option::destroy_some<object::Object<dex_accounts::Subaccount>>(p1);
                let _v7 = dex_accounts::withdraw_from_subaccount_request(p0, _v6, _v5, _v3);
            };
            let _v8 = vault_global_config::get_creation_fee_recipient(&_v2);
            primary_fungible_store::transfer<fungible_asset::Metadata>(p0, _v5, _v8, _v3)
        };
        let _v9 = vault_global_config::create_new_vault_object(&p3);
        let _v10 = object::generate_extend_ref(&_v9);
        let _v11 = object::generate_signer_for_extending(&_v10);
        let _v12 = fungible_asset::decimals<fungible_asset::Metadata>(p2);
        let _v13 = vault_share_asset::create_vault_shares(&_v11, p3, p6, p7, p8, _v12, p11);
        let _v14 = VaultShareDef::V1{share_asset_type: _v13};
        if (option::is_some<object::Object<dex_accounts::Subaccount>>(&p1)) {
            let _v15 = option::destroy_some<object::Object<dex_accounts::Subaccount>>(p1);
            _v0 = object::object_address<dex_accounts::Subaccount>(&_v15)
        } else _v0 = signer::address_of(p0);
        let _v16 = &_v11;
        let _v17 = signer::address_of(p0);
        let _v18 = VaultContributionConfig::V1{max_outstanding_shares_when_contributing: 18446744073709551615, accepts_contributions: false, contribution_lockup_duration_s: p11};
        let _v19 = create_vault_fee_config(p9, _v0, p10);
        let _v20 = create_vault_fee_state();
        let _v21 = create_vault_portfolio(&_v11);
        let _v22 = Vault::V1{admin: _v17, vault_ref: _v10, contribution_asset_type: p2, share_def: _v14, contribution_config: _v18, fee_config: _v19, fee_state: _v20, portfolio: _v21};
        move_to<Vault>(_v16, _v22);
        let _v23 = &_v11;
        let _v24 = VaultMetadata::V1{vault_name: p3, vault_description: p4, vault_social_links: p5};
        move_to<VaultMetadata>(_v23, _v24);
        let _v25 = object::object_from_constructor_ref<Vault>(&_v9);
        let _v26 = signer::address_of(p0);
        event::emit<VaultCreatedEvent>(VaultCreatedEvent::V1{vault: _v25, creator: _v26, vault_name: p3, vault_description: p4, vault_social_links: p5, vault_share_symbol: p6, contribution_asset_type: p2, share_asset_type: _v13, fee_bps: p9, fee_interval_s: p10, contribution_lockup_duration_s: p11});
        (_v9, _v11)
    }
    fun create_vault_fee_config(p0: u64, p1: address, p2: u64): VaultFeeConfig {
        let _v0 = vault_global_config::get_global_fee_config();
        let _v1 = vault_global_config::get_max_fee_bps(&_v0);
        if (!(p0 <= _v1)) {
            let _v2 = error::invalid_argument(4);
            abort _v2
        };
        loop {
            if (p0 == 0) {
                if (p2 == 0) break;
                let _v3 = error::invalid_argument(5);
                abort _v3
            };
            let _v4 = vault_global_config::get_min_fee_interval(&_v0);
            if (!(p2 >= _v4)) {
                let _v5 = error::invalid_argument(5);
                abort _v5
            };
            let _v6 = vault_global_config::get_max_fee_interval(&_v0);
            if (p2 <= _v6) break;
            let _v7 = error::invalid_argument(5);
            abort _v7
        };
        VaultFeeConfig::V1{fee_bps: p0, fee_recipient: p1, fee_interval_s: p2}
    }
    fun create_vault_fee_state(): VaultFeeState {
        VaultFeeState::V1{last_fee_distribution_time_s: 0, last_fee_distribution_nav: 0, last_fee_distribution_shares: 0}
    }
    fun create_vault_portfolio(p0: &signer): VaultPortfolio {
        VaultPortfolio::V1{dex_primary_subaccount: dex_accounts::primary_subaccount(signer::address_of(p0))}
    }
    public entry fun delegate_dex_actions_to(p0: &signer, p1: object::Object<Vault>, p2: address, p3: option::Option<u64>)
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global<Vault>(_v0);
        let _v2 = signer::address_of(p0);
        let _v3 = *&_v1.admin;
        if (!(_v2 == _v3)) {
            let _v4 = error::invalid_argument(7);
            abort _v4
        };
        let _v5 = &_v1.vault_ref;
        let _v6 = *&(&_v1.portfolio).dex_primary_subaccount;
        dex_accounts::delegate_onchain_account_permissions(_v5, _v6, p2, true, false, true, true, p3);
    }
    public fun get_order_ref_market(p0: &OrderRef): object::Object<perp_market::PerpMarket> {
        *&p0.market
    }
    public fun get_order_ref_order_id(p0: &OrderRef): order_book_types::OrderIdType {
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
                _v4 = slippage_math::compute_limit_price_with_slippage(p2, _v9, _v4, 10000, _v8);
                _v3 = _v7 * _v3 / 10000;
                let _v10 = &_v1;
                let _v11 = object::address_to_object<dex_accounts::Subaccount>(p1);
                let _v12 = position_view_types::get_position_info_market(&_v6);
                let _v13 = order_book_types::good_till_cancelled();
                let _v14 = option::none<string::String>();
                let _v15 = option::none<u64>();
                let _v16 = option::none<u64>();
                let _v17 = option::none<u64>();
                let _v18 = option::none<u64>();
                let _v19 = option::none<u64>();
                let _v20 = option::none<address>();
                let _v21 = option::none<u64>();
                let _v22 = dex_accounts::place_order_to_subaccount_method(_v10, _v11, _v12, _v4, _v3, _v8, _v13, true, _v14, _v15, _v16, _v17, _v18, _v19, _v20, _v21);
                return option::some<OrderRef>(OrderRef{market: p2, order_id: _v22})
            }
        };
        option::none<OrderRef>()
    }
    friend fun try_complete_redemption(p0: address, p1: object::Object<Vault>, p2: u64, p3: bool): bool
        acquires ExternalCallbacks, Vault
    {
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global<Vault>(_v0);
        let _v2 = convert_existing_shares_to_asset_amount(_v1, p2);
        if (!(_v2 > 0)) {
            let _v3 = error::invalid_argument(14);
            abort _v3
        };
        let _v4 = *&(&_v1.portfolio).dex_primary_subaccount;
        let _v5 = *&_v1.contribution_asset_type;
        let _v6 = perp_engine::max_allowed_withdraw_fungible_amount(_v4, _v5);
        loop {
            if (!(_v2 > _v6)) {
                event::emit<RedeemptionSettledEvent>(RedeemptionSettledEvent::V1{vault: p1, user: p0, shares_redeemed: p2, assets_received: _v2});
                let _v7 = &_v1.vault_ref;
                let _v8 = object::address_to_object<dex_accounts::Subaccount>(*&(&_v1.portfolio).dex_primary_subaccount);
                let _v9 = *&_v1.contribution_asset_type;
                let _v10 = dex_accounts::withdraw_onchain_account_funds_from_subaccount(_v7, _v8, _v9, _v2);
                vault_share_asset::burn_redeemed_shares_from(*&(&_v1.share_def).share_asset_type, p0, p2);
                if (p3) {
                    let _v11 = *&borrow_global<ExternalCallbacks>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).deposit_funds_to_dex_f;
                    _v11(p0, _v10);
                    break
                };
                primary_fungible_store::deposit(p0, _v10);
                break
            };
            return false
        };
        true
    }
    public entry fun update_vault_contribution_lockup_duration(p0: &signer, p1: object::Object<Vault>, p2: u64)
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global_mut<Vault>(_v0);
        let _v2 = freeze(_v1);
        let _v3 = signer::address_of(p0);
        let _v4 = *&_v2.admin;
        if (!(_v3 == _v4)) {
            let _v5 = error::invalid_argument(7);
            abort _v5
        };
        let _v6 = &mut (&mut _v1.contribution_config).contribution_lockup_duration_s;
        *_v6 = p2;
        let _v7 = *&(&_v1.contribution_config).max_outstanding_shares_when_contributing;
        event::emit<VaultContributionConfigUpdatedEvent>(VaultContributionConfigUpdatedEvent::V1{vault: p1, max_outstanding_shares_when_contributing: _v7, contribution_lockup_duration_s: p2});
    }
    public entry fun update_vault_fee_recipient(p0: &signer, p1: object::Object<Vault>, p2: address)
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global_mut<Vault>(_v0);
        let _v2 = freeze(_v1);
        let _v3 = signer::address_of(p0);
        let _v4 = *&_v2.admin;
        if (!(_v3 == _v4)) {
            let _v5 = error::invalid_argument(7);
            abort _v5
        };
        let _v6 = &mut (&mut _v1.fee_config).fee_recipient;
        *_v6 = p2;
        let _v7 = *&(&_v1.fee_config).fee_bps;
        let _v8 = *&(&_v1.fee_config).fee_interval_s;
        event::emit<VaultFeeConfigUpdatedEvent>(VaultFeeConfigUpdatedEvent::V1{vault: p1, fee_bps: _v7, fee_recipient: p2, fee_interval_s: _v8});
    }
    public entry fun update_vault_max_outstanding_shares(p0: &signer, p1: object::Object<Vault>, p2: u64)
        acquires Vault
    {
        let _v0 = object::object_address<Vault>(&p1);
        let _v1 = borrow_global_mut<Vault>(_v0);
        let _v2 = freeze(_v1);
        let _v3 = signer::address_of(p0);
        let _v4 = *&_v2.admin;
        if (!(_v3 == _v4)) {
            let _v5 = error::invalid_argument(7);
            abort _v5
        };
        let _v6 = &mut (&mut _v1.contribution_config).max_outstanding_shares_when_contributing;
        *_v6 = p2;
        let _v7 = *&(&_v1.contribution_config).contribution_lockup_duration_s;
        event::emit<VaultContributionConfigUpdatedEvent>(VaultContributionConfigUpdatedEvent::V1{vault: p1, max_outstanding_shares_when_contributing: p2, contribution_lockup_duration_s: _v7});
    }
}
