/// ============================================================================
/// Module: decibel_time
/// Description: Time management with optional override for testing
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module provides a centralized time source that can be overridden
/// for testing purposes. In production, it returns the actual blockchain
/// timestamp. In testing, admins can set a specific time.
///
/// Used by:
/// - Price management (staleness checks)
/// - Async matching engine (order timestamps)
/// - Admin operations (time-based logic)
/// ============================================================================

module decibel::decibel_time {
    use std::option::{Self, Option};
    use aptos_framework::timestamp;
    use std::signer;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// Contract address for permission checks
    const DECIBEL_ADDRESS: address = @0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844;

    /// Microseconds per second
    const MICROSECONDS_PER_SECOND: u64 = 1_000_000;

    /// Error: Unauthorized caller
    const E_UNAUTHORIZED: u64 = 0;

    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================

    friend decibel::price_management;
    friend decibel::async_matching_engine;
    friend decibel::admin_apis;

    // =========================================================================
    // RESOURCES
    // =========================================================================

    /// Stores optional time override for testing
    /// When time_us is Some, that value is used instead of real time
    enum TimeOverride has key {
        V1 {
            time_us: Option<u64>,   // Optional override timestamp in microseconds
        }
    }

    // =========================================================================
    // FRIEND FUNCTIONS
    // =========================================================================

    /// Returns current time in microseconds
    /// Uses override if set, otherwise returns actual blockchain time
    ///
    /// # Returns
    /// Current timestamp in microseconds
    friend fun now_microseconds(): u64 acquires TimeOverride {
        // Check if override exists and is set
        if (exists<TimeOverride>(DECIBEL_ADDRESS)) {
            let time_override = borrow_global<TimeOverride>(DECIBEL_ADDRESS);
            if (option::is_some(&time_override.time_us)) {
                return *option::borrow(&time_override.time_us)
            }
        };

        // No override - use actual blockchain time
        timestamp::now_microseconds()
    }

    /// Increments the time override by 1 microsecond
    /// Used in testing to advance time slightly
    ///
    /// # Arguments
    /// * `admin` - Must be the contract admin
    friend fun increment_time(admin: &signer) acquires TimeOverride {
        // Only contract admin can modify time
        assert!(signer::address_of(admin) == DECIBEL_ADDRESS, E_UNAUTHORIZED);

        // Set override to current time + 1 microsecond
        let new_time = option::some(now_microseconds() + 1);
        let time_override_mut = &mut borrow_global_mut<TimeOverride>(DECIBEL_ADDRESS).time_us;
        *time_override_mut = new_time;
    }

    // =========================================================================
    // PUBLIC FUNCTIONS
    // =========================================================================

    /// Returns current time in seconds
    /// Convenience wrapper that converts microseconds to seconds
    ///
    /// # Returns
    /// Current timestamp in seconds
    public fun now_seconds(): u64 acquires TimeOverride {
        now_microseconds() / MICROSECONDS_PER_SECOND
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /// Module initializer - creates the TimeOverride resource
    /// Called automatically when module is published
    fun init_module(deployer: &signer) {
        // Only the contract deployer can initialize
        assert!(signer::address_of(deployer) == DECIBEL_ADDRESS, E_UNAUTHORIZED);

        // Create with no override (use real time by default)
        let time_override = TimeOverride::V1 {
            time_us: option::none<u64>()
        };
        move_to(deployer, time_override);
    }
}
