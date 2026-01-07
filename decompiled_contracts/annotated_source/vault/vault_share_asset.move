/// ============================================================================
/// VAULT SHARE ASSET - Vault Share Token Management
/// ============================================================================
///
/// This module manages vault share tokens as fungible assets. Each vault has
/// its own share token that represents ownership in the vault's assets.
///
/// KEY FEATURES:
/// - Contribution lockups: Shares can be locked for a period after contribution
/// - Pending redemptions: Shares locked during redemption process
/// - Dispatchable asset: Custom withdrawal hook for lockup enforcement
///
/// LOCKUP MECHANISM:
/// - Contributions create lockup entries with unlock times
/// - Multiple contributions within 10% of lockup period are merged
/// - Lockup prevents immediate withdrawal after contribution
/// - Pending redemptions also lock shares until redemption completes
///
/// UNLOCKED BALANCE CALCULATION:
/// unlocked = total_balance - sum(locked_entries) - pending_redemption_amount
///
/// ============================================================================

module decibel::vault_share_asset {
    use std::table;
    use std::fungible_asset;
    use std::object;
    use std::primary_fungible_store;
    use std::vector;
    use std::string;
    use std::option;
    use std::string_utils;
    use std::function_info;
    use std::dispatchable_fungible_asset;

    use decibel::decibel_time;
    use decibel::vault_global_config;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::vault;

    // ============================================================================
    // CORE STRUCTURES
    // ============================================================================

    /// A single lockup entry for contribution shares
    struct LockedEntry has copy, drop, store {
        /// Amount of shares locked
        amount: u64,
        /// Unix timestamp when shares unlock
        unlock_time_s: u64,
    }

    /// Per-store lockup tracking for a user
    enum PrimaryStoreLockups has drop, store {
        V1 {
            /// Vector of contribution lockup entries
            contribution_lockup_entries: vector<LockedEntry>,
            /// Shares currently locked for pending redemptions
            pending_redemption_amount: u64,
        }
    }

    /// Registry of all lockups for a vault's share asset
    enum VaultLockupRegistry has key {
        V1 {
            /// Maps store address -> lockup state
            primary_store_lockups: table::Table<address, PrimaryStoreLockups>,
        }
    }

    /// Configuration for a vault's share token
    enum VaultShareConfig has key {
        V1 {
            /// Reference for minting new shares
            mint_ref: fungible_asset::MintRef,
            /// Reference for burning shares
            burn_ref: fungible_asset::BurnRef,
            /// Reference for transfers
            transfer_ref: fungible_asset::TransferRef,
            /// Extension reference for the vault
            vault_ref: object::ExtendRef,
            /// Duration that contributions are locked (seconds)
            contribution_lockup_duration_s: u64,
        }
    }

    // ============================================================================
    // ERROR CODES
    // ============================================================================

    // Error 3: Insufficient unlocked balance
    // Error 4: Lockup duration exceeds maximum allowed
    // Error 5: VaultLockupRegistry not found
    // Error 6: Locked amount exceeds total balance (corruption)

    // ============================================================================
    // INTERNAL FUNCTIONS
    // ============================================================================

    /// Add a lockup entry for newly contributed shares
    ///
    /// If a recent lockup entry exists (within 10% of lockup duration),
    /// the new amount is added to it. Otherwise, a new entry is created.
    ///
    /// # Returns
    /// The unlock timestamp for the lockup entry (0 if no lockup)
    fun add_lockup_entry(
        share_metadata: object::Object<fungible_asset::Metadata>,
        store_address: address,
        amount: u64,
        lockup_duration: u64
    ): u64 acquires VaultLockupRegistry {
        // No lockup if duration is 0
        if (lockup_duration == 0) {
            return 0
        };

        // Get the user's fungible store and verify they have enough unlocked
        let store = object::address_to_object<fungible_asset::FungibleStore>(store_address);
        let unlocked = get_unlocked_balance<fungible_asset::FungibleStore>(share_metadata, store);
        assert!(amount <= unlocked, 3);

        // Get or create lockup state for this store
        let metadata_addr = object::object_address<fungible_asset::Metadata>(&share_metadata);
        let registry = borrow_global_mut<VaultLockupRegistry>(metadata_addr);

        if (!table::contains<address, PrimaryStoreLockups>(&registry.primary_store_lockups, store_address)) {
            let empty_lockups = PrimaryStoreLockups::V1 {
                contribution_lockup_entries: vector::empty<LockedEntry>(),
                pending_redemption_amount: 0,
            };
            table::add<address, PrimaryStoreLockups>(&mut registry.primary_store_lockups, store_address, empty_lockups);
        };

        let lockups = table::borrow_mut<address, PrimaryStoreLockups>(
            &mut registry.primary_store_lockups,
            store_address
        );

        let unlock_time = decibel_time::now_seconds() + lockup_duration;
        let num_entries = vector::length<LockedEntry>(&lockups.contribution_lockup_entries);

        // Check if we can merge with the last entry (within 10% of lockup duration)
        if (num_entries > 0) {
            let last_entry = vector::borrow_mut<LockedEntry>(
                &mut lockups.contribution_lockup_entries,
                num_entries - 1
            );

            // Merge threshold: 10% of lockup duration
            let merge_threshold = lockup_duration * 10 / 100;
            let merge_deadline = last_entry.unlock_time_s + merge_threshold;

            if (unlock_time <= merge_deadline) {
                // Merge with existing entry
                last_entry.amount = last_entry.amount + amount;
                return last_entry.unlock_time_s
            }
        };

        // Create new lockup entry
        let new_entry = LockedEntry {
            amount,
            unlock_time_s: unlock_time,
        };
        vector::push_back<LockedEntry>(&mut lockups.contribution_lockup_entries, new_entry);

        unlock_time
    }

    /// Calculate unlocked balance for a fungible store
    ///
    /// # Returns
    /// total_balance - locked_contributions - pending_redemptions
    fun get_unlocked_balance<T: key>(
        share_metadata: object::Object<fungible_asset::Metadata>,
        store: object::Object<T>
    ): u64 acquires VaultLockupRegistry {
        let metadata_addr = object::object_address<fungible_asset::Metadata>(&share_metadata);
        let total_balance = fungible_asset::balance<T>(store);

        assert!(exists<VaultLockupRegistry>(metadata_addr), 5);

        let store_addr = object::object_address<T>(&store);
        let registry = borrow_global<VaultLockupRegistry>(metadata_addr);

        // If no lockups for this store, all balance is unlocked
        if (!table::contains<address, PrimaryStoreLockups>(&registry.primary_store_lockups, store_addr)) {
            return total_balance
        };

        let lockups = table::borrow<address, PrimaryStoreLockups>(&registry.primary_store_lockups, store_addr);
        let current_time = decibel_time::now_seconds();

        // Start with pending redemption amount as locked
        let locked_amount = lockups.pending_redemption_amount;

        // Add up all non-expired lockup entries
        let entries = lockups.contribution_lockup_entries;
        vector::reverse<LockedEntry>(&mut entries);
        let num_entries = vector::length<LockedEntry>(&entries);

        while (num_entries > 0) {
            let entry = vector::pop_back<LockedEntry>(&mut entries);
            if (entry.unlock_time_s > current_time) {
                // Entry hasn't unlocked yet
                locked_amount = locked_amount + entry.amount;
            };
            num_entries = num_entries - 1;
        };

        vector::destroy_empty<LockedEntry>(entries);

        // Verify locked amount doesn't exceed balance (sanity check)
        assert!(locked_amount <= total_balance, 6);

        total_balance - locked_amount
    }

    // ============================================================================
    // SHARE BURNING
    // ============================================================================

    /// Burn shares that have been redeemed
    ///
    /// Called when redemption completes - burns the shares and decreases
    /// pending redemption amount.
    friend fun burn_redeemed_shares_from(
        share_metadata: object::Object<fungible_asset::Metadata>,
        user: address,
        amount: u64
    ) acquires VaultLockupRegistry, VaultShareConfig {
        let store_addr = primary_fungible_store::primary_store_address<fungible_asset::Metadata>(user, share_metadata);
        let metadata_addr = object::object_address<fungible_asset::Metadata>(&share_metadata);

        // Decrease pending redemption amount
        let registry = borrow_global_mut<VaultLockupRegistry>(metadata_addr);
        if (!table::contains<address, PrimaryStoreLockups>(&registry.primary_store_lockups, store_addr)) {
            let empty_lockups = PrimaryStoreLockups::V1 {
                contribution_lockup_entries: vector::empty<LockedEntry>(),
                pending_redemption_amount: 0,
            };
            table::add<address, PrimaryStoreLockups>(&mut registry.primary_store_lockups, store_addr, empty_lockups);
        };

        let lockups = table::borrow_mut<address, PrimaryStoreLockups>(
            &mut registry.primary_store_lockups,
            store_addr
        );
        lockups.pending_redemption_amount = lockups.pending_redemption_amount - amount;

        // Burn the shares
        let config = borrow_global<VaultShareConfig>(metadata_addr);
        let store = object::address_to_object<fungible_asset::FungibleStore>(store_addr);
        fungible_asset::burn_from<fungible_asset::FungibleStore>(&config.burn_ref, store, amount);
    }

    // ============================================================================
    // PUBLIC FUNCTIONS
    // ============================================================================

    /// Check if user can withdraw the specified amount
    public fun can_withdraw(
        share_metadata: object::Object<fungible_asset::Metadata>,
        user: address,
        amount: u64
    ): bool acquires VaultLockupRegistry {
        let store = primary_fungible_store::primary_store<fungible_asset::Metadata>(user, share_metadata);
        get_unlocked_balance<fungible_asset::FungibleStore>(share_metadata, store) >= amount
    }

    /// Clean up expired lockup entries for a user
    public fun cleanup_expired_entries(
        metadata_addr: address,
        store_addr: address
    ) acquires VaultLockupRegistry {
        if (!exists<VaultLockupRegistry>(metadata_addr)) {
            return
        };

        let registry = borrow_global_mut<VaultLockupRegistry>(metadata_addr);
        if (!table::contains<address, PrimaryStoreLockups>(&registry.primary_store_lockups, store_addr)) {
            return
        };

        let lockups = table::borrow_mut<address, PrimaryStoreLockups>(
            &mut registry.primary_store_lockups,
            store_addr
        );

        let current_time = decibel_time::now_seconds();
        let active_entries = vector::empty<LockedEntry>();

        // Copy current entries
        let entries = lockups.contribution_lockup_entries;
        vector::reverse<LockedEntry>(&mut entries);
        let num_entries = vector::length<LockedEntry>(&entries);

        // Keep only non-expired entries
        while (num_entries > 0) {
            let entry = vector::pop_back<LockedEntry>(&mut entries);
            if (entry.unlock_time_s > current_time) {
                vector::push_back<LockedEntry>(&mut active_entries, entry);
            };
            num_entries = num_entries - 1;
        };

        vector::destroy_empty<LockedEntry>(entries);
        lockups.contribution_lockup_entries = active_entries;
    }

    // ============================================================================
    // VAULT SHARE CREATION
    // ============================================================================

    /// Create a new vault share fungible asset
    ///
    /// Creates a primary-store-enabled fungible asset with custom withdrawal
    /// hook to enforce lockups.
    friend fun create_vault_shares(
        vault_signer: &signer,
        vault_name: string::String,
        symbol: string::String,
        icon_uri: string::String,
        project_uri: string::String,
        decimals: u8,
        lockup_duration: u64
    ): object::Object<fungible_asset::Metadata> {
        // Validate lockup duration against global max
        validate_contribution_lockup_duration(lockup_duration);

        // Create named object for share asset - "vault_share_asset"
        let constructor = object::create_named_object(
            vault_signer,
            vector[118u8, 97u8, 117u8, 108u8, 116u8, 95u8, 115u8, 104u8, 97u8, 114u8, 101u8, 95u8, 97u8, 115u8, 115u8, 101u8, 116u8]
        );

        // Format name as "{vault_name} Share"
        let share_name = string_utils::format1<string::String>(
            &vector[123u8, 125u8, 32u8, 83u8, 104u8, 97u8, 114u8, 101u8],  // "{} Share"
            vault_name
        );

        // Create primary store enabled fungible asset
        primary_fungible_store::create_primary_store_enabled_fungible_asset(
            &constructor,
            option::none<u128>(),  // No max supply
            share_name,
            symbol,
            decimals,
            icon_uri,
            project_uri
        );

        // Register custom withdrawal hook for lockup enforcement
        // Module: "vault_share_asset", Function: "vault_share_withdraw"
        let withdraw_function = function_info::new_function_info_from_address(
            @decibel,
            string::utf8(vector[118u8, 97u8, 117u8, 108u8, 116u8, 95u8, 115u8, 104u8, 97u8, 114u8, 101u8, 95u8, 97u8, 115u8, 115u8, 101u8, 116u8]),
            string::utf8(vector[118u8, 97u8, 117u8, 108u8, 116u8, 95u8, 115u8, 104u8, 97u8, 114u8, 101u8, 95u8, 119u8, 105u8, 116u8, 104u8, 100u8, 114u8, 97u8, 119u8])
        );

        dispatchable_fungible_asset::register_dispatch_functions(
            &constructor,
            option::some<function_info::FunctionInfo>(withdraw_function),
            option::none<function_info::FunctionInfo>(),  // No deposit hook
            option::none<function_info::FunctionInfo>()   // No derived balance hook
        );

        let share_signer = object::generate_signer(&constructor);
        let share_metadata = object::object_from_constructor_ref<fungible_asset::Metadata>(&constructor);

        // Store share configuration
        let config = VaultShareConfig::V1 {
            mint_ref: fungible_asset::generate_mint_ref(&constructor),
            burn_ref: fungible_asset::generate_burn_ref(&constructor),
            transfer_ref: fungible_asset::generate_transfer_ref(&constructor),
            vault_ref: object::generate_extend_ref(&constructor),
            contribution_lockup_duration_s: lockup_duration,
        };
        move_to<VaultShareConfig>(&share_signer, config);

        // Initialize lockup registry
        let registry = VaultLockupRegistry::V1 {
            primary_store_lockups: table::new<address, PrimaryStoreLockups>(),
        };
        move_to<VaultLockupRegistry>(&share_signer, registry);

        share_metadata
    }

    /// Validate that lockup duration doesn't exceed global max
    fun validate_contribution_lockup_duration(duration: u64) {
        let share_config = vault_global_config::get_global_share_config();
        let max_lockup = vault_global_config::get_max_contribution_lockup_seconds(&share_config);
        assert!(duration <= max_lockup, 4);
    }

    // ============================================================================
    // PUBLIC VIEW FUNCTIONS
    // ============================================================================

    /// Get unlocked balance for a user
    public fun get_user_unlocked_balance(
        share_metadata: object::Object<fungible_asset::Metadata>,
        user: address
    ): u64 acquires VaultLockupRegistry {
        let store = primary_fungible_store::primary_store<fungible_asset::Metadata>(user, share_metadata);
        get_unlocked_balance<fungible_asset::FungibleStore>(share_metadata, store)
    }

    // ============================================================================
    // REDEMPTION LOCKING
    // ============================================================================

    /// Lock shares for a pending redemption
    ///
    /// Called when user initiates redemption - locks shares until
    /// redemption completes or is cancelled.
    friend fun lock_for_redemption(
        share_metadata: object::Object<fungible_asset::Metadata>,
        user: address,
        amount: u64
    ) acquires VaultLockupRegistry {
        let store_addr = primary_fungible_store::primary_store_address<fungible_asset::Metadata>(user, share_metadata);
        let store = object::address_to_object<fungible_asset::FungibleStore>(store_addr);

        // Verify sufficient unlocked balance
        let unlocked = get_unlocked_balance<fungible_asset::FungibleStore>(share_metadata, store);
        assert!(amount <= unlocked, 3);

        // Add to pending redemption amount
        let metadata_addr = object::object_address<fungible_asset::Metadata>(&share_metadata);
        let registry = borrow_global_mut<VaultLockupRegistry>(metadata_addr);

        if (!table::contains<address, PrimaryStoreLockups>(&registry.primary_store_lockups, store_addr)) {
            let empty_lockups = PrimaryStoreLockups::V1 {
                contribution_lockup_entries: vector::empty<LockedEntry>(),
                pending_redemption_amount: 0,
            };
            table::add<address, PrimaryStoreLockups>(&mut registry.primary_store_lockups, store_addr, empty_lockups);
        };

        let lockups = table::borrow_mut<address, PrimaryStoreLockups>(
            &mut registry.primary_store_lockups,
            store_addr
        );
        lockups.pending_redemption_amount = lockups.pending_redemption_amount + amount;
    }

    // ============================================================================
    // SHARE MINTING
    // ============================================================================

    /// Mint shares and deposit with lockup
    ///
    /// # Returns
    /// Unlock timestamp for the lockup entry
    friend fun mint_and_deposit_with_lockup(
        share_metadata: object::Object<fungible_asset::Metadata>,
        recipient: address,
        amount: u64
    ): u64 acquires VaultLockupRegistry, VaultShareConfig {
        let metadata_addr = object::object_address<fungible_asset::Metadata>(&share_metadata);
        let config = borrow_global<VaultShareConfig>(metadata_addr);

        // Mint new shares
        let shares = fungible_asset::mint(&config.mint_ref, amount);

        // Get store address before depositing
        let store_addr = primary_fungible_store::primary_store_address<fungible_asset::Metadata>(
            recipient,
            share_metadata
        );

        // Deposit to recipient
        primary_fungible_store::deposit(recipient, shares);

        // Add lockup entry
        let lockup_duration = config.contribution_lockup_duration_s;
        add_lockup_entry(share_metadata, store_addr, amount, lockup_duration)
    }

    /// Mint shares and deposit without lockup (for fee distribution)
    friend fun mint_and_deposit_without_lockup(
        share_metadata: object::Object<fungible_asset::Metadata>,
        recipient: address,
        amount: u64
    ) acquires VaultShareConfig {
        let metadata_addr = object::object_address<fungible_asset::Metadata>(&share_metadata);
        let config = borrow_global<VaultShareConfig>(metadata_addr);
        let shares = fungible_asset::mint(&config.mint_ref, amount);
        primary_fungible_store::deposit(recipient, shares);
    }

    // ============================================================================
    // DISPATCHABLE ASSET HOOK
    // ============================================================================

    /// Custom withdrawal function enforcing lockups
    ///
    /// This is the dispatch hook registered with the fungible asset.
    /// It ensures users can only withdraw unlocked shares.
    public fun vault_share_withdraw<T: key>(
        store: object::Object<T>,
        amount: u64,
        transfer_ref: &fungible_asset::TransferRef
    ): fungible_asset::FungibleAsset acquires VaultLockupRegistry {
        let store_addr = object::object_address<T>(&store);
        let metadata = fungible_asset::store_metadata<T>(store);

        // Verify sufficient unlocked balance
        assert!(get_unlocked_balance<T>(metadata, store) >= amount, 3);

        // Clean up expired lockup entries
        let metadata_addr = object::object_address<fungible_asset::Metadata>(&metadata);
        cleanup_expired_entries(metadata_addr, store_addr);

        // Perform the withdrawal
        fungible_asset::withdraw_with_ref<T>(transfer_ref, store, amount)
    }
}
