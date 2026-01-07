/// ============================================================================
/// ORDER MARGIN - Order Placement Margin Validation
/// ============================================================================
///
/// This module validates that users have sufficient margin/collateral to place
/// orders. It coordinates between position state and pending order tracking
/// to ensure order margin requirements are met.
///
/// KEY FUNCTIONS:
/// - validate_order_placement: Check if account can place a non-reduce-only order
/// - validate_reduce_only_order: Check if account can place a reduce-only order
/// - add_pending_order: Register a new pending order's margin requirement
/// - add_reduce_only_order: Register a reduce-only order
/// - available_order_margin: Calculate remaining margin available for orders
///
/// MARGIN LOGIC:
/// - Orders reserve margin from free collateral
/// - Reduce-only orders don't require additional margin (they close positions)
/// - Available margin = free_collateral - pending_order_margin
///
/// ============================================================================

module decibel::order_margin {
    use std::object;
    use std::option;
    use std::string;

    use decibel::collateral_balance_sheet;
    use decibel::perp_market;
    use decibel::perp_positions;
    use decibel::pending_order_tracker;
    use decibel::perp_engine_types;
    use econia::order_book_types;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::accounts_collateral;
    friend decibel::clearinghouse_perp;

    // ============================================================================
    // ORDER PLACEMENT VALIDATION
    // ============================================================================

    /// Validate that account has sufficient margin to place a non-reduce-only order
    ///
    /// # Parameters
    /// - `balance_sheet`: The account's collateral balance sheet
    /// - `account`: The account address
    /// - `market`: The perpetual market
    /// - `size`: Order size in base units
    /// - `is_long`: True if buy order
    /// - `price`: Order price
    ///
    /// # Returns
    /// - None if order can be placed
    /// - Some(error_message) if insufficient collateral
    friend fun validate_order_placement(
        balance_sheet: &collateral_balance_sheet::CollateralBalanceSheet,
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        is_long: bool,
        price: u64
    ): option::Option<string::String> {
        // Get current position info (size, direction, entry price)
        let (position_size, position_is_long, entry_price) = perp_positions::get_position_info_or_default(
            account,
            market,
            is_long
        );

        // Calculate free collateral (with no PnL adjustment)
        let free_collateral = perp_positions::free_collateral_for_crossed(
            balance_sheet,
            account,
            0i64  // No simulated PnL
        );

        // Validate against pending order tracker
        if (pending_order_tracker::validate_non_reduce_only_order_placement(
            account,
            market,
            size,
            price,
            is_long,
            position_size,
            position_is_long,
            entry_price,
            free_collateral
        )) {
            return option::none<string::String>()
        };

        // Return error message: "Not enough collateral to place order"
        option::some<string::String>(string::utf8(
            vector[78u8, 111u8, 116u8, 32u8, 101u8, 110u8, 111u8, 117u8, 103u8, 104u8, 32u8,
                   99u8, 111u8, 108u8, 108u8, 97u8, 116u8, 101u8, 114u8, 97u8, 108u8, 32u8,
                   116u8, 111u8, 32u8, 112u8, 108u8, 97u8, 99u8, 101u8, 32u8, 111u8, 114u8,
                   100u8, 101u8, 114u8]
        ))
    }

    /// Validate that account can place a reduce-only order
    ///
    /// # Parameters
    /// - `account`: The account address
    /// - `market`: The perpetual market
    /// - `is_long`: True if buy order (must be opposite of position direction)
    ///
    /// # Returns
    /// - None if order can be placed
    /// - Some(error_message) if validation fails
    friend fun validate_reduce_only_order(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        is_long: bool
    ): option::Option<string::String> {
        // Get current position info
        let (position_size, position_is_long, _entry_price) = perp_positions::get_position_info_or_default(
            account,
            market,
            is_long
        );

        // Validate reduce-only order against position
        pending_order_tracker::validate_reduce_only_order(
            account,
            market,
            is_long,
            position_size,
            position_is_long
        )
    }

    // ============================================================================
    // ORDER REGISTRATION
    // ============================================================================

    /// Add a reduce-only order to pending order tracking
    /// Reduce-only orders can only reduce/close existing positions
    ///
    /// # Parameters
    /// - `account`: The account address
    /// - `market`: The perpetual market
    /// - `order_id`: The order's unique identifier
    /// - `size`: Order size in base units
    /// - `is_long`: True if buy order
    ///
    /// # Returns
    /// Vector of order actions to execute (e.g., reduce other orders if needed)
    friend fun add_reduce_only_order(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        order_id: order_book_types::OrderIdType,
        size: u64,
        is_long: bool
    ): vector<perp_engine_types::SingleOrderAction> {
        // Get current position info
        let (position_size, position_is_long, _entry_price) = perp_positions::get_position_info_or_default(
            account,
            market,
            is_long
        );

        // Register reduce-only order in pending tracker
        pending_order_tracker::add_reduce_only_order(
            account,
            market,
            order_id,
            size,
            is_long,
            position_size,
            position_is_long
        )
    }

    /// Add a non-reduce-only pending order
    /// These orders require margin to be reserved
    ///
    /// # Parameters
    /// - `account`: The account address
    /// - `market`: The perpetual market
    /// - `size`: Order size in base units
    /// - `is_long`: True if buy order
    /// - `price`: Order price
    friend fun add_pending_order(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        is_long: bool,
        price: u64
    ) {
        // Get current position info
        let (position_size, position_is_long, entry_price) = perp_positions::get_position_info_or_default(
            account,
            market,
            is_long
        );

        // Register order in pending tracker
        pending_order_tracker::add_non_reduce_only_order(
            account,
            market,
            size,
            price,
            is_long,
            position_size,
            position_is_long,
            entry_price
        );
    }

    // ============================================================================
    // MARGIN CALCULATION
    // ============================================================================

    /// Calculate available margin for placing new orders
    ///
    /// # Parameters
    /// - `balance_sheet`: The account's collateral balance sheet
    /// - `account`: The account address
    ///
    /// # Returns
    /// Available margin in quote units (USDC)
    ///
    /// # Formula
    /// available = free_collateral - pending_order_margin
    /// If pending_order_margin >= free_collateral, returns 0
    friend fun available_order_margin(
        balance_sheet: &collateral_balance_sheet::CollateralBalanceSheet,
        account: address
    ): u64 {
        // Get margin already reserved for pending orders
        let pending_margin = pending_order_tracker::get_pending_order_margin(account);

        // Calculate free collateral
        let free_collateral = perp_positions::free_collateral_for_crossed(
            balance_sheet,
            account,
            0i64  // No simulated PnL
        );

        // Return available margin (clamped to 0)
        if (pending_margin >= free_collateral) {
            return 0
        };

        free_collateral - pending_margin
    }
}
