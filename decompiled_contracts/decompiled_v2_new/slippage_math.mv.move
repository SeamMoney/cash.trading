module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::slippage_math {
    use 0x1::object;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_market;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_market_config;
    use 0x1::error;
    public fun compute_limit_price_with_slippage(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64, p3: u64, p4: bool): u64 {
        let _v0;
        if (p4) {
            let _v1 = p3 + p2;
            let _v2 = p3;
            if (!(_v2 != 0)) {
                let _v3 = error::invalid_argument(4);
                abort _v3
            };
            let _v4 = p1 as u128;
            let _v5 = _v1 as u128;
            let _v6 = _v4 * _v5;
            let _v7 = _v2 as u128;
            _v0 = (_v6 / _v7) as u64
        } else {
            p2 = p3 - p2;
            if (p3 != 0) {
                let _v8;
                let _v9 = p1 as u128;
                let _v10 = p2 as u128;
                let _v11 = _v9 * _v10;
                let _v12 = p3 as u128;
                if (_v11 == 0u128) if (_v12 != 0u128) _v8 = 0u128 else {
                    let _v13 = error::invalid_argument(4);
                    abort _v13
                } else _v8 = (_v11 - 1u128) / _v12 + 1u128;
                _v0 = _v8 as u64
            } else {
                let _v14 = error::invalid_argument(4);
                abort _v14
            }
        };
        perp_market_config::round_price_to_ticker(p0, _v0, !p4)
    }
}
