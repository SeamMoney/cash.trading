module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::oracle {
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::internal_oracle_state;
    use 0x7e783b349d3e89cf5931af376ebeadbfab855b3fa239b7ada8f5a92fbea6b387::price_identifier;
    use 0x7e783b349d3e89cf5931af376ebeadbfab855b3fa239b7ada8f5a92fbea6b387::price;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::math;
    use 0x7e783b349d3e89cf5931af376ebeadbfab855b3fa239b7ada8f5a92fbea6b387::i64;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::chainlink_state;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::decibel_time;
    use 0x7e783b349d3e89cf5931af376ebeadbfab855b3fa239b7ada8f5a92fbea6b387::pyth;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market_config;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::collateral_balance_sheet;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::accounts_collateral;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    struct ChainlinkSource has copy, drop, store {
        feed_id: vector<u8>,
        max_staleness_secs: u64,
        rescale_decimals: i8,
    }
    struct InternalSource has copy, drop, store {
        source_id: internal_oracle_state::InternalSourceIdentifier,
        max_staleness_secs: u64,
    }
    struct OracleData has copy, drop {
        price: u64,
        status: OracleStatus,
    }
    enum OracleStatus has copy, drop {
        Ok,
        Invalid,
        Down,
    }
    enum OracleSource has copy, drop, store {
        Single {
            primary: SingleOracleSource,
        }
        Composite {
            primary: SingleOracleSource,
            secondary: SingleOracleSource,
            oracles_deviation_bps: u64,
            consecutive_deviation_count: u8,
            last_primary_price: u64,
            current_deviation_count: u8,
        }
    }
    enum SingleOracleSource has copy, drop, store {
        Internal {
            _0: InternalSource,
        }
        Pyth {
            _0: PythSource,
        }
        Chainlink {
            _0: ChainlinkSource,
        }
    }
    struct PythSource has copy, drop, store {
        price_identifier: price_identifier::PriceIdentifier,
        max_staleness_secs: u64,
        confidence_interval_threshold: u64,
        rescale_decimals: i8,
    }
    friend fun get_price(p0: &OracleData): u64 {
        *&p0.price
    }
    fun calculate_deviation_bps(p0: u64, p1: u64): u64 {
        let _v0;
        let _v1;
        if (p0 == 0) _v1 = true else _v1 = p1 == 0;
        loop {
            if (!_v1) {
                if (p0 > p1) {
                    _v0 = p0 - p1;
                    break
                };
                _v0 = p1 - p0;
                break
            };
            return 0
        };
        _v0 * 10000 / p0
    }
    fun check_and_handle_deviation(p0: u64, p1: u64, p2: u64, p3: &mut u8, p4: u8): bool {
        if (calculate_deviation_bps(p0, p1) > p2) {
            let _v0 = p3;
            *_v0 = *_v0 + 1u8;
            if (*p3 >= p4) return true
        } else *p3 = 0u8;
        false
    }
    fun convert_pyth_price_to_u64(p0: price::Price, p1: i8, p2: math::Precision): u64 {
        let _v0;
        let _v1;
        let _v2 = price::get_expo(&p0);
        let _v3 = price::get_price(&p0);
        let _v4 = i64::get_magnitude_if_positive(&_v3);
        let _v5 = _v2;
        let _v6 = p2;
        p1 = (math::get_decimals(&_v6) as i8) + p1;
        if (i64::get_is_negative(&_v5)) _v1 = -(i64::get_magnitude_if_negative(&_v5) as i8) else _v1 = i64::get_magnitude_if_positive(&_v5) as i8;
        let _v7 = p1 + _v1;
        if (_v7 < 0i8) {
            let _v8 = math::new_precision((-_v7) as u8);
            _v0 = math::get_decimals_multiplier(&_v8);
            _v4 = _v4 / _v0
        } else if (_v7 > 0i8) {
            let _v9 = math::new_precision(_v7 as u8);
            _v0 = math::get_decimals_multiplier(&_v9);
            _v4 = _v4 * _v0
        };
        _v4
    }
    friend fun create_new_internal_oracle_source(p0: &signer, p1: u64, p2: u64): SingleOracleSource {
        new_internal_source(internal_oracle_state::create_new_internal_source(p0, p1), p2)
    }
    friend fun new_internal_source(p0: internal_oracle_state::InternalSourceIdentifier, p1: u64): SingleOracleSource {
        SingleOracleSource::Internal{_0: InternalSource{source_id: p0, max_staleness_secs: p1}}
    }
    friend fun get_oracle_data(p0: &OracleSource, p1: math::Precision): OracleData {
        let _v0;
        'l4: loop {
            let _v1;
            'l3: loop {
                let _v2;
                'l2: loop {
                    let _v3;
                    'l0: loop {
                        'l1: loop {
                            loop {
                                if (p0 is Single) {
                                    _v1 = &p0.primary;
                                    _v3 = get_oracle_price(_v1, p1);
                                    if (!is_oracle_healthy(_v1)) break
                                } else if (p0 is Composite) {
                                    let _v4;
                                    _v1 = &p0.primary;
                                    _v2 = &p0.secondary;
                                    let _v5 = &p0.consecutive_deviation_count;
                                    _v0 = &p0.last_primary_price;
                                    let _v6 = &p0.current_deviation_count;
                                    let _v7 = is_oracle_healthy(_v1);
                                    let _v8 = is_oracle_healthy(_v2);
                                    if (_v7) _v4 = _v8 else _v4 = false;
                                    if (_v4) {
                                        _v3 = get_oracle_price(_v1, p1);
                                        let _v9 = *_v6;
                                        let _v10 = *_v5;
                                        if (!(_v9 >= _v10)) break 'l0;
                                        break 'l1
                                    } else {
                                        let _v11;
                                        if (_v7) _v11 = false else _v11 = _v8;
                                        if (_v11) break 'l2 else {
                                            let _v12;
                                            if (_v7) _v12 = !_v8 else _v12 = false;
                                            if (_v12) break 'l3 else break 'l4
                                        }
                                    }
                                } else abort 14566554180833181697;
                                let _v13 = OracleStatus::Ok{};
                                return OracleData{price: _v3, status: _v13}
                            };
                            let _v14 = OracleStatus::Down{};
                            return OracleData{price: _v3, status: _v14}
                        };
                        let _v15 = OracleStatus::Invalid{};
                        return OracleData{price: _v3, status: _v15}
                    };
                    let _v16 = OracleStatus::Ok{};
                    return OracleData{price: _v3, status: _v16}
                };
                let _v17 = get_oracle_price(_v2, p1);
                let _v18 = OracleStatus::Ok{};
                return OracleData{price: _v17, status: _v18}
            };
            let _v19 = get_oracle_price(_v1, p1);
            let _v20 = OracleStatus::Ok{};
            return OracleData{price: _v19, status: _v20}
        };
        let _v21 = *_v0;
        let _v22 = OracleStatus::Down{};
        OracleData{price: _v21, status: _v22}
    }
    fun get_oracle_price(p0: &SingleOracleSource, p1: math::Precision): u64 {
        'l0: loop {
            loop {
                if (!(p0 is Internal)) {
                    if (p0 is Pyth) break;
                    if (p0 is Chainlink) break 'l0;
                    abort 14566554180833181697
                };
                let (_v0,_v1) = internal_oracle_state::get_internal_source_data(&(&p0._0).source_id);
                return _v0
            };
            return pyth_price_with_precision(&p0._0, p1)
        };
        let _v2 = &p0._0;
        let _v3 = *&_v2.feed_id;
        let _v4 = *&_v2.rescale_decimals;
        let _v5 = math::get_decimals(&p1);
        chainlink_state::get_converted_price(_v3, _v4, _v5)
    }
    fun is_oracle_healthy(p0: &SingleOracleSource): bool {
        'l1: loop {
            'l0: loop {
                let _v0;
                loop {
                    if (!(p0 is Internal)) {
                        if (p0 is Pyth) {
                            _v0 = &p0._0;
                            if (!is_pyth_stale(_v0)) break;
                            break 'l0
                        };
                        if (p0 is Chainlink) break 'l1;
                        abort 14566554180833181697
                    };
                    return !is_internal_stale(&p0._0)
                };
                return !is_pyth_confidence_exceeded(_v0)
            };
            return false
        };
        !is_chainlink_stale(&p0._0)
    }
    fun pyth_price_with_precision(p0: &PythSource, p1: math::Precision): u64 {
        let _v0 = pyth::get_price_unsafe(*&p0.price_identifier);
        let _v1 = *&p0.rescale_decimals;
        convert_pyth_price_to_u64(_v0, _v1, p1)
    }
    friend fun get_oracle_type(p0: &OracleSource): u8 {
        if (!((p0 is Single) && (&p0.primary is Internal))) {
            if (!((p0 is Single) && (&p0.primary is Pyth))) {
                if (!((p0 is Single) && (&p0.primary is Chainlink))) {
                    loop {
                        let _v0;
                        if (p0 is Composite) {
                            let _v1 = &p0.primary;
                            _v0 = &p0.secondary;
                            if (_v1 is Pyth) {
                                if (_v0 is Internal) break}
                        };
                        loop {
                            if (p0 is Composite) {
                                let _v2 = &p0.primary;
                                _v0 = &p0.secondary;
                                if (_v2 is Chainlink) {
                                    if (_v0 is Internal) break}
                            };
                            abort 2
                        };
                        return 4u8
                    };
                    return 3u8
                };
                return 2u8
            };
            return 1u8
        };
        0u8
    }
    public fun get_primary_oracle_price(p0: &OracleSource, p1: math::Precision): u64 {
        loop {
            if (!(p0 is Single)) {
                if (p0 is Composite) break;
                abort 14566554180833181697
            };
            return get_oracle_price(&p0.primary, p1)
        };
        get_oracle_price(&p0.primary, p1)
    }
    public fun get_secondary_oracle_price(p0: &OracleSource, p1: math::Precision): u64 {
        assert!(p0 is Composite, 2);
        get_oracle_price(&p0.secondary, p1)
    }
    fun is_chainlink_stale(p0: &ChainlinkSource): bool {
        let _v0;
        let (_v1,_v2) = chainlink_state::get_latest_price(*&p0.feed_id);
        let _v3 = decibel_time::now_seconds();
        let _v4 = _v2 as u64;
        if (_v3 > _v4) _v0 = _v3 - _v4 else _v0 = _v4 - _v3;
        let _v5 = *&p0.max_staleness_secs;
        _v0 > _v5
    }
    friend fun is_composite(p0: &OracleSource): bool {
        p0 is Composite
    }
    fun is_internal_stale(p0: &InternalSource): bool {
        let _v0;
        let (_v1,_v2) = internal_oracle_state::get_internal_source_data(&p0.source_id);
        let _v3 = _v2;
        let _v4 = decibel_time::now_seconds();
        if (_v4 > _v3) _v0 = _v4 - _v3 else _v0 = _v3 - _v4;
        let _v5 = *&p0.max_staleness_secs;
        _v0 > _v5
    }
    fun is_pyth_stale(p0: &PythSource): bool {
        let _v0 = decibel_time::now_seconds();
        let _v1 = pyth::get_price_unsafe(*&p0.price_identifier);
        let _v2 = price::get_timestamp(&_v1);
        let _v3 = _v0 - _v2;
        let _v4 = *&p0.max_staleness_secs;
        _v3 > _v4
    }
    fun is_pyth_confidence_exceeded(p0: &PythSource): bool {
        let _v0 = pyth::get_price_unsafe(*&p0.price_identifier);
        let _v1 = price::get_conf(&_v0);
        let _v2 = *&p0.confidence_interval_threshold;
        _v1 > _v2
    }
    friend fun is_status_down(p0: &OracleData): bool {
        &p0.status is Down
    }
    friend fun is_status_invalid(p0: &OracleData): bool {
        &p0.status is Invalid
    }
    friend fun is_status_ok(p0: &OracleData): bool {
        &p0.status is Ok
    }
    friend fun new_chainlink_source(p0: vector<u8>, p1: u64, p2: i8): SingleOracleSource {
        chainlink_state::assert_initialized();
        SingleOracleSource::Chainlink{_0: ChainlinkSource{feed_id: p0, max_staleness_secs: p1, rescale_decimals: p2}}
    }
    friend fun new_composite_oracle(p0: SingleOracleSource, p1: SingleOracleSource, p2: u64, p3: u8): OracleSource {
        let _v0;
        let _v1 = OracleSource::Composite{primary: p0, secondary: p1, oracles_deviation_bps: p2, consecutive_deviation_count: p3, last_primary_price: 0, current_deviation_count: 0u8};
        p3 = get_oracle_type(&_v1);
        if (p3 != 3u8) _v0 = p3 != 4u8 else _v0 = false;
        if (_v0) abort 2;
        _v1
    }
    friend fun new_pyth_source(p0: vector<u8>, p1: u64, p2: u64, p3: i8): SingleOracleSource {
        SingleOracleSource::Pyth{_0: PythSource{price_identifier: price_identifier::from_byte_vec(p0), max_staleness_secs: p1, confidence_interval_threshold: p2, rescale_decimals: p3}}
    }
    friend fun new_single_oracle(p0: SingleOracleSource): OracleSource {
        OracleSource::Single{primary: p0}
    }
    friend fun update_internal_oracle_price(p0: &OracleSource, p1: u64) {
        let _v0;
        loop {
            if (p0 is Single) {
                _v0 = &p0.primary;
                if (_v0 is Internal) break
            };
            loop {
                if (p0 is Composite) {
                    _v0 = &p0.secondary;
                    if (_v0 is Internal) break
                };
                abort 0
            };
            internal_oracle_state::update_internal_source_price(&(&_v0._0).source_id, p1);
            return ()
        };
        internal_oracle_state::update_internal_source_price(&(&_v0._0).source_id, p1);
    }
    friend fun update_oracle_status(p0: &mut OracleSource, p1: math::Precision) {
        'l2: loop {
            let _v0;
            let _v1;
            let _v2;
            'l3: loop {
                'l1: loop {
                    'l0: loop {
                        let _v3;
                        loop {
                            if (!(p0 is Single)) {
                                let _v4;
                                let _v5;
                                let _v6;
                                assert!(p0 is Composite, 14566554180833181697);
                                _v2 = &mut p0.primary;
                                let _v7 = &mut p0.secondary;
                                let _v8 = &mut p0.oracles_deviation_bps;
                                let _v9 = &mut p0.consecutive_deviation_count;
                                _v1 = &mut p0.last_primary_price;
                                _v0 = &mut p0.current_deviation_count;
                                let _v10 = is_oracle_healthy(freeze(_v2));
                                let _v11 = is_oracle_healthy(freeze(_v7));
                                if (_v10) _v6 = _v11 else _v6 = false;
                                if (_v6) {
                                    _v3 = get_oracle_price(freeze(_v2), p1);
                                    let _v12 = get_oracle_price(freeze(_v7), p1);
                                    let _v13 = *_v8;
                                    let _v14 = *_v9;
                                    if (!check_and_handle_deviation(_v3, _v12, _v13, _v0, _v14)) break;
                                    break 'l0
                                };
                                if (_v10) _v5 = false else _v5 = _v11;
                                if (_v5) break 'l1;
                                if (_v10) _v4 = !_v11 else _v4 = false;
                                if (!_v4) break 'l2;
                                break 'l3
                            };
                            return ()
                        };
                        *_v1 = _v3;
                        return ()
                    };
                    return ()
                };
                *_v0 = 0u8;
                return ()
            };
            *_v0 = 0u8;
            *_v1 = get_oracle_price(freeze(_v2), p1);
            return ()
        };
    }
}
