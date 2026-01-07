module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::math {
    use 0x1::error;
    use 0x1::math64;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::chainlink_state;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::oracle;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::collateral_balance_sheet;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market_config;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::position_update;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine;
    struct Precision has copy, drop, store {
        decimals: u8,
        multiplier: u64,
    }
    friend fun convert_decimals(p0: u64, p1: &Precision, p2: &Precision, p3: bool): u64 {
        let _v0 = *&p1.decimals;
        let _v1 = *&p2.decimals;
        'l0: loop {
            let _v2;
            let _v3;
            'l1: loop {
                let _v4;
                let _v5;
                'l2: loop {
                    loop {
                        if (!(_v0 == _v1)) {
                            let _v6 = *&p1.decimals;
                            let _v7 = *&p2.decimals;
                            if (!(_v6 > _v7)) break 'l0;
                            _v3 = p0;
                            let _v8 = *&p1.multiplier;
                            let _v9 = *&p2.multiplier;
                            _v2 = _v8 / _v9;
                            if (!p3) break 'l1;
                            _v5 = _v3;
                            _v4 = _v2;
                            if (!(_v5 == 0)) break 'l2;
                            if (_v4 != 0) break;
                            let _v10 = error::invalid_argument(4);
                            abort _v10
                        };
                        return p0
                    };
                    return 0
                };
                return (_v5 - 1) / _v4 + 1
            };
            return _v3 / _v2
        };
        let _v11 = *&p2.multiplier;
        let _v12 = *&p1.multiplier;
        let _v13 = _v11 / _v12;
        p0 * _v13
    }
    friend fun get_decimals(p0: &Precision): u8 {
        *&p0.decimals
    }
    friend fun get_decimals_multiplier(p0: &Precision): u64 {
        *&p0.multiplier
    }
    friend fun new_precision(p0: u8): Precision {
        let _v0 = p0 as u64;
        let _v1 = math64::pow(10, _v0);
        Precision{decimals: p0, multiplier: _v1}
    }
}
