/// ============================================================================
/// VAULT GLOBAL CONFIG - Protocol-Wide Vault Configuration
/// ============================================================================
///
/// This module manages global configuration parameters for all vaults in the
/// Decibel protocol. It defines limits, fees, and requirements for vault
/// creation and operation.
///
/// KEY STRUCTURES:
/// - GlobalVaultConfig: Protocol-level vault settings
/// - GlobalVaultFeeConfig: Fee limits and creation fees
/// - GlobalVaultRequirements: Minimum funding and admin requirements
/// - GlobalVaultShareConfig: Share lockup configuration
///
/// DEFAULT VALUES (from init_module):
/// - Max fee: 10% (1000 bps)
/// - Min fee interval: 30 days (2,592,000 seconds)
/// - Max fee interval: 365 days (31,536,000 seconds)
/// - Creation fee: 100 USDC (100,000,000)
/// - Min funds for activation: 100 USDC
/// - Min admin funds fraction: 5% (500 bps)
/// - Min admin funds amount: 100,000 USDC
/// - Closing size: 10% per iteration (1000 bps)
/// - Closing max slippage: 2% (200 bps)
/// - Max contribution lockup: 7 days (604,800 seconds)
///
/// ============================================================================

module decibel::vault_global_config {
    use std::object;
    use std::signer;
    use std::event;
    use std::string;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::vault_share_asset;
    friend decibel::vault;

    // ============================================================================
    // CORE STRUCTURES
    // ============================================================================

    /// Global vault configuration stored at the protocol address
    enum GlobalVaultConfig has key {
        V1 {
            /// Extension reference for creating vault objects
            extend_ref: object::ExtendRef,
            /// Fee configuration (limits, creation fee)
            fee_config: GlobalVaultFeeConfig,
            /// Vault requirements (min funds, admin requirements)
            requirements: GlobalVaultRequirements,
            /// Share configuration (lockup limits)
            share_config: GlobalVaultShareConfig,
        }
    }

    /// Global fee configuration for vaults
    enum GlobalVaultFeeConfig has copy, drop, store {
        V1 {
            /// Maximum performance fee in basis points (10000 = 100%)
            max_fee_bps: u64,
            /// Minimum time between fee distributions (seconds)
            min_fee_interval: u64,
            /// Maximum time between fee distributions (seconds)
            max_fee_interval: u64,
            /// One-time fee for creating a vault
            creation_fee: u64,
            /// Address to receive vault creation fees
            creation_fee_recipient: address,
        }
    }

    /// Global requirements for vault activation and operation
    enum GlobalVaultRequirements has copy, drop, store {
        V1 {
            /// Minimum NAV required to activate a vault
            min_funds_for_activation: u64,
            /// Minimum admin contribution as fraction of vault (bps)
            min_admin_funds_fraction_bps: u64,
            /// Minimum absolute admin contribution amount
            min_admin_funds_amount: u64,
            /// Position closing size per iteration (bps of position)
            closing_size_bps: u64,
            /// Maximum slippage for closing orders (bps)
            closing_max_slippage_bps: u64,
        }
    }

    /// Global share configuration for vaults
    enum GlobalVaultShareConfig has copy, drop, store {
        V1 {
            /// Maximum lockup duration for contributions (seconds)
            max_contribution_lockup_seconds: u64,
        }
    }

    // ============================================================================
    // EVENTS
    // ============================================================================

    /// Emitted when global configuration is updated
    enum GlobalVaultConfigUpdatedEvent has drop, store {
        V1 {
            max_fee_bps: u64,
            min_fee_interval: u64,
            max_fee_interval: u64,
            creation_fee: u64,
            creation_fee_recipient: address,
            min_funds_for_activation: u64,
            min_admin_funds_fraction_bps: u64,
            min_admin_funds_amount: u64,
            max_contribution_lockup_seconds: u64,
        }
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Initialize global vault configuration (friend function)
    friend fun initialize(
        deployer: &signer,
        fee_config: GlobalVaultFeeConfig,
        requirements: GlobalVaultRequirements,
        share_config: GlobalVaultShareConfig
    ) {
        assert!(signer::address_of(deployer) == @decibel, 1);

        // Create named object for vault management - "GlobalVaultConfig"
        let constructor = object::create_named_object(
            deployer,
            vector[71u8, 108u8, 111u8, 98u8, 97u8, 108u8, 86u8, 97u8, 117u8, 108u8, 116u8, 67u8, 111u8, 110u8, 102u8, 105u8, 103u8]
        );
        let extend_ref = object::generate_extend_ref(&constructor);

        // Emit configuration event
        event::emit<GlobalVaultConfigUpdatedEvent>(GlobalVaultConfigUpdatedEvent::V1 {
            max_fee_bps: fee_config.max_fee_bps,
            min_fee_interval: fee_config.min_fee_interval,
            max_fee_interval: fee_config.max_fee_interval,
            creation_fee: fee_config.creation_fee,
            creation_fee_recipient: fee_config.creation_fee_recipient,
            min_funds_for_activation: requirements.min_funds_for_activation,
            min_admin_funds_fraction_bps: requirements.min_admin_funds_fraction_bps,
            min_admin_funds_amount: requirements.min_admin_funds_amount,
            max_contribution_lockup_seconds: share_config.max_contribution_lockup_seconds,
        });

        let config = GlobalVaultConfig::V1 {
            extend_ref,
            fee_config,
            requirements,
            share_config,
        };
        move_to<GlobalVaultConfig>(deployer, config);
    }

    /// Module initialization with default values
    fun init_module(deployer: &signer) {
        // Default fee config:
        // - Max fee: 10% (1000 bps)
        // - Min interval: 30 days
        // - Max interval: 365 days
        // - Creation fee: 100 USDC
        let fee_config = GlobalVaultFeeConfig::V1 {
            max_fee_bps: 1000,           // 10%
            min_fee_interval: 2592000,   // 30 days
            max_fee_interval: 31536000,  // 365 days
            creation_fee: 100000000,     // 100 USDC
            creation_fee_recipient: @0x0,
        };

        // Default requirements:
        // - Min funds for activation: 100 USDC
        // - Min admin fraction: 5%
        // - Min admin amount: 100,000 USDC
        // - Closing size: 10% per iteration
        // - Max closing slippage: 2%
        let requirements = GlobalVaultRequirements::V1 {
            min_funds_for_activation: 100000000,    // 100 USDC
            min_admin_funds_fraction_bps: 500,      // 5%
            min_admin_funds_amount: 100000000000,   // 100,000 USDC
            closing_size_bps: 1000,                 // 10%
            closing_max_slippage_bps: 200,          // 2%
        };

        // Default share config:
        // - Max lockup: 7 days
        let share_config = GlobalVaultShareConfig::V1 {
            max_contribution_lockup_seconds: 604800,  // 7 days
        };

        initialize(deployer, fee_config, requirements, share_config);
    }

    // ============================================================================
    // STRUCT CREATORS (Friend Functions)
    // ============================================================================

    /// Create a fee configuration struct
    friend fun create_fee_config_struct(
        max_fee_bps: u64,
        min_fee_interval: u64,
        max_fee_interval: u64,
        creation_fee: u64,
        creation_fee_recipient: address
    ): GlobalVaultFeeConfig {
        GlobalVaultFeeConfig::V1 {
            max_fee_bps,
            min_fee_interval,
            max_fee_interval,
            creation_fee,
            creation_fee_recipient,
        }
    }

    /// Create a vault object under the global config
    friend fun create_new_vault_object(vault_name: &string::String): object::ConstructorRef
        acquires GlobalVaultConfig
    {
        let config = borrow_global<GlobalVaultConfig>(@decibel);
        let signer = object::generate_signer_for_extending(&config.extend_ref);
        let name_bytes = *string::bytes(vault_name);
        object::create_named_object(&signer, name_bytes)
    }

    /// Create a requirements struct
    friend fun create_requirements_struct(
        min_funds_for_activation: u64,
        min_admin_funds_fraction_bps: u64,
        min_admin_funds_amount: u64,
        closing_size_bps: u64,
        closing_max_slippage_bps: u64
    ): GlobalVaultRequirements {
        GlobalVaultRequirements::V1 {
            min_funds_for_activation,
            min_admin_funds_fraction_bps,
            min_admin_funds_amount,
            closing_size_bps,
            closing_max_slippage_bps,
        }
    }

    /// Create a share configuration struct
    friend fun create_share_config_struct(
        max_contribution_lockup_seconds: u64
    ): GlobalVaultShareConfig {
        GlobalVaultShareConfig::V1 {
            max_contribution_lockup_seconds,
        }
    }

    // ============================================================================
    // GETTERS - Requirements Config
    // ============================================================================

    /// Get maximum slippage for closing positions
    friend fun get_closing_max_slippage_bps(config: &GlobalVaultRequirements): u64 {
        config.closing_max_slippage_bps
    }

    /// Get position closing size per iteration
    friend fun get_closing_size_bps(config: &GlobalVaultRequirements): u64 {
        config.closing_size_bps
    }

    // ============================================================================
    // GETTERS - Fee Config
    // ============================================================================

    /// Get vault creation fee
    friend fun get_creation_fee(config: &GlobalVaultFeeConfig): u64 {
        config.creation_fee
    }

    /// Get address that receives creation fees
    friend fun get_creation_fee_recipient(config: &GlobalVaultFeeConfig): address {
        config.creation_fee_recipient
    }

    /// Get the global fee configuration
    friend fun get_global_fee_config(): GlobalVaultFeeConfig
        acquires GlobalVaultConfig
    {
        *&borrow_global<GlobalVaultConfig>(@decibel).fee_config
    }

    /// Get the global requirements configuration
    friend fun get_global_requirements_config(): GlobalVaultRequirements
        acquires GlobalVaultConfig
    {
        *&borrow_global<GlobalVaultConfig>(@decibel).requirements
    }

    /// Get the global share configuration
    friend fun get_global_share_config(): GlobalVaultShareConfig
        acquires GlobalVaultConfig
    {
        *&borrow_global<GlobalVaultConfig>(@decibel).share_config
    }

    /// Get maximum contribution lockup duration
    friend fun get_max_contribution_lockup_seconds(config: &GlobalVaultShareConfig): u64 {
        config.max_contribution_lockup_seconds
    }

    /// Get maximum allowed fee in basis points
    friend fun get_max_fee_bps(config: &GlobalVaultFeeConfig): u64 {
        config.max_fee_bps
    }

    /// Get maximum fee distribution interval
    friend fun get_max_fee_interval(config: &GlobalVaultFeeConfig): u64 {
        config.max_fee_interval
    }

    /// Get minimum admin contribution amount
    friend fun get_min_admin_funds_amount(config: &GlobalVaultRequirements): u64 {
        config.min_admin_funds_amount
    }

    /// Get minimum admin contribution as fraction of vault
    friend fun get_min_admin_funds_fraction_bps(config: &GlobalVaultRequirements): u64 {
        config.min_admin_funds_fraction_bps
    }

    /// Get minimum fee distribution interval
    friend fun get_min_fee_interval(config: &GlobalVaultFeeConfig): u64 {
        config.min_fee_interval
    }

    /// Get minimum funds required to activate vault
    friend fun get_min_funds_for_activation(config: &GlobalVaultRequirements): u64 {
        config.min_funds_for_activation
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    /// Update vault creation fee (admin only)
    entry fun update_global_creation_fee(
        admin: &signer,
        new_creation_fee: u64,
        new_recipient: address
    ) acquires GlobalVaultConfig {
        assert!(signer::address_of(admin) == @decibel, 1);

        let config = borrow_global_mut<GlobalVaultConfig>(@decibel);
        config.fee_config.creation_fee = new_creation_fee;
        config.fee_config.creation_fee_recipient = new_recipient;

        // Emit updated configuration event
        event::emit<GlobalVaultConfigUpdatedEvent>(GlobalVaultConfigUpdatedEvent::V1 {
            max_fee_bps: config.fee_config.max_fee_bps,
            min_fee_interval: config.fee_config.min_fee_interval,
            max_fee_interval: config.fee_config.max_fee_interval,
            creation_fee: config.fee_config.creation_fee,
            creation_fee_recipient: config.fee_config.creation_fee_recipient,
            min_funds_for_activation: config.requirements.min_funds_for_activation,
            min_admin_funds_fraction_bps: config.requirements.min_admin_funds_fraction_bps,
            min_admin_funds_amount: config.requirements.min_admin_funds_amount,
            max_contribution_lockup_seconds: config.share_config.max_contribution_lockup_seconds,
        });
    }

    /// Update global fee configuration (admin only)
    entry fun update_global_fee_config(
        admin: &signer,
        new_max_fee_bps: u64,
        new_min_fee_interval: u64,
        new_max_fee_interval: u64
    ) acquires GlobalVaultConfig {
        assert!(signer::address_of(admin) == @decibel, 1);

        // Validate parameters
        assert!(new_max_fee_bps <= 10000, 2);  // Max 100%
        assert!(new_min_fee_interval > 0, 3);
        assert!(new_max_fee_interval >= new_min_fee_interval, 3);

        let config = borrow_global_mut<GlobalVaultConfig>(@decibel);
        config.fee_config.max_fee_bps = new_max_fee_bps;
        config.fee_config.min_fee_interval = new_min_fee_interval;
        config.fee_config.max_fee_interval = new_max_fee_interval;

        // Emit updated configuration event
        event::emit<GlobalVaultConfigUpdatedEvent>(GlobalVaultConfigUpdatedEvent::V1 {
            max_fee_bps: config.fee_config.max_fee_bps,
            min_fee_interval: config.fee_config.min_fee_interval,
            max_fee_interval: config.fee_config.max_fee_interval,
            creation_fee: config.fee_config.creation_fee,
            creation_fee_recipient: config.fee_config.creation_fee_recipient,
            min_funds_for_activation: config.requirements.min_funds_for_activation,
            min_admin_funds_fraction_bps: config.requirements.min_admin_funds_fraction_bps,
            min_admin_funds_amount: config.requirements.min_admin_funds_amount,
            max_contribution_lockup_seconds: config.share_config.max_contribution_lockup_seconds,
        });
    }
}
