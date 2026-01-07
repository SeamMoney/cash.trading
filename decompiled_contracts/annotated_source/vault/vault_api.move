/// ============================================================================
/// VAULT API - Public Entry Points for Vault Operations
/// ============================================================================
///
/// This module provides the public API for interacting with vaults.
/// It serves as the entry point for:
/// - Creating vaults
/// - Contributing to vaults
/// - Redeeming shares
/// - Processing async requests
///
/// DESIGN PATTERN:
/// This module acts as a facade that coordinates between vault, async_vault_work,
/// and async_vault_engine modules. It registers callbacks with the DEX accounts
/// module for vault-specific deposit and redemption operations.
///
/// ============================================================================

module decibel::vault_api {
    use std::fungible_asset;
    use std::option;
    use std::object;
    use std::string;
    use std::signer;
    use std::primary_fungible_store;

    use decibel::dex_accounts_vault_extension;
    use decibel::vault;
    use decibel::dex_accounts;
    use decibel::async_vault_work;
    use decibel::async_vault_engine;

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Register vault callbacks with DEX accounts
    ///
    /// This allows DEX accounts to call into vault operations for:
    /// - Depositing funds from DEX to vault
    /// - Redeeming vault shares to DEX account
    fun init_module(deployer: &signer) {
        // Create lambda callbacks for contribute and redeem operations
        let contribute_callback = |contributor, vault_addr, funds|
            contribute_funds(contributor, vault_addr, funds);

        let redeem_callback = |redeemer, vault_addr, shares|
            redeem_and_deposit_to_dex(redeemer, vault_addr, shares);

        dex_accounts_vault_extension::register_vault_callbacks(
            deployer,
            contribute_callback,
            redeem_callback
        );
    }

    // ============================================================================
    // CONTRIBUTION CALLBACKS
    // ============================================================================

    /// Contribute funds to a vault (callback from DEX accounts)
    ///
    /// This is marked #[persistent] to allow it to be stored as a callback.
    #[persistent]
    friend fun contribute_funds(
        contributor: &signer,
        vault_addr: address,
        funds: fungible_asset::FungibleAsset
    ) {
        vault::contribute_funds(contributor, vault_addr, funds);
    }

    // ============================================================================
    // REDEMPTION CALLBACKS
    // ============================================================================

    /// Redeem shares and deposit assets to user's DEX account
    ///
    /// This is marked #[persistent] to allow it to be stored as a callback.
    #[persistent]
    fun redeem_and_deposit_to_dex(
        redeemer: &signer,
        vault_addr: address,
        shares: u64
    ) {
        let vault = object::address_to_object<vault::Vault>(vault_addr);
        redeem_internal(
            redeemer,
            vault,
            shares,
            true  // deposit_to_dex
        );
    }

    // ============================================================================
    // VAULT CREATION
    // ============================================================================

    /// Create a vault (internal helper)
    ///
    /// Creates vault object, registers with async work system, and returns vault object.
    friend fun create_vault(
        creator: &signer,
        existing_subaccount: option::Option<object::Object<dex_accounts::Subaccount>>,
        contribution_asset: object::Object<fungible_asset::Metadata>,
        name: string::String,
        description: string::String,
        social_links: vector<string::String>,
        symbol: string::String,
        icon_uri: string::String,
        project_uri: string::String,
        fee_bps: u64,
        fee_interval: u64,
        lockup_duration: u64
    ): object::Object<vault::Vault> {
        // Create the vault
        let (constructor, vault_signer) = vault::create_vault(
            creator,
            existing_subaccount,
            contribution_asset,
            name,
            description,
            social_links,
            symbol,
            icon_uri,
            project_uri,
            fee_bps,
            fee_interval,
            lockup_duration
        );

        let vault = object::object_from_constructor_ref<vault::Vault>(&constructor);

        // Register vault with async work system
        async_vault_work::register_vault(&vault_signer);

        vault
    }

    // ============================================================================
    // PUBLIC ENTRY POINTS
    // ============================================================================

    /// Process pending vault async requests
    ///
    /// This should be called periodically by keepers to process:
    /// - Pending redemptions
    /// - Position closing orders
    public entry fun process_pending_requests(max_iterations: u32) {
        async_vault_engine::process_pending_requests(max_iterations);
    }

    /// Create and fund a vault in a single transaction
    ///
    /// # Parameters
    /// - `creator`: The vault creator/admin
    /// - `existing_subaccount`: Optional existing DEX subaccount to use
    /// - `contribution_asset`: The asset type for contributions (e.g., USDC)
    /// - `name`: Vault name
    /// - `description`: Vault description
    /// - `social_links`: Social media links
    /// - `symbol`: Share token symbol
    /// - `icon_uri`: Icon URL
    /// - `project_uri`: Project URL
    /// - `fee_bps`: Performance fee in basis points
    /// - `fee_interval`: Minimum time between fee distributions (seconds)
    /// - `lockup_duration`: Contribution lockup period (seconds)
    /// - `initial_contribution`: Amount to contribute initially
    /// - `activate`: Whether to activate vault immediately
    /// - `delegate_to_self`: Whether to delegate trading to creator
    public entry fun create_and_fund_vault(
        creator: &signer,
        existing_subaccount: option::Option<object::Object<dex_accounts::Subaccount>>,
        contribution_asset: object::Object<fungible_asset::Metadata>,
        name: string::String,
        description: string::String,
        social_links: vector<string::String>,
        symbol: string::String,
        icon_uri: string::String,
        project_uri: string::String,
        fee_bps: u64,
        fee_interval: u64,
        lockup_duration: u64,
        initial_contribution: u64,
        activate: bool,
        delegate_to_self: bool
    ) {
        // Auto-detect existing subaccount if not provided
        let subaccount_opt = existing_subaccount;
        if (option::is_none<object::Object<dex_accounts::Subaccount>>(&subaccount_opt)) {
            let creator_addr = signer::address_of(creator);
            let primary_subaccount_addr = dex_accounts::primary_subaccount(creator_addr);

            if (object::object_exists<dex_accounts::Subaccount>(primary_subaccount_addr)) {
                subaccount_opt = option::some<object::Object<dex_accounts::Subaccount>>(
                    object::address_to_object<dex_accounts::Subaccount>(primary_subaccount_addr)
                );
            } else {
                subaccount_opt = option::none<object::Object<dex_accounts::Subaccount>>();
            };
        };

        // Create the vault
        let vault = create_vault(
            creator,
            subaccount_opt,
            contribution_asset,
            name,
            description,
            social_links,
            symbol,
            icon_uri,
            project_uri,
            fee_bps,
            fee_interval,
            lockup_duration
        );

        // Make initial contribution if specified
        if (initial_contribution > 0) {
            let contribution_asset_type = vault::get_vault_contribution_asset_type(vault);
            let creator_addr = signer::address_of(creator);

            // Withdraw from subaccount if primary store doesn't have enough
            let needs_withdrawal = option::is_some<object::Object<dex_accounts::Subaccount>>(&subaccount_opt) &&
                primary_fungible_store::balance<fungible_asset::Metadata>(creator_addr, contribution_asset_type) < initial_contribution;

            if (needs_withdrawal) {
                let subaccount = option::destroy_some<object::Object<dex_accounts::Subaccount>>(subaccount_opt);
                dex_accounts::withdraw_from_subaccount_request(
                    creator,
                    subaccount,
                    contribution_asset_type,
                    initial_contribution
                );
            };

            vault::contribute(creator, vault, initial_contribution);
        };

        // Activate if requested
        if (activate) {
            vault::activate_vault(creator, vault, 0);
        };

        // Delegate trading permissions to creator if requested
        if (delegate_to_self) {
            let creator_addr = signer::address_of(creator);
            vault::delegate_dex_actions_to(
                creator,
                vault,
                creator_addr,
                option::none<u64>()  // No expiration
            );
        };
    }

    // ============================================================================
    // REDEMPTION
    // ============================================================================

    /// Internal redemption logic
    ///
    /// Attempts synchronous redemption first. If that fails (due to positions
    /// needing to be closed), queues an async progress request.
    fun redeem_internal(
        redeemer: &signer,
        vault: object::Object<vault::Vault>,
        shares: u64,
        deposit_to_dex: bool
    ) {
        assert!(shares > 0, 1);

        let user = signer::address_of(redeemer);

        // Try to complete redemption immediately
        let success = async_vault_work::request_redemption(
            user,
            vault,
            shares,
            deposit_to_dex
        );

        if (!success) {
            // Redemption couldn't complete immediately (likely needs position closing)
            // Queue async progress to handle it
            async_vault_engine::queue_vault_progress_if_needed(vault);
        };
    }
}
