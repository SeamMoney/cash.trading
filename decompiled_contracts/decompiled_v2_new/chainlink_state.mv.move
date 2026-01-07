module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::chainlink_state {
    use 0x1::table;
    use 0x1::signer;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::math;
    use 0x1::vector;
    use 0xc68769ae9efe2d02f10bc5baed793cfe0fe780c41e428d087d5d61286448090::verifier;
    struct PriceData has copy, drop, store {
        price: u256,
        timestamp: u32,
    }
    struct PriceStore has key {
        feeds: table::Table<vector<u8>, PriceData>,
    }
    fun initialize(p0: &signer) {
        assert!(signer::address_of(p0) == @0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844, 5);
        if (!exists<PriceStore>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844)) {
            let _v0 = PriceStore{feeds: table::new<vector<u8>,PriceData>()};
            move_to<PriceStore>(p0, _v0);
            return ()
        };
    }
    fun init_module(p0: &signer) {
        initialize(p0);
    }
    public fun assert_initialized() {
        assert!(exists<PriceStore>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844), 3);
    }
    public fun convert_price(p0: vector<u8>, p1: u8, p2: i8, p3: u8): (u64, u32)
        acquires PriceStore
    {
        let _v0;
        let (_v1,_v2) = get_latest_price(p0);
        let _v3 = _v1 as u128;
        let _v4 = (p3 as i8) + p2;
        let _v5 = p1 as i8;
        p2 = _v4 - _v5;
        if (p2 < 0i8) {
            let _v6 = math::new_precision((-p2) as u8);
            _v0 = math::get_decimals_multiplier(&_v6) as u128;
            _v3 = _v3 / _v0
        } else if (p2 > 0i8) {
            let _v7 = math::new_precision(p2 as u8);
            _v0 = math::get_decimals_multiplier(&_v7) as u128;
            _v3 = _v3 * _v0
        };
        (_v3 as u64, _v2)
    }
    public fun get_latest_price(p0: vector<u8>): (u256, u32)
        acquires PriceStore
    {
        let _v0 = table::borrow<vector<u8>,PriceData>(&borrow_global<PriceStore>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844).feeds, p0);
        let _v1 = *&_v0.price;
        let _v2 = *&_v0.timestamp;
        (_v1, _v2)
    }
    public fun get_converted_price(p0: vector<u8>, p1: i8, p2: u8): u64
        acquires PriceStore
    {
        let (_v0,_v1) = convert_price(p0, 18u8, p1, p2);
        _v0
    }
    public fun is_price_negative(p0: u256): bool {
        p0 & 3138550867693340381917894711603833208051177722232017256448u256 != 0u256
    }
    fun parse_v3_report(p0: &vector<u8>): (vector<u8>, PriceData) {
        let _v0 = vector::slice<u8>(p0, 0, 32);
        let _v1 = read_u32(p0, 64);
        let _v2 = PriceData{price: read_u256(p0, 192), timestamp: _v1};
        (_v0, _v2)
    }
    fun read_u32(p0: &vector<u8>, p1: u64): u32 {
        p1 = p1 + 28;
        let _v0 = ((*vector::borrow<u8>(p0, p1)) as u32) << 24u8;
        let _v1 = p1 + 1;
        let _v2 = ((*vector::borrow<u8>(p0, _v1)) as u32) << 16u8;
        let _v3 = p1 + 2;
        let _v4 = ((*vector::borrow<u8>(p0, _v3)) as u32) << 8u8;
        let _v5 = p1 + 3;
        let _v6 = (*vector::borrow<u8>(p0, _v5)) as u32;
        _v0 | _v2 | _v4 | _v6
    }
    fun read_u256(p0: &vector<u8>, p1: u64): u256 {
        let _v0 = 0u256;
        p1 = p1 + 8;
        let _v1 = 0;
        while (_v1 < 24) {
            let _v2 = _v0 << 8u8;
            let _v3 = p1 + _v1;
            let _v4 = (*vector::borrow<u8>(p0, _v3)) as u256;
            _v0 = _v2 | _v4;
            _v1 = _v1 + 1;
            continue
        };
        _v0
    }
    public entry fun verify_and_store_multiple_prices(p0: &signer, p1: vector<vector<u8>>)
        acquires PriceStore
    {
        assert_initialized();
        let _v0 = borrow_global_mut<PriceStore>(@0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844);
        while (!vector::is_empty<vector<u8>>(&p1)) {
            let _v1 = vector::pop_back<vector<u8>>(&mut p1);
            let _v2 = verifier::verify(p0, _v1);
            let (_v3,_v4) = parse_v3_report(&_v2);
            let _v5 = _v4;
            _v1 = _v3;
            if (!table::contains<vector<u8>,PriceData>(&_v0.feeds, _v1)) {
                table::add<vector<u8>,PriceData>(&mut _v0.feeds, _v1, _v5);
                continue
            };
            let _v6 = *&table::borrow<vector<u8>,PriceData>(&_v0.feeds, _v1).timestamp;
            let _v7 = *&(&_v5).timestamp;
            if (!(_v6 < _v7)) continue;
            table::upsert<vector<u8>,PriceData>(&mut _v0.feeds, _v1, _v5);
            continue
        };
    }
    public entry fun verify_and_store_single_price(p0: &signer, p1: vector<u8>)
        acquires PriceStore
    {
        let _v0 = vector::empty<vector<u8>>();
        vector::push_back<vector<u8>>(&mut _v0, p1);
        verify_and_store_multiple_prices(p0, _v0);
    }
}
