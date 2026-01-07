module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_engine_api {
    use 0x1::string;
    use 0x1::signer;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::trading_fees_manager;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::builder_code_registry;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_engine;
    enum RestrictedPerpApi has drop, store {
        V1 {
            init_user_if_new_f: |&signer, address| has copy + drop + store,
        }
    }
    public fun register_referral_code(p0: &signer, p1: string::String) {
        trading_fees_manager::register_referral_code(signer::address_of(p0), p1);
    }
    public fun register_referrer(p0: &signer, p1: string::String) {
        trading_fees_manager::register_referrer(signer::address_of(p0), p1);
    }
    public fun approve_max_fee(p0: &signer, p1: address, p2: u64) {
        builder_code_registry::approve_max_fee(p0, p1, p2);
    }
    public fun new_builder_code(p0: address, p1: u64): builder_code_registry::BuilderCode {
        builder_code_registry::new_builder_code(p0, p1)
    }
    public fun revoke_max_fee(p0: &signer, p1: address) {
        builder_code_registry::revoke_max_fee(p0, p1);
    }
    public fun init_user_if_new(p0: &RestrictedPerpApi, p1: &signer, p2: address) {
        let _v0 = *&p0.init_user_if_new_f;
        _v0(p1, p2);
    }
    public fun get_restricted_perp_api(p0: &signer): RestrictedPerpApi {
        assert!(signer::address_of(p0) == @0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844, 1);
        RestrictedPerpApi::V1{init_user_if_new_f: |arg0,arg1| perp_engine::init_user_if_new(arg0, arg1)}
    }
}
