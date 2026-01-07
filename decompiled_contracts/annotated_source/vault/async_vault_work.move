/// ============================================================================
/// ASYNC VAULT WORK - Vault Background Work Processing
/// ============================================================================
///
/// This module handles asynchronous vault operations, particularly redemptions
/// that require closing open positions. It implements a state machine for
/// managing the position closing and redemption completion process.
///
/// STATE MACHINE:
/// 1. ProcessRedemptions: Try to complete pending redemptions immediately
/// 2. PlacingOrdersToClosePositions: Place reduce-only orders to close positions
/// 3. WaitingForOrdersToFill: Wait for orders to fill (with 30s timeout)
///
/// REDEMPTION FLOW:
/// 1. User requests redemption -> shares locked
/// 2. Try sync redemption (if allowed and funds available)
/// 3. If not possible, queue async work
/// 4. Async work closes positions incrementally
/// 5. Once funds available, complete redemption
///
/// ORDER TIMEOUT:
/// - Orders have 30 second timeout
/// - After timeout, orders are cancelled and re-placed
/// - Prevents stuck orders from blocking redemptions
///
/// ============================================================================

module decibel::async_vault_work {
    use std::big_ordered_map;
    use std::object;
    use std::vector;
    use std::option;
    use std::transaction_context;

    use decibel::perp_market;
    use decibel::vault;
    use decibel::perp_engine;
    use decibel::position_view_types;
    use decibel::decibel_time;
    use econia::order_book_types;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::vault_api;

    // ============================================================================
    // CONSTANTS
    // ============================================================================

    /// Timeout for waiting on order fills (30 seconds)
    const ORDER_FILL_TIMEOUT_S: u64 = 30;

    /// Delay for async work re-queuing when orders are placed (1 second in microseconds)
    const REQUEUE_DELAY_US: u64 = 1000000;

    // ============================================================================
    // CORE STRUCTURES
    // ============================================================================

    /// Per-vault async work state
    enum AsyncVaultWork has key {
        V1 {
            /// Whether synchronous redemptions are allowed
            allow_sync_redemptions: bool,
            /// Total shares pending redemption
            total_pending_redemptions: u64,
            /// Queue of pending redemption requests (ordered by counter)
            pending_redemptions: big_ordered_map::BigOrderedMap<u128, RedemptionRequest>,
            /// Current state of position closing process
            orders_state: ClosingPositionsState,
        }
    }

    /// A pending redemption request
    struct RedemptionRequest has copy, drop, store {
        /// User requesting redemption
        user: address,
        /// Number of shares to redeem
        shares: u64,
        /// Whether to deposit redeemed assets to DEX
        deposit_to_dex: bool,
    }

    /// State machine for closing positions
    enum ClosingPositionsState has copy, drop, store {
        /// Normal state - try to process redemptions
        ProcessRedemptions,

        /// Actively placing orders to close positions
        PlacingOrdersToClosePositions {
            /// Remaining subaccounts to process
            remaining_subaccounts_to_close: vector<address>,
            /// Current subaccount being processed
            cur_subaccount: address,
            /// Remaining markets to close on current subaccount
            cur_markets_to_close: vector<object::Object<perp_market::PerpMarket>>,
            /// Active closing orders
            active_orders: vector<vault::OrderRef>,
        },

        /// Waiting for previously placed orders to fill
        WaitingForOrdersToFill {
            /// When orders were placed (for timeout)
            time_orders_placed: u64,
            /// Active orders being waited on
            active_orders: vector<vault::OrderRef>,
        }
    }

    // ============================================================================
    // ORDER MANAGEMENT
    // ============================================================================

    /// Cancel all active orders (on timeout)
    fun cancel_all_active_orders(
        vault: object::Object<vault::Vault>,
        active_orders: &mut vector<vault::OrderRef>,
        remaining_iterations: &mut u32
    ) {
        loop {
            let should_continue = vector::length<vault::OrderRef>(active_orders) > 0
                && *remaining_iterations > 0u32;

            if (!should_continue) {
                break
            };

            let order_ref = vector::pop_back<vault::OrderRef>(active_orders);
            let market = vault::get_order_ref_market(&order_ref);
            let order_id = vault::get_order_ref_order_id(&order_ref);

            vault::cancel_force_closing_order(vault, market, order_id);

            *remaining_iterations = *remaining_iterations - 1u32;
        };
    }

    /// Remove completed orders from active list
    fun clean_completed_orders(
        active_orders: &mut vector<vault::OrderRef>,
        remaining_iterations: &mut u32
    ) {
        *remaining_iterations = *remaining_iterations - 1u32;

        let i = 0;
        loop {
            let len = vector::length<vault::OrderRef>(active_orders);
            if (!(i < len)) {
                break
            };

            let order_ref = vector::borrow<vault::OrderRef>(active_orders, i);
            let market = vault::get_order_ref_market(order_ref);
            let order_id = vault::get_order_ref_order_id(order_ref);

            // Check if order is still active
            let remaining_size = perp_market::get_remaining_size(market, order_id);

            if (remaining_size > 0) {
                // Order still active, keep it
                i = i + 1;
            } else {
                // Order complete, remove from list
                vector::swap_remove<vault::OrderRef>(active_orders, i);
                // Don't increment i since we swapped in a new element
            };
        };
    }

    // ============================================================================
    // POSITION CLOSING
    // ============================================================================

    /// Prepare to close positions for a vault
    ///
    /// Gets all subaccounts and their positions, sets up state for closing.
    fun prepare_closing_positions(vault: object::Object<vault::Vault>): ClosingPositionsState {
        // Get vault's subaccounts
        let mut_subaccounts = vault::get_vault_portfolio_subaccounts(vault);
        let current_subaccount = vector::pop_back<address>(&mut mut_subaccounts);

        // Get positions for current subaccount
        let positions = perp_engine::list_positions(current_subaccount);

        // Extract markets from positions
        let markets_to_close = vector::empty<object::Object<perp_market::PerpMarket>>();

        // Process positions in reverse order
        vector::reverse<position_view_types::PositionViewInfo>(&mut positions);
        let num_positions = vector::length<position_view_types::PositionViewInfo>(&positions);

        while (num_positions > 0) {
            let position = vector::pop_back<position_view_types::PositionViewInfo>(&mut positions);
            let market = position_view_types::get_position_info_market(&position);
            vector::push_back<object::Object<perp_market::PerpMarket>>(&mut markets_to_close, market);
            num_positions = num_positions - 1;
        };

        vector::destroy_empty<position_view_types::PositionViewInfo>(positions);

        ClosingPositionsState::PlacingOrdersToClosePositions {
            remaining_subaccounts_to_close: mut_subaccounts,
            cur_subaccount: current_subaccount,
            cur_markets_to_close: markets_to_close,
            active_orders: vector::empty<vault::OrderRef>(),
        }
    }

    /// Process position closing state machine step
    ///
    /// Places orders to close positions incrementally.
    fun process_closing_positions(
        vault: object::Object<vault::Vault>,
        remaining_subaccounts: vector<address>,
        current_subaccount: address,
        markets_to_close: vector<object::Object<perp_market::PerpMarket>>,
        active_orders: vector<vault::OrderRef>,
        remaining_iterations: &mut u32
    ): ClosingPositionsState {
        let mut_subaccounts = remaining_subaccounts;
        let mut_markets = markets_to_close;
        let mut_orders = active_orders;

        loop {
            // Check if we should continue
            if (!(*remaining_iterations > 0u32)) {
                // Out of iterations, save state and return
                return ClosingPositionsState::PlacingOrdersToClosePositions {
                    remaining_subaccounts_to_close: mut_subaccounts,
                    cur_subaccount: current_subaccount,
                    cur_markets_to_close: mut_markets,
                    active_orders: mut_orders,
                }
            };

            *remaining_iterations = *remaining_iterations - 1u32;

            // Place order for next market if any
            if (!vector::is_empty<object::Object<perp_market::PerpMarket>>(&mut_markets)) {
                let market = vector::pop_back<object::Object<perp_market::PerpMarket>>(&mut mut_markets);

                // Try to place closing order
                let order_opt = vault::place_force_closing_order(vault, current_subaccount, market);
                if (option::is_some<vault::OrderRef>(&order_opt)) {
                    let order_ref = option::destroy_some<vault::OrderRef>(order_opt);
                    vector::push_back<vault::OrderRef>(&mut mut_orders, order_ref);
                };
            };

            // Check if done with current subaccount's markets
            if (!vector::is_empty<object::Object<perp_market::PerpMarket>>(&mut_markets)) {
                // More markets to process
                continue
            };

            // Done with current subaccount, check if more subaccounts
            if (vector::is_empty<address>(&mut_subaccounts)) {
                // All done placing orders, transition to waiting
                return ClosingPositionsState::WaitingForOrdersToFill {
                    time_orders_placed: decibel_time::now_seconds(),
                    active_orders: mut_orders,
                }
            };

            // Move to next subaccount
            let next_subaccount = vector::pop_back<address>(&mut mut_subaccounts);
            let next_positions = perp_engine::list_positions(next_subaccount);

            // Extract markets
            vector::reverse<position_view_types::PositionViewInfo>(&mut next_positions);
            let num_positions = vector::length<position_view_types::PositionViewInfo>(&next_positions);

            while (num_positions > 0) {
                let position = vector::pop_back<position_view_types::PositionViewInfo>(&mut next_positions);
                let market = position_view_types::get_position_info_market(&position);
                vector::push_back<object::Object<perp_market::PerpMarket>>(&mut mut_markets, market);
                num_positions = num_positions - 1;
            };

            vector::destroy_empty<position_view_types::PositionViewInfo>(next_positions);
        }
    }

    // ============================================================================
    // MAIN WORK PROCESSING
    // ============================================================================

    /// Process pending work for a vault
    ///
    /// # Returns
    /// - Some(0): More work to do immediately
    /// - Some(delay_us): Re-queue with delay
    /// - None: All work complete
    public fun process_pending_work(
        vault: object::Object<vault::Vault>,
        remaining_iterations: &mut u32
    ): option::Option<u64> acquires AsyncVaultWork {
        let vault_addr = object::object_address<vault::Vault>(&vault);
        let work = borrow_global_mut<AsyncVaultWork>(vault_addr);

        let current_state = work.orders_state;
        let state_ref = &current_state;

        loop {
            if (state_ref is ProcessRedemptions) {
                let ClosingPositionsState::ProcessRedemptions {} = current_state;

                // Try to complete pending redemptions
                try_complete_redemptions(vault, work, remaining_iterations);

                if (*remaining_iterations == 0u32) {
                    // Out of iterations
                    return option::some<u64>(0)
                };

                if (!(work.total_pending_redemptions > 0)) {
                    // All redemptions complete
                    return option::none<u64>()
                };

                // Need to close positions for remaining redemptions
                let new_state = prepare_closing_positions(vault);
                work.orders_state = new_state;
                return option::some<u64>(0)
            };

            if (state_ref is PlacingOrdersToClosePositions) {
                let ClosingPositionsState::PlacingOrdersToClosePositions {
                    remaining_subaccounts_to_close,
                    cur_subaccount,
                    cur_markets_to_close,
                    active_orders
                } = current_state;

                let next_state = process_closing_positions(
                    vault,
                    remaining_subaccounts_to_close,
                    cur_subaccount,
                    cur_markets_to_close,
                    active_orders,
                    remaining_iterations
                );

                work.orders_state = next_state;

                if (&work.orders_state is WaitingForOrdersToFill) {
                    // Transitioned to waiting - delay before checking
                    return option::some<u64>(REQUEUE_DELAY_US)
                };

                return option::some<u64>(0)
            };

            // WaitingForOrdersToFill state
            assert!(state_ref is WaitingForOrdersToFill, 14566554180833181697);

            let ClosingPositionsState::WaitingForOrdersToFill {
                time_orders_placed,
                active_orders
            } = current_state;

            let mut_orders = active_orders;

            // Clean up completed orders
            clean_completed_orders(&mut mut_orders, remaining_iterations);

            if (vector::length<vault::OrderRef>(&mut_orders) == 0) {
                // All orders filled, go back to processing redemptions
                work.orders_state = ClosingPositionsState::ProcessRedemptions {};
                return option::some<u64>(0)
            };

            // Check for timeout
            let elapsed = decibel_time::now_seconds() - time_orders_placed;
            if (!(elapsed > ORDER_FILL_TIMEOUT_S)) {
                // Not timed out yet, keep waiting
                return option::some<u64>(0)
            };

            // Timeout - cancel remaining orders
            cancel_all_active_orders(vault, &mut mut_orders, remaining_iterations);

            if (vector::length<vault::OrderRef>(&mut_orders) > 0) {
                // Some orders couldn't be cancelled (out of iterations)
                work.orders_state = ClosingPositionsState::WaitingForOrdersToFill {
                    time_orders_placed,
                    active_orders: mut_orders,
                };
                return option::some<u64>(0)
            };

            // All orders cancelled, go back to processing redemptions
            work.orders_state = ClosingPositionsState::ProcessRedemptions {};
            return option::some<u64>(0)
        }
    }

    // ============================================================================
    // REDEMPTION PROCESSING
    // ============================================================================

    /// Try to complete pending redemptions
    fun try_complete_redemptions(
        vault: object::Object<vault::Vault>,
        work: &mut AsyncVaultWork,
        remaining_iterations: &mut u32
    ) {
        loop {
            // Check if we should continue
            let should_continue = work.total_pending_redemptions > 0
                && *remaining_iterations > 0u32;

            if (!should_continue) {
                return
            };

            // Peek at front redemption
            let (key, request) = big_ordered_map::borrow_front<u128, RedemptionRequest>(
                &work.pending_redemptions
            );

            *remaining_iterations = *remaining_iterations - 1u32;

            // Try to complete this redemption
            let success = vault::try_complete_redemption(
                request.user,
                vault,
                request.shares,
                request.deposit_to_dex
            );

            if (!success) {
                // Can't complete - need to close positions
                return
            };

            // Redemption complete - remove from queue
            let shares = request.shares;
            work.total_pending_redemptions = work.total_pending_redemptions - shares;

            big_ordered_map::pop_front<u128, RedemptionRequest>(&mut work.pending_redemptions);
        };
    }

    /// Queue a redemption request
    fun queue_redemption(
        user: address,
        vault: object::Object<vault::Vault>,
        shares: u64,
        deposit_to_dex: bool
    ) acquires AsyncVaultWork {
        let vault_addr = object::object_address<vault::Vault>(&vault);
        let work = borrow_global_mut<AsyncVaultWork>(vault_addr);

        // Update total pending
        work.total_pending_redemptions = work.total_pending_redemptions + shares;

        // Add redemption request
        let counter = transaction_context::monotonically_increasing_counter();
        let request = RedemptionRequest {
            user,
            shares,
            deposit_to_dex,
        };

        big_ordered_map::add<u128, RedemptionRequest>(
            &mut work.pending_redemptions,
            counter,
            request
        );
    }

    // ============================================================================
    // REGISTRATION
    // ============================================================================

    /// Register async work tracking for a new vault
    friend fun register_vault(vault_signer: &signer) {
        let work = AsyncVaultWork::V1 {
            allow_sync_redemptions: true,
            total_pending_redemptions: 0,
            pending_redemptions: big_ordered_map::new<u128, RedemptionRequest>(),
            orders_state: ClosingPositionsState::ProcessRedemptions {},
        };
        move_to<AsyncVaultWork>(vault_signer, work);
    }

    // ============================================================================
    // REDEMPTION REQUESTS
    // ============================================================================

    /// Request a redemption
    ///
    /// # Returns
    /// true if redemption completed immediately, false if queued for async processing
    friend fun request_redemption(
        user: address,
        vault: object::Object<vault::Vault>,
        shares: u64,
        deposit_to_dex: bool
    ): bool acquires AsyncVaultWork {
        // Lock shares for redemption
        vault::lock_for_initated_redemption(user, vault, shares);

        // Try synchronous redemption if allowed
        let sync_success = if (sync_redemption_allowed(vault)) {
            vault::try_complete_redemption(user, vault, shares, deposit_to_dex)
        } else {
            false
        };

        if (sync_success) {
            return true
        };

        // Queue for async processing
        queue_redemption(user, vault, shares, deposit_to_dex);
        false
    }

    /// Check if synchronous redemptions are allowed
    fun sync_redemption_allowed(vault: object::Object<vault::Vault>): bool
        acquires AsyncVaultWork
    {
        let vault_addr = object::object_address<vault::Vault>(&vault);
        let work = borrow_global<AsyncVaultWork>(vault_addr);

        if (work.allow_sync_redemptions) {
            // Only allow sync if no pending async redemptions
            return work.total_pending_redemptions == 0
        };

        false
    }
}
