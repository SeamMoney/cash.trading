/// ============================================================================
/// LIQUIDATION - Position Liquidation Engine
/// ============================================================================
///
/// This module implements the core liquidation logic for the Decibel protocol.
/// It handles three types of liquidation:
///
/// 1. MARGIN CALL:
///    When equity falls below maintenance margin, positions are liquidated
///    via market orders with slippage tolerance. This is the "soft" liquidation.
///
/// 2. BACKSTOP LIQUIDATION:
///    When margin call fails (insufficient liquidity or margin too low),
///    the backstop liquidator takes over the position at mark price.
///
/// 3. AUTO-DELEVERAGING (ADL):
///    When backstop liquidator accumulates too much loss, profitable
///    opposing positions are forcibly closed to cover the deficit.
///
/// LIQUIDATION FLOW:
///
/// 1. Check if account is liquidatable (equity < maintenance margin)
/// 2. Attempt margin call liquidation with progressive slippage
/// 3. If margin call fails or equity < backstop margin, trigger backstop
/// 4. If backstop losses exceed threshold, trigger ADL
///
/// SLIPPAGE TOLERANCE:
///
/// Margin call uses progressive slippage to ensure fills:
/// - Start with configured slippage percentages
/// - Increase slippage up to maximum allowed
/// - Calculate position size to close based on current slippage
///
/// POSITION SIZING:
///
/// During margin call, only enough position is closed to bring account
/// back above maintenance margin. This minimizes impact on the trader.
///
/// ============================================================================

module decibel::liquidation {
    use std::vector;
    use std::object;
    use std::option;
    use std::error;
    use std::cmp;
    use std::event;
    use std::string;
    use std::debug;

    use order_book::order_book_types;
    use order_book::market_types;
    use order_book::order_placement;

    use decibel::perp_market;
    use decibel::perp_market_config;
    use decibel::perp_positions;
    use decibel::perp_engine_types;
    use decibel::accounts_collateral;
    use decibel::price_management;
    use decibel::clearinghouse_perp;
    use decibel::backstop_liquidator_profit_tracker;
    use decibel::adl_tracker;
    use decibel::order_placement_utils;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::async_matching_engine;

    // ============================================================================
    // ERROR CODES
    // ============================================================================

    /// Account is not liquidatable
    const ENOT_LIQUIDATABLE: u64 = 1;

    /// Cannot liquidate the backstop liquidator itself
    const ECANNOT_LIQUIDATE_BACKSTOP_LIQUIDATOR: u64 = 2;

    /// Backstop liquidator not initialized
    const EBACKSTOP_LIQUIDATOR_NOT_INITIALIZED: u64 = 3;

    /// Cannot settle backstop liquidation
    const ECANNOT_SETTLE_BACKSTOP_LIQUIDATION: u64 = 4;

    /// Cannot settle backstop liquidation via ADL
    const ECANNOT_SETTLE_BACKSTOP_LIQUIDATION_ADL: u64 = 5;

    /// Invalid ADL liquidation size
    const EINVALID_ADL_LIQUIDATION_SIZE: u64 = 6;

    // ============================================================================
    // EVENTS
    // ============================================================================

    /// Type of liquidation that occurred
    enum LiquidationType has copy, drop, store {
        /// Standard margin call liquidation
        MarginCall,
        /// Backstop liquidator took over position
        BackstopLiquidation,
        /// Auto-deleveraging of profitable position
        ADL,
    }

    /// Event emitted when a liquidation occurs
    enum LiquidationEvent has copy, drop, store {
        V1 {
            /// The market where liquidation occurred
            market: object::Object<perp_market::PerpMarket>,
            /// Whether position was isolated margin
            is_isolated: bool,
            /// User being liquidated
            user: address,
            /// Type of liquidation
            type: LiquidationType,
        }
    }

    // ============================================================================
    // RESULT TYPES
    // ============================================================================

    /// Result of margin call attempt
    struct MarginCallResult has drop {
        /// Whether backstop liquidation is needed
        need_backstop_liquidation: bool,
        /// Whether order matching fill limit was hit
        fill_limit_exhausted: bool,
    }

    // ============================================================================
    // ERROR CODE GETTERS
    // ============================================================================

    public fun get_enot_liquidatable(): u64 { ENOT_LIQUIDATABLE }
    public fun get_ecannot_liquidate_backstop_liquidator(): u64 { ECANNOT_LIQUIDATE_BACKSTOP_LIQUIDATOR }
    public fun get_ebackstop_liquidator_not_initialized(): u64 { EBACKSTOP_LIQUIDATOR_NOT_INITIALIZED }
    public fun get_ecannot_settle_backstop_liquidation(): u64 { ECANNOT_SETTLE_BACKSTOP_LIQUIDATION }
    public fun get_ecannot_settle_backstop_liquidation_adl(): u64 { ECANNOT_SETTLE_BACKSTOP_LIQUIDATION_ADL }
    public fun get_einvalid_adl_liquidation_size(): u64 { EINVALID_ADL_LIQUIDATION_SIZE }

    // ============================================================================
    // MAIN LIQUIDATION ENTRY POINT
    // ============================================================================

    /// Liquidate a position (internal function called by matching engine)
    ///
    /// # Parameters
    /// - `market`: The perpetual market
    /// - `account`: Account to liquidate
    /// - `fill_limit`: Maximum number of fills allowed
    ///
    /// # Returns
    /// true if fill limit was exhausted, false if liquidation completed
    friend fun liquidate_position_internal(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        fill_limit: &mut u32
    ): bool {
        // Attempt margin call liquidation first
        let result = margin_call(account, market, fill_limit);

        // Check if fill limit was hit
        if (*&(&result).fill_limit_exhausted) {
            return true
        };

        // If backstop liquidation is needed, trigger it
        if (*&(&result).need_backstop_liquidation) {
            backstop_liquidation(account, market);
        };

        false
    }

    // ============================================================================
    // MARGIN CALL LIQUIDATION
    // ============================================================================

    /// Attempt margin call liquidation
    ///
    /// This is the "soft" liquidation that tries to close positions via
    /// market orders with controlled slippage. It only closes enough
    /// position to bring the account back above maintenance margin.
    ///
    /// # Parameters
    /// - `account`: Account to liquidate
    /// - `market`: The perpetual market
    /// - `fill_limit`: Maximum fills allowed (modified in place)
    ///
    /// # Returns
    /// MarginCallResult indicating if backstop is needed or fill limit hit
    fun margin_call(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        fill_limit: &mut u32
    ): MarginCallResult {
        // Get account status
        let status = accounts_collateral::position_status(account, market);

        // Check if account is liquidatable
        let is_liquidatable = perp_positions::is_account_liquidatable_detailed(&status, false);

        if (!is_liquidatable) {
            return MarginCallResult {
                need_backstop_liquidation: false,
                fill_limit_exhausted: false,
            }
        };

        // Check if it's already at backstop level
        if (perp_positions::is_account_liquidatable_detailed(&status, true)) {
            return MarginCallResult {
                need_backstop_liquidation: true,
                fill_limit_exhausted: false,
            }
        };

        let is_isolated = perp_positions::is_position_isolated(account, market);

        // Get liquidation parameters
        let positions = perp_positions::positions_to_liquidate(account, market);
        let margin_multiplier = perp_positions::get_liquidation_margin_multiplier_from_detailed_status(&status);
        let margin_divisor = perp_positions::get_liquidation_margin_divisor_from_detailed_status(&status);
        let backstop_multiplier = perp_positions::get_backstop_liquidation_margin_multiplier_from_detailed_status(&status);
        let backstop_divisor = perp_positions::get_backstop_liquidation_margin_divisor_from_detailed_status(&status);
        let liquidation_margin = perp_positions::get_liquidation_margin_from_detailed_status(&status);
        let account_balance = perp_positions::get_account_balance_from_detailed_status(&status);
        let fee_scale = perp_market_config::get_slippage_and_margin_call_fee_scale();

        let position_idx: u64 = 0;
        let all_positions_exhausted = true;
        let is_long: bool;
        let fill_limit_hit: bool;

        // Iterate through positions to liquidate
        loop {
            let num_positions = vector::length<perp_positions::PerpPositionWithMarket>(&positions);
            let should_continue = (position_idx < num_positions) && (*fill_limit > 0u32);

            if (!should_continue) break;

            // Account back in good standing
            if (account_balance >= 0i64) break;

            let pos_with_market = vector::borrow<perp_positions::PerpPositionWithMarket>(&positions, position_idx);
            let position = perp_positions::get_perp_position(pos_with_market);
            let pos_market = perp_positions::get_market(pos_with_market);
            let size = perp_positions::get_size(position);

            all_positions_exhausted = true;

            if (size == 0) {
                position_idx = position_idx + 1;
                continue
            };

            // Get market parameters
            let mark_price = price_management::get_mark_price(pos_market);
            let margin_call_fee = perp_market_config::get_margin_call_fee_pct(pos_market);
            let max_leverage = perp_market_config::get_max_leverage(pos_market);

            // Calculate scaled margin ratios
            // maintenance_ratio = fee_scale * margin_multiplier / (max_leverage * margin_divisor)
            let scaled_maintenance = fee_scale * margin_multiplier;
            let maintenance_divisor = (max_leverage as u64) * margin_divisor;
            let maintenance_ratio = scaled_maintenance / maintenance_divisor;

            // backstop_ratio = fee_scale * backstop_multiplier / (max_leverage * backstop_divisor)
            let scaled_backstop = fee_scale * backstop_multiplier;
            let backstop_divisor_calc = (max_leverage as u64) * backstop_divisor;
            let backstop_ratio = scaled_backstop / backstop_divisor_calc;

            // Calculate margin call fee (rounded up)
            let fee_scaled = margin_call_fee * fee_scale;
            let fee_divisor = perp_market_config::get_slippage_and_margin_call_fee_scale();
            let fee_ratio: u64;
            if (fee_scaled == 0) {
                if (fee_divisor != 0) {
                    fee_ratio = 0;
                } else {
                    abort error::invalid_argument(4)
                };
            } else {
                fee_ratio = (fee_scaled - 1) / fee_divisor + 1;
            };

            // Skip if backstop ratio < fee (can't liquidate profitably)
            if (backstop_ratio < fee_ratio) {
                position_idx = position_idx + 1;
                continue
            };

            is_long = perp_positions::is_long(position);

            // Calculate maximum allowed slippage for margin call
            // max_slippage = (balance * maintenance_ratio / liquidation_margin) - fee
            let balance_u128 = account_balance as u128;
            let maint_u128 = maintenance_ratio as u128;
            let numerator = balance_u128 * maint_u128;
            let liq_margin_u128 = liquidation_margin as u128;
            let slippage_base = (numerator / liq_margin_u128) as u64;
            let max_slippage: u64;
            if (margin_call_fee > slippage_base) {
                max_slippage = 0;
            } else {
                max_slippage = slippage_base - margin_call_fee;
            };

            // Get configured slippage percentages and filter to valid ones
            let slippage_pcts = perp_market_config::get_slippage_pcts(pos_market);
            let valid_slippages = vector::empty<u64>();

            vector::reverse<u64>(&mut slippage_pcts);
            let num_slippages = vector::length<u64>(&slippage_pcts);

            while (num_slippages > 0) {
                let slippage = vector::pop_back<u64>(&mut slippage_pcts);
                if (cmp::is_lt(&cmp::compare<u64>(&slippage, &max_slippage))) {
                    vector::push_back<u64>(&mut valid_slippages, slippage);
                };
                num_slippages = num_slippages - 1;
            };
            vector::destroy_empty<u64>(slippage_pcts);

            // Add max_slippage as the final option
            vector::push_back<u64>(&mut valid_slippages, max_slippage);

            // Try liquidation with increasing slippage
            let slippage_idx: u64 = 0;

            loop {
                let num_valid = vector::length<u64>(&valid_slippages);
                let should_try = (slippage_idx < num_valid) && (*fill_limit > 0u32);

                if (!should_try) break;

                all_positions_exhausted = false;

                let slippage = *vector::borrow<u64>(&valid_slippages, slippage_idx);

                // Calculate liquidation price with slippage
                let liq_price: u64;
                if (is_long) {
                    // Selling long: price = mark * (1 - slippage)
                    let price_u128 = mark_price as u128;
                    let slippage_factor = (fee_scale - slippage) as u128;
                    let numerator = price_u128 * slippage_factor;
                    let scale_u128 = fee_scale as u128;
                    liq_price = (numerator / scale_u128) as u64;
                } else {
                    // Buying to close short: price = mark * (1 + slippage)
                    let price_u128 = mark_price as u128;
                    let slippage_factor = (fee_scale + slippage) as u128;
                    let numerator = price_u128 * slippage_factor;
                    let scale_u128 = fee_scale as u128;
                    // Round up for buys
                    if (numerator == 0u128) {
                        if (scale_u128 != 0u128) {
                            liq_price = 0;
                        } else {
                            abort error::invalid_argument(4)
                        };
                    } else {
                        liq_price = ((numerator - 1u128) / scale_u128 + 1u128) as u64;
                    };
                };

                // Round to valid tick
                liq_price = perp_market_config::round_price_to_ticker(pos_market, liq_price, !is_long);

                // Calculate actual slippage from rounded price
                let actual_slippage: u64;
                if (liq_price > mark_price) {
                    actual_slippage = liq_price - mark_price;
                } else {
                    actual_slippage = mark_price - liq_price;
                };
                let slippage_scaled = actual_slippage * fee_scale;
                let actual_slippage_pct: u64;
                if (slippage_scaled == 0) {
                    if (mark_price != 0) {
                        actual_slippage_pct = 0;
                    } else {
                        abort error::invalid_argument(4)
                    };
                } else {
                    actual_slippage_pct = (slippage_scaled - 1) / mark_price + 1;
                };

                // Total cost = actual_slippage + margin_call_fee
                let total_cost = actual_slippage_pct + margin_call_fee;

                // Check if total cost exceeds maintenance ratio
                if (total_cost > maintenance_ratio) {
                    // Can't liquidate profitably at this slippage
                    position_idx = position_idx + 1;
                    continue
                };

                // Calculate size to liquidate
                // size = (liquidation_margin - balance + 1) * size_multiplier * fee_scale
                //        / (mark_price * (maintenance_ratio - total_cost))
                let margin_deficit = liquidation_margin - (account_balance as u64) + 1;
                let size_multiplier = perp_market_config::get_size_multiplier(pos_market);
                let deficit_u128 = margin_deficit as u128;
                let mult_u128 = size_multiplier as u128;
                let scale_u128 = fee_scale as u128;
                let numerator = deficit_u128 * mult_u128 * scale_u128;

                let price_u128 = mark_price as u128;
                let ratio_diff = maintenance_ratio - total_cost;
                let denominator = price_u128 * (ratio_diff as u128);

                let liq_size: u64;
                if (denominator == 0u128) {
                    liq_size = size;
                } else {
                    // Round up
                    let size_u128 = if (numerator == 0u128) {
                        if (denominator != 0u128) { 0u128 } else { abort error::invalid_argument(4) }
                    } else {
                        (numerator - 1u128) / denominator + 1u128
                    };

                    // Enforce minimum size
                    let min_size = perp_market_config::get_min_size(pos_market) as u128;
                    if (size_u128 <= min_size) {
                        size_u128 = min_size;
                    };

                    // Round to lot size
                    let lot_size = perp_market_config::get_lot_size(pos_market) as u128;
                    if (size_u128 % lot_size != 0u128) {
                        size_u128 = size_u128 + lot_size - (size_u128 % lot_size);
                    };

                    // Cap at position size
                    if (size_u128 > (size as u128)) {
                        liq_size = size;
                    } else {
                        liq_size = size_u128 as u64;
                    };
                };

                // Place liquidation order
                let order_id = order_book_types::next_order_id();
                let tif = order_book_types::immediate_or_cancel();
                let trigger = option::none<order_book_types::TriggerCondition>();
                let metadata = perp_engine_types::new_liquidation_metadata();
                let client_order_id = option::none<string::String>();

                let (
                    _order_result,
                    _fills,
                    cancel_reason,
                    fill_prices,
                    _fill_sizes
                ) = order_placement_utils::place_order_and_trigger_matching_actions(
                    pos_market,
                    account,
                    liq_price,
                    liq_size,
                    liq_size,  // max_base
                    !is_long,  // sell if long, buy if short
                    tif,
                    trigger,
                    metadata,
                    order_id,
                    client_order_id,
                    true,  // is_liquidation
                    fill_limit
                );

                // Emit event if we got fills
                if (vector::length<u64>(&fill_prices) > 0) {
                    let liq_type = LiquidationType::MarginCall {};
                    event::emit<LiquidationEvent>(LiquidationEvent::V1 {
                        market: pos_market,
                        is_isolated,
                        user: account,
                        type: liq_type,
                    });

                    // Refresh account status
                    status = accounts_collateral::position_status(account, market);
                    account_balance = perp_positions::get_account_balance_from_detailed_status(&status);
                    liquidation_margin = perp_positions::get_liquidation_margin_from_detailed_status(&status);

                    // Check if no longer liquidatable
                    if (!perp_positions::is_account_liquidatable_detailed(&status, false)) {
                        return MarginCallResult {
                            need_backstop_liquidation: false,
                            fill_limit_exhausted: false,
                        }
                    };
                };

                // Check if order was cancelled due to fill limit
                fill_limit_hit = if (option::is_some<market_types::OrderCancellationReason>(&cancel_reason)) {
                    order_placement::is_fill_limit_violation(
                        option::destroy_some<market_types::OrderCancellationReason>(cancel_reason)
                    )
                } else {
                    false
                };

                if (fill_limit_hit) {
                    return MarginCallResult {
                        need_backstop_liquidation: false,
                        fill_limit_exhausted: true,
                    }
                };

                // Try next slippage level
                slippage_idx = slippage_idx + 1;
                if (slippage_idx >= vector::length<u64>(&valid_slippages)) {
                    all_positions_exhausted = true;
                };
            };

            position_idx = position_idx + 1;
        };

        // Determine result
        let need_backstop: bool;
        let num_positions = vector::length<perp_positions::PerpPositionWithMarket>(&positions);
        if (position_idx < num_positions) {
            // More positions but couldn't liquidate
            need_backstop = all_positions_exhausted;
        } else {
            // Checked all positions
            need_backstop = accounts_collateral::is_position_liquidatable(account, market, false);
        };

        let hit_limit = if (position_idx < num_positions) {
            true
        } else {
            !all_positions_exhausted
        };

        MarginCallResult {
            need_backstop_liquidation: need_backstop,
            fill_limit_exhausted: hit_limit,
        }
    }

    // ============================================================================
    // BACKSTOP LIQUIDATION
    // ============================================================================

    /// Execute backstop liquidation
    ///
    /// The backstop liquidator takes over all positions at mark price.
    /// This happens when margin call fails or equity is below backstop threshold.
    ///
    /// # Parameters
    /// - `account`: Account being liquidated
    /// - `market`: The perpetual market
    fun backstop_liquidation(
        account: address,
        market: object::Object<perp_market::PerpMarket>
    ) {
        let backstop = accounts_collateral::backstop_liquidator();
        assert!(perp_positions::account_initialized(backstop), EBACKSTOP_LIQUIDATOR_NOT_INITIALIZED);

        let is_isolated = perp_positions::is_position_isolated(account, market);
        let user_balance = accounts_collateral::get_user_usdc_balance(account, market);
        let positions = perp_positions::positions_to_liquidate(account, market);
        let status = accounts_collateral::position_status(account, market);

        // Reverse to process in order
        vector::reverse<perp_positions::PerpPositionWithMarket>(&mut positions);
        let num_positions = vector::length<perp_positions::PerpPositionWithMarket>(&positions);

        loop {
            if (!(num_positions > 0)) break;

            let pos_with_market = vector::pop_back<perp_positions::PerpPositionWithMarket>(&mut positions);
            let position = perp_positions::get_perp_position(&pos_with_market);
            let pos_market = perp_positions::get_market(&pos_with_market);
            let size = perp_positions::get_size(position);

            if (size != 0) {
                let is_long = perp_positions::is_long(position);
                let mark_price = price_management::get_mark_price(pos_market);
                let liq_price = perp_market_config::round_price_to_ticker(pos_market, mark_price, !is_long);

                // Calculate profit for backstop liquidator
                let profit = perp_positions::calculate_backstop_liquidation_profit(
                    user_balance,
                    &status,
                    position,
                    pos_market
                );
                backstop_liquidator_profit_tracker::track_profit(pos_market, profit);

                // Settle the position transfer
                let settled_size = clearinghouse_perp::settle_backstop_liquidation_or_adl(
                    backstop,
                    account,
                    pos_market,
                    is_long,
                    liq_price,
                    size,
                    false  // not ADL
                );

                // Verify full settlement
                if (!option::is_some<u64>(&settled_size)) {
                    abort ECANNOT_SETTLE_BACKSTOP_LIQUIDATION
                };

                if (!(option::destroy_some<u64>(settled_size) == size)) {
                    abort ECANNOT_SETTLE_BACKSTOP_LIQUIDATION
                };

                // Track position update for backstop liquidator
                backstop_liquidator_profit_tracker::track_position_update(
                    pos_market,
                    mark_price,
                    size,
                    is_long,
                    false  // adding to position
                );

                // Emit event
                let liq_type = LiquidationType::BackstopLiquidation {};
                event::emit<LiquidationEvent>(LiquidationEvent::V1 {
                    market: pos_market,
                    is_isolated,
                    user: account,
                    type: liq_type,
                });
            };

            num_positions = num_positions - 1;
        };

        vector::destroy_empty<perp_positions::PerpPositionWithMarket>(positions);

        // Transfer remaining balance to backstop liquidator
        accounts_collateral::transfer_balance_to_liquidator(backstop, account, market);
    }

    // ============================================================================
    // AUTO-DELEVERAGING (ADL)
    // ============================================================================

    /// Check if ADL should be triggered for a market
    ///
    /// ADL is triggered when backstop liquidator losses exceed threshold.
    ///
    /// # Returns
    /// Some(adl_price) if ADL should trigger, None otherwise
    friend fun should_trigger_adl(
        market: object::Object<perp_market::PerpMarket>
    ): option::Option<u64> {
        let threshold = perp_market_config::get_adl_trigger_threshold(market);
        let mark_price = price_management::get_mark_price(market);
        backstop_liquidator_profit_tracker::should_trigger_adl(market, mark_price, threshold)
    }

    /// Execute ADL against profitable positions
    ///
    /// # Parameters
    /// - `market`: The perpetual market
    /// - `backstop_size`: Size of backstop position to reduce
    /// - `adl_price`: Price at which to execute ADL
    /// - `fill_limit`: Maximum fills allowed
    ///
    /// # Returns
    /// true if backstop still has position remaining
    friend fun trigger_adl_internal(
        market: object::Object<perp_market::PerpMarket>,
        backstop_size: u64,
        adl_price: u64,
        fill_limit: &mut u32
    ): bool {
        if (backstop_size == 0) {
            return false
        };

        let backstop = accounts_collateral::backstop_liquidator();
        let backstop_is_long = perp_positions::get_position_is_long(backstop, market);

        let fills_done: u32 = 0u32;
        let max_fills = *fill_limit;

        loop {
            let should_continue = (fills_done < max_fills) && (backstop_size > 0);
            if (!should_continue) break;

            // Check if backstop still has position
            let current_size = perp_positions::get_position_size(backstop, market);
            if (current_size == 0) break;

            // Find next ADL target (opposing side, most profitable)
            let mark_price = price_management::get_mark_price(market);
            let adl_target = adl_tracker::get_next_adl_address(market, !backstop_is_long, mark_price);

            // Get target's position size
            let target_size = perp_positions::get_position_size(adl_target, market);
            if (target_size == 0) continue;

            // ADL the smaller of backstop or target size
            let adl_size: u64;
            if (current_size > target_size) {
                adl_size = target_size;
            } else {
                adl_size = current_size;
            };

            // Settle the ADL
            let settled = clearinghouse_perp::settle_backstop_liquidation_or_adl(
                adl_target,
                backstop,
                market,
                backstop_is_long,
                adl_price,
                adl_size,
                true  // is ADL
            );

            if (option::is_none<u64>(&settled)) {
                // Target might be liquidatable, log and continue
                let msg = string::utf8(
                    vector[65u8, 68u8, 76u8, 32u8, 116u8, 97u8, 114u8, 103u8, 101u8, 116u8, 32u8,
                           105u8, 115u8, 32u8, 108u8, 105u8, 113u8, 117u8, 105u8, 100u8, 97u8,
                           116u8, 97u8, 98u8, 108u8, 101u8, 44u8, 32u8, 99u8, 111u8, 110u8,
                           116u8, 105u8, 110u8, 117u8, 101u8, 32u8, 65u8, 68u8, 76u8]
                ); // "ADL target is liquidatable, continue ADL"
                debug::print<string::String>(&msg);
            };

            // Track position update for backstop
            backstop_liquidator_profit_tracker::track_position_update(
                market,
                adl_price,
                adl_size,
                !backstop_is_long,  // closing position
                true  // is closing
            );

            // Emit ADL event
            let liq_type = LiquidationType::ADL {};
            event::emit<LiquidationEvent>(LiquidationEvent::V1 {
                market,
                is_isolated: false,
                user: adl_target,
                type: liq_type,
            });

            fills_done = fills_done + 1u32;
        };

        // Update fill limit
        let remaining_size = perp_positions::get_position_size(backstop, market);
        *fill_limit = *fill_limit - fills_done;

        remaining_size > 0
    }
}
