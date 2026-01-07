/// ============================================================================
/// Module: internal_oracle_state
/// Description: Internal price oracle for testing/admin price feeds
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module provides an internal price source that can be set manually.
/// It's used for:
/// - Testing environments where external oracles aren't available
/// - Admin override of prices in emergency situations
/// - Custom markets without external oracle support
///
/// Each internal source is stored as a Move object, allowing multiple
/// independent price sources to be created.
/// ============================================================================

module decibel::internal_oracle_state {
    use aptos_framework::object::{Self, ExtendRef};
    use std::signer;
    use aptos_framework::timestamp;

    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================

    /// Only the oracle module can read/update internal sources
    friend decibel::oracle;

    // =========================================================================
    // TYPES
    // =========================================================================

    /// Identifier for an internal price source
    /// Contains the object address where the source state is stored
    struct InternalSourceIdentifier has copy, drop, store {
        object_address: address,    // Address of the InternalSourceState object
    }

    /// State for an internal price source
    /// Stored as a Move object with its own address
    enum InternalSourceState has key {
        V1 {
            spot_price: u64,        // Current price in oracle decimals
            update_time: u64,       // Last update timestamp (seconds)
            source_ref: ExtendRef,  // Reference to extend the object
        }
    }

    // =========================================================================
    // PUBLIC FUNCTIONS
    // =========================================================================

    /// Creates a new internal price source
    ///
    /// # Arguments
    /// * `creator` - Account creating the source
    /// * `initial_price` - Initial spot price
    ///
    /// # Returns
    /// InternalSourceIdentifier to reference this source
    ///
    /// # Effects
    /// - Creates a new Move object to store the price state
    /// - Sets initial price and current timestamp
    ///
    /// # Example
    /// ```
    /// let btc_internal = create_new_internal_source(&admin, 90000_00000000); // $90k with 8 decimals
    /// ```
    public fun create_new_internal_source(
        creator: &signer,
        initial_price: u64
    ): InternalSourceIdentifier {
        // Create a new object owned by creator
        let constructor_ref = object::create_object(signer::address_of(creator));
        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let object_signer = object::generate_signer_for_extending(&extend_ref);

        // Get current time for update timestamp
        let current_time = timestamp::now_seconds();

        // Create and store the internal source state
        let state = InternalSourceState::V1 {
            spot_price: initial_price,
            update_time: current_time,
            source_ref: extend_ref,
        };
        move_to(&object_signer, state);

        // Return identifier pointing to the object
        InternalSourceIdentifier {
            object_address: signer::address_of(&object_signer)
        }
    }

    // =========================================================================
    // FRIEND FUNCTIONS
    // =========================================================================

    /// Gets the price and update time from an internal source
    ///
    /// # Arguments
    /// * `source_id` - Identifier of the internal source
    ///
    /// # Returns
    /// Tuple of (spot_price, update_time)
    ///
    /// # Used By
    /// Oracle module to fetch internal prices for markets
    friend fun get_internal_source_data(
        source_id: &InternalSourceIdentifier
    ): (u64, u64) acquires InternalSourceState {
        let source_addr = source_id.object_address;
        let state = borrow_global<InternalSourceState>(source_addr);
        let price = state.spot_price;
        let update_time = state.update_time;
        (price, update_time)
    }

    /// Updates the price of an internal source
    ///
    /// # Arguments
    /// * `source_id` - Identifier of the internal source
    /// * `new_price` - New spot price to set
    ///
    /// # Effects
    /// - Updates spot_price to new value
    /// - Updates update_time to current timestamp
    ///
    /// # Used By
    /// Admin functions to manually update prices
    friend fun update_internal_source_price(
        source_id: &InternalSourceIdentifier,
        new_price: u64
    ) acquires InternalSourceState {
        let source_addr = source_id.object_address;
        let state_mut = borrow_global_mut<InternalSourceState>(source_addr);

        // Update price and timestamp
        let current_time = timestamp::now_seconds();
        state_mut.spot_price = new_price;
        state_mut.update_time = current_time;
    }
}
