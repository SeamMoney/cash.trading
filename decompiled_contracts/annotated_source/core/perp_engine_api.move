/// ============================================================================
/// Module: perp_engine_api
/// Description: Public API for perp engine operations
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module provides public APIs for:
/// 1. Referral system - register codes and referrers
/// 2. Builder fees - approve/revoke fee permissions for builders
/// 3. Restricted operations - init users with capability pattern
///
/// The RestrictedPerpApi capability allows controlled access to
/// sensitive operations like user initialization.
/// ============================================================================

module decibel::perp_engine_api {
    use std::string::String;
    use std::signer;
    use decibel::trading_fees_manager;
    use decibel::builder_code_registry::{Self, BuilderCode};
    use decibel::perp_engine;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// Contract address for permission checks
    const DECIBEL_ADDRESS: address = @0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844;

    /// Error: Unauthorized access
    const E_UNAUTHORIZED: u64 = 1;

    // =========================================================================
    // CAPABILITY TYPES
    // =========================================================================

    /// Capability struct for restricted perp operations
    /// Uses function pointers (closures) for capability pattern
    ///
    /// This pattern allows the contract to delegate specific operations
    /// to authorized callers without exposing the underlying functions directly.
    enum RestrictedPerpApi has drop, store {
        V1 {
            /// Function to initialize a new user's account
            init_user_if_new_f: |&signer, address| has copy + drop + store,
        }
    }

    // =========================================================================
    // REFERRAL FUNCTIONS
    // =========================================================================

    /// Registers a referral code for the calling user
    ///
    /// Users can create unique referral codes that others can use
    /// when signing up to earn referral rewards.
    ///
    /// # Arguments
    /// * `user` - The user creating the referral code
    /// * `code` - Unique referral code string
    ///
    /// # Effects
    /// - Associates the code with the user's address
    /// - Code can be used by others to register as referred users
    public fun register_referral_code(user: &signer, code: String) {
        trading_fees_manager::register_referral_code(signer::address_of(user), code);
    }

    /// Registers a referrer for the calling user
    ///
    /// New users can specify who referred them to earn fee discounts
    /// and give their referrer rewards.
    ///
    /// # Arguments
    /// * `user` - The new user being referred
    /// * `referral_code` - The referrer's code
    ///
    /// # Effects
    /// - Links user to referrer
    /// - User may get fee discounts
    /// - Referrer earns rewards on user's trades
    public fun register_referrer(user: &signer, referral_code: String) {
        trading_fees_manager::register_referrer(signer::address_of(user), referral_code);
    }

    // =========================================================================
    // BUILDER FEE FUNCTIONS
    // =========================================================================

    /// Approves a builder to charge up to a maximum fee
    ///
    /// Builders (aggregators, interfaces) can charge additional fees
    /// on top of protocol fees. Users must approve builders first.
    ///
    /// # Arguments
    /// * `user` - The user approving the builder
    /// * `builder_address` - Address of the builder to approve
    /// * `max_fee_bps` - Maximum fee in basis points (e.g., 10 = 0.1%)
    ///
    /// # Effects
    /// - Builder can now charge fees up to max_fee_bps on user's trades
    public fun approve_max_fee(user: &signer, builder_address: address, max_fee_bps: u64) {
        builder_code_registry::approve_max_fee(user, builder_address, max_fee_bps);
    }

    /// Creates a new builder code for a trade
    ///
    /// Builders include this code in orders to receive their fees.
    ///
    /// # Arguments
    /// * `builder_address` - The builder's address
    /// * `fee_bps` - Fee to charge in basis points
    ///
    /// # Returns
    /// BuilderCode struct to include in order
    public fun new_builder_code(builder_address: address, fee_bps: u64): BuilderCode {
        builder_code_registry::new_builder_code(builder_address, fee_bps)
    }

    /// Revokes approval for a builder
    ///
    /// # Arguments
    /// * `user` - The user revoking approval
    /// * `builder_address` - Builder to revoke
    ///
    /// # Effects
    /// - Builder can no longer charge fees on user's trades
    public fun revoke_max_fee(user: &signer, builder_address: address) {
        builder_code_registry::revoke_max_fee(user, builder_address);
    }

    // =========================================================================
    // RESTRICTED FUNCTIONS
    // =========================================================================

    /// Initializes a new user's account using restricted capability
    ///
    /// # Arguments
    /// * `api` - The RestrictedPerpApi capability
    /// * `caller` - The authorized caller
    /// * `user_address` - Address to initialize
    ///
    /// # Effects
    /// - Creates user's position tracking structures
    /// - Sets up collateral accounts
    public fun init_user_if_new(api: &RestrictedPerpApi, caller: &signer, user_address: address) {
        let init_fn = api.init_user_if_new_f;
        init_fn(caller, user_address);
    }

    /// Obtains the restricted API capability
    ///
    /// Only the contract itself can obtain this capability,
    /// providing controlled delegation of sensitive operations.
    ///
    /// # Arguments
    /// * `admin` - Must be the contract admin
    ///
    /// # Returns
    /// RestrictedPerpApi capability struct
    ///
    /// # Permissions
    /// Only callable by contract admin (DECIBEL_ADDRESS)
    public fun get_restricted_perp_api(admin: &signer): RestrictedPerpApi {
        assert!(signer::address_of(admin) == DECIBEL_ADDRESS, E_UNAUTHORIZED);

        RestrictedPerpApi::V1 {
            init_user_if_new_f: |caller, user_addr| perp_engine::init_user_if_new(caller, user_addr)
        }
    }
}
