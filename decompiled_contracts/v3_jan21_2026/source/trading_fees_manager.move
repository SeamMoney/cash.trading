module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::trading_fees_manager {
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::volume_tracker;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::referral_registry;
    use 0x1::signer;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::builder_code_registry;
    use 0x1::event;
    use 0x1::error;
    use 0x1::string;
    use 0x1::option;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::fee_distribution;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::collateral_balance_sheet;
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market_config;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_update;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::accounts_collateral;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::admin_apis;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine_api;
    enum GlobalState has key {
        V1 {
            volume_stats: volume_tracker::VolumeStats,
            fee_config: TradingFeeConfiguration,
            referrals: referral_registry::Referrals,
        }
    }
    enum TradingFeeConfiguration has copy, drop, store {
        V1 {
            tier_thresholds: vector<u128>,
            tier_maker_fees: vector<u64>,
            tier_taker_fees: vector<u64>,
            market_maker_absolute_threshold: u128,
            market_maker_tier_pct_thresholds: vector<u64>,
            market_maker_tier_fee_rebates: vector<u64>,
            builder_max_fee: u64,
            backstop_vault_fee_pct: u64,
            referral_fee_config: ReferralFeeConfig,
        }
    }
    enum ReferralFeeConfig has copy, drop, store {
        V1 {
            referral_fee_enabled: bool,
            referral_fee_pct: u64,
            referred_fee_discount_pct: u64,
            discount_eligibility_volume_threshold: u128,
            referrer_eligibility_volume_threshold: u128,
        }
    }
    enum TradingFeeTierUpdatedEvent has copy, drop, store {
        V1 {
            config: TradingFeeConfiguration,
        }
    }
    friend fun initialize(p0: &signer, p1: u64) {
        if (!(signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88)) {
            let _v0 = error::invalid_argument(1);
            abort _v0
        };
        let _v1 = volume_tracker::initialize();
        let _v2 = referral_registry::initialize();
        let _v3 = create_default_config(p1 as u128);
        let _v4 = *&(&_v3).builder_max_fee;
        builder_code_registry::initialize(p0, _v4);
        let _v5 = GlobalState::V1{volume_stats: _v1, fee_config: _v3, referrals: _v2};
        move_to<GlobalState>(p0, _v5);
        event::emit<TradingFeeTierUpdatedEvent>(TradingFeeTierUpdatedEvent::V1{config: _v3});
    }
    fun create_default_config(p0: u128): TradingFeeConfiguration {
        let _v0 = 10000000u128 * p0;
        let _v1 = 50000000u128 * p0;
        let _v2 = 200000000u128 * p0;
        let _v3 = 1000000000u128 * p0;
        let _v4 = 4000000000u128 * p0;
        let _v5 = 15000000000u128 * p0;
        let _v6 = 0x1::vector::empty<u128>();
        let _v7 = &mut _v6;
        0x1::vector::push_back<u128>(_v7, _v0);
        0x1::vector::push_back<u128>(_v7, _v1);
        0x1::vector::push_back<u128>(_v7, _v2);
        0x1::vector::push_back<u128>(_v7, _v3);
        0x1::vector::push_back<u128>(_v7, _v4);
        0x1::vector::push_back<u128>(_v7, _v5);
        let _v8 = 0x1::vector::empty<u64>();
        let _v9 = 0x1::vector::empty<u64>();
        let _v10 = create_default_referral_fee_config();
        TradingFeeConfiguration::V1{tier_thresholds: _v6, tier_maker_fees: vector[110, 90, 60, 30, 0, 0, 0], tier_taker_fees: vector[340, 300, 250, 220, 210, 190, 180], market_maker_absolute_threshold: 0u128, market_maker_tier_pct_thresholds: _v8, market_maker_tier_fee_rebates: _v9, builder_max_fee: 1000, backstop_vault_fee_pct: 0, referral_fee_config: _v10}
    }
    public fun get_global_volume_in_window(): u128
        acquires GlobalState
    {
        volume_tracker::get_global_volume_in_window(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).volume_stats)
    }
    public fun get_maker_volume_all_time(p0: address): u128
        acquires GlobalState
    {
        volume_tracker::get_maker_volume_all_time(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).volume_stats, p0)
    }
    public fun get_maker_volume_in_window(p0: address): u128
        acquires GlobalState
    {
        volume_tracker::get_maker_volume_in_window(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).volume_stats, p0)
    }
    public fun get_taker_volume_all_time(p0: address): u128
        acquires GlobalState
    {
        volume_tracker::get_taker_volume_all_time(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).volume_stats, p0)
    }
    public fun get_taker_volume_in_window(p0: address): u128
        acquires GlobalState
    {
        volume_tracker::get_taker_volume_in_window(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).volume_stats, p0)
    }
    public fun get_total_volume_in_window(p0: address): u128
        acquires GlobalState
    {
        volume_tracker::get_total_volume_in_window(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).volume_stats, p0)
    }
    friend fun track_taker_volume(p0: address, p1: u128)
        acquires GlobalState
    {
        volume_tracker::track_taker_volume(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).volume_stats, p0, p1);
    }
    friend fun track_volume(p0: address, p1: address, p2: u128)
        acquires GlobalState
    {
        volume_tracker::track_volume(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).volume_stats, p0, p1, p2);
    }
    public fun get_referral_codes(p0: address): vector<string::String>
        acquires GlobalState
    {
        referral_registry::get_referral_codes(&borrow_global<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).referrals, p0)
    }
    public fun get_referrer_addr(p0: address): option::Option<address>
        acquires GlobalState
    {
        referral_registry::get_referrer_addr(&borrow_global<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).referrals, p0)
    }
    friend fun register_affiliate(p0: address)
        acquires GlobalState
    {
        referral_registry::register_affiliate(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).referrals, p0);
    }
    friend fun register_referral_code(p0: address, p1: string::String)
        acquires GlobalState
    {
        referral_registry::register_referral_code(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).referrals, p0, p1, false);
    }
    friend fun set_max_referral_codes_for_address(p0: address, p1: u64)
        acquires GlobalState
    {
        referral_registry::set_max_referral_codes_for_address(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).referrals, p0, p1);
    }
    friend fun set_max_usage_per_referral_code_for_address(p0: address, p1: u64)
        acquires GlobalState
    {
        referral_registry::set_max_usage_per_referral_code_for_address(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).referrals, p0, p1);
    }
    friend fun distribute_fees(p0: &fee_distribution::FeeDistribution, p1: &fee_distribution::FeeDistribution, p2: &mut collateral_balance_sheet::CollateralBalanceSheet, p3: address, p4: object::Object<perp_market::PerpMarket>)
        acquires GlobalState
    {
        let _v0 = *&(&borrow_global<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).fee_config).backstop_vault_fee_pct;
        fee_distribution::distribute_fees(p0, p1, p2, p3, _v0, p4);
    }
    friend fun admin_register_referral_code(p0: address, p1: string::String)
        acquires GlobalState
    {
        referral_registry::register_referral_code(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).referrals, p0, p1, true);
    }
    friend fun admin_register_referrer(p0: address, p1: string::String)
        acquires GlobalState
    {
        referral_registry::register_referral(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).referrals, p0, p1, true);
    }
    fun create_default_referral_fee_config(): ReferralFeeConfig {
        ReferralFeeConfig::V1{referral_fee_enabled: false, referral_fee_pct: 0, referred_fee_discount_pct: 0, discount_eligibility_volume_threshold: 100000000u128, referrer_eligibility_volume_threshold: 10000u128}
    }
    public fun get_fee_tier(p0: address): u64
        acquires GlobalState
    {
        let _v0 = borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v1 = volume_tracker::get_total_volume_in_window(&mut _v0.volume_stats, p0);
        let _v2 = &(&_v0.fee_config).tier_thresholds;
        let _v3 = 0;
        loop {
            let _v4;
            let _v5 = 0x1::vector::length<u128>(_v2);
            if (_v3 < _v5) {
                let _v6 = *0x1::vector::borrow<u128>(_v2, _v3);
                _v4 = _v1 >= _v6
            } else _v4 = false;
            if (!_v4) break;
            _v3 = _v3 + 1;
            continue
        };
        _v3
    }
    friend fun get_fees_for_margin_call(p0: collateral_balance_sheet::CollateralBalanceType, p1: u128, p2: u64): fee_distribution::FeeDistribution {
        let _v0 = (p2 as u128) * 1000000u128;
        let _v1 = perp_market_config::get_slippage_and_margin_call_fee_scale() as u128;
        let _v2 = ((_v0 / _v1) as u64) as u128;
        let _v3 = (p1 * _v2 / 1000000u128) as u64;
        fee_distribution::new_margin_call_fee_distribution(p0, _v3)
    }
    friend fun get_maker_fee_for_notional(p0: address, p1: address, p2: collateral_balance_sheet::CollateralBalanceType, p3: u128, p4: option::Option<builder_code_registry::BuilderCode>): fee_distribution::FeeDistribution
        acquires GlobalState
    {
        let _v0;
        let _v1;
        let (_v2,_v3,_v4,_v5) = get_maker_fees_and_config(p1);
        let _v6 = _v5;
        let _v7 = _v3;
        let _v8 = _v2;
        let _v9 = _v8 != 0;
        'l0: loop {
            let _v10;
            let _v11;
            loop {
                let _v12;
                let _v13;
                if (_v9) {
                    let _v14 = _v8 as u128;
                    _v1 = (p3 * _v14 / 1000000u128) as u64;
                    let _v15 = p4;
                    if (option::is_some<builder_code_registry::BuilderCode>(&_v15)) {
                        _v13 = option::destroy_some<builder_code_registry::BuilderCode>(_v15);
                        _v12 = builder_code_registry::get_builder_fee_for_notional(p0, _v13, p3)
                    } else _v12 = 0;
                    _v11 = p2;
                    let _v16 = _v12 as i64;
                    let _v17 = _v1 as i64;
                    _v10 = _v16 - _v17;
                    if (_v12 > 0) {
                        _v0 = option::some<fee_distribution::FeeWithDestination>(fee_distribution::new_fee_with_destination(builder_code_registry::get_builder_from_builder_code(option::borrow<builder_code_registry::BuilderCode>(&p4)), _v12));
                        break
                    };
                    _v0 = option::none<fee_distribution::FeeWithDestination>();
                    break
                };
                let _v18 = _v7 as u128;
                _v8 = (p3 * _v18 / 1000000u128) as u64;
                let _v19 = p4;
                if (option::is_some<builder_code_registry::BuilderCode>(&_v19)) {
                    _v13 = option::destroy_some<builder_code_registry::BuilderCode>(_v19);
                    _v7 = builder_code_registry::get_builder_fee_for_notional(p0, _v13, p3)
                } else _v7 = 0;
                if (_v7 > 0) {
                    _v1 = _v8;
                    _v0 = option::some<fee_distribution::FeeWithDestination>(fee_distribution::new_fee_with_destination(builder_code_registry::get_builder_from_builder_code(option::borrow<builder_code_registry::BuilderCode>(&p4)), _v7));
                    break 'l0
                };
                _v12 = _v8;
                let _v20 = p1;
                let _v21 = &_v6;
                if (!*&_v21.referral_fee_enabled) {
                    _v1 = _v12;
                    _v0 = option::none<fee_distribution::FeeWithDestination>();
                    break 'l0
                };
                let _v22 = get_referrer_addr(_v20);
                if (option::is_none<address>(&_v22)) {
                    _v1 = _v12;
                    _v0 = option::none<fee_distribution::FeeWithDestination>();
                    break 'l0
                };
                let _v23 = get_user_volume_all_time(_v20);
                let _v24 = *&_v21.discount_eligibility_volume_threshold;
                if (_v23 >= _v24) {
                    _v1 = _v12;
                    _v0 = option::none<fee_distribution::FeeWithDestination>();
                    break 'l0
                };
                let _v25 = option::destroy_some<address>(_v22);
                let _v26 = *&_v21.referred_fee_discount_pct;
                let _v27 = 100 - _v26;
                _v12 = _v12 * _v27 / 100;
                let _v28 = *&_v21.referral_fee_pct;
                let _v29 = _v12 * _v28 / 100;
                _v1 = _v12;
                _v0 = option::some<fee_distribution::FeeWithDestination>(fee_distribution::new_fee_with_destination(_v25, _v29));
                break 'l0
            };
            return fee_distribution::new_fee_distribution(_v11, _v10, _v0)
        };
        let _v30 = (_v1 + _v7) as i64;
        fee_distribution::new_fee_distribution(p2, _v30, _v0)
    }
    public fun get_maker_fees_and_config(p0: address): (u64, u64, u64, ReferralFeeConfig)
        acquires GlobalState
    {
        let _v0;
        let _v1 = borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v2 = volume_tracker::get_total_volume_in_window(&mut _v1.volume_stats, p0);
        if (*&(&_v1.fee_config).market_maker_absolute_threshold != 0u128) {
            let _v3 = volume_tracker::get_global_volume_in_window(&mut _v1.volume_stats);
            _v0 = get_market_maker_fee_rebate(&_v1.fee_config, _v2, _v3)
        } else _v0 = 0;
        if (_v0 != 0) {
            let _v4 = *&(&_v1.fee_config).backstop_vault_fee_pct;
            let _v5 = *&(&_v1.fee_config).referral_fee_config;
            return (_v0, 0, _v4, _v5)
        };
        let _v6 = get_maker_fees_for_volume(&_v1.fee_config, _v2);
        let _v7 = *&(&_v1.fee_config).backstop_vault_fee_pct;
        let _v8 = *&(&_v1.fee_config).referral_fee_config;
        (0, _v6, _v7, _v8)
    }
    public fun get_user_volume_all_time(p0: address): u128
        acquires GlobalState
    {
        let _v0 = get_maker_volume_all_time(p0);
        let _v1 = get_taker_volume_all_time(p0);
        _v0 + _v1
    }
    fun get_market_maker_fee_rebate(p0: &TradingFeeConfiguration, p1: u128, p2: u128): u64 {
        let _v0;
        let _v1 = 0x1::vector::length<u64>(&p0.market_maker_tier_fee_rebates);
        'l1: loop {
            'l0: loop {
                loop {
                    if (!(_v1 == 0)) {
                        let _v2 = *&p0.market_maker_absolute_threshold;
                        if (p1 < _v2) break;
                        if (p2 == 0u128) break 'l0;
                        if (!(p2 != 0u128)) {
                            let _v3 = error::invalid_argument(4);
                            abort _v3
                        };
                        let _v4 = (p1 as u256) * 10000u256;
                        let _v5 = p2 as u256;
                        let _v6 = ((_v4 / _v5) as u128) as u64;
                        _v0 = 0;
                        loop {
                            let _v7;
                            let _v8 = 0x1::vector::length<u64>(&p0.market_maker_tier_pct_thresholds);
                            if (_v0 < _v8) {
                                let _v9 = *0x1::vector::borrow<u64>(&p0.market_maker_tier_pct_thresholds, _v0);
                                _v7 = _v6 >= _v9
                            } else _v7 = false;
                            if (!_v7) break 'l1;
                            _v0 = _v0 + 1;
                            continue
                        }
                    };
                    return 0
                };
                return 0
            };
            return 0
        };
        *0x1::vector::borrow<u64>(&p0.market_maker_tier_fee_rebates, _v0)
    }
    fun get_maker_fees_for_volume(p0: &TradingFeeConfiguration, p1: u128): u64 {
        let _v0 = 0;
        loop {
            let _v1;
            let _v2 = 0x1::vector::length<u128>(&p0.tier_thresholds);
            if (_v0 < _v2) {
                let _v3 = *0x1::vector::borrow<u128>(&p0.tier_thresholds, _v0);
                _v1 = p1 >= _v3
            } else _v1 = false;
            if (!_v1) break;
            _v0 = _v0 + 1;
            continue
        };
        *0x1::vector::borrow<u64>(&p0.tier_maker_fees, _v0)
    }
    friend fun get_taker_fee_for_notional(p0: address, p1: address, p2: collateral_balance_sheet::CollateralBalanceType, p3: u128, p4: option::Option<builder_code_registry::BuilderCode>): fee_distribution::FeeDistribution
        acquires GlobalState
    {
        let _v0;
        let _v1;
        let _v2;
        let (_v3,_v4,_v5) = get_taker_fees_and_config(p1);
        let _v6 = _v5;
        let _v7 = _v3;
        let _v8 = _v7 as u128;
        _v7 = (p3 * _v8 / 1000000u128) as u64;
        let _v9 = p4;
        if (option::is_some<builder_code_registry::BuilderCode>(&_v9)) {
            let _v10 = option::destroy_some<builder_code_registry::BuilderCode>(_v9);
            _v2 = builder_code_registry::get_builder_fee_for_notional(p0, _v10, p3)
        } else _v2 = 0;
        if (_v2 > 0) {
            _v1 = _v7;
            _v0 = option::some<fee_distribution::FeeWithDestination>(fee_distribution::new_fee_with_destination(builder_code_registry::get_builder_from_builder_code(option::borrow<builder_code_registry::BuilderCode>(&p4)), _v2))
        } else {
            let _v11 = _v7;
            let _v12 = p1;
            let _v13 = &_v6;
            if (*&_v13.referral_fee_enabled) {
                let _v14 = get_referrer_addr(_v12);
                if (option::is_none<address>(&_v14)) {
                    _v1 = _v11;
                    _v0 = option::none<fee_distribution::FeeWithDestination>()
                } else {
                    let _v15 = get_user_volume_all_time(_v12);
                    let _v16 = *&_v13.discount_eligibility_volume_threshold;
                    if (_v15 >= _v16) {
                        _v1 = _v11;
                        _v0 = option::none<fee_distribution::FeeWithDestination>()
                    } else {
                        let _v17 = option::destroy_some<address>(_v14);
                        let _v18 = *&_v13.referred_fee_discount_pct;
                        let _v19 = 100 - _v18;
                        _v11 = _v11 * _v19 / 100;
                        let _v20 = *&_v13.referral_fee_pct;
                        let _v21 = _v11 * _v20 / 100;
                        _v1 = _v11;
                        _v0 = option::some<fee_distribution::FeeWithDestination>(fee_distribution::new_fee_with_destination(_v17, _v21))
                    }
                }
            } else {
                _v1 = _v11;
                _v0 = option::none<fee_distribution::FeeWithDestination>()
            }
        };
        let _v22 = (_v1 + _v2) as i64;
        fee_distribution::new_fee_distribution(p2, _v22, _v0)
    }
    public fun get_taker_fees_and_config(p0: address): (u64, u64, ReferralFeeConfig)
        acquires GlobalState
    {
        let _v0 = borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v1 = volume_tracker::get_total_volume_in_window(&mut _v0.volume_stats, p0);
        let _v2 = get_taker_fees_for_volume(&_v0.fee_config, _v1);
        let _v3 = *&(&_v0.fee_config).backstop_vault_fee_pct;
        let _v4 = *&(&_v0.fee_config).referral_fee_config;
        (_v2, _v3, _v4)
    }
    fun get_taker_fees_for_volume(p0: &TradingFeeConfiguration, p1: u128): u64 {
        let _v0 = 0;
        loop {
            let _v1;
            let _v2 = 0x1::vector::length<u128>(&p0.tier_thresholds);
            if (_v0 < _v2) {
                let _v3 = *0x1::vector::borrow<u128>(&p0.tier_thresholds, _v0);
                _v1 = p1 >= _v3
            } else _v1 = false;
            if (!_v1) break;
            _v0 = _v0 + 1;
            continue
        };
        *0x1::vector::borrow<u64>(&p0.tier_taker_fees, _v0)
    }
    public fun get_user_volume_in_window(p0: address): u128
        acquires GlobalState
    {
        let _v0 = get_maker_volume_in_window(p0);
        let _v1 = get_taker_volume_in_window(p0);
        _v0 + _v1
    }
    friend fun register_referrer(p0: address, p1: string::String)
        acquires GlobalState
    {
        let _v0 = get_user_volume_all_time(p0);
        let _v1 = *&(&(&borrow_global<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).fee_config).referral_fee_config).referrer_eligibility_volume_threshold;
        if (!(_v0 < _v1)) {
            let _v2 = error::invalid_argument(2);
            abort _v2
        };
        referral_registry::register_referral(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).referrals, p0, p1, false);
    }
    friend fun track_global_and_maker_volume(p0: address, p1: u128)
        acquires GlobalState
    {
        volume_tracker::track_volume(&mut borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).volume_stats, p0, @0x0, p1);
    }
    friend fun update_fee_config(p0: &signer, p1: vector<u128>, p2: vector<u64>, p3: vector<u64>, p4: u128, p5: vector<u64>, p6: vector<u64>, p7: u64, p8: u64, p9: bool, p10: u64, p11: u64, p12: u128, p13: u128)
        acquires GlobalState
    {
        if (!(signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88)) {
            let _v0 = error::invalid_argument(1);
            abort _v0
        };
        let _v1 = borrow_global_mut<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v2 = ReferralFeeConfig::V1{referral_fee_enabled: p9, referral_fee_pct: p10, referred_fee_discount_pct: p11, discount_eligibility_volume_threshold: p12, referrer_eligibility_volume_threshold: p13};
        let _v3 = TradingFeeConfiguration::V1{tier_thresholds: p1, tier_maker_fees: p2, tier_taker_fees: p3, market_maker_absolute_threshold: p4, market_maker_tier_pct_thresholds: p5, market_maker_tier_fee_rebates: p6, builder_max_fee: p7, backstop_vault_fee_pct: p8, referral_fee_config: _v2};
        builder_code_registry::set_global_max_fee(p7);
        event::emit<TradingFeeTierUpdatedEvent>(TradingFeeTierUpdatedEvent::V1{config: _v3});
        let _v4 = &mut _v1.fee_config;
        *_v4 = _v3;
    }
    public fun view_global_volume_history(): volume_tracker::VolumeHistoryView
        acquires GlobalState
    {
        volume_tracker::get_global_volume_history_view(&borrow_global<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).volume_stats)
    }
    public fun view_maker_volume_history(p0: address): option::Option<volume_tracker::VolumeHistoryView>
        acquires GlobalState
    {
        volume_tracker::get_maker_volume_history_view(&borrow_global<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).volume_stats, p0)
    }
    public fun view_referral_code_state(p0: string::String): option::Option<referral_registry::ReferralCode>
        acquires GlobalState
    {
        referral_registry::get_referral_code_state(&borrow_global<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).referrals, p0)
    }
    public fun view_referrer_for_code(p0: string::String): option::Option<address>
        acquires GlobalState
    {
        referral_registry::get_referrer_for_code(&borrow_global<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).referrals, p0)
    }
    public fun view_referrer_state(p0: address): option::Option<referral_registry::ReferrerState>
        acquires GlobalState
    {
        referral_registry::get_referrer_state(&borrow_global<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).referrals, p0)
    }
    public fun view_taker_volume_history(p0: address): option::Option<volume_tracker::VolumeHistoryView>
        acquires GlobalState
    {
        volume_tracker::get_taker_volume_history_view(&borrow_global<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).volume_stats, p0)
    }
    public fun view_trading_fee_config(): TradingFeeConfiguration
        acquires GlobalState
    {
        *&borrow_global<GlobalState>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).fee_config
    }
}
