/// ============================================================================
/// PERP POSITIONS - Core Position Tracking and Account Status
/// ============================================================================
///
/// This is the central position management module for the Decibel perpetual DEX.
/// It manages:
/// - User position storage (size, direction, leverage, entry price)
/// - Account status calculation (balance, margin, PnL, liquidation eligibility)
/// - Position PnL with funding cost integration
/// - Cross-margin and isolated-margin position support
/// - Account status caching for performance optimization
/// - Trade and position update event emission
///
/// KEY CONCEPTS:
/// - Positions are stored per market in a BigOrderedMap for efficient lookups
/// - Cross-margin: Multiple positions share one collateral pool
/// - Isolated-margin: Each position has its own collateral pool
/// - Funding costs are tracked via AccumulativeIndex (similar to interest accrual)
/// - PnL haircut: Unrealized profits may be discounted for risk management
///
/// ============================================================================

module decibel::perp_positions {
    use decibel::i64_aggregator;
    use aptos_framework::aggregator_v2;
    use decibel::price_management;
    use aptos_framework::object;
    use decibel::perp_market;
    use std::option;
    use decibel::pending_order_tracker;
    use econia::order_book_types;
    use std::string;
    use decibel::builder_code_registry;
    use aptos_framework::big_ordered_map;
    use decibel::trading_fees_manager;
    use decibel::perp_market_config;
    use decibel::adl_tracker;
    use decibel::liquidation_config;
    use aptos_framework::error;
    use aptos_framework::signer;
    use decibel::collateral_balance_sheet;
    use aptos_framework::ordered_map;
    use aptos_framework::event;
    use aptos_framework::math64;
    use decibel::position_view_types;
    use std::vector;

    // ============================================================================
    // Friend Declarations - Modules that can access internal position functions
    // ============================================================================

    friend decibel::position_update;
    friend decibel::order_margin;
    friend decibel::accounts_collateral;
    friend decibel::position_tp_sl;
    friend decibel::clearinghouse_perp;
    friend decibel::liquidation;
    friend decibel::async_matching_engine;
    friend decibel::perp_engine;

    // ============================================================================
    // STRUCT DEFINITIONS
    // ============================================================================

    /// Account-level metadata stored at user address
    /// Links to fee tracking for volume-based fee discounts
    struct AccountInfo has key {
        fee_tracking_addr: address,  // Address for fee tier tracking
    }

    /// Summary of account's cross-margin status
    /// Used for margin checks and liquidation evaluation
    struct AccountStatus has copy, drop {
        account_balance: i64,          // Total equity = collateral + unrealized PnL
        unrealized_pnl: i64,           // Net unrealized profit/loss across positions
        initial_margin: u64,           // Margin required to maintain positions
        total_notional_value: u64,     // Total position size in USD value
    }

    /// Cached account status using aggregators for concurrent updates
    /// Optimizes for high-frequency position updates
    struct AccountStatusCache has key {
        unrealized_pnl: i64_aggregator::I64Aggregator,      // Aggregated PnL
        initial_margin: aggregator_v2::Aggregator<u64>,      // Aggregated margin
        total_notional_value: aggregator_v2::Aggregator<u64>, // Aggregated notional
    }

    /// Detailed account status with liquidation thresholds
    /// Extended version with margin multipliers for different liquidation tiers
    struct AccountStatusDetailed has drop {
        account_balance: i64,
        initial_margin: u64,
        liquidation_margin: u64,                  // Standard liquidation threshold
        backstop_liquidator_margin: u64,          // Backstop (emergency) liquidation threshold
        liquidation_margin_multiplier: u64,       // Numerator for maintenance margin ratio
        liquidation_margin_divisor: u64,          // Denominator for maintenance margin ratio
        backstop_liquidation_margin_multiplier: u64,
        backstop_liquidation_margin_divisor: u64,
        total_notional_value: u64,
    }

    // ============================================================================
    // ENUMS
    // ============================================================================

    /// Trade direction actions for event emission
    enum Action has copy, drop, store {
        OpenLong,      // Opening or increasing long position
        CloseLong,     // Closing or reducing long position
        OpenShort,     // Opening or increasing short position
        CloseShort,    // Closing or reducing short position
    }

    /// Perpetual position data structure (versioned for upgradability)
    /// V1: Current version with all position attributes
    enum PerpPosition has copy, drop, store {
        V1 {
            size: u64,                                    // Position size in base units
            entry_px_times_size_sum: u128,                // Cumulative (entry_price * size) for VWAP
            avg_acquire_entry_px: u64,                    // Average entry price
            user_leverage: u8,                            // User's chosen leverage (1-100x)
            is_long: bool,                                // true = long, false = short
            is_isolated: bool,                            // true = isolated margin mode
            funding_index_at_last_update: price_management::AccumulativeIndex,  // Funding checkpoint
            unrealized_funding_amount_before_last_update: i64,  // Accumulated funding before checkpoint
        }
    }

    /// Position with associated market reference
    /// Used when iterating through positions for liquidation
    struct PerpPositionWithMarket has copy, drop {
        market: object::Object<perp_market::PerpMarket>,
        position: PerpPosition,
    }

    /// Lightweight position info for return values
    struct PositionInfo has drop {
        size: u64,
        is_long: bool,
        user_leverage: u8,
    }

    /// Event emitted when position state changes
    /// Includes TP/SL orders for frontend synchronization
    enum PositionUpdateEvent has copy, drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            user: address,
            is_long: bool,
            size: u64,
            user_leverage: u8,
            entry_price_times_size_sum: u128,
            is_isolated: bool,
            funding_index_at_last_update: i128,
            unrealized_funding_amount_before_last_update: i64,
            full_sized_tp: option::Option<pending_order_tracker::FullSizedTpSlForEvent>,
            fixed_sized_tps: vector<pending_order_tracker::FixedSizedTpSlForEvent>,
            full_sized_sl: option::Option<pending_order_tracker::FullSizedTpSlForEvent>,
            fixed_sized_sls: vector<pending_order_tracker::FixedSizedTpSlForEvent>,
        }
    }

    /// Event emitted when trade executes
    /// Contains full trade details for order tracking
    enum TradeEvent has drop, store {
        V1 {
            account: address,
            market: object::Object<perp_market::PerpMarket>,
            action: Action,                                    // OpenLong/CloseLong/etc
            source: TradeTriggerSource,                        // What triggered the trade
            order_id: option::Option<order_book_types::OrderIdType>,
            client_order_id: option::Option<string::String>,
            size: u64,
            price: u64,
            builder_code: option::Option<builder_code_registry::BuilderCode>,
            realized_pnl: i64,                                 // PnL realized from this trade
            realized_funding_cost: i64,                        // Funding settled
            fee: i64,                                          // Trading fee paid
            fill_id: u128,                                     // Unique fill identifier
            is_taker: bool,                                    // Taker vs maker fill
        }
    }

    /// Source of trade execution
    /// Distinguishes voluntary trades from system-triggered ones
    enum TradeTriggerSource has copy, drop, store {
        OrderFill,            // Normal order fill
        MarginCall,           // Standard liquidation
        BackStopLiquidation,  // Emergency backstop liquidation
        ADL,                  // Auto-deleveraging
        MarketDelisted,       // Market closure settlement
    }

    /// Container for all user positions across markets
    /// Uses BigOrderedMap for efficient storage and iteration
    struct UserPositions has key {
        positions: big_ordered_map::BigOrderedMap<object::Object<perp_market::PerpMarket>, PerpPosition>,
    }

    // ============================================================================
    // POSITION FIELD ACCESSORS
    // ============================================================================

    /// Returns whether position is long
    friend fun is_long(position: &PerpPosition): bool {
        *&position.is_long
    }

    /// Returns whether position uses isolated margin
    friend fun is_isolated(position: &PerpPosition): bool {
        *&position.is_isolated
    }

    /// Returns position size
    friend fun get_size(position: &PerpPosition): u64 {
        *&position.size
    }

    /// Returns user's leverage setting
    friend fun get_user_leverage(position: &PerpPosition): u8 {
        *&position.user_leverage
    }

    /// Returns entry_px * size sum for VWAP calculation
    friend fun get_entry_px_times_size_sum(position: &PerpPosition): u128 {
        *&position.entry_px_times_size_sum
    }

    /// Returns market from position wrapper
    friend fun get_market(pos_with_market: &PerpPositionWithMarket): object::Object<perp_market::PerpMarket> {
        *&pos_with_market.market
    }

    /// Returns position reference from wrapper
    friend fun get_perp_position(pos_with_market: &PerpPositionWithMarket): &PerpPosition {
        &pos_with_market.position
    }

    // ============================================================================
    // VOLUME TRACKING (for fee discounts)
    // ============================================================================

    /// Get user's maker volume in current fee window
    public fun get_maker_volume_in_window(user: address): u128
        acquires AccountInfo
    {
        trading_fees_manager::get_maker_volume_in_window(
            *&borrow_global<AccountInfo>(user).fee_tracking_addr
        )
    }

    /// Get user's taker volume in current fee window
    public fun get_taker_volume_in_window(user: address): u128
        acquires AccountInfo
    {
        trading_fees_manager::get_taker_volume_in_window(
            *&borrow_global<AccountInfo>(user).fee_tracking_addr
        )
    }

    // ============================================================================
    // POSITION UPDATE - Core position modification logic
    // ============================================================================

    /// Update position after a trade fill
    ///
    /// This is the main entry point for position modifications:
    /// 1. Finds existing position (or creates new one)
    /// 2. Calculates new position state
    /// 3. Updates funding index
    /// 4. Emits trade and position events
    /// 5. Updates ADL tracker for priority calculation
    /// 6. Updates account status cache
    ///
    /// Parameters:
    /// - user: User's address
    /// - skip_adl_update: Whether to skip ADL tracker updates (for liquidations)
    /// - is_isolated: Whether this is an isolated margin position
    /// - market: The perpetual market
    /// - order_id: Optional order ID that triggered this
    /// - client_order_id: Optional client-provided order ID
    /// - fill_price: Execution price
    /// - is_buy: Direction of the fill (true = buy)
    /// - fill_size: Size of the fill
    /// - builder_code: Optional builder code for rebates
    /// - realized_pnl: PnL realized from closing portion
    /// - new_funding_index: New funding checkpoint
    /// - realized_funding: Funding settled in this trade
    /// - fee: Trading fee
    /// - fee_in_balance_precision: Fee scaled to balance decimals
    /// - fill_id: Unique fill identifier
    /// - is_taker: Whether this was taker fill
    /// - trigger_source: What triggered this trade
    friend fun update_position(
        user: address,
        skip_adl_update: bool,
        is_isolated: bool,
        market: object::Object<perp_market::PerpMarket>,
        order_id: option::Option<order_book_types::OrderIdType>,
        client_order_id: option::Option<string::String>,
        fill_price: u64,
        is_buy: bool,
        fill_size: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        realized_pnl: i64,
        new_funding_index: price_management::AccumulativeIndex,
        realized_funding: i64,
        fee: i64,
        fee_in_balance_precision: i64,
        fill_id: u128,
        is_taker: bool,
        trigger_source: TradeTriggerSource
    ): (u64, bool, u8)
        acquires AccountStatusCache, UserPositions
    {
        let user_leverage: u8;
        let positions = &mut borrow_global_mut<UserPositions>(user).positions;
        let positions_frozen = freeze(positions);
        let iter = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>, PerpPosition>(
            positions_frozen, &market
        );

        let position_exists = !big_ordered_map::iter_is_end(&iter, positions_frozen);

        loop {
            if (position_exists) {
                // Position exists - update it

                // Cache old position if we have status cache
                let should_update_cache = if (is_isolated) false else exists<AccountStatusCache>(user);
                let old_position_opt = if (should_update_cache) {
                    option::some(*big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>, PerpPosition>(iter, freeze(positions)))
                } else {
                    option::none<PerpPosition>()
                };

                // Modify position in place using lambda
                let position_info = big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>, PerpPosition, PositionInfo>(
                    iter,
                    positions,
                    |pos| lambda_update_position(
                        user, skip_adl_update, market, order_id, client_order_id, fill_price,
                        is_buy, fill_size, builder_code, realized_pnl, new_funding_index,
                        realized_funding, fee, fee_in_balance_precision, fill_id, is_taker, trigger_source,
                        pos
                    )
                );

                // Update account status cache if needed
                if (option::is_some(&old_position_opt)) {
                    let old_pos = option::borrow(&old_position_opt);
                    let new_pos = big_ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>, PerpPosition>(iter, freeze(positions));
                    update_account_status_cache_for_position_change(user, market, old_pos, new_pos);
                };

                return (*&position_info.size, *&position_info.is_long, *&position_info.user_leverage)
            };

            // No existing position - create new one
            let entry_px_times_size = (fill_price as u128) * (fill_size as u128);
            let max_leverage = perp_market_config::get_max_leverage(market);
            let new_position = new_perp_position_with_mode(
                fill_size, market, entry_px_times_size, max_leverage, is_buy, is_isolated
            );

            // Emit trade event for new position
            emit_trade_event(
                user, market, &new_position, order_id, client_order_id, is_buy, fill_size,
                fill_price, builder_code, fee, realized_funding, fee_in_balance_precision,
                fill_id, is_taker, trigger_source
            );

            // Add to ADL tracker unless skipped
            if (!skip_adl_update) {
                let leverage = *&new_position.user_leverage;
                adl_tracker::add_position(market, user, is_buy, fill_price, leverage);
            };

            user_leverage = *&new_position.user_leverage;

            // Store new position
            big_ordered_map::add(positions, market, new_position);

            // Get reference to stored position and emit update event
            let position_ref = big_ordered_map::borrow(freeze(positions), &market);
            emit_position_update_event(position_ref, market, user);

            // Update status cache for new position
            let should_update = if (is_isolated) skip_adl_update else exists<AccountStatusCache>(user);
            if (should_update) {
                let empty_pos = new_empty_perp_position_with_mode(market, user_leverage, is_isolated);
                update_account_status_cache_for_position_change(user, market, &empty_pos, position_ref);
            };

            break
        };

        (fill_size, is_buy, user_leverage)
    }

    /// Lambda helper for updating position within iterator
    fun lambda_update_position(
        user: address,
        skip_adl_update: bool,
        market: object::Object<perp_market::PerpMarket>,
        order_id: option::Option<order_book_types::OrderIdType>,
        client_order_id: option::Option<string::String>,
        fill_price: u64,
        is_buy: bool,
        fill_size: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        realized_pnl: i64,
        new_funding_index: price_management::AccumulativeIndex,
        realized_funding: i64,
        fee: i64,
        fee_in_balance_precision: i64,
        fill_id: u128,
        is_taker: bool,
        trigger_source: TradeTriggerSource,
        position: &mut PerpPosition
    ): PositionInfo {
        // Emit trade event before modification
        emit_trade_event(
            user, market, freeze(position), order_id, client_order_id, is_buy, fill_size,
            fill_price, builder_code, fee, realized_funding, fee_in_balance_precision,
            fill_id, is_taker, trigger_source
        );

        // Update the position structure
        update_single_position(market, user, skip_adl_update, position, fill_price, is_buy, fill_size, realized_pnl, new_funding_index);

        // Emit position update event
        emit_position_update_event(freeze(position), market, user);

        PositionInfo {
            size: *&position.size,
            is_long: *&position.is_long,
            user_leverage: *&position.user_leverage,
        }
    }

    // ============================================================================
    // ACCOUNT STATUS CACHE MANAGEMENT
    // ============================================================================

    /// Update account status cache when a position changes
    /// Calculates delta between old and new position contributions
    fun update_account_status_cache_for_position_change(
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        old_position: &PerpPosition,
        new_position: &PerpPosition
    )
        acquires AccountStatusCache
    {
        if (!exists<AccountStatusCache>(user)) {
            return
        };

        // Get market info for calculations
        let (mark_price, funding_index, size_multiplier, haircut_bps, max_leverage, _withdraw_leverage) =
            price_management::get_market_info_for_position_status(market, true);

        // Calculate old position contribution (only for cross-margin)
        let (old_pnl, old_margin, old_notional) = if (!*&old_position.is_isolated && *&old_position.size != 0) {
            let pnl = apply_pnl_haircut(
                pnl_with_funding_impl(old_position, size_multiplier, funding_index, mark_price),
                haircut_bps
            );

            // Calculate initial margin
            let effective_leverage = (math64::min((*&old_position.user_leverage) as u64, max_leverage as u64) as u8) as u64;
            let leverage_divisor = size_multiplier * effective_leverage;
            assert!(leverage_divisor != 0, error::invalid_argument(4));

            let notional = ((*&old_position.size as u128) * (mark_price as u128)) / (size_multiplier as u128);
            let margin = ceil_div_u128(
                (*&old_position.size as u128) * (mark_price as u128),
                leverage_divisor as u128
            ) as u64;

            (pnl, margin, notional as u64)
        } else {
            (0i64, 0, 0)
        };

        // Calculate new position contribution
        let (new_pnl, new_margin, new_notional) = if (!*&new_position.is_isolated && *&new_position.size != 0) {
            let pnl = apply_pnl_haircut(
                pnl_with_funding_impl(new_position, size_multiplier, funding_index, mark_price),
                haircut_bps
            );

            let effective_leverage = (math64::min((*&new_position.user_leverage) as u64, max_leverage as u64) as u8) as u64;
            let leverage_divisor = size_multiplier * effective_leverage;
            assert!(leverage_divisor != 0, error::invalid_argument(4));

            let notional = ((*&new_position.size as u128) * (mark_price as u128)) / (size_multiplier as u128);
            let margin = ceil_div_u128(
                (*&new_position.size as u128) * (mark_price as u128),
                leverage_divisor as u128
            ) as u64;

            (pnl, margin, notional as u64)
        } else {
            (0i64, 0, 0)
        };

        // Apply deltas to cache
        let cache = borrow_global_mut<AccountStatusCache>(user);
        i64_aggregator::add(&mut cache.unrealized_pnl, -old_pnl);
        i64_aggregator::add(&mut cache.unrealized_pnl, new_pnl);
        let _ = aggregator_v2::try_sub(&mut cache.initial_margin, old_margin);
        let _ = aggregator_v2::try_add(&mut cache.initial_margin, new_margin);
        let _ = aggregator_v2::try_sub(&mut cache.total_notional_value, old_notional);
        let _ = aggregator_v2::try_add(&mut cache.total_notional_value, new_notional);
    }

    /// Helper for ceiling division with u128
    fun ceil_div_u128(numerator: u128, denominator: u128): u128 {
        if (numerator == 0) {
            if (denominator != 0) { 0 }
            else { abort error::invalid_argument(4) }
        } else {
            (numerator - 1) / denominator + 1
        }
    }

    // ============================================================================
    // POSITION CREATION HELPERS
    // ============================================================================

    /// Create a new position with specified mode (cross/isolated)
    friend fun new_perp_position_with_mode(
        size: u64,
        market: object::Object<perp_market::PerpMarket>,
        entry_px_times_size: u128,
        user_leverage: u8,
        is_long: bool,
        is_isolated: bool
    ): PerpPosition {
        let max_leverage = perp_market_config::get_max_leverage(market);
        assert!(user_leverage > 0 && user_leverage <= max_leverage, error::invalid_argument(2));

        let avg_entry_px = if (size == 0) { 0 } else { (entry_px_times_size / (size as u128)) as u64 };
        let current_funding_index = price_management::get_accumulative_index(market);

        PerpPosition::V1 {
            size,
            entry_px_times_size_sum: entry_px_times_size,
            avg_acquire_entry_px: avg_entry_px,
            user_leverage,
            is_long,
            is_isolated,
            funding_index_at_last_update: current_funding_index,
            unrealized_funding_amount_before_last_update: 0i64,
        }
    }

    /// Create empty position placeholder (for margin calculations)
    friend fun new_empty_perp_position_with_mode(
        market: object::Object<perp_market::PerpMarket>,
        user_leverage: u8,
        is_isolated: bool
    ): PerpPosition {
        new_perp_position_with_mode(0, market, 0, user_leverage, true, is_isolated)
    }

    /// Create new cross-margin position (legacy helper)
    friend fun new_perp_position(
        size: u64,
        market: object::Object<perp_market::PerpMarket>,
        entry_px_times_size: u128,
        user_leverage: u8,
        is_long: bool
    ): PerpPosition {
        new_perp_position_with_mode(size, market, entry_px_times_size, user_leverage, is_long, false)
    }

    /// Create empty cross-margin position (legacy helper)
    friend fun new_empty_perp_position(
        market: object::Object<perp_market::PerpMarket>,
        user_leverage: u8
    ): PerpPosition {
        new_perp_position_with_mode(0, market, 0, user_leverage, true, false)
    }

    // ============================================================================
    // EVENT EMISSION
    // ============================================================================

    /// Emit trade event with correct action type
    /// Handles position flip (close old direction + open new)
    fun emit_trade_event(
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        position: &PerpPosition,
        order_id: option::Option<order_book_types::OrderIdType>,
        client_order_id: option::Option<string::String>,
        is_buy: bool,
        fill_size: u64,
        fill_price: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        fee: i64,
        realized_funding: i64,
        fee_in_balance_precision: i64,
        fill_id: u128,
        is_taker: bool,
        trigger_source: TradeTriggerSource
    ) {
        // Check if this is a position flip (opposite direction to existing)
        let is_position_flip = (*&position.is_long != is_buy) && (*&position.size != 0);

        if (is_position_flip) {
            if (*&position.size >= fill_size) {
                // Reducing or closing existing position
                let action = if (*&position.is_long) { Action::CloseLong } else { Action::CloseShort };
                event::emit(TradeEvent::V1 {
                    account: user,
                    market,
                    action,
                    source: trigger_source,
                    order_id,
                    client_order_id,
                    size: fill_size,
                    price: fill_price,
                    builder_code,
                    realized_pnl: fee,  // Note: variable reuse
                    realized_funding_cost: realized_funding,
                    fee: fee_in_balance_precision,
                    fill_id,
                    is_taker,
                });
            } else {
                // Position flip - close existing and open new
                // First emit close event for existing position
                let close_action = if (*&position.is_long) { Action::CloseLong } else { Action::CloseShort };
                event::emit(TradeEvent::V1 {
                    account: user,
                    market,
                    action: close_action,
                    source: trigger_source,
                    order_id,
                    client_order_id,
                    size: *&position.size,
                    price: fill_price,
                    builder_code,
                    realized_pnl: fee,
                    realized_funding_cost: realized_funding,
                    fee: fee_in_balance_precision,
                    fill_id,
                    is_taker,
                });

                // Then emit open event for new direction
                let open_action = if (is_buy) { Action::OpenLong } else { Action::OpenShort };
                let new_size = fill_size - *&position.size;
                event::emit(TradeEvent::V1 {
                    account: user,
                    market,
                    action: open_action,
                    source: trigger_source,
                    order_id,
                    client_order_id,
                    size: new_size,
                    price: fill_price,
                    builder_code,
                    realized_pnl: 0i64,  // No PnL on opening
                    realized_funding_cost: 0i64,
                    fee: 0i64,  // Fee attributed to close only
                    fill_id,
                    is_taker,
                });
            };
        } else {
            // Opening or increasing position
            let action = if (is_buy) { Action::OpenLong } else { Action::OpenShort };
            event::emit(TradeEvent::V1 {
                account: user,
                market,
                action,
                source: trigger_source,
                order_id,
                client_order_id,
                size: fill_size,
                price: fill_price,
                builder_code,
                realized_pnl: fee,
                realized_funding_cost: realized_funding,
                fee: fee_in_balance_precision,
                fill_id,
                is_taker,
            });
        };
    }

    /// Emit position update event with TP/SL info
    friend fun emit_position_update_event(
        position: &PerpPosition,
        market: object::Object<perp_market::PerpMarket>,
        user: address
    ) {
        let is_long = *&position.is_long;
        let (full_tp, full_sl, fixed_tps, fixed_sls) = pending_order_tracker::get_all_tp_sls_for_event(user, market, is_long);

        event::emit(PositionUpdateEvent::V1 {
            market,
            user,
            is_long,
            size: *&position.size,
            user_leverage: *&position.user_leverage,
            entry_price_times_size_sum: *&position.entry_px_times_size_sum,
            is_isolated: *&position.is_isolated,
            funding_index_at_last_update: price_management::accumulative_index(&position.funding_index_at_last_update),
            unrealized_funding_amount_before_last_update: *&position.unrealized_funding_amount_before_last_update,
            full_sized_tp: full_tp,
            fixed_sized_tps: fixed_tps,
            full_sized_sl: full_sl,
            fixed_sized_sls: fixed_sls,
        });
    }

    // ============================================================================
    // PNL CALCULATION
    // ============================================================================

    /// Calculate PnL including funding costs
    fun pnl_with_funding(position: &PerpPosition, market: object::Object<perp_market::PerpMarket>): i64 {
        let (mark_price, funding_index, size_multiplier, _haircut, _max_lev, _withdraw_lev) =
            price_management::get_market_info_for_position_status(market, true);
        pnl_with_funding_impl(position, size_multiplier, funding_index, mark_price)
    }

    /// Core PnL calculation implementation
    ///
    /// PnL = Price PnL - Funding Cost
    /// Price PnL = (mark_price * size - entry_price * size) * direction
    /// Funding Cost = accumulated from funding payments
    fun pnl_with_funding_impl(
        position: &PerpPosition,
        size_multiplier: u64,
        current_funding_index: price_management::AccumulativeIndex,
        mark_price: u64
    ): i64 {
        let current_notional = (mark_price as u128) * ((*&position.size) as u128);
        let entry_notional = *&position.entry_px_times_size_sum;

        // Calculate price PnL based on direction
        let (is_profit, abs_pnl) = if (current_notional >= entry_notional) {
            (*&position.is_long, current_notional - entry_notional)
        } else {
            (!*&position.is_long, entry_notional - current_notional)
        };

        // Convert to balance precision
        let pnl_in_balance = if (is_profit) {
            (abs_pnl / (size_multiplier as u128)) as u64
        } else {
            ceil_div_u128(abs_pnl, size_multiplier as u128) as u64
        };

        let signed_pnl = if (is_profit) { pnl_in_balance as i64 } else { -(pnl_in_balance as i64) };

        // Subtract funding cost
        let (funding_cost, _new_index) = get_position_funding_cost_and_index_impl(position, size_multiplier, current_funding_index);
        signed_pnl - funding_cost
    }

    /// Apply haircut to unrealized profits
    /// Profits are discounted by haircut_bps / 10000
    /// Losses are not haircut (full loss counted)
    fun apply_pnl_haircut(pnl: i64, haircut_bps: u64): i64 {
        if (pnl > 0) {
            let multiplier = (10000 - haircut_bps) as i64;
            pnl * multiplier / 10000
        } else {
            pnl
        }
    }

    // ============================================================================
    // FUNDING COST CALCULATION
    // ============================================================================

    /// Get funding cost and new index for a position
    friend fun get_position_funding_cost_and_index(
        position: &PerpPosition,
        market: object::Object<perp_market::PerpMarket>
    ): (i64, price_management::AccumulativeIndex) {
        let size_multiplier = perp_market_config::get_size_multiplier(market);
        let current_index = price_management::get_accumulative_index(market);
        get_position_funding_cost_and_index_impl(position, size_multiplier, current_index)
    }

    /// Core funding cost calculation
    /// Total funding = prior accumulated + (current_index - last_index) * size
    fun get_position_funding_cost_and_index_impl(
        position: &PerpPosition,
        size_multiplier: u64,
        current_index: price_management::AccumulativeIndex
    ): (i64, price_management::AccumulativeIndex) {
        let new_funding = price_management::get_funding_cost(
            &position.funding_index_at_last_update,
            &current_index,
            *&position.size,
            size_multiplier,
            *&position.is_long
        );

        (*&position.unrealized_funding_amount_before_last_update + new_funding, current_index)
    }

    // ============================================================================
    // ACCOUNT STATUS CALCULATIONS
    // ============================================================================

    /// Calculate cross-margin account status
    /// Aggregates all non-isolated positions
    friend fun cross_position_status(
        balance_sheet: &collateral_balance_sheet::CollateralBalanceSheet,
        user: address,
        exclude_market: option::Option<object::Object<perp_market::PerpMarket>>,
        apply_haircut: bool
    ): AccountStatus
        acquires AccountStatusCache, UserPositions
    {
        // Try to use cache if available
        let use_cache = apply_haircut && exists<AccountStatusCache>(user);

        if (use_cache) {
            let cache = borrow_global<AccountStatusCache>(user);
            let cached_pnl = i64_aggregator::read(&cache.unrealized_pnl);
            let cached_margin = aggregator_v2::read(&cache.initial_margin);
            let cached_notional = aggregator_v2::read(&cache.total_notional_value);

            // If excluding a market, subtract its contribution from cache
            if (option::is_some(&exclude_market)) {
                let market = option::borrow(&exclude_market);
                let positions = &borrow_global<UserPositions>(user).positions;
                if (big_ordered_map::contains(positions, market)) {
                    let position = big_ordered_map::borrow(positions, market);
                    let (pos_pnl, pos_margin, pos_notional) = get_position_contribution(position, *market);

                    let final_pnl = cached_pnl - pos_pnl;
                    let final_margin = if (cached_margin >= pos_margin) { cached_margin - pos_margin }
                        else { abort error::out_of_range(26) };
                    let final_notional = if (cached_notional >= pos_notional) { cached_notional - pos_notional }
                        else { abort error::out_of_range(26) };

                    let balance_type = collateral_balance_sheet::balance_type_cross(user);
                    let collateral = collateral_balance_sheet::total_asset_collateral_value(balance_sheet, balance_type);

                    return AccountStatus {
                        account_balance: (collateral as i64) + final_pnl,
                        unrealized_pnl: final_pnl,
                        initial_margin: final_margin,
                        total_notional_value: final_notional,
                    }
                }
            };

            // Use cached values directly
            let balance_type = collateral_balance_sheet::balance_type_cross(user);
            let collateral = collateral_balance_sheet::total_asset_collateral_value(balance_sheet, balance_type);

            return AccountStatus {
                account_balance: (collateral as i64) + cached_pnl,
                unrealized_pnl: cached_pnl,
                initial_margin: cached_margin,
                total_notional_value: cached_notional,
            }
        };

        // No cache - calculate from scratch
        let balance_type = collateral_balance_sheet::balance_type_cross(user);
        let mut status = AccountStatus {
            account_balance: collateral_balance_sheet::total_asset_collateral_value(balance_sheet, balance_type) as i64,
            unrealized_pnl: 0i64,
            initial_margin: 0,
            total_notional_value: 0,
        };

        let positions = &borrow_global<UserPositions>(user).positions;

        // Iterate through all positions
        let iter = big_ordered_map::internal_leaf_new_begin_iter(positions);
        while (!big_ordered_map::internal_leaf_iter_is_end(&iter)) {
            let (leaf_entries, next_iter) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index(iter, positions);

            let entry_iter = ordered_map::internal_new_begin_iter(leaf_entries);
            while (!ordered_map::iter_is_end(&entry_iter, leaf_entries)) {
                let market = ordered_map::iter_borrow_key(&entry_iter, leaf_entries);
                let position = big_ordered_map::internal_leaf_borrow_value(ordered_map::iter_borrow(entry_iter, leaf_entries));

                // Skip isolated positions and optionally excluded market
                let should_include = if (option::is_some(&exclude_market)) {
                    market != option::borrow(&exclude_market) && !*&position.is_isolated
                } else {
                    !*&position.is_isolated
                };

                if (should_include) {
                    update_position_status_for_position(&mut status, position, *market, apply_haircut);
                };

                entry_iter = ordered_map::iter_next(entry_iter, leaf_entries);
            };

            iter = next_iter;
        };

        status
    }

    /// Get position's contribution to account status
    fun get_position_contribution(
        position: &PerpPosition,
        market: object::Object<perp_market::PerpMarket>
    ): (i64, u64, u64) {
        if (*&position.is_isolated || *&position.size == 0) {
            return (0i64, 0, 0)
        };

        let (mark_price, funding_index, size_multiplier, haircut, max_leverage, _) =
            price_management::get_market_info_for_position_status(market, true);

        let pnl = apply_pnl_haircut(
            pnl_with_funding_impl(position, size_multiplier, funding_index, mark_price),
            haircut
        );

        let effective_leverage = (math64::min((*&position.user_leverage) as u64, max_leverage as u64) as u8) as u64;
        let leverage_divisor = size_multiplier * effective_leverage;
        assert!(leverage_divisor != 0, error::invalid_argument(4));

        let margin = ceil_div_u128(
            (*&position.size as u128) * (mark_price as u128),
            leverage_divisor as u128
        ) as u64;

        let notional = ((*&position.size as u128) * (mark_price as u128) / (size_multiplier as u128)) as u64;

        (pnl, margin, notional)
    }

    /// Update account status by adding position's contribution
    friend fun update_position_status_for_position(
        status: &mut AccountStatus,
        position: &PerpPosition,
        market: object::Object<perp_market::PerpMarket>,
        apply_haircut: bool
    ) {
        if (*&position.size == 0) {
            return
        };

        let (mark_price, funding_index, size_multiplier, haircut, max_leverage, withdraw_leverage) =
            price_management::get_market_info_for_position_status(market, apply_haircut);

        let raw_pnl = pnl_with_funding_impl(position, size_multiplier, funding_index, mark_price);
        let pnl = if (apply_haircut) { apply_pnl_haircut(raw_pnl, haircut) } else { raw_pnl };

        // Add PnL to account balance
        status.account_balance = status.account_balance + pnl;
        status.unrealized_pnl = status.unrealized_pnl + pnl;

        // Calculate and add initial margin
        let effective_leverage = if (apply_haircut) {
            (math64::min((*&position.user_leverage) as u64, max_leverage as u64) as u8) as u64
        } else {
            withdraw_leverage as u64
        };

        let leverage_divisor = size_multiplier * effective_leverage;
        assert!(leverage_divisor != 0, error::invalid_argument(4));

        let margin = ceil_div_u128(
            (*&position.size as u128) * (mark_price as u128),
            leverage_divisor as u128
        ) as u64;
        status.initial_margin = status.initial_margin + margin;

        // Calculate and add notional value
        let notional = ((*&position.size as u128) * (mark_price as u128) / (size_multiplier as u128)) as u64;
        status.total_notional_value = status.total_notional_value + notional;
    }

    /// Calculate isolated position status
    friend fun isolated_position_status(
        balance_sheet: &collateral_balance_sheet::CollateralBalanceSheet,
        user: address,
        position: &PerpPosition,
        market: object::Object<perp_market::PerpMarket>,
        apply_haircut: bool
    ): AccountStatus {
        let balance_type = collateral_balance_sheet::balance_type_isolated(user, market);
        let mut status = AccountStatus {
            account_balance: collateral_balance_sheet::total_asset_collateral_value(balance_sheet, balance_type) as i64,
            unrealized_pnl: 0i64,
            initial_margin: 0,
            total_notional_value: 0,
        };
        update_position_status_for_position(&mut status, position, market, apply_haircut);
        status
    }

    /// Get position status (isolated or cross depending on position type)
    friend fun position_status(
        balance_sheet: &collateral_balance_sheet::CollateralBalanceSheet,
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): AccountStatus
        acquires AccountStatusCache, UserPositions
    {
        let positions = &borrow_global<UserPositions>(user).positions;
        let iter = big_ordered_map::internal_find(positions, &market);
        assert!(!big_ordered_map::iter_is_end(&iter, positions), error::invalid_argument(7));

        let position = big_ordered_map::iter_borrow(iter, positions);
        if (*&position.is_isolated) {
            isolated_position_status(balance_sheet, user, position, market, false)
        } else {
            cross_position_status(balance_sheet, user, option::none(), false)
        }
    }

    // ============================================================================
    // LIQUIDATION CHECKS
    // ============================================================================

    /// Check if account is liquidatable based on margin
    friend fun is_account_liquidatable(
        status: &AccountStatus,
        liq_config: &liquidation_config::LiquidationConfig,
        is_backstop: bool
    ): bool {
        let liq_margin = liquidation_config::get_liquidation_margin(liq_config, *&status.initial_margin, is_backstop);
        *&status.account_balance < (liq_margin as i64)
    }

    /// Check liquidation with detailed status
    friend fun is_account_liquidatable_detailed(
        status: &AccountStatusDetailed,
        is_backstop: bool
    ): bool {
        let threshold = if (is_backstop) {
            *&status.backstop_liquidator_margin
        } else {
            *&status.liquidation_margin
        };
        *&status.account_balance < (threshold as i64)
    }

    /// Check if a specific position is liquidatable
    friend fun is_position_liquidatable(
        balance_sheet: &collateral_balance_sheet::CollateralBalanceSheet,
        liq_config: &liquidation_config::LiquidationConfig,
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        is_backstop: bool
    ): bool
        acquires AccountStatusCache, UserPositions
    {
        if (!exists<UserPositions>(user)) {
            return false
        };
        let status = position_status(balance_sheet, user, market);
        is_account_liquidatable(&status, liq_config, is_backstop)
    }

    /// Add liquidation details to account status
    friend fun add_liquidation_details(
        status: AccountStatus,
        liq_config: &liquidation_config::LiquidationConfig
    ): AccountStatusDetailed {
        let AccountStatus { account_balance, unrealized_pnl: _, initial_margin, total_notional_value } = status;

        let liq_margin = liquidation_config::get_liquidation_margin(liq_config, initial_margin, false);
        let backstop_margin = liquidation_config::get_liquidation_margin(liq_config, initial_margin, true);

        AccountStatusDetailed {
            account_balance,
            initial_margin,
            liquidation_margin: liq_margin,
            backstop_liquidator_margin: backstop_margin,
            liquidation_margin_multiplier: liquidation_config::maintenance_margin_leverage_multiplier(liq_config),
            liquidation_margin_divisor: liquidation_config::maintenance_margin_leverage_divisor(liq_config),
            backstop_liquidation_margin_multiplier: liquidation_config::backstop_margin_maintenance_multiplier(liq_config),
            backstop_liquidation_margin_divisor: liquidation_config::backstop_margin_maintenance_divisor(liq_config),
            total_notional_value,
        }
    }

    /// Calculate backstop liquidation profit
    friend fun calculate_backstop_liquidation_profit(
        pnl_per_margin: i64,
        status: &AccountStatusDetailed,
        position: &PerpPosition,
        market: object::Object<perp_market::PerpMarket>
    ): i64 {
        if (*&position.size == 0) {
            return 0i64
        };

        let position_pnl = pnl_with_funding(position, market);
        let mark_price = price_management::get_mark_price(market);
        let size_multiplier = perp_market_config::get_size_multiplier(market);
        let max_leverage = perp_market_config::get_max_leverage(market) as u64;

        let leverage_divisor = size_multiplier * max_leverage;
        assert!(leverage_divisor != 0, error::invalid_argument(4));

        let position_margin = ceil_div_u128(
            (*&position.size as u128) * (mark_price as u128),
            leverage_divisor as u128
        ) as u64;

        assert!(*&status.initial_margin != 0, 4);

        // Pro-rata share of PnL based on margin
        let share = ((pnl_per_margin as i128) * (position_margin as i128)) / (*&status.initial_margin as i128);
        (share as i64) + position_pnl
    }

    // ============================================================================
    // POSITION QUERIES
    // ============================================================================

    /// Check if user account is initialized
    friend fun account_initialized(user: address): bool {
        exists<UserPositions>(user)
    }

    /// Assert user is initialized
    friend fun assert_user_initialized(user: address) {
        assert!(exists<AccountInfo>(user), 22);
    }

    /// Check if user has a position in market
    friend fun has_position(user: address, market: object::Object<perp_market::PerpMarket>): bool
        acquires UserPositions
    {
        if (!exists<UserPositions>(user)) {
            return false
        };
        big_ordered_map::contains(&borrow_global<UserPositions>(user).positions, &market)
    }

    /// Check if user has any crossed positions with size > 0
    friend fun has_crossed_position(user: address): bool
        acquires UserPositions
    {
        if (!exists<UserPositions>(user)) {
            return false
        };

        let positions = &borrow_global<UserPositions>(user).positions;
        let iter = big_ordered_map::internal_new_begin_iter(positions);

        while (!big_ordered_map::iter_is_end(&iter, positions)) {
            let position = big_ordered_map::iter_borrow(iter, positions);
            if (!*&position.is_isolated && *&position.size > 0) {
                return true
            };
            iter = big_ordered_map::iter_next(iter, positions);
        };

        false
    }

    /// Check if user has any assets or positions
    friend fun has_any_assets_or_positions(
        balance_sheet: &collateral_balance_sheet::CollateralBalanceSheet,
        user: address
    ): bool
        acquires UserPositions
    {
        // Check cross-margin balance
        let balance_type = collateral_balance_sheet::balance_type_cross(user);
        if (collateral_balance_sheet::has_any_assets(balance_sheet, balance_type)) {
            return true
        };

        if (!exists<UserPositions>(user)) {
            return false
        };

        // Check all positions
        let positions = &borrow_global<UserPositions>(user).positions;
        let iter = big_ordered_map::internal_new_begin_iter(positions);

        while (!big_ordered_map::iter_is_end(&iter, positions)) {
            let position = big_ordered_map::iter_borrow(iter, positions);
            if (*&position.size > 0) {
                return true
            };

            // Check isolated margin for this position
            if (*&position.is_isolated) {
                let market = *big_ordered_map::iter_borrow_key(&iter);
                let iso_balance_type = collateral_balance_sheet::balance_type_isolated(user, market);
                if (collateral_balance_sheet::has_any_assets(balance_sheet, iso_balance_type)) {
                    return true
                };
            };

            iter = big_ordered_map::iter_next(iter, positions);
        };

        false
    }

    /// Get position size in a market
    friend fun get_position_size(user: address, market: object::Object<perp_market::PerpMarket>): u64
        acquires UserPositions
    {
        if (!exists<UserPositions>(user)) {
            return 0
        };

        let positions = &borrow_global<UserPositions>(user).positions;
        let iter = big_ordered_map::internal_find(positions, &market);
        if (big_ordered_map::iter_is_end(&iter, positions)) {
            return 0
        };

        *&big_ordered_map::iter_borrow(iter, positions).size
    }

    /// Get position direction
    friend fun get_position_is_long(user: address, market: object::Object<perp_market::PerpMarket>): bool
        acquires UserPositions
    {
        let positions = &borrow_global<UserPositions>(user).positions;
        let iter = big_ordered_map::internal_find(positions, &market);
        assert!(!big_ordered_map::iter_is_end(&iter, positions), error::invalid_argument(7));
        *&big_ordered_map::iter_borrow(iter, positions).is_long
    }

    /// Get position size and direction
    friend fun get_position_size_and_is_long(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): (u64, bool)
        acquires UserPositions
    {
        let positions = &borrow_global<UserPositions>(user).positions;
        let iter = big_ordered_map::internal_find(positions, &market);
        assert!(!big_ordered_map::iter_is_end(&iter, positions), error::invalid_argument(7));

        let pos = big_ordered_map::iter_borrow(iter, positions);
        (*&pos.size, *&pos.is_long)
    }

    /// Check if position uses isolated margin
    friend fun is_position_isolated(user: address, market: object::Object<perp_market::PerpMarket>): bool
        acquires UserPositions
    {
        if (!exists<UserPositions>(user)) {
            return false
        };

        let positions = &borrow_global<UserPositions>(user).positions;
        let iter = big_ordered_map::internal_find(positions, &market);
        if (big_ordered_map::iter_is_end(&iter, positions)) {
            return false
        };

        *&big_ordered_map::iter_borrow(iter, positions).is_isolated
    }

    /// Get entry price * size sum for a position
    friend fun get_position_entry_px_times_size_sum(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): u128
        acquires UserPositions
    {
        let positions = &borrow_global<UserPositions>(user).positions;
        let iter = big_ordered_map::internal_find(positions, &market);
        assert!(!big_ordered_map::iter_is_end(&iter, positions), error::invalid_argument(7));
        *&big_ordered_map::iter_borrow(iter, positions).entry_px_times_size_sum
    }

    /// Get unrealized funding cost for a position
    friend fun get_position_unrealized_funding_cost(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): i64
        acquires UserPositions
    {
        let positions = &borrow_global<UserPositions>(user).positions;
        let iter = big_ordered_map::internal_find(positions, &market);
        assert!(!big_ordered_map::iter_is_end(&iter, positions), error::invalid_argument(7));

        let (funding_cost, _) = get_position_funding_cost_and_index(
            big_ordered_map::iter_borrow(iter, positions),
            market
        );
        funding_cost
    }

    /// Get position details or defaults for non-existent position
    friend fun get_position_details_or_default(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): (u64, bool, u8)
        acquires UserPositions
    {
        get_position_info_or_default(user, market, true)
    }

    /// Get position info with default for long direction
    friend fun get_position_info_or_default(
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        default_is_long: bool
    ): (u64, bool, u8)
        acquires UserPositions
    {
        if (!exists<UserPositions>(user)) {
            return (0, default_is_long, perp_market_config::get_max_leverage(market))
        };

        let positions = &borrow_global<UserPositions>(user).positions;
        let iter = big_ordered_map::internal_find(positions, &market);

        if (big_ordered_map::iter_is_end(&iter, positions)) {
            return (0, default_is_long, perp_market_config::get_max_leverage(market))
        };

        let pos = big_ordered_map::iter_borrow(iter, positions);
        (*&pos.size, *&pos.is_long, *&pos.user_leverage)
    }

    /// Get net asset value including all positions
    friend fun get_account_net_asset_value(
        balance_sheet: &collateral_balance_sheet::CollateralBalanceSheet,
        user: address
    ): i64
        acquires UserPositions
    {
        let balance_type = collateral_balance_sheet::balance_type_cross(user);
        let mut total = collateral_balance_sheet::total_asset_collateral_value(balance_sheet, balance_type) as i64;

        let positions = &borrow_global<UserPositions>(user).positions;
        let iter = big_ordered_map::internal_leaf_new_begin_iter(positions);

        while (!big_ordered_map::internal_leaf_iter_is_end(&iter)) {
            let (leaf_entries, next_iter) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index(iter, positions);

            let entry_iter = ordered_map::internal_new_begin_iter(leaf_entries);
            while (!ordered_map::iter_is_end(&entry_iter, leaf_entries)) {
                let market = ordered_map::iter_borrow_key(&entry_iter, leaf_entries);
                let position = big_ordered_map::internal_leaf_borrow_value(ordered_map::iter_borrow(entry_iter, leaf_entries));

                // Add position PnL
                total = total + get_position_net_asset_value(position, *market);

                // Add isolated margin collateral if applicable
                if (*&position.is_isolated) {
                    let iso_balance_type = collateral_balance_sheet::balance_type_isolated(user, *market);
                    total = total + (collateral_balance_sheet::total_asset_collateral_value(balance_sheet, iso_balance_type) as i64);
                };

                entry_iter = ordered_map::iter_next(entry_iter, leaf_entries);
            };

            iter = next_iter;
        };

        total
    }

    /// Get single position's net asset value (PnL with funding)
    friend fun get_position_net_asset_value(
        position: &PerpPosition,
        market: object::Object<perp_market::PerpMarket>
    ): i64 {
        if (*&position.size == 0) {
            return 0i64
        };

        let (mark_price, funding_index, size_multiplier, _haircut, _max_lev, _withdraw_lev) =
            price_management::get_market_info_for_position_status(market, true);
        pnl_with_funding_impl(position, size_multiplier, funding_index, mark_price)
    }

    // ============================================================================
    // WITHDRAWAL CALCULATIONS
    // ============================================================================

    /// Calculate free collateral for cross-margin account
    friend fun free_collateral_for_crossed(
        balance_sheet: &collateral_balance_sheet::CollateralBalanceSheet,
        user: address,
        pending_fee: i64
    ): u64
        acquires AccountStatusCache, UserPositions
    {
        let status = cross_position_status(balance_sheet, user, option::none(), true);
        let free = status.account_balance - pending_fee - (status.initial_margin as i64);
        if (free > 0) { free as u64 } else { 0 }
    }

    /// Calculate max withdrawable from cross-margin
    friend fun max_allowed_primary_asset_withdraw_from_cross_margin(
        balance_sheet: &collateral_balance_sheet::CollateralBalanceSheet,
        user: address,
        pending_fee: i64
    ): u64
        acquires AccountStatusCache, UserPositions
    {
        let status = cross_position_status(balance_sheet, user, option::none(), true);
        let free = status.account_balance - pending_fee - (status.initial_margin as i64);

        // Also limit by actual primary asset balance
        let balance_type = collateral_balance_sheet::balance_type_cross(user);
        let primary_balance = collateral_balance_sheet::balance_of_primary_asset(balance_sheet, balance_type) - pending_fee;
        let liquid_balance = primary_balance + status.unrealized_pnl;

        let limit = if (free < liquid_balance) { free } else { liquid_balance };
        if (limit > 0) { limit as u64 } else { 0 }
    }

    /// Calculate max withdrawable from isolated margin
    friend fun max_allowed_primary_asset_withdraw_from_isolated_margin(
        balance_sheet: &collateral_balance_sheet::CollateralBalanceSheet,
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): u64
        acquires UserPositions
    {
        let positions = &borrow_global<UserPositions>(user).positions;
        let iter = big_ordered_map::internal_find(positions, &market);
        assert!(!big_ordered_map::iter_is_end(&iter, positions), error::invalid_argument(7));

        let position = big_ordered_map::iter_borrow(iter, positions);
        assert!(*&position.is_isolated, error::invalid_argument(7));

        let required_margin = margin_required(position, market);
        let pnl = pnl_with_funding(position, market);
        let balance_type = collateral_balance_sheet::balance_type_isolated(user, market);
        let collateral = collateral_balance_sheet::total_asset_collateral_value(balance_sheet, balance_type);

        let equity = (collateral as i64) + pnl;
        let free = equity - (required_margin as i64);

        if (free > 0) { free as u64 } else { 0 }
    }

    /// Calculate margin required for position
    fun margin_required(position: &PerpPosition, market: object::Object<perp_market::PerpMarket>): u64 {
        let size_multiplier = perp_market_config::get_size_multiplier(market);
        let mark_price = price_management::get_mark_price(market);
        let leverage = (*&position.user_leverage) as u64;
        let leverage_divisor = size_multiplier * leverage;

        assert!(leverage_divisor != 0, error::invalid_argument(4));

        ceil_div_u128(
            (*&position.size as u128) * (mark_price as u128),
            leverage_divisor as u128
        ) as u64
    }

    // ============================================================================
    // OPEN INTEREST DELTA CALCULATION
    // ============================================================================

    /// Calculate how a trade affects open interest for longs
    friend fun get_open_interest_delta_for_long(
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        is_buy: bool,
        size: u64
    ): i64
        acquires UserPositions
    {
        if (!exists<UserPositions>(user)) {
            // No existing position
            return if (is_buy) { size as i64 } else { 0i64 }
        };

        let positions = &borrow_global<UserPositions>(user).positions;
        let iter = big_ordered_map::internal_find(positions, &market);

        if (big_ordered_map::iter_is_end(&iter, positions)) {
            // No position in this market
            return if (is_buy) { size as i64 } else { 0i64 }
        };

        let position = big_ordered_map::iter_borrow(iter, positions);

        if (*&position.is_long) {
            // Existing long position
            if (is_buy) {
                // Adding to long - increases OI
                size as i64
            } else {
                // Closing long - decreases OI
                -(math64::min(size, *&position.size) as i64)
            }
        } else {
            // Existing short position
            if (is_buy) {
                // Closing/flipping short
                if (size < *&position.size) {
                    // Partial close - no change to long OI
                    0i64
                } else {
                    // Full close + possibly new long
                    (size - *&position.size) as i64
                }
            } else {
                // Adding to short - no change to long OI
                0i64
            }
        }
    }

    // ============================================================================
    // USER INITIALIZATION
    // ============================================================================

    /// Initialize user account if new
    friend fun init_user_if_new(admin: &signer, fee_tracking_addr: address) {
        let user = signer::address_of(admin);

        if (!exists<UserPositions>(user)) {
            move_to(admin, UserPositions {
                positions: big_ordered_map::new_with_config(64, 16, false),
            });
        };

        if (!exists<AccountInfo>(user)) {
            move_to(admin, AccountInfo {
                fee_tracking_addr,
            });
        };

        pending_order_tracker::initialize_account_summary(user);
    }

    /// Initialize account status cache (for backstop liquidator optimization)
    friend fun init_account_status_cache(signer: &signer)
        acquires UserPositions
    {
        let user = signer::address_of(signer);

        if (!exists<AccountStatusCache>(user)) {
            let (mut unrealized_pnl, mut initial_margin, mut total_notional) = (0i64, 0u64, 0u64);

            if (exists<UserPositions>(user)) {
                let positions = &borrow_global<UserPositions>(user).positions;
                let iter = big_ordered_map::internal_leaf_new_begin_iter(positions);

                while (!big_ordered_map::internal_leaf_iter_is_end(&iter)) {
                    let (leaf_entries, next_iter) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index(iter, positions);

                    let entry_iter = ordered_map::internal_new_begin_iter(leaf_entries);
                    while (!ordered_map::iter_is_end(&entry_iter, leaf_entries)) {
                        let market = ordered_map::iter_borrow_key(&entry_iter, leaf_entries);
                        let position = big_ordered_map::internal_leaf_borrow_value(ordered_map::iter_borrow(entry_iter, leaf_entries));

                        let (pnl, margin, notional) = get_position_contribution(position, *market);
                        unrealized_pnl = unrealized_pnl + pnl;
                        initial_margin = initial_margin + margin;
                        total_notional = total_notional + notional;

                        entry_iter = ordered_map::iter_next(entry_iter, leaf_entries);
                    };

                    iter = next_iter;
                };
            };

            move_to(signer, AccountStatusCache {
                unrealized_pnl: i64_aggregator::new_i64_aggregator_with_value(unrealized_pnl),
                initial_margin: aggregator_v2::create_unbounded_aggregator_with_value(initial_margin),
                total_notional_value: aggregator_v2::create_unbounded_aggregator_with_value(total_notional),
            });
        };
    }

    // ============================================================================
    // USER SETTINGS CONFIGURATION
    // ============================================================================

    /// Configure leverage and margin mode for a market
    friend fun configure_user_settings_for_market(
        user_signer: &signer,
        market: object::Object<perp_market::PerpMarket>,
        is_cross_margin: bool,  // true = cross, false = isolated
        user_leverage: u8
    )
        acquires AccountStatusCache, UserPositions
    {
        let user = signer::address_of(user_signer);
        let max_leverage = perp_market_config::get_max_leverage(market);
        assert!(user_leverage > 0 && user_leverage <= max_leverage, 2);

        let positions = &mut borrow_global_mut<UserPositions>(user).positions;
        let existing_opt = big_ordered_map::get(freeze(positions), &market);

        let old_position_opt = if (option::is_some(&existing_opt)) {
            option::some(*option::borrow(&existing_opt))
        } else {
            option::none()
        };

        let need_new_position = option::is_none(&existing_opt);

        if (option::is_some(&existing_opt)) {
            let mut existing = option::destroy_some(existing_opt);

            // Check if we need to switch margin modes
            let switching_to_isolated = !is_cross_margin && *&existing.is_isolated;
            let switching_to_cross = is_cross_margin && !*&existing.is_isolated;

            if (switching_to_isolated || switching_to_cross) {
                // Cannot switch margin mode with open position
                assert!(*&existing.size == 0, 17);
                big_ordered_map::remove(positions, &market);
                need_new_position = true;
            } else {
                // Update margin mode
                existing.is_isolated = !is_cross_margin;

                // Can only change leverage with no position
                if (*&existing.user_leverage != user_leverage) {
                    assert!(*&existing.size == 0, 17);
                    existing.user_leverage = user_leverage;
                };

                big_ordered_map::upsert(positions, market, existing);
                emit_position_update_event(&existing, market, user);
            };
        };

        if (need_new_position) {
            let new_pos = new_empty_perp_position_with_mode(market, user_leverage, !is_cross_margin);
            emit_position_update_event(&new_pos, market, user);
            big_ordered_map::add(positions, market, new_pos);
        };

        // Update pending order tracker
        let final_pos = big_ordered_map::borrow(freeze(positions), &market);
        pending_order_tracker::update_position(user, market, *&final_pos.size, *&final_pos.is_long, *&final_pos.user_leverage);

        // Update status cache if switching to cross
        if (is_cross_margin && exists<AccountStatusCache>(user)) {
            if (option::is_some(&old_position_opt)) {
                update_account_status_cache_for_position_change(user, market, option::borrow(&old_position_opt), final_pos);
            } else {
                let empty = new_empty_perp_position_with_mode(market, *&final_pos.user_leverage, false);
                update_account_status_cache_for_position_change(user, market, &empty, final_pos);
            };
        };
    }

    // ============================================================================
    // POSITION LISTING
    // ============================================================================

    /// List all positions for a user
    friend fun list_positions(user: address): vector<position_view_types::PositionViewInfo>
        acquires UserPositions
    {
        let mut result = vector::empty();
        let positions = &borrow_global<UserPositions>(user).positions;

        let iter = big_ordered_map::internal_leaf_new_begin_iter(positions);
        while (!big_ordered_map::internal_leaf_iter_is_end(&iter)) {
            let (leaf_entries, next_iter) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index(iter, positions);

            let entry_iter = ordered_map::internal_new_begin_iter(leaf_entries);
            while (!ordered_map::iter_is_end(&entry_iter, leaf_entries)) {
                let market = ordered_map::iter_borrow_key(&entry_iter, leaf_entries);
                let position = big_ordered_map::internal_leaf_borrow_value(ordered_map::iter_borrow(entry_iter, leaf_entries));

                if (*&position.size != 0) {
                    vector::push_back(&mut result, position_view_types::new_position_view_info(
                        *market,
                        *&position.size,
                        *&position.is_long,
                        *&position.user_leverage,
                        *&position.is_isolated,
                    ));
                };

                entry_iter = ordered_map::iter_next(entry_iter, leaf_entries);
            };

            iter = next_iter;
        };

        result
    }

    /// View a specific position
    friend fun view_position(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): option::Option<position_view_types::PositionViewInfo>
        acquires UserPositions
    {
        let positions = &borrow_global<UserPositions>(user).positions;
        let iter = big_ordered_map::internal_find(positions, &market);

        if (big_ordered_map::iter_is_end(&iter, positions)) {
            return option::none()
        };

        let pos = big_ordered_map::iter_borrow(iter, positions);
        option::some(position_view_types::new_position_view_info(
            market,
            *&pos.size,
            *&pos.is_long,
            *&pos.user_leverage,
            *&pos.is_isolated,
        ))
    }

    // ============================================================================
    // LIQUIDATION POSITION COLLECTION
    // ============================================================================

    /// Get positions to liquidate for a user in a market
    friend fun positions_to_liquidate(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): vector<PerpPositionWithMarket>
        acquires UserPositions
    {
        let positions = &borrow_global<UserPositions>(user).positions;
        let position_opt = big_ordered_map::get(positions, &market);

        if (option::is_some(&position_opt)) {
            let position = option::destroy_some(position_opt);

            if (*&position.is_isolated) {
                // Isolated position - only liquidate this one
                let mut result = vector::empty();
                vector::push_back(&mut result, PerpPositionWithMarket { market, position });
                return result
            };

            // Cross-margin - return all non-isolated positions
            let all_markets = big_ordered_map::keys(positions);
            let mut result = vector::empty();

            let len = vector::length(&all_markets);
            let mut i = 0;
            while (i < len) {
                let mkt = *vector::borrow(&all_markets, i);
                let pos = *big_ordered_map::borrow(positions, &mkt);
                if (!*&pos.is_isolated) {
                    vector::push_back(&mut result, PerpPositionWithMarket { market: mkt, position: pos });
                };
                i = i + 1;
            };

            return result
        };

        // No position found - return all non-isolated positions
        let all_markets = big_ordered_map::keys(positions);
        let mut result = vector::empty();

        let len = vector::length(&all_markets);
        let mut i = 0;
        while (i < len) {
            let mkt = *vector::borrow(&all_markets, i);
            let pos = *big_ordered_map::borrow(positions, &mkt);
            if (!*&pos.is_isolated) {
                vector::push_back(&mut result, PerpPositionWithMarket { market: mkt, position: pos });
            };
            i = i + 1;
        };

        result
    }

    // ============================================================================
    // MARGIN TRANSFER
    // ============================================================================

    /// Transfer margin between cross and isolated positions
    friend fun transfer_margin_to_isolated_position(
        balance_sheet: &mut collateral_balance_sheet::CollateralBalanceSheet,
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        from_cross: bool,  // true = cross to isolated, false = isolated to cross
        amount: u64
    )
        acquires AccountStatusCache, UserPositions
    {
        assert!(is_position_isolated(user, market), 7);

        if (from_cross) {
            // Transfer from cross to isolated
            assert!(
                is_max_allowed_withdraw_from_cross_margin_at_least(freeze(balance_sheet), user, 0i64, amount),
                6
            );
            let change_type = collateral_balance_sheet::change_type_user_movement();
            collateral_balance_sheet::transfer_from_crossed_to_isolated(balance_sheet, user, amount, market, change_type);
        } else {
            // Transfer from isolated to cross
            assert!(
                max_allowed_primary_asset_withdraw_from_isolated_margin(freeze(balance_sheet), user, market) >= amount,
                6
            );
            let change_type = collateral_balance_sheet::change_type_user_movement();
            collateral_balance_sheet::transfer_from_isolated_to_crossed(balance_sheet, user, amount, market, change_type);
        };
    }

    /// Transfer all balance from user to backstop liquidator
    friend fun transfer_balance_to_liquidator(
        balance_sheet: &mut collateral_balance_sheet::CollateralBalanceSheet,
        liquidator: address,
        user: address,
        market: object::Object<perp_market::PerpMarket>
    )
        acquires UserPositions
    {
        if (is_position_isolated(user, market)) {
            let from_type = collateral_balance_sheet::balance_type_isolated(user, market);
            let to_type = collateral_balance_sheet::balance_type_cross(liquidator);
            collateral_balance_sheet::transfer_to_backstop_liquidator(balance_sheet, from_type, to_type);
        } else {
            let from_type = collateral_balance_sheet::balance_type_cross(user);
            let to_type = collateral_balance_sheet::balance_type_cross(liquidator);
            collateral_balance_sheet::transfer_to_backstop_liquidator(balance_sheet, from_type, to_type);
        };
    }

    // ============================================================================
    // INTERNAL POSITION UPDATES
    // ============================================================================

    /// Update position after trade execution
    fun update_single_position(
        market: object::Object<perp_market::PerpMarket>,
        user: address,
        skip_adl_update: bool,
        position: &mut PerpPosition,
        fill_price: u64,
        is_buy: bool,
        fill_size: u64,
        realized_pnl: i64,
        new_funding_index: price_management::AccumulativeIndex
    ) {
        // Remove from ADL tracker if position exists and we're not skipping
        if (*&position.size != 0 && !skip_adl_update) {
            adl_tracker::remove_position(market, user, *&position.is_long, *&position.avg_acquire_entry_px, *&position.user_leverage);
        };

        // Cancel TP/SL orders if position is flipping direction
        if (*&position.is_long != is_buy && *&position.size <= fill_size) {
            pending_order_tracker::cancel_all_tp_sl_for_position(market, user, *&position.is_long);
        };

        // Update position structure
        update_single_position_struct(position, fill_price, is_buy, fill_size, realized_pnl, new_funding_index);

        // Add to ADL tracker if position still exists
        if (*&position.size != 0 && !skip_adl_update) {
            adl_tracker::add_position(market, user, *&position.is_long, *&position.avg_acquire_entry_px, *&position.user_leverage);
        };
    }

    /// Update position struct fields after trade
    friend fun update_single_position_struct(
        position: &mut PerpPosition,
        fill_price: u64,
        is_buy: bool,
        fill_size: u64,
        new_funding_accumulated: i64,
        new_funding_index: price_management::AccumulativeIndex
    ) {
        if (*&position.is_long != is_buy) {
            // Opposite direction trade - close/reduce/flip
            if (*&position.size >= fill_size) {
                // Reducing position
                let new_size = *&position.size - fill_size;
                let ratio_numerator = new_size as u128;
                let ratio_denominator = (*&position.size) as u128;

                // Pro-rata reduce entry_px_times_size_sum
                if (*&position.is_long) {
                    // Round up for longs (conservative)
                    let new_entry_sum = ceil_div_u256(
                        (*&position.entry_px_times_size_sum as u256) * (ratio_numerator as u256),
                        ratio_denominator as u256
                    );
                    position.entry_px_times_size_sum = new_entry_sum as u128;
                } else {
                    // Round down for shorts (conservative)
                    position.entry_px_times_size_sum = (
                        (*&position.entry_px_times_size_sum as u256) * (ratio_numerator as u256) / (ratio_denominator as u256)
                    ) as u128;
                };

                position.size = new_size;
            } else {
                // Position flip
                let new_size = fill_size - *&position.size;
                position.size = new_size;
                position.entry_px_times_size_sum = (fill_price as u128) * (new_size as u128);
                position.avg_acquire_entry_px = fill_price;
                position.is_long = is_buy;
            };
        } else {
            // Same direction trade - increase position
            let new_entry_sum = (fill_price as u128) * (fill_size as u128) + *&position.entry_px_times_size_sum;
            let new_size = fill_size + *&position.size;

            position.size = new_size;
            position.avg_acquire_entry_px = (new_entry_sum / (new_size as u128)) as u64;
            position.entry_px_times_size_sum = new_entry_sum;
        };

        // Update funding state
        position.unrealized_funding_amount_before_last_update = new_funding_accumulated;
        position.funding_index_at_last_update = new_funding_index;
    }

    /// Helper for ceiling division with u256
    fun ceil_div_u256(numerator: u256, denominator: u256): u256 {
        if (numerator == 0) {
            if (denominator != 0) { 0 }
            else { abort error::invalid_argument(4) }
        } else {
            (numerator - 1) / denominator + 1
        }
    }

    // ============================================================================
    // PRICE CHANGE CACHE UPDATE
    // ============================================================================

    /// Update account status cache when market prices change
    friend fun update_account_status_cache_on_price_change(
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        old_mark_price: u64,
        old_funding_index: price_management::AccumulativeIndex,
        new_mark_price: u64,
        new_funding_index: price_management::AccumulativeIndex,
        size_multiplier: u64,
        haircut_bps: u64,
        max_leverage: u8
    )
        acquires AccountStatusCache, UserPositions
    {
        if (!exists<AccountStatusCache>(user)) {
            return
        };

        let positions = &borrow_global<UserPositions>(user).positions;
        if (!big_ordered_map::contains(positions, &market)) {
            return
        };

        let position = big_ordered_map::borrow(positions, &market);
        if (*&position.is_isolated || *&position.size == 0) {
            return
        };

        // Calculate old contribution
        let old_pnl = apply_pnl_haircut(
            pnl_with_funding_impl(position, size_multiplier, old_funding_index, old_mark_price),
            haircut_bps
        );
        let effective_leverage = (math64::min((*&position.user_leverage) as u64, max_leverage as u64) as u8) as u64;
        let leverage_divisor = size_multiplier * effective_leverage;
        assert!(leverage_divisor != 0, error::invalid_argument(4));

        let old_margin = ceil_div_u128(
            (*&position.size as u128) * (old_mark_price as u128),
            leverage_divisor as u128
        ) as u64;
        let old_notional = ((*&position.size as u128) * (old_mark_price as u128) / (size_multiplier as u128)) as u64;

        // Calculate new contribution
        let new_pnl = apply_pnl_haircut(
            pnl_with_funding_impl(position, size_multiplier, new_funding_index, new_mark_price),
            haircut_bps
        );
        let new_margin = ceil_div_u128(
            (*&position.size as u128) * (new_mark_price as u128),
            leverage_divisor as u128
        ) as u64;
        let new_notional = ((*&position.size as u128) * (new_mark_price as u128) / (size_multiplier as u128)) as u64;

        // Apply deltas
        let cache = borrow_global_mut<AccountStatusCache>(user);
        i64_aggregator::add(&mut cache.unrealized_pnl, -old_pnl);
        i64_aggregator::add(&mut cache.unrealized_pnl, new_pnl);
        let _ = aggregator_v2::try_sub(&mut cache.initial_margin, old_margin);
        let _ = aggregator_v2::try_add(&mut cache.initial_margin, new_margin);
        let _ = aggregator_v2::try_sub(&mut cache.total_notional_value, old_notional);
        let _ = aggregator_v2::try_add(&mut cache.total_notional_value, new_notional);
    }

    // ============================================================================
    // STATUS FIELD ACCESSORS
    // ============================================================================

    friend fun get_account_balance(status: &AccountStatus): i64 { *&status.account_balance }
    friend fun get_account_balance_from_status(status: &AccountStatus): i64 { *&status.account_balance }
    friend fun get_initial_margin(status: &AccountStatus): u64 { *&status.initial_margin }
    friend fun new_account_status(balance: i64): AccountStatus {
        AccountStatus { account_balance: balance, unrealized_pnl: 0i64, initial_margin: 0, total_notional_value: 0 }
    }
    friend fun increase_account_balance_for_status(status: &mut AccountStatus, amount: i64) {
        status.account_balance = status.account_balance + amount;
    }

    // Detailed status accessors
    friend fun get_account_balance_from_detailed_status(status: &AccountStatusDetailed): i64 { *&status.account_balance }
    friend fun get_initial_margin_from_detailed_status(status: &AccountStatusDetailed): u64 { *&status.initial_margin }
    friend fun get_liquidation_margin_from_detailed_status(status: &AccountStatusDetailed): u64 { *&status.liquidation_margin }
    friend fun get_liquidation_margin_multiplier_from_detailed_status(status: &AccountStatusDetailed): u64 { *&status.liquidation_margin_multiplier }
    friend fun get_liquidation_margin_divisor_from_detailed_status(status: &AccountStatusDetailed): u64 { *&status.liquidation_margin_divisor }
    friend fun get_backstop_liquidation_margin_multiplier_from_detailed_status(status: &AccountStatusDetailed): u64 { *&status.backstop_liquidation_margin_multiplier }
    friend fun get_backstop_liquidation_margin_divisor_from_detailed_status(status: &AccountStatusDetailed): u64 { *&status.backstop_liquidation_margin_divisor }
    friend fun get_total_notional_value_from_detailed_status(status: &AccountStatusDetailed): u64 { *&status.total_notional_value }

    // Trade trigger source constructors
    friend fun new_trade_trigger_source_order_fill(): TradeTriggerSource { TradeTriggerSource::OrderFill }
    friend fun new_trade_trigger_source_margin_call(): TradeTriggerSource { TradeTriggerSource::MarginCall }
    friend fun new_trade_trigger_source_backstop_liquidation(): TradeTriggerSource { TradeTriggerSource::BackStopLiquidation }
    friend fun new_trade_trigger_source_adl(): TradeTriggerSource { TradeTriggerSource::ADL }
    friend fun new_trade_trigger_source_market_delisted(): TradeTriggerSource { TradeTriggerSource::MarketDelisted }

    // Event accessors
    friend fun get_full_sized_tp_sl_from_event(event: &PositionUpdateEvent, is_tp: bool): option::Option<pending_order_tracker::FullSizedTpSlForEvent> {
        if (is_tp) { *&event.full_sized_tp } else { *&event.full_sized_sl }
    }
    friend fun get_fixed_sized_tp_sl_from_event(event: &PositionUpdateEvent, is_tp: bool): vector<pending_order_tracker::FixedSizedTpSlForEvent> {
        if (is_tp) { *&event.fixed_sized_tps } else { *&event.fixed_sized_sls }
    }

    // Position helpers
    friend fun may_be_find_position(user: address, market: object::Object<perp_market::PerpMarket>): option::Option<PerpPosition>
        acquires UserPositions
    {
        if (!exists<UserPositions>(user)) {
            return option::none()
        };
        big_ordered_map::get(&borrow_global<UserPositions>(user).positions, &market)
    }

    friend fun must_find_position_copy(user: address, market: object::Object<perp_market::PerpMarket>): PerpPosition
        acquires UserPositions
    {
        let positions = &borrow_global<UserPositions>(user).positions;
        let iter = big_ordered_map::internal_find(positions, &market);
        assert!(!big_ordered_map::iter_is_end(&iter, positions), error::invalid_argument(7));
        *big_ordered_map::iter_borrow(iter, positions)
    }

    friend fun get_cross_position_markets(user: address): vector<object::Object<perp_market::PerpMarket>>
        acquires UserPositions
    {
        big_ordered_map::keys(&borrow_global<UserPositions>(user).positions)
    }

    friend fun get_fee_tracking_addr(user: address): address
        acquires AccountInfo
    {
        *&borrow_global<AccountInfo>(user).fee_tracking_addr
    }

    // Withdrawal check helpers
    friend fun is_free_collateral_for_crossed_at_least(
        balance_sheet: &collateral_balance_sheet::CollateralBalanceSheet,
        user: address,
        pending_fee: i64,
        amount: u64
    ): bool
        acquires AccountStatusCache, UserPositions
    {
        free_collateral_for_crossed(balance_sheet, user, pending_fee) >= amount
    }

    friend fun is_max_allowed_withdraw_from_cross_margin_at_least(
        balance_sheet: &collateral_balance_sheet::CollateralBalanceSheet,
        user: address,
        pending_fee: i64,
        amount: u64
    ): bool
        acquires AccountStatusCache, UserPositions
    {
        max_allowed_primary_asset_withdraw_from_cross_margin(balance_sheet, user, pending_fee) >= amount
    }
}
