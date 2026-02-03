module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::vault_global_config {
    use 0x1::object;
    use 0x1::ordered_map;
    use 0x1::signer;
    use 0x1::error;
    use 0x1::option;
    use 0x1::string;
    use 0x1::event;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::vault;
    enum GlobalVaultConfig has key {
        V1 {
            extend_ref: object::ExtendRef,
            fee_config: GlobalVaultFeeConfig,
            requirements: GlobalVaultRequirements,
            share_config: GlobalVaultShareConfig,
            redemption_slippage_adjustment: RedemptionSlippageAdjustment,
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
            min_manager_funds_fraction_bps: u64,
            min_manager_funds_amount: u64,
            min_contribution_amount: u64,
            closing_size_bps: u64,
            closing_max_slippage_bps: u64,
        }
    }
    enum GlobalVaultShareConfig has copy, drop, store {
        V1 {
            max_contribution_lockup_seconds: u64,
        }
    }
    enum RedemptionSlippageAdjustment has drop, store {
        V1 {
            async_adjustment_bps: u64,
            free_collateral_factor_bps_to_adjustment_bps: ordered_map::OrderedMap<i64, u64>,
        }
    }
    enum GlobalVaultConfigUpdatedEvent has drop, store {
        V1 {
            max_fee_bps: u64,
            min_fee_interval: u64,
            max_fee_interval: u64,
            creation_fee: u64,
            creation_fee_recipient: address,
            min_funds_for_activation: u64,
            min_contribution_amount: u64,
            min_manager_funds_fraction_bps: u64,
            min_manager_funds_amount: u64,
            max_contribution_lockup_seconds: u64,
        }
    }
    friend fun initialize(p0: &signer, p1: GlobalVaultFeeConfig, p2: GlobalVaultRequirements, p3: GlobalVaultShareConfig, p4: RedemptionSlippageAdjustment) {
        assert!(signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88, 1);
        let _v0 = object::create_named_object(p0, vector[71u8, 108u8, 111u8, 98u8, 97u8, 108u8, 86u8, 97u8, 117u8, 108u8, 116u8, 67u8, 111u8, 110u8, 102u8, 105u8, 103u8]);
        let _v1 = GlobalVaultConfig::V1{extend_ref: object::generate_extend_ref(&_v0), fee_config: p1, requirements: p2, share_config: p3, redemption_slippage_adjustment: p4};
        emit_global_config_updated_event(&_v1);
        move_to<GlobalVaultConfig>(p0, _v1);
    }
    fun emit_global_config_updated_event(p0: &GlobalVaultConfig) {
        let _v0 = *&(&p0.fee_config).max_fee_bps;
        let _v1 = *&(&p0.fee_config).min_fee_interval;
        let _v2 = *&(&p0.fee_config).max_fee_interval;
        let _v3 = *&(&p0.fee_config).creation_fee;
        let _v4 = *&(&p0.fee_config).creation_fee_recipient;
        let _v5 = *&(&p0.requirements).min_funds_for_activation;
        let _v6 = *&(&p0.requirements).min_contribution_amount;
        let _v7 = *&(&p0.requirements).min_manager_funds_fraction_bps;
        let _v8 = *&(&p0.requirements).min_manager_funds_amount;
        let _v9 = *&(&p0.share_config).max_contribution_lockup_seconds;
        event::emit<GlobalVaultConfigUpdatedEvent>(GlobalVaultConfigUpdatedEvent::V1{max_fee_bps: _v0, min_fee_interval: _v1, max_fee_interval: _v2, creation_fee: _v3, creation_fee_recipient: _v4, min_funds_for_activation: _v5, min_contribution_amount: _v6, min_manager_funds_fraction_bps: _v7, min_manager_funds_amount: _v8, max_contribution_lockup_seconds: _v9});
    }
    fun init_module(p0: &signer) {
        let _v0 = GlobalVaultFeeConfig::V1{max_fee_bps: 1000, min_fee_interval: 2592000, max_fee_interval: 31536000, creation_fee: 0, creation_fee_recipient: @0x0};
        let _v1 = GlobalVaultRequirements::V1{min_funds_for_activation: 100000000, min_manager_funds_fraction_bps: 500, min_manager_funds_amount: 100000000000, min_contribution_amount: 10000000, closing_size_bps: 1000, closing_max_slippage_bps: 200};
        let _v2 = GlobalVaultShareConfig::V1{max_contribution_lockup_seconds: 604800};
        let _v3 = ordered_map::new_from<i64,u64>(vector[300i64, 500i64, 700i64, 900i64, 1000i64], vector[100, 70, 50, 30, 10]);
        let _v4 = RedemptionSlippageAdjustment::V1{async_adjustment_bps: 200, free_collateral_factor_bps_to_adjustment_bps: _v3};
        initialize(p0, _v0, _v1, _v2, _v4);
    }
    friend fun adjust_redemption_amount_and_get_adjustment_bps(p0: bool, p1: u64, p2: u64, p3: u64, p4: bool): (u64, u64)
        acquires GlobalVaultConfig
    {
        if (p0) {
            let _v0;
            let _v1;
            let _v2 = &borrow_global<GlobalVaultConfig>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).redemption_slippage_adjustment;
            if (p4) _v0 = *&_v2.async_adjustment_bps else {
                let _v3 = p2 - p1;
                _v1 = p3;
                if (_v1 != 0) {
                    let _v4 = (_v3 as u128) * 10000u128;
                    let _v5 = _v1 as u128;
                    let _v6 = ((_v4 / _v5) as u64) as i64;
                    let _v7 = &_v2.free_collateral_factor_bps_to_adjustment_bps;
                    let _v8 = &_v6;
                    let _v9 = ordered_map::next_key<i64,u64>(_v7, _v8);
                    if (option::is_some<i64>(&_v9)) {
                        let _v10 = &_v2.free_collateral_factor_bps_to_adjustment_bps;
                        let _v11 = option::destroy_some<i64>(_v9);
                        let _v12 = &_v11;
                        _v0 = option::destroy_some<u64>(ordered_map::get<i64,u64>(_v10, _v12))
                    } else _v0 = 0
                } else {
                    let _v13 = error::invalid_argument(4);
                    abort _v13
                }
            };
            if (_v0 > 0) {
                _v1 = 10000 - _v0;
                let _v14 = p1 as u128;
                let _v15 = _v1 as u128;
                p1 = (_v14 * _v15 / 10000u128) as u64
            };
            return (p1, _v0)
        };
        (p1, 0)
    }
    friend fun create_new_vault_object(p0: &string::String): object::ConstructorRef
        acquires GlobalVaultConfig
    {
        let _v0 = object::generate_signer_for_extending(&borrow_global<GlobalVaultConfig>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).extend_ref);
        let _v1 = &_v0;
        let _v2 = *string::bytes(p0);
        object::create_named_object(_v1, _v2)
    }
    friend fun create_redemption_slippage_adjustment_struct(p0: u64, p1: ordered_map::OrderedMap<i64, u64>): RedemptionSlippageAdjustment {
        RedemptionSlippageAdjustment::V1{async_adjustment_bps: p0, free_collateral_factor_bps_to_adjustment_bps: p1}
    }
    friend fun get_closing_max_slippage_bps(p0: &GlobalVaultRequirements): u64 {
        *&p0.closing_max_slippage_bps
    }
    friend fun get_closing_size_bps(p0: &GlobalVaultRequirements): u64 {
        *&p0.closing_size_bps
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
        *&borrow_global<GlobalVaultConfig>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).fee_config
    }
    friend fun get_global_requirements_config(): GlobalVaultRequirements
        acquires GlobalVaultConfig
    {
        *&borrow_global<GlobalVaultConfig>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).requirements
    }
    friend fun get_global_share_config(): GlobalVaultShareConfig
        acquires GlobalVaultConfig
    {
        *&borrow_global<GlobalVaultConfig>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).share_config
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
    friend fun get_min_contribution_amount(p0: &GlobalVaultRequirements): u64 {
        *&p0.min_contribution_amount
    }
    friend fun get_min_fee_interval(p0: &GlobalVaultFeeConfig): u64 {
        *&p0.min_fee_interval
    }
    friend fun get_min_funds_for_activation(p0: &GlobalVaultRequirements): u64 {
        *&p0.min_funds_for_activation
    }
    friend fun get_min_manager_funds_amount(p0: &GlobalVaultRequirements): u64 {
        *&p0.min_manager_funds_amount
    }
    friend fun get_min_manager_funds_fraction_bps(p0: &GlobalVaultRequirements): u64 {
        *&p0.min_manager_funds_fraction_bps
    }
    public entry fun update_global_creation_fee(p0: &signer, p1: u64, p2: address)
        acquires GlobalVaultConfig
    {
        assert!(signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88, 1);
        let _v0 = borrow_global_mut<GlobalVaultConfig>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v1 = &mut (&mut _v0.fee_config).creation_fee;
        *_v1 = p1;
        let _v2 = &mut (&mut _v0.fee_config).creation_fee_recipient;
        *_v2 = p2;
        emit_global_config_updated_event(freeze(_v0));
    }
    public entry fun update_global_fee_config(p0: &signer, p1: u64, p2: u64, p3: u64)
        acquires GlobalVaultConfig
    {
        assert!(signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88, 1);
        assert!(p1 <= 10000, 2);
        assert!(p2 > 0, 3);
        assert!(p3 >= p2, 3);
        let _v0 = borrow_global_mut<GlobalVaultConfig>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v1 = &mut (&mut _v0.fee_config).max_fee_bps;
        *_v1 = p1;
        _v1 = &mut (&mut _v0.fee_config).min_fee_interval;
        *_v1 = p2;
        _v1 = &mut (&mut _v0.fee_config).max_fee_interval;
        *_v1 = p3;
        emit_global_config_updated_event(freeze(_v0));
    }
    public entry fun update_global_redemption_slippage_adjustment(p0: &signer, p1: u64, p2: vector<i64>, p3: vector<u64>)
        acquires GlobalVaultConfig
    {
        assert!(signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88, 1);
        let _v0 = 0x1::vector::length<i64>(&p2);
        let _v1 = 0x1::vector::length<u64>(&p3);
        assert!(_v0 == _v1, 4);
        let _v2 = borrow_global_mut<GlobalVaultConfig>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v3 = ordered_map::new_from<i64,u64>(p2, p3);
        let _v4 = create_redemption_slippage_adjustment_struct(p1, _v3);
        let _v5 = &mut _v2.redemption_slippage_adjustment;
        *_v5 = _v4;
    }
    public entry fun update_minimum_contribution_amount(p0: &signer, p1: u64)
        acquires GlobalVaultConfig
    {
        assert!(signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88, 1);
        let _v0 = borrow_global_mut<GlobalVaultConfig>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v1 = &mut (&mut _v0.requirements).min_contribution_amount;
        *_v1 = p1;
        emit_global_config_updated_event(freeze(_v0));
    }
    public entry fun update_minimum_manager_funds(p0: &signer, p1: u64, p2: u64)
        acquires GlobalVaultConfig
    {
        assert!(signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88, 1);
        let _v0 = borrow_global_mut<GlobalVaultConfig>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v1 = &mut (&mut _v0.requirements).min_manager_funds_fraction_bps;
        *_v1 = p1;
        _v1 = &mut (&mut _v0.requirements).min_manager_funds_amount;
        *_v1 = p2;
        emit_global_config_updated_event(freeze(_v0));
    }
    friend fun validate_contribution_lockup_duration(p0: u64)
        acquires GlobalVaultConfig
    {
        let _v0 = get_global_share_config();
        let _v1 = get_max_contribution_lockup_seconds(&_v0);
        assert!(p0 <= _v1, 5);
    }
}
