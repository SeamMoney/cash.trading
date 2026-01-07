module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::liquidation_config {
    use 0x1::error;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_positions;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::position_update;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::accounts_collateral;
    enum LiquidationConfig has drop, store {
        V1 {
            backstop_liquidator: address,
            maintenance_margin_leverage_multiplier: u64,
            maintenance_margin_leverage_divisor: u64,
            backstop_margin_maintenance_multiplier: u64,
            backstop_margin_maintenance_divisor: u64,
        }
    }
    friend fun backstop_liquidator(p0: &LiquidationConfig): address {
        *&p0.backstop_liquidator
    }
    friend fun maintenance_margin_leverage_multiplier(p0: &LiquidationConfig): u64 {
        *&p0.maintenance_margin_leverage_multiplier
    }
    friend fun maintenance_margin_leverage_divisor(p0: &LiquidationConfig): u64 {
        *&p0.maintenance_margin_leverage_divisor
    }
    friend fun backstop_margin_maintenance_multiplier(p0: &LiquidationConfig): u64 {
        *&p0.backstop_margin_maintenance_multiplier
    }
    friend fun backstop_margin_maintenance_divisor(p0: &LiquidationConfig): u64 {
        *&p0.backstop_margin_maintenance_divisor
    }
    friend fun new_config(p0: address): LiquidationConfig {
        LiquidationConfig::V1{backstop_liquidator: p0, maintenance_margin_leverage_multiplier: 1, maintenance_margin_leverage_divisor: 2, backstop_margin_maintenance_multiplier: 1, backstop_margin_maintenance_divisor: 3}
    }
    friend fun get_liquidation_margin(p0: &LiquidationConfig, p1: u64, p2: bool): u64 {
        let _v0;
        'l1: loop {
            'l2: loop {
                let _v1;
                'l0: loop {
                    loop {
                        if (p2) {
                            let _v2 = *&p0.backstop_margin_maintenance_multiplier;
                            _v0 = p1 * _v2;
                            _v1 = *&p0.backstop_margin_maintenance_divisor;
                            if (!(_v0 == 0)) break 'l0;
                            if (_v1 != 0) break;
                            let _v3 = error::invalid_argument(4);
                            abort _v3
                        };
                        let _v4 = *&p0.maintenance_margin_leverage_multiplier;
                        p1 = p1 * _v4;
                        _v0 = *&p0.maintenance_margin_leverage_divisor;
                        if (!(p1 == 0)) break 'l1;
                        if (_v0 != 0) break 'l2;
                        let _v5 = error::invalid_argument(4);
                        abort _v5
                    };
                    return 0
                };
                return (_v0 - 1) / _v1 + 1
            };
            return 0
        };
        (p1 - 1) / _v0 + 1
    }
    friend fun get_liquidation_price(p0: &LiquidationConfig, p1: u64, p2: u8, p3: bool): u64 {
        let _v0;
        'l1: loop {
            'l2: loop {
                let _v1;
                'l0: loop {
                    loop {
                        if (p3) {
                            let _v2 = *&p0.backstop_margin_maintenance_multiplier;
                            _v0 = p1 * _v2;
                            let _v3 = p2 as u64;
                            let _v4 = *&p0.backstop_margin_maintenance_divisor;
                            _v1 = _v3 * _v4;
                            if (!(_v0 == 0)) break 'l0;
                            if (_v1 != 0) break;
                            let _v5 = error::invalid_argument(4);
                            abort _v5
                        };
                        let _v6 = *&p0.maintenance_margin_leverage_multiplier;
                        p1 = p1 * _v6;
                        let _v7 = p2 as u64;
                        let _v8 = *&p0.maintenance_margin_leverage_divisor;
                        _v0 = _v7 * _v8;
                        if (!(p1 == 0)) break 'l1;
                        if (_v0 != 0) break 'l2;
                        let _v9 = error::invalid_argument(4);
                        abort _v9
                    };
                    return 0
                };
                return (_v0 - 1) / _v1 + 1
            };
            return 0
        };
        (p1 - 1) / _v0 + 1
    }
}
