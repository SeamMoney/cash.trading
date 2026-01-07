module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::dex_accounts {
    use 0x1::ordered_map;
    use 0x1::option;
    use 0x1::object;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_market;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_engine_api;
    use 0x1::big_ordered_map;
    use 0x1::string;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_engine;
    use 0x1::fungible_asset;
    use 0x1::primary_fungible_store;
    use 0x1b3fa27b03773a4265a09b292c5059da10b4ae8a3dbd2972245c7504e89f52e7::order_book_types;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::builder_code_registry;
    use 0x1::signer;
    use 0x1::event;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::decibel_time;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::dex_accounts_vault_extension;
    enum StoredPermission has copy, drop, store {
        Unlimited,
        UnlimitedUntil {
            _0: u64,
        }
    }
    enum DelegatedPermissions has copy, drop, store {
        V1 {
            perms: ordered_map::OrderedMap<PermissionType, StoredPermission>,
        }
    }
    enum PermissionType has copy, drop, store {
        TradePerpsAllMarkets,
        TradePerpsOnMarket {
            market: object::Object<perp_market::PerpMarket>,
        }
        SubaccountFundsMovement,
        SubDelegate,
        TradeVaultTokens,
    }
    enum DelegationChangedEvent has drop, store {
        V1 {
            subaccount: address,
            delegated_account: address,
            delegation: option::Option<PermissionType>,
            expiration_time_s: option::Option<u64>,
        }
    }
    enum RestrictedApiRegistry has key {
        V1 {
            restricted_perp_api: perp_engine_api::RestrictedPerpApi,
        }
    }
    enum Subaccount has key {
        V1 {
            extend_ref: object::ExtendRef,
            delegated_permissions: big_ordered_map::BigOrderedMap<address, DelegatedPermissions>,
            is_active: bool,
        }
    }
    enum SubaccountActiveChangedEvent has drop, store {
        V1 {
            subaccount: address,
            owner: address,
            is_active: bool,
        }
    }
    enum SubaccountCreatedEvent has drop, store {
        V1 {
            subaccount: address,
            owner: address,
            is_primary: bool,
            seed: option::Option<vector<u8>>,
        }
    }
    fun init_module(p0: &signer) {
        register_restricted_api(p0);
    }
    public fun register_restricted_api(p0: &signer) {
        let _v0 = perp_engine_api::get_restricted_perp_api(p0);
        if (exists<RestrictedApiRegistry>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844)) abort 18;
        let _v1 = RestrictedApiRegistry::V1{restricted_perp_api: _v0};
        move_to<RestrictedApiRegistry>(p0, _v1);
    }
    entry fun register_referral_code(p0: &signer, p1: string::String) {
        perp_engine_api::register_referral_code(p0, p1);
    }
    entry fun register_referrer(p0: &signer, p1: string::String) {
        perp_engine_api::register_referrer(p0, p1);
    }
    public entry fun configure_user_settings_for_market(p0: &signer, p1: address, p2: object::Object<perp_market::PerpMarket>, p3: bool, p4: u8)
        acquires RestrictedApiRegistry, Subaccount
    {
        let _v0 = get_subaccount_object_or_init_if_primary(p0, p1);
        let _v1 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, _v0, p2);
        perp_engine::configure_user_settings_for_market(&_v1, p2, p3, p4);
    }
    fun get_subaccount_object_or_init_if_primary(p0: &signer, p1: address): object::Object<Subaccount>
        acquires RestrictedApiRegistry
    {
        let _v0 = exists<Subaccount>(p1);
        loop {
            if (!_v0) {
                let _v1 = primary_subaccount(signer::address_of(p0));
                if (p1 == _v1) break;
                abort 2
            };
            return object::address_to_object<Subaccount>(p1)
        };
        create_subaccount_internal(p0, true)
    }
    fun get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>): signer
        acquires Subaccount
    {
        let _v0;
        let _v1 = PermissionType::TradePerpsAllMarkets{};
        let _v2 = PermissionType::TradePerpsOnMarket{market: p2};
        let _v3 = 0x1::vector::empty<PermissionType>();
        let _v4 = &mut _v3;
        0x1::vector::push_back<PermissionType>(_v4, _v1);
        0x1::vector::push_back<PermissionType>(_v4, _v2);
        let _v5 = p1;
        let _v6 = object::object_address<Subaccount>(&_v5);
        let _v7 = borrow_global<Subaccount>(_v6);
        assert!(*&_v7.is_active, 15);
        let _v8 = signer::address_of(p0);
        if (object::is_owner<Subaccount>(p1, _v8)) _v0 = true else _v0 = is_any_permission_granted(p0, _v7, _v3, 0);
        assert!(_v0, 8);
        object::generate_signer_for_extending(&_v7.extend_ref)
    }
    public entry fun transfer_margin_to_isolated_position(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: bool, p4: object::Object<fungible_asset::Metadata>, p5: u64)
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        perp_engine::transfer_margin_to_isolated_position(&_v0, p2, p3, p4, p5);
    }
    public entry fun deposit_to_isolated_position_margin(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: object::Object<fungible_asset::Metadata>, p4: u64)
        acquires Subaccount
    {
        let _v0 = primary_fungible_store::withdraw<fungible_asset::Metadata>(p0, p3, p4);
        let _v1 = get_subaccount_signer_if_owner(p0, p1);
        perp_engine::deposit_to_isolated_position_margin(&_v1, p2, _v0);
    }
    fun get_subaccount_signer_if_owner(p0: &signer, p1: object::Object<Subaccount>): signer
        acquires Subaccount
    {
        let _v0 = signer::address_of(p0);
        assert!(object::is_owner<Subaccount>(p1, _v0), 1);
        let _v1 = p1;
        let _v2 = object::object_address<Subaccount>(&_v1);
        let _v3 = borrow_global<Subaccount>(_v2);
        assert!(*&_v3.is_active, 15);
        object::generate_signer_for_extending(&_v3.extend_ref)
    }
    entry fun cancel_tp_sl_order_for_position(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: u128)
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v1 = &_v0;
        let _v2 = order_book_types::new_order_id_type(p3);
        perp_engine::cancel_tp_sl_order_for_position(p2, _v1, _v2);
    }
    entry fun place_tp_sl_order_for_position(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: option::Option<u64>, p4: option::Option<u64>, p5: option::Option<u64>, p6: option::Option<u64>, p7: option::Option<u64>, p8: option::Option<u64>, p9: option::Option<address>, p10: option::Option<u64>)
        acquires Subaccount
    {
        let _v0;
        let _v1 = p9;
        if (option::is_some<address>(&_v1)) {
            let _v2 = option::destroy_some<address>(_v1);
            let _v3 = option::destroy_some<u64>(p10);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v2, _v3))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v4 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v5 = &_v4;
        let (_v6,_v7) = perp_engine::place_tp_sl_order_for_position(p2, _v5, p3, p4, p5, p6, p7, p8, _v0);
    }
    public entry fun withdraw_from_isolated_position_margin(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: object::Object<fungible_asset::Metadata>, p4: u64)
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner(p0, p1);
        let _v1 = perp_engine::withdraw_from_isolated_position_margin(&_v0, p2, p3, p4);
        primary_fungible_store::deposit(signer::address_of(p0), _v1);
    }
    fun add_delegated_permission(p0: object::Object<Subaccount>, p1: address, p2: PermissionType, p3: option::Option<u64>)
        acquires Subaccount
    {
        let _v0;
        let _v1;
        let _v2;
        let _v3 = p0;
        let _v4 = object::object_address<Subaccount>(&_v3);
        let _v5 = &mut borrow_global_mut<Subaccount>(_v4).delegated_permissions;
        let _v6 = freeze(_v5);
        let _v7 = &p1;
        if (!big_ordered_map::contains<address,DelegatedPermissions>(_v6, _v7)) {
            _v1 = _v5;
            let _v8 = DelegatedPermissions::V1{perms: ordered_map::new<PermissionType,StoredPermission>()};
            let _v9 = big_ordered_map::upsert<address,DelegatedPermissions>(_v1, p1, _v8);
        };
        if (option::is_none<u64>(&p3)) _v2 = StoredPermission::Unlimited{} else _v2 = StoredPermission::UnlimitedUntil{_0: *option::borrow<u64>(&p3)};
        _v1 = _v5;
        let _v10 = &p1;
        let _v11 = _v1;
        let _v12 = big_ordered_map::internal_find<address,DelegatedPermissions>(freeze(_v11), _v10);
        let _v13 = &_v12;
        let _v14 = freeze(_v11);
        if (big_ordered_map::iter_is_end<address,DelegatedPermissions>(_v13, _v14)) _v0 = option::none<bool>() else {
            let _v15 = |arg0| lambda__1__add_delegated_permission(p2, _v2, arg0);
            _v0 = option::some<bool>(big_ordered_map::iter_modify<address,DelegatedPermissions,bool>(_v12, _v11, _v15))
        };
        if (!option::is_some<bool>(&_v0)) {
            let _v16 = *_v10;
            let _v17 = DelegatedPermissions::V1{perms: ordered_map::new<PermissionType,StoredPermission>()};
            let _v18 = ordered_map::upsert<PermissionType,StoredPermission>(&mut (&mut _v17).perms, p2, _v2);
            big_ordered_map::add<address,DelegatedPermissions>(_v1, _v16, _v17)
        };
        let _v19 = object::object_address<Subaccount>(&p0);
        let _v20 = option::some<PermissionType>(p2);
        event::emit<DelegationChangedEvent>(DelegationChangedEvent::V1{subaccount: _v19, delegated_account: p1, delegation: _v20, expiration_time_s: p3});
    }
    fun lambda__1__add_delegated_permission(p0: PermissionType, p1: StoredPermission, p2: &mut DelegatedPermissions): bool {
        let _v0 = ordered_map::upsert<PermissionType,StoredPermission>(&mut p2.perms, p0, p1);
        true
    }
    entry fun add_delegated_trader_and_deposit_to_subaccount(p0: &signer, p1: address, p2: object::Object<fungible_asset::Metadata>, p3: u64, p4: address, p5: option::Option<u64>)
        acquires RestrictedApiRegistry, Subaccount
    {
        deposit_to_subaccount_at(p0, p1, p2, p3);
        delegate_trading_to_for_subaccount(p0, p1, p4, p5);
    }
    public entry fun deposit_to_subaccount_at(p0: &signer, p1: address, p2: object::Object<fungible_asset::Metadata>, p3: u64)
        acquires RestrictedApiRegistry, Subaccount
    {
        let _v0 = primary_fungible_store::withdraw<fungible_asset::Metadata>(p0, p2, p3);
        deposit_funds_to_subaccount_at(p0, p1, _v0);
    }
    friend entry fun delegate_trading_to_for_subaccount(p0: &signer, p1: address, p2: address, p3: option::Option<u64>)
        acquires RestrictedApiRegistry, Subaccount
    {
        let _v0 = PermissionType::TradePerpsAllMarkets{};
        check_and_delegate_permission(p0, p1, p2, _v0, p3);
        let _v1 = PermissionType::TradeVaultTokens{};
        check_and_delegate_permission(p0, p1, p2, _v1, p3);
    }
    entry fun approve_max_builder_fee_for_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: address, p3: u64)
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner(p0, p1);
        perp_engine_api::approve_max_fee(&_v0, p2, p3);
    }
    entry fun cancel_bulk_order_to_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>)
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v1 = &_v0;
        perp_engine::cancel_bulk_order(p2, _v1);
    }
    entry fun cancel_client_order_to_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: string::String, p3: object::Object<perp_market::PerpMarket>)
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p3);
        let _v1 = &_v0;
        perp_engine::cancel_client_order(p3, _v1, p2);
    }
    public entry fun cancel_order_to_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: u128, p3: object::Object<perp_market::PerpMarket>)
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p3);
        let _v1 = &_v0;
        let _v2 = order_book_types::new_order_id_type(p2);
        perp_engine::cancel_order(p3, _v1, _v2);
    }
    entry fun cancel_twap_orders_to_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: u128)
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v1 = &_v0;
        let _v2 = order_book_types::new_order_id_type(p3);
        perp_engine::cancel_twap_order(p2, _v1, _v2);
    }
    fun check_and_delegate_permission(p0: &signer, p1: address, p2: address, p3: PermissionType, p4: option::Option<u64>)
        acquires RestrictedApiRegistry, Subaccount
    {
        let _v0;
        let _v1 = get_subaccount_object_or_init_if_primary(p0, p1);
        let _v2 = _v1;
        let _v3 = option::get_with_default<u64>(&p4, 18446744073709551615);
        let _v4 = _v2;
        let _v5 = object::object_address<Subaccount>(&_v4);
        let _v6 = borrow_global<Subaccount>(_v5);
        assert!(*&_v6.is_active, 15);
        let _v7 = signer::address_of(p0);
        if (object::is_owner<Subaccount>(_v2, _v7)) _v0 = true else {
            let _v8 = PermissionType::SubDelegate{};
            let _v9 = 0x1::vector::empty<PermissionType>();
            0x1::vector::push_back<PermissionType>(&mut _v9, _v8);
            if (is_any_permission_granted(p0, _v6, _v9, 0)) {
                let _v10 = 0x1::vector::empty<PermissionType>();
                0x1::vector::push_back<PermissionType>(&mut _v10, p3);
                _v0 = is_any_permission_granted(p0, _v6, _v10, _v3)
            } else _v0 = false
        };
        assert!(_v0, 13);
        add_delegated_permission(_v1, p2, p3, p4);
    }
    fun is_any_permission_granted(p0: &signer, p1: &Subaccount, p2: vector<PermissionType>, p3: u64): bool {
        let _v0;
        let _v1 = signer::address_of(p0);
        let _v2 = decibel_time::now_seconds();
        if (_v2 > p3) _v0 = _v2 else _v0 = p3;
        let _v3 = &p1.delegated_permissions;
        let _v4 = &_v1;
        if (big_ordered_map::contains<address,DelegatedPermissions>(_v3, _v4)) {
            let _v5 = &p1.delegated_permissions;
            let _v6 = &_v1;
            let _v7 = *&big_ordered_map::borrow<address,DelegatedPermissions>(_v5, _v6).perms;
            let _v8 = false;
            let _v9 = &p2;
            let _v10 = 0;
            let _v11 = 0x1::vector::length<PermissionType>(_v9);
            'l0: loop {
                loop {
                    if (!(_v10 < _v11)) break 'l0;
                    let _v12 = 0x1::vector::borrow<PermissionType>(_v9, _v10);
                    if (ordered_map::contains<PermissionType,StoredPermission>(&_v7, _v12)) {
                        let _v13 = ordered_map::borrow<PermissionType,StoredPermission>(&_v7, _v12);
                        if (_v13 is Unlimited) _v8 = true else if (_v13 is UnlimitedUntil) if (*&_v13._0 > _v0) _v8 = true else break
                    };
                    _v10 = _v10 + 1;
                    continue
                };
                abort 14566554180833181697
            };
            return _v8
        };
        false
    }
    public entry fun create_new_seeded_subaccount(p0: &signer, p1: vector<u8>)
        acquires RestrictedApiRegistry
    {
        let _v0 = option::some<vector<u8>>(p1);
        let _v1 = create_subaccount_internal_with_seed(p0, _v0);
    }
    fun create_subaccount_internal_with_seed(p0: &signer, p1: option::Option<vector<u8>>): object::Object<Subaccount>
        acquires RestrictedApiRegistry
    {
        let _v0;
        let _v1;
        if (option::is_some<vector<u8>>(&p1)) _v1 = *option::borrow<vector<u8>>(&p1) == vector[100u8, 101u8, 99u8, 105u8, 98u8, 101u8, 108u8, 95u8, 100u8, 101u8, 120u8, 95u8, 112u8, 114u8, 105u8, 109u8, 97u8, 114u8, 121u8, 95u8, 118u8, 50u8] else _v1 = false;
        if (option::is_some<vector<u8>>(&p1)) {
            let _v2 = *option::borrow<vector<u8>>(&p1);
            _v0 = object::create_named_object(p0, _v2)
        } else _v0 = object::create_object(signer::address_of(p0));
        let _v3 = object::generate_extend_ref(&_v0);
        let _v4 = object::generate_signer_for_extending(&_v3);
        let _v5 = object::address_from_constructor_ref(&_v0);
        let _v6 = &_v4;
        let _v7 = big_ordered_map::new_with_config<address,DelegatedPermissions>(0u16, 16u16, false);
        let _v8 = Subaccount::V1{extend_ref: _v3, delegated_permissions: _v7, is_active: true};
        move_to<Subaccount>(_v6, _v8);
        object::set_untransferable(&_v0);
        assert!(exists<RestrictedApiRegistry>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844), 19);
        let _v9 = &borrow_global<RestrictedApiRegistry>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).restricted_perp_api;
        let _v10 = &_v4;
        let _v11 = signer::address_of(p0);
        perp_engine_api::init_user_if_new(_v9, _v10, _v11);
        let _v12 = signer::address_of(p0);
        event::emit<SubaccountCreatedEvent>(SubaccountCreatedEvent::V1{subaccount: _v5, owner: _v12, is_primary: _v1, seed: p1});
        object::address_to_object<Subaccount>(_v5)
    }
    public entry fun create_new_subaccount(p0: &signer)
        acquires RestrictedApiRegistry
    {
        let _v0 = create_subaccount_internal(p0, false);
    }
    fun create_subaccount_internal(p0: &signer, p1: bool): object::Object<Subaccount>
        acquires RestrictedApiRegistry
    {
        if (p1) {
            let _v0 = option::some<vector<u8>>(vector[100u8, 101u8, 99u8, 105u8, 98u8, 101u8, 108u8, 95u8, 100u8, 101u8, 120u8, 95u8, 112u8, 114u8, 105u8, 109u8, 97u8, 114u8, 121u8, 95u8, 118u8, 50u8]);
            return create_subaccount_internal_with_seed(p0, _v0)
        };
        let _v1 = option::none<vector<u8>>();
        create_subaccount_internal_with_seed(p0, _v1)
    }
    public fun create_new_subaccount_object(p0: &signer): object::Object<Subaccount>
        acquires RestrictedApiRegistry
    {
        create_subaccount_internal(p0, false)
    }
    friend entry fun deactivate_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: bool)
        acquires Subaccount
    {
        let _v0 = p1;
        let _v1 = signer::address_of(p0);
        assert!(object::is_owner<Subaccount>(_v0, _v1), 1);
        let _v2 = _v0;
        let _v3 = object::object_address<Subaccount>(&_v2);
        assert!(*&borrow_global<Subaccount>(_v3).is_active, 15);
        if (perp_engine::has_any_assets_or_positions(object::object_address<Subaccount>(&p1))) abort 16;
        if (p2) revoke_all_delegations(p0, p1);
        let _v4 = object::object_address<Subaccount>(&p1);
        let _v5 = p1;
        let _v6 = object::object_address<Subaccount>(&_v5);
        let _v7 = &mut borrow_global_mut<Subaccount>(_v6).is_active;
        *_v7 = false;
        let _v8 = signer::address_of(p0);
        event::emit<SubaccountActiveChangedEvent>(SubaccountActiveChangedEvent::V1{subaccount: _v4, owner: _v8, is_active: false});
    }
    friend entry fun revoke_all_delegations(p0: &signer, p1: object::Object<Subaccount>)
        acquires Subaccount
    {
        let _v0 = p1;
        let _v1 = signer::address_of(p0);
        assert!(object::is_owner<Subaccount>(_v0, _v1), 1);
        let _v2 = _v0;
        let _v3 = object::object_address<Subaccount>(&_v2);
        assert!(*&borrow_global<Subaccount>(_v3).is_active, 15);
        let _v4 = p1;
        let _v5 = object::object_address<Subaccount>(&_v4);
        let _v6 = borrow_global_mut<Subaccount>(_v5);
        let _v7 = object::object_address<Subaccount>(&p1);
        let _v8 = &mut _v6.delegated_permissions;
        while (!big_ordered_map::is_empty<address,DelegatedPermissions>(freeze(_v8))) {
            let (_v9,_v10) = big_ordered_map::pop_front<address,DelegatedPermissions>(_v8);
            let _v11 = option::none<PermissionType>();
            let _v12 = option::none<u64>();
            event::emit<DelegationChangedEvent>(DelegationChangedEvent::V1{subaccount: _v7, delegated_account: _v9, delegation: _v11, expiration_time_s: _v12});
            continue
        };
    }
    entry fun delegate_ability_to_sub_delegate_to_for_subaccount(p0: &signer, p1: address, p2: address, p3: option::Option<u64>)
        acquires RestrictedApiRegistry, Subaccount
    {
        let _v0 = PermissionType::SubDelegate{};
        check_and_delegate_permission(p0, p1, p2, _v0, p3);
    }
    public fun delegate_onchain_account_permissions(p0: &object::ExtendRef, p1: address, p2: address, p3: bool, p4: bool, p5: bool, p6: bool, p7: option::Option<u64>)
        acquires RestrictedApiRegistry, Subaccount
    {
        let _v0 = object::generate_signer_for_extending(p0);
        let _v1 = get_subaccount_object_or_init_if_primary(&_v0, p1);
        let _v2 = &_v0;
        let _v3 = _v1;
        let _v4 = signer::address_of(_v2);
        assert!(object::is_owner<Subaccount>(_v3, _v4), 1);
        let _v5 = _v3;
        let _v6 = object::object_address<Subaccount>(&_v5);
        assert!(*&borrow_global<Subaccount>(_v6).is_active, 15);
        if (p3) {
            let _v7 = PermissionType::TradePerpsAllMarkets{};
            add_delegated_permission(_v1, p2, _v7, p7)
        };
        if (p4) {
            let _v8 = PermissionType::TradeVaultTokens{};
            add_delegated_permission(_v1, p2, _v8, p7)
        };
        if (p5) {
            let _v9 = PermissionType::SubDelegate{};
            add_delegated_permission(_v1, p2, _v9, p7)
        };
        if (p6) {
            let _v10 = PermissionType::SubaccountFundsMovement{};
            add_delegated_permission(_v1, p2, _v10, p7);
            return ()
        };
    }
    #[persistent]
    fun deposit_funds_to_subaccount_address(p0: address, p1: fungible_asset::FungibleAsset)
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_unpermissioned(get_subaccount_object(p0));
        perp_engine::deposit(&_v0, p1);
    }
    fun get_subaccount_object(p0: address): object::Object<Subaccount> {
        assert!(exists<Subaccount>(p0), 2);
        object::address_to_object<Subaccount>(p0)
    }
    fun get_subaccount_signer_unpermissioned(p0: object::Object<Subaccount>): signer
        acquires Subaccount
    {
        let _v0 = p0;
        let _v1 = object::object_address<Subaccount>(&_v0);
        object::generate_signer_for_extending(&borrow_global<Subaccount>(_v1).extend_ref)
    }
    public fun deposit_funds_to_subaccount_at(p0: &signer, p1: address, p2: fungible_asset::FungibleAsset)
        acquires RestrictedApiRegistry, Subaccount
    {
        let _v0 = get_subaccount_object_or_init_if_primary(p0, p1);
        let _v1 = get_subaccount_signer_if_owner(p0, _v0);
        perp_engine::deposit(&_v1, p2);
    }
    public fun get_deposit_funds_to_subaccount_address_method(p0: &signer): |address, fungible_asset::FungibleAsset| has copy + drop + store {
        assert!(signer::address_of(p0) == @0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844, 18);
        |arg0,arg1| deposit_funds_to_subaccount_address(arg0, arg1)
    }
    public fun primary_subaccount(p0: address): address {
        object::create_object_address(&p0, vector[100u8, 101u8, 99u8, 105u8, 98u8, 101u8, 108u8, 95u8, 100u8, 101u8, 120u8, 95u8, 112u8, 114u8, 105u8, 109u8, 97u8, 114u8, 121u8, 95u8, 118u8, 50u8])
    }
    fun get_subaccount_signer_if_owner_or_delegated_for_subaccount_funds_movement(p0: &signer, p1: object::Object<Subaccount>): signer
        acquires Subaccount
    {
        let _v0;
        let _v1 = PermissionType::SubaccountFundsMovement{};
        let _v2 = 0x1::vector::empty<PermissionType>();
        0x1::vector::push_back<PermissionType>(&mut _v2, _v1);
        let _v3 = p1;
        let _v4 = object::object_address<Subaccount>(&_v3);
        let _v5 = borrow_global<Subaccount>(_v4);
        assert!(*&_v5.is_active, 15);
        let _v6 = signer::address_of(p0);
        if (object::is_owner<Subaccount>(p1, _v6)) _v0 = true else _v0 = is_any_permission_granted(p0, _v5, _v2, 0);
        assert!(_v0, 12);
        object::generate_signer_for_extending(&_v5.extend_ref)
    }
    friend fun get_subaccount_signer_if_owner_or_delegated_for_vault_trading(p0: &signer, p1: object::Object<Subaccount>): signer
        acquires Subaccount
    {
        let _v0;
        let _v1 = PermissionType::TradeVaultTokens{};
        let _v2 = 0x1::vector::empty<PermissionType>();
        0x1::vector::push_back<PermissionType>(&mut _v2, _v1);
        let _v3 = p1;
        let _v4 = object::object_address<Subaccount>(&_v3);
        let _v5 = borrow_global<Subaccount>(_v4);
        assert!(*&_v5.is_active, 15);
        let _v6 = signer::address_of(p0);
        if (object::is_owner<Subaccount>(p1, _v6)) _v0 = true else _v0 = is_any_permission_granted(p0, _v5, _v2, 0);
        assert!(_v0, 17);
        object::generate_signer_for_extending(&_v5.extend_ref)
    }
    public entry fun init_account_status_cache_for_subaccount(p0: &signer, p1: address)
        acquires Subaccount
    {
        let _v0 = get_subaccount_object(p1);
        let _v1 = get_subaccount_signer_if_owner(p0, _v0);
        perp_engine::init_account_status_cache(&_v1);
    }
    entry fun place_bulk_orders_to_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: vector<u64>, p5: vector<u64>, p6: vector<u64>, p7: vector<u64>)
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v1 = &_v0;
        let _v2 = option::none<builder_code_registry::BuilderCode>();
        let _v3 = perp_engine::place_bulk_order(p2, _v1, p3, p4, p5, p6, p7, _v2);
    }
    entry fun place_market_order_to_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: bool, p5: bool, p6: option::Option<string::String>, p7: option::Option<u64>, p8: option::Option<u64>, p9: option::Option<u64>, p10: option::Option<u64>, p11: option::Option<u64>, p12: option::Option<address>, p13: option::Option<u64>)
        acquires Subaccount
    {
        let _v0;
        let _v1 = p12;
        if (option::is_some<address>(&_v1)) {
            let _v2 = option::destroy_some<address>(_v1);
            let _v3 = option::destroy_some<u64>(p13);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v2, _v3))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v4 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v5 = &_v4;
        let _v6 = perp_engine::place_market_order(p2, _v5, p3, p4, p5, p6, p7, p8, p9, p10, p11, _v0);
    }
    entry fun place_order_to_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: u64, p5: bool, p6: u8, p7: bool, p8: option::Option<string::String>, p9: option::Option<u64>, p10: option::Option<u64>, p11: option::Option<u64>, p12: option::Option<u64>, p13: option::Option<u64>, p14: option::Option<address>, p15: option::Option<u64>)
        acquires Subaccount
    {
        let _v0;
        let _v1 = p14;
        if (option::is_some<address>(&_v1)) {
            let _v2 = option::destroy_some<address>(_v1);
            let _v3 = option::destroy_some<u64>(p15);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v2, _v3))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v4 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v5 = &_v4;
        let _v6 = order_book_types::time_in_force_from_index(p6);
        let _v7 = perp_engine::place_order(p2, _v5, p3, p4, p5, _v6, p7, p8, p9, p10, p11, p12, p13, _v0);
    }
    public fun place_order_to_subaccount_method(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: u64, p5: bool, p6: order_book_types::TimeInForce, p7: bool, p8: option::Option<string::String>, p9: option::Option<u64>, p10: option::Option<u64>, p11: option::Option<u64>, p12: option::Option<u64>, p13: option::Option<u64>, p14: option::Option<address>, p15: option::Option<u64>): order_book_types::OrderIdType
        acquires Subaccount
    {
        let _v0;
        let _v1 = p14;
        if (option::is_some<address>(&_v1)) {
            let _v2 = option::destroy_some<address>(_v1);
            let _v3 = option::destroy_some<u64>(p15);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v2, _v3))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v4 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v5 = &_v4;
        perp_engine::place_order(p2, _v5, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, _v0)
    }
    entry fun place_twap_order_to_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: bool, p5: bool, p6: u64, p7: u64, p8: option::Option<address>, p9: option::Option<u64>)
        acquires Subaccount
    {
        let _v0;
        let _v1 = p8;
        if (option::is_some<address>(&_v1)) {
            let _v2 = option::destroy_some<address>(_v1);
            let _v3 = option::destroy_some<u64>(p9);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v2, _v3))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v4 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v5 = &_v4;
        let _v6 = option::none<string::String>();
        let _v7 = perp_engine::place_twap_order(p2, _v5, p3, p4, p5, _v6, p6, p7, _v0);
    }
    entry fun place_twap_order_to_subaccount_v2(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: bool, p5: bool, p6: option::Option<string::String>, p7: u64, p8: u64, p9: option::Option<address>, p10: option::Option<u64>)
        acquires Subaccount
    {
        let _v0;
        let _v1 = p9;
        if (option::is_some<address>(&_v1)) {
            let _v2 = option::destroy_some<address>(_v1);
            let _v3 = option::destroy_some<u64>(p10);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v2, _v3))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v4 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v5 = &_v4;
        let _v6 = perp_engine::place_twap_order(p2, _v5, p3, p4, p5, p6, p7, p8, _v0);
    }
    public fun primary_subaccount_object(p0: address): object::Object<Subaccount> {
        object::address_to_object<Subaccount>(object::create_object_address(&p0, vector[100u8, 101u8, 99u8, 105u8, 98u8, 101u8, 108u8, 95u8, 100u8, 101u8, 120u8, 95u8, 112u8, 114u8, 105u8, 109u8, 97u8, 114u8, 121u8, 95u8, 118u8, 50u8]))
    }
    friend entry fun reactivate_subaccount(p0: &signer, p1: object::Object<Subaccount>)
        acquires Subaccount
    {
        let _v0 = signer::address_of(p0);
        assert!(object::is_owner<Subaccount>(p1, _v0), 1);
        let _v1 = object::object_address<Subaccount>(&p1);
        let _v2 = p1;
        let _v3 = object::object_address<Subaccount>(&_v2);
        let _v4 = &mut borrow_global_mut<Subaccount>(_v3).is_active;
        *_v4 = true;
        let _v5 = signer::address_of(p0);
        event::emit<SubaccountActiveChangedEvent>(SubaccountActiveChangedEvent::V1{subaccount: _v1, owner: _v5, is_active: true});
    }
    friend entry fun revoke_delegation(p0: &signer, p1: object::Object<Subaccount>, p2: address)
        acquires Subaccount
    {
        let _v0 = p1;
        let _v1 = signer::address_of(p0);
        assert!(object::is_owner<Subaccount>(_v0, _v1), 1);
        let _v2 = _v0;
        let _v3 = object::object_address<Subaccount>(&_v2);
        assert!(*&borrow_global<Subaccount>(_v3).is_active, 15);
        let _v4 = p1;
        let _v5 = object::object_address<Subaccount>(&_v4);
        let _v6 = &mut borrow_global_mut<Subaccount>(_v5).delegated_permissions;
        let _v7 = &p2;
        let _v8 = big_ordered_map::remove<address,DelegatedPermissions>(_v6, _v7);
        let _v9 = object::object_address<Subaccount>(&p1);
        let _v10 = option::none<PermissionType>();
        let _v11 = option::none<u64>();
        event::emit<DelegationChangedEvent>(DelegationChangedEvent::V1{subaccount: _v9, delegated_account: p2, delegation: _v10, expiration_time_s: _v11});
    }
    entry fun revoke_max_builder_fee_for_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: address)
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner(p0, p1);
        perp_engine_api::revoke_max_fee(&_v0, p2);
    }
    public entry fun transfer_collateral_between_subaccounts(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<Subaccount>, p3: object::Object<fungible_asset::Metadata>, p4: u64)
        acquires Subaccount
    {
        let _v0 = object::owner<Subaccount>(p1);
        let _v1 = object::owner<Subaccount>(p2);
        assert!(_v0 == _v1, 14);
        let _v2 = get_subaccount_signer_if_owner_or_delegated_for_subaccount_funds_movement(p0, p1);
        let _v3 = perp_engine::withdraw_fungible(&_v2, p3, p4);
        let _v4 = get_subaccount_signer_if_owner_or_delegated_for_subaccount_funds_movement(p0, p2);
        perp_engine::deposit(&_v4, _v3);
    }
    entry fun update_client_order_to_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: string::String, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: u64, p6: bool, p7: u8, p8: bool, p9: option::Option<u64>, p10: option::Option<u64>, p11: option::Option<u64>, p12: option::Option<u64>, p13: option::Option<address>, p14: option::Option<u64>)
        acquires Subaccount
    {
        let _v0;
        let _v1 = p13;
        if (option::is_some<address>(&_v1)) {
            let _v2 = option::destroy_some<address>(_v1);
            let _v3 = option::destroy_some<u64>(p14);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v2, _v3))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v4 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p3);
        let _v5 = &_v4;
        let _v6 = order_book_types::time_in_force_from_index(p7);
        perp_engine::update_client_order(_v5, p2, p3, p4, p5, p6, _v6, p8, p9, p10, p11, p12, _v0);
    }
    entry fun update_order_to_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: u128, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: u64, p6: bool, p7: u8, p8: bool, p9: option::Option<u64>, p10: option::Option<u64>, p11: option::Option<u64>, p12: option::Option<u64>, p13: option::Option<address>, p14: option::Option<u64>)
        acquires Subaccount
    {
        let _v0;
        let _v1 = p13;
        if (option::is_some<address>(&_v1)) {
            let _v2 = option::destroy_some<address>(_v1);
            let _v3 = option::destroy_some<u64>(p14);
            _v0 = option::some<builder_code_registry::BuilderCode>(perp_engine_api::new_builder_code(_v2, _v3))
        } else _v0 = option::none<builder_code_registry::BuilderCode>();
        let _v4 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p3);
        let _v5 = &_v4;
        let _v6 = order_book_types::new_order_id_type(p2);
        let _v7 = order_book_types::time_in_force_from_index(p7);
        perp_engine::update_order(_v5, _v6, p3, p4, p5, p6, _v7, p8, p9, p10, p11, p12, _v0);
    }
    entry fun update_sl_order_for_position(p0: &signer, p1: object::Object<Subaccount>, p2: u128, p3: object::Object<perp_market::PerpMarket>, p4: option::Option<u64>, p5: option::Option<u64>, p6: option::Option<u64>)
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p3);
        let _v1 = &_v0;
        let _v2 = order_book_types::new_order_id_type(p2);
        perp_engine::cancel_tp_sl_order_for_position(p3, _v1, _v2);
        let _v3 = &_v0;
        let _v4 = option::none<u64>();
        let _v5 = option::none<u64>();
        let _v6 = option::none<u64>();
        let _v7 = option::none<builder_code_registry::BuilderCode>();
        let (_v8,_v9) = perp_engine::place_tp_sl_order_for_position(p3, _v3, _v4, _v5, _v6, p4, p5, p6, _v7);
    }
    entry fun update_tp_order_for_position(p0: &signer, p1: object::Object<Subaccount>, p2: u128, p3: object::Object<perp_market::PerpMarket>, p4: option::Option<u64>, p5: option::Option<u64>, p6: option::Option<u64>)
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p3);
        let _v1 = &_v0;
        let _v2 = order_book_types::new_order_id_type(p2);
        perp_engine::cancel_tp_sl_order_for_position(p3, _v1, _v2);
        let _v3 = &_v0;
        let _v4 = option::none<u64>();
        let _v5 = option::none<u64>();
        let _v6 = option::none<u64>();
        let _v7 = option::none<builder_code_registry::BuilderCode>();
        let (_v8,_v9) = perp_engine::place_tp_sl_order_for_position(p3, _v3, p4, p5, p6, _v4, _v5, _v6, _v7);
    }
    friend entry fun withdraw_from_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<fungible_asset::Metadata>, p3: u64)
        acquires Subaccount
    {
        let _v0 = withdraw_from_subaccount_request(p0, p1, p2, p3);
    }
    public fun withdraw_from_subaccount_request(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<fungible_asset::Metadata>, p3: u64): bool
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner(p0, p1);
        let _v1 = perp_engine::withdraw_fungible(&_v0, p2, p3);
        primary_fungible_store::deposit(signer::address_of(p0), _v1);
        true
    }
    public fun withdraw_onchain_account_funds_from_subaccount(p0: &object::ExtendRef, p1: object::Object<Subaccount>, p2: object::Object<fungible_asset::Metadata>, p3: u64): fungible_asset::FungibleAsset
        acquires Subaccount
    {
        let _v0 = object::generate_signer_for_extending(p0);
        let _v1 = get_subaccount_signer_if_owner(&_v0, p1);
        perp_engine::withdraw_fungible(&_v1, p2, p3)
    }
}
