module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::fee_distribution {
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::collateral_balance_sheet;
    use 0x1::option;
    use 0x1::error;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::fee_treasury;
    use 0x1::fungible_asset;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::trading_fees_manager;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::position_update;
    enum FeeDistribution has copy, drop, store {
        V1 {
            balance_type: collateral_balance_sheet::CollateralBalanceType,
            position_fee_delta: i64,
            treasury_fee_delta: i64,
            builder_or_referrer_fees: option::Option<FeeWithDestination>,
        }
    }
    struct FeeWithDestination has copy, drop, store {
        address: address,
        fees: u64,
    }
    friend fun add(p0: &FeeDistribution, p1: FeeDistribution): FeeDistribution {
        let _v0;
        let _v1 = *&p0.balance_type;
        let _v2 = *&(&p1).balance_type;
        if (!(_v1 == _v2)) {
            let _v3 = error::invalid_argument(4);
            abort _v3
        };
        let _v4 = option::is_none<FeeWithDestination>(&p0.builder_or_referrer_fees);
        let _v5 = option::is_none<FeeWithDestination>(&(&p1).builder_or_referrer_fees);
        if (!(_v4 == _v5)) {
            let _v6 = error::invalid_argument(4);
            abort _v6
        };
        if (option::is_some<FeeWithDestination>(&p0.builder_or_referrer_fees)) {
            let _v7 = *&option::borrow<FeeWithDestination>(&p0.builder_or_referrer_fees).address;
            let _v8 = *&option::borrow<FeeWithDestination>(&(&p1).builder_or_referrer_fees).address;
            if (!(_v7 == _v8)) {
                let _v9 = error::invalid_argument(3);
                abort _v9
            }
        };
        let _v10 = *&p0.balance_type;
        let _v11 = *&p0.position_fee_delta;
        let _v12 = *&(&p1).position_fee_delta;
        let _v13 = _v11 + _v12;
        let _v14 = *&p0.treasury_fee_delta;
        let _v15 = *&(&p1).treasury_fee_delta;
        let _v16 = _v14 + _v15;
        if (option::is_some<FeeWithDestination>(&p0.builder_or_referrer_fees)) {
            let _v17 = *&option::borrow<FeeWithDestination>(&p0.builder_or_referrer_fees).address;
            let _v18 = *&option::borrow<FeeWithDestination>(&p0.builder_or_referrer_fees).fees;
            let _v19 = *&option::borrow<FeeWithDestination>(&(&p1).builder_or_referrer_fees).fees;
            let _v20 = _v18 + _v19;
            _v0 = option::some<FeeWithDestination>(FeeWithDestination{address: _v17, fees: _v20})
        } else _v0 = option::none<FeeWithDestination>();
        FeeDistribution::V1{balance_type: _v10, position_fee_delta: _v13, treasury_fee_delta: _v16, builder_or_referrer_fees: _v0}
    }
    friend fun distribute_fees(p0: &FeeDistribution, p1: &FeeDistribution, p2: &mut collateral_balance_sheet::CollateralBalanceSheet, p3: address, p4: u64) {
        let _v0 = *&p1.treasury_fee_delta;
        let _v1 = *&p0.treasury_fee_delta;
        let _v2 = _v0 + _v1;
        if (!(_v2 <= 0i64)) {
            let _v3 = error::invalid_argument(5);
            abort _v3
        };
        distribute_fees_for_position(p0, p2);
        distribute_fees_for_position(p1, p2);
        let _v4 = ((-_v2) as u64) * p4 / 100;
        if (_v4 > 0) {
            let _v5 = collateral_balance_sheet::convert_balance_to_fungible_amount(freeze(p2), _v4, false);
            if (_v5 > 0) {
                let _v6 = fee_treasury::withdraw_fees(_v5);
                let _v7 = collateral_balance_sheet::balance_type_cross(p3);
                distribute_fees_to_address(p2, _v6, _v7);
                return ()
            };
            return ()
        };
    }
    friend fun distribute_fees_for_position(p0: &FeeDistribution, p1: &mut collateral_balance_sheet::CollateralBalanceSheet) {
        let _v0;
        let _v1 = *&p0.position_fee_delta;
        let _v2 = _v1 == 0i64;
        'l2: loop {
            'l1: loop {
                let _v3;
                'l0: loop {
                    loop {
                        if (!_v2) {
                            let _v4;
                            let _v5;
                            let _v6;
                            let _v7;
                            let _v8;
                            if (_v1 >= 0i64) {
                                _v4 = p1;
                                let _v9 = *&p0.balance_type;
                                let _v10 = _v1 as u64;
                                let _v11 = collateral_balance_sheet::change_type_fee();
                                _v8 = _v10;
                                _v3 = collateral_balance_sheet::withdraw_primary_asset_unchecked(_v4, _v9, _v8, true, _v11);
                                if (*&p0.treasury_fee_delta > 0i64) {
                                    let _v12 = freeze(p1);
                                    let _v13 = (*&p0.treasury_fee_delta) as u64;
                                    _v8 = collateral_balance_sheet::convert_balance_to_fungible_amount(_v12, _v13, true);
                                    if (_v8 > 0) {
                                        _v7 = fee_treasury::withdraw_fees(_v8);
                                        fungible_asset::merge(&mut _v3, _v7)
                                    }
                                };
                                _v5 = p0;
                                _v4 = p1;
                                _v6 = &mut _v3;
                                if (option::is_some<FeeWithDestination>(&_v5.builder_or_referrer_fees)) {
                                    let FeeWithDestination{address: _v14, fees: _v15} = option::destroy_some<FeeWithDestination>(*&_v5.builder_or_referrer_fees);
                                    _v8 = _v15;
                                    _v8 = collateral_balance_sheet::convert_balance_to_fungible_amount(freeze(_v4), _v8, false);
                                    _v7 = fungible_asset::extract(_v6, _v8);
                                    let _v16 = collateral_balance_sheet::balance_type_cross(_v14);
                                    distribute_fees_to_address(_v4, _v7, _v16)
                                };
                                if (!(fungible_asset::amount(&_v3) > 0)) break 'l0;
                                break
                            };
                            _v1 = *&p0.treasury_fee_delta;
                            if (!(_v1 >= 0i64)) {
                                let _v17 = error::invalid_argument(1);
                                abort _v17
                            };
                            let _v18 = freeze(p1);
                            let _v19 = _v1 as u64;
                            _v8 = collateral_balance_sheet::convert_balance_to_fungible_amount(_v18, _v19, false);
                            if (_v8 == 0) break 'l1;
                            _v0 = fee_treasury::withdraw_fees(_v8);
                            _v5 = p0;
                            _v4 = p1;
                            _v6 = &mut _v0;
                            if (option::is_some<FeeWithDestination>(&_v5.builder_or_referrer_fees)) {
                                let FeeWithDestination{address: _v20, fees: _v21} = option::destroy_some<FeeWithDestination>(*&_v5.builder_or_referrer_fees);
                                _v8 = _v21;
                                _v8 = collateral_balance_sheet::convert_balance_to_fungible_amount(freeze(_v4), _v8, false);
                                _v7 = fungible_asset::extract(_v6, _v8);
                                let _v22 = collateral_balance_sheet::balance_type_cross(_v20);
                                distribute_fees_to_address(_v4, _v7, _v22);
                                break 'l2
                            };
                            break 'l2
                        };
                        return ()
                    };
                    fee_treasury::deposit_fees(_v3);
                    return ()
                };
                fungible_asset::destroy_zero(_v3);
                return ()
            };
            return ()
        };
        let _v23 = *&p0.balance_type;
        let _v24 = collateral_balance_sheet::change_type_fee();
        collateral_balance_sheet::deposit_collateral(p1, _v23, _v0, _v24);
    }
    fun distribute_fees_to_address(p0: &mut collateral_balance_sheet::CollateralBalanceSheet, p1: fungible_asset::FungibleAsset, p2: collateral_balance_sheet::CollateralBalanceType) {
        let _v0 = collateral_balance_sheet::change_type_fee();
        collateral_balance_sheet::deposit_collateral(p0, p2, p1, _v0);
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
        FeeDistribution::V1{balance_type: p0, position_fee_delta: p1, treasury_fee_delta: _v2, builder_or_referrer_fees: p2}
    }
    friend fun new_fee_with_destination(p0: address, p1: u64): FeeWithDestination {
        FeeWithDestination{address: p0, fees: p1}
    }
    friend fun zero_fees(p0: collateral_balance_sheet::CollateralBalanceType): FeeDistribution {
        let _v0 = option::none<FeeWithDestination>();
        FeeDistribution::V1{balance_type: p0, position_fee_delta: 0i64, treasury_fee_delta: 0i64, builder_or_referrer_fees: _v0}
    }
}
