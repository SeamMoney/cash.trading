/// ============================================================================
/// Module: accounts_collateral
/// Description: Global collateral state management and coordination
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module serves as the central coordinator for all collateral operations.
/// It manages the global account state which includes:
/// - Collateral balance sheets (cross and isolated margins)
/// - Liquidation configuration
///
/// Key Responsibilities:
/// 1. Initialize the entire collateral subsystem
/// 2. Route deposits and withdrawals to the balance sheet
/// 3. Validate order placements against available margin
/// 4. Validate and commit position updates
/// 5. Handle fee distribution
/// 6. Check liquidation eligibility
///
/// Access Control:
/// - clearinghouse_perp: Main trading operations
/// - liquidation: Liquidation processing
/// - async_matching_engine: Order matching
/// - perp_engine: Position management
/// ============================================================================

module decibel::accounts_collateral {
    use decibel::collateral_balance_sheet;
    use decibel::liquidation_config;
    use aptos_framework::object;
    use aptos_framework::fungible_asset;
    use aptos_framework::signer;
    use decibel::price_management;
    use decibel::math;
    use decibel::trading_fees_manager;
    use decibel::fee_treasury;
    use decibel::backstop_liquidator_profit_tracker;
    use decibel::pending_order_tracker;
    use aptos_framework::error;
    use decibel::perp_market;
    use aptos_framework::option;
    use aptos_framework::string;
    use decibel::order_margin;
    use decibel::oracle;
    use decibel::fee_distribution;
    use order_book::order_book_types;
    use decibel::perp_engine_types;
    use decibel::perp_positions;
    use decibel::position_update;
    use decibel::builder_code_registry;
    use aptos_framework::math64;

    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================

    /// Clearinghouse processes trades and settlements
    friend decibel::clearinghouse_perp;

    /// Liquidation module handles underwater position liquidation
    friend decibel::liquidation;

    /// Async matching engine processes order fills
    friend decibel::async_matching_engine;

    /// Perp engine coordinates trading operations
    friend decibel::perp_engine;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// Contract admin address
    const DECIBEL_ADDRESS: address = @0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844;

    /// Error: Invalid asset type deposited
    const E_INVALID_ASSET_TYPE: u64 = 3;

    /// Error: Unauthorized caller
    const E_UNAUTHORIZED: u64 = 4;

    /// Error: Insufficient margin for withdrawal
    const E_INSUFFICIENT_MARGIN: u64 = 6;

    /// Error: Already initialized
    const E_ALREADY_INITIALIZED: u64 = 7;

    /// Error: Not initialized
    const E_NOT_INITIALIZED: u64 = 8;

    // =========================================================================
    // TYPES
    // =========================================================================

    /// Global state for all account collateral
    ///
    /// This is a singleton resource stored at the contract address that holds:
    /// - The collateral balance sheet (tracks all user balances)
    /// - Liquidation configuration (thresholds, backstop liquidator)
    enum GlobalAccountStates has key {
        V1 {
            /// Balance tracking for all users (cross + isolated margins)
            collateral: collateral_balance_sheet::CollateralBalanceSheet,
            /// Liquidation parameters (thresholds, penalties, backstop address)
            liquidation_config: liquidation_config::LiquidationConfig,
        }
    }

    // =========================================================================
    // PUBLIC INITIALIZATION
    // =========================================================================

    /// Initializes the global collateral system
    ///
    /// # Arguments
    /// * `admin` - Contract admin signer
    /// * `primary_asset` - Collateral asset metadata (USDC)
    /// * `decimals` - Decimal precision for internal calculations (typically 8)
    /// * `backstop_liquidator` - Address of the backstop liquidator
    ///
    /// # Effects
    /// - Initializes price management
    /// - Initializes trading fees manager
    /// - Initializes fee treasury
    /// - Initializes backstop liquidator profit tracker
    /// - Initializes pending order tracker
    /// - Creates GlobalAccountStates with collateral sheet and liquidation config
    ///
    /// # Permissions
    /// Only callable by contract admin
    public fun initialize(
        admin: &signer,
        primary_asset: object::Object<fungible_asset::Metadata>,
        decimals: u8,
        backstop_liquidator: address
    ) {
        // Verify admin authorization
        if (!(signer::address_of(admin) == DECIBEL_ADDRESS)) {
            abort error::invalid_argument(E_UNAUTHORIZED)
        };

        // Initialize subsystems
        price_management::new_price_management(admin);

        let precision = math::new_precision(decimals);
        let decimals_multiplier = math::get_decimals_multiplier(&precision);

        trading_fees_manager::initialize(admin, decimals_multiplier);
        fee_treasury::initialize(admin, primary_asset);
        backstop_liquidator_profit_tracker::initialize(admin);
        pending_order_tracker::initialize(admin);

        // Prevent double initialization
        if (exists<GlobalAccountStates>(DECIBEL_ADDRESS)) {
            abort E_ALREADY_INITIALIZED
        };

        // Create global state
        let collateral_sheet = collateral_balance_sheet::initialize(admin, primary_asset, decimals);
        let liq_config = liquidation_config::new_config(backstop_liquidator);

        let global_state = GlobalAccountStates::V1 {
            collateral: collateral_sheet,
            liquidation_config: liq_config,
        };
        move_to<GlobalAccountStates>(admin, global_state);
    }

    // =========================================================================
    // PUBLIC VIEW FUNCTIONS
    // =========================================================================

    /// Checks if an asset is supported as collateral
    public fun is_asset_supported(
        asset: object::Object<fungible_asset::Metadata>
    ): bool acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        collateral_balance_sheet::is_asset_supported(&state.collateral, asset)
    }

    /// Gets the primary collateral asset metadata (USDC)
    public fun primary_asset_metadata(): object::Object<fungible_asset::Metadata>
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        collateral_balance_sheet::primary_asset_metadata(&state.collateral)
    }

    /// Gets the precision for collateral balances
    public fun collateral_balance_precision(): math::Precision acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        collateral_balance_sheet::balance_precision(&state.collateral)
    }

    /// Gets a user's cross margin balance (total collateral value)
    ///
    /// # Arguments
    /// * `user` - User address to query
    ///
    /// # Returns
    /// Total collateral value in balance precision (8 decimals)
    public fun get_account_balance(user: address): u64 acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        let balance_type = collateral_balance_sheet::balance_type_cross(user);
        collateral_balance_sheet::total_asset_collateral_value(&state.collateral, balance_type)
    }

    /// Gets a user's cross margin balance in fungible asset decimals (6 for USDC)
    public fun get_account_balance_fungible(user: address): u64 acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        let balance_type = collateral_balance_sheet::balance_type_cross(user);
        let balance = collateral_balance_sheet::total_asset_collateral_value(&state.collateral, balance_type);
        collateral_balance_sheet::convert_balance_to_fungible_amount(&state.collateral, balance, false)
    }

    /// Gets a user's USDC balance (can be negative due to losses)
    ///
    /// # Returns
    /// Signed balance of primary asset in balance precision
    public fun get_account_usdc_balance(user: address): i64 acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        let balance_type = collateral_balance_sheet::balance_type_cross(user);
        collateral_balance_sheet::balance_of_primary_asset(&state.collateral, balance_type)
    }

    /// Gets a user's secondary asset balance (e.g., wBTC, wETH)
    public fun get_account_secondary_asset_balance(
        user: address,
        asset: object::Object<fungible_asset::Metadata>
    ): u64 acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        let balance_type = collateral_balance_sheet::balance_type_cross(user);
        collateral_balance_sheet::secondary_asset_fungible_amount(&state.collateral, balance_type, asset)
    }

    /// Gets isolated position margin for a specific market
    public fun get_isolated_position_margin(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): u64 acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        let balance_type = collateral_balance_sheet::balance_type_isolated(user, market);
        collateral_balance_sheet::total_asset_collateral_value(&state.collateral, balance_type)
    }

    /// Gets isolated position USDC balance for a specific market
    public fun get_isolated_position_usdc_balance(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): i64 acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        let balance_type = collateral_balance_sheet::balance_type_isolated(user, market);
        collateral_balance_sheet::balance_of_primary_asset(&state.collateral, balance_type)
    }

    /// Gets available margin for placing new orders
    public fun available_order_margin(user: address): u64 acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        order_margin::available_order_margin(&state.collateral, user)
    }

    // =========================================================================
    // FRIEND FUNCTIONS - DEPOSITS
    // =========================================================================

    /// Deposits collateral to a user's cross margin account
    ///
    /// # Arguments
    /// * `user` - User signer
    /// * `funds` - Fungible asset to deposit
    ///
    /// # Effects
    /// - Adds funds to user's cross margin balance
    /// - Emits balance change event
    friend fun deposit(
        user: &signer,
        funds: fungible_asset::FungibleAsset
    ) acquires GlobalAccountStates {
        let user_addr = signer::address_of(user);
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);

        let state = borrow_global_mut<GlobalAccountStates>(DECIBEL_ADDRESS);
        let balance_type = collateral_balance_sheet::balance_type_cross(user_addr);
        let change_type = collateral_balance_sheet::change_type_user_movement();

        collateral_balance_sheet::deposit_collateral(
            &mut state.collateral,
            balance_type,
            funds,
            change_type
        );
    }

    /// Deposits collateral to an isolated position's margin
    ///
    /// # Arguments
    /// * `user` - User signer
    /// * `market` - Market for the isolated position
    /// * `funds` - Fungible asset to deposit (must be primary asset)
    friend fun deposit_to_isolated_position_margin(
        user: &signer,
        market: object::Object<perp_market::PerpMarket>,
        funds: fungible_asset::FungibleAsset
    ) acquires GlobalAccountStates {
        let user_addr = signer::address_of(user);
        let incoming_asset = fungible_asset::asset_metadata(&funds);

        // Verify it's the primary asset
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let primary = collateral_balance_sheet::primary_asset_metadata(
            &borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS).collateral
        );
        if (!(incoming_asset == primary)) {
            abort error::invalid_argument(E_INVALID_ASSET_TYPE)
        };

        let state = borrow_global_mut<GlobalAccountStates>(DECIBEL_ADDRESS);
        let balance_type = collateral_balance_sheet::balance_type_isolated(user_addr, market);
        let change_type = collateral_balance_sheet::change_type_user_movement();

        collateral_balance_sheet::deposit_collateral(
            &mut state.collateral,
            balance_type,
            funds,
            change_type
        );
    }

    // =========================================================================
    // FRIEND FUNCTIONS - WITHDRAWALS
    // =========================================================================

    /// Withdraws collateral from cross margin account
    ///
    /// # Arguments
    /// * `user` - User signer
    /// * `asset` - Asset metadata to withdraw
    /// * `amount` - Amount to withdraw in fungible decimals
    ///
    /// # Returns
    /// Fungible asset containing the withdrawn funds
    ///
    /// # Errors
    /// - E_INSUFFICIENT_MARGIN: Withdrawal would leave insufficient margin
    friend fun withdraw_fungible(
        user: &signer,
        asset: object::Object<fungible_asset::Metadata>,
        amount: u64
    ): fungible_asset::FungibleAsset acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global_mut<GlobalAccountStates>(DECIBEL_ADDRESS);
        let user_addr = signer::address_of(user);
        let primary_asset = collateral_balance_sheet::primary_asset_metadata(&state.collateral);

        if (asset == primary_asset) {
            // Withdrawing primary asset - check margin requirements
            let balance_amount = collateral_balance_sheet::convert_fungible_to_balance_amount(
                &state.collateral,
                amount
            );

            // Verify withdrawal is allowed
            if (!perp_positions::is_max_allowed_withdraw_from_cross_margin_at_least(
                &state.collateral,
                user_addr,
                0i64,
                balance_amount
            )) {
                abort E_INSUFFICIENT_MARGIN
            };

            let balance_type = collateral_balance_sheet::balance_type_cross(user_addr);
            let change_type = collateral_balance_sheet::change_type_user_movement();

            collateral_balance_sheet::withdraw_primary_asset_unchecked(
                &mut state.collateral,
                balance_type,
                balance_amount,
                false,
                change_type
            )
        } else {
            // Withdrawing secondary asset - check value constraints
            let balance_type = collateral_balance_sheet::balance_type_cross(user_addr);
            let current_amount = collateral_balance_sheet::secondary_asset_fungible_amount(
                &state.collateral,
                balance_type,
                asset
            );

            let max_withdraw = if (perp_positions::has_crossed_position(user_addr)) {
                let free_collateral = perp_positions::free_collateral_for_crossed(
                    &state.collateral,
                    user_addr,
                    0i64
                );
                math64::min(
                    collateral_balance_sheet::fungible_amount_from_usd_value(
                        &state.collateral,
                        free_collateral,
                        asset
                    ),
                    current_amount
                )
            } else {
                current_amount
            };

            if (amount > max_withdraw) {
                abort E_INSUFFICIENT_MARGIN
            };

            let change_type = collateral_balance_sheet::change_type_user_movement();
            collateral_balance_sheet::withdraw_collateral_unchecked_for_asset(
                &mut state.collateral,
                balance_type,
                amount,
                asset,
                false,
                change_type
            )
        }
    }

    /// Withdraws from isolated position margin
    friend fun withdraw_fungible_from_isolated_position_margin(
        user: &signer,
        market: object::Object<perp_market::PerpMarket>,
        amount: u64
    ): fungible_asset::FungibleAsset acquires GlobalAccountStates {
        let user_addr = signer::address_of(user);
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);

        let state = borrow_global_mut<GlobalAccountStates>(DECIBEL_ADDRESS);
        let balance_amount = collateral_balance_sheet::convert_fungible_to_balance_amount(
            &state.collateral,
            amount
        );

        // Verify margin is sufficient after withdrawal
        let max_allowed = perp_positions::max_allowed_primary_asset_withdraw_from_isolated_margin(
            &state.collateral,
            user_addr,
            market
        );
        assert!(max_allowed >= balance_amount, E_INSUFFICIENT_MARGIN);

        let balance_type = collateral_balance_sheet::balance_type_isolated(user_addr, market);
        let change_type = collateral_balance_sheet::change_type_user_movement();

        collateral_balance_sheet::withdraw_primary_asset_unchecked(
            &mut state.collateral,
            balance_type,
            balance_amount,
            false,
            change_type
        )
    }

    /// Calculates maximum withdrawable amount for an asset
    friend fun max_allowed_withdraw_fungible_amount(
        user: address,
        asset: object::Object<fungible_asset::Metadata>
    ): u64 acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        let primary = collateral_balance_sheet::primary_asset_metadata(&state.collateral);

        if (asset == primary) {
            // Primary asset withdrawal limit
            let max_balance = perp_positions::max_allowed_primary_asset_withdraw_from_cross_margin(
                &state.collateral,
                user,
                0i64
            );
            collateral_balance_sheet::convert_balance_to_fungible_amount(
                &state.collateral,
                max_balance,
                false
            )
        } else {
            // Secondary asset withdrawal limit
            let balance_type = collateral_balance_sheet::balance_type_cross(user);
            let current_balance = collateral_balance_sheet::secondary_asset_fungible_amount(
                &state.collateral,
                balance_type,
                asset
            );

            if (!perp_positions::has_crossed_position(user)) {
                // No positions - can withdraw all
                current_balance
            } else {
                // Has positions - limited by free collateral
                let free_collateral = perp_positions::free_collateral_for_crossed(
                    &state.collateral,
                    user,
                    0i64
                );
                math64::min(
                    collateral_balance_sheet::fungible_amount_from_usd_value(
                        &state.collateral,
                        free_collateral,
                        asset
                    ),
                    current_balance
                )
            }
        }
    }

    // =========================================================================
    // FRIEND FUNCTIONS - SECONDARY ASSETS
    // =========================================================================

    /// Adds a new secondary collateral asset
    friend fun add_secondary_asset(
        admin: &signer,
        asset: object::Object<fungible_asset::Metadata>,
        oracle_source: oracle::OracleSource,
        haircut_bps: u64
    ) acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global_mut<GlobalAccountStates>(DECIBEL_ADDRESS);
        collateral_balance_sheet::add_secondary_asset(
            &mut state.collateral,
            admin,
            asset,
            oracle_source,
            haircut_bps
        );
    }

    /// Updates oracle price for a secondary asset
    friend fun update_secondary_asset_oracle_price(
        asset: object::Object<fungible_asset::Metadata>,
        price: u64
    ) acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global_mut<GlobalAccountStates>(DECIBEL_ADDRESS);
        collateral_balance_sheet::update_secondary_asset_oracle_price(
            &mut state.collateral,
            asset,
            price
        );
    }

    // =========================================================================
    // FRIEND FUNCTIONS - ORDER VALIDATION
    // =========================================================================

    /// Validates that an order can be placed with sufficient margin
    ///
    /// # Arguments
    /// * `user` - User address
    /// * `market` - Market for the order
    /// * `size` - Order size
    /// * `is_long` - True for long, false for short
    /// * `price` - Limit price (0 for market orders)
    ///
    /// # Returns
    /// None if valid, Some(error_message) if invalid
    friend fun validate_order_placement(
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        is_long: bool,
        price: u64
    ): option::Option<string::String> acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        order_margin::validate_order_placement(
            &state.collateral,
            user,
            market,
            size,
            is_long,
            price
        )
    }

    /// Tracks a pending order for margin calculations
    friend fun add_pending_order(
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        is_long: bool,
        price: u64
    ) {
        order_margin::add_pending_order(user, market, size, is_long, price);
    }

    /// Adds a reduce-only order
    friend fun add_reduce_only_order(
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        order_id: order_book_types::OrderIdType,
        size: u64,
        is_long: bool
    ): vector<perp_engine_types::SingleOrderAction> {
        order_margin::add_reduce_only_order(user, market, order_id, size, is_long)
    }

    // =========================================================================
    // FRIEND FUNCTIONS - POSITION UPDATES
    // =========================================================================

    /// Validates a position update (trade execution)
    ///
    /// # Arguments
    /// * `user` - User address
    /// * `market` - Market being traded
    /// * `size` - Position size change
    /// * `is_increase` - True if increasing position
    /// * `is_long` - True for long position
    /// * `price` - Execution price
    /// * `builder_code` - Optional builder fee code
    /// * `is_taker` - True if user is taker
    /// * `is_reduce_only` - True if order is reduce-only
    ///
    /// # Returns
    /// UpdatePositionResult with calculated PnL, fees, margin requirements
    friend fun validate_position_update(
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        is_increase: bool,
        is_long: bool,
        price: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        is_taker: bool,
        is_reduce_only: bool
    ): position_update::UpdatePositionResult acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);

        position_update::validate_position_update(
            &state.collateral,
            &state.liquidation_config,
            user,
            market,
            size,
            is_increase,
            is_long,
            price,
            builder_code,
            is_taker,
            is_reduce_only
        )
    }

    /// Validates position update for settlement (more strict checks)
    friend fun validate_position_update_for_settlement(
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        is_increase: bool,
        is_long: bool,
        price: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        is_taker: bool,
        is_reduce_only: bool
    ): position_update::UpdatePositionResult acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);

        let result = position_update::validate_position_update(
            &state.collateral,
            &state.liquidation_config,
            user,
            market,
            size,
            is_increase,
            is_long,
            price,
            builder_code,
            is_taker,
            is_reduce_only
        );

        position_update::verify_position_update_result_for_settlement(
            &state.collateral,
            &state.liquidation_config,
            user,
            market,
            size,
            is_increase,
            price,
            is_taker,
            result
        )
    }

    /// Validates reduce-only order update
    friend fun validate_reduce_only_update(
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        is_long: bool,
        size: u64
    ): position_update::ReduceOnlyValidationResult {
        position_update::validate_reduce_only_update(user, market, is_long, size)
    }

    /// Validates backstop liquidation or ADL update
    friend fun validate_backstop_liquidation_or_adl_update(
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        is_increase: bool,
        is_long: bool,
        price: u64
    ): position_update::UpdatePositionResult acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);

        position_update::validate_backstop_liquidation_or_adl_update(
            &state.collateral,
            user,
            market,
            size,
            is_increase,
            is_long,
            price
        )
    }

    /// Commits a position update to the balance sheet
    ///
    /// # Arguments
    /// * `order_id` - Optional order ID
    /// * `client_order_id` - Optional client order ID
    /// * `size` - Trade size
    /// * `is_long` - True for long
    /// * `price` - Execution price
    /// * `builder_code` - Optional builder fee
    /// * `result` - Validated update result
    /// * `maker_rebate_volume` - Volume for maker rebate calculation
    /// * `trigger_source` - What triggered this trade
    ///
    /// # Returns
    /// (filled_size, position_closed, action_type)
    friend fun commit_update_position(
        order_id: option::Option<order_book_types::OrderIdType>,
        client_order_id: option::Option<string::String>,
        size: u64,
        is_long: bool,
        price: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        result: position_update::UpdatePositionResult,
        maker_rebate_volume: u128,
        trigger_source: perp_positions::TradeTriggerSource
    ): (u64, bool, u8) acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global_mut<GlobalAccountStates>(DECIBEL_ADDRESS);
        let backstop = liquidation_config::backstop_liquidator(&state.liquidation_config);

        position_update::commit_update(
            &mut state.collateral,
            order_id,
            client_order_id,
            size,
            is_long,
            price,
            builder_code,
            result,
            backstop,
            maker_rebate_volume,
            trigger_source
        )
    }

    /// Commits position update with backstop liquidator handling
    ///
    /// Used when the backstop liquidator covers losses from a liquidation.
    friend fun commit_update_position_with_backstop_liquidator(
        size: u64,
        is_long: bool,
        price: u64,
        result: position_update::UpdatePositionResult,
        backstop_addr: address,
        trigger_source: perp_positions::TradeTriggerSource
    ): (u64, bool, u8) acquires GlobalAccountStates {
        // Extract the loss covered by backstop liquidator
        let covered_loss = position_update::extract_backstop_liquidator_covered_loss(&mut result);

        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global_mut<GlobalAccountStates>(DECIBEL_ADDRESS);

        // Deduct covered loss from backstop liquidator's balance
        if (covered_loss > 0) {
            let balance_type = collateral_balance_sheet::balance_type_cross(backstop_addr);
            let change_type = collateral_balance_sheet::change_type_liquidation();
            collateral_balance_sheet::decrease_balance_unchecked(
                &mut state.collateral,
                balance_type,
                covered_loss,
                change_type
            );
        };

        let backstop = liquidation_config::backstop_liquidator(&state.liquidation_config);

        position_update::commit_update(
            &mut state.collateral,
            option::none<order_book_types::OrderIdType>(),
            option::none<string::String>(),
            size,
            is_long,
            price,
            option::none<builder_code_registry::BuilderCode>(),
            result,
            backstop,
            0u128,
            trigger_source
        )
    }

    // =========================================================================
    // FRIEND FUNCTIONS - MARGIN TRANSFERS
    // =========================================================================

    /// Transfers margin from cross to isolated position (or vice versa)
    friend fun transfer_margin_fungible_to_isolated_position(
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        to_isolated: bool,
        amount: u64
    ) acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global_mut<GlobalAccountStates>(DECIBEL_ADDRESS);

        let balance_amount = collateral_balance_sheet::convert_fungible_to_balance_amount(
            &state.collateral,
            amount
        );

        perp_positions::transfer_margin_to_isolated_position(
            &mut state.collateral,
            user,
            market,
            to_isolated,
            balance_amount
        );
    }

    // =========================================================================
    // FRIEND FUNCTIONS - POSITION STATUS
    // =========================================================================

    /// Gets detailed position status for a user/market
    friend fun position_status(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): perp_positions::AccountStatusDetailed acquires GlobalAccountStates {
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        let status = perp_positions::position_status(&state.collateral, user, market);
        perp_positions::add_liquidation_details(status, &state.liquidation_config)
    }

    /// Gets cross position status (all markets combined)
    friend fun get_cross_position_status(
        user: address
    ): perp_positions::AccountStatusDetailed acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        let status = perp_positions::cross_position_status(
            &state.collateral,
            user,
            option::none<object::Object<perp_market::PerpMarket>>(),
            false
        );
        perp_positions::add_liquidation_details(status, &state.liquidation_config)
    }

    /// Checks if a position is liquidatable
    friend fun is_position_liquidatable(
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        is_isolated: bool
    ): bool acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);

        perp_positions::is_position_liquidatable(
            &state.collateral,
            &state.liquidation_config,
            user,
            market,
            is_isolated
        )
    }

    /// Checks if user has any assets or positions
    friend fun has_any_assets_or_positions(user: address): bool acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        perp_positions::has_any_assets_or_positions(&state.collateral, user)
    }

    /// Gets user's USDC balance for a specific position type (cross or isolated)
    friend fun get_user_usdc_balance(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): i64 acquires GlobalAccountStates {
        let is_isolated = perp_positions::is_position_isolated(user, market);

        if (is_isolated) {
            assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
            let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
            let balance_type = collateral_balance_sheet::balance_type_isolated(user, market);
            collateral_balance_sheet::balance_of_primary_asset(&state.collateral, balance_type)
        } else {
            assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
            let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
            let balance_type = collateral_balance_sheet::balance_type_cross(user);
            collateral_balance_sheet::balance_of_primary_asset(&state.collateral, balance_type)
        }
    }

    /// Gets account net asset value in fungible amount
    friend fun get_account_net_asset_value_fungible(
        user: address,
        round_up: bool
    ): i64 acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);

        let nav = perp_positions::get_account_net_asset_value(&state.collateral, user);

        let (is_positive, abs_value) = if (nav >= 0i64) {
            (true, nav as u64)
        } else {
            (false, (-nav) as u64)
        };

        // Round up for positive values, down for negative (conservative)
        let should_round_up = if (is_positive) { round_up } else { !round_up };

        let converted = collateral_balance_sheet::convert_balance_to_fungible_amount(
            &state.collateral,
            abs_value,
            should_round_up
        ) as i64;

        if (is_positive) { converted } else { -converted }
    }

    // =========================================================================
    // FRIEND FUNCTIONS - LIQUIDATION
    // =========================================================================

    /// Gets the backstop liquidator address
    friend fun backstop_liquidator(): address acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        liquidation_config::backstop_liquidator(&state.liquidation_config)
    }

    /// Transfers remaining balance to liquidator after liquidation
    friend fun transfer_balance_to_liquidator(
        user: address,
        liquidator: address,
        market: object::Object<perp_market::PerpMarket>
    ) acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global_mut<GlobalAccountStates>(DECIBEL_ADDRESS);

        perp_positions::transfer_balance_to_liquidator(
            &mut state.collateral,
            user,
            liquidator,
            market
        );
    }

    // =========================================================================
    // FRIEND FUNCTIONS - FEE DISTRIBUTION
    // =========================================================================

    /// Distributes collected fees to stakeholders
    friend fun distribute_fees(
        maker_distribution: &fee_distribution::FeeDistribution,
        taker_distribution: &fee_distribution::FeeDistribution
    ) acquires GlobalAccountStates {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global_mut<GlobalAccountStates>(DECIBEL_ADDRESS);
        let backstop = liquidation_config::backstop_liquidator(&state.liquidation_config);

        trading_fees_manager::distribute_fees(
            maker_distribution,
            taker_distribution,
            &mut state.collateral,
            backstop
        );
    }

    // =========================================================================
    // FRIEND FUNCTIONS - STORE ACCESS
    // =========================================================================

    /// Gets primary store balance in balance precision
    friend fun get_primary_store_balance_in_balance_precision(): u64
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(DECIBEL_ADDRESS), E_NOT_INITIALIZED);
        let state = borrow_global<GlobalAccountStates>(DECIBEL_ADDRESS);
        collateral_balance_sheet::get_primary_store_balance_in_balance_precision(&state.collateral)
    }
}
