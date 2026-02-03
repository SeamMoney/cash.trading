module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_update {
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0x1::option;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::fee_distribution;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::price_management;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_positions;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::trading_fees_manager;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::collateral_balance_sheet;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book_types;
    use 0x1::string;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::builder_code_registry;
    use 0x1::error;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::math;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market_config;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::liquidation_config;
    use 0x1::math64;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::accounts_collateral;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::clearinghouse_perp;
    enum ReduceOnlyValidationResult has drop {
        ReduceOnlyViolation,
        Success {
            size: u64,
        }
    }
    enum UpdatePositionResult has copy, drop {
        Success {
            account: address,
            market: object::Object<perp_market::PerpMarket>,
            is_isolated: bool,
            margin_delta: option::Option<i64>,
            backstop_liquidator_covered_loss: u64,
            fee_distribution: fee_distribution::FeeDistribution,
            realized_pnl: option::Option<i64>,
            realized_funding_cost: option::Option<i64>,
            unrealized_funding_cost: i64,
            updated_funding_index: price_management::AccumulativeIndex,
            volume_delta: u128,
            is_taker: bool,
            is_position_closed_or_flipped: bool,
        }
        Liquidatable,
        InsufficientMargin,
        InvalidLeverage,
        BecomesLiquidatable,
    }
    friend fun track_volume(p0: address, p1: bool, p2: u128) {
        p0 = perp_positions::get_primary_account_addr(p0);
        if (p1) {
            trading_fees_manager::track_taker_volume(p0, p2);
            return ()
        };
        trading_fees_manager::track_global_and_maker_volume(p0, p2);
    }
    friend fun commit_update(p0: &mut collateral_balance_sheet::CollateralBalanceSheet, p1: option::Option<order_book_types::OrderId>, p2: option::Option<string::String>, p3: u64, p4: bool, p5: u64, p6: option::Option<builder_code_registry::BuilderCode>, p7: UpdatePositionResult, p8: address, p9: u128, p10: perp_positions::TradeTriggerSource): (u64, bool, u8) {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4;
        let _v5;
        let _v6;
        let _v7;
        let _v8;
        let _v9 = &p7;
        loop {
            if (_v9 is Success) {
                let _v10;
                let UpdatePositionResult::Success{account: _v11, market: _v12, is_isolated: _v13, margin_delta: _v14, backstop_liquidator_covered_loss: _v15, fee_distribution: _v16, realized_pnl: _v17, realized_funding_cost: _v18, unrealized_funding_cost: _v19, updated_funding_index: _v20, volume_delta: _v21, is_taker: _v22, is_position_closed_or_flipped: _v23} = p7;
                _v8 = _v22;
                let _v24 = _v21;
                _v7 = _v20;
                _v6 = _v19;
                _v5 = _v18;
                _v4 = _v17;
                _v3 = _v16;
                let _v25 = _v14;
                _v2 = _v13;
                _v1 = _v12;
                _v0 = _v11;
                if (!(_v15 == 0)) {
                    let _v26 = error::invalid_argument(5);
                    abort _v26
                };
                if (_v2) _v10 = collateral_balance_sheet::balance_type_isolated(_v0, _v1) else _v10 = collateral_balance_sheet::balance_type_cross(_v0);
                if (option::is_some<i64>(&_v4)) {
                    let _v27 = option::destroy_some<i64>(_v4);
                    if (_v27 >= 0i64) {
                        let _v28 = _v27 as u64;
                        let _v29 = collateral_balance_sheet::change_type_pnl();
                        collateral_balance_sheet::deposit_to_user(p0, _v10, _v28, _v29)
                    } else {
                        let _v30 = (-_v27) as u64;
                        let _v31 = collateral_balance_sheet::change_type_pnl();
                        collateral_balance_sheet::decrease_balance(p0, _v10, _v30, _v31)
                    }
                };
                if (option::is_some<i64>(&_v25)) {
                    let _v32 = option::destroy_some<i64>(_v25);
                    let _v33 = collateral_balance_sheet::change_type_margin();
                    if (_v32 >= 0i64) {
                        let _v34 = _v32 as u64;
                        collateral_balance_sheet::transfer_from_crossed_to_isolated(p0, _v0, _v34, _v1, _v33)
                    } else {
                        let _v35 = (-_v32) as u64;
                        collateral_balance_sheet::transfer_from_isolated_to_crossed(p0, _v0, _v35, _v1, _v33)
                    }
                };
                if (!(_v24 != 0u128)) break;
                track_volume(_v0, _v8, _v24);
                break
            };
            if (_v9 is Liquidatable) {
                let UpdatePositionResult::Liquidatable{} = p7;
                let _v36 = error::invalid_argument(2);
                abort _v36
            };
            if (_v9 is BecomesLiquidatable) {
                let UpdatePositionResult::BecomesLiquidatable{} = p7;
                let _v37 = error::invalid_argument(9);
                abort _v37
            };
            if (_v9 is InsufficientMargin) {
                let UpdatePositionResult::InsufficientMargin{} = p7;
                let _v38 = error::invalid_argument(5);
                abort _v38
            };
            if (_v9 is InvalidLeverage) {
                let UpdatePositionResult::InvalidLeverage{} = p7;
                let _v39 = error::invalid_argument(10);
                abort _v39
            };
            abort 14566554180833181697
        };
        let _v40 = option::get_with_default<i64>(&_v5, 0i64);
        let _v41 = option::get_with_default<i64>(&_v4, 0i64);
        let _v42 = fee_distribution::get_position_fee_delta(&_v3);
        let (_v43,_v44,_v45) = perp_positions::update_position(_v0, _v0 == p8, _v2, _v1, p1, p2, p3, p4, p5, p6, _v6, _v7, _v40, _v41, _v42, p9, _v8, p10, _v3);
        (_v43, _v44, _v45)
    }
    friend fun extract_backstop_liquidator_covered_loss(p0: &mut UpdatePositionResult): u64 {
        let _v0 = *&p0.backstop_liquidator_covered_loss;
        let _v1 = &mut p0.backstop_liquidator_covered_loss;
        *_v1 = 0;
        _v0
    }
    fun get_fee_and_volume_delta(p0: address, p1: bool, p2: object::Object<perp_market::PerpMarket>, p3: bool, p4: u64, p5: u64, p6: option::Option<builder_code_registry::BuilderCode>, p7: &math::Precision, p8: bool): (fee_distribution::FeeDistribution, u128) {
        let _v0;
        let _v1 = perp_positions::get_primary_account_addr(p0);
        if (p1) _v0 = collateral_balance_sheet::balance_type_isolated(p0, p2) else _v0 = collateral_balance_sheet::balance_type_cross(p0);
        let _v2 = p5 as u128;
        let _v3 = p4 as u128;
        let _v4 = _v2 * _v3;
        let _v5 = math::get_decimals_multiplier(p7) as u128;
        let _v6 = _v4 / _v5;
        if (p8) {
            let _v7 = perp_market_config::get_margin_call_fee_pct(p2);
            return (trading_fees_manager::get_fees_for_margin_call(_v0, _v6, _v7), _v6)
        };
        if (p3) return (trading_fees_manager::get_taker_fee_for_notional(p0, _v1, _v0, _v6, p6), _v6);
        (trading_fees_manager::get_maker_fee_for_notional(p0, _v1, _v0, _v6, p6), _v6)
    }
    fun get_pnl_and_funding_for_decrease(p0: &perp_positions::PerpPosition, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: u64): (i64, i64, i64, price_management::AccumulativeIndex) {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4;
        let _v5 = perp_market_config::get_size_multiplier(p1);
        let _v6 = p2 as u128;
        let _v7 = p3 as u128;
        let _v8 = _v6 * _v7;
        let _v9 = perp_positions::get_entry_px_times_size_sum(p0);
        let _v10 = perp_positions::get_size(p0);
        let _v11 = perp_positions::is_long(p0);
        let _v12 = p3 as u128;
        let _v13 = _v10 as u128;
        if (_v11) {
            let _v14;
            let _v15 = _v13;
            if (!(_v15 != 0u128)) {
                let _v16 = error::invalid_argument(4);
                abort _v16
            };
            let _v17 = _v9 as u256;
            let _v18 = _v12 as u256;
            let _v19 = _v17 * _v18;
            let _v20 = _v15 as u256;
            if (_v19 == 0u256) if (_v20 != 0u256) _v14 = 0u256 else {
                let _v21 = error::invalid_argument(4);
                abort _v21
            } else _v14 = (_v19 - 1u256) / _v20 + 1u256;
            _v3 = _v14 as u128
        } else if (_v13 != 0u128) {
            let _v22 = _v9 as u256;
            let _v23 = _v12 as u256;
            let _v24 = _v22 * _v23;
            let _v25 = _v13 as u256;
            _v3 = (_v24 / _v25) as u128
        } else {
            let _v26 = error::invalid_argument(4);
            abort _v26
        };
        if (_v11) _v2 = _v8 > _v3 else _v2 = _v8 < _v3;
        if (_v8 > _v3) _v1 = _v8 - _v3 else _v1 = _v3 - _v8;
        let _v27 = _v1;
        let _v28 = _v5 as u128;
        if (_v2) _v0 = _v27 / _v28 else {
            let _v29 = _v27;
            let _v30 = _v28;
            if (_v29 == 0u128) if (_v30 != 0u128) _v0 = 0u128 else {
                let _v31 = error::invalid_argument(4);
                abort _v31
            } else _v0 = (_v29 - 1u128) / _v30 + 1u128
        };
        let _v32 = _v0 as i64;
        let (_v33,_v34) = perp_positions::get_position_funding_cost_and_index(p0, p1);
        let _v35 = _v33;
        let _v36 = perp_positions::get_size(p0);
        assert!(_v36 != 0, 4);
        let _v37 = _v35 as i128;
        let _v38 = p3 as i128;
        let _v39 = _v37 * _v38;
        let _v40 = _v36 as i128;
        let _v41 = (_v39 / _v40) as i64;
        let _v42 = _v35 - _v41;
        let _v43 = _v32;
        if (_v2) _v4 = _v43 else _v4 = -_v43;
        let _v44 = _v4 - _v41;
        let _v45 = -_v41;
        (_v44, _v45, _v42, _v34)
    }
    friend fun get_reduce_only_size(p0: &ReduceOnlyValidationResult): u64 {
        *&p0.size
    }
    fun is_position_liquidatable_isolated(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: &liquidation_config::LiquidationConfig, p2: address, p3: object::Object<perp_market::PerpMarket>, p4: bool, p5: &perp_positions::PerpPosition): bool {
        let _v0 = perp_positions::isolated_position_status(p0, p2, p5, p3);
        perp_positions::is_account_liquidatable(&_v0, p1, p4)
    }
    friend fun is_reduce_only_violation(p0: &ReduceOnlyValidationResult): bool {
        p0 is ReduceOnlyViolation
    }
    friend fun is_settle_price_inside_guaranteed_range(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64, p3: &liquidation_config::LiquidationConfig, p4: bool): bool {
        let _v0 = perp_market_config::get_max_leverage(p0);
        let _v1 = liquidation_config::get_liquidation_price(p3, p2, _v0, false);
        if (p4) {
            let _v2 = p2 + _v1;
            return p1 <= _v2
        };
        let _v3 = p2 - _v1;
        p1 >= _v3
    }
    friend fun is_update_successful(p0: &UpdatePositionResult): bool {
        p0 is Success
    }
    friend fun unwrap_failed_update_reason(p0: &UpdatePositionResult): string::String {
        'l1: loop {
            'l0: loop {
                loop {
                    if (!(p0 is Liquidatable)) {
                        if (p0 is InsufficientMargin) break;
                        if (p0 is InvalidLeverage) break 'l0;
                        if (p0 is BecomesLiquidatable) break 'l1;
                        if (p0 is Success) {
                            let _v0 = error::invalid_argument(1);
                            abort _v0
                        };
                        abort 14566554180833181697
                    };
                    return string::utf8(vector[69u8, 120u8, 105u8, 115u8, 116u8, 105u8, 110u8, 103u8, 32u8, 112u8, 111u8, 115u8, 105u8, 116u8, 105u8, 111u8, 110u8, 32u8, 105u8, 115u8, 32u8, 108u8, 105u8, 113u8, 117u8, 105u8, 100u8, 97u8, 116u8, 97u8, 98u8, 108u8, 101u8])
                };
                return string::utf8(vector[73u8, 110u8, 115u8, 117u8, 102u8, 102u8, 105u8, 99u8, 105u8, 101u8, 110u8, 116u8, 32u8, 109u8, 97u8, 114u8, 103u8, 105u8, 110u8, 32u8, 116u8, 111u8, 32u8, 117u8, 112u8, 100u8, 97u8, 116u8, 101u8, 32u8, 112u8, 111u8, 115u8, 105u8, 116u8, 105u8, 111u8, 110u8])
            };
            return string::utf8(vector[85u8, 115u8, 101u8, 114u8, 32u8, 108u8, 101u8, 118u8, 101u8, 114u8, 97u8, 103u8, 101u8, 32u8, 105u8, 115u8, 32u8, 105u8, 110u8, 118u8, 97u8, 108u8, 105u8, 100u8])
        };
        string::utf8(vector[69u8, 120u8, 105u8, 115u8, 116u8, 105u8, 110u8, 103u8, 32u8, 112u8, 111u8, 115u8, 105u8, 116u8, 105u8, 111u8, 110u8, 32u8, 98u8, 101u8, 99u8, 111u8, 109u8, 101u8, 115u8, 32u8, 108u8, 105u8, 113u8, 117u8, 105u8, 100u8, 97u8, 116u8, 97u8, 98u8, 108u8, 101u8])
    }
    friend fun unwrap_fee_distribution(p0: &UpdatePositionResult): fee_distribution::FeeDistribution {
        *&p0.fee_distribution
    }
    friend fun unwrap_is_closed_or_flipped(p0: &UpdatePositionResult): bool {
        *&p0.is_position_closed_or_flipped
    }
    friend fun validate_backstop_liquidate_isolated_position(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: &perp_positions::PerpPosition, p3: u64, p4: object::Object<perp_market::PerpMarket>, p5: u64, p6: bool, p7: bool): UpdatePositionResult {
        let _v0;
        let _v1;
        let (_v2,_v3,_v4,_v5) = get_pnl_and_funding_for_decrease(p2, p4, p5, p3);
        let _v6 = _v2;
        let _v7 = collateral_balance_sheet::balance_type_isolated(p1, p4);
        p5 = collateral_balance_sheet::total_asset_collateral_value(p0, _v7);
        let _v8 = 0;
        if (_v6 < 0i64) {
            _v1 = (p5 as i64) + _v6;
            if (_v1 < 0i64) {
                _v8 = (-_v1) as u64;
                _v1 = _v8 as i64;
                _v6 = _v6 + _v1
            }
        };
        if (p7) {
            let _v9 = perp_positions::get_size(p2);
            p6 = p3 != _v9
        } else p6 = true;
        if (p6) _v0 = option::none<i64>() else {
            _v1 = (p5 as i64) + _v6;
            if (_v1 > 0i64) _v0 = option::some<i64>(-_v1) else _v0 = option::none<i64>()
        };
        let _v10 = fee_distribution::zero_fees(collateral_balance_sheet::balance_type_isolated(p1, p4));
        let _v11 = option::some<i64>(_v6);
        let _v12 = option::some<i64>(_v3);
        UpdatePositionResult::Success{account: p1, market: p4, is_isolated: true, margin_delta: _v0, backstop_liquidator_covered_loss: _v8, fee_distribution: _v10, realized_pnl: _v11, realized_funding_cost: _v12, unrealized_funding_cost: _v4, updated_funding_index: _v5, volume_delta: 0u128, is_taker: p7, is_position_closed_or_flipped: true}
    }
    friend fun validate_backstop_liquidation_or_adl_update(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: bool, p5: bool, p6: u64): UpdatePositionResult {
        let _v0;
        let _v1;
        let _v2 = perp_positions::may_be_find_position(p1, p2);
        let _v3 = option::is_none<perp_positions::PerpPosition>(&_v2);
        'l0: loop {
            'l1: loop {
                loop {
                    if (!_v3) {
                        let _v4;
                        _v1 = option::destroy_some<perp_positions::PerpPosition>(_v2);
                        if (perp_positions::is_isolated(&_v1)) {
                            let _v5 = perp_positions::is_long(&_v1);
                            if (!(p4 != _v5)) {
                                let _v6 = error::invalid_argument(7);
                                abort _v6
                            };
                            let _v7 = perp_positions::get_size(&_v1);
                            if (p6 <= _v7) break;
                            let _v8 = error::invalid_argument(3);
                            abort _v8
                        };
                        _v0 = perp_positions::get_size(&_v1);
                        if (_v0 == 0) _v4 = true else _v4 = perp_positions::is_long(&_v1) == p4;
                        if (!_v4) break 'l0;
                        break 'l1
                    };
                    let _v9 = perp_market_config::get_max_leverage(p2);
                    let _v10 = perp_positions::new_empty_perp_position(p2, _v9);
                    let _v11 = &_v10;
                    return validate_increase_crossed_position_liquidation(p1, _v11, p2, p5)
                };
                let _v12 = &_v1;
                return validate_backstop_liquidate_isolated_position(p0, p1, _v12, p6, p2, p3, p4, p5)
            };
            let _v13 = &_v1;
            return validate_increase_crossed_position_liquidation(p1, _v13, p2, p5)
        };
        let _v14 = &_v1;
        let _v15 = math64::min(p6, _v0);
        let _v16 = option::none<builder_code_registry::BuilderCode>();
        validate_decrease_crossed_position(p0, p1, _v14, p2, p3, p5, _v15, _v16, true, false)
    }
    fun validate_increase_crossed_position_liquidation(p0: address, p1: &perp_positions::PerpPosition, p2: object::Object<perp_market::PerpMarket>, p3: bool): UpdatePositionResult {
        let (_v0,_v1) = perp_positions::get_position_funding_cost_and_index(p1, p2);
        let _v2 = fee_distribution::zero_fees(collateral_balance_sheet::balance_type_cross(p0));
        let _v3 = option::none<i64>();
        let _v4 = option::none<i64>();
        let _v5 = option::none<i64>();
        UpdatePositionResult::Success{account: p0, market: p2, is_isolated: false, margin_delta: _v3, backstop_liquidator_covered_loss: 0, fee_distribution: _v2, realized_pnl: _v5, realized_funding_cost: _v4, unrealized_funding_cost: _v0, updated_funding_index: _v1, volume_delta: 0u128, is_taker: p3, is_position_closed_or_flipped: false}
    }
    friend fun validate_decrease_crossed_position(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: &perp_positions::PerpPosition, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: bool, p6: u64, p7: option::Option<builder_code_registry::BuilderCode>, p8: bool, p9: bool): UpdatePositionResult {
        let _v0;
        let _v1;
        let (_v2,_v3,_v4,_v5) = get_pnl_and_funding_for_decrease(p2, p3, p4, p6);
        let _v6 = _v2;
        let _v7 = perp_positions::get_size(p2);
        if (p8) {
            _v1 = fee_distribution::zero_fees(collateral_balance_sheet::balance_type_cross(p1));
            _v0 = 0u128
        } else {
            let _v8 = perp_market_config::get_sz_precision(p3);
            let _v9 = &_v8;
            let (_v10,_v11) = get_fee_and_volume_delta(p1, false, p3, p5, p4, p6, p7, _v9, p9);
            _v0 = _v11;
            _v1 = _v10
        };
        let _v12 = fee_distribution::get_position_fee_delta(&_v1);
        let _v13 = _v6 + _v12;
        let _v14 = 0i64;
        loop {
            if (_v13 < 0i64) {
                let _v15 = collateral_balance_sheet::balance_type_cross(p1);
                let _v16 = collateral_balance_sheet::balance_of_primary_asset(p0, _v15);
                if (_v16 + _v13 < 0i64) {
                    let _v17;
                    if (!p8) break;
                    if (_v6 < 0i64) _v17 = _v6 < _v13 else _v17 = false;
                    if (_v17) _v14 = -(_v16 + _v6) else _v14 = -(_v16 + _v13);
                    _v6 = _v6 + _v14
                }
            };
            let _v18 = option::none<i64>();
            let _v19 = _v14 as u64;
            let _v20 = option::some<i64>(_v6);
            let _v21 = option::some<i64>(_v3);
            return UpdatePositionResult::Success{account: p1, market: p3, is_isolated: false, margin_delta: _v18, backstop_liquidator_covered_loss: _v19, fee_distribution: _v1, realized_pnl: _v20, realized_funding_cost: _v21, unrealized_funding_cost: _v4, updated_funding_index: _v5, volume_delta: _v0, is_taker: p5, is_position_closed_or_flipped: p6 == _v7}
        };
        UpdatePositionResult::Liquidatable{}
    }
    fun validate_crossed_position_update_for_settlement(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: &liquidation_config::LiquidationConfig, p2: address, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: bool, p6: bool, p7: u64, p8: option::Option<builder_code_registry::BuilderCode>, p9: bool, p10: bool, p11: option::Option<perp_positions::PerpPosition>): UpdatePositionResult {
        if (option::is_some<perp_positions::PerpPosition>(&p11)) {
            let _v0;
            let _v1 = option::destroy_some<perp_positions::PerpPosition>(p11);
            let _v2 = perp_positions::get_size(&_v1);
            if (perp_positions::is_long(&_v1) == p5) _v0 = true else _v0 = _v2 == 0;
            'l0: loop {
                let _v3;
                loop {
                    if (_v0) {
                        let _v4 = &_v1;
                        let (_v5,_v6,_v7) = validate_increase_crossed_position(p0, p2, _v4, p3, p4, p6, p7, p5, p8);
                        return verify_position_update_result_for_settlement_provided_status(_v1, _v6, _v7, p3, p4, p5, p7, p1, p9, _v5)
                    } else {
                        if (!(_v2 >= p7)) break 'l0;
                        let _v8 = option::none<object::Object<perp_market::PerpMarket>>();
                        _v3 = perp_positions::cross_position_status(p0, p2, _v8);
                        if (!perp_positions::is_account_liquidatable(&_v3, p1, p9)) break
                    };
                    return UpdatePositionResult::Liquidatable{}
                };
                let _v9 = &_v1;
                let _v10 = validate_decrease_crossed_position(p0, p2, _v9, p3, p4, p6, p7, p8, false, p10);
                let _v11 = option::some<perp_positions::AccountStatus>(_v3);
                return verify_position_update_result_for_settlement_provided_status(_v1, _v11, true, p3, p4, p5, p7, p1, p9, _v10)
            };
            let _v12 = &_v1;
            let _v13 = p7 - _v2;
            let (_v14,_v15,_v16) = validate_flip_crossed_position(p0, p2, _v12, p3, p4, p6, _v13, p5, p8);
            return verify_position_update_result_for_settlement_provided_status(_v1, _v15, _v16, p3, p4, p5, p7, p1, p9, _v14)
        };
        let _v17 = perp_market_config::get_max_leverage(p3);
        let _v18 = perp_positions::new_empty_perp_position(p3, _v17);
        let _v19 = &_v18;
        let (_v20,_v21,_v22) = validate_increase_crossed_position(p0, p2, _v19, p3, p4, p6, p7, p5, p8);
        verify_position_update_result_for_settlement_provided_status(_v18, _v21, _v22, p3, p4, p5, p7, p1, p9, _v20)
    }
    friend fun validate_increase_crossed_position(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: &perp_positions::PerpPosition, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: bool, p6: u64, p7: bool, p8: option::Option<builder_code_registry::BuilderCode>): (UpdatePositionResult, option::Option<perp_positions::AccountStatus>, bool) {
        let _v0;
        let _v1 = perp_positions::get_user_leverage(p2);
        let _v2 = perp_market_config::get_max_leverage(p3);
        loop {
            if (_v2 < _v1) {
                let _v3 = UpdatePositionResult::InvalidLeverage{};
                let _v4 = option::none<perp_positions::AccountStatus>();
                return (_v3, _v4, false)
            } else {
                let _v5;
                let _v6 = perp_market_config::get_size_multiplier(p3);
                let _v7 = price_management::get_mark_price(p3);
                let _v8 = _v1 as u64;
                let _v9 = _v6 * _v8;
                if (!(_v9 != 0)) {
                    let _v10 = error::invalid_argument(4);
                    abort _v10
                };
                let _v11 = p6 as u128;
                let _v12 = _v7 as u128;
                let _v13 = _v11 * _v12;
                let _v14 = _v9 as u128;
                if (_v13 == 0u128) if (_v14 != 0u128) _v5 = 0u128 else {
                    let _v15 = error::invalid_argument(4);
                    abort _v15
                } else _v5 = (_v13 - 1u128) / _v14 + 1u128;
                let _v16 = _v5 as u64;
                let (_v17,_v18) = perp_positions::free_collateral_for_crossed_and_account_status(p0, p1, 0i64);
                _v0 = _v18;
                if (!(_v17 < _v16)) break
            };
            let _v19 = UpdatePositionResult::InsufficientMargin{};
            let _v20 = option::none<perp_positions::AccountStatus>();
            return (_v19, _v20, false)
        };
        let (_v21,_v22) = perp_positions::get_position_funding_cost_and_index(p2, p3);
        let _v23 = perp_market_config::get_sz_precision(p3);
        let _v24 = &_v23;
        let (_v25,_v26) = get_fee_and_volume_delta(p1, false, p3, p5, p4, p6, p8, _v24, false);
        let _v27 = option::none<i64>();
        let _v28 = option::none<i64>();
        let _v29 = option::none<i64>();
        let _v30 = UpdatePositionResult::Success{account: p1, market: p3, is_isolated: false, margin_delta: _v27, backstop_liquidator_covered_loss: 0, fee_distribution: _v25, realized_pnl: _v28, realized_funding_cost: _v29, unrealized_funding_cost: _v21, updated_funding_index: _v22, volume_delta: _v26, is_taker: p5, is_position_closed_or_flipped: false};
        let _v31 = option::some<perp_positions::AccountStatus>(_v0);
        (_v30, _v31, true)
    }
    friend fun verify_position_update_result_for_settlement_provided_status(p0: perp_positions::PerpPosition, p1: option::Option<perp_positions::AccountStatus>, p2: bool, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: bool, p6: u64, p7: &liquidation_config::LiquidationConfig, p8: bool, p9: UpdatePositionResult): UpdatePositionResult {
        if (&p9 is Success) {
            let _v0 = price_management::get_mark_price(p3);
            if (!is_settle_price_inside_guaranteed_range(p3, p4, _v0, p7, p5)) {
                let _v1 = option::destroy_some<perp_positions::AccountStatus>(p1);
                if (p2) {
                    let _v2 = &mut _v1;
                    let _v3 = &p0;
                    perp_positions::update_position_status_to_remove_position(_v2, _v3, p3)
                };
                return verify_position_update_result_for_settlement_impl(p0, _v1, p3, p4, p5, p6, p7, p8, p9)
            }
        };
        p9
    }
    friend fun validate_flip_crossed_position(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: &perp_positions::PerpPosition, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: bool, p6: u64, p7: bool, p8: option::Option<builder_code_registry::BuilderCode>): (UpdatePositionResult, option::Option<perp_positions::AccountStatus>, bool) {
        let _v0;
        let _v1 = perp_positions::get_size(p2);
        let _v2 = perp_positions::get_user_leverage(p2);
        let _v3 = option::some<object::Object<perp_market::PerpMarket>>(p3);
        let _v4 = perp_positions::cross_position_status(p0, p1, _v3);
        let _v5 = perp_market_config::get_size_multiplier(p3);
        let (_v6,_v7,_v8,_v9) = get_pnl_and_funding_for_decrease(p2, p3, p4, _v1);
        let _v10 = _v6;
        let _v11 = _v2 as u64;
        let _v12 = _v5 * _v11;
        if (!(_v12 != 0)) {
            let _v13 = error::invalid_argument(4);
            abort _v13
        };
        let _v14 = p6 as u128;
        let _v15 = p4 as u128;
        let _v16 = _v14 * _v15;
        let _v17 = _v12 as u128;
        if (_v16 == 0u128) if (_v17 != 0u128) _v0 = 0u128 else {
            let _v18 = error::invalid_argument(4);
            abort _v18
        } else _v0 = (_v16 - 1u128) / _v17 + 1u128;
        let _v19 = _v0 as u64;
        let _v20 = _v1 + p6;
        let _v21 = perp_market_config::get_sz_precision(p3);
        let _v22 = &_v21;
        let (_v23,_v24) = get_fee_and_volume_delta(p1, false, p3, p5, p4, _v20, p8, _v22, false);
        let _v25 = _v23;
        let _v26 = fee_distribution::get_position_fee_delta(&_v25);
        let _v27 = _v10 + _v26;
        let _v28 = perp_positions::get_account_balance(&_v4) + _v27;
        let _v29 = (perp_positions::get_margin_for_free_collateral(&_v4) + _v19) as i64;
        if (_v28 < _v29) {
            let _v30 = UpdatePositionResult::InsufficientMargin{};
            let _v31 = option::none<perp_positions::AccountStatus>();
            return (_v30, _v31, false)
        };
        let _v32 = option::none<i64>();
        let _v33 = option::some<i64>(_v10);
        let _v34 = option::some<i64>(_v7);
        let _v35 = UpdatePositionResult::Success{account: p1, market: p3, is_isolated: false, margin_delta: _v32, backstop_liquidator_covered_loss: 0, fee_distribution: _v25, realized_pnl: _v33, realized_funding_cost: _v34, unrealized_funding_cost: 0i64, updated_funding_index: _v9, volume_delta: _v24, is_taker: p5, is_position_closed_or_flipped: true};
        let _v36 = option::some<perp_positions::AccountStatus>(_v4);
        (_v35, _v36, false)
    }
    friend fun validate_decrease_isolated_position(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: &perp_positions::PerpPosition, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: bool, p6: bool, p7: u64, p8: option::Option<builder_code_registry::BuilderCode>, p9: bool): UpdatePositionResult {
        let _v0;
        let _v1;
        let (_v2,_v3,_v4,_v5) = get_pnl_and_funding_for_decrease(p2, p3, p4, p7);
        let _v6 = _v2;
        let _v7 = perp_market_config::get_sz_precision(p3);
        let _v8 = &_v7;
        let (_v9,_v10) = get_fee_and_volume_delta(p1, true, p3, p6, p4, p7, p8, _v8, p9);
        let _v11 = _v9;
        let _v12 = collateral_balance_sheet::balance_type_isolated(p1, p3);
        p4 = collateral_balance_sheet::total_asset_collateral_value(p0, _v12);
        let _v13 = (p4 as i64) + _v6;
        loop {
            if (_v13 < 0i64) return UpdatePositionResult::Liquidatable{} else {
                let _v14;
                _v1 = perp_positions::get_size(p2);
                let _v15 = _v1 - p7;
                let _v16 = _v1;
                if (!(_v16 != 0)) {
                    let _v17 = error::invalid_argument(4);
                    abort _v17
                };
                let _v18 = p4 as u128;
                let _v19 = _v15 as u128;
                let _v20 = _v18 * _v19;
                let _v21 = _v16 as u128;
                if (_v20 == 0u128) if (_v21 != 0u128) _v14 = 0u128 else {
                    let _v22 = error::invalid_argument(4);
                    abort _v22
                } else _v14 = (_v20 - 1u128) / _v21 + 1u128;
                let _v23 = _v14 as u64;
                _v0 = 0i64;
                if (p9) p5 = p7 == _v1 else p5 = true;
                if (!p5) break;
                let _v24 = (_v23 as i64) - _v13;
                let _v25 = fee_distribution::get_position_fee_delta(&_v11);
                _v0 = _v24 + _v25;
                if (!(_v0 >= 0i64)) break
            };
            return UpdatePositionResult::Liquidatable{}
        };
        let _v26 = option::some<i64>(_v0);
        let _v27 = option::some<i64>(_v6);
        let _v28 = option::some<i64>(_v3);
        UpdatePositionResult::Success{account: p1, market: p3, is_isolated: true, margin_delta: _v26, backstop_liquidator_covered_loss: 0, fee_distribution: _v11, realized_pnl: _v27, realized_funding_cost: _v28, unrealized_funding_cost: _v4, updated_funding_index: _v5, volume_delta: _v10, is_taker: p6, is_position_closed_or_flipped: p7 == _v1}
    }
    friend fun validate_flip_isolated_position(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: &perp_positions::PerpPosition, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: bool, p6: bool, p7: u64, p8: option::Option<builder_code_registry::BuilderCode>): UpdatePositionResult {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4;
        let _v5;
        let _v6;
        let _v7 = perp_positions::get_size(p2);
        let _v8 = validate_decrease_isolated_position(p0, p1, p2, p3, p4, false, p6, _v7, p8, false);
        let _v9 = is_update_successful(&_v8);
        'l0: loop {
            let _v10;
            loop {
                if (_v9) {
                    let UpdatePositionResult::Success{account: _v11, market: _v12, is_isolated: _v13, margin_delta: _v14, backstop_liquidator_covered_loss: _v15, fee_distribution: _v16, realized_pnl: _v17, realized_funding_cost: _v18, unrealized_funding_cost: _v19, updated_funding_index: _v20, volume_delta: _v21, is_taker: _v22, is_position_closed_or_flipped: _v23} = _v8;
                    _v6 = _v21;
                    _v5 = _v20;
                    _v4 = _v18;
                    _v3 = _v17;
                    let _v24 = _v16;
                    _v7 = _v15;
                    let _v25 = _v14;
                    if (!(_v7 == 0)) {
                        let _v26 = error::invalid_argument(1);
                        abort _v26
                    };
                    if (!(_v19 == 0i64)) {
                        let _v27 = error::invalid_argument(1);
                        abort _v27
                    };
                    let _v28 = option::get_with_default<i64>(&_v25, 0i64);
                    _v10 = validate_increase_isolated_position(p0, p1, p2, p3, p4, p6, p7, _v28, p5, p8);
                    if (!is_update_successful(&_v10)) break;
                    let UpdatePositionResult::Success{account: _v29, market: _v30, is_isolated: _v31, margin_delta: _v32, backstop_liquidator_covered_loss: _v33, fee_distribution: _v34, realized_pnl: _v35, realized_funding_cost: _v36, unrealized_funding_cost: _v37, updated_funding_index: _v38, volume_delta: _v39, is_taker: _v40, is_position_closed_or_flipped: _v41} = _v10;
                    _v2 = _v39;
                    let _v42 = _v35;
                    _v7 = _v33;
                    let _v43 = _v32;
                    if (!(_v7 == 0)) {
                        let _v44 = error::invalid_argument(1);
                        abort _v44
                    };
                    if (!option::is_none<i64>(&_v42)) {
                        let _v45 = error::invalid_argument(1);
                        abort _v45
                    };
                    _v1 = option::get_with_default<i64>(&_v43, 0i64);
                    _v1 = _v28 + _v1;
                    _v0 = fee_distribution::add(&_v24, _v34);
                    let _v46 = collateral_balance_sheet::balance_type_isolated(p1, p3);
                    _v7 = collateral_balance_sheet::total_asset_collateral_value(p0, _v46);
                    if (!option::is_some<i64>(&_v3)) break 'l0;
                    let _v47 = *option::borrow<i64>(&_v3);
                    if ((_v7 as i64) + _v47 >= 0i64) break 'l0;
                    abort 8
                };
                return _v8
            };
            return _v10
        };
        let _v48 = option::some<i64>(_v1);
        let _v49 = _v6 + _v2;
        UpdatePositionResult::Success{account: p1, market: p3, is_isolated: true, margin_delta: _v48, backstop_liquidator_covered_loss: 0, fee_distribution: _v0, realized_pnl: _v3, realized_funding_cost: _v4, unrealized_funding_cost: 0i64, updated_funding_index: _v5, volume_delta: _v49, is_taker: p6, is_position_closed_or_flipped: true}
    }
    friend fun validate_increase_isolated_position(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: &perp_positions::PerpPosition, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: bool, p6: u64, p7: i64, p8: bool, p9: option::Option<builder_code_registry::BuilderCode>): UpdatePositionResult {
        let _v0;
        let _v1 = perp_positions::get_user_leverage(p2);
        let _v2 = perp_market_config::get_max_leverage(p3);
        'l0: loop {
            loop {
                if (!(_v2 < _v1)) {
                    let _v3;
                    let _v4 = perp_market_config::get_size_multiplier(p3);
                    let _v5 = price_management::get_mark_price(p3);
                    let _v6 = _v1 as u64;
                    let _v7 = _v4 * _v6;
                    if (!(_v7 != 0)) {
                        let _v8 = error::invalid_argument(4);
                        abort _v8
                    };
                    let _v9 = p6 as u128;
                    let _v10 = _v5 as u128;
                    let _v11 = _v9 * _v10;
                    let _v12 = _v7 as u128;
                    if (_v11 == 0u128) if (_v12 != 0u128) _v3 = 0u128 else {
                        let _v13 = error::invalid_argument(4);
                        abort _v13
                    } else _v3 = (_v11 - 1u128) / _v12 + 1u128;
                    _v0 = _v3 as u64;
                    if (!perp_positions::is_max_allowed_withdraw_from_cross_margin_at_least(p0, p1, p7, _v0)) break;
                    break 'l0
                };
                return UpdatePositionResult::InvalidLeverage{}
            };
            return UpdatePositionResult::InsufficientMargin{}
        };
        let (_v14,_v15) = perp_positions::get_position_funding_cost_and_index(p2, p3);
        let _v16 = perp_market_config::get_sz_precision(p3);
        let _v17 = &_v16;
        let (_v18,_v19) = get_fee_and_volume_delta(p1, true, p3, p5, p4, p6, p9, _v17, false);
        let _v20 = option::some<i64>(_v0 as i64);
        let _v21 = option::none<i64>();
        let _v22 = option::none<i64>();
        UpdatePositionResult::Success{account: p1, market: p3, is_isolated: true, margin_delta: _v20, backstop_liquidator_covered_loss: 0, fee_distribution: _v18, realized_pnl: _v22, realized_funding_cost: _v21, unrealized_funding_cost: _v14, updated_funding_index: _v15, volume_delta: _v19, is_taker: p5, is_position_closed_or_flipped: false}
    }
    fun validate_isolated_position_update(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: &liquidation_config::LiquidationConfig, p2: address, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: bool, p6: bool, p7: u64, p8: option::Option<builder_code_registry::BuilderCode>, p9: bool, p10: bool, p11: &perp_positions::PerpPosition): UpdatePositionResult {
        let _v0;
        let _v1 = is_position_liquidatable_isolated(p0, p1, p2, p3, p9, p11);
        'l0: loop {
            'l1: loop {
                loop {
                    if (!_v1) {
                        let _v2;
                        _v0 = perp_positions::get_size(p11);
                        p9 = perp_positions::is_long(p11);
                        if (_v0 == 0) _v2 = true else _v2 = p9 == p5;
                        if (_v2) break;
                        if (!(_v0 >= p7)) break 'l0;
                        break 'l1
                    };
                    return UpdatePositionResult::Liquidatable{}
                };
                return validate_increase_isolated_position(p0, p2, p11, p3, p4, p6, p7, 0i64, p5, p8)
            };
            return validate_decrease_isolated_position(p0, p2, p11, p3, p4, p5, p6, p7, p8, p10)
        };
        let _v3 = p7 - _v0;
        validate_flip_isolated_position(p0, p2, p11, p3, p4, p5, p6, _v3, p8)
    }
    friend fun validate_position_update_for_settlement(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: &liquidation_config::LiquidationConfig, p2: address, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: bool, p6: bool, p7: u64, p8: option::Option<builder_code_registry::BuilderCode>, p9: bool, p10: bool): UpdatePositionResult {
        let _v0;
        let _v1;
        perp_market_config::validate_price_and_size_allow_below_min_size(p3, p4, p7);
        let _v2 = perp_positions::may_be_find_position(p2, p3);
        if (option::is_some<perp_positions::PerpPosition>(&_v2)) _v1 = p10 else _v1 = false;
        if (_v1) {
            let _v3 = perp_positions::get_size(option::borrow<perp_positions::PerpPosition>(&_v2));
            if (!(p7 <= _v3)) {
                let _v4 = error::invalid_argument(12);
                abort _v4
            };
            let _v5 = perp_positions::is_long(option::borrow<perp_positions::PerpPosition>(&_v2));
            if (!(p5 != _v5)) {
                let _v6 = error::invalid_argument(12);
                abort _v6
            }
        };
        if (option::is_some<perp_positions::PerpPosition>(&_v2)) _v0 = perp_positions::is_isolated(option::borrow<perp_positions::PerpPosition>(&_v2)) else _v0 = false;
        if (_v0) {
            let _v7 = option::destroy_some<perp_positions::PerpPosition>(_v2);
            let _v8 = &_v7;
            let _v9 = validate_isolated_position_update(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, _v8);
            return verify_position_update_result_for_settlement(p0, p1, p2, p3, p4, p5, p7, p9, _v9)
        };
        validate_crossed_position_update_for_settlement(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, _v2)
    }
    friend fun verify_position_update_result_for_settlement(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: &liquidation_config::LiquidationConfig, p2: address, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: bool, p6: u64, p7: bool, p8: UpdatePositionResult): UpdatePositionResult {
        if (&p8 is Success) {
            let _v0 = price_management::get_mark_price(p3);
            if (!is_settle_price_inside_guaranteed_range(p3, p4, _v0, p1, p5)) {
                let _v1;
                let _v2;
                let _v3 = perp_positions::may_be_find_position(p2, p3);
                if (option::is_some<perp_positions::PerpPosition>(&_v3)) _v2 = option::destroy_some<perp_positions::PerpPosition>(_v3) else {
                    let _v4 = perp_market_config::get_max_leverage(p3);
                    _v2 = perp_positions::new_empty_perp_position(p3, _v4)
                };
                if (perp_positions::is_isolated(&_v2)) {
                    let _v5 = collateral_balance_sheet::balance_type_isolated(p2, p3);
                    _v1 = perp_positions::new_account_status(collateral_balance_sheet::total_asset_collateral_value(p0, _v5) as i64)
                } else {
                    let _v6 = option::some<object::Object<perp_market::PerpMarket>>(p3);
                    _v1 = perp_positions::cross_position_status(p0, p2, _v6)
                };
                return verify_position_update_result_for_settlement_impl(_v2, _v1, p3, p4, p5, p6, p1, p7, p8)
            }
        };
        p8
    }
    friend fun validate_reduce_only_update(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: u64): ReduceOnlyValidationResult {
        let _v0 = perp_positions::may_be_find_position(p0, p1);
        if (option::is_some<perp_positions::PerpPosition>(&_v0)) {
            let _v1 = option::destroy_some<perp_positions::PerpPosition>(_v0);
            let _v2 = perp_positions::get_size(&_v1);
            let _v3 = perp_positions::is_long(&_v1);
            'l0: loop {
                'l1: loop {
                    loop {
                        if (!(_v2 == 0)) {
                            if (_v3 == p2) break;
                            if (!(_v2 < p3)) break 'l0;
                            break 'l1
                        };
                        return ReduceOnlyValidationResult::ReduceOnlyViolation{}
                    };
                    return ReduceOnlyValidationResult::ReduceOnlyViolation{}
                };
                return ReduceOnlyValidationResult::Success{size: _v2}
            };
            return ReduceOnlyValidationResult::Success{size: p3}
        };
        ReduceOnlyValidationResult::ReduceOnlyViolation{}
    }
    fun verify_position_update_result_for_settlement_impl(p0: perp_positions::PerpPosition, p1: perp_positions::AccountStatus, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: bool, p5: u64, p6: &liquidation_config::LiquidationConfig, p7: bool, p8: UpdatePositionResult): UpdatePositionResult {
        let _v0 = p1;
        let _v1 = &mut p0;
        let _v2 = *&(&p8).unrealized_funding_cost;
        let _v3 = *&(&p8).updated_funding_index;
        perp_positions::update_single_position_struct(_v1, p3, p4, p5, _v2, _v3);
        if (option::is_some<i64>(&(&p8).realized_pnl)) {
            let _v4 = &mut _v0;
            let _v5 = option::destroy_some<i64>(*&(&p8).realized_pnl);
            perp_positions::increase_collateral_balance_for_status(_v4, _v5)
        };
        if (option::is_some<i64>(&(&p8).margin_delta)) {
            let _v6 = &mut _v0;
            let _v7 = option::destroy_some<i64>(*&(&p8).margin_delta);
            perp_positions::increase_collateral_balance_for_status(_v6, _v7)
        };
        let _v8 = &mut _v0;
        let _v9 = fee_distribution::get_position_fee_delta(&(&p8).fee_distribution);
        perp_positions::increase_collateral_balance_for_status(_v8, _v9);
        let _v10 = &mut _v0;
        let _v11 = &p0;
        perp_positions::update_position_status_to_add_position(_v10, _v11, p2);
        if (perp_positions::is_account_liquidatable(&_v0, p6, p7)) return UpdatePositionResult::BecomesLiquidatable{};
        p8
    }
}
