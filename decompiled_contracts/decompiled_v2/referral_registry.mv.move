module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::referral_registry {
    use 0x1::big_ordered_map;
    use 0x1::string;
    use 0x1::option;
    use 0x1::error;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::trading_fees_manager;
    struct Referrals has store {
        addr_to_referral_code: big_ordered_map::BigOrderedMap<address, string::String>,
        referral_code_to_addr: big_ordered_map::BigOrderedMap<string::String, address>,
        addr_to_referrer_addr: big_ordered_map::BigOrderedMap<address, address>,
    }
    friend fun initialize(): Referrals {
        let _v0 = big_ordered_map::new_with_config<address,string::String>(8u16, 8u16, true);
        let _v1 = big_ordered_map::new_with_config<string::String,address>(8u16, 8u16, true);
        let _v2 = big_ordered_map::new_with_config<address,address>(8u16, 8u16, true);
        Referrals{addr_to_referral_code: _v0, referral_code_to_addr: _v1, addr_to_referrer_addr: _v2}
    }
    friend fun get_referral_code(p0: &Referrals, p1: address): option::Option<string::String> {
        let _v0 = &p0.addr_to_referral_code;
        let _v1 = &p1;
        big_ordered_map::get<address,string::String>(_v0, _v1)
    }
    friend fun get_referrer_addr(p0: &Referrals, p1: address): option::Option<address> {
        let _v0 = &p0.addr_to_referrer_addr;
        let _v1 = &p1;
        big_ordered_map::get<address,address>(_v0, _v1)
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
    friend fun register_referral_code(p0: &mut Referrals, p1: address, p2: string::String) {
        let _v0;
        if (string::length(&p2) > 0) _v0 = string::length(&p2) <= 32 else _v0 = false;
        if (!_v0) {
            let _v1 = error::invalid_argument(4);
            abort _v1
        };
        if (!is_ascii_alphanumeric(&p2)) {
            let _v2 = error::invalid_argument(5);
            abort _v2
        };
        let _v3 = &p0.referral_code_to_addr;
        let _v4 = &p2;
        if (big_ordered_map::contains<string::String,address>(_v3, _v4)) {
            let _v5 = error::invalid_argument(1);
            abort _v5
        };
        let _v6 = &p0.addr_to_referral_code;
        let _v7 = &p1;
        if (big_ordered_map::contains<address,string::String>(_v6, _v7)) {
            let _v8 = error::invalid_argument(2);
            abort _v8
        };
        big_ordered_map::add<address,string::String>(&mut p0.addr_to_referral_code, p1, p2);
        big_ordered_map::add<string::String,address>(&mut p0.referral_code_to_addr, p2, p1);
    }
    friend fun register_referrer(p0: &mut Referrals, p1: address, p2: string::String) {
        let _v0 = &p0.addr_to_referrer_addr;
        let _v1 = &p1;
        if (big_ordered_map::contains<address,address>(_v0, _v1)) {
            let _v2 = error::invalid_argument(2);
            abort _v2
        };
        let _v3 = &p0.referral_code_to_addr;
        let _v4 = &p2;
        let _v5 = big_ordered_map::borrow<string::String,address>(_v3, _v4);
        if (!(*_v5 != p1)) {
            let _v6 = error::invalid_argument(6);
            abort _v6
        };
        let _v7 = &mut p0.addr_to_referrer_addr;
        let _v8 = *_v5;
        big_ordered_map::add<address,address>(_v7, p1, _v8);
    }
}
