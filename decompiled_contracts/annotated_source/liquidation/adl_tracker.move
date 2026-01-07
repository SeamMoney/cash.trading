/// ============================================================================
/// ADL TRACKER - Auto-Deleveraging Position Tracking
/// ============================================================================
///
/// This module implements the Auto-Deleveraging (ADL) system that tracks
/// positions by their profitability and leverage. When the backstop liquidator
/// accumulates too much loss, ADL is triggered to close profitable positions
/// from opposing traders to cover the deficit.
///
/// KEY CONCEPTS:
///
/// 1. LEVERAGE BUCKETS:
///    Positions are organized into buckets based on their leverage level:
///    - Bucket 0: <= 1x leverage
///    - Bucket 1: <= 2x leverage
///    - Bucket 2: <= 4x leverage
///    - Bucket 3: <= 8x leverage
///    - Bucket 4: <= 16x leverage
///    - Bucket 5: <= 32x leverage
///    - Bucket 6: <= 64x leverage
///    - Bucket 7: > 64x leverage
///
/// 2. ADL PRIORITY:
///    Within each bucket, positions are ordered by their ADL key:
///    - Entry price (for profit calculation)
///    - Account address (for uniqueness)
///
///    The most profitable positions at highest leverage are ADL'd first.
///
/// 3. PROFIT SCORE:
///    score = (price_delta * leverage * 1_000_000) / entry_price
///    - Long positions: price_delta = current_price - entry_price
///    - Short positions: price_delta = entry_price - current_price
///
/// WHY ADL EXISTS:
///
/// When a position is liquidated but the account has insufficient margin:
/// 1. The backstop liquidator absorbs the position
/// 2. If backstop losses exceed a threshold, ADL is triggered
/// 3. Profitable opposing positions are forcibly closed at mark price
/// 4. This ensures the system remains solvent
///
/// ============================================================================

module decibel::adl_tracker {
    use std::vector;
    use std::big_ordered_map;
    use std::object;

    use decibel::perp_market;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::perp_positions;
    friend decibel::liquidation;
    friend decibel::perp_engine;

    // ============================================================================
    // CONSTANTS
    // ============================================================================

    /// Default leverage bucket cutoffs
    const LEVERAGE_CUTOFFS: vector<u8> = vector[1, 2, 4, 8, 16, 32, 64];

    /// Multiplier for profit score calculation
    const PROFIT_SCORE_MULTIPLIER: u64 = 1000000;

    // ============================================================================
    // CORE STRUCTURES
    // ============================================================================

    /// Key for identifying a position in the ADL queue
    /// Ordered by entry_px for profit calculation, then by account for uniqueness
    struct ADLKey has copy, drop, store {
        /// Entry price of the position
        entry_px: u64,
        /// Account address owning the position
        account: address,
    }

    /// Value stored for each position
    struct ADLValue has copy, drop, store {
        /// Current leverage of the position (as u8)
        leverage: u8,
    }

    /// Buckets for organizing positions by leverage
    struct LeverageBuckets has store {
        /// Vector of ordered maps, one per leverage bucket
        /// Each map contains positions ordered by ADLKey
        buckets: vector<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>,
        /// Leverage cutoffs for each bucket
        cutoffs: vector<u8>,
    }

    /// Global ADL tracker stored per market
    enum ADLTracker has key {
        V1 {
            /// Positions in long direction
            long_positions: LeverageBuckets,
            /// Positions in short direction
            short_positions: LeverageBuckets,
        }
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Initialize ADL tracker for a market
    ///
    /// Creates leverage buckets with default cutoffs [1, 2, 4, 8, 16, 32, 64]
    friend fun initialize(market_signer: &signer) {
        let long_buckets = new_leverage_buckets_with_cutoffs(
            vector[1u8, 2u8, 4u8, 8u8, 16u8, 32u8, 64u8]
        );
        let short_buckets = new_leverage_buckets_with_cutoffs(
            vector[1u8, 2u8, 4u8, 8u8, 16u8, 32u8, 64u8]
        );
        let tracker = ADLTracker::V1 {
            long_positions: long_buckets,
            short_positions: short_buckets,
        };
        move_to<ADLTracker>(market_signer, tracker);
    }

    /// Create new leverage buckets with specified cutoffs
    ///
    /// Creates (cutoffs.length + 1) buckets:
    /// - Bucket 0: leverage <= cutoffs[0]
    /// - Bucket 1: leverage <= cutoffs[1]
    /// - ...
    /// - Bucket N: leverage > cutoffs[N-1]
    fun new_leverage_buckets_with_cutoffs(cutoffs: vector<u8>): LeverageBuckets {
        let num_cutoffs = vector::length<u8>(&cutoffs);
        let buckets = vector::empty<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>();

        // Create (num_cutoffs + 1) buckets
        let i = 0;
        let started = false;
        let num_buckets = num_cutoffs + 1;

        loop {
            if (started) {
                i = i + 1;
            } else {
                started = true;
            };
            if (!(i < num_buckets)) break;

            let bucket = big_ordered_map::new<ADLKey, ADLValue>();
            vector::push_back<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>(
                &mut buckets,
                bucket
            );
        };

        LeverageBuckets {
            buckets,
            cutoffs,
        }
    }

    // ============================================================================
    // POSITION MANAGEMENT
    // ============================================================================

    /// Add a position to the ADL tracker
    ///
    /// # Parameters
    /// - `market`: The perpetual market
    /// - `account`: The account address
    /// - `is_long`: Whether the position is long
    /// - `entry_px`: Entry price of the position
    /// - `leverage`: Leverage of the position
    friend fun add_position(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        is_long: bool,
        entry_px: u64,
        leverage: u8
    ) acquires ADLTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let tracker = borrow_global_mut<ADLTracker>(market_addr);

        let key = ADLKey { entry_px, account };
        let value = ADLValue { leverage };

        let bucket_idx: u64;
        let bucket_ref: &mut big_ordered_map::BigOrderedMap<ADLKey, ADLValue>;

        if (is_long) {
            bucket_idx = get_bucket_index(&tracker.long_positions, leverage);
            bucket_ref = vector::borrow_mut<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>(
                &mut (&mut tracker.long_positions).buckets,
                bucket_idx
            );
        } else {
            bucket_idx = get_bucket_index(&tracker.short_positions, leverage);
            bucket_ref = vector::borrow_mut<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>(
                &mut (&mut tracker.short_positions).buckets,
                bucket_idx
            );
        };

        big_ordered_map::add<ADLKey, ADLValue>(bucket_ref, key, value);
    }

    /// Remove a position from the ADL tracker
    ///
    /// # Parameters
    /// - `market`: The perpetual market
    /// - `account`: The account address
    /// - `is_long`: Whether the position is long
    /// - `entry_px`: Entry price of the position
    /// - `leverage`: Leverage of the position
    friend fun remove_position(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        is_long: bool,
        entry_px: u64,
        leverage: u8
    ) acquires ADLTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let tracker = borrow_global_mut<ADLTracker>(market_addr);

        let key = ADLKey { entry_px, account };

        let bucket_idx: u64;
        let bucket_ref: &mut big_ordered_map::BigOrderedMap<ADLKey, ADLValue>;

        if (is_long) {
            bucket_idx = get_bucket_index(&tracker.long_positions, leverage);
            bucket_ref = vector::borrow_mut<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>(
                &mut (&mut tracker.long_positions).buckets,
                bucket_idx
            );
        } else {
            bucket_idx = get_bucket_index(&tracker.short_positions, leverage);
            bucket_ref = vector::borrow_mut<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>(
                &mut (&mut tracker.short_positions).buckets,
                bucket_idx
            );
        };

        let _removed = big_ordered_map::remove<ADLKey, ADLValue>(bucket_ref, &key);
    }

    // ============================================================================
    // ADL SELECTION
    // ============================================================================

    /// Get the next account to be ADL'd
    ///
    /// Finds the most profitable position in the opposing direction.
    /// For longs being ADL'd, finds most profitable shorts (and vice versa).
    ///
    /// # Parameters
    /// - `market`: The perpetual market
    /// - `is_long`: Direction of the backstop position (find opposing positions)
    /// - `current_price`: Current mark price for profit calculation
    ///
    /// # Returns
    /// Address of the account with highest ADL priority (most profitable + highest leverage)
    ///
    /// # ADL Priority Score Calculation
    /// For longs: score = (current_price - entry_px) * leverage * 1M / entry_px
    /// For shorts: score = (entry_px - current_price) * leverage * 1M / entry_px
    friend fun get_next_adl_address(
        market: object::Object<perp_market::PerpMarket>,
        is_long: bool,
        current_price: u64
    ): address acquires ADLTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let tracker = borrow_global<ADLTracker>(market_addr);

        // Get the appropriate side's positions
        let buckets: &LeverageBuckets;
        if (is_long) {
            buckets = &tracker.long_positions;
        } else {
            buckets = &tracker.short_positions;
        };

        // Find position with highest profit score
        let best_score: i64 = -9223372036854775808i64; // MIN_I64
        let best_account: address = @0x0;
        let found_any = false;

        let num_buckets = vector::length<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>(&buckets.buckets);
        let bucket_idx: u64 = 0;
        let started = false;

        loop {
            if (started) {
                bucket_idx = bucket_idx + 1;
            } else {
                started = true;
            };
            if (!(bucket_idx < num_buckets)) break;

            let bucket = vector::borrow<big_ordered_map::BigOrderedMap<ADLKey, ADLValue>>(
                &buckets.buckets,
                bucket_idx
            );

            // Skip empty buckets
            if (big_ordered_map::is_empty<ADLKey, ADLValue>(bucket)) {
                continue
            };

            // Get the most extreme position in this bucket
            // For longs: get front (lowest entry price = highest profit at current higher price)
            // For shorts: get back (highest entry price = highest profit at current lower price)
            let key: &ADLKey;
            let value: &ADLValue;

            if (is_long) {
                let (k, v) = big_ordered_map::borrow_front<ADLKey, ADLValue>(bucket);
                key = k;
                value = v;
            } else {
                let (k, v) = big_ordered_map::borrow_back<ADLKey, ADLValue>(bucket);
                key = k;
                value = v;
            };

            // Calculate profit score
            let price_delta: i64;
            if (is_long) {
                // Long profit: current_price - entry_price
                let current_i64 = current_price as i64;
                let entry_i64 = (*&key.entry_px) as i64;
                price_delta = current_i64 - entry_i64;
            } else {
                // Short profit: entry_price - current_price
                let entry_i64 = (*&key.entry_px) as i64;
                let current_i64 = current_price as i64;
                price_delta = entry_i64 - current_i64;
            };

            // Score = price_delta * leverage * 1M / entry_price
            let leverage_scaled = ((*&value.leverage) as u64) * PROFIT_SCORE_MULTIPLIER;
            let entry_px = *&key.entry_px;
            if (!(entry_px != 0)) {
                abort 4
            };

            let delta_i128 = price_delta as i128;
            let leverage_i128 = leverage_scaled as i128;
            let numerator = delta_i128 * leverage_i128;
            let entry_i128 = entry_px as i128;
            let score = (numerator / entry_i128) as i64;

            // Update best if this score is higher (or first found)
            let should_update: bool;
            if (found_any) {
                should_update = score >= best_score;
            } else {
                should_update = true;
            };

            if (should_update) {
                best_score = score;
                best_account = *&key.account;
                found_any = true;
            };
        };

        best_account
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    /// Get the bucket index for a given leverage
    ///
    /// # Parameters
    /// - `buckets`: The leverage buckets structure
    /// - `leverage`: The leverage to find bucket for
    ///
    /// # Returns
    /// Index of the appropriate bucket
    fun get_bucket_index(buckets: &LeverageBuckets, leverage: u8): u64 {
        let num_cutoffs = vector::length<u8>(&buckets.cutoffs);
        let i: u64 = 0;
        let started = false;

        loop {
            if (started) {
                i = i + 1;
            } else {
                started = true;
            };
            if (!(i < num_cutoffs)) break;

            let cutoff = *vector::borrow<u8>(&buckets.cutoffs, i);
            if (leverage <= cutoff) {
                return i
            };
        };

        // Leverage exceeds all cutoffs, return last bucket
        num_cutoffs
    }
}
