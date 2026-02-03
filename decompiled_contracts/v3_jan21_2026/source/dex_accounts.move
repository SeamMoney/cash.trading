module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::dex_accounts {
    use 0x1::ordered_map;
    use 0x1::option;
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine_api;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0x1::big_ordered_map;
    use 0x1::event;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book_types;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::order_apis;
    use 0x1::signer;
    use 0x1::bcs;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    use 0x1::fungible_asset;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::account_management_apis;
    use 0x1::primary_fungible_store;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::decibel_time;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_order;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::builder_code_registry;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::dex_accounts_vault_extension;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::dex_accounts_entry;
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
    enum GlobalDexAccountsConfig has key {
        V1 {
            subaccount_manager_extend_ref: object::ExtendRef,
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
    struct SubaccountSeed has drop {
        owner_addr: address,
        seed: vector<u8>,
    }
    fun init_module(p0: &signer) {
        init_global_config(p0);
    }
    public fun init_global_config(p0: &signer) {
        assert!(signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88, 18);
        let _v0 = perp_engine_api::get_restricted_perp_api(p0);
        let _v1 = object::create_named_object(p0, vector[71u8, 108u8, 111u8, 98u8, 97u8, 108u8, 83u8, 117u8, 98u8, 97u8, 99u8, 99u8, 111u8, 117u8, 110u8, 116u8, 77u8, 97u8, 110u8, 97u8, 103u8, 101u8, 114u8]);
        let _v2 = object::generate_extend_ref(&_v1);
        if (exists<GlobalDexAccountsConfig>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88)) abort 21;
        let _v3 = GlobalDexAccountsConfig::V1{subaccount_manager_extend_ref: _v2, restricted_perp_api: _v0};
        move_to<GlobalDexAccountsConfig>(p0, _v3);
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
            _v2 = _v5;
            let _v8 = DelegatedPermissions::V1{perms: ordered_map::new<PermissionType,StoredPermission>()};
            let _v9 = big_ordered_map::upsert<address,DelegatedPermissions>(_v2, p1, _v8);
        };
        if (option::is_none<u64>(&p3)) _v1 = StoredPermission::Unlimited{} else _v1 = StoredPermission::UnlimitedUntil{_0: *option::borrow<u64>(&p3)};
        _v2 = _v5;
        let _v10 = &p1;
        let _v11 = _v2;
        let _v12 = big_ordered_map::internal_find<address,DelegatedPermissions>(freeze(_v11), _v10);
        let _v13 = &_v12;
        let _v14 = freeze(_v11);
        if (big_ordered_map::iter_is_end<address,DelegatedPermissions>(_v13, _v14)) _v0 = option::none<bool>() else {
            let _v15 = |arg0| lambda__1__add_delegated_permission(p2, _v1, arg0);
            _v0 = option::some<bool>(big_ordered_map::iter_modify<address,DelegatedPermissions,bool>(_v12, _v11, _v15))
        };
        if (!option::is_some<bool>(&_v0)) {
            let _v16 = *_v10;
            let _v17 = DelegatedPermissions::V1{perms: ordered_map::new<PermissionType,StoredPermission>()};
            let _v18 = ordered_map::upsert<PermissionType,StoredPermission>(&mut (&mut _v17).perms, p2, _v1);
            big_ordered_map::add<address,DelegatedPermissions>(_v2, _v16, _v17)
        };
        let _v19 = object::object_address<Subaccount>(&p0);
        let _v20 = option::some<PermissionType>(p2);
        event::emit<DelegationChangedEvent>(DelegationChangedEvent::V1{subaccount: _v19, delegated_account: p1, delegation: _v20, expiration_time_s: p3});
    }
    fun lambda__1__add_delegated_permission(p0: PermissionType, p1: StoredPermission, p2: &mut DelegatedPermissions): bool {
        let _v0 = ordered_map::upsert<PermissionType,StoredPermission>(&mut p2.perms, p0, p1);
        true
    }
    friend fun assert_subaccount_is_active(p0: object::Object<Subaccount>)
        acquires Subaccount
    {
        let _v0 = p0;
        let _v1 = object::object_address<Subaccount>(&_v0);
        assert!(*&borrow_global<Subaccount>(_v1).is_active, 15);
    }
    public fun cancel_perp_order_to_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: u128, p3: object::Object<perp_market::PerpMarket>)
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p3);
        let _v1 = &_v0;
        let _v2 = order_book_types::new_order_id_type(p2);
        order_apis::cancel_order(p3, _v1, _v2);
    }
    friend fun get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>): signer
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
    fun check_and_delegate_permission(p0: &signer, p1: address, p2: address, p3: PermissionType, p4: option::Option<u64>)
        acquires GlobalDexAccountsConfig, Subaccount
    {
        let _v0;
        let _v1 = option::some<address>(signer::address_of(p0));
        let _v2 = get_subaccount_object_unpermissioned(p1, _v1);
        let _v3 = _v2;
        let _v4 = option::get_with_default<u64>(&p4, 18446744073709551615);
        let _v5 = _v3;
        let _v6 = object::object_address<Subaccount>(&_v5);
        let _v7 = borrow_global<Subaccount>(_v6);
        assert!(*&_v7.is_active, 15);
        p1 = signer::address_of(p0);
        if (object::is_owner<Subaccount>(_v3, p1)) _v0 = true else {
            let _v8 = PermissionType::SubDelegate{};
            let _v9 = 0x1::vector::empty<PermissionType>();
            0x1::vector::push_back<PermissionType>(&mut _v9, _v8);
            if (is_any_permission_granted(p0, _v7, _v9, 0)) {
                let _v10 = 0x1::vector::empty<PermissionType>();
                0x1::vector::push_back<PermissionType>(&mut _v10, p3);
                _v0 = is_any_permission_granted(p0, _v7, _v10, _v4)
            } else _v0 = false
        };
        assert!(_v0, 13);
        add_delegated_permission(_v2, p2, p3, p4);
    }
    friend fun get_subaccount_object_unpermissioned(p0: address, p1: option::Option<address>): object::Object<Subaccount>
        acquires GlobalDexAccountsConfig
    {
        let _v0 = exists<Subaccount>(p0);
        loop {
            if (!_v0) {
                let _v1;
                if (option::is_some<address>(&p1)) {
                    let _v2 = primary_subaccount(*option::borrow<address>(&p1));
                    _v1 = p0 == _v2
                } else _v1 = false;
                if (_v1) break;
                abort 2
            };
            return object::address_to_object<Subaccount>(p0)
        };
        create_primary_subaccount_internal(option::destroy_some<address>(p1))
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
    public fun create_new_seeded_subaccount(p0: &signer, p1: vector<u8>): object::Object<Subaccount>
        acquires GlobalDexAccountsConfig
    {
        assert!(p1 != vector[112u8, 114u8, 105u8, 109u8, 97u8, 114u8, 121u8, 95u8, 115u8, 117u8, 98u8, 97u8, 99u8, 99u8, 111u8, 117u8, 110u8, 116u8], 20);
        let _v0 = signer::address_of(p0);
        let _v1 = option::some<vector<u8>>(p1);
        create_subaccount_internal_with_seed(_v0, _v1)
    }
    fun create_subaccount_internal_with_seed(p0: address, p1: option::Option<vector<u8>>): object::Object<Subaccount>
        acquires GlobalDexAccountsConfig
    {
        let _v0;
        let _v1;
        if (option::is_some<vector<u8>>(&p1)) _v0 = *option::borrow<vector<u8>>(&p1) == vector[112u8, 114u8, 105u8, 109u8, 97u8, 114u8, 121u8, 95u8, 115u8, 117u8, 98u8, 97u8, 99u8, 99u8, 111u8, 117u8, 110u8, 116u8] else _v0 = false;
        if (option::is_some<vector<u8>>(&p1)) {
            let _v2 = option::destroy_some<vector<u8>>(p1);
            let _v3 = SubaccountSeed{owner_addr: p0, seed: _v2};
            let _v4 = bcs::to_bytes<SubaccountSeed>(&_v3);
            let _v5 = get_global_subaccount_manager_signer();
            let _v6 = object::create_named_object(&_v5, _v4);
            let _v7 = &_v5;
            let _v8 = object::address_to_object<object::ObjectCore>(object::address_from_constructor_ref(&_v6));
            object::transfer<object::ObjectCore>(_v7, _v8, p0);
            _v1 = _v6
        } else _v1 = object::create_object(p0);
        let _v9 = object::generate_transfer_ref(&_v1);
        object::disable_ungated_transfer(&_v9);
        let _v10 = object::generate_extend_ref(&_v1);
        let _v11 = object::generate_signer_for_extending(&_v10);
        let _v12 = object::address_from_constructor_ref(&_v1);
        let _v13 = &_v11;
        let _v14 = big_ordered_map::new_with_config<address,DelegatedPermissions>(0u16, 16u16, false);
        let _v15 = Subaccount::V1{extend_ref: _v10, delegated_permissions: _v14, is_active: true};
        move_to<Subaccount>(_v13, _v15);
        assert!(exists<GlobalDexAccountsConfig>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88), 19);
        let _v16 = &borrow_global<GlobalDexAccountsConfig>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).restricted_perp_api;
        let _v17 = &_v11;
        perp_engine_api::init_user_if_new(_v16, _v17, p0);
        event::emit<SubaccountCreatedEvent>(SubaccountCreatedEvent::V1{subaccount: _v12, owner: p0, is_primary: _v0, seed: p1});
        object::address_to_object<Subaccount>(_v12)
    }
    public fun create_new_subaccount_object(p0: &signer): object::Object<Subaccount>
        acquires GlobalDexAccountsConfig
    {
        create_secondary_subaccount_internal(signer::address_of(p0))
    }
    fun create_secondary_subaccount_internal(p0: address): object::Object<Subaccount>
        acquires GlobalDexAccountsConfig
    {
        let _v0 = option::none<vector<u8>>();
        create_subaccount_internal_with_seed(p0, _v0)
    }
    fun create_primary_subaccount_internal(p0: address): object::Object<Subaccount>
        acquires GlobalDexAccountsConfig
    {
        let _v0 = option::some<vector<u8>>(vector[112u8, 114u8, 105u8, 109u8, 97u8, 114u8, 121u8, 95u8, 115u8, 117u8, 98u8, 97u8, 99u8, 99u8, 111u8, 117u8, 110u8, 116u8]);
        create_subaccount_internal_with_seed(p0, _v0)
    }
    public fun create_primary_subaccount_object(p0: address): object::Object<Subaccount>
        acquires GlobalDexAccountsConfig
    {
        create_primary_subaccount_internal(p0)
    }
    fun get_global_subaccount_manager_signer(): signer
        acquires GlobalDexAccountsConfig
    {
        object::generate_signer_for_extending(&borrow_global<GlobalDexAccountsConfig>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).subaccount_manager_extend_ref)
    }
    friend fun deactivate_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: bool)
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
    friend fun revoke_all_delegations(p0: &signer, p1: object::Object<Subaccount>)
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
        _v1 = object::object_address<Subaccount>(&p1);
        let _v7 = &mut _v6.delegated_permissions;
        while (!big_ordered_map::is_empty<address,DelegatedPermissions>(freeze(_v7))) {
            let (_v8,_v9) = big_ordered_map::pop_front<address,DelegatedPermissions>(_v7);
            let _v10 = option::none<PermissionType>();
            let _v11 = option::none<u64>();
            event::emit<DelegationChangedEvent>(DelegationChangedEvent::V1{subaccount: _v1, delegated_account: _v8, delegation: _v10, expiration_time_s: _v11});
            continue
        };
    }
    friend fun delegate_ability_to_sub_delegate_to_for_subaccount(p0: &signer, p1: address, p2: address, p3: option::Option<u64>)
        acquires GlobalDexAccountsConfig, Subaccount
    {
        let _v0 = PermissionType::SubDelegate{};
        check_and_delegate_permission(p0, p1, p2, _v0, p3);
    }
    public fun delegate_onchain_account_permissions(p0: &object::ExtendRef, p1: address, p2: address, p3: bool, p4: bool, p5: bool, p6: bool, p7: option::Option<u64>)
        acquires GlobalDexAccountsConfig, Subaccount
    {
        let _v0 = object::generate_signer_for_extending(p0);
        let _v1 = option::some<address>(signer::address_of(&_v0));
        let _v2 = get_subaccount_object_unpermissioned(p1, _v1);
        let _v3 = &_v0;
        let _v4 = _v2;
        p1 = signer::address_of(_v3);
        assert!(object::is_owner<Subaccount>(_v4, p1), 1);
        let _v5 = _v4;
        let _v6 = object::object_address<Subaccount>(&_v5);
        assert!(*&borrow_global<Subaccount>(_v6).is_active, 15);
        if (p3) {
            let _v7 = PermissionType::TradePerpsAllMarkets{};
            add_delegated_permission(_v2, p2, _v7, p7)
        };
        if (p4) {
            let _v8 = PermissionType::TradeVaultTokens{};
            add_delegated_permission(_v2, p2, _v8, p7)
        };
        if (p5) {
            let _v9 = PermissionType::SubDelegate{};
            add_delegated_permission(_v2, p2, _v9, p7)
        };
        if (p6) {
            let _v10 = PermissionType::SubaccountFundsMovement{};
            add_delegated_permission(_v2, p2, _v10, p7);
            return ()
        };
    }
    friend fun delegate_trading_to_for_subaccount(p0: &signer, p1: address, p2: address, p3: option::Option<u64>)
        acquires GlobalDexAccountsConfig, Subaccount
    {
        let _v0 = PermissionType::TradePerpsAllMarkets{};
        check_and_delegate_permission(p0, p1, p2, _v0, p3);
        let _v1 = PermissionType::TradeVaultTokens{};
        check_and_delegate_permission(p0, p1, p2, _v1, p3);
    }
    public fun deposit_funds_to_subaccount(p0: address, p1: fungible_asset::FungibleAsset, p2: option::Option<address>)
        acquires GlobalDexAccountsConfig, Subaccount
    {
        let _v0 = get_subaccount_object_unpermissioned(p0, p2);
        assert_subaccount_is_active(_v0);
        if (option::is_some<address>(&p2)) {
            let _v1 = *option::borrow<address>(&p2);
            assert!(object::is_owner<Subaccount>(_v0, _v1), 1)
        };
        account_management_apis::deposit(p0, p1);
    }
    public fun deposit_to_subaccount_at(p0: &signer, p1: address, p2: object::Object<fungible_asset::Metadata>, p3: u64)
        acquires GlobalDexAccountsConfig, Subaccount
    {
        let _v0 = primary_fungible_store::withdraw<fungible_asset::Metadata>(p0, p2, p3);
        let _v1 = option::some<address>(signer::address_of(p0));
        deposit_funds_to_subaccount(p1, _v0, _v1);
    }
    public fun primary_subaccount(p0: address): address {
        let _v0 = global_subaccount_manager_address();
        let _v1 = &_v0;
        let _v2 = SubaccountSeed{owner_addr: p0, seed: vector[112u8, 114u8, 105u8, 109u8, 97u8, 114u8, 121u8, 95u8, 115u8, 117u8, 98u8, 97u8, 99u8, 99u8, 111u8, 117u8, 110u8, 116u8]};
        let _v3 = bcs::to_bytes<SubaccountSeed>(&_v2);
        object::create_object_address(_v1, _v3)
    }
    friend fun get_subaccount_signer_if_owner(p0: &signer, p1: object::Object<Subaccount>): signer
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
    fun global_subaccount_manager_address(): address {
        let _v0 = @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88;
        object::create_object_address(&_v0, vector[71u8, 108u8, 111u8, 98u8, 97u8, 108u8, 83u8, 117u8, 98u8, 97u8, 99u8, 99u8, 111u8, 117u8, 110u8, 116u8, 77u8, 97u8, 110u8, 97u8, 103u8, 101u8, 114u8])
    }
    public fun place_perp_order_to_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<perp_market::PerpMarket>, p3: perp_order::PerpOrderRequestCommonArgs, p4: bool, p5: option::Option<u64>, p6: perp_order::PerpOrderRequestTpSlArgs, p7: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderId
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(p0, p1, p2);
        let _v1 = &_v0;
        order_apis::place_order(p2, _v1, p3, p4, p5, p6, p7)
    }
    public fun primary_subaccount_object(p0: address): object::Object<Subaccount> {
        object::address_to_object<Subaccount>(primary_subaccount(p0))
    }
    friend fun reactivate_subaccount(p0: &signer, p1: object::Object<Subaccount>)
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
    friend fun revoke_delegation(p0: &signer, p1: object::Object<Subaccount>, p2: address)
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
    public fun seeded_subacccount_address(p0: address, p1: vector<u8>): address {
        let _v0 = global_subaccount_manager_address();
        let _v1 = &_v0;
        let _v2 = SubaccountSeed{owner_addr: p0, seed: p1};
        let _v3 = bcs::to_bytes<SubaccountSeed>(&_v2);
        object::create_object_address(_v1, _v3)
    }
    friend fun subaccount_exists(p0: address): bool {
        object::object_exists<Subaccount>(p0)
    }
    public fun transfer_collateral_between_subaccounts(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<Subaccount>, p3: object::Object<fungible_asset::Metadata>, p4: u64)
        acquires Subaccount
    {
        let _v0 = object::owner<Subaccount>(p1);
        let _v1 = object::owner<Subaccount>(p2);
        assert!(_v0 == _v1, 14);
        let _v2 = get_subaccount_signer_if_owner_or_delegated_for_subaccount_funds_movement(p0, p1);
        let _v3 = account_management_apis::withdraw_fungible(&_v2, p3, p4);
        account_management_apis::deposit(object::object_address<Subaccount>(&p2), _v3);
    }
    public fun view_delegated_permissions(p0: object::Object<Subaccount>): ordered_map::OrderedMap<address, DelegatedPermissions>
        acquires Subaccount
    {
        let _v0 = p0;
        let _v1 = object::object_address<Subaccount>(&_v0);
        big_ordered_map::to_ordered_map<address,DelegatedPermissions>(&borrow_global<Subaccount>(_v1).delegated_permissions)
    }
    public fun view_is_subaccount_active(p0: object::Object<Subaccount>): bool
        acquires Subaccount
    {
        let _v0 = p0;
        let _v1 = object::object_address<Subaccount>(&_v0);
        *&borrow_global<Subaccount>(_v1).is_active
    }
    public fun withdraw_from_subaccount(p0: &signer, p1: object::Object<Subaccount>, p2: object::Object<fungible_asset::Metadata>, p3: u64): bool
        acquires Subaccount
    {
        let _v0 = get_subaccount_signer_if_owner(p0, p1);
        let _v1 = account_management_apis::withdraw_fungible(&_v0, p2, p3);
        primary_fungible_store::deposit(signer::address_of(p0), _v1);
        true
    }
    public fun withdraw_onchain_account_funds_from_subaccount(p0: &object::ExtendRef, p1: object::Object<Subaccount>, p2: object::Object<fungible_asset::Metadata>, p3: u64): fungible_asset::FungibleAsset
        acquires Subaccount
    {
        let _v0 = object::generate_signer_for_extending(p0);
        let _v1 = get_subaccount_signer_if_owner(&_v0, p1);
        account_management_apis::withdraw_fungible(&_v1, p2, p3)
    }
}
