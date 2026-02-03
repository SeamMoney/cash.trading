module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::referral_registry {
    use 0x1::string;
    use 0x1::big_ordered_map;
    use 0x1::option;
    use 0x1::event;
    use 0x1::error;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::trading_fees_manager;
    enum AffiliateRegisteredEvent has drop, store {
        V1 {
            affiliate_addr: address,
            referrer_state: ReferrerState,
        }
    }
    enum ReferrerState has copy, drop, store {
        V1 {
            codes: vector<string::String>,
            max_referral_codes: option::Option<u64>,
            max_usage_per_referral_code: option::Option<u64>,
            is_affiliate: bool,
        }
    }
    enum ReferralCode has copy, drop, store {
        V1 {
            code: string::String,
            num_referred: u64,
        }
    }
    enum ReferralCodeRegisteredEvent has drop, store {
        V1 {
            referrer_addr: address,
            referral_code: string::String,
            referrer_state: ReferrerState,
        }
    }
    enum ReferralRegisteredEvent has drop, store {
        V1 {
            referral_code: string::String,
            referree_addr: address,
            referrer_addr: address,
            referral_code_state: ReferralCode,
        }
    }
    struct Referrals has store {
        addr_to_referrer_state: big_ordered_map::BigOrderedMap<address, ReferrerState>,
        referral_code_to_addr: big_ordered_map::BigOrderedMap<string::String, address>,
        referral_code_to_state: big_ordered_map::BigOrderedMap<string::String, ReferralCode>,
        addr_to_referrer_addr: big_ordered_map::BigOrderedMap<address, address>,
    }
    friend fun initialize(): Referrals {
        let _v0 = big_ordered_map::new_with_config<address,ReferrerState>(8u16, 8u16, true);
        let _v1 = big_ordered_map::new_with_config<string::String,address>(8u16, 8u16, true);
        let _v2 = big_ordered_map::new_with_config<string::String,ReferralCode>(8u16, 8u16, true);
        let _v3 = big_ordered_map::new_with_config<address,address>(8u16, 8u16, true);
        Referrals{addr_to_referrer_state: _v0, referral_code_to_addr: _v1, referral_code_to_state: _v2, addr_to_referrer_addr: _v3}
    }
    friend fun get_referral_code_state(p0: &Referrals, p1: string::String): option::Option<ReferralCode> {
        let _v0 = &p0.referral_code_to_state;
        let _v1 = &p1;
        big_ordered_map::get<string::String,ReferralCode>(_v0, _v1)
    }
    friend fun get_referral_codes(p0: &Referrals, p1: address): vector<string::String> {
        let _v0 = &p0.addr_to_referrer_state;
        let _v1 = &p1;
        let _v2 = big_ordered_map::get<address,ReferrerState>(_v0, _v1);
        if (option::is_some<ReferrerState>(&_v2)) {
            let _v3 = option::destroy_some<ReferrerState>(_v2);
            return *&(&_v3).codes
        };
        0x1::vector::empty<string::String>()
    }
    friend fun get_referrer_addr(p0: &Referrals, p1: address): option::Option<address> {
        let _v0 = &p0.addr_to_referrer_addr;
        let _v1 = &p1;
        big_ordered_map::get<address,address>(_v0, _v1)
    }
    friend fun get_referrer_for_code(p0: &Referrals, p1: string::String): option::Option<address> {
        let _v0 = &p0.referral_code_to_addr;
        let _v1 = &p1;
        big_ordered_map::get<string::String,address>(_v0, _v1)
    }
    friend fun get_referrer_state(p0: &Referrals, p1: address): option::Option<ReferrerState> {
        let _v0 = &p0.addr_to_referrer_state;
        let _v1 = &p1;
        big_ordered_map::get<address,ReferrerState>(_v0, _v1)
    }
    fun is_ascii_alphanumeric(p0: &string::String): bool {
        let _v0 = string::bytes(p0);
        let _v1 = string::length(p0);
        let _v2 = 0;
        'l0: loop {
            loop {
                let _v3;
                let _v4;
                let _v5;
                if (!(_v2 < _v1)) break 'l0;
                let _v6 = *0x1::vector::borrow<u8>(_v0, _v2);
                if (_v6 >= 48u8) _v5 = _v6 <= 57u8 else _v5 = false;
                if (_v5) _v4 = true else if (_v6 >= 65u8) _v4 = _v6 <= 90u8 else _v4 = false;
                if (_v4) _v3 = true else if (_v6 >= 97u8) _v3 = _v6 <= 122u8 else _v3 = false;
                if (!_v3) break;
                _v2 = _v2 + 1;
                continue
            };
            return false
        };
        true
    }
    fun new_referral_code(p0: string::String): ReferralCode {
        ReferralCode::V1{code: p0, num_referred: 0}
    }
    friend fun register_affiliate(p0: &mut Referrals, p1: address) {
        let _v0;
        let _v1 = &p0.addr_to_referrer_state;
        let _v2 = &p1;
        if (big_ordered_map::contains<address,ReferrerState>(_v1, _v2)) {
            let _v3 = &mut p0.addr_to_referrer_state;
            let _v4 = &p1;
            _v0 = big_ordered_map::remove<address,ReferrerState>(_v3, _v4)
        } else {
            let _v5 = 0x1::vector::empty<string::String>();
            let _v6 = option::none<u64>();
            let _v7 = option::none<u64>();
            _v0 = ReferrerState::V1{codes: _v5, max_referral_codes: _v6, max_usage_per_referral_code: _v7, is_affiliate: false}
        };
        let _v8 = &mut (&mut _v0).is_affiliate;
        *_v8 = true;
        let _v9 = option::some<u64>(18446744073709551615);
        let _v10 = &mut (&mut _v0).max_usage_per_referral_code;
        *_v10 = _v9;
        big_ordered_map::add<address,ReferrerState>(&mut p0.addr_to_referrer_state, p1, _v0);
        event::emit<AffiliateRegisteredEvent>(AffiliateRegisteredEvent::V1{affiliate_addr: p1, referrer_state: _v0});
    }
    friend fun register_referral(p0: &mut Referrals, p1: address, p2: string::String, p3: bool) {
        let _v0 = &p0.addr_to_referrer_addr;
        let _v1 = &p1;
        if (big_ordered_map::contains<address,address>(_v0, _v1)) {
            let _v2 = error::invalid_argument(2);
            abort _v2
        };
        let _v3 = &p0.referral_code_to_addr;
        let _v4 = &p2;
        let _v5 = *big_ordered_map::borrow<string::String,address>(_v3, _v4);
        if (!(_v5 != p1)) {
            let _v6 = error::invalid_argument(6);
            abort _v6
        };
        let _v7 = &p0.referral_code_to_state;
        let _v8 = &p2;
        let _v9 = big_ordered_map::get<string::String,ReferralCode>(_v7, _v8);
        if (!option::is_some<ReferralCode>(&_v9)) {
            let _v10 = error::invalid_argument(4);
            abort _v10
        };
        let _v11 = option::extract<ReferralCode>(&mut _v9);
        let _v12 = &p0.addr_to_referrer_state;
        let _v13 = &_v5;
        let _v14 = big_ordered_map::get<address,ReferrerState>(_v12, _v13);
        let _v15 = option::borrow<ReferrerState>(&_v14);
        if (!p3) {
            let _v16;
            if (option::is_some<u64>(&_v15.max_usage_per_referral_code)) _v16 = *option::borrow<u64>(&_v15.max_usage_per_referral_code) else _v16 = 1;
            if (!(*&(&_v11).num_referred < _v16)) {
                let _v17 = error::invalid_argument(7);
                abort _v17
            }
        };
        let _v18 = *&(&_v11).code;
        let _v19 = *&(&_v11).num_referred + 1;
        let _v20 = ReferralCode::V1{code: _v18, num_referred: _v19};
        let _v21 = &mut p0.referral_code_to_state;
        let _v22 = &p2;
        let _v23 = big_ordered_map::remove<string::String,ReferralCode>(_v21, _v22);
        big_ordered_map::add<string::String,ReferralCode>(&mut p0.referral_code_to_state, p2, _v20);
        big_ordered_map::add<address,address>(&mut p0.addr_to_referrer_addr, p1, _v5);
        event::emit<ReferralRegisteredEvent>(ReferralRegisteredEvent::V1{referral_code: p2, referree_addr: p1, referrer_addr: _v5, referral_code_state: _v20});
    }
    friend fun register_referral_code(p0: &mut Referrals, p1: address, p2: string::String, p3: bool) {
        let _v0;
        let _v1;
        if (string::length(&p2) > 0) _v1 = string::length(&p2) <= 32 else _v1 = false;
        if (!_v1) {
            let _v2 = error::invalid_argument(4);
            abort _v2
        };
        if (!is_ascii_alphanumeric(&p2)) {
            let _v3 = error::invalid_argument(5);
            abort _v3
        };
        let _v4 = &p0.referral_code_to_addr;
        let _v5 = &p2;
        if (big_ordered_map::contains<string::String,address>(_v4, _v5)) {
            let _v6 = error::invalid_argument(1);
            abort _v6
        };
        let _v7 = &p0.addr_to_referrer_state;
        let _v8 = &p1;
        if (big_ordered_map::contains<address,ReferrerState>(_v7, _v8)) {
            let _v9 = &mut p0.addr_to_referrer_state;
            let _v10 = &p1;
            _v0 = big_ordered_map::remove<address,ReferrerState>(_v9, _v10)
        } else {
            let _v11 = 0x1::vector::empty<string::String>();
            let _v12 = option::none<u64>();
            let _v13 = option::none<u64>();
            _v0 = ReferrerState::V1{codes: _v11, max_referral_codes: _v12, max_usage_per_referral_code: _v13, is_affiliate: false}
        };
        assert!(&_v0 is V1, 14566554180833181697);
        let ReferrerState::V1{codes: _v14, max_referral_codes: _v15, max_usage_per_referral_code: _v16, is_affiliate: _v17} = _v0;
        let _v18 = _v14;
        let _v19 = _v15;
        if (!p3) {
            let _v20;
            if (option::is_some<u64>(&_v19)) _v20 = *option::borrow<u64>(&_v19) else _v20 = 5;
            if (!(0x1::vector::length<string::String>(&_v18) < _v20)) {
                let _v21 = error::invalid_argument(8);
                abort _v21
            }
        };
        0x1::vector::push_back<string::String>(&mut _v18, p2);
        let _v22 = new_referral_code(p2);
        let _v23 = ReferrerState::V1{codes: _v18, max_referral_codes: _v19, max_usage_per_referral_code: _v16, is_affiliate: _v17};
        big_ordered_map::add<address,ReferrerState>(&mut p0.addr_to_referrer_state, p1, _v23);
        big_ordered_map::add<string::String,address>(&mut p0.referral_code_to_addr, p2, p1);
        big_ordered_map::add<string::String,ReferralCode>(&mut p0.referral_code_to_state, p2, _v22);
        event::emit<ReferralCodeRegisteredEvent>(ReferralCodeRegisteredEvent::V1{referrer_addr: p1, referral_code: p2, referrer_state: _v23});
    }
    friend fun set_max_referral_codes_for_address(p0: &mut Referrals, p1: address, p2: u64) {
        let _v0;
        let _v1 = &p0.addr_to_referrer_state;
        let _v2 = &p1;
        if (big_ordered_map::contains<address,ReferrerState>(_v1, _v2)) {
            let _v3 = &mut p0.addr_to_referrer_state;
            let _v4 = &p1;
            _v0 = big_ordered_map::remove<address,ReferrerState>(_v3, _v4)
        } else {
            let _v5 = 0x1::vector::empty<string::String>();
            let _v6 = option::none<u64>();
            let _v7 = option::none<u64>();
            _v0 = ReferrerState::V1{codes: _v5, max_referral_codes: _v6, max_usage_per_referral_code: _v7, is_affiliate: false}
        };
        let _v8 = option::some<u64>(p2);
        let _v9 = &mut (&mut _v0).max_referral_codes;
        *_v9 = _v8;
        big_ordered_map::add<address,ReferrerState>(&mut p0.addr_to_referrer_state, p1, _v0);
    }
    friend fun set_max_usage_per_referral_code_for_address(p0: &mut Referrals, p1: address, p2: u64) {
        let _v0;
        let _v1 = &p0.addr_to_referrer_state;
        let _v2 = &p1;
        if (big_ordered_map::contains<address,ReferrerState>(_v1, _v2)) {
            let _v3 = &mut p0.addr_to_referrer_state;
            let _v4 = &p1;
            _v0 = big_ordered_map::remove<address,ReferrerState>(_v3, _v4)
        } else {
            let _v5 = 0x1::vector::empty<string::String>();
            let _v6 = option::none<u64>();
            let _v7 = option::none<u64>();
            _v0 = ReferrerState::V1{codes: _v5, max_referral_codes: _v6, max_usage_per_referral_code: _v7, is_affiliate: false}
        };
        let _v8 = option::some<u64>(p2);
        let _v9 = &mut (&mut _v0).max_usage_per_referral_code;
        *_v9 = _v8;
        big_ordered_map::add<address,ReferrerState>(&mut p0.addr_to_referrer_state, p1, _v0);
    }
}
