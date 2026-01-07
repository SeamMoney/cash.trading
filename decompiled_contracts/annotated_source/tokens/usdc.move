/// ============================================================================
/// Module: usdc
/// Description: USDC fungible asset token for testnet/trading
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module implements a USDC-like fungible token used as collateral
/// on the Decibel perpetual DEX. Features include:
///
/// - Admin-controlled minting with multi-admin support
/// - Public minting option (can be toggled)
/// - Restricted minting with daily limits per user
/// - Trading competition entry with auto-mint
///
/// Token Details:
/// - Symbol: USDC
/// - Decimals: 6 (standard USDC precision)
/// - Icon URL: https://circle.com/usdc-icon
/// - Project URL: https://circle.com/usdc
/// ============================================================================

module decibel::usdc {
    use aptos_framework::smart_table::{Self, SmartTable};
    use aptos_framework::fungible_asset::{Self, FungibleAsset, MintRef, BurnRef, TransferRef, Metadata};
    use aptos_framework::object::{Self, Object};
    use aptos_framework::primary_fungible_store;
    use aptos_framework::signer;
    use aptos_framework::timestamp;
    use aptos_framework::option;
    use aptos_framework::string;
    use decibel::dex_accounts;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// Object seed for creating the USDC named object
    const USDC_SEED: vector<u8> = b"USDC";  // [85, 83, 68, 67]

    /// Seconds in a day for rate limiting
    const SECONDS_PER_DAY: u64 = 86400;

    /// Error codes
    const E_NOT_ADMIN: u64 = 1;
    const E_NOT_ALLOWED_TO_MINT: u64 = 2;
    const E_CANNOT_REMOVE_LAST_ADMIN: u64 = 3;
    const E_DAILY_LIMIT_EXCEEDED: u64 = 4;
    const E_RESTRICTED_MINT_LIMIT_EXCEEDED: u64 = 5;

    // =========================================================================
    // TYPES
    // =========================================================================

    /// Admin configuration for controlling minting
    struct AdminConfig has key {
        /// Map of admin addresses to their status (true = admin)
        admins: SmartTable<address, bool>,
        /// Total number of admins (must stay >= 1)
        admin_count: u64,
        /// Whether public (non-admin) minting is allowed
        allow_public_minting: bool,
    }

    /// Daily rate limiting for restricted mints
    /// Prevents abuse while allowing testnet usage
    struct DailyRestrictedMint has store {
        /// Timestamp when daily counter resets
        trigger_reset_mint_ts: u64,
        /// Maximum mints allowed per day (globally)
        mints_per_day: u64,
        /// Remaining mints until reset
        remaining_mints: u64,
    }

    /// Restricted minting configuration
    /// Combines per-user limits with daily global limits
    struct RestrictedMint has key {
        /// Tracks last mint timestamp per user address
        /// Users can only mint once per 24 hours
        total_restricted_mint_per_owner: SmartTable<address, u64>,
        /// Maximum amount per restricted mint (250 USDC with 6 decimals = 250_000_000)
        total_restricted_mint_limit: u64,
        /// Daily minting constraints
        daily_restricted_mint: DailyRestrictedMint,
    }

    /// Core USDC token references
    /// Stores the capabilities needed to mint/burn/transfer
    struct USDCRef has key {
        /// Capability to mint new tokens
        mint_ref: MintRef,
        /// Capability to burn tokens
        burn_ref: BurnRef,
        /// Capability to force-transfer tokens
        transfer_ref: TransferRef,
        /// The metadata object for this fungible asset
        metadata: Object<Metadata>,
    }

    // =========================================================================
    // PUBLIC VIEW FUNCTIONS
    // =========================================================================

    /// Returns the USDC metadata object
    ///
    /// Used by other modules to identify USDC as the collateral asset.
    ///
    /// # Returns
    /// Object<Metadata> for the USDC fungible asset
    public fun metadata(): Object<Metadata> acquires USDCRef {
        let usdc_ref = borrow_global<USDCRef>(@decibel);
        usdc_ref.metadata
    }

    /// Returns the USDC balance of an address
    ///
    /// # Arguments
    /// * `owner` - Address to check balance for
    ///
    /// # Returns
    /// Balance in USDC smallest units (6 decimals)
    public fun balance(owner: address): u64 acquires USDCRef {
        let usdc_metadata = borrow_global<USDCRef>(@decibel).metadata;
        primary_fungible_store::balance<Metadata>(owner, usdc_metadata)
    }

    /// Checks if an address can mint (admin or public minting enabled)
    public fun can_mint(addr: address): bool acquires AdminConfig {
        let config = borrow_global<AdminConfig>(@decibel);
        if (smart_table::contains(&config.admins, addr)) {
            return true
        };
        config.allow_public_minting
    }

    /// Checks if an address can use restricted minting
    ///
    /// Requirements:
    /// - Daily global limit not exceeded (or reset time passed)
    /// - User hasn't minted in the last 24 hours
    public fun can_restricted_mint(user_addr: address): bool acquires RestrictedMint {
        let restricted = borrow_global<RestrictedMint>(@decibel);
        let now = timestamp::now_seconds();

        // Check daily global limit
        let daily_ok = if (restricted.daily_restricted_mint.remaining_mints > 0) {
            true
        } else {
            now >= restricted.daily_restricted_mint.trigger_reset_mint_ts
        };

        // Check per-user cooldown (24 hours since last mint)
        let default_ts: u64 = 0;
        let last_mint_ts = *smart_table::borrow_with_default(
            &restricted.total_restricted_mint_per_owner,
            user_addr,
            &default_ts
        );
        let user_cooldown_expired = now >= last_mint_ts + SECONDS_PER_DAY;

        if (user_cooldown_expired) {
            return daily_ok
        };
        false
    }

    /// Returns available restricted mint amount for user
    public fun available_restricted_mint_for(user_addr: address): u64 acquires RestrictedMint {
        let restricted = borrow_global<RestrictedMint>(@decibel);
        let now = timestamp::now_seconds();

        let default_ts: u64 = 0;
        let last_mint_ts = *smart_table::borrow_with_default(
            &restricted.total_restricted_mint_per_owner,
            user_addr,
            &default_ts
        );

        // User can mint if 24 hours have passed since last mint
        if (now >= last_mint_ts + SECONDS_PER_DAY) {
            restricted.total_restricted_mint_limit
        } else {
            0
        }
    }

    /// Returns number of restricted mints remaining today
    public fun mints_remaining(): u64 acquires RestrictedMint {
        let restricted = borrow_global<RestrictedMint>(@decibel);
        let now = timestamp::now_seconds();

        if (now >= restricted.daily_restricted_mint.trigger_reset_mint_ts) {
            // Reset time passed, full allocation available
            restricted.daily_restricted_mint.mints_per_day
        } else {
            restricted.daily_restricted_mint.remaining_mints
        }
    }

    /// Returns timestamp when daily restricted mint resets
    public fun restricted_mint_daily_reset_timestamp(): u64 acquires RestrictedMint {
        borrow_global<RestrictedMint>(@decibel).daily_restricted_mint.trigger_reset_mint_ts
    }

    /// Returns timestamp when specific user can mint again
    public fun restricted_mint_daily_reset_timestamp_for(user_addr: address): u64 acquires RestrictedMint {
        let restricted = borrow_global<RestrictedMint>(@decibel);
        let default_ts: u64 = 0;
        *smart_table::borrow_with_default(
            &restricted.total_restricted_mint_per_owner,
            user_addr,
            &default_ts
        ) + SECONDS_PER_DAY
    }

    /// Returns whether public minting is currently allowed
    public fun is_public_minting_allowed(): bool acquires AdminConfig {
        borrow_global<AdminConfig>(@decibel).allow_public_minting
    }

    /// Checks if an address is an admin
    public fun is_admin(addr: address): bool acquires AdminConfig {
        smart_table::contains(&borrow_global<AdminConfig>(@decibel).admins, addr)
    }

    /// Returns total number of admins
    public fun get_admin_count(): u64 acquires AdminConfig {
        borrow_global<AdminConfig>(@decibel).admin_count
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS - TOKEN OPERATIONS
    // =========================================================================

    /// Burns USDC from an address (admin only via mint capability)
    ///
    /// # Arguments
    /// * `from` - Address to burn from
    /// * `amount` - Amount to burn (6 decimals)
    public entry fun burn(from: address, amount: u64) acquires USDCRef {
        let usdc_ref = borrow_global<USDCRef>(@decibel);
        let usdc_metadata = usdc_ref.metadata;
        let store = primary_fungible_store::ensure_primary_store_exists<Metadata>(from, usdc_metadata);
        fungible_asset::burn_from(&usdc_ref.burn_ref, store, amount);
    }

    /// Transfers USDC between addresses
    ///
    /// # Arguments
    /// * `sender` - Signer sending the tokens
    /// * `recipient` - Address receiving tokens
    /// * `amount` - Amount to transfer (6 decimals)
    public fun transfer(sender: &signer, recipient: address, amount: u64) acquires USDCRef {
        let usdc_metadata = borrow_global<USDCRef>(@decibel).metadata;
        primary_fungible_store::transfer<Metadata>(sender, usdc_metadata, recipient, amount);
    }

    /// Deposits USDC fungible asset to an address's primary store
    public fun deposit(to: address, asset: FungibleAsset) {
        primary_fungible_store::deposit(to, asset);
    }

    /// Withdraws USDC from sender's primary store
    ///
    /// # Arguments
    /// * `sender` - Signer withdrawing tokens
    /// * `amount` - Amount to withdraw (6 decimals)
    ///
    /// # Returns
    /// FungibleAsset containing the withdrawn USDC
    public fun withdraw(sender: &signer, amount: u64): FungibleAsset acquires USDCRef {
        let usdc_metadata = borrow_global<USDCRef>(@decibel).metadata;
        primary_fungible_store::withdraw<Metadata>(sender, usdc_metadata, amount)
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS - MINTING
    // =========================================================================

    /// Mints USDC to an address (admin or public mint)
    ///
    /// # Arguments
    /// * `caller` - Signer requesting mint (must be admin or public minting enabled)
    /// * `recipient` - Address to receive tokens
    /// * `amount` - Amount to mint (6 decimals)
    ///
    /// # Requirements
    /// Caller must be admin OR public minting must be enabled
    public entry fun mint(
        caller: &signer,
        recipient: address,
        amount: u64
    ) acquires AdminConfig, USDCRef {
        let caller_addr = signer::address_of(caller);
        let config = borrow_global<AdminConfig>(@decibel);

        // Check if caller is allowed to mint
        let is_allowed = if (smart_table::contains(&config.admins, caller_addr)) {
            true
        } else {
            config.allow_public_minting
        };
        assert!(is_allowed, E_NOT_ALLOWED_TO_MINT);

        let usdc_ref = borrow_global<USDCRef>(@decibel);
        primary_fungible_store::mint(&usdc_ref.mint_ref, recipient, amount);
    }

    /// Mints USDC with rate limiting (for testnet faucet)
    ///
    /// # Arguments
    /// * `caller` - User requesting tokens
    /// * `amount` - Amount to mint (max 250 USDC per 24h)
    ///
    /// # Restrictions
    /// - Amount must be <= total_restricted_mint_limit (250 USDC)
    /// - User can only mint once per 24 hours
    /// - Global daily mint count must not be exceeded
    public entry fun restricted_mint(
        caller: &signer,
        amount: u64
    ) acquires RestrictedMint, USDCRef {
        let caller_addr = signer::address_of(caller);
        let restricted = borrow_global_mut<RestrictedMint>(@decibel);

        // Check amount doesn't exceed per-mint limit
        assert!(amount <= restricted.total_restricted_mint_limit, E_RESTRICTED_MINT_LIMIT_EXCEEDED);

        // Check if this is a first-time minter (not in table)
        let is_new_user = !smart_table::contains(&restricted.total_restricted_mint_per_owner, caller_addr);

        // Update daily limits (may reset if time passed)
        check_and_update_daily_limit(&mut restricted.daily_restricted_mint, is_new_user);

        // Update per-user limit (enforces 24h cooldown)
        check_and_update_recipient_limit_for(restricted, caller_addr);

        // Perform the mint
        let usdc_ref = borrow_global<USDCRef>(@decibel);
        primary_fungible_store::mint(&usdc_ref.mint_ref, caller_addr, amount);
    }

    /// Enters the trading competition
    ///
    /// Creates a subaccount with seed "trading_competition" and
    /// mints 10,000 USDC to the user, then deposits to subaccount.
    ///
    /// # Arguments
    /// * `user` - User entering the competition
    public entry fun enter_trading_competition(user: &signer) acquires USDCRef {
        let competition_seed: vector<u8> = b"trading_competition";

        // Create a seeded subaccount for the competition
        dex_accounts::create_new_seeded_subaccount(user, competition_seed);

        let user_addr = signer::address_of(user);
        let subaccount_addr = object::create_object_address(&user_addr, competition_seed);

        let usdc_ref = borrow_global<USDCRef>(@decibel);

        // Mint 10,000 USDC (10_000_000_000 with 6 decimals) to user
        let competition_amount: u64 = 10_000_000_000;
        primary_fungible_store::mint(&usdc_ref.mint_ref, user_addr, competition_amount);

        // Deposit to competition subaccount
        dex_accounts::deposit_to_subaccount_at(
            user,
            subaccount_addr,
            usdc_ref.metadata,
            competition_amount
        );
    }

    // =========================================================================
    // ADMIN FUNCTIONS
    // =========================================================================

    /// Adds a new admin (must be called by existing admin)
    ///
    /// # Arguments
    /// * `caller` - Existing admin adding new admin
    /// * `new_admin` - Address to grant admin rights
    public entry fun add_admin(caller: &signer, new_admin: address) acquires AdminConfig {
        let caller_addr = signer::address_of(caller);
        let config = borrow_global_mut<AdminConfig>(@decibel);

        // Verify caller is admin
        assert!(smart_table::contains(&config.admins, caller_addr), E_NOT_ADMIN);

        // Add new admin if not already one
        if (!smart_table::contains(&config.admins, new_admin)) {
            smart_table::add(&mut config.admins, new_admin, true);
            config.admin_count = config.admin_count + 1;
        };
    }

    /// Removes an admin (must be called by existing admin)
    ///
    /// # Arguments
    /// * `caller` - Existing admin removing another admin
    /// * `admin_to_remove` - Address to revoke admin rights
    ///
    /// # Requirements
    /// Cannot remove last admin (admin_count must stay >= 1)
    public entry fun remove_admin(caller: &signer, admin_to_remove: address) acquires AdminConfig {
        let caller_addr = signer::address_of(caller);
        let config = borrow_global_mut<AdminConfig>(@decibel);

        // Verify caller is admin
        assert!(smart_table::contains(&config.admins, caller_addr), E_NOT_ADMIN);

        // Cannot remove last admin
        assert!(config.admin_count > 1, E_CANNOT_REMOVE_LAST_ADMIN);

        // Remove admin if exists
        if (smart_table::contains(&config.admins, admin_to_remove)) {
            smart_table::remove(&mut config.admins, admin_to_remove);
            config.admin_count = config.admin_count - 1;
        };
    }

    /// Toggles public minting on/off
    ///
    /// # Arguments
    /// * `caller` - Admin toggling the setting
    /// * `allow` - Whether to allow public minting
    public entry fun set_public_minting(caller: &signer, allow: bool) acquires AdminConfig {
        let caller_addr = signer::address_of(caller);
        let config = borrow_global_mut<AdminConfig>(@decibel);
        assert!(smart_table::contains(&config.admins, caller_addr), E_NOT_ADMIN);
        config.allow_public_minting = allow;
    }

    /// Updates restricted minting settings (admin only)
    ///
    /// # Arguments
    /// * `caller` - Admin changing settings
    /// * `new_mint_limit` - Optional new per-user mint limit
    /// * `new_mints_per_day` - Optional new daily global mint count
    /// * `new_reset_timestamp` - Optional new reset timestamp
    public entry fun change_restricted_mint_settings(
        caller: &signer,
        new_mint_limit: option::Option<u64>,
        new_mints_per_day: option::Option<u64>,
        new_reset_timestamp: option::Option<u64>
    ) acquires AdminConfig, RestrictedMint {
        let config = borrow_global<AdminConfig>(@decibel);
        let caller_addr = signer::address_of(caller);
        assert!(smart_table::contains(&config.admins, caller_addr), E_NOT_ADMIN);

        let restricted = borrow_global_mut<RestrictedMint>(@decibel);

        if (option::is_some(&new_mint_limit)) {
            restricted.total_restricted_mint_limit = option::extract(&mut new_mint_limit);
        };

        if (option::is_some(&new_mints_per_day)) {
            restricted.daily_restricted_mint.mints_per_day = option::extract(&mut new_mints_per_day);
        };

        if (option::is_some(&new_reset_timestamp)) {
            restricted.daily_restricted_mint.trigger_reset_mint_ts = option::extract(&mut new_reset_timestamp);
        };
    }

    // =========================================================================
    // INTERNAL FUNCTIONS
    // =========================================================================

    /// Module initialization - called once on publish
    fun init_module(deployer: &signer) {
        setup_usdc(deployer);
    }

    /// Sets up the USDC fungible asset and configurations
    ///
    /// Creates:
    /// - Named object for USDC with metadata
    /// - USDCRef with mint/burn/transfer capabilities
    /// - AdminConfig with deployer as first admin
    /// - RestrictedMint with default limits
    public fun setup_usdc(deployer: &signer) {
        // Create named object for USDC
        let constructor_ref = object::create_named_object(deployer, USDC_SEED);

        // Create fungible asset with metadata
        // name: "USDC", symbol: "USDC", decimals: 6
        // icon: https://circle.com/usdc-icon
        // project: https://circle.com/usdc
        primary_fungible_store::create_primary_store_enabled_fungible_asset(
            &constructor_ref,
            option::none<u128>(),  // No max supply
            string::utf8(b"USDC"),
            string::utf8(b"USDC"),
            6u8,  // 6 decimal places
            string::utf8(b"https://circle.com/usdc-icon"),
            string::utf8(b"https://circle.com/usdc")
        );

        // Generate capability refs
        let mint_ref = fungible_asset::generate_mint_ref(&constructor_ref);
        let burn_ref = fungible_asset::generate_burn_ref(&constructor_ref);
        let transfer_ref = fungible_asset::generate_transfer_ref(&constructor_ref);
        let metadata = object::object_from_constructor_ref<Metadata>(&constructor_ref);

        // Store USDC refs
        let usdc_ref = USDCRef {
            mint_ref,
            burn_ref,
            transfer_ref,
            metadata,
        };
        move_to(deployer, usdc_ref);

        // Set up admin config with deployer as first admin
        let admins = smart_table::new<address, bool>();
        let deployer_addr = signer::address_of(deployer);
        smart_table::add(&mut admins, deployer_addr, true);

        let admin_config = AdminConfig {
            admins,
            admin_count: 1,
            allow_public_minting: true,  // Public minting enabled by default
        };
        move_to(deployer, admin_config);

        // Set up restricted minting
        let restricted_mint = RestrictedMint {
            total_restricted_mint_per_owner: smart_table::new<address, u64>(),
            total_restricted_mint_limit: 250_000_000,  // 250 USDC max per restricted mint
            daily_restricted_mint: DailyRestrictedMint {
                trigger_reset_mint_ts: timestamp::now_seconds(),
                mints_per_day: 1000,  // 1000 restricted mints per day globally
                remaining_mints: 1000,
            },
        };
        move_to(deployer, restricted_mint);
    }

    /// Updates daily rate limit, resetting if necessary
    ///
    /// # Arguments
    /// * `daily` - Daily limit struct to update
    /// * `is_new_user` - Whether this is the user's first restricted mint
    fun check_and_update_daily_limit(daily: &mut DailyRestrictedMint, is_new_user: bool) {
        let now = timestamp::now_seconds();

        // Reset daily counter if reset time has passed
        if (now >= daily.trigger_reset_mint_ts) {
            daily.trigger_reset_mint_ts = now + SECONDS_PER_DAY;
            daily.remaining_mints = daily.mints_per_day;
        };

        // Only decrement for new users (first-time minters)
        if (is_new_user) {
            assert!(daily.remaining_mints > 1, E_DAILY_LIMIT_EXCEEDED);
            daily.remaining_mints = daily.remaining_mints - 1;
        };
    }

    /// Enforces per-user 24h cooldown for restricted mints
    ///
    /// # Arguments
    /// * `restricted` - Restricted mint config
    /// * `user_addr` - User attempting to mint
    fun check_and_update_recipient_limit_for(restricted: &mut RestrictedMint, user_addr: address) {
        let now = timestamp::now_seconds();

        let default_ts: u64 = 0;
        let last_mint_ts = *smart_table::borrow_with_default(
            &restricted.total_restricted_mint_per_owner,
            user_addr,
            &default_ts
        );

        // Must wait 24 hours between mints
        assert!(now > last_mint_ts + SECONDS_PER_DAY, E_RESTRICTED_MINT_LIMIT_EXCEEDED);

        // Update last mint timestamp
        smart_table::upsert(&mut restricted.total_restricted_mint_per_owner, user_addr, now);
    }

    /// Updates per-user mint amount tracking (alternative limit check)
    /// Used for amount-based limiting instead of time-based
    fun check_and_update_recipient_limit_for_amount(
        restricted: &mut RestrictedMint,
        user_addr: address,
        amount: u64
    ) {
        let default_amount: u64 = 0;
        let current_total = *smart_table::borrow_with_default(
            &restricted.total_restricted_mint_per_owner,
            user_addr,
            &default_amount
        );

        let new_total = current_total + amount;
        assert!(new_total <= restricted.total_restricted_mint_limit, E_RESTRICTED_MINT_LIMIT_EXCEEDED);

        smart_table::upsert(
            &mut restricted.total_restricted_mint_per_owner,
            user_addr,
            new_total
        );
    }
}
