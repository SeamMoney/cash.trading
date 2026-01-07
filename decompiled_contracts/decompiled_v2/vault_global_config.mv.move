module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::vault_global_config {
    use 0x1::object;
    use 0x1::signer;
    use 0x1::event;
    use 0x1::string;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::vault_share_asset;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::vault;
    enum GlobalVaultConfig has key {
        V1 {
            extend_ref: object::ExtendRef,
            fee_config: GlobalVaultFeeConfig,
            requirements: GlobalVaultRequirements,
            share_config: GlobalVaultShareConfig,
        }
    }
    enum GlobalVaultFeeConfig has copy, drop, store {
        V1 {
            max_fee_bps: u64,
            min_fee_interval: u64,
            max_fee_interval: u64,
            creation_fee: u64,
            creation_fee_recipient: address,
        }
    }
    enum GlobalVaultRequirements has copy, drop, store {
        V1 {
            min_funds_for_activation: u64,
            min_admin_funds_fraction_bps: u64,
            min_admin_funds_amount: u64,
        }
    }
    enum GlobalVaultShareConfig has copy, drop, store {
        V1 {
            max_contribution_lockup_seconds: u64,
        }
    }
    struct GlobalVaultConfigUpdatedEvent has drop, store {
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
    friend fun initialize(p0: &signer, p1: GlobalVaultFeeConfig, p2: GlobalVaultRequirements, p3: GlobalVaultShareConfig) {
        assert!(signer::address_of(p0) == @0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75, 1);
        let _v0 = object::create_named_object(p0, vector[71u8, 108u8, 111u8, 98u8, 97u8, 108u8, 86u8, 97u8, 117u8, 108u8, 116u8, 67u8, 111u8, 110u8, 102u8, 105u8, 103u8]);
        let _v1 = object::generate_extend_ref(&_v0);
        let _v2 = *&(&p1).max_fee_bps;
        let _v3 = *&(&p1).min_fee_interval;
        let _v4 = *&(&p1).max_fee_interval;
        let _v5 = *&(&p1).creation_fee;
        let _v6 = *&(&p1).creation_fee_recipient;
        let _v7 = *&(&p2).min_funds_for_activation;
        let _v8 = *&(&p2).min_admin_funds_fraction_bps;
        let _v9 = *&(&p2).min_admin_funds_amount;
        let _v10 = *&(&p3).max_contribution_lockup_seconds;
        event::emit<GlobalVaultConfigUpdatedEvent>(GlobalVaultConfigUpdatedEvent{max_fee_bps: _v2, min_fee_interval: _v3, max_fee_interval: _v4, creation_fee: _v5, creation_fee_recipient: _v6, min_funds_for_activation: _v7, min_admin_funds_fraction_bps: _v8, min_admin_funds_amount: _v9, max_contribution_lockup_seconds: _v10});
        let _v11 = GlobalVaultConfig::V1{extend_ref: _v1, fee_config: p1, requirements: p2, share_config: p3};
        move_to<GlobalVaultConfig>(p0, _v11);
    }
    fun init_module(p0: &signer) {
        let _v0 = GlobalVaultFeeConfig::V1{max_fee_bps: 1000, min_fee_interval: 2592000, max_fee_interval: 31536000, creation_fee: 100000000, creation_fee_recipient: @0x0};
        let _v1 = GlobalVaultRequirements::V1{min_funds_for_activation: 100000000, min_admin_funds_fraction_bps: 500, min_admin_funds_amount: 100000000000};
        let _v2 = GlobalVaultShareConfig::V1{max_contribution_lockup_seconds: 604800};
        initialize(p0, _v0, _v1, _v2);
    }
    friend fun create_fee_config_struct(p0: u64, p1: u64, p2: u64, p3: u64, p4: address): GlobalVaultFeeConfig {
        GlobalVaultFeeConfig::V1{max_fee_bps: p0, min_fee_interval: p1, max_fee_interval: p2, creation_fee: p3, creation_fee_recipient: p4}
    }
    friend fun create_new_vault_object(p0: &string::String): object::ConstructorRef
        acquires GlobalVaultConfig
    {
        let _v0 = object::generate_signer_for_extending(&borrow_global<GlobalVaultConfig>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).extend_ref);
        let _v1 = &_v0;
        let _v2 = *string::bytes(p0);
        object::create_named_object(_v1, _v2)
    }
    friend fun create_requirements_struct(p0: u64, p1: u64, p2: u64): GlobalVaultRequirements {
        GlobalVaultRequirements::V1{min_funds_for_activation: p0, min_admin_funds_fraction_bps: p1, min_admin_funds_amount: p2}
    }
    friend fun create_share_config_struct(p0: u64): GlobalVaultShareConfig {
        GlobalVaultShareConfig::V1{max_contribution_lockup_seconds: p0}
    }
    friend fun get_creation_fee(p0: &GlobalVaultFeeConfig): u64 {
        *&p0.creation_fee
    }
    friend fun get_creation_fee_recipient(p0: &GlobalVaultFeeConfig): address {
        *&p0.creation_fee_recipient
    }
    friend fun get_global_fee_config(): GlobalVaultFeeConfig
        acquires GlobalVaultConfig
    {
        *&borrow_global<GlobalVaultConfig>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).fee_config
    }
    friend fun get_global_requirements_config(): GlobalVaultRequirements
        acquires GlobalVaultConfig
    {
        *&borrow_global<GlobalVaultConfig>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).requirements
    }
    friend fun get_global_share_config(): GlobalVaultShareConfig
        acquires GlobalVaultConfig
    {
        *&borrow_global<GlobalVaultConfig>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).share_config
    }
    friend fun get_max_contribution_lockup_seconds(p0: &GlobalVaultShareConfig): u64 {
        *&p0.max_contribution_lockup_seconds
    }
    friend fun get_max_fee_bps(p0: &GlobalVaultFeeConfig): u64 {
        *&p0.max_fee_bps
    }
    friend fun get_max_fee_interval(p0: &GlobalVaultFeeConfig): u64 {
        *&p0.max_fee_interval
    }
    friend fun get_min_admin_funds_amount(p0: &GlobalVaultRequirements): u64 {
        *&p0.min_admin_funds_amount
    }
    friend fun get_min_admin_funds_fraction_bps(p0: &GlobalVaultRequirements): u64 {
        *&p0.min_admin_funds_fraction_bps
    }
    friend fun get_min_fee_interval(p0: &GlobalVaultFeeConfig): u64 {
        *&p0.min_fee_interval
    }
    friend fun get_min_funds_for_activation(p0: &GlobalVaultRequirements): u64 {
        *&p0.min_funds_for_activation
    }
    entry fun update_global_creation_fee(p0: &signer, p1: u64, p2: address)
        acquires GlobalVaultConfig
    {
        assert!(signer::address_of(p0) == @0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75, 1);
        let _v0 = borrow_global_mut<GlobalVaultConfig>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
        let _v1 = &mut (&mut _v0.fee_config).creation_fee;
        *_v1 = p1;
        let _v2 = &mut (&mut _v0.fee_config).creation_fee_recipient;
        *_v2 = p2;
        let _v3 = *&(&_v0.fee_config).max_fee_bps;
        let _v4 = *&(&_v0.fee_config).min_fee_interval;
        let _v5 = *&(&_v0.fee_config).max_fee_interval;
        let _v6 = *&(&_v0.fee_config).creation_fee;
        let _v7 = *&(&_v0.fee_config).creation_fee_recipient;
        let _v8 = *&(&_v0.requirements).min_funds_for_activation;
        let _v9 = *&(&_v0.requirements).min_admin_funds_fraction_bps;
        let _v10 = *&(&_v0.requirements).min_admin_funds_amount;
        let _v11 = *&(&_v0.share_config).max_contribution_lockup_seconds;
        event::emit<GlobalVaultConfigUpdatedEvent>(GlobalVaultConfigUpdatedEvent{max_fee_bps: _v3, min_fee_interval: _v4, max_fee_interval: _v5, creation_fee: _v6, creation_fee_recipient: _v7, min_funds_for_activation: _v8, min_admin_funds_fraction_bps: _v9, min_admin_funds_amount: _v10, max_contribution_lockup_seconds: _v11});
    }
    entry fun update_global_fee_config(p0: &signer, p1: u64, p2: u64, p3: u64)
        acquires GlobalVaultConfig
    {
        assert!(signer::address_of(p0) == @0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75, 1);
        assert!(p1 <= 10000, 2);
        assert!(p2 > 0, 3);
        assert!(p3 >= p2, 3);
        let _v0 = borrow_global_mut<GlobalVaultConfig>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
        let _v1 = &mut (&mut _v0.fee_config).max_fee_bps;
        *_v1 = p1;
        _v1 = &mut (&mut _v0.fee_config).min_fee_interval;
        *_v1 = p2;
        _v1 = &mut (&mut _v0.fee_config).max_fee_interval;
        *_v1 = p3;
        let _v2 = *&(&_v0.fee_config).max_fee_bps;
        let _v3 = *&(&_v0.fee_config).min_fee_interval;
        let _v4 = *&(&_v0.fee_config).max_fee_interval;
        let _v5 = *&(&_v0.fee_config).creation_fee;
        let _v6 = *&(&_v0.fee_config).creation_fee_recipient;
        let _v7 = *&(&_v0.requirements).min_funds_for_activation;
        let _v8 = *&(&_v0.requirements).min_admin_funds_fraction_bps;
        let _v9 = *&(&_v0.requirements).min_admin_funds_amount;
        let _v10 = *&(&_v0.share_config).max_contribution_lockup_seconds;
        event::emit<GlobalVaultConfigUpdatedEvent>(GlobalVaultConfigUpdatedEvent{max_fee_bps: _v2, min_fee_interval: _v3, max_fee_interval: _v4, creation_fee: _v5, creation_fee_recipient: _v6, min_funds_for_activation: _v7, min_admin_funds_fraction_bps: _v8, min_admin_funds_amount: _v9, max_contribution_lockup_seconds: _v10});
    }
}
