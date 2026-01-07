/// ============================================================================
/// Module: referral_registry
/// Description: Manages referral codes and referrer relationships
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module implements a referral system that allows users to:
/// 1. Create unique referral codes tied to their address
/// 2. Register as being referred by another user's code
///
/// Benefits:
/// - Referrers earn a percentage of their referees' trading fees
/// - Referred users get fee discounts (while under volume threshold)
///
/// Constraints:
/// - Referral codes must be unique alphanumeric strings (1-32 chars)
/// - Users can only create one referral code
/// - Users can only register one referrer
/// - Users cannot refer themselves
/// ============================================================================

module decibel::referral_registry {
    use aptos_framework::big_ordered_map::{Self, BigOrderedMap};
    use aptos_framework::string::{Self, String};
    use aptos_framework::option::{Self, Option};
    use aptos_framework::error;

    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================

    /// Trading fees manager uses referrals for fee calculations
    friend decibel::trading_fees_manager;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// Error codes
    const E_CODE_ALREADY_EXISTS: u64 = 1;
    const E_ALREADY_REGISTERED: u64 = 2;
    const E_INVALID_CODE_LENGTH: u64 = 4;
    const E_CODE_NOT_ALPHANUMERIC: u64 = 5;
    const E_SELF_REFERRAL: u64 = 6;

    /// Maximum referral code length
    const MAX_CODE_LENGTH: u64 = 32;

    // =========================================================================
    // TYPES
    // =========================================================================

    /// Storage for all referral relationships
    struct Referrals has store {
        /// Map: user address -> their referral code
        addr_to_referral_code: BigOrderedMap<address, String>,
        /// Map: referral code -> owner address (reverse lookup)
        referral_code_to_addr: BigOrderedMap<String, address>,
        /// Map: referred user -> referrer address
        addr_to_referrer_addr: BigOrderedMap<address, address>,
    }

    // =========================================================================
    // FRIEND FUNCTIONS
    // =========================================================================

    /// Initializes the referral registry
    ///
    /// # Returns
    /// New Referrals struct with empty maps
    friend fun initialize(): Referrals {
        Referrals {
            addr_to_referral_code: big_ordered_map::new_with_config<address, String>(8, 8, true),
            referral_code_to_addr: big_ordered_map::new_with_config<String, address>(8, 8, true),
            addr_to_referrer_addr: big_ordered_map::new_with_config<address, address>(8, 8, true),
        }
    }

    /// Gets a user's referral code (if they have one)
    ///
    /// # Arguments
    /// * `referrals` - Reference to the referrals storage
    /// * `user_addr` - Address to look up
    ///
    /// # Returns
    /// Option containing the user's referral code, or none
    friend fun get_referral_code(referrals: &Referrals, user_addr: address): Option<String> {
        big_ordered_map::get(&referrals.addr_to_referral_code, &user_addr)
    }

    /// Gets the referrer address for a user (if they were referred)
    ///
    /// # Arguments
    /// * `referrals` - Reference to the referrals storage
    /// * `user_addr` - Address to look up
    ///
    /// # Returns
    /// Option containing the referrer's address, or none
    friend fun get_referrer_addr(referrals: &Referrals, user_addr: address): Option<address> {
        big_ordered_map::get(&referrals.addr_to_referrer_addr, &user_addr)
    }

    /// Registers a new referral code for a user
    ///
    /// # Arguments
    /// * `referrals` - Mutable reference to referrals storage
    /// * `user_addr` - Address registering the code
    /// * `code` - Unique referral code string
    ///
    /// # Requirements
    /// - Code must be 1-32 characters
    /// - Code must be alphanumeric (a-z, A-Z, 0-9)
    /// - Code must not already be registered
    /// - User must not already have a code
    ///
    /// # Errors
    /// - E_INVALID_CODE_LENGTH: Code is empty or too long
    /// - E_CODE_NOT_ALPHANUMERIC: Code contains invalid characters
    /// - E_CODE_ALREADY_EXISTS: Code already registered by another user
    /// - E_ALREADY_REGISTERED: User already has a referral code
    friend fun register_referral_code(
        referrals: &mut Referrals,
        user_addr: address,
        code: String
    ) {
        // Validate code length (1-32 characters)
        let code_len = string::length(&code);
        let valid_length = code_len > 0 && code_len <= MAX_CODE_LENGTH;
        if (!valid_length) {
            abort error::invalid_argument(E_INVALID_CODE_LENGTH)
        };

        // Validate alphanumeric characters only
        if (!is_ascii_alphanumeric(&code)) {
            abort error::invalid_argument(E_CODE_NOT_ALPHANUMERIC)
        };

        // Check code isn't already taken
        if (big_ordered_map::contains(&referrals.referral_code_to_addr, &code)) {
            abort error::invalid_argument(E_CODE_ALREADY_EXISTS)
        };

        // Check user doesn't already have a code
        if (big_ordered_map::contains(&referrals.addr_to_referral_code, &user_addr)) {
            abort error::invalid_argument(E_ALREADY_REGISTERED)
        };

        // Register the code bidirectionally
        big_ordered_map::add(&mut referrals.addr_to_referral_code, user_addr, code);
        big_ordered_map::add(&mut referrals.referral_code_to_addr, code, user_addr);
    }

    /// Registers a referrer for a user using a referral code
    ///
    /// # Arguments
    /// * `referrals` - Mutable reference to referrals storage
    /// * `user_addr` - User being referred
    /// * `referral_code` - Code of the referrer
    ///
    /// # Requirements
    /// - User must not already have a referrer
    /// - Referral code must exist
    /// - User cannot refer themselves
    ///
    /// # Effects
    /// - Links user to referrer permanently
    /// - User may get fee discounts
    /// - Referrer earns fee rewards on user's trades
    friend fun register_referrer(
        referrals: &mut Referrals,
        user_addr: address,
        referral_code: String
    ) {
        // Check user doesn't already have a referrer
        if (big_ordered_map::contains(&referrals.addr_to_referrer_addr, &user_addr)) {
            abort error::invalid_argument(E_ALREADY_REGISTERED)
        };

        // Look up the referrer address from code
        let referrer_addr = big_ordered_map::borrow(&referrals.referral_code_to_addr, &referral_code);

        // Prevent self-referral
        if (*referrer_addr == user_addr) {
            abort error::invalid_argument(E_SELF_REFERRAL)
        };

        // Register the referral relationship
        big_ordered_map::add(&mut referrals.addr_to_referrer_addr, user_addr, *referrer_addr);
    }

    // =========================================================================
    // INTERNAL FUNCTIONS
    // =========================================================================

    /// Checks if a string contains only ASCII alphanumeric characters
    ///
    /// Valid characters: 0-9 (48-57), A-Z (65-90), a-z (97-122)
    ///
    /// # Arguments
    /// * `s` - String to validate
    ///
    /// # Returns
    /// True if all characters are alphanumeric
    fun is_ascii_alphanumeric(s: &String): bool {
        let bytes = string::bytes(s);
        let len = string::length(s);
        let i = 0;

        while (i < len) {
            let char = *std::vector::borrow(bytes, i);

            // Check if character is: 0-9, A-Z, or a-z
            let is_digit = char >= 48 && char <= 57;     // 0-9
            let is_upper = char >= 65 && char <= 90;     // A-Z
            let is_lower = char >= 97 && char <= 122;    // a-z

            let is_valid = is_digit || is_upper || is_lower;

            if (!is_valid) {
                return false
            };

            i = i + 1;
        };

        true
    }
}
