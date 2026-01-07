module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::decibel_time {
    use 0x1::option;
    use 0x1::timestamp;
    use 0x1::signer;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::price_management;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::async_matching_engine;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::admin_apis;
    enum TimeOverride has key {
        V1 {
            time_us: option::Option<u64>,
        }
    }
    friend fun now_microseconds(): u64
        acquires TimeOverride
    {
        if (exists<TimeOverride>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75)) {
            let _v0 = borrow_global<TimeOverride>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
            if (option::is_some<u64>(&_v0.time_us)) return *option::borrow<u64>(&_v0.time_us)
        };
        timestamp::now_microseconds()
    }
    public fun now_seconds(): u64
        acquires TimeOverride
    {
        now_microseconds() / 1000000
    }
    friend fun increment_time(p0: &signer)
        acquires TimeOverride
    {
        assert!(signer::address_of(p0) == @0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75, 0);
        let _v0 = option::some<u64>(now_microseconds() + 1);
        let _v1 = &mut borrow_global_mut<TimeOverride>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).time_us;
        *_v1 = _v0;
    }
    fun init_module(p0: &signer) {
        assert!(signer::address_of(p0) == @0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75, 0);
        let _v0 = TimeOverride::V1{time_us: option::none<u64>()};
        move_to<TimeOverride>(p0, _v0);
    }
}
