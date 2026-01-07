/// ============================================================================
/// TRADING FEES MANAGER - Tiered Fee Structure and Volume Tracking
/// ============================================================================
///
/// This module manages the trading fee structure including:
/// - Volume-based tiered fees for makers and takers
/// - Market maker rebate programs
/// - Referral fee sharing
/// - Builder fee integration
///
/// FEE TIERS:
///
/// Fees decrease as trading volume increases. Default tiers:
/// - Tier 0: < $10M volume  -> Maker: 1.1bps, Taker: 3.4bps
/// - Tier 1: < $50M volume  -> Maker: 0.9bps, Taker: 3.0bps
/// - Tier 2: < $200M volume -> Maker: 0.6bps, Taker: 2.5bps
/// - Tier 3: < $1B volume   -> Maker: 0.3bps, Taker: 2.2bps
/// - Tier 4: < $4B volume   -> Maker: 0bps, Taker: 2.1bps
/// - Tier 5: < $15B volume  -> Maker: 0bps, Taker: 1.9bps
/// - Tier 6: >= $15B volume -> Maker: 0bps, Taker: 1.8bps
///
/// MARKET MAKER PROGRAM:
///
/// High-volume makers can qualify for fee REBATES (negative fees).
/// Requirements:
/// - Meet absolute volume threshold
/// - Meet percentage of global volume threshold
///
/// REFERRAL PROGRAM:
///
/// Users can refer others and earn:
/// - Referrer: percentage of referred user's fees
/// - Referred: discount on their fees
/// - Eligibility limited by volume threshold
///
/// ============================================================================

module decibel::trading_fees_manager {
    use std::signer;
    use std::vector;
    use std::option;
    use std::error;
    use std::event;
    use std::string;

    use decibel::volume_tracker;
    use decibel::referral_registry;
    use decibel::builder_code_registry;
    use decibel::fee_distribution;
    use decibel::collateral_balance_sheet;
    use decibel::perp_market_config;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::position_update;
    friend decibel::accounts_collateral;
    friend decibel::admin_apis;
    friend decibel::perp_engine_api;

    // ============================================================================
    // CONSTANTS
    // ============================================================================

    /// Basis point precision (1 million = 100%)
    const BPS_PRECISION: u128 = 1000000;

    // ============================================================================
    // EVENTS
    // ============================================================================

    /// Event emitted when fee configuration is updated
    enum TradingFeeTierUpdatedEvent has copy, drop, store {
        V1 {
            config: TradingFeeConfiguration,
        }
    }

    // ============================================================================
    // CORE STRUCTURES
    // ============================================================================

    /// Referral fee configuration
    enum ReferralFeeConfig has copy, drop, store {
        V1 {
            /// Whether referral fees are enabled
            referral_fee_enabled: bool,
            /// Percentage of fees paid to referrer (0-100)
            referral_fee_pct: u64,
            /// Percentage discount for referred users (0-100)
            referred_fee_discount_pct: u64,
            /// Volume threshold above which user no longer gets discount
            discount_eligibility_volume_threshold: u128,
            /// Volume threshold below which user can't be referred
            referrer_eligibility_volume_threshold: u128,
        }
    }

    /// Trading fee tier configuration
    enum TradingFeeConfiguration has copy, drop, store {
        V1 {
            /// Volume thresholds for each tier (in notional USD)
            tier_thresholds: vector<u128>,
            /// Maker fees for each tier (in bps * 100)
            tier_maker_fees: vector<u64>,
            /// Taker fees for each tier (in bps * 100)
            tier_taker_fees: vector<u64>,
            /// Minimum volume to qualify for market maker rebates
            market_maker_absolute_threshold: u128,
            /// Percentage of global volume thresholds for MM tiers
            market_maker_tier_pct_thresholds: vector<u64>,
            /// Fee rebates for each MM tier (in bps * 100)
            market_maker_tier_fee_rebates: vector<u64>,
            /// Maximum fee builders can charge
            builder_max_fee: u64,
            /// Percentage of fees going to backstop vault
            backstop_vault_fee_pct: u64,
            /// Referral fee configuration
            referral_fee_config: ReferralFeeConfig,
        }
    }

    /// Global state containing all fee-related data
    enum GlobalState has key {
        V1 {
            /// Volume tracking statistics
            volume_stats: volume_tracker::VolumeStats,
            /// Fee configuration
            fee_config: TradingFeeConfiguration,
            /// Referral registry
            referrals: referral_registry::Referrals,
        }
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Initialize the trading fees manager
    friend fun initialize(deployer: &signer, usdc_decimals: u64) {
        if (!(signer::address_of(deployer) == @decibel)) {
            abort error::invalid_argument(1)
        };

        // Initialize sub-modules
        let volume_stats = volume_tracker::initialize();
        let referrals = referral_registry::initialize();
        let fee_config = create_default_config(usdc_decimals as u128);

        // Initialize builder registry with max fee
        let max_builder_fee = *&(&fee_config).builder_max_fee;
        builder_code_registry::initialize(deployer, max_builder_fee);

        let state = GlobalState::V1 {
            volume_stats,
            fee_config,
            referrals,
        };
        move_to<GlobalState>(deployer, state);

        // Emit initial config event
        event::emit<TradingFeeTierUpdatedEvent>(TradingFeeTierUpdatedEvent::V1 {
            config: fee_config,
        });
    }

    /// Create default fee configuration
    ///
    /// Volume thresholds are scaled by USDC decimals (10^decimals)
    fun create_default_config(decimal_multiplier: u128): TradingFeeConfiguration {
        // Volume thresholds: $10M, $50M, $200M, $1B, $4B, $15B
        let t1 = 10000000u128 * decimal_multiplier;     // $10M
        let t2 = 50000000u128 * decimal_multiplier;     // $50M
        let t3 = 200000000u128 * decimal_multiplier;    // $200M
        let t4 = 1000000000u128 * decimal_multiplier;   // $1B
        let t5 = 4000000000u128 * decimal_multiplier;   // $4B
        let t6 = 15000000000u128 * decimal_multiplier;  // $15B

        let thresholds = vector::empty<u128>();
        vector::push_back<u128>(&mut thresholds, t1);
        vector::push_back<u128>(&mut thresholds, t2);
        vector::push_back<u128>(&mut thresholds, t3);
        vector::push_back<u128>(&mut thresholds, t4);
        vector::push_back<u128>(&mut thresholds, t5);
        vector::push_back<u128>(&mut thresholds, t6);

        // Empty market maker config (disabled by default)
        let mm_pct_thresholds = vector::empty<u64>();
        let mm_rebates = vector::empty<u64>();

        let referral_config = create_default_referral_fee_config();

        TradingFeeConfiguration::V1 {
            tier_thresholds: thresholds,
            // Maker fees: 110, 90, 60, 30, 0, 0, 0 (bps * 100)
            tier_maker_fees: vector[110, 90, 60, 30, 0, 0, 0],
            // Taker fees: 340, 300, 250, 220, 210, 190, 180 (bps * 100)
            tier_taker_fees: vector[340, 300, 250, 220, 210, 190, 180],
            market_maker_absolute_threshold: 0u128,
            market_maker_tier_pct_thresholds: mm_pct_thresholds,
            market_maker_tier_fee_rebates: mm_rebates,
            builder_max_fee: 1000,  // 10bps max
            backstop_vault_fee_pct: 0,
            referral_fee_config: referral_config,
        }
    }

    /// Create default referral fee config (disabled)
    fun create_default_referral_fee_config(): ReferralFeeConfig {
        ReferralFeeConfig::V1 {
            referral_fee_enabled: false,
            referral_fee_pct: 0,
            referred_fee_discount_pct: 0,
            discount_eligibility_volume_threshold: 100000000u128,
            referrer_eligibility_volume_threshold: 10000u128,
        }
    }

    // ============================================================================
    // VOLUME TRACKING
    // ============================================================================

    /// Track trading volume for maker and taker
    friend fun track_volume(
        maker: address,
        taker: address,
        notional: u128
    ) acquires GlobalState {
        let state = borrow_global_mut<GlobalState>(@decibel);
        volume_tracker::track_volume(&mut state.volume_stats, maker, taker, notional);
    }

    /// Track taker volume only
    friend fun track_taker_volume(taker: address, notional: u128) acquires GlobalState {
        let state = borrow_global_mut<GlobalState>(@decibel);
        volume_tracker::track_taker_volume(&mut state.volume_stats, taker, notional);
    }

    /// Track global and maker volume (for market maker tracking)
    friend fun track_global_and_maker_volume(maker: address, notional: u128) acquires GlobalState {
        let state = borrow_global_mut<GlobalState>(@decibel);
        // Track as maker only (taker = 0x0)
        volume_tracker::track_volume(&mut state.volume_stats, maker, @0x0, notional);
    }

    // ============================================================================
    // VOLUME GETTERS
    // ============================================================================

    /// Get global trading volume in window
    public fun get_global_volume_in_window(): u128 acquires GlobalState {
        let state = borrow_global_mut<GlobalState>(@decibel);
        volume_tracker::get_global_volume_in_window(&mut state.volume_stats)
    }

    /// Get user's maker volume all time
    public fun get_maker_volume_all_time(user: address): u128 acquires GlobalState {
        let state = borrow_global_mut<GlobalState>(@decibel);
        volume_tracker::get_maker_volume_all_time(&mut state.volume_stats, user)
    }

    /// Get user's maker volume in window
    public fun get_maker_volume_in_window(user: address): u128 acquires GlobalState {
        let state = borrow_global_mut<GlobalState>(@decibel);
        volume_tracker::get_maker_volume_in_window(&mut state.volume_stats, user)
    }

    /// Get user's taker volume all time
    public fun get_taker_volume_all_time(user: address): u128 acquires GlobalState {
        let state = borrow_global_mut<GlobalState>(@decibel);
        volume_tracker::get_taker_volume_all_time(&mut state.volume_stats, user)
    }

    /// Get user's taker volume in window
    public fun get_taker_volume_in_window(user: address): u128 acquires GlobalState {
        let state = borrow_global_mut<GlobalState>(@decibel);
        volume_tracker::get_taker_volume_in_window(&mut state.volume_stats, user)
    }

    /// Get user's total volume in window (maker + taker)
    public fun get_total_volume_in_window(user: address): u128 acquires GlobalState {
        let state = borrow_global_mut<GlobalState>(@decibel);
        volume_tracker::get_total_volume_in_window(&mut state.volume_stats, user)
    }

    /// Get user's total volume all time
    public fun get_user_volume_all_time(user: address): u128 acquires GlobalState {
        get_maker_volume_all_time(user) + get_taker_volume_all_time(user)
    }

    /// Get user's total volume in window
    public fun get_user_volume_in_window(user: address): u128 acquires GlobalState {
        get_maker_volume_in_window(user) + get_taker_volume_in_window(user)
    }

    // ============================================================================
    // FEE TIER CALCULATION
    // ============================================================================

    /// Get user's current fee tier based on volume
    public fun get_fee_tier(user: address): u64 acquires GlobalState {
        let state = borrow_global_mut<GlobalState>(@decibel);
        let volume = volume_tracker::get_total_volume_in_window(&mut state.volume_stats, user);
        let thresholds = &(&state.fee_config).tier_thresholds;

        let tier: u64 = 0;
        loop {
            let num_tiers = vector::length<u128>(thresholds);
            let in_bounds = tier < num_tiers;
            let meets_threshold = if (in_bounds) {
                volume >= *vector::borrow<u128>(thresholds, tier)
            } else {
                false
            };

            if (!meets_threshold) break;
            tier = tier + 1;
        };

        tier
    }

    /// Get maker fee for a given volume level
    fun get_maker_fees_for_volume(config: &TradingFeeConfiguration, volume: u128): u64 {
        let tier: u64 = 0;
        loop {
            let num_tiers = vector::length<u128>(&config.tier_thresholds);
            let in_bounds = tier < num_tiers;
            let meets_threshold = if (in_bounds) {
                volume >= *vector::borrow<u128>(&config.tier_thresholds, tier)
            } else {
                false
            };

            if (!meets_threshold) break;
            tier = tier + 1;
        };

        *vector::borrow<u64>(&config.tier_maker_fees, tier)
    }

    /// Get taker fee for a given volume level
    fun get_taker_fees_for_volume(config: &TradingFeeConfiguration, volume: u128): u64 {
        let tier: u64 = 0;
        loop {
            let num_tiers = vector::length<u128>(&config.tier_thresholds);
            let in_bounds = tier < num_tiers;
            let meets_threshold = if (in_bounds) {
                volume >= *vector::borrow<u128>(&config.tier_thresholds, tier)
            } else {
                false
            };

            if (!meets_threshold) break;
            tier = tier + 1;
        };

        *vector::borrow<u64>(&config.tier_taker_fees, tier)
    }

    /// Get market maker fee rebate based on volume percentage
    fun get_market_maker_fee_rebate(
        config: &TradingFeeConfiguration,
        user_volume: u128,
        global_volume: u128
    ): u64 {
        let num_rebates = vector::length<u64>(&config.market_maker_tier_fee_rebates);

        // No rebate config
        if (num_rebates == 0) {
            return 0
        };

        // Check absolute threshold
        let abs_threshold = *&config.market_maker_absolute_threshold;
        if (user_volume < abs_threshold) {
            return 0
        };

        // Check percentage threshold
        if (global_volume == 0u128) {
            return 0
        };

        // Calculate percentage: (user_volume * 10000) / global_volume
        let user_u256 = (user_volume as u256) * 10000u256;
        let global_u256 = global_volume as u256;
        let percentage = ((user_u256 / global_u256) as u128) as u64;

        // Find matching tier
        let tier: u64 = 0;
        loop {
            let num_tiers = vector::length<u64>(&config.market_maker_tier_pct_thresholds);
            let in_bounds = tier < num_tiers;
            let meets_threshold = if (in_bounds) {
                percentage >= *vector::borrow<u64>(&config.market_maker_tier_pct_thresholds, tier)
            } else {
                false
            };

            if (!meets_threshold) break;
            tier = tier + 1;
        };

        *vector::borrow<u64>(&config.market_maker_tier_fee_rebates, tier)
    }

    // ============================================================================
    // FEE CALCULATION
    // ============================================================================

    /// Get maker fees and configuration for a user
    public fun get_maker_fees_and_config(user: address): (u64, u64, u64, ReferralFeeConfig)
    acquires GlobalState {
        let state = borrow_global_mut<GlobalState>(@decibel);
        let volume = volume_tracker::get_total_volume_in_window(&mut state.volume_stats, user);

        // Check for market maker rebate
        let rebate: u64;
        if (*&(&state.fee_config).market_maker_absolute_threshold != 0u128) {
            let global_volume = volume_tracker::get_global_volume_in_window(&mut state.volume_stats);
            rebate = get_market_maker_fee_rebate(&state.fee_config, volume, global_volume);
        } else {
            rebate = 0;
        };

        if (rebate != 0) {
            // Market maker gets rebate (negative fee)
            let backstop_pct = *&(&state.fee_config).backstop_vault_fee_pct;
            let referral_config = *&(&state.fee_config).referral_fee_config;
            return (rebate, 0, backstop_pct, referral_config)
        };

        // Regular maker fee
        let maker_fee = get_maker_fees_for_volume(&state.fee_config, volume);
        let backstop_pct = *&(&state.fee_config).backstop_vault_fee_pct;
        let referral_config = *&(&state.fee_config).referral_fee_config;
        (0, maker_fee, backstop_pct, referral_config)
    }

    /// Get taker fees and configuration for a user
    public fun get_taker_fees_and_config(user: address): (u64, u64, ReferralFeeConfig)
    acquires GlobalState {
        let state = borrow_global_mut<GlobalState>(@decibel);
        let volume = volume_tracker::get_total_volume_in_window(&mut state.volume_stats, user);
        let taker_fee = get_taker_fees_for_volume(&state.fee_config, volume);
        let backstop_pct = *&(&state.fee_config).backstop_vault_fee_pct;
        let referral_config = *&(&state.fee_config).referral_fee_config;
        (taker_fee, backstop_pct, referral_config)
    }

    /// Calculate maker fee for a given notional amount
    friend fun get_maker_fee_for_notional(
        subaccount: address,
        user: address,
        balance_type: collateral_balance_sheet::CollateralBalanceType,
        notional: u128,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): fee_distribution::FeeDistribution acquires GlobalState {
        let (rebate, fee, _backstop_pct, referral_config) = get_maker_fees_and_config(user);

        if (rebate != 0) {
            // Market maker rebate
            let fee_amount = (notional * (rebate as u128) / BPS_PRECISION) as u64;

            // Builder fee (if any)
            let builder_fee: u64;
            if (option::is_some<builder_code_registry::BuilderCode>(&builder_code)) {
                let code = option::destroy_some<builder_code_registry::BuilderCode>(builder_code);
                builder_fee = builder_code_registry::get_builder_fee_for_notional(subaccount, code, notional);
            } else {
                builder_fee = 0;
            };

            // Net position delta (rebate minus builder fee)
            let position_delta = (builder_fee as i64) - (fee_amount as i64);

            let builder_option = if (builder_fee > 0) {
                let builder_addr = builder_code_registry::get_builder_from_builder_code(
                    option::borrow<builder_code_registry::BuilderCode>(&builder_code)
                );
                option::some<fee_distribution::FeeWithDestination>(
                    fee_distribution::new_fee_with_destination(builder_addr, builder_fee)
                )
            } else {
                option::none<fee_distribution::FeeWithDestination>()
            };

            return fee_distribution::new_fee_distribution(balance_type, position_delta, builder_option)
        };

        // Regular maker fee
        let fee_amount = (notional * (fee as u128) / BPS_PRECISION) as u64;

        // Builder fee
        let builder_fee: u64;
        if (option::is_some<builder_code_registry::BuilderCode>(&builder_code)) {
            let code = option::destroy_some<builder_code_registry::BuilderCode>(builder_code);
            builder_fee = builder_code_registry::get_builder_fee_for_notional(subaccount, code, notional);
        } else {
            builder_fee = 0;
        };

        if (builder_fee > 0) {
            // Builder takes portion of fee
            let builder_addr = builder_code_registry::get_builder_from_builder_code(
                option::borrow<builder_code_registry::BuilderCode>(&builder_code)
            );
            let builder_option = option::some<fee_distribution::FeeWithDestination>(
                fee_distribution::new_fee_with_destination(builder_addr, builder_fee)
            );
            let total_fee = (fee_amount + builder_fee) as i64;
            return fee_distribution::new_fee_distribution(balance_type, total_fee, builder_option)
        };

        // Check referral discount
        if (!*&(&referral_config).referral_fee_enabled) {
            return fee_distribution::new_fee_distribution(
                balance_type,
                fee_amount as i64,
                option::none<fee_distribution::FeeWithDestination>()
            )
        };

        let referrer = get_referrer_addr(user);
        if (option::is_none<address>(&referrer)) {
            return fee_distribution::new_fee_distribution(
                balance_type,
                fee_amount as i64,
                option::none<fee_distribution::FeeWithDestination>()
            )
        };

        // Check if user is still eligible for discount
        let user_volume = get_user_volume_all_time(user);
        let discount_threshold = *&(&referral_config).discount_eligibility_volume_threshold;
        if (user_volume >= discount_threshold) {
            return fee_distribution::new_fee_distribution(
                balance_type,
                fee_amount as i64,
                option::none<fee_distribution::FeeWithDestination>()
            )
        };

        // Apply referral discount
        let referrer_addr = option::destroy_some<address>(referrer);
        let discount_pct = *&(&referral_config).referred_fee_discount_pct;
        let discounted_fee = fee_amount * (100 - discount_pct) / 100;
        let referrer_pct = *&(&referral_config).referral_fee_pct;
        let referrer_fee = discounted_fee * referrer_pct / 100;

        let referrer_option = option::some<fee_distribution::FeeWithDestination>(
            fee_distribution::new_fee_with_destination(referrer_addr, referrer_fee)
        );

        fee_distribution::new_fee_distribution(balance_type, discounted_fee as i64, referrer_option)
    }

    /// Calculate taker fee for a given notional amount
    friend fun get_taker_fee_for_notional(
        subaccount: address,
        user: address,
        balance_type: collateral_balance_sheet::CollateralBalanceType,
        notional: u128,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): fee_distribution::FeeDistribution acquires GlobalState {
        let (fee, _backstop_pct, referral_config) = get_taker_fees_and_config(user);

        // Calculate base fee
        let fee_amount = (notional * (fee as u128) / BPS_PRECISION) as u64;

        // Builder fee
        let builder_fee: u64;
        if (option::is_some<builder_code_registry::BuilderCode>(&builder_code)) {
            let code = option::destroy_some<builder_code_registry::BuilderCode>(builder_code);
            builder_fee = builder_code_registry::get_builder_fee_for_notional(subaccount, code, notional);
        } else {
            builder_fee = 0;
        };

        if (builder_fee > 0) {
            let builder_addr = builder_code_registry::get_builder_from_builder_code(
                option::borrow<builder_code_registry::BuilderCode>(&builder_code)
            );
            let builder_option = option::some<fee_distribution::FeeWithDestination>(
                fee_distribution::new_fee_with_destination(builder_addr, builder_fee)
            );
            let total_fee = (fee_amount + builder_fee) as i64;
            return fee_distribution::new_fee_distribution(balance_type, total_fee, builder_option)
        };

        // Check referral discount
        if (!*&(&referral_config).referral_fee_enabled) {
            return fee_distribution::new_fee_distribution(
                balance_type,
                fee_amount as i64,
                option::none<fee_distribution::FeeWithDestination>()
            )
        };

        let referrer = get_referrer_addr(user);
        if (option::is_none<address>(&referrer)) {
            return fee_distribution::new_fee_distribution(
                balance_type,
                fee_amount as i64,
                option::none<fee_distribution::FeeWithDestination>()
            )
        };

        let user_volume = get_user_volume_all_time(user);
        let discount_threshold = *&(&referral_config).discount_eligibility_volume_threshold;
        if (user_volume >= discount_threshold) {
            return fee_distribution::new_fee_distribution(
                balance_type,
                fee_amount as i64,
                option::none<fee_distribution::FeeWithDestination>()
            )
        };

        // Apply referral discount
        let referrer_addr = option::destroy_some<address>(referrer);
        let discount_pct = *&(&referral_config).referred_fee_discount_pct;
        let discounted_fee = fee_amount * (100 - discount_pct) / 100;
        let referrer_pct = *&(&referral_config).referral_fee_pct;
        let referrer_fee = discounted_fee * referrer_pct / 100;

        let referrer_option = option::some<fee_distribution::FeeWithDestination>(
            fee_distribution::new_fee_with_destination(referrer_addr, referrer_fee)
        );

        fee_distribution::new_fee_distribution(balance_type, discounted_fee as i64, referrer_option)
    }

    /// Get fees for margin call liquidation
    friend fun get_fees_for_margin_call(
        balance_type: collateral_balance_sheet::CollateralBalanceType,
        notional: u128,
        fee_pct: u64
    ): fee_distribution::FeeDistribution {
        // Fee in bps: fee_pct * 1M / fee_scale
        let fee_scaled = (fee_pct as u128) * BPS_PRECISION;
        let fee_scale = perp_market_config::get_slippage_and_margin_call_fee_scale() as u128;
        let fee_bps = ((fee_scaled / fee_scale) as u64) as u128;

        // Calculate fee amount
        let fee_amount = ((notional * fee_bps / BPS_PRECISION) as u64) as i64;

        let none = option::none<fee_distribution::FeeWithDestination>();
        fee_distribution::new_fee_distribution(balance_type, fee_amount, none)
    }

    // ============================================================================
    // FEE DISTRIBUTION
    // ============================================================================

    /// Distribute fees to all recipients
    friend fun distribute_fees(
        maker_dist: &fee_distribution::FeeDistribution,
        taker_dist: &fee_distribution::FeeDistribution,
        balance_sheet: &mut collateral_balance_sheet::CollateralBalanceSheet,
        backstop_addr: address
    ) acquires GlobalState {
        let backstop_pct = *&(&borrow_global<GlobalState>(@decibel).fee_config).backstop_vault_fee_pct;
        fee_distribution::distribute_fees(maker_dist, taker_dist, balance_sheet, backstop_addr, backstop_pct);
    }

    // ============================================================================
    // REFERRAL MANAGEMENT
    // ============================================================================

    /// Get user's referral code
    public fun get_referral_code(user: address): option::Option<string::String> acquires GlobalState {
        let state = borrow_global<GlobalState>(@decibel);
        referral_registry::get_referral_code(&state.referrals, user)
    }

    /// Get user's referrer address
    public fun get_referrer_addr(user: address): option::Option<address> acquires GlobalState {
        let state = borrow_global<GlobalState>(@decibel);
        referral_registry::get_referrer_addr(&state.referrals, user)
    }

    /// Register a referral code for a user
    friend fun register_referral_code(user: address, code: string::String) acquires GlobalState {
        let state = borrow_global_mut<GlobalState>(@decibel);
        referral_registry::register_referral_code(&mut state.referrals, user, code);
    }

    /// Register a referrer for a user
    friend fun register_referrer(user: address, referral_code: string::String) acquires GlobalState {
        // Check volume threshold
        let user_volume = get_user_volume_all_time(user);
        let threshold = *&(&(&borrow_global<GlobalState>(@decibel).fee_config).referral_fee_config)
            .referrer_eligibility_volume_threshold;

        // User can only be referred if they have less than threshold volume
        if (!(user_volume < threshold)) {
            abort error::invalid_argument(2)
        };

        let state = borrow_global_mut<GlobalState>(@decibel);
        referral_registry::register_referrer(&mut state.referrals, user, referral_code);
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    /// Update the fee configuration
    friend fun update_fee_config(
        admin: &signer,
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
    ) acquires GlobalState {
        if (!(signer::address_of(admin) == @decibel)) {
            abort error::invalid_argument(1)
        };

        let state = borrow_global_mut<GlobalState>(@decibel);

        let referral_config = ReferralFeeConfig::V1 {
            referral_fee_enabled: referral_enabled,
            referral_fee_pct,
            referred_fee_discount_pct: referred_discount_pct,
            discount_eligibility_volume_threshold: discount_volume_threshold,
            referrer_eligibility_volume_threshold: referrer_volume_threshold,
        };

        let new_config = TradingFeeConfiguration::V1 {
            tier_thresholds,
            tier_maker_fees,
            tier_taker_fees,
            market_maker_absolute_threshold: mm_absolute_threshold,
            market_maker_tier_pct_thresholds: mm_pct_thresholds,
            market_maker_tier_fee_rebates: mm_rebates,
            builder_max_fee,
            backstop_vault_fee_pct: backstop_pct,
            referral_fee_config: referral_config,
        };

        event::emit<TradingFeeTierUpdatedEvent>(TradingFeeTierUpdatedEvent::V1 {
            config: new_config,
        });

        let config_ref = &mut state.fee_config;
        *config_ref = new_config;
    }
}
