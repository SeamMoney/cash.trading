/// ============================================================================
/// DEX ACCOUNTS VAULT EXTENSION - Vault Integration for Trading Accounts
/// ============================================================================
///
/// This module extends the DEX accounts system to allow direct vault
/// interactions from trading subaccounts. Users can contribute to and
/// redeem from vaults without withdrawing funds to their wallet first.
///
/// KEY FEATURES:
///
/// 1. CONTRIBUTE TO VAULT:
///    - Withdraw collateral from trading account
///    - Directly contribute to a vault
///    - Receive vault shares
///
/// 2. REDEEM FROM VAULT:
///    - Initiate vault share redemption
///    - Receive USDC directly to trading account
///    - Supports async redemption flow
///
/// CALLBACK ARCHITECTURE:
///
/// This module uses function callbacks to decouple from the vault module,
/// allowing the vault system to be deployed independently. Callbacks are
/// registered during initialization and stored globally.
///
/// PERMISSIONS:
///
/// Uses the subaccount permission system:
/// - Owner can always interact
/// - Delegated signers with vault_trading permission can interact
///
/// ============================================================================

module decibel::dex_accounts_vault_extension {
    use std::signer;
    use std::object;
    use std::fungible_asset;

    use decibel::dex_accounts;
    use decibel::perp_engine;

    // ============================================================================
    // ERROR CODES
    // ============================================================================

    /// Caller is not the protocol deployer
    const ENOT_DEPLOYER: u64 = 1;

    /// Callbacks already registered
    const ECALLBACKS_ALREADY_REGISTERED: u64 = 2;

    /// Callbacks not registered
    const ECALLBACKS_NOT_REGISTERED: u64 = 3;

    // ============================================================================
    // CORE STRUCTURES
    // ============================================================================

    /// External callback functions for vault interactions
    ///
    /// These callbacks are registered by the vault module and allow this
    /// extension to call vault functions without direct dependencies.
    enum ExternalCallbacks has key {
        V1 {
            /// Callback to contribute funds to a vault
            /// Parameters: (signer, vault_address, fungible_assets)
            vault_contribute_funds_f: |&signer, address, fungible_asset::FungibleAsset|
                has copy + drop + store,

            /// Callback to redeem shares and deposit USDC to DEX
            /// Parameters: (signer, vault_address, share_amount)
            vault_redeem_and_deposit_to_dex_f: |&signer, address, u64|
                has copy + drop + store,
        }
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Register vault callback functions
    ///
    /// Called by the vault module during initialization to register its
    /// callback functions. This enables vault interactions from trading accounts.
    ///
    /// # Parameters
    /// - `deployer`: Must be the protocol deployer
    /// - `contribute_callback`: Function to call for vault contributions
    /// - `redeem_callback`: Function to call for vault redemptions
    public fun register_vault_callbacks(
        deployer: &signer,
        contribute_callback: |&signer, address, fungible_asset::FungibleAsset| has copy + drop + store,
        redeem_callback: |&signer, address, u64| has copy + drop + store
    ) {
        assert!(signer::address_of(deployer) == @decibel, ENOT_DEPLOYER);

        // Ensure not already registered
        if (exists<ExternalCallbacks>(@decibel)) {
            abort ECALLBACKS_ALREADY_REGISTERED
        };

        let callbacks = ExternalCallbacks::V1 {
            vault_contribute_funds_f: contribute_callback,
            vault_redeem_and_deposit_to_dex_f: redeem_callback,
        };
        move_to<ExternalCallbacks>(deployer, callbacks);
    }

    // ============================================================================
    // VAULT INTERACTIONS
    // ============================================================================

    /// Contribute collateral from trading account to a vault
    ///
    /// Withdraws the specified amount of collateral from the trading account
    /// and contributes it to the specified vault. The user receives vault
    /// shares in their trading account.
    ///
    /// # Parameters
    /// - `caller`: The owner or delegated signer
    /// - `subaccount`: The trading subaccount object
    /// - `vault_address`: Address of the vault to contribute to
    /// - `collateral_metadata`: Metadata of the collateral token
    /// - `amount`: Amount of collateral to contribute
    ///
    /// # Permissions
    /// - Owner: Always allowed
    /// - Delegated: Requires vault_trading permission
    public entry fun contribute_to_vault(
        caller: &signer,
        subaccount: object::Object<dex_accounts::Subaccount>,
        vault_address: address,
        collateral_metadata: object::Object<fungible_asset::Metadata>,
        amount: u64
    ) acquires ExternalCallbacks {
        // Get subaccount signer (validates permissions)
        let subaccount_signer = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_vault_trading(
            caller,
            subaccount
        );

        // Withdraw collateral from trading account
        let collateral = perp_engine::withdraw_fungible(
            &subaccount_signer,
            collateral_metadata,
            amount
        );

        // Call vault contribute callback
        assert!(exists<ExternalCallbacks>(@decibel), ECALLBACKS_NOT_REGISTERED);
        let contribute_fn = *&borrow_global<ExternalCallbacks>(@decibel).vault_contribute_funds_f;
        contribute_fn(&subaccount_signer, vault_address, collateral);
    }

    /// Redeem vault shares and deposit proceeds to trading account
    ///
    /// Initiates redemption of vault shares. For vaults with async redemption,
    /// this queues the redemption. Once complete, USDC is deposited directly
    /// to the trading account.
    ///
    /// # Parameters
    /// - `caller`: The owner or delegated signer
    /// - `subaccount`: The trading subaccount object
    /// - `vault_address`: Address of the vault to redeem from
    /// - `share_amount`: Number of vault shares to redeem
    ///
    /// # Permissions
    /// - Owner: Always allowed
    /// - Delegated: Requires vault_trading permission
    public entry fun redeem_from_vault(
        caller: &signer,
        subaccount: object::Object<dex_accounts::Subaccount>,
        vault_address: address,
        share_amount: u64
    ) acquires ExternalCallbacks {
        // Get subaccount signer (validates permissions)
        let subaccount_signer = dex_accounts::get_subaccount_signer_if_owner_or_delegated_for_vault_trading(
            caller,
            subaccount
        );

        // Call vault redeem callback
        assert!(exists<ExternalCallbacks>(@decibel), ECALLBACKS_NOT_REGISTERED);
        let redeem_fn = *&borrow_global<ExternalCallbacks>(@decibel).vault_redeem_and_deposit_to_dex_f;
        redeem_fn(&subaccount_signer, vault_address, share_amount);
    }
}
