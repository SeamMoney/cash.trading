/// ============================================================================
/// Module: fee_treasury
/// Description: Central vault for collecting trading fees
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module manages the protocol's fee treasury - a secure vault that:
/// - Collects trading fees from executed orders
/// - Holds fees until distributed to stakeholders
/// - Provides controlled withdrawal for fee distribution
///
/// The treasury is implemented as a Move object with its own fungible store,
/// allowing it to hold and manage the collateral asset (USDC) securely.
///
/// Access Control:
/// - fee_distribution: Can deposit and withdraw fees
/// - accounts_collateral: Can deposit fees during settlement
/// ============================================================================

module decibel::fee_treasury {
    use aptos_framework::object::{Self, Object, ExtendRef};
    use aptos_framework::fungible_asset::{Self, FungibleAsset, FungibleStore, Metadata};
    use aptos_framework::signer;
    use aptos_framework::primary_fungible_store;
    use aptos_framework::error;
    use aptos_framework::dispatchable_fungible_asset;

    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================

    /// Fee distribution module handles distributing collected fees
    friend decibel::fee_distribution;

    /// Accounts collateral module deposits fees during trade settlement
    friend decibel::accounts_collateral;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// Contract address for permission checks
    const DECIBEL_ADDRESS: address = @0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844;

    /// Object seed for creating the fee vault
    const FEE_VAULT_SEED: vector<u8> = b"fee_vault";  // [102, 101, 101, 95, 118, 97, 117, 108, 116]

    /// Error codes
    const E_ZERO_AMOUNT: u64 = 1;
    const E_ASSET_TYPE_MISMATCH: u64 = 14566554180833181696;  // Custom error for wrong asset
    const E_UNAUTHORIZED: u64 = 3;

    // =========================================================================
    // TYPES
    // =========================================================================

    /// Fee vault storage
    /// Holds collected trading fees until distribution
    enum FeeVault has store, key {
        V1 {
            /// The type of asset this vault holds (USDC metadata)
            asset_type: Object<Metadata>,
            /// The fungible store holding the actual assets
            store: Object<FungibleStore>,
            /// ExtendRef to generate signers for withdrawals
            store_extend_ref: ExtendRef,
        }
    }

    // =========================================================================
    // PUBLIC VIEW FUNCTIONS
    // =========================================================================

    /// Returns the current balance of the fee treasury
    ///
    /// # Returns
    /// Total fees held in the treasury (6 decimals for USDC)
    public fun get_balance(): u64 acquires FeeVault {
        let vault = borrow_global<FeeVault>(DECIBEL_ADDRESS);
        fungible_asset::balance<FungibleStore>(vault.store)
    }

    // =========================================================================
    // FRIEND FUNCTIONS
    // =========================================================================

    /// Initializes the fee treasury
    ///
    /// # Arguments
    /// * `admin` - Must be the contract admin
    /// * `asset_metadata` - The collateral asset type (USDC)
    ///
    /// # Effects
    /// - Creates a named object for the fee vault
    /// - Sets up a primary fungible store for holding fees
    ///
    /// # Permissions
    /// Only callable by contract admin during initialization
    friend fun initialize(
        admin: &signer,
        asset_metadata: Object<Metadata>
    ) {
        // Verify caller is contract admin
        if (signer::address_of(admin) != DECIBEL_ADDRESS) {
            abort error::invalid_argument(E_UNAUTHORIZED)
        };

        // Create named object for the fee vault
        let constructor_ref = object::create_named_object(admin, FEE_VAULT_SEED);
        let extend_ref = object::generate_extend_ref(&constructor_ref);

        // Create primary fungible store at the vault's address
        let vault_addr = object::address_from_constructor_ref(&constructor_ref);
        let store = primary_fungible_store::ensure_primary_store_exists<Metadata>(
            vault_addr,
            asset_metadata
        );

        // Store the vault configuration
        let vault = FeeVault::V1 {
            asset_type: asset_metadata,
            store,
            store_extend_ref: extend_ref,
        };
        move_to(admin, vault);
    }

    /// Deposits fees into the treasury
    ///
    /// # Arguments
    /// * `fees` - FungibleAsset containing the fees to deposit
    ///
    /// # Requirements
    /// - Asset must match vault's asset type (USDC)
    /// - Amount must be greater than 0
    ///
    /// # Used By
    /// - Trade settlement (accounts_collateral)
    /// - Position closing with fees
    friend fun deposit_fees(fees: FungibleAsset) acquires FeeVault {
        let vault = borrow_global<FeeVault>(DECIBEL_ADDRESS);

        // Verify asset type matches
        let incoming_asset_type = fungible_asset::metadata_from_asset(&fees);
        assert!(incoming_asset_type == vault.asset_type, E_ASSET_TYPE_MISMATCH);

        // Verify non-zero amount
        if (fungible_asset::amount(&fees) == 0) {
            abort error::invalid_argument(E_ZERO_AMOUNT)
        };

        // Deposit to vault's store using dispatchable FA for compatibility
        dispatchable_fungible_asset::deposit<FungibleStore>(vault.store, fees);
    }

    /// Withdraws fees from the treasury
    ///
    /// # Arguments
    /// * `amount` - Amount to withdraw (6 decimals for USDC)
    ///
    /// # Returns
    /// FungibleAsset containing the withdrawn fees
    ///
    /// # Requirements
    /// - Amount must be greater than 0
    /// - Treasury must have sufficient balance
    ///
    /// # Used By
    /// - Fee distribution to protocol stakeholders
    /// - Admin withdrawals (if implemented)
    friend fun withdraw_fees(amount: u64): FungibleAsset acquires FeeVault {
        // Verify non-zero amount
        if (amount == 0) {
            abort error::invalid_argument(E_ZERO_AMOUNT)
        };

        let vault = borrow_global<FeeVault>(DECIBEL_ADDRESS);

        // Generate signer for withdrawal using extend_ref
        let vault_signer = object::generate_signer_for_extending(&vault.store_extend_ref);

        // Withdraw from vault's store
        dispatchable_fungible_asset::withdraw<FungibleStore>(&vault_signer, vault.store, amount)
    }
}
