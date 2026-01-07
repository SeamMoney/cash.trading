module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::decibel_time {
    use 0x1::option;
    use 0x1::timestamp;
    use 0x1::signer;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::price_management;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::async_matching_engine;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::admin_apis;
    enum TimeOverride has key {
        V1 {
            time_us: option::Option<u64>,
        }
    }
    friend fun now_microseconds(): u64
        acquires TimeOverride
    {
        if (exists<TimeOverride>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844)) {
            let _v0 = borrow_global<TimeOverride>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
            if (option::is_some<u64>(&_v0.time_us)) return *option::borrow<u64>(&_v0.time_us)
        };
        timestamp::now_microseconds()
    }
    public fun now_seconds(): u64
        acquires TimeOverride
    {
        now_microseconds() / 1000000
    }
    fun init_module(p0: &signer) {
        assert!(signer::address_of(p0) == @0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844, 0);
        let _v0 = TimeOverride::V1{time_us: option::none<u64>()};
        move_to<TimeOverride>(p0, _v0);
    }
    friend fun increment_time(p0: &signer)
        acquires TimeOverride
    {
        assert!(signer::address_of(p0) == @0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844, 0);
        let _v0 = option::some<u64>(now_microseconds() + 1);
        let _v1 = &mut borrow_global_mut<TimeOverride>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).time_us;
        *_v1 = _v0;
    }
}
