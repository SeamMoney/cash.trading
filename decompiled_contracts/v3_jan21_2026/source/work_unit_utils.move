module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::work_unit_utils {
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::order_placement_utils;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::liquidation;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_matching_engine;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::public_apis;
    enum WorkUnit has copy, drop {
        V1 {
            amount: u32,
        }
    }
    friend fun consume_backstop_liquidation_or_adl_work_units(p0: &mut WorkUnit, p1: u32) {
        p1 = 50u32 * p1;
        let _v0 = 2u32 * p1;
        let _v1 = *&p0.amount;
        if (_v0 > _v1) {
            let _v2 = &mut p0.amount;
            *_v2 = 0u32;
            return ()
        };
        let _v3 = &mut p0.amount;
        *_v3 = *_v3 - p1;
    }
    friend fun consume_bulk_order_work_units(p0: &mut WorkUnit) {
        let _v0 = *&p0.amount;
        if (100u32 > _v0) {
            let _v1 = &mut p0.amount;
            *_v1 = 0u32;
            return ()
        };
        let _v2 = &mut p0.amount;
        *_v2 = *_v2 - 50u32;
    }
    friend fun consume_margin_call_one_market_work_units(p0: &mut WorkUnit) {
        let _v0 = *&p0.amount;
        if (40u32 > _v0) {
            let _v1 = &mut p0.amount;
            *_v1 = 0u32;
            return ()
        };
        let _v2 = &mut p0.amount;
        *_v2 = *_v2 - 20u32;
    }
    friend fun consume_margin_call_overhead_work_units(p0: &mut WorkUnit) {
        let _v0 = *&p0.amount;
        if (40u32 > _v0) {
            let _v1 = &mut p0.amount;
            *_v1 = 0u32;
            return ()
        };
        let _v2 = &mut p0.amount;
        *_v2 = *_v2 - 20u32;
    }
    friend fun consume_order_match_work_units(p0: &mut WorkUnit, p1: u32) {
        let _v0;
        if (p1 == 0u32) _v0 = 50u32 else _v0 = p1 * 100u32;
        let _v1 = _v0;
        let _v2 = 2u32 * _v1;
        let _v3 = *&p0.amount;
        if (_v2 > _v3) {
            let _v4 = &mut p0.amount;
            *_v4 = 0u32;
            return ()
        };
        let _v5 = &mut p0.amount;
        *_v5 = *_v5 - _v1;
    }
    friend fun consume_order_placement_work_units(p0: &mut WorkUnit) {
        let _v0 = *&p0.amount;
        if (100u32 > _v0) {
            let _v1 = &mut p0.amount;
            *_v1 = 0u32;
            return ()
        };
        let _v2 = &mut p0.amount;
        *_v2 = *_v2 - 50u32;
    }
    friend fun consume_position_status_work_units(p0: &mut WorkUnit) {
        let _v0 = *&p0.amount;
        if (100u32 > _v0) {
            let _v1 = &mut p0.amount;
            *_v1 = 0u32;
            return ()
        };
        let _v2 = &mut p0.amount;
        *_v2 = *_v2 - 50u32;
    }
    friend fun consume_refresh_mark_price_work_units(p0: &mut WorkUnit) {
        let _v0 = *&p0.amount;
        if (40u32 > _v0) {
            let _v1 = &mut p0.amount;
            *_v1 = 0u32;
            return ()
        };
        let _v2 = &mut p0.amount;
        *_v2 = *_v2 - 20u32;
    }
    friend fun consume_small_work_units(p0: &mut WorkUnit) {
        let _v0 = *&p0.amount;
        if (10u32 > _v0) {
            let _v1 = &mut p0.amount;
            *_v1 = 0u32;
            return ()
        };
        let _v2 = &mut p0.amount;
        *_v2 = *_v2 - 5u32;
    }
    friend fun get_default_work_units(): WorkUnit {
        WorkUnit::V1{amount: 500u32}
    }
    friend fun get_finish_or_abort_work_units(): WorkUnit {
        WorkUnit::V1{amount: 1000000000u32}
    }
    friend fun get_max_match_limit(p0: &WorkUnit): u32 {
        let _v0 = *&p0.amount / 100u32;
        if (_v0 == 0u32) return 1u32;
        _v0
    }
    friend fun get_max_order_placement_limit(p0: &WorkUnit, p1: u32): u32 {
        let _v0;
        let _v1 = *&p0.amount / 50u32;
        loop {
            if (!(_v1 == 0u32)) {
                if (_v1 > p1) {
                    _v0 = p1;
                    break
                };
                _v0 = _v1;
                break
            };
            return 1u32
        };
        _v0
    }
    friend fun get_minimum_work_units(): WorkUnit {
        WorkUnit::V1{amount: 1u32}
    }
    friend fun get_work_units_from_argument(p0: u32): WorkUnit {
        WorkUnit::V1{amount: p0}
    }
    friend fun has_more_work(p0: &WorkUnit): bool {
        *&p0.amount > 0u32
    }
}
