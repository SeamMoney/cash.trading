/// ============================================================================
/// Module: dex_accounts
/// Description: Subaccount system with delegated permissions for trading
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module implements a sophisticated subaccount system that allows:
/// 1. Users to create multiple trading subaccounts
/// 2. Delegation of trading permissions to other addresses (bots, services)
/// 3. Fine-grained permission control with expiration times
///
/// Subaccount Types:
/// - Primary: Auto-created at a deterministic address (seeded with "decibel_dex_primary_v2")
/// - Secondary: Created on-demand with random or custom seeds
///
/// Permission Types:
/// - TradePerpsAllMarkets: Can trade any perpetual market
/// - TradePerpsOnMarket: Can trade a specific market only
/// - SubaccountFundsMovement: Can move funds between subaccounts
/// - SubDelegate: Can delegate permissions to others (with limits)
/// - TradeVaultTokens: Can trade vault tokens
///
/// Use Cases:
/// - Separate trading strategies in different subaccounts
/// - Delegate trading to automated bots with limited permissions
/// - Grant time-limited access to copy traders
/// ============================================================================

module decibel::dex_accounts {
    use aptos_framework::ordered_map;
    use aptos_framework::option;
    use aptos_framework::object;
    use decibel::perp_market;
    use decibel::perp_engine_api;
    use aptos_framework::big_ordered_map;
    use aptos_framework::string;
    use decibel::perp_engine;
    use aptos_framework::fungible_asset;
    use aptos_framework::primary_fungible_store;
    use order_book::order_book_types;
    use decibel::builder_code_registry;
    use aptos_framework::signer;
    use aptos_framework::event;
    use decibel::decibel_time;
    use std::vector;

    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================

    /// Vault extension module can access subaccount signers
    friend decibel::dex_accounts_vault_extension;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// Contract address for permission checks
    const DECIBEL_ADDRESS: address = @0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844;

    /// Seed for primary subaccount creation
    /// ASCII bytes for "decibel_dex_primary_v2"
    const PRIMARY_SUBACCOUNT_SEED: vector<u8> = vector[
        100u8, 101u8, 99u8, 105u8, 98u8, 101u8, 108u8, 95u8,   // "decibel_"
        100u8, 101u8, 120u8, 95u8,                              // "dex_"
        112u8, 114u8, 105u8, 109u8, 97u8, 114u8, 121u8, 95u8,  // "primary_"
        118u8, 50u8                                             // "v2"
    ];

    /// Error: Caller is not the owner of the subaccount
    const E_NOT_OWNER: u64 = 1;

    /// Error: Subaccount does not exist
    const E_SUBACCOUNT_NOT_FOUND: u64 = 2;

    /// Error: Caller lacks required trading permission
    const E_NOT_AUTHORIZED_TRADER: u64 = 8;

    /// Error: Caller lacks funds movement permission
    const E_NOT_AUTHORIZED_FUNDS: u64 = 12;

    /// Error: Caller lacks delegation permission
    const E_NOT_AUTHORIZED_DELEGATE: u64 = 13;

    /// Error: Subaccounts have different owners
    const E_DIFFERENT_OWNERS: u64 = 14;

    /// Error: Subaccount is deactivated
    const E_SUBACCOUNT_INACTIVE: u64 = 15;

    /// Error: Cannot deactivate subaccount with positions/assets
    const E_HAS_POSITIONS_OR_ASSETS: u64 = 16;

    /// Error: Caller lacks vault trading permission
    const E_NOT_AUTHORIZED_VAULT: u64 = 17;

    /// Error: Unauthorized to register restricted API
    const E_UNAUTHORIZED_API: u64 = 18;

    /// Error: Restricted API already registered
    const E_API_ALREADY_REGISTERED: u64 = 18;

    /// Error: Restricted API not registered
    const E_API_NOT_REGISTERED: u64 = 19;

    // =========================================================================
    // TYPES - PERMISSIONS
    // =========================================================================

    /// Permission storage with optional expiration
    enum StoredPermission has copy, drop, store {
        /// Permission never expires
        Unlimited,
        /// Permission expires at the given timestamp
        UnlimitedUntil {
            expiration_timestamp: u64,
        }
    }

    /// Collection of permissions granted to a delegate
    enum DelegatedPermissions has copy, drop, store {
        V1 {
            /// Map of permission type to its storage details
            perms: ordered_map::OrderedMap<PermissionType, StoredPermission>,
        }
    }

    /// Types of permissions that can be delegated
    enum PermissionType has copy, drop, store {
        /// Can trade any perpetual market
        TradePerpsAllMarkets,
        /// Can trade only a specific market
        TradePerpsOnMarket {
            market: object::Object<perp_market::PerpMarket>,
        },
        /// Can move funds between subaccounts of the same owner
        SubaccountFundsMovement,
        /// Can delegate their own permissions to others (limited by their own)
        SubDelegate,
        /// Can trade vault tokens (deposit/withdraw from vaults)
        TradeVaultTokens,
    }

    // =========================================================================
    // TYPES - EVENTS
    // =========================================================================

    /// Event emitted when delegation changes
    enum DelegationChangedEvent has drop, store {
        V1 {
            /// Subaccount whose permissions changed
            subaccount: address,
            /// Address receiving/losing the permission
            delegated_account: address,
            /// Permission type (None if revoking all)
            delegation: option::Option<PermissionType>,
            /// Expiration time (None if permanent or revoking)
            expiration_time_s: option::Option<u64>,
        }
    }

    /// Event emitted when subaccount is activated/deactivated
    enum SubaccountActiveChangedEvent has drop, store {
        V1 {
            /// Subaccount address
            subaccount: address,
            /// Owner of the subaccount
            owner: address,
            /// New active status
            is_active: bool,
        }
    }

    /// Event emitted when a new subaccount is created
    enum SubaccountCreatedEvent has drop, store {
        V1 {
            /// New subaccount address
            subaccount: address,
            /// Owner of the subaccount
            owner: address,
            /// True if this is the primary subaccount
            is_primary: bool,
            /// Seed used for creation (None for random)
            seed: option::Option<vector<u8>>,
        }
    }

    // =========================================================================
    // TYPES - RESOURCES
    // =========================================================================

    /// Registry holding the restricted perp API capability
    ///
    /// This capability is required to initialize new user accounts.
    /// Stored at the contract address.
    enum RestrictedApiRegistry has key {
        V1 {
            /// Capability for restricted perp operations
            restricted_perp_api: perp_engine_api::RestrictedPerpApi,
        }
    }

    /// A trading subaccount owned by a user
    ///
    /// Subaccounts are Move objects that hold:
    /// - Trading balances
    /// - Perpetual positions
    /// - Delegated permissions for other addresses
    enum Subaccount has key {
        V1 {
            /// ExtendRef to generate signers for this subaccount
            extend_ref: object::ExtendRef,
            /// Map of delegated address -> their permissions
            delegated_permissions: big_ordered_map::BigOrderedMap<address, DelegatedPermissions>,
            /// Whether this subaccount is active (can trade)
            is_active: bool,
        }
    }

    // =========================================================================
    // MODULE INITIALIZATION
    // =========================================================================

    /// Called when module is deployed
    fun init_module(deployer: &signer) {
        register_restricted_api(deployer);
    }

    /// Registers the restricted API capability
    ///
    /// This is called during initialization to obtain the capability
    /// needed for creating new user trading accounts.
    public fun register_restricted_api(deployer: &signer) {
        let api = perp_engine_api::get_restricted_perp_api(deployer);

        if (exists<RestrictedApiRegistry>(DECIBEL_ADDRESS)) {
            abort E_API_ALREADY_REGISTERED
        };

        let registry = RestrictedApiRegistry::V1 {
            restricted_perp_api: api,
        };
        move_to<RestrictedApiRegistry>(deployer, registry);
    }

    // =========================================================================
    // PUBLIC VIEW FUNCTIONS
    // =========================================================================

    /// Gets the address of a user's primary subaccount
    ///
    /// The primary subaccount is at a deterministic address based on the owner.
    /// This is the default account used when no specific subaccount is specified.
    ///
    /// # Arguments
    /// * `owner` - Owner address
    ///
    /// # Returns
    /// Address of the primary subaccount (may not exist yet)
    public fun primary_subaccount(owner: address): address {
        object::create_object_address(&owner, PRIMARY_SUBACCOUNT_SEED)
    }

    /// Gets the primary subaccount as an object
    ///
    /// # Arguments
    /// * `owner` - Owner address
    ///
    /// # Returns
    /// Object reference to the primary subaccount
    ///
    /// # Note
    /// Will abort if primary subaccount doesn't exist
    public fun primary_subaccount_object(owner: address): object::Object<Subaccount> {
        object::address_to_object<Subaccount>(
            object::create_object_address(&owner, PRIMARY_SUBACCOUNT_SEED)
        )
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS - REFERRALS
    // =========================================================================

    /// Registers a referral code for the caller
    entry fun register_referral_code(user: &signer, code: string::String) {
        perp_engine_api::register_referral_code(user, code);
    }

    /// Registers a referrer using their referral code
    entry fun register_referrer(user: &signer, referral_code: string::String) {
        perp_engine_api::register_referrer(user, referral_code);
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS - SUBACCOUNT CREATION
    // =========================================================================

    /// Creates a new subaccount with a random address
    ///
    /// # Arguments
    /// * `owner` - Owner signer
    public entry fun create_new_subaccount(owner: &signer) acquires RestrictedApiRegistry {
        let _subaccount = create_subaccount_internal(owner, false);
    }

    /// Creates a new subaccount with a specific seed
    ///
    /// # Arguments
    /// * `owner` - Owner signer
    /// * `seed` - Seed bytes for deterministic address
    ///
    /// # Note
    /// The subaccount address will be deterministic based on owner + seed
    public entry fun create_new_seeded_subaccount(
        owner: &signer,
        seed: vector<u8>
    ) acquires RestrictedApiRegistry {
        let maybe_seed = option::some<vector<u8>>(seed);
        let _subaccount = create_subaccount_internal_with_seed(owner, maybe_seed);
    }

    /// Creates a new subaccount and returns the object reference
    public fun create_new_subaccount_object(
        owner: &signer
    ): object::Object<Subaccount> acquires RestrictedApiRegistry {
        create_subaccount_internal(owner, false)
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS - DEPOSITS
    // =========================================================================

    /// Deposits funds from user's wallet to their subaccount
    ///
    /// # Arguments
    /// * `user` - User signer (funds source)
    /// * `subaccount_addr` - Destination subaccount address
    /// * `asset` - Asset metadata to deposit
    /// * `amount` - Amount to deposit
    ///
    /// # Note
    /// Creates primary subaccount if it doesn't exist and address matches
    public entry fun deposit_to_subaccount_at(
        user: &signer,
        subaccount_addr: address,
        asset: object::Object<fungible_asset::Metadata>,
        amount: u64
    ) acquires RestrictedApiRegistry, Subaccount {
        let funds = primary_fungible_store::withdraw<fungible_asset::Metadata>(user, asset, amount);
        deposit_funds_to_subaccount_at(user, subaccount_addr, funds);
    }

    /// Deposits fungible asset to a subaccount at specific address
    public fun deposit_funds_to_subaccount_at(
        user: &signer,
        subaccount_addr: address,
        funds: fungible_asset::FungibleAsset
    ) acquires RestrictedApiRegistry, Subaccount {
        let subaccount = get_subaccount_object_or_init_if_primary(user, subaccount_addr);
        let subaccount_signer = get_subaccount_signer_if_owner(user, subaccount);
        perp_engine::deposit(&subaccount_signer, funds);
    }

    /// Deposits to isolated position margin for a specific market
    public entry fun deposit_to_isolated_position_margin(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        market: object::Object<perp_market::PerpMarket>,
        asset: object::Object<fungible_asset::Metadata>,
        amount: u64
    ) acquires Subaccount {
        let funds = primary_fungible_store::withdraw<fungible_asset::Metadata>(user, asset, amount);
        let subaccount_signer = get_subaccount_signer_if_owner(user, subaccount);
        perp_engine::deposit_to_isolated_position_margin(&subaccount_signer, market, funds);
    }

    /// Combined entry: add delegated trader and deposit in one transaction
    entry fun add_delegated_trader_and_deposit_to_subaccount(
        user: &signer,
        subaccount_addr: address,
        asset: object::Object<fungible_asset::Metadata>,
        amount: u64,
        delegate: address,
        expiration: option::Option<u64>
    ) acquires RestrictedApiRegistry, Subaccount {
        deposit_to_subaccount_at(user, subaccount_addr, asset, amount);
        delegate_trading_to_for_subaccount(user, subaccount_addr, delegate, expiration);
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS - WITHDRAWALS
    // =========================================================================

    /// Withdraws funds from subaccount to user's wallet
    friend entry fun withdraw_from_subaccount(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        asset: object::Object<fungible_asset::Metadata>,
        amount: u64
    ) acquires Subaccount {
        let _success = withdraw_from_subaccount_request(user, subaccount, asset, amount);
    }

    /// Withdraws funds and returns success status
    public fun withdraw_from_subaccount_request(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        asset: object::Object<fungible_asset::Metadata>,
        amount: u64
    ): bool acquires Subaccount {
        let subaccount_signer = get_subaccount_signer_if_owner(user, subaccount);
        let funds = perp_engine::withdraw_fungible(&subaccount_signer, asset, amount);
        primary_fungible_store::deposit(signer::address_of(user), funds);
        true
    }

    /// Withdraws from isolated position margin
    public entry fun withdraw_from_isolated_position_margin(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        market: object::Object<perp_market::PerpMarket>,
        asset: object::Object<fungible_asset::Metadata>,
        amount: u64
    ) acquires Subaccount {
        let subaccount_signer = get_subaccount_signer_if_owner(user, subaccount);
        let funds = perp_engine::withdraw_from_isolated_position_margin(
            &subaccount_signer,
            market,
            asset,
            amount
        );
        primary_fungible_store::deposit(signer::address_of(user), funds);
    }

    /// Withdraws funds for an onchain account (smart contract integration)
    public fun withdraw_onchain_account_funds_from_subaccount(
        extend_ref: &object::ExtendRef,
        subaccount: object::Object<Subaccount>,
        asset: object::Object<fungible_asset::Metadata>,
        amount: u64
    ): fungible_asset::FungibleAsset acquires Subaccount {
        let caller_signer = object::generate_signer_for_extending(extend_ref);
        let subaccount_signer = get_subaccount_signer_if_owner(&caller_signer, subaccount);
        perp_engine::withdraw_fungible(&subaccount_signer, asset, amount)
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS - TRANSFERS
    // =========================================================================

    /// Transfers collateral between subaccounts of the same owner
    ///
    /// # Arguments
    /// * `user` - User signer
    /// * `from_subaccount` - Source subaccount
    /// * `to_subaccount` - Destination subaccount
    /// * `asset` - Asset to transfer
    /// * `amount` - Amount to transfer
    ///
    /// # Permissions
    /// Requires SubaccountFundsMovement permission on both subaccounts
    public entry fun transfer_collateral_between_subaccounts(
        user: &signer,
        from_subaccount: object::Object<Subaccount>,
        to_subaccount: object::Object<Subaccount>,
        asset: object::Object<fungible_asset::Metadata>,
        amount: u64
    ) acquires Subaccount {
        // Verify same owner
        let from_owner = object::owner<Subaccount>(from_subaccount);
        let to_owner = object::owner<Subaccount>(to_subaccount);
        assert!(from_owner == to_owner, E_DIFFERENT_OWNERS);

        // Withdraw from source
        let from_signer = get_subaccount_signer_if_owner_or_delegated_for_subaccount_funds_movement(
            user,
            from_subaccount
        );
        let funds = perp_engine::withdraw_fungible(&from_signer, asset, amount);

        // Deposit to destination
        let to_signer = get_subaccount_signer_if_owner_or_delegated_for_subaccount_funds_movement(
            user,
            to_subaccount
        );
        perp_engine::deposit(&to_signer, funds);
    }

    /// Transfers margin between cross and isolated position
    public entry fun transfer_margin_to_isolated_position(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        market: object::Object<perp_market::PerpMarket>,
        to_isolated: bool,
        asset: object::Object<fungible_asset::Metadata>,
        amount: u64
    ) acquires Subaccount {
        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );
        perp_engine::transfer_margin_to_isolated_position(
            &subaccount_signer,
            market,
            to_isolated,
            asset,
            amount
        );
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS - DELEGATION
    // =========================================================================

    /// Delegates trading permissions for all markets to another address
    friend entry fun delegate_trading_to_for_subaccount(
        user: &signer,
        subaccount_addr: address,
        delegate: address,
        expiration: option::Option<u64>
    ) acquires RestrictedApiRegistry, Subaccount {
        // Grant perp trading
        let perp_permission = PermissionType::TradePerpsAllMarkets {};
        check_and_delegate_permission(user, subaccount_addr, delegate, perp_permission, expiration);

        // Grant vault trading
        let vault_permission = PermissionType::TradeVaultTokens {};
        check_and_delegate_permission(user, subaccount_addr, delegate, vault_permission, expiration);
    }

    /// Delegates sub-delegation permission
    entry fun delegate_ability_to_sub_delegate_to_for_subaccount(
        user: &signer,
        subaccount_addr: address,
        delegate: address,
        expiration: option::Option<u64>
    ) acquires RestrictedApiRegistry, Subaccount {
        let permission = PermissionType::SubDelegate {};
        check_and_delegate_permission(user, subaccount_addr, delegate, permission, expiration);
    }

    /// Delegates multiple permission types at once (for smart contract integration)
    public fun delegate_onchain_account_permissions(
        extend_ref: &object::ExtendRef,
        subaccount_addr: address,
        delegate: address,
        grant_perps: bool,
        grant_vaults: bool,
        grant_sub_delegate: bool,
        grant_funds_movement: bool,
        expiration: option::Option<u64>
    ) acquires RestrictedApiRegistry, Subaccount {
        let caller_signer = object::generate_signer_for_extending(extend_ref);
        let subaccount = get_subaccount_object_or_init_if_primary(&caller_signer, subaccount_addr);

        // Verify owner
        let caller_addr = signer::address_of(&caller_signer);
        assert!(object::is_owner<Subaccount>(subaccount, caller_addr), E_NOT_OWNER);
        assert!(borrow_global<Subaccount>(object::object_address(&subaccount)).is_active, E_SUBACCOUNT_INACTIVE);

        if (grant_perps) {
            add_delegated_permission(subaccount, delegate, PermissionType::TradePerpsAllMarkets {}, expiration);
        };
        if (grant_vaults) {
            add_delegated_permission(subaccount, delegate, PermissionType::TradeVaultTokens {}, expiration);
        };
        if (grant_sub_delegate) {
            add_delegated_permission(subaccount, delegate, PermissionType::SubDelegate {}, expiration);
        };
        if (grant_funds_movement) {
            add_delegated_permission(subaccount, delegate, PermissionType::SubaccountFundsMovement {}, expiration);
        };
    }

    /// Revokes all delegated permissions for an address
    friend entry fun revoke_all_delegations(
        user: &signer,
        subaccount: object::Object<Subaccount>
    ) acquires Subaccount {
        // Verify owner
        assert!(object::is_owner<Subaccount>(subaccount, signer::address_of(user)), E_NOT_OWNER);
        assert!(borrow_global<Subaccount>(object::object_address(&subaccount)).is_active, E_SUBACCOUNT_INACTIVE);

        let subaccount_addr = object::object_address<Subaccount>(&subaccount);
        let sub = borrow_global_mut<Subaccount>(subaccount_addr);
        let permissions = &mut sub.delegated_permissions;

        // Remove all delegations one by one
        while (!big_ordered_map::is_empty<address, DelegatedPermissions>(permissions)) {
            let (revoked_addr, _perms) = big_ordered_map::pop_front<address, DelegatedPermissions>(permissions);

            event::emit<DelegationChangedEvent>(DelegationChangedEvent::V1 {
                subaccount: subaccount_addr,
                delegated_account: revoked_addr,
                delegation: option::none<PermissionType>(),
                expiration_time_s: option::none<u64>(),
            });
        };
    }

    /// Revokes delegation for a specific address
    friend entry fun revoke_delegation(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        delegate: address
    ) acquires Subaccount {
        // Verify owner
        assert!(object::is_owner<Subaccount>(subaccount, signer::address_of(user)), E_NOT_OWNER);
        assert!(borrow_global<Subaccount>(object::object_address(&subaccount)).is_active, E_SUBACCOUNT_INACTIVE);

        let subaccount_addr = object::object_address<Subaccount>(&subaccount);
        let permissions = &mut borrow_global_mut<Subaccount>(subaccount_addr).delegated_permissions;

        let _removed = big_ordered_map::remove<address, DelegatedPermissions>(permissions, &delegate);

        event::emit<DelegationChangedEvent>(DelegationChangedEvent::V1 {
            subaccount: subaccount_addr,
            delegated_account: delegate,
            delegation: option::none<PermissionType>(),
            expiration_time_s: option::none<u64>(),
        });
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS - SUBACCOUNT MANAGEMENT
    // =========================================================================

    /// Deactivates a subaccount (must have no positions or assets)
    friend entry fun deactivate_subaccount(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        revoke_delegations: bool
    ) acquires Subaccount {
        // Verify owner
        let user_addr = signer::address_of(user);
        assert!(object::is_owner<Subaccount>(subaccount, user_addr), E_NOT_OWNER);
        assert!(borrow_global<Subaccount>(object::object_address(&subaccount)).is_active, E_SUBACCOUNT_INACTIVE);

        // Verify no positions or assets
        let subaccount_addr = object::object_address<Subaccount>(&subaccount);
        if (perp_engine::has_any_assets_or_positions(subaccount_addr)) {
            abort E_HAS_POSITIONS_OR_ASSETS
        };

        // Optionally revoke all delegations
        if (revoke_delegations) {
            revoke_all_delegations(user, subaccount);
        };

        // Set inactive
        let sub = borrow_global_mut<Subaccount>(subaccount_addr);
        sub.is_active = false;

        event::emit<SubaccountActiveChangedEvent>(SubaccountActiveChangedEvent::V1 {
            subaccount: subaccount_addr,
            owner: user_addr,
            is_active: false,
        });
    }

    /// Reactivates a previously deactivated subaccount
    friend entry fun reactivate_subaccount(
        user: &signer,
        subaccount: object::Object<Subaccount>
    ) acquires Subaccount {
        let user_addr = signer::address_of(user);
        assert!(object::is_owner<Subaccount>(subaccount, user_addr), E_NOT_OWNER);

        let subaccount_addr = object::object_address<Subaccount>(&subaccount);
        let sub = borrow_global_mut<Subaccount>(subaccount_addr);
        sub.is_active = true;

        event::emit<SubaccountActiveChangedEvent>(SubaccountActiveChangedEvent::V1 {
            subaccount: subaccount_addr,
            owner: user_addr,
            is_active: true,
        });
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS - USER SETTINGS
    // =========================================================================

    /// Configures user settings for a specific market
    public entry fun configure_user_settings_for_market(
        user: &signer,
        subaccount_addr: address,
        market: object::Object<perp_market::PerpMarket>,
        is_isolated: bool,
        leverage: u8
    ) acquires RestrictedApiRegistry, Subaccount {
        let subaccount = get_subaccount_object_or_init_if_primary(user, subaccount_addr);
        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );
        perp_engine::configure_user_settings_for_market(&subaccount_signer, market, is_isolated, leverage);
    }

    /// Initializes account status cache for a subaccount
    public entry fun init_account_status_cache_for_subaccount(
        user: &signer,
        subaccount_addr: address
    ) acquires Subaccount {
        let subaccount = get_subaccount_object(subaccount_addr);
        let subaccount_signer = get_subaccount_signer_if_owner(user, subaccount);
        perp_engine::init_account_status_cache(&subaccount_signer);
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS - BUILDER FEES
    // =========================================================================

    /// Approves a maximum builder fee for a subaccount
    entry fun approve_max_builder_fee_for_subaccount(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        builder: address,
        max_fee_bps: u64
    ) acquires Subaccount {
        let subaccount_signer = get_subaccount_signer_if_owner(user, subaccount);
        perp_engine_api::approve_max_fee(&subaccount_signer, builder, max_fee_bps);
    }

    /// Revokes a builder's fee approval
    entry fun revoke_max_builder_fee_for_subaccount(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        builder: address
    ) acquires Subaccount {
        let subaccount_signer = get_subaccount_signer_if_owner(user, subaccount);
        perp_engine_api::revoke_max_fee(&subaccount_signer, builder);
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS - ORDER PLACEMENT
    // =========================================================================

    /// Places a limit order
    entry fun place_order_to_subaccount(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        price: u64,
        is_long: bool,
        time_in_force: u8,
        is_reduce_only: bool,
        client_order_id: option::Option<string::String>,
        slippage_bps: option::Option<u64>,
        take_profit_price: option::Option<u64>,
        take_profit_trigger_price: option::Option<u64>,
        stop_loss_price: option::Option<u64>,
        stop_loss_trigger_price: option::Option<u64>,
        builder_addr: option::Option<address>,
        builder_fee: option::Option<u64>
    ) acquires Subaccount {
        let builder_code = create_builder_code_if_present(builder_addr, builder_fee);

        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        let tif = order_book_types::time_in_force_from_index(time_in_force);

        let _order_id = perp_engine::place_order(
            market,
            &subaccount_signer,
            size,
            price,
            is_long,
            tif,
            is_reduce_only,
            client_order_id,
            slippage_bps,
            take_profit_price,
            take_profit_trigger_price,
            stop_loss_price,
            stop_loss_trigger_price,
            builder_code
        );
    }

    /// Places a limit order and returns the order ID
    public fun place_order_to_subaccount_method(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        price: u64,
        is_long: bool,
        time_in_force: order_book_types::TimeInForce,
        is_reduce_only: bool,
        client_order_id: option::Option<string::String>,
        slippage_bps: option::Option<u64>,
        take_profit_price: option::Option<u64>,
        take_profit_trigger_price: option::Option<u64>,
        stop_loss_price: option::Option<u64>,
        stop_loss_trigger_price: option::Option<u64>,
        builder_addr: option::Option<address>,
        builder_fee: option::Option<u64>
    ): order_book_types::OrderIdType acquires Subaccount {
        let builder_code = create_builder_code_if_present(builder_addr, builder_fee);

        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        perp_engine::place_order(
            market,
            &subaccount_signer,
            size,
            price,
            is_long,
            time_in_force,
            is_reduce_only,
            client_order_id,
            slippage_bps,
            take_profit_price,
            take_profit_trigger_price,
            stop_loss_price,
            stop_loss_trigger_price,
            builder_code
        )
    }

    /// Places a market order
    entry fun place_market_order_to_subaccount(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        is_long: bool,
        is_reduce_only: bool,
        client_order_id: option::Option<string::String>,
        slippage_bps: option::Option<u64>,
        take_profit_price: option::Option<u64>,
        take_profit_trigger_price: option::Option<u64>,
        stop_loss_price: option::Option<u64>,
        stop_loss_trigger_price: option::Option<u64>,
        builder_addr: option::Option<address>,
        builder_fee: option::Option<u64>
    ) acquires Subaccount {
        let builder_code = create_builder_code_if_present(builder_addr, builder_fee);

        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        let _order_id = perp_engine::place_market_order(
            market,
            &subaccount_signer,
            size,
            is_long,
            is_reduce_only,
            client_order_id,
            slippage_bps,
            take_profit_price,
            take_profit_trigger_price,
            stop_loss_price,
            stop_loss_trigger_price,
            builder_code
        );
    }

    /// Places multiple orders in one transaction (bulk order)
    entry fun place_bulk_orders_to_subaccount(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        market: object::Object<perp_market::PerpMarket>,
        num_levels: u64,
        sizes: vector<u64>,
        prices: vector<u64>,
        bid_sizes: vector<u64>,
        ask_sizes: vector<u64>
    ) acquires Subaccount {
        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        let builder_code = option::none<builder_code_registry::BuilderCode>();

        let _result = perp_engine::place_bulk_order(
            market,
            &subaccount_signer,
            num_levels,
            sizes,
            prices,
            bid_sizes,
            ask_sizes,
            builder_code
        );
    }

    /// Places a TWAP (Time-Weighted Average Price) order
    entry fun place_twap_order_to_subaccount(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        is_long: bool,
        is_reduce_only: bool,
        duration_seconds: u64,
        num_slices: u64,
        builder_addr: option::Option<address>,
        builder_fee: option::Option<u64>
    ) acquires Subaccount {
        let builder_code = create_builder_code_if_present(builder_addr, builder_fee);

        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        let client_order_id = option::none<string::String>();

        let _order_id = perp_engine::place_twap_order(
            market,
            &subaccount_signer,
            size,
            is_long,
            is_reduce_only,
            client_order_id,
            duration_seconds,
            num_slices,
            builder_code
        );
    }

    /// Places a TWAP order with client order ID
    entry fun place_twap_order_to_subaccount_v2(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        is_long: bool,
        is_reduce_only: bool,
        client_order_id: option::Option<string::String>,
        duration_seconds: u64,
        num_slices: u64,
        builder_addr: option::Option<address>,
        builder_fee: option::Option<u64>
    ) acquires Subaccount {
        let builder_code = create_builder_code_if_present(builder_addr, builder_fee);

        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        let _order_id = perp_engine::place_twap_order(
            market,
            &subaccount_signer,
            size,
            is_long,
            is_reduce_only,
            client_order_id,
            duration_seconds,
            num_slices,
            builder_code
        );
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS - ORDER UPDATES
    // =========================================================================

    /// Updates an existing order by order ID
    entry fun update_order_to_subaccount(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        order_id: u128,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        price: u64,
        is_long: bool,
        time_in_force: u8,
        is_reduce_only: bool,
        take_profit_price: option::Option<u64>,
        take_profit_trigger_price: option::Option<u64>,
        stop_loss_price: option::Option<u64>,
        stop_loss_trigger_price: option::Option<u64>,
        builder_addr: option::Option<address>,
        builder_fee: option::Option<u64>
    ) acquires Subaccount {
        let builder_code = create_builder_code_if_present(builder_addr, builder_fee);

        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        let order_id_type = order_book_types::new_order_id_type(order_id);
        let tif = order_book_types::time_in_force_from_index(time_in_force);

        perp_engine::update_order(
            &subaccount_signer,
            order_id_type,
            market,
            size,
            price,
            is_long,
            tif,
            is_reduce_only,
            take_profit_price,
            take_profit_trigger_price,
            stop_loss_price,
            stop_loss_trigger_price,
            builder_code
        );
    }

    /// Updates an order by client order ID
    entry fun update_client_order_to_subaccount(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        client_order_id: string::String,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        price: u64,
        is_long: bool,
        time_in_force: u8,
        is_reduce_only: bool,
        take_profit_price: option::Option<u64>,
        take_profit_trigger_price: option::Option<u64>,
        stop_loss_price: option::Option<u64>,
        stop_loss_trigger_price: option::Option<u64>,
        builder_addr: option::Option<address>,
        builder_fee: option::Option<u64>
    ) acquires Subaccount {
        let builder_code = create_builder_code_if_present(builder_addr, builder_fee);

        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        let tif = order_book_types::time_in_force_from_index(time_in_force);

        perp_engine::update_client_order(
            &subaccount_signer,
            client_order_id,
            market,
            size,
            price,
            is_long,
            tif,
            is_reduce_only,
            take_profit_price,
            take_profit_trigger_price,
            stop_loss_price,
            stop_loss_trigger_price,
            builder_code
        );
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS - ORDER CANCELLATION
    // =========================================================================

    /// Cancels an order by order ID
    public entry fun cancel_order_to_subaccount(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        order_id: u128,
        market: object::Object<perp_market::PerpMarket>
    ) acquires Subaccount {
        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        let order_id_type = order_book_types::new_order_id_type(order_id);
        perp_engine::cancel_order(market, &subaccount_signer, order_id_type);
    }

    /// Cancels an order by client order ID
    entry fun cancel_client_order_to_subaccount(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        client_order_id: string::String,
        market: object::Object<perp_market::PerpMarket>
    ) acquires Subaccount {
        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        perp_engine::cancel_client_order(market, &subaccount_signer, client_order_id);
    }

    /// Cancels all orders for a market
    entry fun cancel_bulk_order_to_subaccount(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        market: object::Object<perp_market::PerpMarket>
    ) acquires Subaccount {
        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        perp_engine::cancel_bulk_order(market, &subaccount_signer);
    }

    /// Cancels TWAP orders
    entry fun cancel_twap_orders_to_subaccount(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        market: object::Object<perp_market::PerpMarket>,
        order_id: u128
    ) acquires Subaccount {
        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        let order_id_type = order_book_types::new_order_id_type(order_id);
        perp_engine::cancel_twap_order(market, &subaccount_signer, order_id_type);
    }

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS - TP/SL ORDERS
    // =========================================================================

    /// Places take-profit and/or stop-loss orders for a position
    entry fun place_tp_sl_order_for_position(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        market: object::Object<perp_market::PerpMarket>,
        tp_price: option::Option<u64>,
        tp_trigger_price: option::Option<u64>,
        tp_size: option::Option<u64>,
        sl_price: option::Option<u64>,
        sl_trigger_price: option::Option<u64>,
        sl_size: option::Option<u64>,
        builder_addr: option::Option<address>,
        builder_fee: option::Option<u64>
    ) acquires Subaccount {
        let builder_code = create_builder_code_if_present(builder_addr, builder_fee);

        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        let (_tp_order_id, _sl_order_id) = perp_engine::place_tp_sl_order_for_position(
            market,
            &subaccount_signer,
            tp_price,
            tp_trigger_price,
            tp_size,
            sl_price,
            sl_trigger_price,
            sl_size,
            builder_code
        );
    }

    /// Cancels a TP/SL order
    entry fun cancel_tp_sl_order_for_position(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        market: object::Object<perp_market::PerpMarket>,
        order_id: u128
    ) acquires Subaccount {
        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        let order_id_type = order_book_types::new_order_id_type(order_id);
        perp_engine::cancel_tp_sl_order_for_position(market, &subaccount_signer, order_id_type);
    }

    /// Updates a take-profit order
    entry fun update_tp_order_for_position(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        old_order_id: u128,
        market: object::Object<perp_market::PerpMarket>,
        new_tp_price: option::Option<u64>,
        new_tp_trigger_price: option::Option<u64>,
        new_tp_size: option::Option<u64>
    ) acquires Subaccount {
        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        // Cancel old order
        let old_order_id_type = order_book_types::new_order_id_type(old_order_id);
        perp_engine::cancel_tp_sl_order_for_position(market, &subaccount_signer, old_order_id_type);

        // Place new TP order
        let (_tp_id, _sl_id) = perp_engine::place_tp_sl_order_for_position(
            market,
            &subaccount_signer,
            new_tp_price,
            new_tp_trigger_price,
            new_tp_size,
            option::none<u64>(),
            option::none<u64>(),
            option::none<u64>(),
            option::none<builder_code_registry::BuilderCode>()
        );
    }

    /// Updates a stop-loss order
    entry fun update_sl_order_for_position(
        user: &signer,
        subaccount: object::Object<Subaccount>,
        old_order_id: u128,
        market: object::Object<perp_market::PerpMarket>,
        new_sl_price: option::Option<u64>,
        new_sl_trigger_price: option::Option<u64>,
        new_sl_size: option::Option<u64>
    ) acquires Subaccount {
        let subaccount_signer = get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
            user,
            subaccount,
            market
        );

        // Cancel old order
        let old_order_id_type = order_book_types::new_order_id_type(old_order_id);
        perp_engine::cancel_tp_sl_order_for_position(market, &subaccount_signer, old_order_id_type);

        // Place new SL order
        let (_tp_id, _sl_id) = perp_engine::place_tp_sl_order_for_position(
            market,
            &subaccount_signer,
            option::none<u64>(),
            option::none<u64>(),
            option::none<u64>(),
            new_sl_price,
            new_sl_trigger_price,
            new_sl_size,
            option::none<builder_code_registry::BuilderCode>()
        );
    }

    // =========================================================================
    // FRIEND FUNCTIONS
    // =========================================================================

    /// Gets subaccount signer if caller has vault trading permission
    friend fun get_subaccount_signer_if_owner_or_delegated_for_vault_trading(
        caller: &signer,
        subaccount: object::Object<Subaccount>
    ): signer acquires Subaccount {
        let required_permissions = vector::empty<PermissionType>();
        vector::push_back<PermissionType>(&mut required_permissions, PermissionType::TradeVaultTokens {});

        let sub = borrow_global<Subaccount>(object::object_address(&subaccount));
        assert!(sub.is_active, E_SUBACCOUNT_INACTIVE);

        let caller_addr = signer::address_of(caller);
        let has_permission = if (object::is_owner<Subaccount>(subaccount, caller_addr)) {
            true
        } else {
            is_any_permission_granted(caller, sub, required_permissions, 0)
        };

        assert!(has_permission, E_NOT_AUTHORIZED_VAULT);
        object::generate_signer_for_extending(&sub.extend_ref)
    }

    /// Internal callback for depositing to subaccount by address
    /// Used by async operations
    #[persistent]
    fun deposit_funds_to_subaccount_address(
        subaccount_addr: address,
        funds: fungible_asset::FungibleAsset
    ) acquires Subaccount {
        let subaccount_signer = get_subaccount_signer_unpermissioned(get_subaccount_object(subaccount_addr));
        perp_engine::deposit(&subaccount_signer, funds);
    }

    /// Gets a function pointer for depositing to subaccount
    /// Only callable by contract
    public fun get_deposit_funds_to_subaccount_address_method(
        caller: &signer
    ): |address, fungible_asset::FungibleAsset| has copy + drop + store {
        assert!(signer::address_of(caller) == DECIBEL_ADDRESS, E_UNAUTHORIZED_API);
        |addr, funds| deposit_funds_to_subaccount_address(addr, funds)
    }

    // =========================================================================
    // INTERNAL FUNCTIONS - SUBACCOUNT CREATION
    // =========================================================================

    /// Gets or creates a subaccount at the given address
    ///
    /// If address matches primary subaccount and doesn't exist, creates it.
    fun get_subaccount_object_or_init_if_primary(
        user: &signer,
        subaccount_addr: address
    ): object::Object<Subaccount> acquires RestrictedApiRegistry {
        let exists_subaccount = exists<Subaccount>(subaccount_addr);

        if (!exists_subaccount) {
            // Check if it's the primary subaccount address
            let expected_primary = primary_subaccount(signer::address_of(user));
            if (subaccount_addr == expected_primary) {
                // Create primary subaccount
                return create_subaccount_internal(user, true)
            };
            abort E_SUBACCOUNT_NOT_FOUND
        };

        object::address_to_object<Subaccount>(subaccount_addr)
    }

    /// Gets subaccount object from address
    fun get_subaccount_object(addr: address): object::Object<Subaccount> {
        assert!(exists<Subaccount>(addr), E_SUBACCOUNT_NOT_FOUND);
        object::address_to_object<Subaccount>(addr)
    }

    /// Creates a subaccount (primary or secondary)
    fun create_subaccount_internal(
        owner: &signer,
        is_primary: bool
    ): object::Object<Subaccount> acquires RestrictedApiRegistry {
        if (is_primary) {
            let seed = option::some<vector<u8>>(PRIMARY_SUBACCOUNT_SEED);
            return create_subaccount_internal_with_seed(owner, seed)
        };
        let no_seed = option::none<vector<u8>>();
        create_subaccount_internal_with_seed(owner, no_seed)
    }

    /// Creates a subaccount with optional seed
    fun create_subaccount_internal_with_seed(
        owner: &signer,
        seed: option::Option<vector<u8>>
    ): object::Object<Subaccount> acquires RestrictedApiRegistry {
        // Check if this is the primary seed
        let is_primary = if (option::is_some<vector<u8>>(&seed)) {
            *option::borrow<vector<u8>>(&seed) == PRIMARY_SUBACCOUNT_SEED
        } else {
            false
        };

        // Create object (named or random)
        let constructor_ref = if (option::is_some<vector<u8>>(&seed)) {
            let seed_bytes = *option::borrow<vector<u8>>(&seed);
            object::create_named_object(owner, seed_bytes)
        } else {
            object::create_object(signer::address_of(owner))
        };

        // Setup subaccount
        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let subaccount_signer = object::generate_signer_for_extending(&extend_ref);
        let subaccount_addr = object::address_from_constructor_ref(&constructor_ref);

        // Create empty delegation map
        let delegated_permissions = big_ordered_map::new_with_config<address, DelegatedPermissions>(
            0u16,   // inner_max_degree
            16u16,  // target_node_size
            false   // reuse_slots
        );

        let subaccount = Subaccount::V1 {
            extend_ref,
            delegated_permissions,
            is_active: true,
        };
        move_to<Subaccount>(&subaccount_signer, subaccount);

        // Make subaccount non-transferable
        object::set_untransferable(&constructor_ref);

        // Initialize trading account for this subaccount
        assert!(exists<RestrictedApiRegistry>(DECIBEL_ADDRESS), E_API_NOT_REGISTERED);
        let api = &borrow_global<RestrictedApiRegistry>(DECIBEL_ADDRESS).restricted_perp_api;
        let owner_addr = signer::address_of(owner);
        perp_engine_api::init_user_if_new(api, &subaccount_signer, owner_addr);

        // Emit creation event
        event::emit<SubaccountCreatedEvent>(SubaccountCreatedEvent::V1 {
            subaccount: subaccount_addr,
            owner: owner_addr,
            is_primary,
            seed,
        });

        object::address_to_object<Subaccount>(subaccount_addr)
    }

    // =========================================================================
    // INTERNAL FUNCTIONS - SIGNER GENERATION
    // =========================================================================

    /// Gets subaccount signer if caller is the owner
    fun get_subaccount_signer_if_owner(
        caller: &signer,
        subaccount: object::Object<Subaccount>
    ): signer acquires Subaccount {
        let caller_addr = signer::address_of(caller);
        assert!(object::is_owner<Subaccount>(subaccount, caller_addr), E_NOT_OWNER);

        let sub = borrow_global<Subaccount>(object::object_address(&subaccount));
        assert!(sub.is_active, E_SUBACCOUNT_INACTIVE);

        object::generate_signer_for_extending(&sub.extend_ref)
    }

    /// Gets subaccount signer if caller has trading permission for market
    fun get_subaccount_signer_if_owner_or_delegated_for_perp_trading(
        caller: &signer,
        subaccount: object::Object<Subaccount>,
        market: object::Object<perp_market::PerpMarket>
    ): signer acquires Subaccount {
        // Build list of acceptable permissions
        let required_permissions = vector::empty<PermissionType>();
        vector::push_back<PermissionType>(&mut required_permissions, PermissionType::TradePerpsAllMarkets {});
        vector::push_back<PermissionType>(&mut required_permissions, PermissionType::TradePerpsOnMarket { market });

        let sub = borrow_global<Subaccount>(object::object_address(&subaccount));
        assert!(sub.is_active, E_SUBACCOUNT_INACTIVE);

        let caller_addr = signer::address_of(caller);
        let has_permission = if (object::is_owner<Subaccount>(subaccount, caller_addr)) {
            true
        } else {
            is_any_permission_granted(caller, sub, required_permissions, 0)
        };

        assert!(has_permission, E_NOT_AUTHORIZED_TRADER);
        object::generate_signer_for_extending(&sub.extend_ref)
    }

    /// Gets subaccount signer if caller has funds movement permission
    fun get_subaccount_signer_if_owner_or_delegated_for_subaccount_funds_movement(
        caller: &signer,
        subaccount: object::Object<Subaccount>
    ): signer acquires Subaccount {
        let required_permissions = vector::empty<PermissionType>();
        vector::push_back<PermissionType>(&mut required_permissions, PermissionType::SubaccountFundsMovement {});

        let sub = borrow_global<Subaccount>(object::object_address(&subaccount));
        assert!(sub.is_active, E_SUBACCOUNT_INACTIVE);

        let caller_addr = signer::address_of(caller);
        let has_permission = if (object::is_owner<Subaccount>(subaccount, caller_addr)) {
            true
        } else {
            is_any_permission_granted(caller, sub, required_permissions, 0)
        };

        assert!(has_permission, E_NOT_AUTHORIZED_FUNDS);
        object::generate_signer_for_extending(&sub.extend_ref)
    }

    /// Gets subaccount signer without permission checks
    /// Used internally for trusted operations
    fun get_subaccount_signer_unpermissioned(
        subaccount: object::Object<Subaccount>
    ): signer acquires Subaccount {
        let sub = borrow_global<Subaccount>(object::object_address(&subaccount));
        object::generate_signer_for_extending(&sub.extend_ref)
    }

    // =========================================================================
    // INTERNAL FUNCTIONS - PERMISSION CHECKING
    // =========================================================================

    /// Checks if any of the required permissions is granted to caller
    ///
    /// # Arguments
    /// * `caller` - Caller signer
    /// * `subaccount` - Subaccount to check
    /// * `required_permissions` - List of acceptable permissions (any one is sufficient)
    /// * `required_expiration` - Minimum expiration time required
    ///
    /// # Returns
    /// True if caller has at least one of the required permissions
    fun is_any_permission_granted(
        caller: &signer,
        subaccount: &Subaccount,
        required_permissions: vector<PermissionType>,
        required_expiration: u64
    ): bool {
        let caller_addr = signer::address_of(caller);
        let current_time = decibel_time::now_seconds();

        // Effective expiration is the later of current time and required
        let effective_expiration = if (current_time > required_expiration) {
            current_time
        } else {
            required_expiration
        };

        // Check if caller has any delegated permissions
        if (!big_ordered_map::contains<address, DelegatedPermissions>(
            &subaccount.delegated_permissions,
            &caller_addr
        )) {
            return false
        };

        // Get caller's permissions
        let perms = *&big_ordered_map::borrow<address, DelegatedPermissions>(
            &subaccount.delegated_permissions,
            &caller_addr
        ).perms;

        // Check each required permission
        let has_valid_permission = false;
        let i = 0;
        let num_required = vector::length<PermissionType>(&required_permissions);

        while (i < num_required) {
            let perm_type = vector::borrow<PermissionType>(&required_permissions, i);

            if (ordered_map::contains<PermissionType, StoredPermission>(&perms, perm_type)) {
                let stored = ordered_map::borrow<PermissionType, StoredPermission>(&perms, perm_type);

                // Check if permission is valid
                if (stored is StoredPermission::Unlimited) {
                    has_valid_permission = true;
                } else if (stored is StoredPermission::UnlimitedUntil) {
                    if (stored.expiration_timestamp > effective_expiration) {
                        has_valid_permission = true;
                    }
                };
            };

            i = i + 1;
        };

        has_valid_permission
    }

    // =========================================================================
    // INTERNAL FUNCTIONS - DELEGATION
    // =========================================================================

    /// Validates and delegates a permission
    fun check_and_delegate_permission(
        caller: &signer,
        subaccount_addr: address,
        delegate: address,
        permission: PermissionType,
        expiration: option::Option<u64>
    ) acquires RestrictedApiRegistry, Subaccount {
        let subaccount = get_subaccount_object_or_init_if_primary(caller, subaccount_addr);

        // Validate caller has permission to delegate
        let expiration_to_check = option::get_with_default<u64>(&expiration, 18446744073709551615u64);

        let sub = borrow_global<Subaccount>(object::object_address(&subaccount));
        assert!(sub.is_active, E_SUBACCOUNT_INACTIVE);

        let caller_addr = signer::address_of(caller);
        let can_delegate = if (object::is_owner<Subaccount>(subaccount, caller_addr)) {
            true
        } else {
            // Sub-delegate: must have SubDelegate permission AND the permission being delegated
            let sub_delegate_perms = vector::empty<PermissionType>();
            vector::push_back<PermissionType>(&mut sub_delegate_perms, PermissionType::SubDelegate {});

            if (is_any_permission_granted(caller, sub, sub_delegate_perms, 0)) {
                // Also verify they have the permission they're trying to delegate
                let delegating_perms = vector::empty<PermissionType>();
                vector::push_back<PermissionType>(&mut delegating_perms, permission);
                is_any_permission_granted(caller, sub, delegating_perms, expiration_to_check)
            } else {
                false
            }
        };

        assert!(can_delegate, E_NOT_AUTHORIZED_DELEGATE);

        add_delegated_permission(subaccount, delegate, permission, expiration);
    }

    /// Adds a delegated permission to a subaccount
    fun add_delegated_permission(
        subaccount: object::Object<Subaccount>,
        delegate: address,
        permission: PermissionType,
        expiration: option::Option<u64>
    ) acquires Subaccount {
        let subaccount_addr = object::object_address<Subaccount>(&subaccount);
        let permissions = &mut borrow_global_mut<Subaccount>(subaccount_addr).delegated_permissions;

        // Create delegation entry if it doesn't exist
        if (!big_ordered_map::contains<address, DelegatedPermissions>(permissions, &delegate)) {
            let empty_perms = DelegatedPermissions::V1 {
                perms: ordered_map::new<PermissionType, StoredPermission>()
            };
            let _old = big_ordered_map::upsert<address, DelegatedPermissions>(permissions, delegate, empty_perms);
        };

        // Create stored permission
        let stored = if (option::is_none<u64>(&expiration)) {
            StoredPermission::Unlimited {}
        } else {
            StoredPermission::UnlimitedUntil {
                expiration_timestamp: *option::borrow<u64>(&expiration)
            }
        };

        // Update the permission
        // Note: Using iterator pattern due to BigOrderedMap API
        let iter = big_ordered_map::internal_find<address, DelegatedPermissions>(permissions, &delegate);
        if (!big_ordered_map::iter_is_end<address, DelegatedPermissions>(&iter, permissions)) {
            let update_fn = |delegated_perms: &mut DelegatedPermissions| -> bool {
                let _old = ordered_map::upsert<PermissionType, StoredPermission>(
                    &mut delegated_perms.perms,
                    permission,
                    stored
                );
                true
            };
            let _result = big_ordered_map::iter_modify<address, DelegatedPermissions, bool>(
                iter,
                permissions,
                update_fn
            );
        } else {
            // Entry doesn't exist (shouldn't happen after upsert above)
            let new_perms = DelegatedPermissions::V1 {
                perms: ordered_map::new<PermissionType, StoredPermission>()
            };
            let _old = ordered_map::upsert<PermissionType, StoredPermission>(
                &mut (&mut new_perms).perms,
                permission,
                stored
            );
            big_ordered_map::add<address, DelegatedPermissions>(permissions, delegate, new_perms);
        };

        // Emit event
        event::emit<DelegationChangedEvent>(DelegationChangedEvent::V1 {
            subaccount: subaccount_addr,
            delegated_account: delegate,
            delegation: option::some<PermissionType>(permission),
            expiration_time_s: expiration,
        });
    }

    /// Lambda helper for add_delegated_permission
    fun lambda__1__add_delegated_permission(
        permission: PermissionType,
        stored: StoredPermission,
        delegated_perms: &mut DelegatedPermissions
    ): bool {
        let _old = ordered_map::upsert<PermissionType, StoredPermission>(
            &mut delegated_perms.perms,
            permission,
            stored
        );
        true
    }

    // =========================================================================
    // INTERNAL FUNCTIONS - HELPERS
    // =========================================================================

    /// Creates a builder code if both address and fee are present
    fun create_builder_code_if_present(
        builder_addr: option::Option<address>,
        builder_fee: option::Option<u64>
    ): option::Option<builder_code_registry::BuilderCode> {
        if (option::is_some<address>(&builder_addr)) {
            let addr = option::destroy_some<address>(builder_addr);
            let fee = option::destroy_some<u64>(builder_fee);
            option::some<builder_code_registry::BuilderCode>(
                perp_engine_api::new_builder_code(addr, fee)
            )
        } else {
            option::none<builder_code_registry::BuilderCode>()
        }
    }
}
