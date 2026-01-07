module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::builder_code_registry {
    use 0x1::big_ordered_map;
    use 0x1::signer;
    use 0x1::error;
    use 0x1::option;
    use 0x1::math64;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::trading_fees_manager;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::async_matching_engine;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine_api;
    struct BuilderAndAccount has copy, drop, store {
        account: address,
        builder: address,
    }
    struct BuilderCode has copy, drop, store {
        builder: address,
        fees: u64,
    }
    enum Registry has store, key {
        V1 {
            global_max_fee: u64,
            approved_max_fees: big_ordered_map::BigOrderedMap<BuilderAndAccount, u64>,
        }
    }
    friend fun initialize(p0: &signer, p1: u64) {
        if (!(signer::address_of(p0) == @0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75)) {
            let _v0 = error::invalid_argument(3);
            abort _v0
        };
        let _v1 = big_ordered_map::new<BuilderAndAccount,u64>();
        let _v2 = Registry::V1{global_max_fee: p1, approved_max_fees: _v1};
        move_to<Registry>(p0, _v2);
    }
    friend fun approve_max_fee(p0: &signer, p1: address, p2: u64)
        acquires Registry
    {
        let _v0 = borrow_global_mut<Registry>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
        let _v1 = BuilderAndAccount{account: signer::address_of(p0), builder: p1};
        let _v2 = *&_v0.global_max_fee;
        if (!(p2 <= _v2)) {
            let _v3 = error::invalid_argument(4);
            abort _v3
        };
        let _v4 = &_v0.approved_max_fees;
        let _v5 = &_v1;
        if (big_ordered_map::contains<BuilderAndAccount,u64>(_v4, _v5)) {
            let _v6 = &mut _v0.approved_max_fees;
            let _v7 = &_v1;
            let _v8 = big_ordered_map::remove<BuilderAndAccount,u64>(_v6, _v7);
        };
        big_ordered_map::add<BuilderAndAccount,u64>(&mut _v0.approved_max_fees, _v1, p2);
    }
    public fun get_approved_max_fee(p0: address, p1: address): u64
        acquires Registry
    {
        let _v0 = borrow_global<Registry>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
        let _v1 = BuilderAndAccount{account: p0, builder: p1};
        let _v2 = &_v0.approved_max_fees;
        let _v3 = &_v1;
        let _v4 = big_ordered_map::get<BuilderAndAccount,u64>(_v2, _v3);
        if (option::is_none<u64>(&_v4)) return 0;
        let _v5 = option::destroy_some<u64>(_v4);
        let _v6 = *&_v0.global_max_fee;
        math64::min(_v5, _v6)
    }
    friend fun get_builder_fee_for_notional(p0: address, p1: BuilderCode, p2: u128): u64
        acquires Registry
    {
        let _v0 = *&(&p1).builder;
        let _v1 = get_approved_max_fee(p0, _v0);
        if (_v1 == 0) return 0;
        let _v2 = *&(&p1).fees;
        let _v3 = math64::min(_v1, _v2) as u128;
        (p2 * _v3 / 1000000u128) as u64
    }
    friend fun get_builder_from_builder_code(p0: &BuilderCode): address {
        *&p0.builder
    }
    friend fun get_fees_from_builder_code(p0: &BuilderCode): u64 {
        *&p0.fees
    }
    friend fun new_builder_code(p0: address, p1: u64): BuilderCode
        acquires Registry
    {
        let _v0 = borrow_global<Registry>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
        if (!(p1 > 0)) {
            let _v1 = error::invalid_argument(1);
            abort _v1
        };
        let _v2 = *&_v0.global_max_fee;
        if (!(p1 <= _v2)) {
            let _v3 = error::invalid_argument(4);
            abort _v3
        };
        BuilderCode{builder: p0, fees: p1}
    }
    friend fun revoke_max_fee(p0: &signer, p1: address)
        acquires Registry
    {
        let _v0 = borrow_global_mut<Registry>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
        let _v1 = BuilderAndAccount{account: signer::address_of(p0), builder: p1};
        let _v2 = &_v0.approved_max_fees;
        let _v3 = &_v1;
        let _v4 = big_ordered_map::get<BuilderAndAccount,u64>(_v2, _v3);
        if (option::is_none<u64>(&_v4)) {
            let _v5 = error::invalid_argument(2);
            abort _v5
        };
        let _v6 = &mut _v0.approved_max_fees;
        let _v7 = &_v1;
        let _v8 = big_ordered_map::remove<BuilderAndAccount,u64>(_v6, _v7);
    }
    friend fun validate_builder_code(p0: address, p1: &BuilderCode)
        acquires Registry
    {
        let _v0 = *&p1.fees;
        let _v1 = *&p1.builder;
        let _v2 = get_approved_max_fee(p0, _v1);
        assert!(_v2 != 0, 5);
        if (!(_v0 <= _v2)) {
            let _v3 = error::invalid_argument(4);
            abort _v3
        };
    }
}
