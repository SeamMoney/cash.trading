module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::fee_distribution {
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::collateral_balance_sheet;
    use 0x1::option;
    use 0x1::error;
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market_config;
    use 0x1::fungible_asset;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::fee_treasury;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::backstop_liquidator_profit_tracker;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::trading_fees_manager;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_positions;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_update;
    enum FeeDistribution has copy, drop, store {
        RegularTrade_V1 {
            balance_type: collateral_balance_sheet::CollateralBalanceType,
            position_fee_delta: i64,
            treasury_fee_delta: i64,
            builder_or_referrer_fees: option::Option<FeeWithDestination>,
        }
        MarginCall_V1 {
            balance_type: collateral_balance_sheet::CollateralBalanceType,
            position_fee_delta: i64,
        }
    }
    struct FeeWithDestination has copy, drop, store {
        address: address,
        fees: u64,
    }
    friend fun add(p0: &FeeDistribution, p1: FeeDistribution): FeeDistribution {
        let _v0;
        if (!(p0 is RegularTrade_V1)) {
            let _v1 = error::invalid_argument(4);
            abort _v1
        };
        let _v2 = &p0.balance_type;
        let _v3 = &p0.position_fee_delta;
        let _v4 = &p0.treasury_fee_delta;
        let _v5 = &p0.builder_or_referrer_fees;
        let _v6 = &p1;
        if (!(_v6 is RegularTrade_V1)) {
            let _v7 = error::invalid_argument(4);
            abort _v7
        };
        let _v8 = &_v6.balance_type;
        let _v9 = &_v6.position_fee_delta;
        let _v10 = &_v6.treasury_fee_delta;
        let _v11 = &_v6.builder_or_referrer_fees;
        let _v12 = *_v2;
        let _v13 = *_v8;
        if (!(_v12 == _v13)) {
            let _v14 = error::invalid_argument(4);
            abort _v14
        };
        let _v15 = option::is_none<FeeWithDestination>(_v5);
        let _v16 = option::is_none<FeeWithDestination>(_v11);
        if (!(_v15 == _v16)) {
            let _v17 = error::invalid_argument(4);
            abort _v17
        };
        if (option::is_some<FeeWithDestination>(_v5)) {
            let _v18 = *&option::borrow<FeeWithDestination>(_v5).address;
            let _v19 = *&option::borrow<FeeWithDestination>(_v11).address;
            if (!(_v18 == _v19)) {
                let _v20 = error::invalid_argument(3);
                abort _v20
            }
        };
        let _v21 = *_v2;
        let _v22 = *_v3;
        let _v23 = *_v9;
        let _v24 = _v22 + _v23;
        let _v25 = *_v4;
        let _v26 = *_v10;
        let _v27 = _v25 + _v26;
        if (option::is_some<FeeWithDestination>(_v5)) {
            let _v28 = *&option::borrow<FeeWithDestination>(_v5).address;
            let _v29 = *&option::borrow<FeeWithDestination>(_v5).fees;
            let _v30 = *&option::borrow<FeeWithDestination>(_v11).fees;
            let _v31 = _v29 + _v30;
            _v0 = option::some<FeeWithDestination>(FeeWithDestination{address: _v28, fees: _v31})
        } else _v0 = option::none<FeeWithDestination>();
        FeeDistribution::RegularTrade_V1{balance_type: _v21, position_fee_delta: _v24, treasury_fee_delta: _v27, builder_or_referrer_fees: _v0}
    }
    friend fun distribute_fees(p0: &FeeDistribution, p1: &FeeDistribution, p2: &mut collateral_balance_sheet::CollateralBalanceSheet, p3: address, p4: u64, p5: object::Object<perp_market::PerpMarket>) {
        let _v0;
        let _v1;
        let _v2 = p0;
        if (_v2 is MarginCall_V1) _v1 = true else if (_v2 is RegularTrade_V1) _v1 = false else abort 14566554180833181697;
        if (_v1) _v0 = true else {
            let _v3 = p1;
            if (_v3 is MarginCall_V1) _v0 = true else if (_v3 is RegularTrade_V1) _v0 = false else abort 14566554180833181697
        };
        if (_v0) {
            distribute_fees_for_margin_call(p0, p1, p2, p3, p4, p5);
            return ()
        };
        distribute_fees_for_standard(p0, p1, p2, p3, p4, p5);
    }
    friend fun distribute_fees_for_margin_call(p0: &FeeDistribution, p1: &FeeDistribution, p2: &mut collateral_balance_sheet::CollateralBalanceSheet, p3: address, p4: u64, p5: object::Object<perp_market::PerpMarket>) {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4;
        let _v5;
        let _v6;
        let _v7;
        let _v8;
        let _v9;
        let _v10;
        let _v11 = perp_market_config::get_margin_call_backstop_pct(p5);
        let _v12 = p2;
        let _v13 = p0;
        if (_v13 is MarginCall_V1) _v2 = true else if (_v13 is RegularTrade_V1) _v2 = false else abort 14566554180833181697;
        if (_v2) {
            if (!(*&p0.position_fee_delta >= 0i64)) {
                let _v14 = error::invalid_argument(1);
                abort _v14
            };
            _v1 = (*&p0.position_fee_delta) as u64;
            if (_v1 > 0) {
                _v0 = _v12;
                let _v15 = get_balance_type(p0);
                let _v16 = collateral_balance_sheet::change_type_fee();
                _v10 = _v1;
                fee_treasury::deposit_fees(collateral_balance_sheet::withdraw_primary_asset_unchecked(_v0, _v15, _v10, true, _v16))
            };
            _v9 = _v1 as i64;
            _v10 = _v1 * _v11 / 100
        } else {
            distribute_fees_for_position(p0, _v12);
            _v6 = -*&p0.treasury_fee_delta;
            if (_v6 > 0i64) _v1 = (_v6 as u64) * p4 / 100 else _v1 = 0;
            _v9 = _v6;
            _v10 = _v1
        };
        let _v17 = p1;
        _v0 = p2;
        let _v18 = _v17;
        if (_v18 is MarginCall_V1) _v8 = true else if (_v18 is RegularTrade_V1) _v8 = false else abort 14566554180833181697;
        if (_v8) {
            if (!(*&_v17.position_fee_delta >= 0i64)) {
                let _v19 = error::invalid_argument(1);
                abort _v19
            };
            _v7 = (*&_v17.position_fee_delta) as u64;
            if (_v7 > 0) {
                let _v20 = get_balance_type(_v17);
                let _v21 = collateral_balance_sheet::change_type_fee();
                fee_treasury::deposit_fees(collateral_balance_sheet::withdraw_primary_asset_unchecked(_v0, _v20, _v7, true, _v21))
            };
            _v6 = _v7 as i64;
            _v5 = _v7 * _v11 / 100
        } else {
            distribute_fees_for_position(_v17, _v0);
            _v4 = -*&_v17.treasury_fee_delta;
            if (_v4 > 0i64) _v7 = (_v4 as u64) * p4 / 100 else _v7 = 0;
            _v6 = _v4;
            _v5 = _v7
        };
        let _v22 = _v10 + _v5;
        _v4 = _v9 + _v6;
        if (_v4 <= 0i64) _v3 = 0 else if ((_v4 as u64) < _v22) _v3 = _v4 as u64 else _v3 = _v22;
        if (_v3 > 0) {
            let _v23 = collateral_balance_sheet::convert_balance_to_fungible_amount(freeze(p2), _v3, false);
            if (_v23 > 0) {
                let _v24 = fee_treasury::withdraw_fees(_v23);
                let _v25 = _v23 as i64;
                backstop_liquidator_profit_tracker::track_profit(p5, _v25);
                let _v26 = collateral_balance_sheet::balance_type_cross(p3);
                distribute_fees_to_address(p2, _v24, _v26);
                return ()
            };
            return ()
        };
    }
    fun distribute_fees_for_standard(p0: &FeeDistribution, p1: &FeeDistribution, p2: &mut collateral_balance_sheet::CollateralBalanceSheet, p3: address, p4: u64, p5: object::Object<perp_market::PerpMarket>) {
        let _v0 = *&p1.treasury_fee_delta;
        let _v1 = *&p0.treasury_fee_delta;
        if (!(_v0 + _v1 <= 0i64)) {
            let _v2 = error::invalid_argument(5);
            abort _v2
        };
        distribute_fees_for_position(p0, p2);
        distribute_fees_for_position(p1, p2);
        let _v3 = *&p1.treasury_fee_delta;
        let _v4 = *&p0.treasury_fee_delta;
        let _v5 = -(_v3 + _v4);
        let _v6 = p4 as i64;
        let _v7 = _v5 * _v6 / 100i64;
        if (_v7 > 0i64) {
            let _v8 = freeze(p2);
            let _v9 = _v7 as u64;
            let _v10 = collateral_balance_sheet::convert_balance_to_fungible_amount(_v8, _v9, false);
            if (_v10 > 0) {
                let _v11 = fee_treasury::withdraw_fees(_v10);
                let _v12 = _v10 as i64;
                backstop_liquidator_profit_tracker::track_profit(p5, _v12);
                let _v13 = collateral_balance_sheet::balance_type_cross(p3);
                distribute_fees_to_address(p2, _v11, _v13);
                return ()
            };
            return ()
        };
    }
    friend fun get_balance_type(p0: &FeeDistribution): collateral_balance_sheet::CollateralBalanceType {
        *&p0.balance_type
    }
    fun distribute_fees_to_address(p0: &mut collateral_balance_sheet::CollateralBalanceSheet, p1: fungible_asset::FungibleAsset, p2: collateral_balance_sheet::CollateralBalanceType) {
        let _v0 = collateral_balance_sheet::change_type_fee();
        collateral_balance_sheet::deposit_collateral(p0, p2, p1, _v0);
    }
    friend fun distribute_fees_for_position(p0: &FeeDistribution, p1: &mut collateral_balance_sheet::CollateralBalanceSheet) {
        let _v0;
        if (!(p0 is RegularTrade_V1)) {
            let _v1 = error::invalid_argument(4);
            abort _v1
        };
        let _v2 = &p0.balance_type;
        let _v3 = &p0.position_fee_delta;
        let _v4 = &p0.treasury_fee_delta;
        let _v5 = *_v3;
        'l2: loop {
            'l1: loop {
                let _v6;
                'l0: loop {
                    loop {
                        if (!(_v5 == 0i64)) {
                            let _v7;
                            let _v8;
                            let _v9;
                            let _v10;
                            let _v11;
                            if (*_v3 >= 0i64) {
                                _v11 = p1;
                                let _v12 = *_v2;
                                let _v13 = (*_v3) as u64;
                                let _v14 = collateral_balance_sheet::change_type_fee();
                                _v10 = _v13;
                                _v6 = collateral_balance_sheet::withdraw_primary_asset_unchecked(_v11, _v12, _v10, true, _v14);
                                if (*_v4 > 0i64) {
                                    let _v15 = freeze(p1);
                                    let _v16 = (*_v4) as u64;
                                    _v10 = collateral_balance_sheet::convert_balance_to_fungible_amount(_v15, _v16, true);
                                    if (_v10 > 0) {
                                        _v9 = fee_treasury::withdraw_fees(_v10);
                                        fungible_asset::merge(&mut _v6, _v9)
                                    }
                                };
                                _v7 = p0;
                                _v11 = p1;
                                _v8 = &mut _v6;
                                if (option::is_some<FeeWithDestination>(&_v7.builder_or_referrer_fees)) {
                                    let FeeWithDestination{address: _v17, fees: _v18} = option::destroy_some<FeeWithDestination>(*&_v7.builder_or_referrer_fees);
                                    _v10 = _v18;
                                    _v10 = collateral_balance_sheet::convert_balance_to_fungible_amount(freeze(_v11), _v10, false);
                                    _v9 = fungible_asset::extract(_v8, _v10);
                                    let _v19 = collateral_balance_sheet::balance_type_cross(_v17);
                                    distribute_fees_to_address(_v11, _v9, _v19)
                                };
                                if (!(fungible_asset::amount(&_v6) > 0)) break 'l0;
                                break
                            };
                            if (!(*_v4 >= 0i64)) {
                                let _v20 = error::invalid_argument(1);
                                abort _v20
                            };
                            let _v21 = freeze(p1);
                            let _v22 = (*_v4) as u64;
                            _v10 = collateral_balance_sheet::convert_balance_to_fungible_amount(_v21, _v22, false);
                            if (_v10 == 0) break 'l1;
                            _v0 = fee_treasury::withdraw_fees(_v10);
                            _v7 = p0;
                            _v11 = p1;
                            _v8 = &mut _v0;
                            if (option::is_some<FeeWithDestination>(&_v7.builder_or_referrer_fees)) {
                                let FeeWithDestination{address: _v23, fees: _v24} = option::destroy_some<FeeWithDestination>(*&_v7.builder_or_referrer_fees);
                                _v10 = _v24;
                                _v10 = collateral_balance_sheet::convert_balance_to_fungible_amount(freeze(_v11), _v10, false);
                                _v9 = fungible_asset::extract(_v8, _v10);
                                let _v25 = collateral_balance_sheet::balance_type_cross(_v23);
                                distribute_fees_to_address(_v11, _v9, _v25);
                                break 'l2
                            };
                            break 'l2
                        };
                        return ()
                    };
                    fee_treasury::deposit_fees(_v6);
                    return ()
                };
                fungible_asset::destroy_zero(_v6);
                return ()
            };
            return ()
        };
        let _v26 = *_v2;
        let _v27 = collateral_balance_sheet::change_type_fee();
        collateral_balance_sheet::deposit_collateral(p1, _v26, _v0, _v27);
    }
    friend fun get_builder_or_referrer_fees(p0: &FeeDistribution): option::Option<FeeWithDestination> {
        *&p0.builder_or_referrer_fees
    }
    friend fun get_position_fee_delta(p0: &FeeDistribution): i64 {
        *&p0.position_fee_delta
    }
    friend fun get_system_fee_delta(p0: &FeeDistribution): i64 {
        *&p0.treasury_fee_delta
    }
    friend fun new_fee_distribution(p0: collateral_balance_sheet::CollateralBalanceType, p1: i64, p2: option::Option<FeeWithDestination>): FeeDistribution {
        let _v0;
        if (option::is_some<FeeWithDestination>(&p2)) {
            let _v1 = option::destroy_some<FeeWithDestination>(p2);
            _v0 = *&(&_v1).fees
        } else _v0 = 0;
        let _v2 = (_v0 as i64) - p1;
        FeeDistribution::RegularTrade_V1{balance_type: p0, position_fee_delta: p1, treasury_fee_delta: _v2, builder_or_referrer_fees: p2}
    }
    friend fun new_fee_with_destination(p0: address, p1: u64): FeeWithDestination {
        FeeWithDestination{address: p0, fees: p1}
    }
    friend fun new_margin_call_fee_distribution(p0: collateral_balance_sheet::CollateralBalanceType, p1: u64): FeeDistribution {
        let _v0 = p1 as i64;
        FeeDistribution::MarginCall_V1{balance_type: p0, position_fee_delta: _v0}
    }
    friend fun zero_fees(p0: collateral_balance_sheet::CollateralBalanceType): FeeDistribution {
        let _v0 = option::none<FeeWithDestination>();
        FeeDistribution::RegularTrade_V1{balance_type: p0, position_fee_delta: 0i64, treasury_fee_delta: 0i64, builder_or_referrer_fees: _v0}
    }
}
