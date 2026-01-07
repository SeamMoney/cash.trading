/// ============================================================================
/// VAULT - Core Vault Functionality
/// ============================================================================
///
/// This module implements managed investment vaults for the Decibel DEX.
/// Vaults allow users to pool capital under professional management while
/// maintaining transparency and automated fee distribution.
///
/// KEY FEATURES:
/// - Contribution/Redemption: Deposit assets, receive shares, redeem for assets
/// - Performance Fees: Vault managers earn fees on profits
/// - Activation Flow: Vaults must meet minimum NAV before accepting deposits
/// - Position Management: Automatic position closing for redemptions
/// - Delegation: Vault admins can delegate trading to other addresses
///
/// VAULT LIFECYCLE:
/// 1. Creation: Admin creates vault with fee/lockup parameters
/// 2. Funding: Admin deposits initial capital
/// 3. Activation: Vault meets min NAV requirement, accepts contributions
/// 4. Operation: Trading, contributions, redemptions, fee distributions
///
/// FEE CALCULATION:
/// Performance fee is calculated based on NAV growth:
/// - fee_amount = (nav_increase) * fee_bps / 10000
/// - Shares are minted to fee recipient proportional to fee amount
///
/// ============================================================================

module decibel::vault {
    use std::object;
    use std::fungible_asset;
    use std::string;
    use std::event;
    use std::error;
    use std::signer;
    use std::option;
    use std::primary_fungible_store;
    use std::vector;

    use decibel::perp_market;
    use decibel::decibel_time;
    use decibel::vault_share_asset;
    use decibel::vault_global_config;
    use decibel::dex_accounts;
    use decibel::perp_engine;
    use decibel::position_view_types;
    use decibel::slippage_math;
    use econia::order_book_types;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::async_vault_work;
    friend decibel::vault_api;

    // ============================================================================
    // CORE STRUCTURES
    // ============================================================================

    /// Main vault resource containing all vault state
    enum Vault has key {
        V1 {
            /// Admin who controls the vault
            admin: address,
            /// Extension reference for vault operations
            vault_ref: object::ExtendRef,
            /// Asset type for contributions (e.g., USDC)
            contribution_asset_type: object::Object<fungible_asset::Metadata>,
            /// Share token definition
            share_def: VaultShareDef,
            /// Configuration for contributions
            contribution_config: VaultContributionConfig,
            /// Fee configuration
            fee_config: VaultFeeConfig,
            /// Current fee state (last distribution)
            fee_state: VaultFeeState,
            /// Trading portfolio (subaccount)
            portfolio: VaultPortfolio,
        }
    }

    /// Definition of the vault's share token
    enum VaultShareDef has store {
        V1 {
            /// The fungible asset representing vault shares
            share_asset_type: object::Object<fungible_asset::Metadata>,
        }
    }

    /// Configuration for vault contributions
    enum VaultContributionConfig has store {
        V1 {
            /// Maximum share supply when accepting contributions
            max_outstanding_shares_when_contributing: u64,
            /// Whether vault accepts external contributions
            accepts_contributions: bool,
            /// Lockup duration for new contributions (seconds)
            contribution_lockup_duration_s: u64,
        }
    }

    /// Configuration for vault performance fees
    enum VaultFeeConfig has store {
        V1 {
            /// Performance fee in basis points
            fee_bps: u64,
            /// Address to receive fees
            fee_recipient: address,
            /// Minimum time between fee distributions (seconds)
            fee_interval_s: u64,
        }
    }

    /// State tracking for fee distribution
    enum VaultFeeState has store {
        V1 {
            /// Timestamp of last fee distribution
            last_fee_distribution_time_s: u64,
            /// NAV at last fee distribution
            last_fee_distribution_nav: u64,
            /// Share count at last fee distribution
            last_fee_distribution_shares: u64,
        }
    }

    /// Vault's trading portfolio
    enum VaultPortfolio has drop, store {
        V1 {
            /// Primary DEX subaccount for trading
            dex_primary_subaccount: address,
        }
    }

    /// External callback for depositing funds
    enum ExternalCallbacks has key {
        V1 {
            /// Callback function to deposit funds to DEX
            deposit_funds_to_dex_f: |address, fungible_asset::FungibleAsset| has copy + drop + store,
        }
    }

    /// Reference to an active order
    struct OrderRef has copy, drop, store {
        /// Market the order is on
        market: object::Object<perp_market::PerpMarket>,
        /// Order ID
        order_id: order_book_types::OrderIdType,
    }

    /// Vault metadata (name, description, links)
    enum VaultMetadata has key {
        V1 {
            vault_name: string::String,
            vault_description: string::String,
            vault_social_links: vector<string::String>,
        }
    }

    // ============================================================================
    // EVENTS
    // ============================================================================

    /// Emitted when a user contributes to a vault
    enum ContributionEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            user: address,
            assets_contributed: u64,
            shares_received: u64,
            unlock_time_s: u64,
        }
    }

    /// Emitted when fees are distributed
    enum FeeDistributionEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            fee_recipient: address,
            previous_nav: u64,
            previous_shares: u64,
            current_nav: u64,
            current_shares: u64,
            fee_amount: u64,
            shares_received: u64,
        }
    }

    /// Emitted when user initiates redemption
    enum RedeemptionInitiatedEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            user: address,
            shares_to_redeem: u64,
        }
    }

    /// Emitted when redemption completes
    enum RedeemptionSettledEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            user: address,
            shares_redeemed: u64,
            assets_received: u64,
        }
    }

    /// Emitted when vault is activated
    enum VaultActivatedEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            num_shares: u64,
            nav: u64,
        }
    }

    /// Emitted when vault admin changes
    enum VaultAdminChangedEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            admin: address,
            new_admin: address,
        }
    }

    /// Emitted when contribution config is updated
    enum VaultContributionConfigUpdatedEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            max_outstanding_shares_when_contributing: u64,
            contribution_lockup_duration_s: u64,
        }
    }

    /// Emitted when vault is created
    enum VaultCreatedEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            creator: address,
            vault_name: string::String,
            vault_description: string::String,
            vault_social_links: vector<string::String>,
            vault_share_symbol: string::String,
            contribution_asset_type: object::Object<fungible_asset::Metadata>,
            share_asset_type: object::Object<fungible_asset::Metadata>,
            fee_bps: u64,
            fee_interval_s: u64,
            contribution_lockup_duration_s: u64,
        }
    }

    /// Emitted when fee config is updated
    enum VaultFeeConfigUpdatedEvent has drop, store {
        V1 {
            vault: object::Object<Vault>,
            fee_bps: u64,
            fee_recipient: address,
            fee_interval_s: u64,
        }
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Initialize external callbacks on module load
    fun init_module(deployer: &signer) {
        register_external_callbacks(deployer);
    }

    /// Register callback for depositing funds to DEX
    friend fun register_external_callbacks(deployer: &signer) {
        let callbacks = ExternalCallbacks::V1 {
            deposit_funds_to_dex_f: dex_accounts::get_deposit_funds_to_subaccount_address_method(deployer),
        };
        move_to<ExternalCallbacks>(deployer, callbacks);
    }

    // ============================================================================
    // FEE DISTRIBUTION
    // ============================================================================

    /// Distribute performance fees to vault manager
    ///
    /// Can only be called if:
    /// - Vault is active (accepts_contributions = true)
    /// - Fee interval has passed since last distribution
    /// - Vault has positive fee_bps configured
    ///
    /// Fee calculation:
    /// 1. Compare current NAV/shares ratio to previous
    /// 2. Calculate NAV increase per share
    /// 3. Apply fee_bps to get fee amount
    /// 4. Mint shares to fee recipient
    public entry fun distribute_fees(vault: object::Object<Vault>)
        acquires Vault
    {
        let vault_addr = object::object_address<Vault>(&vault);
        let vault_data = borrow_global_mut<Vault>(vault_addr);

        // Vault must be active
        assert!(vault_data.contribution_config.accepts_contributions, 14566554180833181696);

        // Must have fees configured
        if (!(vault_data.fee_config.fee_bps > 0)) {
            abort error::invalid_argument(15)
        };

        // Check fee interval has passed
        let last_distribution = vault_data.fee_state.last_fee_distribution_time_s;
        let current_time = decibel_time::now_seconds();
        let min_next_distribution = last_distribution + vault_data.fee_config.fee_interval_s;

        if (!(current_time >= min_next_distribution)) {
            abort error::invalid_argument(8)
        };

        // Get current NAV and share count
        let current_nav = get_nav_in_contribution_asset(vault_data);
        let current_shares = get_num_shares(vault_data);
        let previous_nav = vault_data.fee_state.last_fee_distribution_nav;
        let previous_shares = vault_data.fee_state.last_fee_distribution_shares;

        assert!(current_shares > 0, 14566554180833181696);
        assert!(previous_shares > 0, 14566554180833181696);

        // Calculate if there's been value appreciation
        // Compare: current_nav / current_shares vs previous_nav / previous_shares
        // Cross multiply: current_nav * previous_shares vs previous_nav * current_shares
        let current_value_ratio = (current_nav as u128) * (previous_shares as u128);
        let previous_value_ratio = (previous_nav as u128) * (current_shares as u128);

        let fee_amount: u64;
        let shares_to_mint: u64;

        if (current_value_ratio > previous_value_ratio) {
            // Calculate NAV increase (normalized to same share base)
            let nav_increase: u64;
            if (current_shares > previous_shares) {
                // More shares now - normalize current NAV to previous share count
                let normalized = ((current_nav as u128) * (previous_shares as u128)) / (current_shares as u128);
                if (current_shares == 0) {
                    abort error::invalid_argument(4)
                };
                nav_increase = (normalized as u64) - previous_nav;
            } else {
                // Fewer or same shares - normalize previous NAV to current share count
                if (previous_shares != 0) {
                    let normalized = ((previous_nav as u128) * (current_shares as u128)) / (previous_shares as u128);
                    nav_increase = current_nav - (normalized as u64);
                } else {
                    abort error::invalid_argument(4)
                };
            };

            // Calculate fee amount
            let fee_bps = vault_data.fee_config.fee_bps;
            fee_amount = (((nav_increase as u128) * (fee_bps as u128)) / 10000u128) as u64;

            if (fee_amount > 0) {
                // Calculate shares to mint for fee recipient
                // shares_to_mint = fee_amount * current_shares / (current_nav - fee_amount)
                let nav_after_fee = current_nav - fee_amount;
                if (nav_after_fee != 0) {
                    shares_to_mint = (((fee_amount as u128) * (current_shares as u128)) / (nav_after_fee as u128)) as u64;

                    if (shares_to_mint > 0) {
                        vault_share_asset::mint_and_deposit_without_lockup(
                            vault_data.share_def.share_asset_type,
                            vault_data.fee_config.fee_recipient,
                            shares_to_mint
                        );
                    };
                } else {
                    abort error::invalid_argument(4)
                };
            } else {
                fee_amount = 0;
                shares_to_mint = 0;
            };
        } else {
            // No appreciation
            fee_amount = 0;
            shares_to_mint = 0;
        };

        // Emit fee distribution event
        event::emit<FeeDistributionEvent>(FeeDistributionEvent::V1 {
            vault,
            fee_recipient: vault_data.fee_config.fee_recipient,
            previous_nav,
            previous_shares,
            current_nav,
            current_shares,
            fee_amount,
            shares_received: shares_to_mint,
        });

        // Update fee state
        vault_data.fee_state.last_fee_distribution_nav = current_nav;
        vault_data.fee_state.last_fee_distribution_shares = current_shares;
        vault_data.fee_state.last_fee_distribution_time_s = current_time;
    }

    // ============================================================================
    // NAV CALCULATION
    // ============================================================================

    /// Get NAV in contribution asset terms
    fun get_nav_in_contribution_asset(vault_data: &Vault): u64 {
        let nav_primary = get_nav_in_primary_asset(vault_data);
        convert_nav_from_primary_to_contribution_asset(vault_data, nav_primary)
    }

    /// Get total share count
    fun get_num_shares(vault_data: &Vault): u64 {
        let supply = fungible_asset::supply<fungible_asset::Metadata>(vault_data.share_def.share_asset_type);
        option::destroy_some<u128>(supply) as u64
    }

    /// Get NAV in primary asset (USDC) terms
    fun get_nav_in_primary_asset(vault_data: &Vault): u64 {
        let nav = perp_engine::get_account_net_asset_value_fungible(
            vault_data.portfolio.dex_primary_subaccount,
            true  // include_unrealized
        );

        if (!(nav >= 0i64)) {
            abort error::invalid_argument(3)  // Negative NAV
        };

        nav as u64
    }

    /// Convert NAV from primary asset to contribution asset
    /// Currently 1:1 since contribution is also USDC
    fun convert_nav_from_primary_to_contribution_asset(_vault_data: &Vault, nav: u64): u64 {
        nav
    }

    // ============================================================================
    // VAULT ACTIVATION
    // ============================================================================

    /// Activate a vault so it can accept contributions
    ///
    /// Requirements:
    /// - Caller must be vault admin
    /// - Contribution asset must be USDC
    /// - NAV must meet minimum funding requirement
    public entry fun activate_vault(
        admin: &signer,
        vault: object::Object<Vault>,
        additional_contribution: u64
    ) acquires Vault {
        // Make additional contribution if specified
        if (additional_contribution > 0) {
            contribute(admin, vault, additional_contribution);
        };

        let vault_addr = object::object_address<Vault>(&vault);
        let vault_data = borrow_global_mut<Vault>(vault_addr);

        // Verify caller is admin
        let caller = signer::address_of(admin);
        if (!(caller == vault_data.admin)) {
            abort error::invalid_argument(7)
        };

        // Verify contribution asset is USDC
        let primary_asset = perp_engine::primary_asset_metadata();
        if (!(primary_asset == vault_data.contribution_asset_type)) {
            abort error::invalid_argument(9)
        };

        // Verify minimum NAV requirement
        let requirements = vault_global_config::get_global_requirements_config();
        let current_nav = get_nav_in_primary_asset(vault_data);
        let min_nav = vault_global_config::get_min_funds_for_activation(&requirements);

        if (!(current_nav >= min_nav)) {
            abort error::invalid_argument(19)
        };

        // Activate the vault
        vault_data.contribution_config.accepts_contributions = true;

        let num_shares = get_num_shares(vault_data);
        let nav_contribution = convert_nav_from_primary_to_contribution_asset(vault_data, current_nav);

        if (!(nav_contribution > 0)) {
            abort error::invalid_argument(17)
        };
        if (!(num_shares > 0)) {
            abort error::invalid_argument(18)
        };

        event::emit<VaultActivatedEvent>(VaultActivatedEvent::V1 {
            vault,
            num_shares,
            nav: nav_contribution,
        });

        // Initialize fee state
        vault_data.fee_state.last_fee_distribution_time_s = decibel_time::now_seconds();
        vault_data.fee_state.last_fee_distribution_nav = nav_contribution;
        vault_data.fee_state.last_fee_distribution_shares = num_shares;
    }

    // ============================================================================
    // CONTRIBUTIONS
    // ============================================================================

    /// Contribute assets to vault and receive shares
    friend fun contribute(
        contributor: &signer,
        vault: object::Object<Vault>,
        amount: u64
    ) acquires Vault {
        assert!(amount > 0, 12);

        let vault_addr = object::object_address<Vault>(&vault);
        let vault_data = borrow_global<Vault>(vault_addr);

        // Withdraw contribution asset from user
        let contribution_asset = vault_data.contribution_asset_type;
        let funds = primary_fungible_store::withdraw<fungible_asset::Metadata>(
            contributor,
            contribution_asset,
            amount
        );

        contribute_verified_funds_internal(contributor, vault, vault_data, funds);
    }

    /// Internal contribution handling
    fun contribute_verified_funds_internal(
        contributor: &signer,
        vault: object::Object<Vault>,
        vault_data: &Vault,
        funds: fungible_asset::FungibleAsset
    ) {
        // Admin can always contribute, others need vault to accept contributions
        let caller = signer::address_of(contributor);
        let can_contribute = if (vault_data.admin == caller) {
            true
        } else {
            vault_data.contribution_config.accepts_contributions
        };
        assert!(can_contribute, 1);

        // Calculate shares to mint
        let assets_amount = fungible_asset::amount(&funds);
        let shares_to_mint = convert_new_assets_to_share_count(vault_data, assets_amount);

        // Check share cap
        let current_shares = get_num_shares(vault_data);
        let total_shares_after = shares_to_mint + current_shares;
        let max_shares = vault_data.contribution_config.max_outstanding_shares_when_contributing;
        assert!(total_shares_after <= max_shares, 16);

        // Deposit funds to vault's DEX subaccount
        let vault_signer = object::generate_signer_for_extending(&vault_data.vault_ref);
        dex_accounts::deposit_funds_to_subaccount_at(
            &vault_signer,
            vault_data.portfolio.dex_primary_subaccount,
            funds
        );

        // Mint shares with lockup
        let user = signer::address_of(contributor);
        let unlock_time = vault_share_asset::mint_and_deposit_with_lockup(
            vault_data.share_def.share_asset_type,
            user,
            shares_to_mint
        );

        event::emit<ContributionEvent>(ContributionEvent::V1 {
            vault,
            user,
            assets_contributed: assets_amount,
            shares_received: shares_to_mint,
            unlock_time_s: unlock_time,
        });
    }

    /// Contribute via fungible asset (called from vault_api)
    friend fun contribute_funds(
        contributor: &signer,
        vault_addr: address,
        funds: fungible_asset::FungibleAsset
    ) acquires Vault {
        let vault_data = borrow_global<Vault>(vault_addr);

        // Verify correct asset type
        let asset_type = fungible_asset::metadata_from_asset(&funds);
        assert!(asset_type == vault_data.contribution_asset_type, 2);
        assert!(fungible_asset::amount(&funds) > 0, 12);

        let vault = object::address_to_object<Vault>(vault_addr);
        contribute_verified_funds_internal(contributor, vault, vault_data, funds);
    }

    /// Convert contribution amount to share count
    fun convert_new_assets_to_share_count(vault_data: &Vault, assets: u64): u64 {
        let current_shares = get_num_shares(vault_data);

        // If no shares exist yet, 1:1 ratio
        if (current_shares == 0) {
            return assets
        };

        let current_nav = get_nav_in_contribution_asset(vault_data);
        if (!(current_nav > 0)) {
            abort error::invalid_argument(11)
        };

        // shares = assets * total_shares / nav
        if (current_nav == 0) {
            abort error::invalid_argument(4)
        };

        let shares = ((assets as u128) * (current_shares as u128)) / (current_nav as u128);
        shares as u64
    }

    /// Convert shares to asset amount
    fun convert_existing_shares_to_asset_amount(vault_data: &Vault, shares: u64): u64 {
        let total_shares = get_num_shares(vault_data);

        if (!(total_shares >= shares)) {
            abort error::invalid_argument(10)
        };

        let nav = get_nav_in_contribution_asset(vault_data);

        if (!(total_shares != 0)) {
            abort error::invalid_argument(4)
        };

        // assets = shares * nav / total_shares
        let assets = ((shares as u128) * (nav as u128)) / (total_shares as u128);
        assets as u64
    }

    // ============================================================================
    // VAULT CREATION
    // ============================================================================

    /// Create a new vault
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
    ): (object::ConstructorRef, signer) {
        // Handle creation fee
        let fee_config = vault_global_config::get_global_fee_config();
        let creation_fee = vault_global_config::get_creation_fee(&fee_config);

        let has_creation_fee = creation_fee > 0 &&
            vault_global_config::get_creation_fee_recipient(&fee_config) != @0x0;

        if (has_creation_fee) {
            let primary_asset = perp_engine::primary_asset_metadata();
            let caller_addr = signer::address_of(creator);

            // Withdraw from subaccount if primary store doesn't have enough
            let needs_withdrawal = option::is_some<object::Object<dex_accounts::Subaccount>>(&existing_subaccount) &&
                primary_fungible_store::balance<fungible_asset::Metadata>(caller_addr, primary_asset) < creation_fee;

            if (needs_withdrawal) {
                let subaccount = option::destroy_some<object::Object<dex_accounts::Subaccount>>(existing_subaccount);
                dex_accounts::withdraw_from_subaccount_request(creator, subaccount, primary_asset, creation_fee);
            };

            // Pay creation fee
            let fee_recipient = vault_global_config::get_creation_fee_recipient(&fee_config);
            primary_fungible_store::transfer<fungible_asset::Metadata>(
                creator,
                primary_asset,
                fee_recipient,
                creation_fee
            );
        };

        // Create vault object
        let constructor = vault_global_config::create_new_vault_object(&name);
        let extend_ref = object::generate_extend_ref(&constructor);
        let vault_signer = object::generate_signer_for_extending(&extend_ref);

        // Create share asset
        let decimals = fungible_asset::decimals<fungible_asset::Metadata>(contribution_asset);
        let share_asset = vault_share_asset::create_vault_shares(
            &vault_signer,
            name,
            symbol,
            icon_uri,
            project_uri,
            decimals,
            lockup_duration
        );

        let share_def = VaultShareDef::V1 { share_asset_type: share_asset };

        // Determine primary subaccount
        let primary_subaccount = if (option::is_some<object::Object<dex_accounts::Subaccount>>(&existing_subaccount)) {
            let subaccount = option::destroy_some<object::Object<dex_accounts::Subaccount>>(existing_subaccount);
            object::object_address<dex_accounts::Subaccount>(&subaccount)
        } else {
            signer::address_of(creator)
        };

        let admin = signer::address_of(creator);

        // Create vault configuration
        let contribution_config = VaultContributionConfig::V1 {
            max_outstanding_shares_when_contributing: 18446744073709551615,  // u64::MAX
            accepts_contributions: false,
            contribution_lockup_duration_s: lockup_duration,
        };

        let vault_fee_config = create_vault_fee_config(fee_bps, primary_subaccount, fee_interval);
        let vault_fee_state = create_vault_fee_state();
        let portfolio = create_vault_portfolio(&vault_signer);

        // Store vault data
        let vault_data = Vault::V1 {
            admin,
            vault_ref: extend_ref,
            contribution_asset_type: contribution_asset,
            share_def,
            contribution_config,
            fee_config: vault_fee_config,
            fee_state: vault_fee_state,
            portfolio,
        };
        move_to<Vault>(&vault_signer, vault_data);

        // Store metadata
        let metadata = VaultMetadata::V1 {
            vault_name: name,
            vault_description: description,
            vault_social_links: social_links,
        };
        move_to<VaultMetadata>(&vault_signer, metadata);

        let vault_obj = object::object_from_constructor_ref<Vault>(&constructor);

        event::emit<VaultCreatedEvent>(VaultCreatedEvent::V1 {
            vault: vault_obj,
            creator: admin,
            vault_name: name,
            vault_description: description,
            vault_social_links: social_links,
            vault_share_symbol: symbol,
            contribution_asset_type: contribution_asset,
            share_asset_type: share_asset,
            fee_bps,
            fee_interval_s: fee_interval,
            contribution_lockup_duration_s: lockup_duration,
        });

        (constructor, vault_signer)
    }

    /// Create validated fee config
    fun create_vault_fee_config(fee_bps: u64, fee_recipient: address, fee_interval: u64): VaultFeeConfig {
        let global_fee_config = vault_global_config::get_global_fee_config();
        let max_fee = vault_global_config::get_max_fee_bps(&global_fee_config);

        if (!(fee_bps <= max_fee)) {
            abort error::invalid_argument(4)
        };

        if (fee_bps == 0) {
            if (fee_interval != 0) {
                abort error::invalid_argument(5)
            };
        } else {
            // Validate fee interval
            let min_interval = vault_global_config::get_min_fee_interval(&global_fee_config);
            if (!(fee_interval >= min_interval)) {
                abort error::invalid_argument(5)
            };

            let max_interval = vault_global_config::get_max_fee_interval(&global_fee_config);
            if (!(fee_interval <= max_interval)) {
                abort error::invalid_argument(5)
            };
        };

        VaultFeeConfig::V1 { fee_bps, fee_recipient, fee_interval_s: fee_interval }
    }

    /// Create initial fee state
    fun create_vault_fee_state(): VaultFeeState {
        VaultFeeState::V1 {
            last_fee_distribution_time_s: 0,
            last_fee_distribution_nav: 0,
            last_fee_distribution_shares: 0,
        }
    }

    /// Create vault portfolio with DEX subaccount
    fun create_vault_portfolio(vault_signer: &signer): VaultPortfolio {
        let vault_addr = signer::address_of(vault_signer);
        VaultPortfolio::V1 {
            dex_primary_subaccount: dex_accounts::primary_subaccount(vault_addr),
        }
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    /// Change vault admin
    public entry fun change_admin(
        current_admin: &signer,
        vault: object::Object<Vault>,
        new_admin: address
    ) acquires Vault {
        let vault_addr = object::object_address<Vault>(&vault);
        let vault_data = borrow_global_mut<Vault>(vault_addr);

        let caller = signer::address_of(current_admin);
        if (!(caller == vault_data.admin)) {
            abort error::invalid_argument(7)
        };

        vault_data.admin = new_admin;

        event::emit<VaultAdminChangedEvent>(VaultAdminChangedEvent::V1 {
            vault,
            admin: caller,
            new_admin,
        });
    }

    /// Delegate DEX trading permissions
    public entry fun delegate_dex_actions_to(
        admin: &signer,
        vault: object::Object<Vault>,
        delegate: address,
        expiration: option::Option<u64>
    ) acquires Vault {
        let vault_addr = object::object_address<Vault>(&vault);
        let vault_data = borrow_global<Vault>(vault_addr);

        let caller = signer::address_of(admin);
        if (!(caller == vault_data.admin)) {
            abort error::invalid_argument(7)
        };

        let subaccount = vault_data.portfolio.dex_primary_subaccount;
        dex_accounts::delegate_onchain_account_permissions(
            &vault_data.vault_ref,
            subaccount,
            delegate,
            true,   // can_trade
            false,  // can_withdraw (false for security)
            true,   // can_update_positions
            true,   // can_update_orders
            expiration
        );
    }

    /// Update contribution lockup duration
    public entry fun update_vault_contribution_lockup_duration(
        admin: &signer,
        vault: object::Object<Vault>,
        new_duration: u64
    ) acquires Vault {
        let vault_addr = object::object_address<Vault>(&vault);
        let vault_data = borrow_global_mut<Vault>(vault_addr);

        let caller = signer::address_of(admin);
        if (!(caller == vault_data.admin)) {
            abort error::invalid_argument(7)
        };

        vault_data.contribution_config.contribution_lockup_duration_s = new_duration;

        event::emit<VaultContributionConfigUpdatedEvent>(VaultContributionConfigUpdatedEvent::V1 {
            vault,
            max_outstanding_shares_when_contributing: vault_data.contribution_config.max_outstanding_shares_when_contributing,
            contribution_lockup_duration_s: new_duration,
        });
    }

    /// Update fee recipient
    public entry fun update_vault_fee_recipient(
        admin: &signer,
        vault: object::Object<Vault>,
        new_recipient: address
    ) acquires Vault {
        let vault_addr = object::object_address<Vault>(&vault);
        let vault_data = borrow_global_mut<Vault>(vault_addr);

        let caller = signer::address_of(admin);
        if (!(caller == vault_data.admin)) {
            abort error::invalid_argument(7)
        };

        vault_data.fee_config.fee_recipient = new_recipient;

        event::emit<VaultFeeConfigUpdatedEvent>(VaultFeeConfigUpdatedEvent::V1 {
            vault,
            fee_bps: vault_data.fee_config.fee_bps,
            fee_recipient: new_recipient,
            fee_interval_s: vault_data.fee_config.fee_interval_s,
        });
    }

    /// Update max outstanding shares
    public entry fun update_vault_max_outstanding_shares(
        admin: &signer,
        vault: object::Object<Vault>,
        new_max: u64
    ) acquires Vault {
        let vault_addr = object::object_address<Vault>(&vault);
        let vault_data = borrow_global_mut<Vault>(vault_addr);

        let caller = signer::address_of(admin);
        if (!(caller == vault_data.admin)) {
            abort error::invalid_argument(7)
        };

        vault_data.contribution_config.max_outstanding_shares_when_contributing = new_max;

        event::emit<VaultContributionConfigUpdatedEvent>(VaultContributionConfigUpdatedEvent::V1 {
            vault,
            max_outstanding_shares_when_contributing: new_max,
            contribution_lockup_duration_s: vault_data.contribution_config.contribution_lockup_duration_s,
        });
    }

    // ============================================================================
    // PUBLIC VIEW FUNCTIONS
    // ============================================================================

    /// Get order reference market
    public fun get_order_ref_market(order_ref: &OrderRef): object::Object<perp_market::PerpMarket> {
        order_ref.market
    }

    /// Get order reference order ID
    public fun get_order_ref_order_id(order_ref: &OrderRef): order_book_types::OrderIdType {
        order_ref.order_id
    }

    /// Get vault admin address
    public fun get_vault_admin(vault: object::Object<Vault>): address acquires Vault {
        let vault_addr = object::object_address<Vault>(&vault);
        borrow_global<Vault>(vault_addr).admin
    }

    /// Get vault contribution asset type
    public fun get_vault_contribution_asset_type(
        vault: object::Object<Vault>
    ): object::Object<fungible_asset::Metadata> acquires Vault {
        let vault_addr = object::object_address<Vault>(&vault);
        borrow_global<Vault>(vault_addr).contribution_asset_type
    }

    /// Get vault NAV
    public fun get_vault_net_asset_value(vault: object::Object<Vault>): u64 acquires Vault {
        let vault_addr = object::object_address<Vault>(&vault);
        get_nav_in_contribution_asset(borrow_global<Vault>(vault_addr))
    }

    /// Get total share count
    public fun get_vault_num_shares(vault: object::Object<Vault>): u64 acquires Vault {
        let vault_addr = object::object_address<Vault>(&vault);
        get_num_shares(borrow_global<Vault>(vault_addr))
    }

    /// Get vault portfolio subaccounts
    public fun get_vault_portfolio_subaccounts(vault: object::Object<Vault>): vector<address> acquires Vault {
        let vault_addr = object::object_address<Vault>(&vault);
        let subaccount = borrow_global<Vault>(vault_addr).portfolio.dex_primary_subaccount;
        let result = vector::empty<address>();
        vector::push_back<address>(&mut result, subaccount);
        result
    }

    /// Get vault share asset type
    public fun get_vault_share_asset_type(
        vault: object::Object<Vault>
    ): object::Object<fungible_asset::Metadata> acquires Vault {
        let vault_addr = object::object_address<Vault>(&vault);
        borrow_global<Vault>(vault_addr).share_def.share_asset_type
    }

    // ============================================================================
    // REDEMPTION FUNCTIONS
    // ============================================================================

    /// Lock shares for redemption
    friend fun lock_for_initated_redemption(
        user: address,
        vault: object::Object<Vault>,
        shares: u64
    ) acquires Vault {
        event::emit<RedeemptionInitiatedEvent>(RedeemptionInitiatedEvent::V1 {
            vault,
            user,
            shares_to_redeem: shares,
        });

        let vault_addr = object::object_address<Vault>(&vault);
        let share_asset = borrow_global<Vault>(vault_addr).share_def.share_asset_type;
        vault_share_asset::lock_for_redemption(share_asset, user, shares);
    }

    /// Place order to close position for redemption
    friend fun place_force_closing_order(
        vault: object::Object<Vault>,
        subaccount: address,
        market: object::Object<perp_market::PerpMarket>
    ): option::Option<OrderRef> acquires Vault {
        let vault_addr = object::object_address<Vault>(&vault);
        let vault_signer = object::generate_signer_for_extending(&borrow_global<Vault>(vault_addr).vault_ref);

        // Get closing parameters
        let requirements = vault_global_config::get_global_requirements_config();
        let closing_size_bps = vault_global_config::get_closing_size_bps(&requirements);
        let max_slippage_bps = vault_global_config::get_closing_max_slippage_bps(&requirements);

        // Check if position exists
        let position_opt = perp_engine::view_position(subaccount, market);
        if (option::is_some<position_view_types::PositionViewInfo>(&position_opt)) {
            let position = option::destroy_some<position_view_types::PositionViewInfo>(position_opt);
            let position_size = position_view_types::get_position_info_size(&position);

            if (position_size != 0) {
                // Calculate closing order parameters
                let is_long_position = position_view_types::get_position_info_is_long(&position);
                let is_sell = !is_long_position;  // Sell to close long, buy to close short

                let mark_price = perp_engine::get_mark_price(market);
                let limit_price = slippage_math::compute_limit_price_with_slippage(
                    market,
                    mark_price,
                    max_slippage_bps,
                    10000,  // denominator
                    is_sell
                );

                // Close portion of position (closing_size_bps / 10000)
                let order_size = position_size * closing_size_bps / 10000;

                // Place the closing order
                let subaccount_obj = object::address_to_object<dex_accounts::Subaccount>(subaccount);
                let order_id = dex_accounts::place_order_to_subaccount_method(
                    &vault_signer,
                    subaccount_obj,
                    position_view_types::get_position_info_market(&position),
                    limit_price,
                    order_size,
                    is_sell,
                    order_book_types::good_till_cancelled(),
                    true,   // reduce_only
                    option::none<string::String>(),
                    option::none<u64>(),
                    option::none<u64>(),
                    option::none<u64>(),
                    option::none<u64>(),
                    option::none<u64>(),
                    option::none<address>(),
                    option::none<u64>()
                );

                return option::some<OrderRef>(OrderRef { market, order_id })
            }
        };

        option::none<OrderRef>()
    }

    /// Cancel a force closing order
    friend fun cancel_force_closing_order(
        vault: object::Object<Vault>,
        market: object::Object<perp_market::PerpMarket>,
        order_id: order_book_types::OrderIdType
    ) acquires Vault {
        let vault_addr = object::object_address<Vault>(&vault);
        let vault_data = borrow_global<Vault>(vault_addr);
        let vault_signer = object::generate_signer_for_extending(&vault_data.vault_ref);

        let subaccount = object::address_to_object<dex_accounts::Subaccount>(
            vault_data.portfolio.dex_primary_subaccount
        );
        let order_id_value = order_book_types::get_order_id_value(&order_id);

        dex_accounts::cancel_order_to_subaccount(&vault_signer, subaccount, order_id_value, market);
    }

    /// Try to complete a redemption
    ///
    /// Returns true if redemption completed, false if insufficient funds
    friend fun try_complete_redemption(
        user: address,
        vault: object::Object<Vault>,
        shares: u64,
        deposit_to_dex: bool
    ): bool acquires ExternalCallbacks, Vault {
        let vault_addr = object::object_address<Vault>(&vault);
        let vault_data = borrow_global<Vault>(vault_addr);

        // Calculate asset amount for shares
        let asset_amount = convert_existing_shares_to_asset_amount(vault_data, shares);
        if (!(asset_amount > 0)) {
            abort error::invalid_argument(14)
        };

        // Check if we can withdraw this amount
        let subaccount = vault_data.portfolio.dex_primary_subaccount;
        let contribution_asset = vault_data.contribution_asset_type;
        let max_withdraw = perp_engine::max_allowed_withdraw_fungible_amount(subaccount, contribution_asset);

        if (asset_amount > max_withdraw) {
            return false  // Insufficient withdrawable funds
        };

        // Complete the redemption
        event::emit<RedeemptionSettledEvent>(RedeemptionSettledEvent::V1 {
            vault,
            user,
            shares_redeemed: shares,
            assets_received: asset_amount,
        });

        // Withdraw funds from vault
        let subaccount_obj = object::address_to_object<dex_accounts::Subaccount>(
            vault_data.portfolio.dex_primary_subaccount
        );
        let funds = dex_accounts::withdraw_onchain_account_funds_from_subaccount(
            &vault_data.vault_ref,
            subaccount_obj,
            vault_data.contribution_asset_type,
            asset_amount
        );

        // Burn the redeemed shares
        vault_share_asset::burn_redeemed_shares_from(
            vault_data.share_def.share_asset_type,
            user,
            shares
        );

        // Send funds to user
        if (deposit_to_dex) {
            // Deposit to user's DEX account
            let callbacks = borrow_global<ExternalCallbacks>(@decibel);
            let deposit_fn = callbacks.deposit_funds_to_dex_f;
            deposit_fn(user, funds);
        } else {
            // Deposit to user's wallet
            primary_fungible_store::deposit(user, funds);
        };

        true
    }
}
