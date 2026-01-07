/// ============================================================================
/// Module: position_update
/// Description: Validates and commits position changes for trades
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module is the core business logic for position updates. It handles:
/// 1. Validation of position changes (increase, decrease, flip)
/// 2. PnL and funding cost calculations
/// 3. Fee calculations for trades
/// 4. Margin requirement checks
/// 5. Committing validated updates to the balance sheet
///
/// Position Update Types:
/// - Increase: Adding to an existing position in the same direction
/// - Decrease: Reducing an existing position
/// - Flip: Closing a position and opening one in the opposite direction
///
/// Cross vs Isolated:
/// - Cross: Shares margin across all positions, PnL affects shared balance
/// - Isolated: Dedicated margin per position, PnL isolated to that position
///
/// The module uses a two-phase approach:
/// 1. Validate: Calculate all changes and check constraints
/// 2. Commit: Apply the validated changes to the balance sheet
/// ============================================================================

module decibel::position_update {
    use aptos_framework::object;
    use decibel::perp_market;
    use aptos_framework::option;
    use decibel::fee_distribution;
    use decibel::price_management;
    use decibel::perp_positions;
    use decibel::trading_fees_manager;
    use decibel::collateral_balance_sheet;
    use order_book::order_book_types;
    use aptos_framework::string;
    use decibel::builder_code_registry;
    use aptos_framework::error;
    use decibel::math;
    use decibel::perp_market_config;
    use decibel::liquidation_config;

    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================

    /// Accounts collateral module commits position updates
    friend decibel::accounts_collateral;

    /// Clearinghouse processes settlements
    friend decibel::clearinghouse_perp;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// Error: Update was successful (used when unwrapping failure reason)
    const E_UPDATE_SUCCESSFUL: u64 = 1;

    /// Error: Position is liquidatable
    const E_LIQUIDATABLE: u64 = 2;

    /// Error: Invalid size (zero or division by zero)
    const E_INVALID_SIZE: u64 = 4;

    /// Error: Insufficient margin for the operation
    const E_INSUFFICIENT_MARGIN: u64 = 5;

    /// Error: Increase direction mismatch
    const E_DIRECTION_MISMATCH: u64 = 7;

    /// Error: Position becomes liquidatable after update
    const E_BECOMES_LIQUIDATABLE: u64 = 9;

    /// Error: Invalid leverage setting
    const E_INVALID_LEVERAGE: u64 = 10;

    // =========================================================================
    // TYPES
    // =========================================================================

    /// Result of reduce-only order validation
    enum ReduceOnlyValidationResult has drop {
        /// Order violates reduce-only constraint (would increase position)
        ReduceOnlyViolation,
        /// Valid reduce-only order with adjusted size
        Success {
            /// Actual size that will be filled (may be capped by position size)
            size: u64,
        }
    }

    /// Result of position update validation
    ///
    /// Contains all information needed to commit the update or explains
    /// why the update failed.
    enum UpdatePositionResult has copy, drop {
        /// Update is valid and can be committed
        Success {
            /// User account address
            account: address,
            /// Market being traded
            market: object::Object<perp_market::PerpMarket>,
            /// Whether position is isolated margin
            is_isolated: bool,
            /// Change in margin (positive = more isolated, negative = less)
            margin_delta: option::Option<i64>,
            /// Loss covered by backstop liquidator (for underwater positions)
            backstop_liquidator_covered_loss: u64,
            /// Fee breakdown for this trade
            fee_distribution: fee_distribution::FeeDistribution,
            /// Realized PnL from closing portion
            realized_pnl: option::Option<i64>,
            /// Realized funding cost from closing portion
            realized_funding_cost: option::Option<i64>,
            /// Unrealized funding cost (for position update)
            unrealized_funding_cost: i64,
            /// New funding index after update
            updated_funding_index: price_management::AccumulativeIndex,
            /// Notional volume of this trade (for fee tier calculation)
            volume_delta: u128,
            /// Whether user is the taker
            is_taker: bool,
            /// Whether position was fully closed or flipped
            is_position_closed_or_flipped: bool,
        },
        /// Position is already liquidatable (cannot trade)
        Liquidatable,
        /// Not enough margin for this trade
        InsufficientMargin,
        /// User leverage exceeds market max
        InvalidLeverage,
        /// Update would make position liquidatable
        BecomesLiquidatable,
    }

    // =========================================================================
    // FRIEND FUNCTIONS - RESULT ACCESSORS
    // =========================================================================

    /// Checks if update validation succeeded
    friend fun is_update_successful(result: &UpdatePositionResult): bool {
        result is UpdatePositionResult::Success
    }

    /// Checks if reduce-only order violates constraint
    friend fun is_reduce_only_violation(result: &ReduceOnlyValidationResult): bool {
        result is ReduceOnlyValidationResult::ReduceOnlyViolation
    }

    /// Gets the adjusted size from reduce-only validation
    friend fun get_reduce_only_size(result: &ReduceOnlyValidationResult): u64 {
        *&result.size
    }

    /// Gets fee distribution from successful update
    friend fun unwrap_fee_distribution(result: &UpdatePositionResult): fee_distribution::FeeDistribution {
        *&result.fee_distribution
    }

    /// Checks if position was closed or flipped
    friend fun unwrap_is_closed_or_flipped(result: &UpdatePositionResult): bool {
        *&result.is_position_closed_or_flipped
    }

    /// Extracts backstop liquidator covered loss (resets to 0)
    friend fun extract_backstop_liquidator_covered_loss(result: &mut UpdatePositionResult): u64 {
        let loss = *&result.backstop_liquidator_covered_loss;
        result.backstop_liquidator_covered_loss = 0;
        loss
    }

    /// Gets human-readable reason for failed update
    friend fun unwrap_failed_update_reason(result: &UpdatePositionResult): string::String {
        if (result is UpdatePositionResult::Liquidatable) {
            // "Existing position is liquidatable"
            return string::utf8(b"Existing position is liquidatable")
        };
        if (result is UpdatePositionResult::InsufficientMargin) {
            // "Insufficient margin to update position"
            return string::utf8(b"Insufficient margin to update position")
        };
        if (result is UpdatePositionResult::InvalidLeverage) {
            // "User leverage is invalid"
            return string::utf8(b"User leverage is invalid")
        };
        if (result is UpdatePositionResult::BecomesLiquidatable) {
            // "Existing position becomes liquidatable"
            return string::utf8(b"Existing position becomes liquidatable")
        };
        if (result is UpdatePositionResult::Success) {
            abort error::invalid_argument(E_UPDATE_SUCCESSFUL)
        };
        abort 14566554180833181697 // Unreachable
    }

    // =========================================================================
    // FRIEND FUNCTIONS - VOLUME TRACKING
    // =========================================================================

    /// Tracks trading volume for fee tier calculations
    ///
    /// # Arguments
    /// * `account` - Trading account
    /// * `is_taker` - True if account is taker
    /// * `volume` - Trade notional volume
    friend fun track_volume(account: address, is_taker: bool, volume: u128) {
        let fee_tracking_addr = perp_positions::get_fee_tracking_addr(account);

        if (is_taker) {
            trading_fees_manager::track_taker_volume(fee_tracking_addr, volume);
        } else {
            trading_fees_manager::track_global_and_maker_volume(fee_tracking_addr, volume);
        };
    }

    // =========================================================================
    // FRIEND FUNCTIONS - VALIDATION
    // =========================================================================

    /// Main entry point for validating a position update
    ///
    /// # Arguments
    /// * `collateral` - Collateral balance sheet
    /// * `liq_config` - Liquidation configuration
    /// * `account` - User account
    /// * `market` - Market being traded
    /// * `price` - Execution price
    /// * `is_increase` - True if increasing position size
    /// * `is_taker` - True if user is taker
    /// * `size` - Trade size
    /// * `builder_code` - Optional builder fee code
    /// * `check_liquidatable` - Whether to check if already liquidatable
    /// * `is_margin_call` - True if this is a margin call (liquidation)
    ///
    /// # Returns
    /// UpdatePositionResult with validation outcome
    friend fun validate_position_update(
        collateral: &collateral_balance_sheet::CollateralBalanceSheet,
        liq_config: &liquidation_config::LiquidationConfig,
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        is_increase: bool,
        is_taker: bool,
        size: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        check_liquidatable: bool,
        is_margin_call: bool
    ): UpdatePositionResult {
        // Validate price and size
        perp_market_config::validate_price_and_size_allow_below_min_size(market, price, size);

        // Find existing position
        let maybe_position = perp_positions::may_be_find_position(account, market);

        // Check if position is isolated
        let is_isolated = if (option::is_some<perp_positions::PerpPosition>(&maybe_position)) {
            perp_positions::is_isolated(option::borrow<perp_positions::PerpPosition>(&maybe_position))
        } else {
            false
        };

        if (is_isolated) {
            let position = option::destroy_some<perp_positions::PerpPosition>(maybe_position);
            return validate_isolated_position_update(
                collateral,
                liq_config,
                account,
                market,
                price,
                is_increase,
                is_taker,
                size,
                builder_code,
                check_liquidatable,
                is_margin_call,
                position
            )
        };

        validate_crossed_position_update(
            collateral,
            liq_config,
            account,
            market,
            price,
            is_increase,
            is_taker,
            size,
            builder_code,
            check_liquidatable,
            is_margin_call,
            maybe_position
        )
    }

    /// Validates a reduce-only order
    ///
    /// Reduce-only orders can only decrease existing positions.
    /// Returns the effective size (capped by current position size).
    friend fun validate_reduce_only_update(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        is_long: bool,
        size: u64
    ): ReduceOnlyValidationResult {
        let maybe_position = perp_positions::may_be_find_position(account, market);

        if (option::is_some<perp_positions::PerpPosition>(&maybe_position)) {
            let position = option::destroy_some<perp_positions::PerpPosition>(maybe_position);
            let position_size = perp_positions::get_size(&position);
            let position_is_long = perp_positions::is_long(&position);

            // No position = violation
            if (position_size == 0) {
                return ReduceOnlyValidationResult::ReduceOnlyViolation {}
            };

            // Same direction = would increase position = violation
            if (position_is_long == is_long) {
                return ReduceOnlyValidationResult::ReduceOnlyViolation {}
            };

            // Order size larger than position = cap at position size
            if (position_size < size) {
                return ReduceOnlyValidationResult::Success { size: position_size }
            };

            // Valid reduce-only order
            return ReduceOnlyValidationResult::Success { size }
        };

        // No position = violation
        ReduceOnlyValidationResult::ReduceOnlyViolation {}
    }

    /// Validates backstop liquidation or ADL (Auto-Deleveraging) update
    ///
    /// These are special position updates that bypass normal margin checks
    /// because they're forced closures to manage risk.
    friend fun validate_backstop_liquidation_or_adl_update(
        collateral: &collateral_balance_sheet::CollateralBalanceSheet,
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        is_increase: bool,
        is_long: bool,
        price: u64
    ): UpdatePositionResult {
        let maybe_position = perp_positions::may_be_find_position(account, market);
        let no_position = option::is_none<perp_positions::PerpPosition>(&maybe_position);

        if (no_position) {
            // No position - create empty for increase validation
            let max_leverage = perp_market_config::get_max_leverage(market);
            let empty_position = perp_positions::new_empty_perp_position(market, max_leverage);
            return validate_increase_crossed_position_liquidation(account, &empty_position, market, is_long)
        };

        let position = option::destroy_some<perp_positions::PerpPosition>(maybe_position);

        if (perp_positions::is_isolated(&position)) {
            let position_is_long = perp_positions::is_long(&position);

            // For isolated, ADL must be opposite direction
            if (!(is_increase != position_is_long)) {
                abort error::invalid_argument(E_DIRECTION_MISMATCH)
            };

            let position_size = perp_positions::get_size(&position);
            if (size > position_size) {
                abort error::invalid_argument(3) // Size exceeds position
            };

            return validate_backstop_liquidate_isolated_position(
                collateral,
                account,
                &position,
                size,
                market,
                price,
                is_increase,
                is_long
            )
        };

        // Cross position
        let position_size = perp_positions::get_size(&position);
        let same_direction = if (position_size == 0) {
            true
        } else {
            perp_positions::is_long(&position) == is_increase
        };

        if (same_direction) {
            // Increasing same direction - liquidation increase
            return validate_increase_crossed_position_liquidation(account, &position, market, is_long)
        };

        // Decreasing opposite direction
        let effective_size = if (size > position_size) {
            size - position_size
        } else {
            size
        };

        let no_builder = option::none<builder_code_registry::BuilderCode>();
        validate_decrease_crossed_position(
            collateral,
            account,
            &position,
            market,
            price,
            is_long,
            effective_size,
            no_builder,
            true, // is_liquidation
            false // is_margin_call
        )
    }

    /// Checks if settlement price is within guaranteed range
    ///
    /// Used to verify that order execution prices are valid and won't
    /// cause immediate liquidation.
    friend fun is_settle_price_inside_guaranteed_range(
        market: object::Object<perp_market::PerpMarket>,
        settle_price: u64,
        mark_price: u64,
        liq_config: &liquidation_config::LiquidationConfig,
        is_long: bool
    ): bool {
        let max_leverage = perp_market_config::get_max_leverage(market);
        let liq_price_delta = liquidation_config::get_liquidation_price(
            liq_config,
            mark_price,
            max_leverage,
            false
        );

        if (is_long) {
            // For longs, settlement price should not be too high
            let upper_bound = mark_price + liq_price_delta;
            return settle_price <= upper_bound
        };

        // For shorts, settlement price should not be too low
        let lower_bound = mark_price - liq_price_delta;
        settle_price >= lower_bound
    }

    /// Verifies update result for settlement (additional checks)
    friend fun verify_position_update_result_for_settlement(
        collateral: &collateral_balance_sheet::CollateralBalanceSheet,
        liq_config: &liquidation_config::LiquidationConfig,
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        is_increase: bool,
        size: u64,
        is_taker: bool,
        result: UpdatePositionResult
    ): UpdatePositionResult {
        if (&result is UpdatePositionResult::Success) {
            let mark_price = price_management::get_mark_price(market);

            // Check if settlement price is in valid range
            if (!is_settle_price_inside_guaranteed_range(market, price, mark_price, liq_config, is_increase)) {
                // Need to simulate the position after update
                let maybe_position = perp_positions::may_be_find_position(account, market);
                let position = if (option::is_some<perp_positions::PerpPosition>(&maybe_position)) {
                    option::destroy_some<perp_positions::PerpPosition>(maybe_position)
                } else {
                    let max_leverage = perp_market_config::get_max_leverage(market);
                    perp_positions::new_empty_perp_position(market, max_leverage)
                };

                // Build simulated account status
                let status = if (perp_positions::is_isolated(&position)) {
                    let balance_type = collateral_balance_sheet::balance_type_isolated(account, market);
                    perp_positions::new_account_status(
                        collateral_balance_sheet::total_asset_collateral_value(collateral, balance_type) as i64
                    )
                } else {
                    let maybe_market = option::some<object::Object<perp_market::PerpMarket>>(market);
                    perp_positions::cross_position_status(collateral, account, maybe_market, true)
                };

                // Apply position update to simulation
                let sim_position = &mut position;
                let unrealized_funding = *&(&result).unrealized_funding_cost;
                let updated_index = *&(&result).updated_funding_index;
                perp_positions::update_single_position_struct(
                    sim_position,
                    price,
                    is_increase,
                    size,
                    unrealized_funding,
                    updated_index
                );

                // Apply PnL
                if (option::is_some<i64>(&(&result).realized_pnl)) {
                    let pnl = option::destroy_some<i64>(*&(&result).realized_pnl);
                    perp_positions::increase_account_balance_for_status(&mut status, pnl);
                };

                // Apply margin delta
                if (option::is_some<i64>(&(&result).margin_delta)) {
                    let delta = option::destroy_some<i64>(*&(&result).margin_delta);
                    perp_positions::increase_account_balance_for_status(&mut status, delta);
                };

                // Apply fees
                let fee_delta = fee_distribution::get_position_fee_delta(&(&result).fee_distribution);
                perp_positions::increase_account_balance_for_status(&mut status, fee_delta);

                // Update status for new position
                perp_positions::update_position_status_for_position(&mut status, &position, market, true);

                // Check if becomes liquidatable
                if (perp_positions::is_account_liquidatable(&status, liq_config, is_taker)) {
                    return UpdatePositionResult::BecomesLiquidatable {}
                }
            }
        };

        result
    }

    // =========================================================================
    // FRIEND FUNCTIONS - COMMIT
    // =========================================================================

    /// Commits a validated position update to the balance sheet
    ///
    /// # Arguments
    /// * `collateral` - Mutable collateral balance sheet
    /// * `order_id` - Optional order ID
    /// * `client_order_id` - Optional client order ID
    /// * `size` - Trade size
    /// * `is_long` - True for long
    /// * `price` - Execution price
    /// * `builder_code` - Optional builder fee
    /// * `result` - Validated update result (must be Success)
    /// * `backstop_addr` - Backstop liquidator address
    /// * `maker_rebate_volume` - Volume for maker rebate calculation
    /// * `trigger_source` - What triggered this trade
    ///
    /// # Returns
    /// (filled_size, is_long, user_leverage)
    friend fun commit_update(
        collateral: &mut collateral_balance_sheet::CollateralBalanceSheet,
        order_id: option::Option<order_book_types::OrderIdType>,
        client_order_id: option::Option<string::String>,
        size: u64,
        is_long: bool,
        price: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        result: UpdatePositionResult,
        backstop_addr: address,
        maker_rebate_volume: u128,
        trigger_source: perp_positions::TradeTriggerSource
    ): (u64, bool, u8) {
        // Destructure the success result
        if (&result is UpdatePositionResult::Liquidatable) {
            abort error::invalid_argument(E_LIQUIDATABLE)
        };
        if (&result is UpdatePositionResult::BecomesLiquidatable) {
            abort error::invalid_argument(E_BECOMES_LIQUIDATABLE)
        };
        if (&result is UpdatePositionResult::InsufficientMargin) {
            abort error::invalid_argument(E_INSUFFICIENT_MARGIN)
        };
        if (&result is UpdatePositionResult::InvalidLeverage) {
            abort error::invalid_argument(E_INVALID_LEVERAGE)
        };

        let UpdatePositionResult::Success {
            account,
            market,
            is_isolated,
            margin_delta,
            backstop_liquidator_covered_loss,
            fee_distribution: fees,
            realized_pnl,
            realized_funding_cost,
            unrealized_funding_cost,
            updated_funding_index,
            volume_delta,
            is_taker,
            is_position_closed_or_flipped: _
        } = result;

        // Backstop loss should have been extracted before commit
        if (!(backstop_liquidator_covered_loss == 0)) {
            abort error::invalid_argument(E_INSUFFICIENT_MARGIN)
        };

        // Determine balance type
        let balance_type = if (is_isolated) {
            collateral_balance_sheet::balance_type_isolated(account, market)
        } else {
            collateral_balance_sheet::balance_type_cross(account)
        };

        // Apply realized PnL
        if (option::is_some<i64>(&realized_pnl)) {
            let pnl = option::destroy_some<i64>(realized_pnl);
            if (pnl >= 0i64) {
                let profit = pnl as u64;
                let change_type = collateral_balance_sheet::change_type_pnl();
                collateral_balance_sheet::deposit_to_user(collateral, balance_type, profit, change_type);
            } else {
                let loss = (-pnl) as u64;
                let change_type = collateral_balance_sheet::change_type_pnl();
                collateral_balance_sheet::decrease_balance(collateral, balance_type, loss, change_type);
            }
        };

        // Apply margin delta (for isolated positions)
        if (option::is_some<i64>(&margin_delta)) {
            let delta = option::destroy_some<i64>(margin_delta);
            let change_type = collateral_balance_sheet::change_type_margin();
            if (delta >= 0i64) {
                // Transfer from cross to isolated
                let amount = delta as u64;
                collateral_balance_sheet::transfer_from_crossed_to_isolated(
                    collateral,
                    account,
                    amount,
                    market,
                    change_type
                );
            } else {
                // Transfer from isolated to cross
                let amount = (-delta) as u64;
                collateral_balance_sheet::transfer_from_isolated_to_crossed(
                    collateral,
                    account,
                    amount,
                    market,
                    change_type
                );
            }
        };

        // Track volume
        if (volume_delta != 0u128) {
            track_volume(account, is_taker, volume_delta);
        };

        // Get funding cost (default to 0)
        let funding_cost = option::get_with_default<i64>(&realized_funding_cost, 0i64);
        let final_pnl = option::get_with_default<i64>(&realized_pnl, 0i64);

        // Get fee delta for position update
        let fee_delta = fee_distribution::get_position_fee_delta(&fees);

        // Update the position
        let (filled_size, final_is_long, leverage) = perp_positions::update_position(
            account,
            account == backstop_addr,
            is_isolated,
            market,
            order_id,
            client_order_id,
            size,
            is_long,
            price,
            builder_code,
            unrealized_funding_cost,
            updated_funding_index,
            funding_cost,
            final_pnl,
            fee_delta,
            maker_rebate_volume,
            is_taker,
            trigger_source
        );

        (filled_size, final_is_long, leverage)
    }

    // =========================================================================
    // INTERNAL FUNCTIONS - CROSSED POSITION VALIDATION
    // =========================================================================

    /// Validates a cross-margin position update
    fun validate_crossed_position_update(
        collateral: &collateral_balance_sheet::CollateralBalanceSheet,
        liq_config: &liquidation_config::LiquidationConfig,
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        is_increase: bool,
        is_taker: bool,
        size: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        check_liquidatable: bool,
        is_margin_call: bool,
        maybe_position: option::Option<perp_positions::PerpPosition>
    ): UpdatePositionResult {
        if (option::is_some<perp_positions::PerpPosition>(&maybe_position)) {
            let position = option::destroy_some<perp_positions::PerpPosition>(maybe_position);
            let position_size = perp_positions::get_size(&position);
            let same_direction = (perp_positions::is_long(&position) == is_increase) || (position_size == 0);

            if (same_direction) {
                // Increasing position
                return validate_increase_crossed_position(
                    collateral,
                    account,
                    &position,
                    market,
                    price,
                    is_taker,
                    size,
                    is_increase,
                    builder_code
                )
            };

            // Check if liquidatable before allowing decrease
            if (is_position_liquidatable_crossed(collateral, liq_config, account, check_liquidatable)) {
                return UpdatePositionResult::Liquidatable {}
            };

            if (position_size >= size) {
                // Pure decrease
                return validate_decrease_crossed_position(
                    collateral,
                    account,
                    &position,
                    market,
                    price,
                    is_taker,
                    size,
                    builder_code,
                    false,
                    is_margin_call
                )
            };

            // Flip: close current + open opposite
            let flip_size = size - position_size;
            return validate_flip_crossed_position(
                collateral,
                account,
                &position,
                market,
                price,
                is_taker,
                flip_size,
                is_increase,
                builder_code
            )
        };

        // No existing position - create new
        let max_leverage = perp_market_config::get_max_leverage(market);
        let empty_position = perp_positions::new_empty_perp_position(market, max_leverage);
        validate_increase_crossed_position(
            collateral,
            account,
            &empty_position,
            market,
            price,
            is_taker,
            size,
            is_increase,
            builder_code
        )
    }

    /// Validates increasing a cross-margin position
    friend fun validate_increase_crossed_position(
        collateral: &collateral_balance_sheet::CollateralBalanceSheet,
        account: address,
        position: &perp_positions::PerpPosition,
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        is_taker: bool,
        size: u64,
        is_long: bool,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): UpdatePositionResult {
        validate_increase_position(
            collateral,
            account,
            false, // not isolated
            position,
            market,
            price,
            is_taker,
            size,
            0i64, // no prior margin delta
            is_long,
            builder_code
        )
    }

    /// Validates decreasing a cross-margin position
    friend fun validate_decrease_crossed_position(
        collateral: &collateral_balance_sheet::CollateralBalanceSheet,
        account: address,
        position: &perp_positions::PerpPosition,
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        is_taker: bool,
        size: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        is_liquidation: bool,
        is_margin_call: bool
    ): UpdatePositionResult {
        // Calculate PnL and funding for the closing portion
        let (realized_pnl, realized_funding, unrealized_funding, updated_index) =
            get_pnl_and_funding_for_decrease(position, market, price, size);

        let position_size = perp_positions::get_size(position);

        // Calculate fees
        let (fees, volume_delta) = if (is_liquidation) {
            (
                fee_distribution::zero_fees(collateral_balance_sheet::balance_type_cross(account)),
                0u128
            )
        } else {
            let precision = perp_market_config::get_sz_precision(market);
            get_fee_and_volume_delta(
                account,
                false, // not isolated
                market,
                is_taker,
                price,
                size,
                builder_code,
                &precision,
                is_margin_call
            )
        };

        // Check if user balance can cover losses
        let fee_delta = fee_distribution::get_position_fee_delta(&fees);
        let total_change = realized_pnl + fee_delta;
        let backstop_loss = 0i64;

        if (total_change < 0i64) {
            let balance_type = collateral_balance_sheet::balance_type_cross(account);
            let current_balance = collateral_balance_sheet::balance_of_primary_asset(collateral, balance_type);

            if (current_balance + total_change < 0i64) {
                // Would go negative
                if (!is_liquidation) {
                    return UpdatePositionResult::Liquidatable {}
                };

                // Liquidation can cover loss from backstop
                let covers_loss = if (realized_pnl < 0i64) {
                    realized_pnl < total_change
                } else {
                    false
                };

                if (covers_loss) {
                    backstop_loss = -(current_balance + realized_pnl);
                } else {
                    backstop_loss = -(current_balance + total_change);
                };
                // Adjust realized PnL to account for covered loss
                // realized_pnl = realized_pnl + backstop_loss;
            }
        };

        UpdatePositionResult::Success {
            account,
            market,
            is_isolated: false,
            margin_delta: option::none<i64>(),
            backstop_liquidator_covered_loss: (backstop_loss as u64),
            fee_distribution: fees,
            realized_pnl: option::some<i64>(realized_pnl),
            realized_funding_cost: option::some<i64>(realized_funding),
            unrealized_funding_cost: unrealized_funding,
            updated_funding_index: updated_index,
            volume_delta,
            is_taker,
            is_position_closed_or_flipped: size == position_size,
        }
    }

    /// Validates flipping a cross-margin position (close + open opposite)
    friend fun validate_flip_crossed_position(
        collateral: &collateral_balance_sheet::CollateralBalanceSheet,
        account: address,
        position: &perp_positions::PerpPosition,
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        is_taker: bool,
        new_size: u64,
        is_long: bool,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): UpdatePositionResult {
        let close_size = perp_positions::get_size(position);
        let user_leverage = perp_positions::get_user_leverage(position);

        // Get current cross position status (excluding this position)
        let maybe_market = option::some<object::Object<perp_market::PerpMarket>>(market);
        let status = perp_positions::cross_position_status(collateral, account, maybe_market, true);

        // Calculate PnL from closing
        let size_multiplier = perp_market_config::get_size_multiplier(market);
        let (realized_pnl, realized_funding, _, updated_index) =
            get_pnl_and_funding_for_decrease(position, market, price, close_size);

        // Calculate initial margin for new position
        let leverage_val = user_leverage as u64;
        let leverage_times_multiplier = size_multiplier * leverage_val;
        assert!(leverage_times_multiplier != 0, E_INVALID_SIZE);

        let new_size_u128 = new_size as u128;
        let price_u128 = price as u128;
        let notional = new_size_u128 * price_u128;
        let divisor = leverage_times_multiplier as u128;
        let new_initial_margin = ((notional + divisor - 1) / divisor) as u64; // Round up

        // Calculate fees for entire flip (close + open)
        let total_size = close_size + new_size;
        let precision = perp_market_config::get_sz_precision(market);
        let (fees, volume_delta) = get_fee_and_volume_delta(
            account,
            false, // not isolated
            market,
            is_taker,
            price,
            total_size,
            builder_code,
            &precision,
            false // not margin call
        );

        let fee_delta = fee_distribution::get_position_fee_delta(&fees);
        let balance_after_close = perp_positions::get_account_balance(&status) + realized_pnl + fee_delta;
        let margin_after_new = (perp_positions::get_initial_margin(&status) + new_initial_margin) as i64;

        if (balance_after_close < margin_after_new) {
            return UpdatePositionResult::InsufficientMargin {}
        };

        UpdatePositionResult::Success {
            account,
            market,
            is_isolated: false,
            margin_delta: option::none<i64>(),
            backstop_liquidator_covered_loss: 0,
            fee_distribution: fees,
            realized_pnl: option::some<i64>(realized_pnl),
            realized_funding_cost: option::some<i64>(realized_funding),
            unrealized_funding_cost: 0i64,
            updated_funding_index: updated_index,
            volume_delta,
            is_taker,
            is_position_closed_or_flipped: true,
        }
    }

    /// Validates position increase for liquidation
    fun validate_increase_crossed_position_liquidation(
        account: address,
        position: &perp_positions::PerpPosition,
        market: object::Object<perp_market::PerpMarket>,
        is_taker: bool
    ): UpdatePositionResult {
        let (unrealized_funding, updated_index) =
            perp_positions::get_position_funding_cost_and_index(position, market);

        UpdatePositionResult::Success {
            account,
            market,
            is_isolated: false,
            margin_delta: option::none<i64>(),
            backstop_liquidator_covered_loss: 0,
            fee_distribution: fee_distribution::zero_fees(
                collateral_balance_sheet::balance_type_cross(account)
            ),
            realized_pnl: option::none<i64>(),
            realized_funding_cost: option::none<i64>(),
            unrealized_funding_cost: unrealized_funding,
            updated_funding_index: updated_index,
            volume_delta: 0u128,
            is_taker,
            is_position_closed_or_flipped: false,
        }
    }

    // =========================================================================
    // INTERNAL FUNCTIONS - ISOLATED POSITION VALIDATION
    // =========================================================================

    /// Validates an isolated-margin position update
    fun validate_isolated_position_update(
        collateral: &collateral_balance_sheet::CollateralBalanceSheet,
        liq_config: &liquidation_config::LiquidationConfig,
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        is_increase: bool,
        is_taker: bool,
        size: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        check_liquidatable: bool,
        is_margin_call: bool,
        position: perp_positions::PerpPosition
    ): UpdatePositionResult {
        // Check if already liquidatable
        if (is_position_liquidatable_isolated(collateral, liq_config, account, market, check_liquidatable, &position)) {
            return UpdatePositionResult::Liquidatable {}
        };

        let position_size = perp_positions::get_size(&position);
        let position_is_long = perp_positions::is_long(&position);

        let same_direction = (position_size == 0) || (position_is_long == is_increase);

        if (same_direction) {
            // Increasing position
            return validate_increase_isolated_position(
                collateral,
                account,
                position,
                market,
                price,
                is_taker,
                size,
                is_increase,
                builder_code
            )
        };

        if (position_size >= size) {
            // Pure decrease
            return validate_decrease_isolated_position(
                collateral,
                account,
                position,
                market,
                price,
                is_increase,
                is_taker,
                size,
                builder_code,
                is_margin_call
            )
        };

        // Flip
        let flip_size = size - position_size;
        validate_flip_isolated_position(
            collateral,
            account,
            position,
            market,
            price,
            is_increase,
            is_taker,
            flip_size,
            builder_code
        )
    }

    /// Validates increasing an isolated-margin position
    friend fun validate_increase_isolated_position(
        collateral: &collateral_balance_sheet::CollateralBalanceSheet,
        account: address,
        position: perp_positions::PerpPosition,
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        is_taker: bool,
        size: u64,
        is_long: bool,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): UpdatePositionResult {
        validate_increase_position(
            collateral,
            account,
            true, // isolated
            &position,
            market,
            price,
            is_taker,
            size,
            0i64,
            is_long,
            builder_code
        )
    }

    /// Validates decreasing an isolated-margin position
    friend fun validate_decrease_isolated_position(
        collateral: &collateral_balance_sheet::CollateralBalanceSheet,
        account: address,
        position: perp_positions::PerpPosition,
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        is_increase: bool,
        is_taker: bool,
        size: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        is_margin_call: bool
    ): UpdatePositionResult {
        // Calculate PnL and funding
        let (realized_pnl, realized_funding, unrealized_funding, updated_index) =
            get_pnl_and_funding_for_decrease(&position, market, price, size);

        // Calculate fees
        let precision = perp_market_config::get_sz_precision(market);
        let (fees, volume_delta) = get_fee_and_volume_delta(
            account,
            true, // isolated
            market,
            is_taker,
            price,
            size,
            builder_code,
            &precision,
            is_margin_call
        );

        // Get isolated margin balance
        let balance_type = collateral_balance_sheet::balance_type_isolated(account, market);
        let isolated_balance = collateral_balance_sheet::total_asset_collateral_value(collateral, balance_type);

        // Check if PnL would drain margin
        let balance_after_pnl = (isolated_balance as i64) + realized_pnl;
        if (balance_after_pnl < 0i64) {
            return UpdatePositionResult::Liquidatable {}
        };

        let position_size = perp_positions::get_size(&position);
        let remaining_size = position_size - size;

        // Calculate remaining position's required margin
        let remaining_margin = if (position_size != 0) {
            let margin_u128 = (isolated_balance as u128) * (remaining_size as u128);
            let size_u128 = position_size as u128;
            ((margin_u128 + size_u128 - 1) / size_u128) as u64 // Round up
        } else {
            abort error::invalid_argument(E_INVALID_SIZE)
        };

        // Calculate margin delta
        let margin_delta = 0i64;
        let is_full_close = if (is_margin_call) {
            size == position_size
        } else {
            true
        };

        if (is_full_close) {
            let fee_delta = fee_distribution::get_position_fee_delta(&fees);
            let required = (remaining_margin as i64) - balance_after_pnl;
            margin_delta = required + fee_delta;

            if (margin_delta >= 0i64) {
                return UpdatePositionResult::Liquidatable {}
            }
        };

        UpdatePositionResult::Success {
            account,
            market,
            is_isolated: true,
            margin_delta: option::some<i64>(margin_delta),
            backstop_liquidator_covered_loss: 0,
            fee_distribution: fees,
            realized_pnl: option::some<i64>(realized_pnl),
            realized_funding_cost: option::some<i64>(realized_funding),
            unrealized_funding_cost: unrealized_funding,
            updated_funding_index: updated_index,
            volume_delta,
            is_taker,
            is_position_closed_or_flipped: size == position_size,
        }
    }

    /// Validates flipping an isolated-margin position
    friend fun validate_flip_isolated_position(
        collateral: &collateral_balance_sheet::CollateralBalanceSheet,
        account: address,
        position: perp_positions::PerpPosition,
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        is_increase: bool,
        is_taker: bool,
        new_size: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): UpdatePositionResult {
        let close_size = perp_positions::get_size(&position);

        // First validate closing the existing position
        let close_result = validate_decrease_isolated_position(
            collateral,
            account,
            position,
            market,
            price,
            false, // not increase
            is_taker,
            close_size,
            builder_code,
            false // not margin call
        );

        if (!is_update_successful(&close_result)) {
            return close_result
        };

        // Extract close result data
        let UpdatePositionResult::Success {
            account: _,
            market: _,
            is_isolated: _,
            margin_delta: close_margin_delta,
            backstop_liquidator_covered_loss: close_backstop,
            fee_distribution: close_fees,
            realized_pnl,
            realized_funding_cost,
            unrealized_funding_cost: close_unrealized,
            updated_funding_index,
            volume_delta: close_volume,
            is_taker: _,
            is_position_closed_or_flipped: _
        } = close_result;

        assert!(close_backstop == 0, error::invalid_argument(E_UPDATE_SUCCESSFUL));
        assert!(close_unrealized == 0i64, error::invalid_argument(E_UPDATE_SUCCESSFUL));

        let close_margin = option::get_with_default<i64>(&close_margin_delta, 0i64);

        // Now validate opening the new position
        let open_result = validate_increase_position(
            collateral,
            account,
            true, // isolated
            &position,
            market,
            price,
            is_taker,
            new_size,
            close_margin, // Prior margin change
            is_increase,
            builder_code
        );

        if (!is_update_successful(&open_result)) {
            return open_result
        };

        // Extract open result data
        let UpdatePositionResult::Success {
            account: _,
            market: _,
            is_isolated: _,
            margin_delta: open_margin_delta,
            backstop_liquidator_covered_loss: open_backstop,
            fee_distribution: open_fees,
            realized_pnl: open_pnl,
            realized_funding_cost: _,
            unrealized_funding_cost: _,
            updated_funding_index: _,
            volume_delta: open_volume,
            is_taker: _,
            is_position_closed_or_flipped: _
        } = open_result;

        assert!(open_backstop == 0, error::invalid_argument(E_UPDATE_SUCCESSFUL));
        assert!(option::is_none<i64>(&open_pnl), error::invalid_argument(E_UPDATE_SUCCESSFUL));

        let open_margin = option::get_with_default<i64>(&open_margin_delta, 0i64);
        let total_margin_delta = close_margin + open_margin;

        // Combine fees
        let combined_fees = fee_distribution::add(&close_fees, open_fees);

        // Verify we have enough margin
        let balance_type = collateral_balance_sheet::balance_type_isolated(account, market);
        let isolated_balance = collateral_balance_sheet::total_asset_collateral_value(collateral, balance_type);

        if (option::is_some<i64>(&realized_pnl)) {
            let pnl = *option::borrow<i64>(&realized_pnl);
            if ((isolated_balance as i64) + pnl < 0i64) {
                abort 8 // Should have been caught in decrease validation
            }
        };

        UpdatePositionResult::Success {
            account,
            market,
            is_isolated: true,
            margin_delta: option::some<i64>(total_margin_delta),
            backstop_liquidator_covered_loss: 0,
            fee_distribution: combined_fees,
            realized_pnl,
            realized_funding_cost,
            unrealized_funding_cost: 0i64,
            updated_funding_index,
            volume_delta: close_volume + open_volume,
            is_taker,
            is_position_closed_or_flipped: true,
        }
    }

    /// Validates backstop liquidation of an isolated position
    friend fun validate_backstop_liquidate_isolated_position(
        collateral: &collateral_balance_sheet::CollateralBalanceSheet,
        account: address,
        position: &perp_positions::PerpPosition,
        size: u64,
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        is_increase: bool,
        is_taker: bool
    ): UpdatePositionResult {
        let (realized_pnl, realized_funding, unrealized_funding, updated_index) =
            get_pnl_and_funding_for_decrease(position, market, price, size);

        // Get isolated balance
        let balance_type = collateral_balance_sheet::balance_type_isolated(account, market);
        let isolated_balance = collateral_balance_sheet::total_asset_collateral_value(collateral, balance_type);

        let backstop_loss = 0u64;
        let balance_after_pnl = (isolated_balance as i64) + realized_pnl;

        if (realized_pnl < 0i64 && balance_after_pnl < 0i64) {
            // Loss exceeds margin - backstop covers difference
            backstop_loss = (-balance_after_pnl) as u64;
            // Adjust PnL
            // realized_pnl = realized_pnl + (backstop_loss as i64);
        };

        // Calculate margin delta for transfer back to cross
        let position_size = perp_positions::get_size(position);
        let margin_delta = if (is_taker) {
            // Full close
            if (size != position_size) {
                option::none<i64>()
            } else {
                // Transfer remaining balance back to cross
                let final_balance = (isolated_balance as i64) + realized_pnl;
                if (final_balance > 0i64) {
                    option::some<i64>(-final_balance)
                } else {
                    option::none<i64>()
                }
            }
        } else {
            option::none<i64>()
        };

        UpdatePositionResult::Success {
            account,
            market,
            is_isolated: true,
            margin_delta,
            backstop_liquidator_covered_loss: backstop_loss,
            fee_distribution: fee_distribution::zero_fees(
                collateral_balance_sheet::balance_type_isolated(account, market)
            ),
            realized_pnl: option::some<i64>(realized_pnl),
            realized_funding_cost: option::some<i64>(realized_funding),
            unrealized_funding_cost: unrealized_funding,
            updated_funding_index: updated_index,
            volume_delta: 0u128,
            is_taker,
            is_position_closed_or_flipped: true,
        }
    }

    // =========================================================================
    // INTERNAL FUNCTIONS - COMMON VALIDATION
    // =========================================================================

    /// Validates increasing a position (works for both cross and isolated)
    fun validate_increase_position(
        collateral: &collateral_balance_sheet::CollateralBalanceSheet,
        account: address,
        is_isolated: bool,
        position: &perp_positions::PerpPosition,
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        is_taker: bool,
        size: u64,
        prior_margin_delta: i64,
        is_long: bool,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): UpdatePositionResult {
        let user_leverage = perp_positions::get_user_leverage(position);
        let max_leverage = perp_market_config::get_max_leverage(market);

        if (max_leverage < user_leverage) {
            return UpdatePositionResult::InvalidLeverage {}
        };

        // Calculate required initial margin
        let size_multiplier = perp_market_config::get_size_multiplier(market);
        let mark_price = price_management::get_mark_price(market);
        let leverage_val = user_leverage as u64;
        let leverage_times_multiplier = size_multiplier * leverage_val;
        assert!(leverage_times_multiplier != 0, E_INVALID_SIZE);

        let size_u128 = size as u128;
        let price_u128 = mark_price as u128;
        let notional = size_u128 * price_u128;
        let divisor = leverage_times_multiplier as u128;
        let required_margin = ((notional + divisor - 1) / divisor) as u64; // Round up

        // Check if user has sufficient margin
        if (is_isolated) {
            if (!perp_positions::is_max_allowed_withdraw_from_cross_margin_at_least(
                collateral,
                account,
                prior_margin_delta,
                required_margin
            )) {
                return UpdatePositionResult::InsufficientMargin {}
            }
        } else {
            if (!perp_positions::is_free_collateral_for_crossed_at_least(
                collateral,
                account,
                prior_margin_delta,
                required_margin
            )) {
                return UpdatePositionResult::InsufficientMargin {}
            }
        };

        // Get funding info
        let (unrealized_funding, updated_index) =
            perp_positions::get_position_funding_cost_and_index(position, market);

        // Calculate fees
        let precision = perp_market_config::get_sz_precision(market);
        let (fees, volume_delta) = get_fee_and_volume_delta(
            account,
            is_isolated,
            market,
            is_taker,
            price,
            size,
            builder_code,
            &precision,
            false // not margin call
        );

        if (is_isolated) {
            UpdatePositionResult::Success {
                account,
                market,
                is_isolated: true,
                margin_delta: option::some<i64>(required_margin as i64),
                backstop_liquidator_covered_loss: 0,
                fee_distribution: fees,
                realized_pnl: option::none<i64>(),
                realized_funding_cost: option::none<i64>(),
                unrealized_funding_cost: unrealized_funding,
                updated_funding_index: updated_index,
                volume_delta,
                is_taker,
                is_position_closed_or_flipped: false,
            }
        } else {
            UpdatePositionResult::Success {
                account,
                market,
                is_isolated,
                margin_delta: option::none<i64>(),
                backstop_liquidator_covered_loss: 0,
                fee_distribution: fees,
                realized_pnl: option::none<i64>(),
                realized_funding_cost: option::none<i64>(),
                unrealized_funding_cost: unrealized_funding,
                updated_funding_index: updated_index,
                volume_delta,
                is_taker,
                is_position_closed_or_flipped: false,
            }
        }
    }

    // =========================================================================
    // INTERNAL FUNCTIONS - HELPERS
    // =========================================================================

    /// Checks if a cross-margin position is liquidatable
    fun is_position_liquidatable_crossed(
        collateral: &collateral_balance_sheet::CollateralBalanceSheet,
        liq_config: &liquidation_config::LiquidationConfig,
        account: address,
        check_liquidatable: bool
    ): bool {
        let maybe_market = option::none<object::Object<perp_market::PerpMarket>>();
        let status = perp_positions::cross_position_status(collateral, account, maybe_market, false);
        perp_positions::is_account_liquidatable(&status, liq_config, check_liquidatable)
    }

    /// Checks if an isolated-margin position is liquidatable
    fun is_position_liquidatable_isolated(
        collateral: &collateral_balance_sheet::CollateralBalanceSheet,
        liq_config: &liquidation_config::LiquidationConfig,
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        check_liquidatable: bool,
        position: &perp_positions::PerpPosition
    ): bool {
        let status = perp_positions::isolated_position_status(collateral, account, position, market, false);
        perp_positions::is_account_liquidatable(&status, liq_config, check_liquidatable)
    }

    /// Calculates PnL and funding costs for a position decrease
    ///
    /// # Returns
    /// (realized_pnl, realized_funding, unrealized_funding, updated_index)
    fun get_pnl_and_funding_for_decrease(
        position: &perp_positions::PerpPosition,
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        size: u64
    ): (i64, i64, i64, price_management::AccumulativeIndex) {
        let size_multiplier = perp_market_config::get_size_multiplier(market);

        // Calculate notional value at close price
        let close_notional = (size as u128) * (price as u128);

        // Get entry cost for closing portion
        let entry_px_times_size = perp_positions::get_entry_px_times_size_sum(position);
        let position_size = perp_positions::get_size(position);
        let is_long = perp_positions::is_long(position);

        // Pro-rata entry cost for the closing portion
        let close_size = size as u128;
        let pos_size = position_size as u128;
        let entry_cost = if (is_long) {
            // Round up for longs (conservative)
            if (pos_size == 0) {
                abort error::invalid_argument(E_INVALID_SIZE)
            };
            let numerator = (entry_px_times_size as u256) * (close_size as u256);
            let denominator = pos_size as u256;
            (((numerator + denominator - 1) / denominator) as u128)
        } else {
            // Round down for shorts
            if (pos_size == 0) {
                abort error::invalid_argument(E_INVALID_SIZE)
            };
            let numerator = (entry_px_times_size as u256) * (close_size as u256);
            let denominator = pos_size as u256;
            ((numerator / denominator) as u128)
        };

        // Calculate raw PnL
        let is_profit = if (is_long) {
            close_notional > entry_cost
        } else {
            close_notional < entry_cost
        };

        let abs_pnl = if (close_notional > entry_cost) {
            close_notional - entry_cost
        } else {
            entry_cost - close_notional
        };

        // Convert to balance precision
        let multiplier = size_multiplier as u128;
        let pnl_in_balance = if (is_profit) {
            abs_pnl / multiplier
        } else {
            // Round up losses
            (abs_pnl + multiplier - 1) / multiplier
        };

        let signed_pnl = (pnl_in_balance as i64);
        let realized_pnl = if (is_profit) { signed_pnl } else { -signed_pnl };

        // Calculate funding
        let (total_funding, updated_index) =
            perp_positions::get_position_funding_cost_and_index(position, market);

        // Pro-rata funding for closing portion
        assert!(position_size != 0, E_INVALID_SIZE);
        let funding_i128 = total_funding as i128;
        let size_i128 = size as i128;
        let pos_size_i128 = position_size as i128;
        let realized_funding = ((funding_i128 * size_i128) / pos_size_i128) as i64;

        // Unrealized funding is the remainder
        let unrealized_funding = total_funding - realized_funding;

        // Final realized PnL includes funding
        let final_pnl = realized_pnl - realized_funding;

        (final_pnl, -realized_funding, unrealized_funding, updated_index)
    }

    /// Calculates fees and volume for a trade
    fun get_fee_and_volume_delta(
        account: address,
        is_isolated: bool,
        market: object::Object<perp_market::PerpMarket>,
        is_taker: bool,
        price: u64,
        size: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        precision: &math::Precision,
        is_margin_call: bool
    ): (fee_distribution::FeeDistribution, u128) {
        let fee_tracking_addr = perp_positions::get_fee_tracking_addr(account);

        let balance_type = if (is_isolated) {
            collateral_balance_sheet::balance_type_isolated(account, market)
        } else {
            collateral_balance_sheet::balance_type_cross(account)
        };

        // Calculate notional value
        let price_u128 = price as u128;
        let size_u128 = size as u128;
        let notional = price_u128 * size_u128;
        let decimals = math::get_decimals_multiplier(precision) as u128;
        let volume = notional / decimals;

        if (is_margin_call) {
            // Margin call uses special fee rate
            let margin_call_fee_pct = perp_market_config::get_margin_call_fee_pct(market);
            return (
                trading_fees_manager::get_fees_for_margin_call(balance_type, volume, margin_call_fee_pct),
                volume
            )
        };

        if (is_taker) {
            return (
                trading_fees_manager::get_taker_fee_for_notional(
                    account,
                    fee_tracking_addr,
                    balance_type,
                    volume,
                    builder_code
                ),
                volume
            )
        };

        (
            trading_fees_manager::get_maker_fee_for_notional(
                account,
                fee_tracking_addr,
                balance_type,
                volume,
                builder_code
            ),
            volume
        )
    }
}
