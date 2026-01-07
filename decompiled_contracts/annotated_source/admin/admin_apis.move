/// ============================================================================
/// ADMIN APIS - Protocol Administration Interface
/// ============================================================================
///
/// This module provides the administrative interface for the Decibel protocol.
/// It manages permissions and exposes entry functions for protocol configuration.
///
/// PERMISSION LEVELS:
///
/// 1. DEPLOYER (Highest):
///    - Can do everything
///    - Can add/remove elevated admins
///    - Can grant oracle update permissions
///
/// 2. ELEVATED ADMIN:
///    - Can register/delist markets
///    - Can add/remove regular admins
///    - Can set global exchange status
///
/// 3. ADMIN:
///    - Can modify market parameters
///    - Can update fee configuration
///    - Can manage market status
///
/// 4. ORACLE AND MARK UPDATE:
///    - Can update oracle prices
///    - Can trigger mark price updates
///    - Can trigger liquidations
///
/// PERMISSION STORAGE:
///
/// Permissions can be:
/// - Unlimited: Always valid
/// - UnlimitedUntil: Valid until a specific timestamp
///
/// ============================================================================

module decibel::admin_apis {
    use std::signer;
    use std::ordered_map;
    use std::object;
    use std::option;
    use std::timestamp;
    use std::fungible_asset;
    use std::string;

    use decibel::perp_engine;
    use decibel::perp_market;
    use decibel::perp_market_config;
    use decibel::price_management;
    use decibel::trading_fees_manager;
    use decibel::decibel_time;

    // ============================================================================
    // PERMISSION TYPES
    // ============================================================================

    /// Types of admin permissions
    enum AdminPermissionType has copy, drop, store {
        /// Standard admin - can modify market parameters
        Admin,
        /// Elevated admin - can register markets and add admins
        ElevatedAdmin,
        /// Oracle update permission - can update prices
        OracleAndMarkUpdate,
    }

    /// Permission duration storage
    enum StoredPermission has copy, drop, store {
        /// Permission never expires
        Unlimited,
        /// Permission expires at timestamp
        UnlimitedUntil {
            expiry_timestamp: u64,
        }
    }

    /// Per-address permission set
    enum DelegatedPermissions has copy, drop, store {
        V1 {
            /// Map of permission type to stored permission
            perms: ordered_map::OrderedMap<AdminPermissionType, StoredPermission>,
        }
    }

    /// Global permission storage
    enum DelegatedAdminPermissions has key {
        V1 {
            /// Map of address to their permissions
            delegated_permissions: ordered_map::OrderedMap<address, DelegatedPermissions>,
        }
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Initialize the protocol
    ///
    /// # Parameters
    /// - `deployer`: Must be the protocol deployer
    /// - `collateral_metadata`: The collateral token (USDC) metadata
    /// - `collateral_decimals`: Decimals of the collateral token
    /// - `backstop_liquidator`: Address of the backstop liquidator
    public entry fun initialize(
        deployer: &signer,
        collateral_metadata: object::Object<fungible_asset::Metadata>,
        collateral_decimals: u8,
        backstop_liquidator: address
    ) {
        assert_deployer_capability(deployer);

        // Initialize permission storage
        let permissions = DelegatedAdminPermissions::V1 {
            delegated_permissions: ordered_map::new<address, DelegatedPermissions>(),
        };
        move_to<DelegatedAdminPermissions>(deployer, permissions);

        // Initialize the perp engine
        perp_engine::initialize(deployer, collateral_metadata, collateral_decimals, backstop_liquidator);
    }

    // ============================================================================
    // PERMISSION CHECKS
    // ============================================================================

    /// Check if signer is the deployer
    fun is_deployer(signer: &signer): bool {
        signer::address_of(signer) == @decibel
    }

    /// Assert caller is deployer
    fun assert_deployer_capability(signer: &signer) {
        assert!(is_deployer(signer), 1);
    }

    /// Check if signer has a specific permission
    fun has_permission(
        signer: &signer,
        permission_type: AdminPermissionType
    ): bool acquires DelegatedAdminPermissions {
        assert!(exists<DelegatedAdminPermissions>(@decibel), 5);

        let permissions = &borrow_global<DelegatedAdminPermissions>(@decibel).delegated_permissions;
        let addr = signer::address_of(signer);

        // Look up address
        let perms_option = ordered_map::get<address, DelegatedPermissions>(permissions, &addr);
        if (option::is_none<DelegatedPermissions>(&perms_option)) {
            return false
        };

        // Look up permission type
        let perms = option::destroy_some<DelegatedPermissions>(perms_option);
        let stored = ordered_map::get<AdminPermissionType, StoredPermission>(&(&perms).perms, &permission_type);
        if (option::is_none<StoredPermission>(&stored)) {
            return false
        };

        // Check if permission is still valid
        is_stored_permission_valid(option::destroy_some<StoredPermission>(stored))
    }

    /// Check if a stored permission is currently valid
    fun is_stored_permission_valid(perm: StoredPermission): bool {
        if (&perm is Unlimited) {
            let StoredPermission::Unlimited {} = perm;
            return true
        };

        if (&perm is UnlimitedUntil) {
            let StoredPermission::UnlimitedUntil { expiry_timestamp } = perm;
            return timestamp::now_seconds() < expiry_timestamp
        };

        abort 14566554180833181697  // Invalid permission type
    }

    /// Assert caller is admin or higher
    fun assert_admin_capability(signer: &signer) acquires DelegatedAdminPermissions {
        let is_authorized: bool;

        // Deployer always authorized
        if (is_deployer(signer)) {
            is_authorized = true;
        } else if (has_permission(signer, AdminPermissionType::ElevatedAdmin {})) {
            is_authorized = true;
        } else {
            is_authorized = has_permission(signer, AdminPermissionType::Admin {});
        };

        assert!(is_authorized, 3);
    }

    /// Assert caller is elevated admin or higher
    fun assert_admin_elevated_capability(signer: &signer) acquires DelegatedAdminPermissions {
        let is_authorized: bool;

        if (is_deployer(signer)) {
            is_authorized = true;
        } else {
            is_authorized = has_permission(signer, AdminPermissionType::ElevatedAdmin {});
        };

        assert!(is_authorized, 2);
    }

    /// Assert caller can update oracle and mark
    fun assert_admin_oracle_and_mark_update_capability(signer: &signer) acquires DelegatedAdminPermissions {
        let is_authorized: bool;

        if (is_deployer(signer)) {
            is_authorized = true;
        } else {
            is_authorized = has_permission(signer, AdminPermissionType::OracleAndMarkUpdate {});
        };

        assert!(is_authorized, 4);
    }

    // ============================================================================
    // PERMISSION MANAGEMENT
    // ============================================================================

    /// Add a permission for an address
    fun add_permission_internal(
        addr: address,
        permission_type: AdminPermissionType
    ) acquires DelegatedAdminPermissions {
        assert!(exists<DelegatedAdminPermissions>(@decibel), 5);

        let state = borrow_global_mut<DelegatedAdminPermissions>(@decibel);
        let existing = ordered_map::get<address, DelegatedPermissions>(
            &state.delegated_permissions,
            &addr
        );

        if (option::is_none<DelegatedPermissions>(&existing)) {
            // New address - create permission set
            let perms = ordered_map::new<AdminPermissionType, StoredPermission>();
            ordered_map::add<AdminPermissionType, StoredPermission>(
                &mut perms,
                permission_type,
                StoredPermission::Unlimited {}
            );
            let delegated = DelegatedPermissions::V1 { perms };
            ordered_map::add<address, DelegatedPermissions>(
                &mut state.delegated_permissions,
                addr,
                delegated
            );
        } else {
            // Existing address - add/update permission
            let delegated = option::destroy_some<DelegatedPermissions>(existing);
            let _old = ordered_map::upsert<AdminPermissionType, StoredPermission>(
                &mut (&mut delegated).perms,
                permission_type,
                StoredPermission::Unlimited {}
            );
            let _old_delegated = ordered_map::upsert<address, DelegatedPermissions>(
                &mut state.delegated_permissions,
                addr,
                delegated
            );
        };
    }

    /// Remove a permission from an address
    fun remove_permission_internal(
        addr: address,
        permission_type: AdminPermissionType
    ) acquires DelegatedAdminPermissions {
        assert!(exists<DelegatedAdminPermissions>(@decibel), 5);

        let state = borrow_global_mut<DelegatedAdminPermissions>(@decibel);
        let existing = ordered_map::get<address, DelegatedPermissions>(
            &state.delegated_permissions,
            &addr
        );

        if (option::is_some<DelegatedPermissions>(&existing)) {
            let delegated = option::destroy_some<DelegatedPermissions>(existing);
            let _removed = ordered_map::remove<AdminPermissionType, StoredPermission>(
                &mut (&mut delegated).perms,
                &permission_type
            );
            let _old = ordered_map::upsert<address, DelegatedPermissions>(
                &mut state.delegated_permissions,
                addr,
                delegated
            );
        };
    }

    /// Add an admin (requires elevated admin)
    public entry fun add_admin(
        caller: &signer,
        addr: address
    ) acquires DelegatedAdminPermissions {
        assert_admin_elevated_capability(caller);
        add_permission_internal(addr, AdminPermissionType::Admin {});
    }

    /// Remove an admin (requires elevated admin)
    public entry fun remove_admin(
        caller: &signer,
        addr: address
    ) acquires DelegatedAdminPermissions {
        assert_admin_elevated_capability(caller);
        remove_permission_internal(addr, AdminPermissionType::Admin {});
    }

    /// Add an elevated admin (requires deployer)
    public entry fun add_elevated_admin(
        caller: &signer,
        addr: address
    ) acquires DelegatedAdminPermissions {
        assert_deployer_capability(caller);
        add_permission_internal(addr, AdminPermissionType::ElevatedAdmin {});
    }

    /// Remove an elevated admin (requires deployer)
    public entry fun remove_elevated_admin(
        caller: &signer,
        addr: address
    ) acquires DelegatedAdminPermissions {
        assert_deployer_capability(caller);
        remove_permission_internal(addr, AdminPermissionType::ElevatedAdmin {});
    }

    /// Add oracle update permission (requires deployer)
    public entry fun add_oracle_and_mark_update_permission(
        caller: &signer,
        addr: address
    ) acquires DelegatedAdminPermissions {
        assert_deployer_capability(caller);
        add_permission_internal(addr, AdminPermissionType::OracleAndMarkUpdate {});
    }

    /// Remove oracle update permission (requires deployer)
    public entry fun remove_oracle_and_mark_update_permission(
        caller: &signer,
        addr: address
    ) acquires DelegatedAdminPermissions {
        assert_deployer_capability(caller);
        remove_permission_internal(addr, AdminPermissionType::OracleAndMarkUpdate {});
    }

    // ============================================================================
    // MARKET REGISTRATION
    // ============================================================================

    /// Register a market with internal oracle
    public entry fun register_market_with_internal_oracle(
        caller: &signer,
        symbol: string::String,
        max_leverage: u8,
        tick_size: u64,
        lot_size: u64,
        min_size: u64,
        max_open_interest: u64,
        size_decimals: u8,
        inverse: bool,
        initial_price: u64,
        price_decimals: u64
    ) acquires DelegatedAdminPermissions {
        assert_admin_elevated_capability(caller);
        perp_engine::register_market_with_internal_oracle(
            symbol, max_leverage, tick_size, lot_size, min_size,
            max_open_interest, size_decimals, inverse, initial_price, price_decimals
        );
    }

    /// Register a market with Pyth oracle
    public entry fun register_market_with_pyth_oracle(
        caller: &signer,
        symbol: string::String,
        max_leverage: u8,
        tick_size: u64,
        lot_size: u64,
        min_size: u64,
        max_open_interest: u64,
        size_decimals: u8,
        inverse: bool,
        pyth_feed_id: vector<u8>,
        pyth_price_decimals: u64,
        pyth_expo: u64,
        rescale_decimals: u8
    ) acquires DelegatedAdminPermissions {
        assert_admin_elevated_capability(caller);
        let rescale_i8 = rescale_decimals as i8;
        perp_engine::register_market_with_pyth_oracle(
            symbol, max_leverage, tick_size, lot_size, min_size,
            max_open_interest, size_decimals, inverse,
            pyth_feed_id, pyth_price_decimals, pyth_expo, rescale_i8
        );
    }

    /// Register a market with composite oracle (Pyth primary + Internal)
    public entry fun register_market_with_composite_oracle_primary_pyth(
        caller: &signer,
        symbol: string::String,
        max_leverage: u8,
        tick_size: u64,
        lot_size: u64,
        min_size: u64,
        max_open_interest: u64,
        size_decimals: u8,
        inverse: bool,
        pyth_feed_id: vector<u8>,
        pyth_price_decimals: u64,
        pyth_expo: u64,
        rescale_decimals: u8,
        deviation_threshold: u64,
        internal_price: u64,
        internal_decimals: u64,
        internal_expo: u8
    ) acquires DelegatedAdminPermissions {
        assert_admin_elevated_capability(caller);
        let rescale_i8 = rescale_decimals as i8;
        perp_engine::register_market_with_composite_oracle_primary_pyth(
            symbol, max_leverage, tick_size, lot_size, min_size,
            max_open_interest, size_decimals, inverse,
            pyth_feed_id, pyth_price_decimals, pyth_expo, rescale_i8,
            deviation_threshold, internal_price, internal_decimals, internal_expo
        );
    }

    /// Register a market with composite oracle (Chainlink primary + Internal)
    public entry fun register_market_with_composite_oracle_primary_chainlink(
        caller: &signer,
        symbol: string::String,
        max_leverage: u8,
        tick_size: u64,
        lot_size: u64,
        min_size: u64,
        max_open_interest: u64,
        size_decimals: u8,
        inverse: bool,
        chainlink_feed_id: vector<u8>,
        chainlink_decimals: u64,
        rescale_decimals: u8,
        deviation_threshold: u64,
        internal_price: u64,
        internal_decimals: u64,
        internal_expo: u8
    ) acquires DelegatedAdminPermissions {
        assert_admin_elevated_capability(caller);
        let rescale_i8 = rescale_decimals as i8;
        perp_engine::register_market_with_composite_oracle_primary_chainlink(
            symbol, max_leverage, tick_size, lot_size, min_size,
            max_open_interest, size_decimals, inverse,
            chainlink_feed_id, chainlink_decimals, rescale_i8,
            deviation_threshold, internal_price, internal_decimals, internal_expo
        );
    }

    // ============================================================================
    // MARKET STATUS
    // ============================================================================

    /// Set global exchange open/closed
    public entry fun set_global_exchange_open(
        caller: &signer,
        open: bool
    ) acquires DelegatedAdminPermissions {
        assert_admin_elevated_capability(caller);
        perp_engine::set_global_exchange_open(open);
    }

    /// Set market to open status
    public entry fun set_market_open(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        reason: option::Option<string::String>
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        perp_engine::set_market_open(market, reason);
    }

    /// Set market to halted status
    public entry fun set_market_halted(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        reason: option::Option<string::String>
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        perp_engine::set_market_halted(market, reason);
    }

    /// Set market to reduce-only mode
    public entry fun set_market_reduce_only(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        except_addresses: vector<address>,
        reason: option::Option<string::String>
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        perp_engine::set_market_reduce_only(market, except_addresses, reason);
    }

    /// Set market to allowlist-only mode
    public entry fun set_market_allowlist_only(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        allowed_addresses: vector<address>,
        reason: option::Option<string::String>
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        perp_engine::set_market_allowlist_only(market, allowed_addresses, reason);
    }

    /// Delist a market
    public entry fun delist_market(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        reason: option::Option<string::String>
    ) acquires DelegatedAdminPermissions {
        assert_admin_elevated_capability(caller);
        perp_engine::delist_market(market, reason);
    }

    /// Delist a market with a specific mark price
    public entry fun delist_market_with_mark_price(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        mark_price: u64,
        reason: option::Option<string::String>
    ) acquires DelegatedAdminPermissions {
        assert_admin_elevated_capability(caller);
        perp_engine::delist_market_with_mark_price(market, mark_price, reason);
    }

    // ============================================================================
    // MARKET PARAMETERS
    // ============================================================================

    /// Set market max leverage
    public entry fun set_market_max_leverage(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        max_leverage: u8
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        perp_engine::set_market_max_leverage(market, max_leverage);
    }

    /// Set market withdrawable margin leverage
    public entry fun set_market_withdrawable_margin_leverage(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        leverage: u8
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        perp_engine::set_market_withdrawable_margin_leverage(market, leverage);
    }

    /// Set market margin call fee percentage
    public entry fun set_market_margin_call_fee_pct(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        fee_pct: u64
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        perp_engine::set_market_margin_call_fee_pct(market, fee_pct);
    }

    /// Set market slippage percentages for liquidation
    public entry fun set_market_slippage_pcts(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        slippage_pcts: vector<u64>
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        perp_engine::set_market_slippage_pcts(market, slippage_pcts);
    }

    /// Set market unrealized PnL haircut
    public entry fun set_market_unrealized_pnl_haircut(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        haircut: u64
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        perp_engine::set_market_unrealized_pnl_haircut(market, haircut);
    }

    /// Set market open interest limit (base units)
    public entry fun set_market_open_interest(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        max_oi: u64
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        perp_engine::set_market_open_interest(market, max_oi);
    }

    /// Set market notional open interest limit (USD)
    public entry fun set_market_notional_open_interest(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        max_notional: u64
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        perp_engine::set_market_notional_open_interest(market, max_notional);
    }

    /// Set ADL trigger threshold
    public entry fun set_market_adl_trigger_threshold(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        threshold: u64
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        perp_market_config::set_adl_trigger_threshold(market, threshold);
    }

    /// Set funding rate pause timeout
    public entry fun set_market_funding_rate_pause_timeout_microseconds(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        timeout_us: u64
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        price_management::set_funding_rate_pause_timeout_microseconds(market, timeout_us);
    }

    /// Set backstop liquidator high watermark
    public entry fun set_backstop_liquidator_high_watermark(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        watermark: i64
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        perp_engine::set_backstop_liquidator_high_watermark(market, watermark);
    }

    /// Drain async processing queue
    public entry fun drain_async_queue(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        perp_engine::drain_async_queue(market);
    }

    // ============================================================================
    // FEE CONFIGURATION
    // ============================================================================

    /// Update trading fee configuration
    public entry fun update_fee_config(
        caller: &signer,
        tier_thresholds: vector<u128>,
        tier_maker_fees: vector<u64>,
        tier_taker_fees: vector<u64>,
        mm_absolute_threshold: u128,
        mm_pct_thresholds: vector<u64>,
        mm_rebates: vector<u64>,
        builder_max_fee: u64,
        backstop_pct: u64,
        referral_enabled: bool,
        referral_fee_pct: u64,
        referred_discount_pct: u64,
        discount_volume_threshold: u128,
        referrer_volume_threshold: u128
    ) acquires DelegatedAdminPermissions {
        assert_admin_capability(caller);
        trading_fees_manager::update_fee_config(
            caller,
            tier_thresholds,
            tier_maker_fees,
            tier_taker_fees,
            mm_absolute_threshold,
            mm_pct_thresholds,
            mm_rebates,
            builder_max_fee,
            backstop_pct,
            referral_enabled,
            referral_fee_pct,
            referred_discount_pct,
            discount_volume_threshold,
            referrer_volume_threshold
        );
    }

    // ============================================================================
    // ORACLE UPDATES
    // ============================================================================

    /// Update mark price for internal oracle market
    public entry fun update_mark_for_internal_oracle(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        new_price: u64,
        liquidation_targets: vector<address>,
        trigger_orders: bool
    ) acquires DelegatedAdminPermissions {
        assert_admin_oracle_and_mark_update_capability(caller);
        let price_option = option::some<u64>(new_price);
        let chainlink_none = option::none<vector<u8>>();
        let pyth_none = option::none<vector<u8>>();
        let refresh_input = price_management::new_mark_price_refresh_input_none();
        perp_engine::update_oracle_and_mark_price_and_liquidate_and_trigger(
            caller, market, price_option, chainlink_none, pyth_none,
            refresh_input, liquidation_targets, trigger_orders
        );
    }

    /// Update mark price for Pyth oracle market
    public entry fun update_mark_for_pyth_oracle(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        pyth_update_data: vector<u8>,
        liquidation_targets: vector<address>,
        trigger_orders: bool
    ) acquires DelegatedAdminPermissions {
        assert_admin_oracle_and_mark_update_capability(caller);
        let price_none = option::none<u64>();
        let chainlink_none = option::none<vector<u8>>();
        let pyth_option = option::some<vector<u8>>(pyth_update_data);
        let refresh_input = price_management::new_mark_price_refresh_input_none();
        perp_engine::update_oracle_and_mark_price_and_liquidate_and_trigger(
            caller, market, price_none, chainlink_none, pyth_option,
            refresh_input, liquidation_targets, trigger_orders
        );
    }

    /// Update mark price for Chainlink oracle market
    public entry fun update_mark_for_chainlink_oracle(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        chainlink_report: vector<u8>,
        liquidation_targets: vector<address>,
        trigger_orders: bool
    ) acquires DelegatedAdminPermissions {
        assert_admin_oracle_and_mark_update_capability(caller);
        let price_none = option::none<u64>();
        let chainlink_option = option::some<vector<u8>>(chainlink_report);
        let pyth_none = option::none<vector<u8>>();
        let refresh_input = price_management::new_mark_price_refresh_input_none();
        perp_engine::update_oracle_and_mark_price_and_liquidate_and_trigger(
            caller, market, price_none, chainlink_option, pyth_none,
            refresh_input, liquidation_targets, trigger_orders
        );
    }

    /// Update mark price for composite Chainlink + Internal market
    public entry fun update_mark_for_composite_chainlink(
        caller: &signer,
        market: object::Object<perp_market::PerpMarket>,
        internal_price: option::Option<u64>,
        chainlink_report: option::Option<vector<u8>>,
        bid_impact_price: option::Option<u64>,
        ask_impact_price: option::Option<u64>,
        liquidation_targets: vector<address>,
        trigger_orders: bool
    ) acquires DelegatedAdminPermissions {
        assert_admin_oracle_and_mark_update_capability(caller);

        let pyth_none = option::none<vector<u8>>();

        // Build refresh input if impact prices provided
        let refresh_input: price_management::MarkPriceRefreshInput;
        let has_bid = option::is_some<u64>(&bid_impact_price);
        let has_ask = option::is_some<u64>(&ask_impact_price);

        if (has_bid && has_ask) {
            let bid = option::destroy_some<u64>(bid_impact_price);
            let ask = option::destroy_some<u64>(ask_impact_price);
            refresh_input = price_management::new_mark_price_refresh_input_with_impact_hint(bid, ask);
        } else {
            refresh_input = price_management::new_mark_price_refresh_input_none();
        };

        perp_engine::update_oracle_and_mark_price_and_liquidate_and_trigger(
            caller, market, internal_price, chainlink_report, pyth_none,
            refresh_input, liquidation_targets, trigger_orders
        );
    }

    // ============================================================================
    // TIME MANAGEMENT (Testing)
    // ============================================================================

    /// Increment simulated time (for testing)
    public entry fun increment_time(caller: &signer) {
        decibel_time::increment_time(caller);
    }
}
