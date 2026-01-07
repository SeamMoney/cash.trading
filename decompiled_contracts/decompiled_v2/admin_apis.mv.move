module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::admin_apis {
    use 0x1::ordered_map;
    use 0x1::object;
    use 0x1::fungible_asset;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::decibel_time;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::trading_fees_manager;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market;
    use 0x1::option;
    use 0x1::string;
    use 0x1::signer;
    use 0x1::timestamp;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::price_management;
    enum StoredPermission has copy, drop, store {
        Unlimited,
        UnlimitedUntil {
            _0: u64,
        }
    }
    enum AdminPermissionType has copy, drop, store {
        Admin,
        ElevatedAdmin,
        OracleAndMarkUpdate,
    }
    enum DelegatedAdminPermissions has key {
        V1 {
            delegated_permissions: ordered_map::OrderedMap<address, DelegatedPermissions>,
        }
    }
    enum DelegatedPermissions has copy, drop, store {
        V1 {
            perms: ordered_map::OrderedMap<AdminPermissionType, StoredPermission>,
        }
    }
    public entry fun initialize(p0: &signer, p1: object::Object<fungible_asset::Metadata>, p2: u8, p3: address) {
        assert_deployer_capability(p0);
        let _v0 = DelegatedAdminPermissions::V1{delegated_permissions: ordered_map::new<address,DelegatedPermissions>()};
        move_to<DelegatedAdminPermissions>(p0, _v0);
        perp_engine::initialize(p0, p1, p2, p3);
    }
    fun assert_deployer_capability(p0: &signer) {
        assert!(is_deployer(p0), 1);
    }
    public entry fun increment_time(p0: &signer) {
        decibel_time::increment_time(p0);
    }
    public entry fun update_fee_config(p0: &signer, p1: vector<u128>, p2: vector<u64>, p3: vector<u64>, p4: u128, p5: vector<u64>, p6: vector<u64>, p7: u64, p8: u64, p9: bool, p10: u64, p11: u64, p12: u128, p13: u128)
        acquires DelegatedAdminPermissions
    {
        assert_admin_capability(p0);
        trading_fees_manager::update_fee_config(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13);
    }
    fun assert_admin_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0;
        let _v1;
        if (is_deployer(p0)) _v1 = true else {
            let _v2 = AdminPermissionType::ElevatedAdmin{};
            _v1 = has_permission(p0, _v2)
        };
        if (_v1) _v0 = true else {
            let _v3 = AdminPermissionType::Admin{};
            _v0 = has_permission(p0, _v3)
        };
        assert!(_v0, 3);
    }
    public entry fun delist_market(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: option::Option<string::String>)
        acquires DelegatedAdminPermissions
    {
        assert_admin_elevated_capability(p0);
        perp_engine::delist_market(p1, p2);
    }
    fun assert_admin_elevated_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0;
        if (is_deployer(p0)) _v0 = true else {
            let _v1 = AdminPermissionType::ElevatedAdmin{};
            _v0 = has_permission(p0, _v1)
        };
        assert!(_v0, 2);
    }
    public entry fun drain_async_queue(p0: &signer, p1: object::Object<perp_market::PerpMarket>)
        acquires DelegatedAdminPermissions
    {
        assert_admin_capability(p0);
        perp_engine::drain_async_queue(p1);
    }
    public entry fun delist_market_with_mark_price(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: option::Option<string::String>)
        acquires DelegatedAdminPermissions
    {
        assert_admin_elevated_capability(p0);
        perp_engine::delist_market_with_mark_price(p1, p2, p3);
    }
    public entry fun register_market_with_composite_oracle_primary_chainlink(p0: &signer, p1: string::String, p2: u8, p3: u64, p4: u64, p5: u64, p6: u64, p7: u8, p8: bool, p9: vector<u8>, p10: u64, p11: u8, p12: u64, p13: u64, p14: u64, p15: u8)
        acquires DelegatedAdminPermissions
    {
        assert_admin_elevated_capability(p0);
        let _v0 = p11 as i8;
        perp_engine::register_market_with_composite_oracle_primary_chainlink(p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, _v0, p12, p13, p14, p15);
    }
    public entry fun register_market_with_composite_oracle_primary_pyth(p0: &signer, p1: string::String, p2: u8, p3: u64, p4: u64, p5: u64, p6: u64, p7: u8, p8: bool, p9: vector<u8>, p10: u64, p11: u64, p12: u8, p13: u64, p14: u64, p15: u64, p16: u8)
        acquires DelegatedAdminPermissions
    {
        assert_admin_elevated_capability(p0);
        let _v0 = p12 as i8;
        perp_engine::register_market_with_composite_oracle_primary_pyth(p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, _v0, p13, p14, p15, p16);
    }
    public entry fun register_market_with_internal_oracle(p0: &signer, p1: string::String, p2: u8, p3: u64, p4: u64, p5: u64, p6: u64, p7: u8, p8: bool, p9: u64, p10: u64)
        acquires DelegatedAdminPermissions
    {
        assert_admin_elevated_capability(p0);
        perp_engine::register_market_with_internal_oracle(p1, p2, p3, p4, p5, p6, p7, p8, p9, p10);
    }
    public entry fun register_market_with_pyth_oracle(p0: &signer, p1: string::String, p2: u8, p3: u64, p4: u64, p5: u64, p6: u64, p7: u8, p8: bool, p9: vector<u8>, p10: u64, p11: u64, p12: u8)
        acquires DelegatedAdminPermissions
    {
        assert_admin_elevated_capability(p0);
        let _v0 = p12 as i8;
        perp_engine::register_market_with_pyth_oracle(p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, _v0);
    }
    public entry fun set_backstop_liquidator_high_watermark(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: i64)
        acquires DelegatedAdminPermissions
    {
        assert_admin_capability(p0);
        perp_engine::set_backstop_liquidator_high_watermark(p1, p2);
    }
    public entry fun set_global_exchange_open(p0: &signer, p1: bool)
        acquires DelegatedAdminPermissions
    {
        assert_admin_elevated_capability(p0);
        perp_engine::set_global_exchange_open(p1);
    }
    public entry fun set_market_allowlist_only(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: vector<address>, p3: option::Option<string::String>)
        acquires DelegatedAdminPermissions
    {
        assert_admin_capability(p0);
        perp_engine::set_market_allowlist_only(p1, p2, p3);
    }
    public entry fun set_market_halted(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: option::Option<string::String>)
        acquires DelegatedAdminPermissions
    {
        assert_admin_capability(p0);
        perp_engine::set_market_halted(p1, p2);
    }
    public entry fun set_market_max_leverage(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u8)
        acquires DelegatedAdminPermissions
    {
        assert_admin_capability(p0);
        perp_engine::set_market_max_leverage(p1, p2);
    }
    public entry fun set_market_notional_open_interest(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64)
        acquires DelegatedAdminPermissions
    {
        assert_admin_capability(p0);
        perp_engine::set_market_notional_open_interest(p1, p2);
    }
    public entry fun set_market_open(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: option::Option<string::String>)
        acquires DelegatedAdminPermissions
    {
        assert_admin_capability(p0);
        perp_engine::set_market_open(p1, p2);
    }
    public entry fun set_market_open_interest(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64)
        acquires DelegatedAdminPermissions
    {
        assert_admin_capability(p0);
        perp_engine::set_market_open_interest(p1, p2);
    }
    public entry fun set_market_reduce_only(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: vector<address>, p3: option::Option<string::String>)
        acquires DelegatedAdminPermissions
    {
        assert_admin_capability(p0);
        perp_engine::set_market_reduce_only(p1, p2, p3);
    }
    public entry fun set_market_unrealized_pnl_haircut(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64)
        acquires DelegatedAdminPermissions
    {
        assert_admin_capability(p0);
        perp_engine::set_market_unrealized_pnl_haircut(p1, p2);
    }
    public entry fun set_market_withdrawable_margin_leverage(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u8)
        acquires DelegatedAdminPermissions
    {
        assert_admin_capability(p0);
        perp_engine::set_market_withdrawable_margin_leverage(p1, p2);
    }
    public entry fun add_admin(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_admin_elevated_capability(p0);
        let _v0 = AdminPermissionType::Admin{};
        add_permission_internal(p1, _v0);
    }
    fun add_permission_internal(p0: address, p1: AdminPermissionType)
        acquires DelegatedAdminPermissions
    {
        assert!(exists<DelegatedAdminPermissions>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 5);
        let _v0 = borrow_global_mut<DelegatedAdminPermissions>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
        let _v1 = &_v0.delegated_permissions;
        let _v2 = &p0;
        let _v3 = ordered_map::get<address,DelegatedPermissions>(_v1, _v2);
        if (option::is_none<DelegatedPermissions>(&_v3)) {
            let _v4 = ordered_map::new<AdminPermissionType,StoredPermission>();
            let _v5 = &mut _v4;
            let _v6 = StoredPermission::Unlimited{};
            ordered_map::add<AdminPermissionType,StoredPermission>(_v5, p1, _v6);
            let _v7 = DelegatedPermissions::V1{perms: _v4};
            ordered_map::add<address,DelegatedPermissions>(&mut _v0.delegated_permissions, p0, _v7);
            return ()
        };
        let _v8 = option::destroy_some<DelegatedPermissions>(_v3);
        let _v9 = &mut (&mut _v8).perms;
        let _v10 = StoredPermission::Unlimited{};
        let _v11 = ordered_map::upsert<AdminPermissionType,StoredPermission>(_v9, p1, _v10);
        let _v12 = ordered_map::upsert<address,DelegatedPermissions>(&mut _v0.delegated_permissions, p0, _v8);
    }
    public entry fun add_elevated_admin(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_deployer_capability(p0);
        let _v0 = AdminPermissionType::ElevatedAdmin{};
        add_permission_internal(p1, _v0);
    }
    public entry fun add_oracle_and_mark_update_permission(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_deployer_capability(p0);
        let _v0 = AdminPermissionType::OracleAndMarkUpdate{};
        add_permission_internal(p1, _v0);
    }
    fun is_deployer(p0: &signer): bool {
        signer::address_of(p0) == @0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75
    }
    fun has_permission(p0: &signer, p1: AdminPermissionType): bool
        acquires DelegatedAdminPermissions
    {
        let _v0;
        assert!(exists<DelegatedAdminPermissions>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 5);
        let _v1 = &borrow_global<DelegatedAdminPermissions>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).delegated_permissions;
        let _v2 = signer::address_of(p0);
        let _v3 = &_v2;
        let _v4 = ordered_map::get<address,DelegatedPermissions>(_v1, _v3);
        let _v5 = option::is_none<DelegatedPermissions>(&_v4);
        loop {
            if (_v5) return false else {
                let _v6 = option::destroy_some<DelegatedPermissions>(_v4);
                let _v7 = &(&_v6).perms;
                let _v8 = &p1;
                _v0 = ordered_map::get<AdminPermissionType,StoredPermission>(_v7, _v8);
                if (!option::is_none<StoredPermission>(&_v0)) break
            };
            return false
        };
        is_stored_permission_valid(option::destroy_some<StoredPermission>(_v0))
    }
    fun assert_admin_oracle_and_mark_update_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0;
        if (is_deployer(p0)) _v0 = true else {
            let _v1 = AdminPermissionType::OracleAndMarkUpdate{};
            _v0 = has_permission(p0, _v1)
        };
        assert!(_v0, 4);
    }
    fun is_stored_permission_valid(p0: StoredPermission): bool {
        let _v0 = &p0;
        loop {
            if (!(_v0 is Unlimited)) {
                if (_v0 is UnlimitedUntil) break;
                abort 14566554180833181697
            };
            let StoredPermission::Unlimited{} = p0;
            return true
        };
        let StoredPermission::UnlimitedUntil{_0: _v1} = p0;
        timestamp::now_seconds() < _v1
    }
    public entry fun remove_admin(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_admin_elevated_capability(p0);
        let _v0 = AdminPermissionType::Admin{};
        remove_permission_internal(p1, _v0);
    }
    fun remove_permission_internal(p0: address, p1: AdminPermissionType)
        acquires DelegatedAdminPermissions
    {
        assert!(exists<DelegatedAdminPermissions>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 5);
        let _v0 = borrow_global_mut<DelegatedAdminPermissions>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
        let _v1 = &_v0.delegated_permissions;
        let _v2 = &p0;
        let _v3 = ordered_map::get<address,DelegatedPermissions>(_v1, _v2);
        if (option::is_some<DelegatedPermissions>(&_v3)) {
            let _v4 = option::destroy_some<DelegatedPermissions>(_v3);
            let _v5 = &mut (&mut _v4).perms;
            let _v6 = &p1;
            let _v7 = ordered_map::remove<AdminPermissionType,StoredPermission>(_v5, _v6);
            let _v8 = ordered_map::upsert<address,DelegatedPermissions>(&mut _v0.delegated_permissions, p0, _v4);
            return ()
        };
    }
    public entry fun remove_elevated_admin(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_deployer_capability(p0);
        let _v0 = AdminPermissionType::ElevatedAdmin{};
        remove_permission_internal(p1, _v0);
    }
    public entry fun remove_oracle_and_mark_update_permission(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_deployer_capability(p0);
        let _v0 = AdminPermissionType::OracleAndMarkUpdate{};
        remove_permission_internal(p1, _v0);
    }
    public entry fun set_market_funding_rate_pause_timeout_microseconds(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64)
        acquires DelegatedAdminPermissions
    {
        assert_admin_capability(p0);
        price_management::set_funding_rate_pause_timeout_microseconds(p1, p2);
    }
    public entry fun update_mark_for_chainlink_oracle(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: vector<u8>, p3: vector<address>, p4: bool)
        acquires DelegatedAdminPermissions
    {
        assert_admin_oracle_and_mark_update_capability(p0);
        let _v0 = option::none<u64>();
        let _v1 = option::some<vector<u8>>(p2);
        let _v2 = option::none<vector<u8>>();
        let _v3 = price_management::new_mark_price_refresh_input_none();
        perp_engine::update_oracle_and_mark_price_and_liquidate_and_trigger(p0, p1, _v0, _v1, _v2, _v3, p3, p4);
    }
    public entry fun update_mark_for_composite_chainlink(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: option::Option<u64>, p3: option::Option<vector<u8>>, p4: option::Option<u64>, p5: option::Option<u64>, p6: vector<address>, p7: bool)
        acquires DelegatedAdminPermissions
    {
        let _v0;
        let _v1;
        assert_admin_oracle_and_mark_update_capability(p0);
        let _v2 = option::none<vector<u8>>();
        if (option::is_some<u64>(&p4)) _v1 = option::is_some<u64>(&p5) else _v1 = false;
        if (_v1) {
            let _v3 = option::destroy_some<u64>(p4);
            let _v4 = option::destroy_some<u64>(p5);
            _v0 = price_management::new_mark_price_refresh_input_with_impact_hint(_v3, _v4)
        } else _v0 = price_management::new_mark_price_refresh_input_none();
        perp_engine::update_oracle_and_mark_price_and_liquidate_and_trigger(p0, p1, p2, p3, _v2, _v0, p6, p7);
    }
    public entry fun update_mark_for_internal_oracle(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: vector<address>, p4: bool)
        acquires DelegatedAdminPermissions
    {
        assert_admin_oracle_and_mark_update_capability(p0);
        let _v0 = option::some<u64>(p2);
        let _v1 = option::none<vector<u8>>();
        let _v2 = option::none<vector<u8>>();
        let _v3 = price_management::new_mark_price_refresh_input_none();
        perp_engine::update_oracle_and_mark_price_and_liquidate_and_trigger(p0, p1, _v0, _v1, _v2, _v3, p3, p4);
    }
    public entry fun update_mark_for_pyth_oracle(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: vector<u8>, p3: vector<address>, p4: bool)
        acquires DelegatedAdminPermissions
    {
        assert_admin_oracle_and_mark_update_capability(p0);
        let _v0 = option::none<u64>();
        let _v1 = option::none<vector<u8>>();
        let _v2 = option::some<vector<u8>>(p2);
        let _v3 = price_management::new_mark_price_refresh_input_none();
        perp_engine::update_oracle_and_mark_price_and_liquidate_and_trigger(p0, p1, _v0, _v1, _v2, _v3, p3, p4);
    }
}
