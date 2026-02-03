module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::vault_share_asset {
    use 0x1::table;
    use 0x1::fungible_asset;
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::decibel_time;
    use 0x1::primary_fungible_store;
    use 0x1::vector;
    use 0x1::string;
    use 0x1::option;
    use 0x1::string_utils;
    use 0x1::function_info;
    use 0x1::dispatchable_fungible_asset;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::vault;
    struct LockedEntry has copy, drop, store {
        amount: u64,
        unlock_time_s: u64,
    }
    enum PrimaryStoreLockups has drop, store {
        V1 {
            contribution_lockup_entries: vector<LockedEntry>,
            pending_redemption_amount: u64,
        }
    }
    enum VaultLockupRegistry has key {
        V1 {
            primary_store_lockups: table::Table<address, PrimaryStoreLockups>,
            manager_store_address: address,
            manager_min_amount: u64,
        }
    }
    enum VaultShareConfig has key {
        V1 {
            mint_ref: fungible_asset::MintRef,
            burn_ref: fungible_asset::BurnRef,
            transfer_ref: fungible_asset::TransferRef,
            vault_ref: object::ExtendRef,
        }
    }
    fun add_lockup_entry(p0: object::Object<fungible_asset::Metadata>, p1: address, p2: u64, p3: u64): u64
        acquires VaultLockupRegistry
    {
        let _v0;
        let _v1;
        'l0: loop {
            let _v2;
            loop {
                if (!(p3 == 0)) {
                    let _v3 = object::address_to_object<fungible_asset::FungibleStore>(p1);
                    let _v4 = get_unlocked_balance<fungible_asset::FungibleStore>(p0, _v3);
                    assert!(p2 <= _v4, 3);
                    let _v5 = object::object_address<fungible_asset::Metadata>(&p0);
                    let _v6 = p1;
                    let _v7 = borrow_global_mut<VaultLockupRegistry>(_v5);
                    if (!table::contains<address,PrimaryStoreLockups>(&_v7.primary_store_lockups, _v6)) {
                        let _v8 = &mut _v7.primary_store_lockups;
                        let _v9 = PrimaryStoreLockups::V1{contribution_lockup_entries: vector::empty<LockedEntry>(), pending_redemption_amount: 0};
                        table::add<address,PrimaryStoreLockups>(_v8, _v6, _v9)
                    };
                    _v1 = table::borrow_mut<address,PrimaryStoreLockups>(&mut _v7.primary_store_lockups, _v6);
                    _v0 = decibel_time::now_seconds() + p3;
                    let _v10 = vector::length<LockedEntry>(&_v1.contribution_lockup_entries);
                    if (!(_v10 > 0)) break 'l0;
                    let _v11 = &mut _v1.contribution_lockup_entries;
                    let _v12 = _v10 - 1;
                    _v2 = vector::borrow_mut<LockedEntry>(_v11, _v12);
                    _v10 = p3 * 10 / 100;
                    let _v13 = *&_v2.unlock_time_s + _v10;
                    if (_v0 <= _v13) break;
                    break 'l0
                };
                return 0
            };
            let _v14 = &mut _v2.amount;
            *_v14 = *_v14 + p2;
            return *&_v2.unlock_time_s
        };
        let _v15 = &mut _v1.contribution_lockup_entries;
        let _v16 = LockedEntry{amount: p2, unlock_time_s: _v0};
        vector::push_back<LockedEntry>(_v15, _v16);
        _v0
    }
    fun get_unlocked_balance<T0: key>(p0: object::Object<fungible_asset::Metadata>, p1: object::Object<T0>): u64
        acquires VaultLockupRegistry
    {
        let _v0;
        let _v1;
        let _v2 = object::object_address<fungible_asset::Metadata>(&p0);
        let _v3 = fungible_asset::balance<T0>(p1);
        assert!(exists<VaultLockupRegistry>(_v2), 5);
        let _v4 = object::object_address<T0>(&p1);
        let _v5 = borrow_global<VaultLockupRegistry>(_v2);
        let _v6 = table::contains<address,PrimaryStoreLockups>(&_v5.primary_store_lockups, _v4);
        'l0: loop {
            'l1: loop {
                let _v7;
                loop {
                    if (_v6) {
                        let _v8 = table::borrow<address,PrimaryStoreLockups>(&_v5.primary_store_lockups, _v4);
                        let _v9 = decibel_time::now_seconds();
                        assert!(*&_v8.pending_redemption_amount <= _v3, 6);
                        let _v10 = *&_v8.pending_redemption_amount;
                        _v1 = _v3 - _v10;
                        _v0 = 0;
                        let _v11 = *&_v8.contribution_lockup_entries;
                        vector::reverse<LockedEntry>(&mut _v11);
                        let _v12 = _v11;
                        _v7 = vector::length<LockedEntry>(&_v12);
                        while (_v7 > 0) {
                            let _v13 = vector::pop_back<LockedEntry>(&mut _v12);
                            if (*&(&_v13).unlock_time_s > _v9) {
                                let _v14 = *&(&_v13).amount;
                                _v0 = _v0 + _v14
                            };
                            _v7 = _v7 - 1;
                            continue
                        };
                        vector::destroy_empty<LockedEntry>(_v12);
                        assert!(_v0 <= _v1, 6);
                        if (!(*&_v5.manager_store_address == _v4)) break 'l0;
                        _v7 = *&_v5.manager_min_amount;
                        if (!(_v0 < _v7)) break 'l1;
                        if (!(_v1 < _v7)) break
                    } else return _v3;
                    return 0
                };
                return _v1 - _v7
            };
            return _v1 - _v0
        };
        _v1 - _v0
    }
    friend fun burn_redeemed_shares_from(p0: object::Object<fungible_asset::Metadata>, p1: address, p2: u64)
        acquires VaultLockupRegistry, VaultShareConfig
    {
        p1 = primary_fungible_store::primary_store_address<fungible_asset::Metadata>(p1, p0);
        let _v0 = object::object_address<fungible_asset::Metadata>(&p0);
        let _v1 = p1;
        let _v2 = borrow_global_mut<VaultLockupRegistry>(_v0);
        if (!table::contains<address,PrimaryStoreLockups>(&_v2.primary_store_lockups, _v1)) {
            let _v3 = &mut _v2.primary_store_lockups;
            let _v4 = PrimaryStoreLockups::V1{contribution_lockup_entries: vector::empty<LockedEntry>(), pending_redemption_amount: 0};
            table::add<address,PrimaryStoreLockups>(_v3, _v1, _v4)
        };
        let _v5 = &mut table::borrow_mut<address,PrimaryStoreLockups>(&mut _v2.primary_store_lockups, _v1).pending_redemption_amount;
        *_v5 = *_v5 - p2;
        let _v6 = &borrow_global<VaultShareConfig>(_v0).burn_ref;
        let _v7 = object::address_to_object<fungible_asset::FungibleStore>(p1);
        fungible_asset::burn_from<fungible_asset::FungibleStore>(_v6, _v7, p2);
    }
    public fun can_withdraw(p0: object::Object<fungible_asset::Metadata>, p1: address, p2: u64): bool
        acquires VaultLockupRegistry
    {
        let _v0 = primary_fungible_store::primary_store<fungible_asset::Metadata>(p1, p0);
        get_unlocked_balance<fungible_asset::FungibleStore>(p0, _v0) >= p2
    }
    public fun cleanup_expired_entries(p0: address, p1: address)
        acquires VaultLockupRegistry
    {
        let _v0;
        let _v1;
        let _v2;
        let _v3 = exists<VaultLockupRegistry>(p0);
        'l0: loop {
            loop {
                if (_v3) {
                    let _v4 = borrow_global_mut<VaultLockupRegistry>(p0);
                    if (!table::contains<address,PrimaryStoreLockups>(&_v4.primary_store_lockups, p1)) break;
                    _v0 = table::borrow_mut<address,PrimaryStoreLockups>(&mut _v4.primary_store_lockups, p1);
                    let _v5 = decibel_time::now_seconds();
                    _v2 = vector::empty<LockedEntry>();
                    let _v6 = *&_v0.contribution_lockup_entries;
                    vector::reverse<LockedEntry>(&mut _v6);
                    _v1 = _v6;
                    let _v7 = vector::length<LockedEntry>(&_v1);
                    loop {
                        if (!(_v7 > 0)) break 'l0;
                        let _v8 = vector::pop_back<LockedEntry>(&mut _v1);
                        if (*&(&_v8).unlock_time_s > _v5) vector::push_back<LockedEntry>(&mut _v2, _v8);
                        _v7 = _v7 - 1;
                        continue
                    }
                };
                return ()
            };
            return ()
        };
        vector::destroy_empty<LockedEntry>(_v1);
        let _v9 = &mut _v0.contribution_lockup_entries;
        *_v9 = _v2;
    }
    friend fun create_vault_shares(p0: &signer, p1: string::String, p2: string::String, p3: string::String, p4: string::String, p5: u8): object::Object<fungible_asset::Metadata> {
        let _v0 = object::create_named_object(p0, vector[118u8, 97u8, 117u8, 108u8, 116u8, 95u8, 115u8, 104u8, 97u8, 114u8, 101u8, 95u8, 97u8, 115u8, 115u8, 101u8, 116u8]);
        let _v1 = &_v0;
        let _v2 = option::none<u128>();
        let _v3 = vector[123u8, 125u8, 32u8, 83u8, 104u8, 97u8, 114u8, 101u8];
        let _v4 = string_utils::format1<string::String>(&_v3, p1);
        primary_fungible_store::create_primary_store_enabled_fungible_asset(_v1, _v2, _v4, p2, p5, p3, p4);
        let _v5 = &_v0;
        let _v6 = string::utf8(vector[118u8, 97u8, 117u8, 108u8, 116u8, 95u8, 115u8, 104u8, 97u8, 114u8, 101u8, 95u8, 97u8, 115u8, 115u8, 101u8, 116u8]);
        let _v7 = string::utf8(vector[118u8, 97u8, 117u8, 108u8, 116u8, 95u8, 115u8, 104u8, 97u8, 114u8, 101u8, 95u8, 119u8, 105u8, 116u8, 104u8, 100u8, 114u8, 97u8, 119u8]);
        let _v8 = option::some<function_info::FunctionInfo>(function_info::new_function_info_from_address(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88, _v6, _v7));
        let _v9 = option::none<function_info::FunctionInfo>();
        let _v10 = option::none<function_info::FunctionInfo>();
        dispatchable_fungible_asset::register_dispatch_functions(_v5, _v8, _v9, _v10);
        let _v11 = object::generate_signer(&_v0);
        let _v12 = object::object_from_constructor_ref<fungible_asset::Metadata>(&_v0);
        let _v13 = &_v11;
        let _v14 = fungible_asset::generate_mint_ref(&_v0);
        let _v15 = fungible_asset::generate_burn_ref(&_v0);
        let _v16 = fungible_asset::generate_transfer_ref(&_v0);
        let _v17 = object::generate_extend_ref(&_v0);
        let _v18 = VaultShareConfig::V1{mint_ref: _v14, burn_ref: _v15, transfer_ref: _v16, vault_ref: _v17};
        move_to<VaultShareConfig>(_v13, _v18);
        let _v19 = &_v11;
        let _v20 = VaultLockupRegistry::V1{primary_store_lockups: table::new<address,PrimaryStoreLockups>(), manager_store_address: @0x0, manager_min_amount: 0};
        move_to<VaultLockupRegistry>(_v19, _v20);
        _v12
    }
    fun get_balance_not_leaving<T0: key>(p0: object::Object<fungible_asset::Metadata>, p1: object::Object<T0>): u64
        acquires VaultLockupRegistry
    {
        let _v0 = object::object_address<fungible_asset::Metadata>(&p0);
        let _v1 = fungible_asset::balance<T0>(p1);
        assert!(exists<VaultLockupRegistry>(_v0), 5);
        let _v2 = object::object_address<T0>(&p1);
        let _v3 = borrow_global<VaultLockupRegistry>(_v0);
        if (!table::contains<address,PrimaryStoreLockups>(&_v3.primary_store_lockups, _v2)) return _v1;
        let _v4 = *&table::borrow<address,PrimaryStoreLockups>(&_v3.primary_store_lockups, _v2).pending_redemption_amount;
        _v1 - _v4
    }
    public fun get_user_unlocked_balance(p0: object::Object<fungible_asset::Metadata>, p1: address): u64
        acquires VaultLockupRegistry
    {
        let _v0 = primary_fungible_store::primary_store<fungible_asset::Metadata>(p1, p0);
        get_unlocked_balance<fungible_asset::FungibleStore>(p0, _v0)
    }
    friend fun lock_for_redemption(p0: object::Object<fungible_asset::Metadata>, p1: address, p2: u64)
        acquires VaultLockupRegistry
    {
        p1 = primary_fungible_store::primary_store_address<fungible_asset::Metadata>(p1, p0);
        let _v0 = object::address_to_object<fungible_asset::FungibleStore>(p1);
        let _v1 = get_unlocked_balance<fungible_asset::FungibleStore>(p0, _v0);
        assert!(p2 <= _v1, 3);
        let _v2 = object::object_address<fungible_asset::Metadata>(&p0);
        let _v3 = p1;
        let _v4 = borrow_global_mut<VaultLockupRegistry>(_v2);
        if (!table::contains<address,PrimaryStoreLockups>(&_v4.primary_store_lockups, _v3)) {
            let _v5 = &mut _v4.primary_store_lockups;
            let _v6 = PrimaryStoreLockups::V1{contribution_lockup_entries: vector::empty<LockedEntry>(), pending_redemption_amount: 0};
            table::add<address,PrimaryStoreLockups>(_v5, _v3, _v6)
        };
        let _v7 = &mut table::borrow_mut<address,PrimaryStoreLockups>(&mut _v4.primary_store_lockups, _v3).pending_redemption_amount;
        *_v7 = *_v7 + p2;
    }
    friend fun mint_and_deposit_with_lockup(p0: object::Object<fungible_asset::Metadata>, p1: address, p2: u64, p3: u64): u64
        acquires VaultLockupRegistry, VaultShareConfig
    {
        let _v0 = object::object_address<fungible_asset::Metadata>(&p0);
        let _v1 = fungible_asset::mint(&borrow_global<VaultShareConfig>(_v0).mint_ref, p2);
        let _v2 = primary_fungible_store::primary_store_address<fungible_asset::Metadata>(p1, p0);
        primary_fungible_store::deposit(p1, _v1);
        add_lockup_entry(p0, _v2, p2, p3)
    }
    friend fun mint_and_deposit_without_lockup(p0: object::Object<fungible_asset::Metadata>, p1: address, p2: u64)
        acquires VaultShareConfig
    {
        let _v0 = object::object_address<fungible_asset::Metadata>(&p0);
        let _v1 = fungible_asset::mint(&borrow_global<VaultShareConfig>(_v0).mint_ref, p2);
        primary_fungible_store::deposit(p1, _v1);
    }
    friend fun update_manager_min_amount(p0: object::Object<fungible_asset::Metadata>, p1: address, p2: u64, p3: bool): bool
        acquires VaultLockupRegistry
    {
        let _v0;
        let _v1;
        p1 = primary_fungible_store::primary_store_address<fungible_asset::Metadata>(p1, p0);
        if (object::object_exists<fungible_asset::FungibleStore>(p1)) {
            let _v2 = object::address_to_object<fungible_asset::FungibleStore>(p1);
            _v1 = get_balance_not_leaving<fungible_asset::FungibleStore>(p0, _v2)
        } else _v1 = 0;
        let _v3 = p2 <= _v1;
        if (_v3) _v0 = false else _v0 = p3;
        if (_v0) {
            let _v4 = object::object_address<fungible_asset::Metadata>(&p0);
            let _v5 = borrow_global_mut<VaultLockupRegistry>(_v4);
            let _v6 = &mut _v5.manager_store_address;
            *_v6 = p1;
            let _v7 = &mut _v5.manager_min_amount;
            *_v7 = p2
        };
        _v3
    }
    public fun vault_share_withdraw<T0: key>(p0: object::Object<T0>, p1: u64, p2: &fungible_asset::TransferRef): fungible_asset::FungibleAsset
        acquires VaultLockupRegistry
    {
        let _v0 = object::object_address<T0>(&p0);
        let _v1 = fungible_asset::store_metadata<T0>(p0);
        assert!(get_unlocked_balance<T0>(_v1, p0) >= p1, 3);
        cleanup_expired_entries(object::object_address<fungible_asset::Metadata>(&_v1), _v0);
        fungible_asset::withdraw_with_ref<T0>(p2, p0, p1)
    }
}
