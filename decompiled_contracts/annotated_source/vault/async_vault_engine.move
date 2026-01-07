/// ============================================================================
/// ASYNC VAULT ENGINE - Asynchronous Vault Request Processing
/// ============================================================================
///
/// This module manages the async processing queue for vault operations.
/// It maintains a priority queue of vault progress requests and processes
/// them in order, handling operations that can't complete synchronously
/// like redemptions that require position closing.
///
/// KEY FEATURES:
/// - Time-ordered request queue using BigOrderedMap
/// - Tracks which vaults have pending requests to avoid duplicates
/// - Processes requests up to a configurable iteration limit
/// - Supports delayed re-queuing for operations needing time
///
/// QUEUE ORDERING:
/// Requests are ordered by (time, tie_breaker) where:
/// - time=0 means process immediately
/// - time>0 means delay until that microsecond timestamp
/// - tie_breaker ensures FIFO ordering for same-time requests
///
/// ============================================================================

module decibel::async_vault_engine {
    use std::object;
    use std::big_ordered_map;
    use std::timestamp;
    use std::option;
    use std::transaction_context;

    use decibel::vault;
    use decibel::async_vault_work;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::vault_api;

    // ============================================================================
    // CORE STRUCTURES
    // ============================================================================

    /// Types of pending vault requests
    enum PendingRequest has copy, drop, store {
        /// Request to progress a vault's async work (redemptions, position closing)
        VaultProgress {
            vault: object::Object<vault::Vault>,
        }
    }

    /// Key for ordering requests in the queue
    /// Ordered by (time, tie_breaker) for priority processing
    struct PendingRequestKey has copy, drop, store {
        /// Target processing time (0 = immediate, else microsecond timestamp)
        time: u64,
        /// Monotonically increasing counter for FIFO tie-breaking
        tie_breaker: u128,
    }

    /// Main async vault engine resource
    enum AsyncVaultEngine has key {
        V1 {
            /// Priority queue of pending requests
            pending_requests: big_ordered_map::BigOrderedMap<PendingRequestKey, PendingRequest>,
            /// Set of vaults with pending requests (prevents duplicates)
            vaults_with_pending_requests: big_ordered_map::BigOrderedMap<object::Object<vault::Vault>, bool>,
        }
    }

    // ============================================================================
    // ERROR CODES
    // ============================================================================

    // Error 1: max_iterations must be > 0
    // Error 2: Request processing time hasn't been reached yet
    // Error 14566554180833181697: Invalid request type

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Initialize async vault engine on module load
    fun init_module(deployer: &signer) {
        register_async_vault_engine(deployer);
    }

    /// Register the async vault engine resource
    friend fun register_async_vault_engine(deployer: &signer) {
        // Create request queue with configuration
        // node_capacity=0 (default), bucket_size=16, auto_clean=true
        let pending_requests = big_ordered_map::new_with_config<PendingRequestKey, PendingRequest>(
            0u16,   // default node capacity
            16u16,  // bucket size
            true    // auto cleanup
        );

        let vaults_with_pending_requests = big_ordered_map::new<object::Object<vault::Vault>, bool>();

        let engine = AsyncVaultEngine::V1 {
            pending_requests,
            vaults_with_pending_requests,
        };
        move_to<AsyncVaultEngine>(deployer, engine);
    }

    // ============================================================================
    // REQUEST PROCESSING
    // ============================================================================

    /// Process pending vault requests
    ///
    /// Processes requests from the queue up to max_iterations.
    /// Requests are processed in priority order (earliest time first).
    ///
    /// # Parameters
    /// - `max_iterations`: Maximum number of operations to perform
    ///
    /// # Processing Flow
    /// 1. Pop front request from queue (if time <= now)
    /// 2. Process the request via async_vault_work
    /// 3. If more work needed, re-queue with delay
    /// 4. If work complete, remove from pending set
    friend fun process_pending_requests(max_iterations: u32)
        acquires AsyncVaultEngine
    {
        let engine = borrow_global_mut<AsyncVaultEngine>(@decibel);
        let current_time = timestamp::now_microseconds();

        assert!(max_iterations > 0u32, 1);

        loop {
            // Check if we should continue processing
            let should_continue = !big_ordered_map::is_empty<PendingRequestKey, PendingRequest>(
                &engine.pending_requests
            ) && max_iterations > 0u32;

            if (!should_continue) {
                break
            };

            // Peek at front request
            let (key, _request) = big_ordered_map::borrow_front<PendingRequestKey, PendingRequest>(
                &engine.pending_requests
            );
            let front_key = key;

            // Only process if time has been reached
            if (front_key.time >= current_time) {
                return  // Not ready yet
            };

            // Pop the request
            let (popped_key, request) = big_ordered_map::pop_front<PendingRequestKey, PendingRequest>(
                &mut engine.pending_requests
            );

            // Verify we got the same key (sanity check)
            assert!(popped_key == front_key, 2);

            // Process based on request type
            if (&request is VaultProgress) {
                let PendingRequest::VaultProgress { vault } = request;

                // Process vault work
                let next_delay = async_vault_work::process_pending_work(vault, &mut max_iterations);

                if (!option::is_some<u64>(&next_delay)) {
                    // Work complete - remove from pending set
                    big_ordered_map::remove<object::Object<vault::Vault>, bool>(
                        &mut engine.vaults_with_pending_requests,
                        &vault
                    );
                } else {
                    // More work needed - re-queue with delay
                    let delay_us = option::destroy_some<u64>(next_delay);
                    let next_time = if (delay_us > 0) {
                        timestamp::now_microseconds() + delay_us
                    } else {
                        0  // Process immediately
                    };

                    let new_key = PendingRequestKey {
                        time: next_time,
                        tie_breaker: transaction_context::monotonically_increasing_counter(),
                    };

                    big_ordered_map::add<PendingRequestKey, PendingRequest>(
                        &mut engine.pending_requests,
                        new_key,
                        PendingRequest::VaultProgress { vault }
                    );
                };
            } else {
                // Unknown request type
                abort 14566554180833181697
            };
        };
    }

    // ============================================================================
    // REQUEST QUEUEING
    // ============================================================================

    /// Queue a vault progress request if not already pending
    ///
    /// This adds a vault to the processing queue. If the vault already
    /// has a pending request, this is a no-op to prevent duplicate work.
    ///
    /// Requests are queued with time=0 for immediate processing.
    friend fun queue_vault_progress_if_needed(vault: object::Object<vault::Vault>)
        acquires AsyncVaultEngine
    {
        let engine = borrow_global_mut<AsyncVaultEngine>(@decibel);

        // Check if already pending
        if (big_ordered_map::contains<object::Object<vault::Vault>, bool>(
            &engine.vaults_with_pending_requests,
            &vault
        )) {
            return  // Already queued
        };

        // Create request key with immediate processing (time=0)
        let key = PendingRequestKey {
            time: 0,  // Process immediately
            tie_breaker: transaction_context::monotonically_increasing_counter(),
        };

        // Add to queue
        let request = PendingRequest::VaultProgress { vault };
        big_ordered_map::add<PendingRequestKey, PendingRequest>(
            &mut engine.pending_requests,
            key,
            request
        );

        // Mark vault as having pending request
        big_ordered_map::add<object::Object<vault::Vault>, bool>(
            &mut engine.vaults_with_pending_requests,
            vault,
            true
        );
    }
}
