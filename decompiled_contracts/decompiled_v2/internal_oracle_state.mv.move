module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::internal_oracle_state {
    use 0x1::object;
    use 0x1::signer;
    use 0x1::timestamp;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::oracle;
    struct InternalSourceIdentifier has copy, drop, store {
        object_address: address,
    }
    enum InternalSourceState has key {
        V1 {
            spot_price: u64,
            update_time: u64,
            source_ref: object::ExtendRef,
        }
    }
    public fun create_new_internal_source(p0: &signer, p1: u64): InternalSourceIdentifier {
        let _v0 = object::create_object(signer::address_of(p0));
        let _v1 = object::generate_extend_ref(&_v0);
        let _v2 = object::generate_signer_for_extending(&_v1);
        let _v3 = &_v2;
        let _v4 = timestamp::now_seconds();
        let _v5 = InternalSourceState::V1{spot_price: p1, update_time: _v4, source_ref: _v1};
        move_to<InternalSourceState>(_v3, _v5);
        InternalSourceIdentifier{object_address: signer::address_of(&_v2)}
    }
    friend fun get_internal_source_data(p0: &InternalSourceIdentifier): (u64, u64)
        acquires InternalSourceState
    {
        let _v0 = *&p0.object_address;
        let _v1 = borrow_global<InternalSourceState>(_v0);
        let _v2 = *&_v1.spot_price;
        let _v3 = *&_v1.update_time;
        (_v2, _v3)
    }
    friend fun update_internal_source_price(p0: &InternalSourceIdentifier, p1: u64)
        acquires InternalSourceState
    {
        let _v0 = *&p0.object_address;
        let _v1 = borrow_global_mut<InternalSourceState>(_v0);
        let _v2 = timestamp::now_seconds();
        let _v3 = &mut _v1.spot_price;
        *_v3 = p1;
        let _v4 = &mut _v1.update_time;
        *_v4 = _v2;
    }
}
