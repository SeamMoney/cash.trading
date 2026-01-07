module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::position_update {
    use 0x1::object;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market;
    use 0x1::option;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::fee_distribution;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::price_management;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_positions;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::trading_fees_manager;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::collateral_balance_sheet;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_book_types;
    use 0x1::string;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::builder_code_registry;
    use 0x1::error;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::math;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market_config;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::liquidation_config;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::accounts_collateral;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::clearinghouse_perp;
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
        p0 = perp_positions::get_fee_tracking_addr(p0);
        if (p1) {
            trading_fees_manager::track_taker_volume(p0, p2);
            return ()
        };
        trading_fees_manager::track_global_and_maker_volume(p0, p2);
    }
    friend fun commit_update(p0: &mut collateral_balance_sheet::CollateralBalanceSheet, p1: option::Option<order_book_types::OrderIdType>, p2: option::Option<string::String>, p3: u64, p4: bool, p5: u64, p6: option::Option<builder_code_registry::BuilderCode>, p7: UpdatePositionResult, p8: address, p9: u128): (u64, bool, u8) {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4;
        let _v5;
        let _v6;
        let _v7;
        let _v8 = &p7;
        loop {
            if (_v8 is Success) {
                let _v9;
                let UpdatePositionResult::Success{account: _v10, market: _v11, is_isolated: _v12, margin_delta: _v13, backstop_liquidator_covered_loss: _v14, fee_distribution: _v15, realized_pnl: _v16, realized_funding_cost: _v17, unrealized_funding_cost: _v18, updated_funding_index: _v19, volume_delta: _v20, is_taker: _v21, is_position_closed_or_flipped: _v22} = p7;
                let _v23 = _v20;
                _v7 = _v19;
                _v6 = _v18;
                _v5 = _v17;
                _v4 = _v16;
                _v3 = _v15;
                let _v24 = _v13;
                _v2 = _v12;
                _v1 = _v11;
                _v0 = _v10;
                if (!(_v14 == 0)) {
                    let _v25 = error::invalid_argument(5);
                    abort _v25
                };
                if (_v2) _v9 = collateral_balance_sheet::balance_type_isolated(_v0, _v1) else _v9 = collateral_balance_sheet::balance_type_cross(_v0);
                if (option::is_some<i64>(&_v4)) {
                    let _v26 = option::destroy_some<i64>(_v4);
                    if (_v26 >= 0i64) {
                        let _v27 = _v26 as u64;
                        let _v28 = collateral_balance_sheet::change_type_pnl();
                        collateral_balance_sheet::deposit_to_user(p0, _v9, _v27, _v28)
                    } else {
                        let _v29 = (-_v26) as u64;
                        let _v30 = collateral_balance_sheet::change_type_pnl();
                        collateral_balance_sheet::decrease_balance(p0, _v9, _v29, _v30)
                    }
                };
                if (option::is_some<i64>(&_v24)) {
                    let _v31 = option::destroy_some<i64>(_v24);
                    let _v32 = collateral_balance_sheet::change_type_margin();
                    if (_v31 >= 0i64) {
                        let _v33 = _v31 as u64;
                        collateral_balance_sheet::transfer_from_crossed_to_isolated(p0, _v0, _v33, _v1, _v32)
                    } else {
                        let _v34 = (-_v31) as u64;
                        collateral_balance_sheet::transfer_from_isolated_to_crossed(p0, _v0, _v34, _v1, _v32)
                    }
                };
                if (!(_v23 != 0u128)) break;
                track_volume(_v0, _v21, _v23);
                break
            };
            if (_v8 is Liquidatable) {
                let UpdatePositionResult::Liquidatable{} = p7;
                let _v35 = error::invalid_argument(2);
                abort _v35
            };
            if (_v8 is BecomesLiquidatable) {
                let UpdatePositionResult::BecomesLiquidatable{} = p7;
                let _v36 = error::invalid_argument(9);
                abort _v36
            };
            if (_v8 is InsufficientMargin) {
                let UpdatePositionResult::InsufficientMargin{} = p7;
                let _v37 = error::invalid_argument(5);
                abort _v37
            };
            if (_v8 is InvalidLeverage) {
                let UpdatePositionResult::InvalidLeverage{} = p7;
                let _v38 = error::invalid_argument(10);
                abort _v38
            };
            abort 14566554180833181697
        };
        let _v39 = option::get_with_default<i64>(&_v5, 0i64);
        let _v40 = option::get_with_default<i64>(&_v4, 0i64);
        let _v41 = fee_distribution::get_position_fee_delta(&_v3);
        let (_v42,_v43,_v44) = perp_positions::update_position(_v0, _v0 == p8, _v2, _v1, p1, p2, p3, p4, p5, p6, _v6, _v7, _v39, _v40, _v41, p9);
        (_v42, _v43, _v44)
    }
    friend fun extract_backstop_liquidator_covered_loss(p0: &mut UpdatePositionResult): u64 {
        let _v0 = *&p0.backstop_liquidator_covered_loss;
        let _v1 = &mut p0.backstop_liquidator_covered_loss;
        *_v1 = 0;
        _v0
    }
    fun get_fee_and_volume_delta(p0: address, p1: bool, p2: object::Object<perp_market::PerpMarket>, p3: bool, p4: u64, p5: u64, p6: option::Option<builder_code_registry::BuilderCode>, p7: &math::Precision): (fee_distribution::FeeDistribution, u128) {
        let _v0;
        let _v1 = perp_positions::get_fee_tracking_addr(p0);
        if (p1) _v0 = collateral_balance_sheet::balance_type_isolated(p0, p2) else _v0 = collateral_balance_sheet::balance_type_cross(p0);
        let _v2 = p5 as u128;
        let _v3 = p4 as u128;
        let _v4 = _v2 * _v3;
        let _v5 = math::get_decimals_multiplier(p7) as u128;
        let _v6 = _v4 / _v5;
        if (p3) return (trading_fees_manager::get_taker_fee_for_notional(p0, _v1, _v0, _v6, p6), _v6);
        (trading_fees_manager::get_maker_fee_for_notional(p0, _v1, _v0, _v6, p6), _v6)
    }
    fun get_pnl_and_funding_for_decrease(p0: &perp_positions::PerpPosition, p1: u64, p2: u64): (i64, i64, i64, price_management::AccumulativeIndex) {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4;
        let _v5 = perp_market_config::get_size_multiplier(perp_positions::get_market(p0));
        let _v6 = p1 as u128;
        let _v7 = p2 as u128;
        let _v8 = _v6 * _v7;
        let _v9 = perp_positions::get_entry_px_times_size_sum(p0);
        let _v10 = perp_positions::get_size(p0);
        let _v11 = perp_positions::is_long(p0);
        let _v12 = p2 as u128;
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
        let (_v33,_v34) = perp_positions::get_position_funding_cost_and_index(p0);
        let _v35 = _v33;
        let _v36 = perp_positions::get_size(p0);
        assert!(_v36 != 0, 4);
        let _v37 = _v35 as i128;
        let _v38 = p2 as i128;
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
    fun is_position_liquidatable_crossed(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: &liquidation_config::LiquidationConfig, p2: address, p3: bool): bool {
        let _v0 = option::none<object::Object<perp_market::PerpMarket>>();
        let _v1 = perp_positions::cross_position_status(p0, p2, _v0, false);
        perp_positions::is_account_liquidatable(&_v1, p1, p3)
    }
    fun is_position_liquidatable_isolated(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: &liquidation_config::LiquidationConfig, p2: address, p3: object::Object<perp_market::PerpMarket>, p4: bool, p5: &perp_positions::PerpPosition): bool {
        let _v0 = perp_positions::isolated_position_status(p0, p2, p5, p3, false);
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
    friend fun validate_backstop_liquidate_isolated_position(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: &perp_positions::PerpPosition, p3: u64, p4: bool, p5: bool): UpdatePositionResult {
        let _v0 = perp_positions::get_market(p2);
        let _v1 = perp_positions::get_size(p2);
        let (_v2,_v3,_v4,_v5) = get_pnl_and_funding_for_decrease(p2, p3, _v1);
        let _v6 = _v2;
        let _v7 = collateral_balance_sheet::balance_type_isolated(p1, _v0);
        p3 = collateral_balance_sheet::total_asset_collateral_value(p0, _v7);
        _v1 = 0;
        if (_v6 < 0i64) {
            let _v8 = (p3 as i64) + _v6;
            if (_v8 < 0i64) {
                _v1 = (-_v8) as u64;
                _v8 = _v1 as i64;
                _v6 = _v6 + _v8
            }
        };
        let _v9 = option::none<i64>();
        let _v10 = fee_distribution::zero_fees(collateral_balance_sheet::balance_type_isolated(p1, _v0));
        let _v11 = option::some<i64>(_v6);
        let _v12 = option::some<i64>(_v3);
        UpdatePositionResult::Success{account: p1, market: _v0, is_isolated: true, margin_delta: _v9, backstop_liquidator_covered_loss: _v1, fee_distribution: _v10, realized_pnl: _v11, realized_funding_cost: _v12, unrealized_funding_cost: _v4, updated_funding_index: _v5, volume_delta: 0u128, is_taker: p5, is_position_closed_or_flipped: true}
    }
    fun validate_crossed_position_update(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: &liquidation_config::LiquidationConfig, p2: address, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: bool, p6: bool, p7: u64, p8: option::Option<builder_code_registry::BuilderCode>, p9: bool, p10: option::Option<perp_positions::PerpPosition>): UpdatePositionResult {
        if (option::is_some<perp_positions::PerpPosition>(&p10)) {
            let _v0;
            let _v1 = option::destroy_some<perp_positions::PerpPosition>(p10);
            let _v2 = perp_positions::get_size(&_v1);
            if (perp_positions::is_long(&_v1) == p5) _v0 = true else _v0 = _v2 == 0;
            'l0: loop {
                loop {
                    if (_v0) {
                        let _v3 = &_v1;
                        return validate_increase_crossed_position(p0, p2, _v3, p4, p6, p7, p5, p8)
                    } else {
                        if (!(_v2 >= p7)) break 'l0;
                        if (!is_position_liquidatable_crossed(p0, p1, p2, p9)) break
                    };
                    return UpdatePositionResult::Liquidatable{}
                };
                let _v4 = &_v1;
                return validate_decrease_crossed_position(p0, p2, _v4, p4, p6, p7, p8, false)
            };
            let _v5 = &_v1;
            let _v6 = p7 - _v2;
            return validate_flip_crossed_position(p0, p2, _v5, p4, p6, _v6, p5, p8)
        };
        let _v7 = perp_market_config::get_max_leverage(p3);
        let _v8 = perp_positions::new_empty_perp_position(p3, _v7);
        let _v9 = &_v8;
        validate_increase_crossed_position(p0, p2, _v9, p4, p6, p7, p5, p8)
    }
    friend fun validate_increase_crossed_position(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: &perp_positions::PerpPosition, p3: u64, p4: bool, p5: u64, p6: bool, p7: option::Option<builder_code_registry::BuilderCode>): UpdatePositionResult {
        validate_increase_position(p0, p1, false, p2, p3, p4, p5, 0i64, p6, p7)
    }
    friend fun validate_decrease_crossed_position(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: &perp_positions::PerpPosition, p3: u64, p4: bool, p5: u64, p6: option::Option<builder_code_registry::BuilderCode>, p7: bool): UpdatePositionResult {
        let _v0;
        let _v1;
        let (_v2,_v3,_v4,_v5) = get_pnl_and_funding_for_decrease(p2, p3, p5);
        let _v6 = _v2;
        let _v7 = perp_positions::get_market(p2);
        let _v8 = perp_positions::get_size(p2);
        if (p7) {
            _v1 = fee_distribution::zero_fees(collateral_balance_sheet::balance_type_cross(p1));
            _v0 = 0u128
        } else {
            let _v9 = perp_market_config::get_sz_precision(_v7);
            let _v10 = &_v9;
            let (_v11,_v12) = get_fee_and_volume_delta(p1, false, _v7, p4, p3, p5, p6, _v10);
            _v0 = _v12;
            _v1 = _v11
        };
        let _v13 = fee_distribution::get_position_fee_delta(&_v1);
        let _v14 = _v6 + _v13;
        let _v15 = 0i64;
        loop {
            if (_v14 < 0i64) {
                let _v16 = collateral_balance_sheet::balance_type_cross(p1);
                let _v17 = collateral_balance_sheet::balance_of_primary_asset(p0, _v16);
                if (_v17 + _v14 < 0i64) {
                    let _v18;
                    if (!p7) break;
                    if (_v6 < 0i64) _v18 = _v6 < _v14 else _v18 = false;
                    if (_v18) _v15 = -(_v17 + _v6) else _v15 = -(_v17 + _v14);
                    _v6 = _v6 + _v15
                }
            };
            let _v19 = option::none<i64>();
            let _v20 = _v15 as u64;
            let _v21 = option::some<i64>(_v6);
            let _v22 = option::some<i64>(_v3);
            return UpdatePositionResult::Success{account: p1, market: _v7, is_isolated: false, margin_delta: _v19, backstop_liquidator_covered_loss: _v20, fee_distribution: _v1, realized_pnl: _v21, realized_funding_cost: _v22, unrealized_funding_cost: _v4, updated_funding_index: _v5, volume_delta: _v0, is_taker: p4, is_position_closed_or_flipped: p5 == _v8}
        };
        UpdatePositionResult::Liquidatable{}
    }
    friend fun validate_flip_crossed_position(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: &perp_positions::PerpPosition, p3: u64, p4: bool, p5: u64, p6: bool, p7: option::Option<builder_code_registry::BuilderCode>): UpdatePositionResult {
        let _v0;
        let _v1 = perp_positions::get_market(p2);
        let _v2 = perp_positions::get_size(p2);
        let _v3 = perp_positions::get_user_leverage(p2);
        let _v4 = option::some<object::Object<perp_market::PerpMarket>>(_v1);
        let _v5 = perp_positions::cross_position_status(p0, p1, _v4, true);
        let _v6 = perp_market_config::get_size_multiplier(_v1);
        let (_v7,_v8,_v9,_v10) = get_pnl_and_funding_for_decrease(p2, p3, _v2);
        let _v11 = _v7;
        let _v12 = _v3 as u64;
        let _v13 = _v6 * _v12;
        if (!(_v13 != 0)) {
            let _v14 = error::invalid_argument(4);
            abort _v14
        };
        let _v15 = p5 as u128;
        let _v16 = p3 as u128;
        let _v17 = _v15 * _v16;
        let _v18 = _v13 as u128;
        if (_v17 == 0u128) if (_v18 != 0u128) _v0 = 0u128 else {
            let _v19 = error::invalid_argument(4);
            abort _v19
        } else _v0 = (_v17 - 1u128) / _v18 + 1u128;
        let _v20 = _v0 as u64;
        let _v21 = _v2 + p5;
        let _v22 = perp_market_config::get_sz_precision(_v1);
        let _v23 = &_v22;
        let (_v24,_v25) = get_fee_and_volume_delta(p1, false, _v1, p4, p3, _v21, p7, _v23);
        let _v26 = _v24;
        let _v27 = fee_distribution::get_position_fee_delta(&_v26);
        let _v28 = _v11 + _v27;
        let _v29 = perp_positions::get_account_balance(&_v5) + _v28;
        let _v30 = (perp_positions::get_initial_margin(&_v5) + _v20) as i64;
        if (_v29 < _v30) return UpdatePositionResult::InsufficientMargin{};
        let _v31 = option::none<i64>();
        let _v32 = option::some<i64>(_v11);
        let _v33 = option::some<i64>(_v8);
        UpdatePositionResult::Success{account: p1, market: _v1, is_isolated: false, margin_delta: _v31, backstop_liquidator_covered_loss: 0, fee_distribution: _v26, realized_pnl: _v32, realized_funding_cost: _v33, unrealized_funding_cost: 0i64, updated_funding_index: _v10, volume_delta: _v25, is_taker: p4, is_position_closed_or_flipped: true}
    }
    friend fun validate_decrease_isolated_position(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: perp_positions::PerpPosition, p3: u64, p4: bool, p5: bool, p6: u64, p7: option::Option<builder_code_registry::BuilderCode>): UpdatePositionResult {
        let _v0;
        let _v1;
        let (_v2,_v3,_v4,_v5) = get_pnl_and_funding_for_decrease(&p2, p3, p6);
        let _v6 = _v2;
        let _v7 = perp_positions::get_market(&p2);
        let _v8 = perp_market_config::get_sz_precision(_v7);
        let _v9 = &_v8;
        let (_v10,_v11) = get_fee_and_volume_delta(p1, true, _v7, p5, p3, p6, p7, _v9);
        let _v12 = _v10;
        let _v13 = collateral_balance_sheet::balance_type_isolated(p1, _v7);
        p3 = collateral_balance_sheet::total_asset_collateral_value(p0, _v13);
        let _v14 = (p3 as i64) + _v6;
        loop {
            if (_v14 < 0i64) return UpdatePositionResult::Liquidatable{} else {
                let _v15;
                _v1 = perp_positions::get_size(&p2);
                let _v16 = _v1 - p6;
                let _v17 = _v1;
                if (!(_v17 != 0)) {
                    let _v18 = error::invalid_argument(4);
                    abort _v18
                };
                let _v19 = p3 as u128;
                let _v20 = _v16 as u128;
                let _v21 = _v19 * _v20;
                let _v22 = _v17 as u128;
                if (_v21 == 0u128) if (_v22 != 0u128) _v15 = 0u128 else {
                    let _v23 = error::invalid_argument(4);
                    abort _v23
                } else _v15 = (_v21 - 1u128) / _v22 + 1u128;
                let _v24 = ((_v15 as u64) as i64) - _v14;
                let _v25 = fee_distribution::get_position_fee_delta(&_v12);
                _v0 = _v24 + _v25;
                if (!(_v0 >= 0i64)) break
            };
            return UpdatePositionResult::Liquidatable{}
        };
        let _v26 = option::some<i64>(_v0);
        let _v27 = option::some<i64>(_v6);
        let _v28 = option::some<i64>(_v3);
        UpdatePositionResult::Success{account: p1, market: _v7, is_isolated: true, margin_delta: _v26, backstop_liquidator_covered_loss: 0, fee_distribution: _v12, realized_pnl: _v27, realized_funding_cost: _v28, unrealized_funding_cost: _v4, updated_funding_index: _v5, volume_delta: _v11, is_taker: p5, is_position_closed_or_flipped: p6 == _v1}
    }
    friend fun validate_flip_isolated_position(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: perp_positions::PerpPosition, p3: u64, p4: bool, p5: bool, p6: u64, p7: option::Option<builder_code_registry::BuilderCode>): UpdatePositionResult {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4;
        let _v5;
        let _v6;
        let _v7 = perp_positions::get_size(&p2);
        let _v8 = perp_positions::get_market(&p2);
        let _v9 = validate_decrease_isolated_position(p0, p1, p2, p3, false, p5, _v7, p7);
        let _v10 = is_update_successful(&_v9);
        'l0: loop {
            let _v11;
            loop {
                if (_v10) {
                    let UpdatePositionResult::Success{account: _v12, market: _v13, is_isolated: _v14, margin_delta: _v15, backstop_liquidator_covered_loss: _v16, fee_distribution: _v17, realized_pnl: _v18, realized_funding_cost: _v19, unrealized_funding_cost: _v20, updated_funding_index: _v21, volume_delta: _v22, is_taker: _v23, is_position_closed_or_flipped: _v24} = _v9;
                    _v6 = _v22;
                    _v5 = _v21;
                    _v4 = _v19;
                    _v3 = _v18;
                    let _v25 = _v17;
                    _v7 = _v16;
                    let _v26 = _v15;
                    if (!(_v7 == 0)) {
                        let _v27 = error::invalid_argument(1);
                        abort _v27
                    };
                    if (!(_v20 == 0i64)) {
                        let _v28 = error::invalid_argument(1);
                        abort _v28
                    };
                    let _v29 = option::get_with_default<i64>(&_v26, 0i64);
                    let _v30 = &p2;
                    _v11 = validate_increase_position(p0, p1, true, _v30, p3, p5, p6, _v29, p4, p7);
                    if (!is_update_successful(&_v11)) break;
                    let UpdatePositionResult::Success{account: _v31, market: _v32, is_isolated: _v33, margin_delta: _v34, backstop_liquidator_covered_loss: _v35, fee_distribution: _v36, realized_pnl: _v37, realized_funding_cost: _v38, unrealized_funding_cost: _v39, updated_funding_index: _v40, volume_delta: _v41, is_taker: _v42, is_position_closed_or_flipped: _v43} = _v11;
                    _v2 = _v41;
                    let _v44 = _v37;
                    _v7 = _v35;
                    let _v45 = _v34;
                    if (!(_v7 == 0)) {
                        let _v46 = error::invalid_argument(1);
                        abort _v46
                    };
                    if (!option::is_none<i64>(&_v44)) {
                        let _v47 = error::invalid_argument(1);
                        abort _v47
                    };
                    _v1 = option::get_with_default<i64>(&_v45, 0i64);
                    _v1 = _v29 + _v1;
                    _v0 = fee_distribution::add(&_v25, _v36);
                    let _v48 = collateral_balance_sheet::balance_type_isolated(p1, _v8);
                    _v7 = collateral_balance_sheet::total_asset_collateral_value(p0, _v48);
                    if (!option::is_some<i64>(&_v3)) break 'l0;
                    let _v49 = *option::borrow<i64>(&_v3);
                    if ((_v7 as i64) + _v49 >= 0i64) break 'l0;
                    abort 8
                };
                return _v9
            };
            return _v11
        };
        let _v50 = option::some<i64>(_v1);
        let _v51 = _v6 + _v2;
        UpdatePositionResult::Success{account: p1, market: _v8, is_isolated: true, margin_delta: _v50, backstop_liquidator_covered_loss: 0, fee_distribution: _v0, realized_pnl: _v3, realized_funding_cost: _v4, unrealized_funding_cost: 0i64, updated_funding_index: _v5, volume_delta: _v51, is_taker: p5, is_position_closed_or_flipped: true}
    }
    fun validate_increase_position(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: bool, p3: &perp_positions::PerpPosition, p4: u64, p5: bool, p6: u64, p7: i64, p8: bool, p9: option::Option<builder_code_registry::BuilderCode>): UpdatePositionResult {
        let _v0 = perp_positions::get_market(p3);
        let _v1 = perp_positions::get_user_leverage(p3);
        let _v2 = perp_market_config::get_max_leverage(_v0);
        'l1: loop {
            'l0: loop {
                let _v3;
                let _v4;
                let _v5;
                let _v6;
                loop {
                    let _v7;
                    if (_v2 < _v1) return UpdatePositionResult::InvalidLeverage{} else {
                        let _v8;
                        let _v9 = perp_market_config::get_size_multiplier(_v0);
                        let _v10 = price_management::get_mark_price(_v0);
                        let _v11 = _v1 as u64;
                        let _v12 = _v9 * _v11;
                        if (!(_v12 != 0)) {
                            let _v13 = error::invalid_argument(4);
                            abort _v13
                        };
                        let _v14 = p6 as u128;
                        let _v15 = _v10 as u128;
                        let _v16 = _v14 * _v15;
                        let _v17 = _v12 as u128;
                        if (_v16 == 0u128) if (_v17 != 0u128) _v8 = 0u128 else {
                            let _v18 = error::invalid_argument(4);
                            abort _v18
                        } else _v8 = (_v16 - 1u128) / _v17 + 1u128;
                        _v7 = _v8 as u64;
                        if (p2) if (!perp_positions::is_max_allowed_withdraw_from_cross_margin_at_least(p0, p1, p7, _v7)) break 'l0 else if (perp_positions::is_free_collateral_for_crossed_at_least(p0, p1, p7, _v7)) () else break 'l1;
                        let (_v19,_v20) = perp_positions::get_position_funding_cost_and_index(p3);
                        _v6 = _v20;
                        _v5 = _v19;
                        let _v21 = perp_market_config::get_sz_precision(_v0);
                        let _v22 = &_v21;
                        let (_v23,_v24) = get_fee_and_volume_delta(p1, p2, _v0, p5, p4, p6, p9, _v22);
                        _v4 = _v24;
                        _v3 = _v23;
                        if (!p2) break
                    };
                    let _v25 = option::some<i64>(_v7 as i64);
                    let _v26 = option::none<i64>();
                    let _v27 = option::none<i64>();
                    return UpdatePositionResult::Success{account: p1, market: _v0, is_isolated: true, margin_delta: _v25, backstop_liquidator_covered_loss: 0, fee_distribution: _v3, realized_pnl: _v27, realized_funding_cost: _v26, unrealized_funding_cost: _v5, updated_funding_index: _v6, volume_delta: _v4, is_taker: p5, is_position_closed_or_flipped: false}
                };
                let _v28 = option::none<i64>();
                let _v29 = option::none<i64>();
                let _v30 = option::none<i64>();
                return UpdatePositionResult::Success{account: p1, market: _v0, is_isolated: p2, margin_delta: _v28, backstop_liquidator_covered_loss: 0, fee_distribution: _v3, realized_pnl: _v29, realized_funding_cost: _v30, unrealized_funding_cost: _v5, updated_funding_index: _v6, volume_delta: _v4, is_taker: p5, is_position_closed_or_flipped: false}
            };
            return UpdatePositionResult::InsufficientMargin{}
        };
        UpdatePositionResult::InsufficientMargin{}
    }
    friend fun validate_increase_isolated_position(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: perp_positions::PerpPosition, p3: u64, p4: bool, p5: u64, p6: bool, p7: option::Option<builder_code_registry::BuilderCode>): UpdatePositionResult {
        let _v0 = &p2;
        validate_increase_position(p0, p1, true, _v0, p3, p4, p5, 0i64, p6, p7)
    }
    fun validate_isolated_position_update(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: &liquidation_config::LiquidationConfig, p2: address, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: bool, p6: bool, p7: u64, p8: option::Option<builder_code_registry::BuilderCode>, p9: bool, p10: perp_positions::PerpPosition): UpdatePositionResult {
        let _v0;
        let _v1 = &p10;
        let _v2 = is_position_liquidatable_isolated(p0, p1, p2, p3, p9, _v1);
        'l0: loop {
            'l1: loop {
                loop {
                    if (!_v2) {
                        let _v3;
                        if (!(perp_positions::get_market(&p10) == p3)) {
                            let _v4 = error::invalid_argument(0);
                            abort _v4
                        };
                        _v0 = perp_positions::get_size(&p10);
                        p9 = perp_positions::is_long(&p10);
                        if (_v0 == 0) _v3 = true else _v3 = p9 == p5;
                        if (_v3) break;
                        if (!(_v0 >= p7)) break 'l0;
                        break 'l1
                    };
                    return UpdatePositionResult::Liquidatable{}
                };
                return validate_increase_isolated_position(p0, p2, p10, p4, p6, p7, p5, p8)
            };
            return validate_decrease_isolated_position(p0, p2, p10, p4, p5, p6, p7, p8)
        };
        let _v5 = p7 - _v0;
        validate_flip_isolated_position(p0, p2, p10, p4, p5, p6, _v5, p8)
    }
    friend fun validate_liquidation_position_update(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: address, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: bool, p5: bool, p6: u64): UpdatePositionResult {
        let _v0 = perp_positions::may_be_find_position(p1, p2);
        if (!option::is_some<perp_positions::PerpPosition>(&_v0)) {
            let _v1 = error::invalid_argument(4);
            abort _v1
        };
        let _v2 = option::destroy_some<perp_positions::PerpPosition>(_v0);
        if (!(perp_positions::get_market(&_v2) == p2)) {
            let _v3 = error::invalid_argument(0);
            abort _v3
        };
        if (perp_positions::is_isolated(&_v2)) {
            let _v4 = perp_positions::get_size(&_v2);
            if (!(p6 == _v4)) {
                let _v5 = error::invalid_argument(3);
                abort _v5
            };
            let _v6 = perp_positions::is_long(&_v2);
            if (!(p4 != _v6)) {
                let _v7 = error::invalid_argument(7);
                abort _v7
            };
            let _v8 = &_v2;
            return validate_backstop_liquidate_isolated_position(p0, p1, _v8, p3, p4, p5)
        };
        let _v9 = &_v2;
        let _v10 = option::none<builder_code_registry::BuilderCode>();
        validate_decrease_crossed_position(p0, p1, _v9, p3, p5, p6, _v10, true)
    }
    friend fun validate_position_update(p0: &collateral_balance_sheet::CollateralBalanceSheet, p1: &liquidation_config::LiquidationConfig, p2: address, p3: object::Object<perp_market::PerpMarket>, p4: u64, p5: bool, p6: bool, p7: u64, p8: option::Option<builder_code_registry::BuilderCode>, p9: bool): UpdatePositionResult {
        let _v0;
        perp_market_config::validate_price_and_size_allow_below_min_size(p3, p4, p7);
        let _v1 = perp_positions::may_be_find_position(p2, p3);
        if (option::is_some<perp_positions::PerpPosition>(&_v1)) _v0 = perp_positions::is_isolated(option::borrow<perp_positions::PerpPosition>(&_v1)) else _v0 = false;
        if (_v0) {
            let _v2 = option::destroy_some<perp_positions::PerpPosition>(_v1);
            return validate_isolated_position_update(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, _v2)
        };
        validate_crossed_position_update(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, _v1)
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
                    _v1 = perp_positions::cross_position_status(p0, p2, _v6, true)
                };
                let _v7 = &mut _v2;
                let _v8 = *&(&p8).unrealized_funding_cost;
                let _v9 = *&(&p8).updated_funding_index;
                perp_positions::update_single_position_struct(_v7, p4, p5, p6, _v8, _v9);
                if (option::is_some<i64>(&(&p8).realized_pnl)) {
                    let _v10 = &mut _v1;
                    let _v11 = option::destroy_some<i64>(*&(&p8).realized_pnl);
                    perp_positions::increase_account_balance_for_status(_v10, _v11)
                };
                if (option::is_some<i64>(&(&p8).margin_delta)) {
                    let _v12 = &mut _v1;
                    let _v13 = option::destroy_some<i64>(*&(&p8).margin_delta);
                    perp_positions::increase_account_balance_for_status(_v12, _v13)
                };
                let _v14 = &mut _v1;
                let _v15 = fee_distribution::get_position_fee_delta(&(&p8).fee_distribution);
                perp_positions::increase_account_balance_for_status(_v14, _v15);
                let _v16 = &mut _v1;
                let _v17 = &_v2;
                perp_positions::update_position_status_for_position(_v16, _v17, true);
                if (perp_positions::is_account_liquidatable(&_v1, p1, p7)) return UpdatePositionResult::BecomesLiquidatable{}
            }
        };
        p8
    }
}
