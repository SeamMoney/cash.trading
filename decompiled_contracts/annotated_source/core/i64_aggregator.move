/// ============================================================================
/// Module: i64_aggregator
/// Description: Signed 64-bit aggregator using Aptos aggregator_v2
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module provides signed 64-bit integer aggregators built on top of
/// Aptos's unsigned aggregator_v2. It uses an offset technique where:
///
///   stored_value = actual_value + 2^63 (9223372036854775808)
///
/// This maps the signed i64 range [-2^63, 2^63-1] to unsigned [0, 2^64-1].
///
/// Used for:
/// - Collateral balance tracking (can go negative with unrealized losses)
/// - Position PnL (can be positive or negative)
/// - Funding payments (bidirectional)
///
/// Benefits of aggregators:
/// - Parallelizable updates (no read-modify-write conflicts)
/// - Efficient for high-frequency updates
/// - Snapshot capability for consistent reads
/// ============================================================================

module decibel::i64_aggregator {
    use aptos_framework::aggregator_v2::{Self, Aggregator, AggregatorSnapshot};

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// Offset to convert signed to unsigned: 2^63
    /// This is the "zero point" - actual 0 is stored as this value
    const I64_OFFSET: u64 = 9223372036854775808;
    const I64_OFFSET_I128: i128 = 9223372036854775808i128;

    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================

    /// Collateral balance sheet needs signed math for balance tracking
    friend decibel::collateral_balance_sheet;

    /// Position tracking needs signed for PnL calculations
    friend decibel::perp_positions;

    // =========================================================================
    // TYPES
    // =========================================================================

    /// Signed 64-bit aggregator
    /// Internally stores value + 2^63 in an unsigned aggregator
    enum I64Aggregator has drop, store {
        V1 {
            /// The underlying unsigned aggregator
            /// Value stored = actual_i64_value + 2^63
            offset_balance: Aggregator<u64>,
        }
    }

    /// Snapshot of a signed aggregator at a point in time
    /// Used for consistent reads across multiple values
    enum I64Snapshot has drop, store {
        V1 {
            offset_balance: AggregatorSnapshot<u64>,
        }
    }

    // =========================================================================
    // FRIEND FUNCTIONS
    // =========================================================================

    /// Adds a signed value to the aggregator
    ///
    /// # Arguments
    /// * `aggregator` - The aggregator to modify
    /// * `delta` - Signed value to add (can be negative)
    ///
    /// # Logic
    /// - If delta >= 0: add to underlying (value increases)
    /// - If delta < 0: subtract |delta| from underlying (value decreases)
    friend fun add(aggregator: &mut I64Aggregator, delta: i64) {
        if (delta >= 0i64) {
            // Positive delta: add to underlying
            let unsigned_delta = delta as u64;
            aggregator_v2::add(&mut aggregator.offset_balance, unsigned_delta);
        } else {
            // Negative delta: subtract absolute value from underlying
            let unsigned_delta = (-delta) as u64;
            aggregator_v2::sub(&mut aggregator.offset_balance, unsigned_delta);
        }
    }

    /// Reads the current signed value from the aggregator
    ///
    /// # Arguments
    /// * `aggregator` - The aggregator to read
    ///
    /// # Returns
    /// The current signed i64 value
    ///
    /// # Logic
    /// stored_u64 - 2^63 = actual_i64
    /// Uses i128 intermediate to handle the range correctly
    friend fun read(aggregator: &I64Aggregator): i64 {
        let stored_value = aggregator_v2::read(&aggregator.offset_balance);
        let stored_i128 = stored_value as i128;
        let actual_i128 = stored_i128 - I64_OFFSET_I128;
        actual_i128 as i64
    }

    /// Creates a snapshot of the current value
    ///
    /// Snapshots provide a consistent view of the value at a point in time,
    /// useful for calculations that need multiple consistent reads.
    ///
    /// # Arguments
    /// * `aggregator` - The aggregator to snapshot
    ///
    /// # Returns
    /// I64Snapshot that can be read later
    friend fun snapshot(aggregator: &I64Aggregator): I64Snapshot {
        I64Snapshot::V1 {
            offset_balance: aggregator_v2::snapshot(&aggregator.offset_balance)
        }
    }

    /// Checks if aggregator value is at least the given threshold
    ///
    /// Useful for margin checks (e.g., "is balance >= required margin")
    ///
    /// # Arguments
    /// * `aggregator` - The aggregator to check
    /// * `threshold` - Minimum required signed value
    ///
    /// # Returns
    /// True if current value >= threshold
    friend fun is_at_least(aggregator: &I64Aggregator, threshold: i64): bool {
        // Convert threshold to offset representation
        let threshold_i128 = threshold as i128;
        let offset_threshold = (threshold_i128 + I64_OFFSET_I128) as u64;
        aggregator_v2::is_at_least(&aggregator.offset_balance, offset_threshold)
    }

    /// Creates a snapshot with a specific signed value
    ///
    /// Used for creating snapshots directly without an aggregator
    ///
    /// # Arguments
    /// * `value` - The signed value for the snapshot
    ///
    /// # Returns
    /// I64Snapshot containing the value
    friend fun create_i64_snapshot(value: i64): I64Snapshot {
        let value_i128 = value as i128;
        let offset_value = (value_i128 + I64_OFFSET_I128) as u64;
        I64Snapshot::V1 {
            offset_balance: aggregator_v2::create_snapshot(offset_value)
        }
    }

    /// Creates a new aggregator initialized to zero
    ///
    /// # Returns
    /// New I64Aggregator with value 0
    friend fun new_i64_aggregator(): I64Aggregator {
        // Initialize underlying with offset (representing 0)
        I64Aggregator::V1 {
            offset_balance: aggregator_v2::create_unbounded_aggregator_with_value(I64_OFFSET)
        }
    }

    /// Creates a new aggregator with initial signed value
    ///
    /// # Arguments
    /// * `initial_value` - Starting signed value
    ///
    /// # Returns
    /// New I64Aggregator initialized to the given value
    friend fun new_i64_aggregator_with_value(initial_value: i64): I64Aggregator {
        let value_i128 = initial_value as i128;
        let offset_value = (value_i128 + I64_OFFSET_I128) as u64;
        I64Aggregator::V1 {
            offset_balance: aggregator_v2::create_unbounded_aggregator_with_value(offset_value)
        }
    }
}
