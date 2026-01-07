module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::vault_share_asset {
    use 0x1::table;
    use 0x1::fungible_asset;
    use 0x1::object;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::decibel_time;
    use 0x1::primary_fungible_store;
    use 0x1::vector;
    use 0x1::string;
    use 0x1::option;
    use 0x1::string_utils;
    use 0x1::function_info;
    use 0x1::dispatchable_fungible_asset;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::vault_global_config;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::vault;
    struct LockedEntry has copy, drop, store {
        amount: u64,
        unlock_time_s: u64,
    }
    struct PrimaryStoreLockups has drop, store {
        contribution_lockup_entries: vector<LockedEntry>,
    }
    struct VaultLockupRegistry has key {
        primary_store_lockups: table::Table<address, PrimaryStoreLockups>,
    }
    struct VaultShareConfig has key {
        mint_ref: fungible_asset::MintRef,
        burn_ref: fungible_asset::BurnRef,
        transfer_ref: fungible_asset::TransferRef,
        vault_ref: object::ExtendRef,
        contribution_lockup_duration_s: u64,
    }
    fun add_lockup_entry(p0: address, p1: address, p2: u64, p3: u64): u64
        acquires VaultLockupRegistry
    {
        let _v0;
        let _v1;
        let _v2 = p3 == 0;
        'l0: loop {
            let _v3;
            loop {
                if (!_v2) {
                    _v1 = decibel_time::now_seconds() + p3;
                    let _v4 = borrow_global_mut<VaultLockupRegistry>(p0);
                    if (!table::contains<address,PrimaryStoreLockups>(&_v4.primary_store_lockups, p1)) {
                        let _v5 = &mut _v4.primary_store_lockups;
                        let _v6 = PrimaryStoreLockups{contribution_lockup_entries: vector::empty<LockedEntry>()};
                        table::add<address,PrimaryStoreLockups>(_v5, p1, _v6)
                    };
                    _v0 = table::borrow_mut<address,PrimaryStoreLockups>(&mut _v4.primary_store_lockups, p1);
                    let _v7 = vector::length<LockedEntry>(&_v0.contribution_lockup_entries);
                    if (!(_v7 > 0)) break 'l0;
                    let _v8 = &mut _v0.contribution_lockup_entries;
                    let _v9 = _v7 - 1;
                    _v3 = vector::borrow_mut<LockedEntry>(_v8, _v9);
                    p3 = p3 * 10 / 100;
                    let _v10 = *&_v3.unlock_time_s + p3;
                    if (_v1 <= _v10) break;
                    break 'l0
                };
                return 0
            };
            let _v11 = &mut _v3.amount;
            *_v11 = *_v11 + p2;
            return *&_v3.unlock_time_s
        };
        let _v12 = &mut _v0.contribution_lockup_entries;
        let _v13 = LockedEntry{amount: p2, unlock_time_s: _v1};
        vector::push_back<LockedEntry>(_v12, _v13);
        _v1
    }
    friend fun burn_shares(p0: object::Object<fungible_asset::Metadata>, p1: fungible_asset::FungibleAsset)
        acquires VaultShareConfig
    {
        let _v0 = object::object_address<fungible_asset::Metadata>(&p0);
        fungible_asset::burn(&borrow_global<VaultShareConfig>(_v0).burn_ref, p1);
    }
    public fun can_withdraw(p0: object::Object<fungible_asset::Metadata>, p1: address, p2: u64): bool
        acquires VaultLockupRegistry
    {
        let _v0 = primary_fungible_store::primary_store<fungible_asset::Metadata>(p1, p0);
        get_unlocked_balance<fungible_asset::FungibleStore>(p0, _v0) >= p2
    }
    fun get_unlocked_balance<T0: key>(p0: object::Object<fungible_asset::Metadata>, p1: object::Object<T0>): u64
        acquires VaultLockupRegistry
    {
        let _v0;
        let _v1 = object::object_address<fungible_asset::Metadata>(&p0);
        let _v2 = fungible_asset::balance<T0>(p1);
        assert!(exists<VaultLockupRegistry>(_v1), 5);
        let _v3 = object::object_address<T0>(&p1);
        let _v4 = borrow_global<VaultLockupRegistry>(_v1);
        let _v5 = table::contains<address,PrimaryStoreLockups>(&_v4.primary_store_lockups, _v3);
        loop {
            if (_v5) {
                let _v6 = table::borrow<address,PrimaryStoreLockups>(&_v4.primary_store_lockups, _v3);
                let _v7 = decibel_time::now_seconds();
                _v0 = 0;
                let _v8 = *&_v6.contribution_lockup_entries;
                vector::reverse<LockedEntry>(&mut _v8);
                let _v9 = _v8;
                let _v10 = vector::length<LockedEntry>(&_v9);
                while (_v10 > 0) {
                    let _v11 = vector::pop_back<LockedEntry>(&mut _v9);
                    if (*&(&_v11).unlock_time_s > _v7) {
                        let _v12 = *&(&_v11).amount;
                        _v0 = _v0 + _v12
                    };
                    _v10 = _v10 - 1;
                    continue
                };
                vector::destroy_empty<LockedEntry>(_v9);
                if (_v0 <= _v2) break;
                abort 6
            };
            return _v2
        };
        _v2 - _v0
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
    friend fun create_vault_shares(p0: &signer, p1: string::String, p2: string::String, p3: string::String, p4: string::String, p5: u8, p6: u64): object::Object<fungible_asset::Metadata> {
        validate_contribution_lockup_duration(p6);
        let _v0 = object::create_named_object(p0, vector[118u8, 97u8, 117u8, 108u8, 116u8, 95u8, 115u8, 104u8, 97u8, 114u8, 101u8, 95u8, 97u8, 115u8, 115u8, 101u8, 116u8]);
        let _v1 = &_v0;
        let _v2 = option::none<u128>();
        let _v3 = vector[123u8, 125u8, 32u8, 83u8, 104u8, 97u8, 114u8, 101u8];
        let _v4 = string_utils::format1<string::String>(&_v3, p1);
        primary_fungible_store::create_primary_store_enabled_fungible_asset(_v1, _v2, _v4, p2, p5, p3, p4);
        let _v5 = &_v0;
        let _v6 = string::utf8(vector[118u8, 97u8, 117u8, 108u8, 116u8, 95u8, 115u8, 104u8, 97u8, 114u8, 101u8, 95u8, 97u8, 115u8, 115u8, 101u8, 116u8]);
        let _v7 = string::utf8(vector[118u8, 97u8, 117u8, 108u8, 116u8, 95u8, 115u8, 104u8, 97u8, 114u8, 101u8, 95u8, 119u8, 105u8, 116u8, 104u8, 100u8, 114u8, 97u8, 119u8]);
        let _v8 = option::some<function_info::FunctionInfo>(function_info::new_function_info_from_address(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75, _v6, _v7));
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
        let _v18 = VaultShareConfig{mint_ref: _v14, burn_ref: _v15, transfer_ref: _v16, vault_ref: _v17, contribution_lockup_duration_s: p6};
        move_to<VaultShareConfig>(_v13, _v18);
        let _v19 = &_v11;
        let _v20 = VaultLockupRegistry{primary_store_lockups: table::new<address,PrimaryStoreLockups>()};
        move_to<VaultLockupRegistry>(_v19, _v20);
        _v12
    }
    fun validate_contribution_lockup_duration(p0: u64) {
        let _v0 = vault_global_config::get_global_share_config();
        let _v1 = vault_global_config::get_max_contribution_lockup_seconds(&_v0);
        assert!(p0 <= _v1, 4);
    }
    public fun get_user_unlocked_balance(p0: object::Object<fungible_asset::Metadata>, p1: address): u64
        acquires VaultLockupRegistry
    {
        let _v0 = primary_fungible_store::primary_store<fungible_asset::Metadata>(p1, p0);
        get_unlocked_balance<fungible_asset::FungibleStore>(p0, _v0)
    }
    friend fun mint_and_deposit_with_lockup(p0: object::Object<fungible_asset::Metadata>, p1: address, p2: u64): u64
        acquires VaultLockupRegistry, VaultShareConfig
    {
        let _v0 = object::object_address<fungible_asset::Metadata>(&p0);
        let _v1 = borrow_global<VaultShareConfig>(_v0);
        let _v2 = fungible_asset::mint(&_v1.mint_ref, p2);
        let _v3 = primary_fungible_store::primary_store_address<fungible_asset::Metadata>(p1, p0);
        let _v4 = *&_v1.contribution_lockup_duration_s;
        let _v5 = add_lockup_entry(_v0, _v3, p2, _v4);
        primary_fungible_store::deposit(p1, _v2);
        _v5
    }
    friend fun mint_and_deposit_without_lockup(p0: object::Object<fungible_asset::Metadata>, p1: address, p2: u64)
        acquires VaultShareConfig
    {
        let _v0 = object::object_address<fungible_asset::Metadata>(&p0);
        let _v1 = fungible_asset::mint(&borrow_global<VaultShareConfig>(_v0).mint_ref, p2);
        primary_fungible_store::deposit(p1, _v1);
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
