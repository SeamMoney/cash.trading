/// ============================================================================
/// OPEN INTEREST TRACKER - Market Position Limits
/// ============================================================================
///
/// This module tracks and enforces open interest limits for perpetual markets.
/// Open interest represents the total size of all outstanding positions and
/// is used to control market exposure and risk.
///
/// KEY CONCEPTS:
///
/// 1. OPEN INTEREST:
///    The sum of all long (or short) position sizes in a market.
///    Since every long has a matching short, long OI = short OI.
///
/// 2. MAX OPEN INTEREST:
///    A hard limit on total position size denominated in the base asset.
///    This prevents the market from growing too large relative to liquidity.
///
/// 3. MAX NOTIONAL OPEN INTEREST:
///    A limit on total position value in USD terms.
///    This provides a price-adjusted limit that scales with market value.
///
/// LIMIT CALCULATION:
///
/// The effective limit is the MINIMUM of:
/// - max_open_interest (in base units)
/// - max_notional_open_interest / mark_price * size_multiplier
///
/// This ensures both absolute size and USD value limits are respected.
///
/// ============================================================================

module decibel::open_interest_tracker {
    use std::object;
    use std::math64;
    use std::event;

    use decibel::perp_market;
    use decibel::perp_market_config;
    use decibel::price_management;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::clearinghouse_perp;
    friend decibel::perp_engine;

    // ============================================================================
    // EVENTS
    // ============================================================================

    /// Event emitted when open interest changes
    enum OpenInterestUpdateEvent has drop, store {
        V1 {
            /// The market where OI changed
            market: object::Object<perp_market::PerpMarket>,
            /// New current open interest value
            current_open_interest: u64,
        }
    }

    // ============================================================================
    // CORE STRUCTURE
    // ============================================================================

    /// Open interest tracker stored per market
    enum OpenInterestTracker has key {
        V1 {
            /// Maximum open interest in base units
            max_open_interest: u64,
            /// Current total open interest
            current_open_interest: u64,
            /// Maximum open interest in notional (USD) terms
            max_notional_open_interest: u64,
        }
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Register open interest tracker for a new market
    ///
    /// # Parameters
    /// - `market_signer`: Signer for the market object
    /// - `max_oi`: Initial maximum open interest limit
    friend fun register_open_interest_tracker(
        market_signer: &signer,
        max_oi: u64
    ) {
        let tracker = OpenInterestTracker::V1 {
            max_open_interest: max_oi,
            current_open_interest: 0,
            max_notional_open_interest: 18446744073709551615, // MAX_U64
        };
        move_to<OpenInterestTracker>(market_signer, tracker);
    }

    // ============================================================================
    // GETTERS
    // ============================================================================

    /// Get current open interest for a market
    friend fun get_current_open_interest(
        market: object::Object<perp_market::PerpMarket>
    ): u64 acquires OpenInterestTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        *&borrow_global<OpenInterestTracker>(market_addr).current_open_interest
    }

    /// Get maximum open interest limit (in base units)
    friend fun get_max_open_interest(
        market: object::Object<perp_market::PerpMarket>
    ): u64 acquires OpenInterestTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        *&borrow_global<OpenInterestTracker>(market_addr).max_open_interest
    }

    /// Get maximum notional open interest limit (in USD)
    friend fun get_max_notional_open_interest(
        market: object::Object<perp_market::PerpMarket>
    ): u64 acquires OpenInterestTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        *&borrow_global<OpenInterestTracker>(market_addr).max_notional_open_interest
    }

    /// Get maximum additional open interest that can be added
    ///
    /// Calculates the effective limit considering both base and notional limits,
    /// then subtracts current open interest to get available capacity.
    ///
    /// # Returns
    /// Maximum additional position size that can be opened (in base units)
    friend fun get_max_open_interest_delta_for_market(
        market: object::Object<perp_market::PerpMarket>
    ): u64 acquires OpenInterestTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let tracker = borrow_global<OpenInterestTracker>(market_addr);

        let mark_price = price_management::get_mark_price(market);
        let size_multiplier = perp_market_config::get_size_multiplier(market);

        // Calculate effective limit
        let effective_limit: u64;
        if (mark_price == 0) {
            // If no price, use base limit
            effective_limit = *&tracker.max_open_interest;
        } else {
            // Calculate notional limit in base units:
            // notional_limit_base = max_notional * size_multiplier / mark_price
            let notional_u128 = (*&tracker.max_notional_open_interest) as u128;
            let multiplier_u128 = size_multiplier as u128;
            let numerator = notional_u128 * multiplier_u128;
            let price_u128 = mark_price as u128;
            let notional_in_base = numerator / price_u128;

            // Check for overflow
            if (notional_in_base > 18446744073709551615u128) {
                effective_limit = *&tracker.max_open_interest;
            } else {
                // Take minimum of base limit and notional-derived limit
                let base_limit = *&tracker.max_open_interest;
                let notional_limit = notional_in_base as u64;
                effective_limit = math64::min(base_limit, notional_limit);
            };
        };

        // Return remaining capacity
        if (*&tracker.current_open_interest >= effective_limit) {
            return 0
        };

        effective_limit - *&tracker.current_open_interest
    }

    // ============================================================================
    // SETTERS
    // ============================================================================

    /// Set maximum open interest limit (in base units)
    friend fun set_max_open_interest(
        market: object::Object<perp_market::PerpMarket>,
        new_max: u64
    ) acquires OpenInterestTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let max_ref = &mut borrow_global_mut<OpenInterestTracker>(market_addr).max_open_interest;
        *max_ref = new_max;
    }

    /// Set maximum notional open interest limit (in USD)
    friend fun set_max_notional_open_interest(
        market: object::Object<perp_market::PerpMarket>,
        new_max: u64
    ) acquires OpenInterestTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let max_ref = &mut borrow_global_mut<OpenInterestTracker>(market_addr).max_notional_open_interest;
        *max_ref = new_max;
    }

    // ============================================================================
    // OPEN INTEREST UPDATES
    // ============================================================================

    /// Update open interest by a delta amount
    ///
    /// # Parameters
    /// - `market`: The perpetual market
    /// - `delta`: Change in open interest (positive for increase, negative for decrease)
    ///
    /// # Aborts
    /// - If delta would make open interest negative
    friend fun mark_open_interest_delta_for_market(
        market: object::Object<perp_market::PerpMarket>,
        delta: i64
    ) acquires OpenInterestTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let tracker = borrow_global_mut<OpenInterestTracker>(market_addr);

        if (delta >= 0i64) {
            // Increasing open interest
            let increase = delta as u64;
            let oi_ref = &mut tracker.current_open_interest;
            *oi_ref = *oi_ref + increase;
        } else {
            // Decreasing open interest
            let decrease = (-delta) as u64;
            if (*&tracker.current_open_interest >= decrease) {
                let oi_ref = &mut tracker.current_open_interest;
                *oi_ref = *oi_ref - decrease;
            } else {
                // Can't go negative
                abort 0
            };
        };

        // Emit update event
        let new_oi = *&tracker.current_open_interest;
        event::emit<OpenInterestUpdateEvent>(OpenInterestUpdateEvent::V1 {
            market,
            current_open_interest: new_oi,
        });
    }
}
