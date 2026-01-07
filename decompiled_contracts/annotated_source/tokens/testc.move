/// ============================================================================
/// Module: testc
/// Description: Test token (TESTC) for development and testing
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module implements a simple test token (TESTC) used for development
/// and testing purposes on the Decibel platform.
///
/// Unlike USDC, this token:
/// - Has no admin restrictions
/// - Anyone can mint any amount
/// - No rate limiting
///
/// Token Details:
/// - Symbol: TESTC
/// - Decimals: 6
/// - No icon/project URLs
/// ============================================================================

module decibel::testc {
    use aptos_framework::fungible_asset::{Self, FungibleAsset, MintRef, BurnRef, TransferRef, Metadata};
    use aptos_framework::object::{Self, Object};
    use aptos_framework::primary_fungible_store;
    use aptos_framework::option;
    use aptos_framework::string;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// Object seed for creating the TESTC named object
    const TESTC_SEED: vector<u8> = b"TESTC";  // [84, 69, 83, 84, 67]

    // =========================================================================
    // TYPES
    // =========================================================================

    /// Core TESTC token references
    /// Stores the capabilities needed to mint/burn/transfer
    struct TESTCRef has key {
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

    /// Returns the TESTC metadata object
    ///
    /// # Returns
    /// Object<Metadata> for the TESTC fungible asset
    public fun metadata(): Object<Metadata> acquires TESTCRef {
        borrow_global<TESTCRef>(@decibel).metadata
    }

    /// Returns the TESTC balance of an address
    ///
    /// # Arguments
    /// * `owner` - Address to check balance for
    ///
    /// # Returns
    /// Balance in TESTC smallest units (6 decimals)
    public fun balance(owner: address): u64 acquires TESTCRef {
        let testc_metadata = borrow_global<TESTCRef>(@decibel).metadata;
        primary_fungible_store::balance<Metadata>(owner, testc_metadata)
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS
    // =========================================================================

    /// Burns TESTC from an address
    ///
    /// # Arguments
    /// * `from` - Address to burn from
    /// * `amount` - Amount to burn (6 decimals)
    public fun burn(from: address, amount: u64) acquires TESTCRef {
        let testc_ref = borrow_global<TESTCRef>(@decibel);
        let testc_metadata = testc_ref.metadata;
        let store = primary_fungible_store::ensure_primary_store_exists<Metadata>(from, testc_metadata);
        fungible_asset::burn_from(&testc_ref.burn_ref, store, amount);
    }

    /// Transfers TESTC between addresses
    ///
    /// # Arguments
    /// * `sender` - Signer sending the tokens
    /// * `recipient` - Address receiving tokens
    /// * `amount` - Amount to transfer (6 decimals)
    public fun transfer(sender: &signer, recipient: address, amount: u64) acquires TESTCRef {
        let testc_metadata = borrow_global<TESTCRef>(@decibel).metadata;
        primary_fungible_store::transfer<Metadata>(sender, testc_metadata, recipient, amount);
    }

    /// Deposits TESTC fungible asset to an address's primary store
    public fun deposit(to: address, asset: FungibleAsset) {
        primary_fungible_store::deposit(to, asset);
    }

    /// Mints TESTC to an address (permissionless)
    ///
    /// Unlike USDC, anyone can mint any amount of TESTC.
    /// This is intentional for testing purposes.
    ///
    /// # Arguments
    /// * `recipient` - Address to receive tokens
    /// * `amount` - Amount to mint (6 decimals)
    public fun mint(recipient: address, amount: u64) acquires TESTCRef {
        let testc_ref = borrow_global<TESTCRef>(@decibel);
        primary_fungible_store::mint(&testc_ref.mint_ref, recipient, amount);
    }

    /// Withdraws TESTC from sender's primary store
    ///
    /// # Arguments
    /// * `sender` - Signer withdrawing tokens
    /// * `amount` - Amount to withdraw (6 decimals)
    ///
    /// # Returns
    /// FungibleAsset containing the withdrawn TESTC
    public fun withdraw(sender: &signer, amount: u64): FungibleAsset acquires TESTCRef {
        let testc_metadata = borrow_global<TESTCRef>(@decibel).metadata;
        primary_fungible_store::withdraw<Metadata>(sender, testc_metadata, amount)
    }

    // =========================================================================
    // INTERNAL FUNCTIONS
    // =========================================================================

    /// Module initialization - called once on publish
    fun init_module(deployer: &signer) {
        setup_testc(deployer);
    }

    /// Sets up the TESTC fungible asset
    ///
    /// Creates:
    /// - Named object for TESTC with metadata
    /// - TESTCRef with mint/burn/transfer capabilities
    public fun setup_testc(deployer: &signer) {
        // Create named object for TESTC
        let constructor_ref = object::create_named_object(deployer, TESTC_SEED);

        // Create fungible asset with minimal metadata
        // name: "TESTC", symbol: "TESTC", decimals: 6
        // No icon or project URLs (empty strings)
        primary_fungible_store::create_primary_store_enabled_fungible_asset(
            &constructor_ref,
            option::none<u128>(),  // No max supply
            string::utf8(b"TESTC"),
            string::utf8(b"TESTC"),
            6u8,  // 6 decimal places (same as USDC)
            string::utf8(b""),  // No icon
            string::utf8(b"")   // No project URL
        );

        // Note: object address is generated but not used directly
        let _object_addr = object::address_from_constructor_ref(&constructor_ref);

        // Generate capability refs
        let mint_ref = fungible_asset::generate_mint_ref(&constructor_ref);
        let burn_ref = fungible_asset::generate_burn_ref(&constructor_ref);
        let transfer_ref = fungible_asset::generate_transfer_ref(&constructor_ref);
        let metadata = object::object_from_constructor_ref<Metadata>(&constructor_ref);

        // Store TESTC refs
        let testc_ref = TESTCRef {
            mint_ref,
            burn_ref,
            transfer_ref,
            metadata,
        };
        move_to(deployer, testc_ref);
    }
}
