module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::admin_apis {
    use 0x1::ordered_map;
    use 0x1::object;
    use 0x1::fungible_asset;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::decibel_time;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::trading_fees_manager;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0x1::option;
    use 0x1::string;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::backstop_liquidator_profit_tracker;
    use 0x1::signer;
    use 0x1::event;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_positions;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::builder_code_registry;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market_config;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::price_management;
    enum StoredPermission has copy, drop, store {
        Unlimited,
        UnlimitedUntil {
            _0: u64,
        }
    }
    enum AdminPermissionType has copy, drop, store {
        OracleAndMarkUpdate,
        ReferralManagementAdmin,
        AccessControlAdmin,
        AccessControlGuardian,
        GlobalPauseGuardian,
        GlobalUnpauseCouncil,
        MarketModeGuardian,
        MarketListAdmin,
        MarketDelistCouncil,
        MarketOpenAdmin,
        MarketRiskTightener,
        MarketRiskGovernor,
        FeeConfigGovernor,
        OrderManagementAdmin,
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
    struct PermissionGranted has drop, store {
        permission_type: AdminPermissionType,
        target_address: address,
        granted_by: address,
        timestamp: u64,
    }
    struct PermissionRevoked has drop, store {
        permission_type: AdminPermissionType,
        target_address: address,
        revoked_by: address,
        timestamp: u64,
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
    public entry fun increment_time(p0: &signer, p1: u64) {
        decibel_time::increment_time(p0, p1);
    }
    public entry fun set_max_referral_codes_for_address(p0: &signer, p1: address, p2: u64)
        acquires DelegatedAdminPermissions
    {
        assert_admin_referral_management_capability(p0);
        trading_fees_manager::set_max_referral_codes_for_address(p1, p2);
    }
    fun assert_admin_referral_management_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0 = AdminPermissionType::ReferralManagementAdmin{};
        assert!(has_permission(p0, _v0), 17);
    }
    public entry fun set_max_usage_per_referral_code_for_address(p0: &signer, p1: address, p2: u64)
        acquires DelegatedAdminPermissions
    {
        assert_admin_referral_management_capability(p0);
        trading_fees_manager::set_max_usage_per_referral_code_for_address(p1, p2);
    }
    public entry fun delist_market(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: option::Option<string::String>)
        acquires DelegatedAdminPermissions
    {
        assert_market_delist_council_capability(p0);
        perp_engine::delist_market(p1, p2);
    }
    fun assert_market_delist_council_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0 = AdminPermissionType::MarketDelistCouncil{};
        assert!(has_permission(p0, _v0), 12);
    }
    public entry fun set_blp_margin_as_profit_percentage(p0: &signer, p1: u64)
        acquires DelegatedAdminPermissions
    {
        assert_market_risk_governor_capability(p0);
        backstop_liquidator_profit_tracker::set_blp_margin_as_profit_percentage(p1);
    }
    fun assert_market_risk_governor_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0 = AdminPermissionType::MarketRiskGovernor{};
        assert!(has_permission(p0, _v0), 15);
    }
    public entry fun admin_register_referral_code(p0: &signer, p1: address, p2: string::String)
        acquires DelegatedAdminPermissions
    {
        assert_admin_referral_management_capability(p0);
        trading_fees_manager::admin_register_referral_code(p1, p2);
    }
    public entry fun admin_register_referrer(p0: &signer, p1: address, p2: string::String)
        acquires DelegatedAdminPermissions
    {
        assert_admin_referral_management_capability(p0);
        trading_fees_manager::admin_register_referrer(p1, p2);
    }
    public entry fun update_fee_config(p0: &signer, p1: vector<u128>, p2: vector<u64>, p3: vector<u64>, p4: u128, p5: vector<u64>, p6: vector<u64>, p7: u64, p8: u64, p9: bool, p10: u64, p11: u64, p12: u128, p13: u128)
        acquires DelegatedAdminPermissions
    {
        assert_fee_config_governor_capability(p0);
        trading_fees_manager::update_fee_config(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13);
    }
    fun assert_fee_config_governor_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0 = AdminPermissionType::FeeConfigGovernor{};
        assert!(has_permission(p0, _v0), 16);
    }
    public entry fun drain_async_queue(p0: &signer, p1: object::Object<perp_market::PerpMarket>)
        acquires DelegatedAdminPermissions
    {
        assert_order_management_admin_capability(p0);
        perp_engine::drain_async_queue(p1);
    }
    fun assert_order_management_admin_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0 = AdminPermissionType::OrderManagementAdmin{};
        assert!(has_permission(p0, _v0), 18);
    }
    public entry fun add_to_account_creation_allow_list(p0: &signer, p1: vector<address>)
        acquires DelegatedAdminPermissions
    {
        assert_admin_referral_management_capability(p0);
        perp_engine::add_to_account_creation_allow_list(p1);
    }
    public entry fun decrease_market_notional_open_interest(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64)
        acquires DelegatedAdminPermissions
    {
        let _v0;
        let _v1 = AdminPermissionType::MarketRiskTightener{};
        if (has_permission(p0, _v1)) _v0 = true else {
            let _v2 = AdminPermissionType::MarketRiskGovernor{};
            _v0 = has_permission(p0, _v2)
        };
        assert!(_v0, 14);
        perp_engine::decrease_market_notional_open_interest(p1, p2);
    }
    fun has_permission(p0: &signer, p1: AdminPermissionType): bool
        acquires DelegatedAdminPermissions
    {
        let _v0;
        assert!(exists<DelegatedAdminPermissions>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88), 5);
        let _v1 = &borrow_global<DelegatedAdminPermissions>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).delegated_permissions;
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
    public entry fun decrease_market_open_interest(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64)
        acquires DelegatedAdminPermissions
    {
        let _v0;
        let _v1 = AdminPermissionType::MarketRiskTightener{};
        if (has_permission(p0, _v1)) _v0 = true else {
            let _v2 = AdminPermissionType::MarketRiskGovernor{};
            _v0 = has_permission(p0, _v2)
        };
        assert!(_v0, 14);
        perp_engine::decrease_market_open_interest(p1, p2);
    }
    public entry fun delist_market_with_mark_price(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: option::Option<string::String>)
        acquires DelegatedAdminPermissions
    {
        assert_market_delist_council_capability(p0);
        perp_engine::delist_market_with_mark_price(p1, p2, p3);
    }
    public entry fun increase_market_notional_open_interest(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64)
        acquires DelegatedAdminPermissions
    {
        assert_market_risk_governor_capability(p0);
        perp_engine::increase_market_notional_open_interest(p1, p2);
    }
    public entry fun increase_market_open_interest(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64)
        acquires DelegatedAdminPermissions
    {
        assert_market_risk_governor_capability(p0);
        perp_engine::increase_market_open_interest(p1, p2);
    }
    public entry fun register_market_with_composite_oracle_primary_chainlink(p0: &signer, p1: string::String, p2: u8, p3: u64, p4: u64, p5: u64, p6: u64, p7: u8, p8: bool, p9: vector<u8>, p10: u64, p11: u8, p12: u64, p13: u64, p14: u64, p15: u8)
        acquires DelegatedAdminPermissions
    {
        assert_market_list_admin_capability(p0);
        let _v0 = p11 as i8;
        perp_engine::register_market_with_composite_oracle_primary_chainlink(p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, _v0, p12, p13, p14, p15);
    }
    fun assert_market_list_admin_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0 = AdminPermissionType::MarketListAdmin{};
        assert!(has_permission(p0, _v0), 11);
    }
    public entry fun register_market_with_composite_oracle_primary_pyth(p0: &signer, p1: string::String, p2: u8, p3: u64, p4: u64, p5: u64, p6: u64, p7: u8, p8: bool, p9: vector<u8>, p10: u64, p11: u64, p12: u8, p13: u64, p14: u64, p15: u64, p16: u8)
        acquires DelegatedAdminPermissions
    {
        assert_market_list_admin_capability(p0);
        let _v0 = p12 as i8;
        perp_engine::register_market_with_composite_oracle_primary_pyth(p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, _v0, p13, p14, p15, p16);
    }
    public entry fun register_market_with_internal_oracle(p0: &signer, p1: string::String, p2: u8, p3: u64, p4: u64, p5: u64, p6: u64, p7: u8, p8: bool, p9: u64, p10: u64)
        acquires DelegatedAdminPermissions
    {
        assert_market_list_admin_capability(p0);
        perp_engine::register_market_with_internal_oracle(p1, p2, p3, p4, p5, p6, p7, p8, p9, p10);
    }
    public entry fun register_market_with_pyth_oracle(p0: &signer, p1: string::String, p2: u8, p3: u64, p4: u64, p5: u64, p6: u64, p7: u8, p8: bool, p9: vector<u8>, p10: u64, p11: u64, p12: u8)
        acquires DelegatedAdminPermissions
    {
        assert_market_list_admin_capability(p0);
        let _v0 = p12 as i8;
        perp_engine::register_market_with_pyth_oracle(p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, _v0);
    }
    public entry fun set_backstop_liquidator_high_watermark(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: i64)
        acquires DelegatedAdminPermissions
    {
        assert_market_risk_governor_capability(p0);
        perp_engine::set_backstop_liquidator_high_watermark(p1, p2);
    }
    public entry fun set_invite_only_account_creation(p0: &signer, p1: bool)
        acquires DelegatedAdminPermissions
    {
        assert_admin_referral_management_capability(p0);
        perp_engine::set_invite_only_account_creation(p1);
    }
    public entry fun set_market_allowlist_only(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: vector<address>, p3: option::Option<string::String>)
        acquires DelegatedAdminPermissions
    {
        assert_market_mode_guardian_capability(p0);
        perp_engine::set_market_allowlist_only(p1, p2, p3);
    }
    fun assert_market_mode_guardian_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0 = AdminPermissionType::MarketModeGuardian{};
        assert!(has_permission(p0, _v0), 10);
    }
    public entry fun set_market_halted(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: option::Option<string::String>)
        acquires DelegatedAdminPermissions
    {
        assert_market_mode_guardian_capability(p0);
        perp_engine::set_market_halted(p1, p2);
    }
    public entry fun set_market_margin_call_backstop_pct(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64)
        acquires DelegatedAdminPermissions
    {
        assert_fee_config_governor_capability(p0);
        perp_engine::set_market_margin_call_backstop_pct(p1, p2);
    }
    public entry fun set_market_margin_call_fee_pct(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64)
        acquires DelegatedAdminPermissions
    {
        assert_fee_config_governor_capability(p0);
        perp_engine::set_market_margin_call_fee_pct(p1, p2);
    }
    public entry fun set_market_max_leverage(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u8)
        acquires DelegatedAdminPermissions
    {
        assert_market_risk_governor_capability(p0);
        perp_engine::set_market_max_leverage(p1, p2);
    }
    public entry fun set_market_open(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: option::Option<string::String>)
        acquires DelegatedAdminPermissions
    {
        assert_market_open_admin_capability(p0);
        perp_engine::set_market_open(p1, p2);
    }
    fun assert_market_open_admin_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0 = AdminPermissionType::MarketOpenAdmin{};
        assert!(has_permission(p0, _v0), 13);
    }
    public entry fun set_market_reduce_only(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: vector<address>, p3: option::Option<string::String>)
        acquires DelegatedAdminPermissions
    {
        assert_market_mode_guardian_capability(p0);
        perp_engine::set_market_reduce_only(p1, p2, p3);
    }
    public entry fun set_market_slippage_pcts(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: vector<u64>)
        acquires DelegatedAdminPermissions
    {
        assert_market_risk_governor_capability(p0);
        perp_engine::set_market_slippage_pcts(p1, p2);
    }
    public entry fun set_market_unrealized_pnl_haircut(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64)
        acquires DelegatedAdminPermissions
    {
        assert_market_risk_governor_capability(p0);
        perp_engine::set_market_unrealized_pnl_haircut(p1, p2);
    }
    public entry fun set_market_withdrawable_margin_leverage(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u8)
        acquires DelegatedAdminPermissions
    {
        assert_market_risk_governor_capability(p0);
        perp_engine::set_market_withdrawable_margin_leverage(p1, p2);
    }
    public entry fun add_access_control_admin(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_deployer_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::AccessControlAdmin{};
        add_permission_internal(_v0, p1, _v1);
    }
    fun add_permission_internal(p0: address, p1: address, p2: AdminPermissionType)
        acquires DelegatedAdminPermissions
    {
        assert!(exists<DelegatedAdminPermissions>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88), 5);
        let _v0 = borrow_global_mut<DelegatedAdminPermissions>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v1 = &_v0.delegated_permissions;
        let _v2 = &p1;
        let _v3 = ordered_map::get<address,DelegatedPermissions>(_v1, _v2);
        if (option::is_none<DelegatedPermissions>(&_v3)) {
            let _v4 = ordered_map::new<AdminPermissionType,StoredPermission>();
            let _v5 = &mut _v4;
            let _v6 = StoredPermission::Unlimited{};
            ordered_map::add<AdminPermissionType,StoredPermission>(_v5, p2, _v6);
            let _v7 = DelegatedPermissions::V1{perms: _v4};
            ordered_map::add<address,DelegatedPermissions>(&mut _v0.delegated_permissions, p1, _v7)
        } else {
            let _v8 = option::destroy_some<DelegatedPermissions>(_v3);
            let _v9 = &mut (&mut _v8).perms;
            let _v10 = StoredPermission::Unlimited{};
            let _v11 = ordered_map::upsert<AdminPermissionType,StoredPermission>(_v9, p2, _v10);
            let _v12 = ordered_map::upsert<address,DelegatedPermissions>(&mut _v0.delegated_permissions, p1, _v8);
        };
        let _v13 = decibel_time::now_seconds();
        event::emit<PermissionGranted>(PermissionGranted{permission_type: p2, target_address: p1, granted_by: p0, timestamp: _v13});
    }
    public entry fun add_access_control_guardian(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_admin_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::AccessControlGuardian{};
        add_permission_internal(_v0, p1, _v1);
    }
    fun assert_access_control_admin_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0 = AdminPermissionType::AccessControlAdmin{};
        assert!(has_permission(p0, _v0), 6);
    }
    public entry fun add_fee_config_governor(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_admin_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::FeeConfigGovernor{};
        add_permission_internal(_v0, p1, _v1);
    }
    public entry fun add_global_pause_guardian(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_admin_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::GlobalPauseGuardian{};
        add_permission_internal(_v0, p1, _v1);
    }
    public entry fun add_global_unpause_council(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_admin_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::GlobalUnpauseCouncil{};
        add_permission_internal(_v0, p1, _v1);
    }
    public entry fun add_invite_only_referral_management_permission(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_admin_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::ReferralManagementAdmin{};
        add_permission_internal(_v0, p1, _v1);
    }
    public entry fun add_market_delist_council(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_admin_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::MarketDelistCouncil{};
        add_permission_internal(_v0, p1, _v1);
    }
    public entry fun add_market_list_admin(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_admin_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::MarketListAdmin{};
        add_permission_internal(_v0, p1, _v1);
    }
    public entry fun add_market_mode_guardian(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_admin_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::MarketModeGuardian{};
        add_permission_internal(_v0, p1, _v1);
    }
    public entry fun add_market_open_admin(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_admin_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::MarketOpenAdmin{};
        add_permission_internal(_v0, p1, _v1);
    }
    public entry fun add_market_risk_governor(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_admin_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::MarketRiskGovernor{};
        add_permission_internal(_v0, p1, _v1);
    }
    public entry fun add_market_risk_tightener(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_admin_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::MarketRiskTightener{};
        add_permission_internal(_v0, p1, _v1);
    }
    public entry fun add_oracle_and_mark_update_permission(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_admin_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::OracleAndMarkUpdate{};
        add_permission_internal(_v0, p1, _v1);
    }
    public entry fun add_order_management_admin(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_admin_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::OrderManagementAdmin{};
        add_permission_internal(_v0, p1, _v1);
    }
    public entry fun admin_register_affiliate(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_admin_referral_management_capability(p0);
        trading_fees_manager::register_affiliate(perp_positions::get_primary_account_addr(p1));
    }
    fun assert_access_control_guardian_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0;
        let _v1 = AdminPermissionType::AccessControlAdmin{};
        if (has_permission(p0, _v1)) _v0 = true else {
            let _v2 = AdminPermissionType::AccessControlGuardian{};
            _v0 = has_permission(p0, _v2)
        };
        assert!(_v0, 7);
    }
    fun assert_admin_oracle_and_mark_update_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0 = AdminPermissionType::OracleAndMarkUpdate{};
        assert!(has_permission(p0, _v0), 4);
    }
    fun is_deployer(p0: &signer): bool {
        signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88
    }
    fun assert_global_pause_guardian_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0 = AdminPermissionType::GlobalPauseGuardian{};
        assert!(has_permission(p0, _v0), 8);
    }
    fun assert_global_unpause_council_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0 = AdminPermissionType::GlobalUnpauseCouncil{};
        assert!(has_permission(p0, _v0), 9);
    }
    fun assert_market_risk_tightener_capability(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        let _v0 = AdminPermissionType::MarketRiskTightener{};
        assert!(has_permission(p0, _v0), 14);
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
        decibel_time::now_seconds() < _v1
    }
    public entry fun init_account_status_cache_for_subaccount(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_market_risk_governor_capability(p0);
        perp_engine::init_account_status_cache(p1);
    }
    public entry fun pause_global_exchange(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        assert_global_pause_guardian_capability(p0);
        perp_engine::set_global_exchange_open(false);
    }
    public entry fun remove_access_control_admin(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_deployer_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::AccessControlAdmin{};
        remove_permission_internal(_v0, p1, _v1);
    }
    fun remove_permission_internal(p0: address, p1: address, p2: AdminPermissionType)
        acquires DelegatedAdminPermissions
    {
        assert!(exists<DelegatedAdminPermissions>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88), 5);
        let _v0 = borrow_global_mut<DelegatedAdminPermissions>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v1 = &_v0.delegated_permissions;
        let _v2 = &p1;
        let _v3 = ordered_map::get<address,DelegatedPermissions>(_v1, _v2);
        if (option::is_some<DelegatedPermissions>(&_v3)) {
            let _v4 = option::destroy_some<DelegatedPermissions>(_v3);
            let _v5 = &mut (&mut _v4).perms;
            let _v6 = &p2;
            let _v7 = ordered_map::remove<AdminPermissionType,StoredPermission>(_v5, _v6);
            let _v8 = ordered_map::upsert<address,DelegatedPermissions>(&mut _v0.delegated_permissions, p1, _v4);
            let _v9 = decibel_time::now_seconds();
            event::emit<PermissionRevoked>(PermissionRevoked{permission_type: p2, target_address: p1, revoked_by: p0, timestamp: _v9});
            return ()
        };
    }
    public entry fun remove_access_control_guardian(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_guardian_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::AccessControlGuardian{};
        remove_permission_internal(_v0, p1, _v1);
    }
    public entry fun remove_fee_config_governor(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_guardian_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::FeeConfigGovernor{};
        remove_permission_internal(_v0, p1, _v1);
    }
    public entry fun remove_global_pause_guardian(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_guardian_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::GlobalPauseGuardian{};
        remove_permission_internal(_v0, p1, _v1);
    }
    public entry fun remove_global_unpause_council(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_guardian_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::GlobalUnpauseCouncil{};
        remove_permission_internal(_v0, p1, _v1);
    }
    public entry fun remove_invite_only_referral_management_permission(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_guardian_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::ReferralManagementAdmin{};
        remove_permission_internal(_v0, p1, _v1);
    }
    public entry fun remove_market_delist_council(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_guardian_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::MarketDelistCouncil{};
        remove_permission_internal(_v0, p1, _v1);
    }
    public entry fun remove_market_list_admin(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_guardian_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::MarketListAdmin{};
        remove_permission_internal(_v0, p1, _v1);
    }
    public entry fun remove_market_mode_guardian(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_guardian_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::MarketModeGuardian{};
        remove_permission_internal(_v0, p1, _v1);
    }
    public entry fun remove_market_open_admin(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_guardian_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::MarketOpenAdmin{};
        remove_permission_internal(_v0, p1, _v1);
    }
    public entry fun remove_market_risk_governor(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_guardian_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::MarketRiskGovernor{};
        remove_permission_internal(_v0, p1, _v1);
    }
    public entry fun remove_market_risk_tightener(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_guardian_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::MarketRiskTightener{};
        remove_permission_internal(_v0, p1, _v1);
    }
    public entry fun remove_oracle_and_mark_update_permission(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_guardian_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::OracleAndMarkUpdate{};
        remove_permission_internal(_v0, p1, _v1);
    }
    public entry fun remove_order_management_admin(p0: &signer, p1: address)
        acquires DelegatedAdminPermissions
    {
        assert_access_control_guardian_capability(p0);
        let _v0 = signer::address_of(p0);
        let _v1 = AdminPermissionType::OrderManagementAdmin{};
        remove_permission_internal(_v0, p1, _v1);
    }
    public entry fun set_global_max_builder_fee(p0: &signer, p1: u64)
        acquires DelegatedAdminPermissions
    {
        assert_fee_config_governor_capability(p0);
        builder_code_registry::set_global_max_fee(p1);
    }
    public entry fun set_market_adl_trigger_threshold(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64)
        acquires DelegatedAdminPermissions
    {
        assert_market_risk_governor_capability(p0);
        perp_market_config::set_adl_trigger_threshold(p1, p2);
    }
    public entry fun set_market_funding_rate_pause_timeout_microseconds(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64)
        acquires DelegatedAdminPermissions
    {
        assert_market_risk_governor_capability(p0);
        price_management::set_funding_rate_pause_timeout_microseconds(p1, p2);
    }
    public entry fun unpause_global_exchange(p0: &signer)
        acquires DelegatedAdminPermissions
    {
        assert_global_unpause_council_capability(p0);
        perp_engine::set_global_exchange_open(true);
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
