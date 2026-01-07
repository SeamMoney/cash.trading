/// ============================================================================
/// Module: builder_code_registry
/// Description: Registry for builder/integrator fee permissions
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module manages "builder fees" - additional fees that third-party
/// integrators (aggregators, interfaces, bots) can charge on trades routed
/// through their systems.
///
/// How it works:
/// 1. Users approve builders with a maximum fee (in basis points)
/// 2. Builders include a BuilderCode in orders specifying their fee
/// 3. When orders execute, builder fees are deducted and sent to builder
///
/// Fee Structure:
/// - Fees are in basis points (1 bp = 0.01%, 100 bp = 1%)
/// - Global max fee limits how much any builder can charge
/// - Per-user approvals further limit fees per builder
/// - Actual fee is min(approved, requested, global_max)
///
/// Use Cases:
/// - Aggregator frontends charging for routing
/// - Trading bots charging for execution
/// - Interface providers monetizing their UIs
/// ============================================================================

module decibel::builder_code_registry {
    use aptos_framework::big_ordered_map::{Self, BigOrderedMap};
    use aptos_framework::signer;
    use aptos_framework::error;
    use aptos_framework::option;
    use aptos_framework::math64;

    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================

    /// Trading fees manager uses builder fees in fee calculations
    friend decibel::trading_fees_manager;

    /// Async matching engine validates builder codes on order execution
    friend decibel::async_matching_engine;

    /// Perp engine processes builder fees during trades
    friend decibel::perp_engine;

    /// Perp engine API provides public interface for builder operations
    friend decibel::perp_engine_api;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// Contract address for permission checks
    const DECIBEL_ADDRESS: address = @0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844;

    /// Fee divisor: 1,000,000 = 100% (so 1000 = 0.1%)
    const FEE_DIVISOR: u128 = 1_000_000;

    /// Error codes
    const E_ZERO_FEE: u64 = 1;
    const E_NOT_APPROVED: u64 = 2;
    const E_UNAUTHORIZED: u64 = 3;
    const E_FEE_EXCEEDS_MAX: u64 = 4;
    const E_NOT_FOUND: u64 = 5;

    // =========================================================================
    // TYPES
    // =========================================================================

    /// Key for looking up builder approvals
    /// Combines user account and builder address
    struct BuilderAndAccount has copy, drop, store {
        /// The user who approved the builder
        account: address,
        /// The builder address being approved
        builder: address,
    }

    /// Builder code attached to orders
    /// Specifies which builder gets fees and how much
    struct BuilderCode has copy, drop, store {
        /// Address of the builder receiving fees
        builder: address,
        /// Requested fee in basis points (capped by approval)
        fees: u64,
    }

    /// Global registry for builder fee approvals
    enum Registry has store, key {
        V1 {
            /// Maximum fee any builder can charge (global cap)
            global_max_fee: u64,
            /// Map of (account, builder) -> approved max fee
            approved_max_fees: BigOrderedMap<BuilderAndAccount, u64>,
        }
    }

    // =========================================================================
    // PUBLIC VIEW FUNCTIONS
    // =========================================================================

    /// Gets the approved max fee for a builder from a specific account
    ///
    /// # Arguments
    /// * `account` - User who may have approved the builder
    /// * `builder` - Builder address to check
    ///
    /// # Returns
    /// Maximum fee the builder can charge (0 if not approved)
    /// Capped by global_max_fee
    public fun get_approved_max_fee(account: address, builder: address): u64 acquires Registry {
        let registry = borrow_global<Registry>(DECIBEL_ADDRESS);

        let key = BuilderAndAccount {
            account,
            builder,
        };

        let maybe_fee = big_ordered_map::get(&registry.approved_max_fees, &key);

        if (option::is_none(&maybe_fee)) {
            return 0
        };

        let approved_fee = option::destroy_some(maybe_fee);

        // Cap at global max
        math64::min(approved_fee, registry.global_max_fee)
    }

    // =========================================================================
    // FRIEND FUNCTIONS
    // =========================================================================

    /// Initializes the builder code registry
    ///
    /// # Arguments
    /// * `admin` - Contract admin
    /// * `global_max_fee` - Initial global max fee in basis points
    friend fun initialize(admin: &signer, global_max_fee: u64) {
        if (signer::address_of(admin) != DECIBEL_ADDRESS) {
            abort error::invalid_argument(E_UNAUTHORIZED)
        };

        let registry = Registry::V1 {
            global_max_fee,
            approved_max_fees: big_ordered_map::new<BuilderAndAccount, u64>(),
        };
        move_to(admin, registry);
    }

    /// Approves a builder to charge fees up to a maximum
    ///
    /// # Arguments
    /// * `user` - User approving the builder
    /// * `builder_address` - Builder to approve
    /// * `max_fee_bps` - Maximum fee in basis points
    ///
    /// # Effects
    /// - Creates or updates approval for the builder
    /// - Builder can now charge fees on user's trades
    ///
    /// # Example
    /// ```
    /// // Approve builder to charge up to 0.1% (1000 bps)
    /// approve_max_fee(&user, builder_addr, 1000);
    /// ```
    friend fun approve_max_fee(
        user: &signer,
        builder_address: address,
        max_fee_bps: u64
    ) acquires Registry {
        let registry = borrow_global_mut<Registry>(DECIBEL_ADDRESS);

        let key = BuilderAndAccount {
            account: signer::address_of(user),
            builder: builder_address,
        };

        // Validate fee doesn't exceed global max
        if (max_fee_bps > registry.global_max_fee) {
            abort error::invalid_argument(E_FEE_EXCEEDS_MAX)
        };

        // Remove existing approval if present (BigOrderedMap doesn't support update)
        if (big_ordered_map::contains(&registry.approved_max_fees, &key)) {
            big_ordered_map::remove(&mut registry.approved_max_fees, &key);
        };

        // Add new approval
        big_ordered_map::add(&mut registry.approved_max_fees, key, max_fee_bps);
    }

    /// Revokes approval for a builder
    ///
    /// # Arguments
    /// * `user` - User revoking approval
    /// * `builder_address` - Builder to revoke
    ///
    /// # Effects
    /// - Removes the approval entry
    /// - Builder can no longer charge fees on user's trades
    friend fun revoke_max_fee(user: &signer, builder_address: address) acquires Registry {
        let registry = borrow_global_mut<Registry>(DECIBEL_ADDRESS);

        let key = BuilderAndAccount {
            account: signer::address_of(user),
            builder: builder_address,
        };

        // Verify approval exists
        let maybe_fee = big_ordered_map::get(&registry.approved_max_fees, &key);
        if (option::is_none(&maybe_fee)) {
            abort error::invalid_argument(E_NOT_APPROVED)
        };

        // Remove approval
        big_ordered_map::remove(&mut registry.approved_max_fees, &key);
    }

    /// Creates a new builder code for attaching to orders
    ///
    /// # Arguments
    /// * `builder_address` - Builder receiving fees
    /// * `fee_bps` - Requested fee in basis points
    ///
    /// # Returns
    /// BuilderCode struct to include in order
    ///
    /// # Requirements
    /// - Fee must be > 0
    /// - Fee must not exceed global max
    ///
    /// # Note
    /// Creating a code doesn't guarantee fees - user must have approved
    friend fun new_builder_code(builder_address: address, fee_bps: u64): BuilderCode acquires Registry {
        let registry = borrow_global<Registry>(DECIBEL_ADDRESS);

        // Validate fee > 0
        if (fee_bps == 0) {
            abort error::invalid_argument(E_ZERO_FEE)
        };

        // Validate fee doesn't exceed global max
        if (fee_bps > registry.global_max_fee) {
            abort error::invalid_argument(E_FEE_EXCEEDS_MAX)
        };

        BuilderCode {
            builder: builder_address,
            fees: fee_bps,
        }
    }

    /// Validates that a builder code is authorized for an account
    ///
    /// # Arguments
    /// * `account` - Account the order is for
    /// * `code` - BuilderCode to validate
    ///
    /// # Aborts
    /// - If account hasn't approved the builder
    /// - If requested fee exceeds approved amount
    friend fun validate_builder_code(account: address, code: &BuilderCode) acquires Registry {
        let requested_fee = code.fees;
        let builder_addr = code.builder;

        let approved_fee = get_approved_max_fee(account, builder_addr);

        // Must have non-zero approval
        assert!(approved_fee != 0, E_NOT_FOUND);

        // Requested fee must not exceed approval
        if (requested_fee > approved_fee) {
            abort error::invalid_argument(E_FEE_EXCEEDS_MAX)
        };
    }

    /// Calculates builder fee for a given notional value
    ///
    /// # Arguments
    /// * `account` - Account being charged
    /// * `code` - BuilderCode with fee request
    /// * `notional_value` - Trade notional value (position size * price)
    ///
    /// # Returns
    /// Fee amount in collateral units (USDC with 6 decimals)
    ///
    /// # Calculation
    /// fee = notional * min(approved_fee, requested_fee) / 1_000_000
    friend fun get_builder_fee_for_notional(
        account: address,
        code: BuilderCode,
        notional_value: u128
    ): u64 acquires Registry {
        let builder_addr = code.builder;
        let approved_fee = get_approved_max_fee(account, builder_addr);

        // No fee if not approved
        if (approved_fee == 0) {
            return 0
        };

        let requested_fee = code.fees;

        // Use minimum of approved and requested
        let effective_fee = math64::min(approved_fee, requested_fee) as u128;

        // Calculate: notional * fee_bps / 1_000_000
        ((notional_value * effective_fee) / FEE_DIVISOR) as u64
    }

    /// Extracts builder address from a builder code
    friend fun get_builder_from_builder_code(code: &BuilderCode): address {
        code.builder
    }

    /// Extracts fee amount from a builder code
    friend fun get_fees_from_builder_code(code: &BuilderCode): u64 {
        code.fees
    }
}
