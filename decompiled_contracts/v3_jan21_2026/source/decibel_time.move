module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::decibel_time {
    use 0x1::timestamp;
    use 0x1::signer;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::admin_apis;
    enum TimeOverride has key {
        Offset {
            time_offset_microseconds: u64,
        }
    }
    public fun now_microseconds(): u64
        acquires TimeOverride
    {
        if (exists<TimeOverride>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88)) {
            let _v0 = borrow_global<TimeOverride>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
            let _v1 = timestamp::now_microseconds();
            let _v2 = *&_v0.time_offset_microseconds;
            return _v1 + _v2
        };
        timestamp::now_microseconds()
    }
    public fun now_seconds(): u64
        acquires TimeOverride
    {
        now_microseconds() / 1000000
    }
    fun init_module(p0: &signer) {
        assert!(signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88, 0);
        let _v0 = TimeOverride::Offset{time_offset_microseconds: 0};
        move_to<TimeOverride>(p0, _v0);
    }
    friend fun increment_time(p0: &signer, p1: u64)
        acquires TimeOverride
    {
        assert!(signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88, 0);
        let _v0 = &mut borrow_global_mut<TimeOverride>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).time_offset_microseconds;
        *_v0 = *_v0 + p1;
    }
}
