module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::usdc {
    use 0x1::smart_table;
    use 0x1::fungible_asset;
    use 0x1::object;
    use 0x1::primary_fungible_store;
    use 0x1::signer;
    use 0x1::timestamp;
    use 0x1::option;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::dex_accounts;
    use 0x1::string;
    struct AdminConfig has key {
        admins: smart_table::SmartTable<address, bool>,
        admin_count: u64,
        allow_public_minting: bool,
    }
    struct DailyRestrictedMint has store {
        trigger_reset_mint_ts: u64,
        mints_per_day: u64,
        remaining_mints: u64,
    }
    struct RestrictedMint has key {
        total_restricted_mint_per_owner: smart_table::SmartTable<address, u64>,
        total_restricted_mint_limit: u64,
        daily_restricted_mint: DailyRestrictedMint,
    }
    struct USDCRef has key {
        mint_ref: fungible_asset::MintRef,
        burn_ref: fungible_asset::BurnRef,
        transfer_ref: fungible_asset::TransferRef,
        metadata: object::Object<fungible_asset::Metadata>,
    }
    public fun metadata(): object::Object<fungible_asset::Metadata>
        acquires USDCRef
    {
        *&borrow_global<USDCRef>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).metadata
    }
    public entry fun burn(p0: address, p1: u64)
        acquires USDCRef
    {
        let _v0 = borrow_global<USDCRef>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        let _v1 = *&_v0.metadata;
        let _v2 = primary_fungible_store::ensure_primary_store_exists<fungible_asset::Metadata>(p0, _v1);
        fungible_asset::burn_from<fungible_asset::FungibleStore>(&_v0.burn_ref, _v2, p1);
    }
    public fun transfer(p0: &signer, p1: address, p2: u64)
        acquires USDCRef
    {
        let _v0 = *&borrow_global<USDCRef>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).metadata;
        primary_fungible_store::transfer<fungible_asset::Metadata>(p0, _v0, p1, p2);
    }
    public fun balance(p0: address): u64
        acquires USDCRef
    {
        let _v0 = *&borrow_global<USDCRef>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).metadata;
        primary_fungible_store::balance<fungible_asset::Metadata>(p0, _v0)
    }
    public fun deposit(p0: address, p1: fungible_asset::FungibleAsset) {
        primary_fungible_store::deposit(p0, p1);
    }
    public entry fun mint(p0: &signer, p1: address, p2: u64)
        acquires AdminConfig, USDCRef
    {
        let _v0;
        let _v1 = signer::address_of(p0);
        let _v2 = borrow_global<AdminConfig>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        if (smart_table::contains<address,bool>(&_v2.admins, _v1)) _v0 = true else _v0 = *&_v2.allow_public_minting;
        assert!(_v0, 2);
        primary_fungible_store::mint(&borrow_global<USDCRef>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).mint_ref, p1, p2);
    }
    public fun withdraw(p0: &signer, p1: u64): fungible_asset::FungibleAsset
        acquires USDCRef
    {
        let _v0 = *&borrow_global<USDCRef>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).metadata;
        primary_fungible_store::withdraw<fungible_asset::Metadata>(p0, _v0, p1)
    }
    fun init_module(p0: &signer) {
        setup_usdc(p0);
    }
    public fun setup_usdc(p0: &signer) {
        let _v0 = object::create_named_object(p0, vector[85u8, 83u8, 68u8, 67u8]);
        let _v1 = &_v0;
        let _v2 = option::none<u128>();
        let _v3 = string::utf8(vector[85u8, 83u8, 68u8, 67u8]);
        let _v4 = string::utf8(vector[85u8, 83u8, 68u8, 67u8]);
        let _v5 = string::utf8(vector[104u8, 116u8, 116u8, 112u8, 115u8, 58u8, 47u8, 47u8, 99u8, 105u8, 114u8, 99u8, 108u8, 101u8, 46u8, 99u8, 111u8, 109u8, 47u8, 117u8, 115u8, 100u8, 99u8, 45u8, 105u8, 99u8, 111u8, 110u8]);
        let _v6 = string::utf8(vector[104u8, 116u8, 116u8, 112u8, 115u8, 58u8, 47u8, 47u8, 99u8, 105u8, 114u8, 99u8, 108u8, 101u8, 46u8, 99u8, 111u8, 109u8, 47u8, 117u8, 115u8, 100u8, 99u8]);
        primary_fungible_store::create_primary_store_enabled_fungible_asset(_v1, _v2, _v3, _v4, 6u8, _v5, _v6);
        let _v7 = fungible_asset::generate_mint_ref(&_v0);
        let _v8 = fungible_asset::generate_burn_ref(&_v0);
        let _v9 = fungible_asset::generate_transfer_ref(&_v0);
        let _v10 = object::object_from_constructor_ref<fungible_asset::Metadata>(&_v0);
        let _v11 = USDCRef{mint_ref: _v7, burn_ref: _v8, transfer_ref: _v9, metadata: _v10};
        move_to<USDCRef>(p0, _v11);
        let _v12 = smart_table::new<address,bool>();
        let _v13 = signer::address_of(p0);
        smart_table::add<address,bool>(&mut _v12, _v13, true);
        let _v14 = AdminConfig{admins: _v12, admin_count: 1, allow_public_minting: true};
        move_to<AdminConfig>(p0, _v14);
        let _v15 = smart_table::new<address,u64>();
        let _v16 = DailyRestrictedMint{trigger_reset_mint_ts: timestamp::now_seconds(), mints_per_day: 1000, remaining_mints: 1000};
        let _v17 = RestrictedMint{total_restricted_mint_per_owner: _v15, total_restricted_mint_limit: 250000000, daily_restricted_mint: _v16};
        move_to<RestrictedMint>(p0, _v17);
    }
    public entry fun add_admin(p0: &signer, p1: address)
        acquires AdminConfig
    {
        let _v0 = signer::address_of(p0);
        let _v1 = borrow_global_mut<AdminConfig>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        assert!(smart_table::contains<address,bool>(&_v1.admins, _v0), 1);
        if (!smart_table::contains<address,bool>(&_v1.admins, p1)) {
            smart_table::add<address,bool>(&mut _v1.admins, p1, true);
            let _v2 = &mut _v1.admin_count;
            *_v2 = *_v2 + 1;
            return ()
        };
    }
    public entry fun remove_admin(p0: &signer, p1: address)
        acquires AdminConfig
    {
        let _v0 = signer::address_of(p0);
        let _v1 = borrow_global_mut<AdminConfig>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        assert!(smart_table::contains<address,bool>(&_v1.admins, _v0), 1);
        assert!(*&_v1.admin_count > 1, 3);
        if (smart_table::contains<address,bool>(&_v1.admins, p1)) {
            let _v2 = smart_table::remove<address,bool>(&mut _v1.admins, p1);
            let _v3 = &mut _v1.admin_count;
            *_v3 = *_v3 - 1;
            return ()
        };
    }
    public fun available_restricted_mint_for(p0: address): u64
        acquires RestrictedMint
    {
        let _v0;
        let _v1 = borrow_global<RestrictedMint>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        let _v2 = timestamp::now_seconds();
        let _v3 = &_v1.total_restricted_mint_per_owner;
        let _v4 = 0;
        let _v5 = &_v4;
        let _v6 = *smart_table::borrow_with_default<address,u64>(_v3, p0, _v5) + 86400;
        if (_v2 >= _v6) _v0 = *&_v1.total_restricted_mint_limit else _v0 = 0;
        _v0
    }
    public fun can_mint(p0: address): bool
        acquires AdminConfig
    {
        let _v0 = borrow_global<AdminConfig>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        if (smart_table::contains<address,bool>(&_v0.admins, p0)) return true;
        *&_v0.allow_public_minting
    }
    public fun can_restricted_mint(p0: address): bool
        acquires RestrictedMint
    {
        let _v0;
        let _v1 = borrow_global<RestrictedMint>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        let _v2 = timestamp::now_seconds();
        if (*&(&_v1.daily_restricted_mint).remaining_mints > 0) _v0 = true else {
            let _v3 = *&(&_v1.daily_restricted_mint).trigger_reset_mint_ts;
            _v0 = _v2 >= _v3
        };
        let _v4 = &_v1.total_restricted_mint_per_owner;
        let _v5 = 0;
        let _v6 = &_v5;
        let _v7 = *smart_table::borrow_with_default<address,u64>(_v4, p0, _v6) + 86400;
        if (_v2 >= _v7) return _v0;
        false
    }
    public entry fun change_restricted_mint_settings(p0: &signer, p1: option::Option<u64>, p2: option::Option<u64>, p3: option::Option<u64>)
        acquires AdminConfig, RestrictedMint
    {
        let _v0 = borrow_global<AdminConfig>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        let _v1 = signer::address_of(p0);
        assert!(smart_table::contains<address,bool>(&_v0.admins, _v1), 1);
        let _v2 = borrow_global_mut<RestrictedMint>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        if (option::is_some<u64>(&p1)) {
            let _v3 = option::extract<u64>(&mut p1);
            let _v4 = &mut _v2.total_restricted_mint_limit;
            *_v4 = _v3
        };
        if (option::is_some<u64>(&p2)) {
            let _v5 = option::extract<u64>(&mut p2);
            let _v6 = &mut (&mut _v2.daily_restricted_mint).mints_per_day;
            *_v6 = _v5
        };
        if (option::is_some<u64>(&p3)) {
            let _v7 = option::extract<u64>(&mut p3);
            let _v8 = &mut (&mut _v2.daily_restricted_mint).trigger_reset_mint_ts;
            *_v8 = _v7;
            return ()
        };
    }
    fun check_and_update_daily_limit(p0: &mut DailyRestrictedMint, p1: bool) {
        let _v0 = timestamp::now_seconds();
        let _v1 = *&p0.trigger_reset_mint_ts;
        if (_v0 >= _v1) {
            let _v2 = _v0 + 86400;
            let _v3 = &mut p0.trigger_reset_mint_ts;
            *_v3 = _v2;
            let _v4 = *&p0.mints_per_day;
            let _v5 = &mut p0.remaining_mints;
            *_v5 = _v4
        };
        if (p1) {
            assert!(*&p0.remaining_mints - 1 > 0, 4);
            let _v6 = &mut p0.remaining_mints;
            *_v6 = *_v6 - 1;
            return ()
        };
    }
    fun check_and_update_recipient_limit_for(p0: &mut RestrictedMint, p1: address) {
        let _v0 = timestamp::now_seconds();
        let _v1 = &p0.total_restricted_mint_per_owner;
        let _v2 = 0;
        let _v3 = &_v2;
        let _v4 = *smart_table::borrow_with_default<address,u64>(_v1, p1, _v3) + 86400;
        assert!(_v0 > _v4, 5);
        smart_table::upsert<address,u64>(&mut p0.total_restricted_mint_per_owner, p1, _v0);
    }
    fun check_and_update_recipient_limit_for_amount(p0: &mut RestrictedMint, p1: address, p2: u64) {
        let _v0 = &p0.total_restricted_mint_per_owner;
        let _v1 = 0;
        let _v2 = &_v1;
        let _v3 = *smart_table::borrow_with_default<address,u64>(_v0, p1, _v2);
        let _v4 = _v3 + p2;
        let _v5 = *&p0.total_restricted_mint_limit;
        assert!(_v4 <= _v5, 5);
        let _v6 = &mut p0.total_restricted_mint_per_owner;
        let _v7 = _v3 + p2;
        smart_table::upsert<address,u64>(_v6, p1, _v7);
    }
    public entry fun enter_trading_competition(p0: &signer)
        acquires USDCRef
    {
        dex_accounts::create_new_seeded_subaccount(p0, vector[116u8, 114u8, 97u8, 100u8, 105u8, 110u8, 103u8, 95u8, 99u8, 111u8, 109u8, 112u8, 101u8, 116u8, 105u8, 116u8, 105u8, 111u8, 110u8]);
        let _v0 = signer::address_of(p0);
        let _v1 = object::create_object_address(&_v0, vector[116u8, 114u8, 97u8, 100u8, 105u8, 110u8, 103u8, 95u8, 99u8, 111u8, 109u8, 112u8, 101u8, 116u8, 105u8, 116u8, 105u8, 111u8, 110u8]);
        let _v2 = borrow_global<USDCRef>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        primary_fungible_store::mint(&_v2.mint_ref, _v0, 10000000000);
        let _v3 = *&_v2.metadata;
        dex_accounts::deposit_to_subaccount_at(p0, _v1, _v3, 10000000000);
    }
    public fun get_admin_count(): u64
        acquires AdminConfig
    {
        *&borrow_global<AdminConfig>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).admin_count
    }
    public fun is_admin(p0: address): bool
        acquires AdminConfig
    {
        smart_table::contains<address,bool>(&borrow_global<AdminConfig>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).admins, p0)
    }
    public fun is_public_minting_allowed(): bool
        acquires AdminConfig
    {
        *&borrow_global<AdminConfig>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).allow_public_minting
    }
    public fun mints_remaining(): u64
        acquires RestrictedMint
    {
        let _v0;
        let _v1 = borrow_global<RestrictedMint>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        let _v2 = timestamp::now_seconds();
        let _v3 = *&(&_v1.daily_restricted_mint).trigger_reset_mint_ts;
        if (_v2 >= _v3) _v0 = *&(&_v1.daily_restricted_mint).mints_per_day else _v0 = *&(&_v1.daily_restricted_mint).remaining_mints;
        _v0
    }
    public entry fun restricted_mint(p0: &signer, p1: u64)
        acquires RestrictedMint, USDCRef
    {
        let _v0 = signer::address_of(p0);
        let _v1 = borrow_global_mut<RestrictedMint>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        let _v2 = *&_v1.total_restricted_mint_limit;
        assert!(p1 <= _v2, 5);
        let _v3 = !smart_table::contains<address,u64>(&_v1.total_restricted_mint_per_owner, _v0);
        check_and_update_daily_limit(&mut _v1.daily_restricted_mint, _v3);
        check_and_update_recipient_limit_for(_v1, _v0);
        primary_fungible_store::mint(&borrow_global<USDCRef>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).mint_ref, _v0, p1);
    }
    public fun restricted_mint_daily_reset_timestamp(): u64
        acquires RestrictedMint
    {
        *&(&borrow_global<RestrictedMint>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).daily_restricted_mint).trigger_reset_mint_ts
    }
    public fun restricted_mint_daily_reset_timestamp_for(p0: address): u64
        acquires RestrictedMint
    {
        let _v0 = &borrow_global<RestrictedMint>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).total_restricted_mint_per_owner;
        let _v1 = 0;
        let _v2 = &_v1;
        *smart_table::borrow_with_default<address,u64>(_v0, p0, _v2) + 86400
    }
    public entry fun set_public_minting(p0: &signer, p1: bool)
        acquires AdminConfig
    {
        let _v0 = signer::address_of(p0);
        let _v1 = borrow_global_mut<AdminConfig>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        assert!(smart_table::contains<address,bool>(&_v1.admins, _v0), 1);
        let _v2 = &mut _v1.allow_public_minting;
        *_v2 = p1;
    }
}
