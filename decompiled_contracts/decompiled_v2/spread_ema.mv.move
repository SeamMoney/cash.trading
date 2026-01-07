module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::spread_ema {
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::decibel_time;
    use 0x1::error;
    use 0x1::fixed_point32;
    use 0x1::math_fixed;
    use 0x1::option;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::price_management;
    struct SpreadEMA has copy, drop, store {
        ratio_ema: u64,
        lookback_window_seconds: u64,
        last_observation_time: u64,
        observation_count: u64,
    }
    friend fun add_observation(p0: &mut SpreadEMA, p1: u64, p2: u64) {
        let _v0 = decibel_time::now_seconds();
        add_observation_with_time(p0, p1, p2, _v0);
    }
    friend fun add_observation_with_time(p0: &mut SpreadEMA, p1: u64, p2: u64, p3: u64) {
        let _v0;
        let _v1;
        if (*&p0.observation_count > 0) {
            let _v2 = *&p0.last_observation_time;
            _v1 = p3 <= _v2
        } else _v1 = false;
        loop {
            if (!_v1) {
                let _v3;
                if (!(p1 > 0)) {
                    let _v4 = error::invalid_argument(5);
                    abort _v4
                };
                if (!(p2 > 0)) {
                    let _v5 = error::invalid_argument(5);
                    abort _v5
                };
                let _v6 = p1;
                if (!(_v6 != 0)) {
                    let _v7 = error::invalid_argument(4);
                    abort _v7
                };
                let _v8 = (p2 as u128) * 1000000000000u128;
                let _v9 = _v6 as u128;
                let _v10 = _v8 / _v9;
                if (_v10 > 1000000000000000u128) _v3 = 1000000000000000 else _v3 = _v10 as u64;
                if (_v3 < 1000000000) _v3 = 1000000000;
                if (*&p0.observation_count == 0) {
                    _v0 = &mut p0.ratio_ema;
                    *_v0 = _v3;
                    break
                };
                let _v11 = *&p0.lookback_window_seconds;
                let _v12 = *&p0.last_observation_time;
                let _v13 = p3 - _v12;
                let _v14 = calculate_alpha(_v11, _v13);
                let _v15 = _v14 as u128;
                let _v16 = _v3 as u128;
                let _v17 = (_v15 * _v16 / 100000000u128) as u64;
                let _v18 = 100000000 - _v14;
                let _v19 = *&p0.ratio_ema;
                let _v20 = _v18 as u128;
                let _v21 = _v19 as u128;
                let _v22 = (_v20 * _v21 / 100000000u128) as u64;
                let _v23 = _v17 + _v22;
                let _v24 = &mut p0.ratio_ema;
                *_v24 = _v23;
                break
            };
            return ()
        };
        _v0 = &mut p0.last_observation_time;
        *_v0 = p3;
        _v0 = &mut p0.observation_count;
        *_v0 = *_v0 + 1;
    }
    fun calculate_alpha(p0: u64, p1: u64): u64 {
        let _v0 = 18 * p0;
        if (p1 > _v0) return 100000000;
        let _v1 = math_fixed::exp(fixed_point32::create_from_rational(p1, p0));
        let _v2 = fixed_point32::divide_u64(100000000, _v1);
        100000000 - _v2
    }
    friend fun get_estimated_px(p0: &SpreadEMA, p1: u64): u64 {
        if (*&p0.observation_count == 0) return p1;
        let _v0 = *&p0.ratio_ema;
        let _v1 = p1 as u128;
        let _v2 = _v0 as u128;
        ((_v1 * _v2 + 500000000000u128) / 1000000000000u128) as u64
    }
    friend fun get_last_observation_time(p0: &SpreadEMA): option::Option<u64> {
        if (*&p0.observation_count > 0) return option::some<u64>(*&p0.last_observation_time);
        option::none<u64>()
    }
    friend fun get_lookback_window(p0: &SpreadEMA): u64 {
        *&p0.lookback_window_seconds
    }
    friend fun get_observation_count(p0: &SpreadEMA): u64 {
        *&p0.observation_count
    }
    friend fun new_ema(p0: u64): SpreadEMA {
        if (!(p0 >= 10)) {
            let _v0 = error::invalid_argument(1);
            abort _v0
        };
        if (!(p0 <= 31536000)) {
            let _v1 = error::invalid_argument(1);
            abort _v1
        };
        SpreadEMA{ratio_ema: 1000000000000, lookback_window_seconds: p0, last_observation_time: 0, observation_count: 0}
    }
    friend fun update_lookback_window(p0: &mut SpreadEMA, p1: u64) {
        if (!(p1 >= 10)) {
            let _v0 = error::invalid_argument(1);
            abort _v0
        };
        if (!(p1 <= 31536000)) {
            let _v1 = error::invalid_argument(1);
            abort _v1
        };
        let _v2 = &mut p0.lookback_window_seconds;
        *_v2 = p1;
    }
}
