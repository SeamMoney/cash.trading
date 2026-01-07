module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine {
    use 0x1::object;
    use 0x1::big_ordered_map;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market;
    use 0x1::fungible_asset;
    use 0x1::string;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::accounts_collateral;
    use 0x1::event;
    use 0x1::signer;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_positions;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_book_types;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::clearinghouse_perp;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::market_types;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine_types;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::single_order_types;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::async_matching_engine;
    use 0x1::option;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::builder_code_registry;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market_config;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::price_management;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::oracle;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::pending_order_tracker;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::open_interest_tracker;
    use 0x1::vector;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::position_tp_sl;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::math;
    use 0x1::error;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::position_tp_sl_tracker;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::tp_sl_utils;
    use 0x1::bcs;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::adl_tracker;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::backstop_liquidator_profit_tracker;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::chainlink_state;
    use 0x7e783b349d3e89cf5931af376ebeadbfab855b3fa239b7ada8f5a92fbea6b387::pyth;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::admin_apis;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine_api;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::public_apis;
    enum Global has key {
        V1 {
            extend_ref: object::ExtendRef,
            market_refs: big_ordered_map::BigOrderedMap<object::Object<perp_market::PerpMarket>, object::ExtendRef>,
            is_exchange_open: bool,
        }
    }
    struct DexRegistrationEvent has drop, store {
        dex: object::Object<object::ObjectCore>,
        collateral_asset: object::Object<fungible_asset::Metadata>,
        collateral_balance_decimals: u8,
    }
    struct MarketRegistrationEvent has drop, store {
        market: object::Object<perp_market::PerpMarket>,
        name: string::String,
        sz_decimals: u8,
        max_leverage: u8,
        max_open_interest: u64,
        min_size: u64,
        lot_size: u64,
        ticker_size: u64,
    }
    struct MarketUpdateEvent has drop, store {
        market: object::Object<perp_market::PerpMarket>,
        name: string::String,
        sz_decimals: u8,
        max_leverage: u8,
        max_open_interest: u64,
        min_size: u64,
        lot_size: u64,
        ticker_size: u64,
    }
    enum PerpOrderCancelationReason {
        MaxOpenInterestViolation,
    }
    friend fun is_exchange_open(): bool
        acquires Global
    {
        *&borrow_global<Global>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).is_exchange_open
    }
    public fun collateral_balance_decimals(): u8 {
        let _v0 = accounts_collateral::collateral_balance_precision();
        math::get_decimals(&_v0)
    }
    friend fun initialize(p0: &signer, p1: object::Object<fungible_asset::Metadata>, p2: u8, p3: address) {
        let _v0 = object::create_named_object(p0, vector[71u8, 108u8, 111u8, 98u8, 97u8, 108u8, 80u8, 101u8, 114u8, 112u8, 69u8, 110u8, 103u8, 105u8, 110u8, 101u8]);
        let _v1 = object::generate_extend_ref(&_v0);
        if (exists<Global>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75)) abort 2;
        let _v2 = big_ordered_map::new<object::Object<perp_market::PerpMarket>,object::ExtendRef>();
        let _v3 = Global::V1{extend_ref: _v1, market_refs: _v2, is_exchange_open: true};
        move_to<Global>(p0, _v3);
        accounts_collateral::initialize(p0, p1, p2, p3);
        event::emit<DexRegistrationEvent>(DexRegistrationEvent{dex: object::object_from_constructor_ref<object::ObjectCore>(&_v0), collateral_asset: p1, collateral_balance_decimals: p2});
    }
    public fun deposit(p0: &signer, p1: fungible_asset::FungibleAsset)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = &p1;
        assert!(accounts_collateral::is_asset_supported(fungible_asset::metadata_from_asset(_v0)), 9);
        assert!(fungible_asset::amount(_v0) > 0, 8);
        perp_positions::assert_user_initialized(signer::address_of(p0));
        accounts_collateral::deposit(p0, p1);
    }
    public fun cancel_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: order_book_types::OrderIdType)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = signer::address_of(p1);
        let _v1 = clearinghouse_perp::market_callbacks(p0);
        let _v2 = &_v1;
        let _v3 = perp_market::cancel_order(p0, _v0, p2, true, _v2);
        async_matching_engine::trigger_matching(p0, 5u32);
    }
    friend fun trigger_matching(p0: object::Object<perp_market::PerpMarket>, p1: u32)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        async_matching_engine::trigger_matching(p0, p1);
    }
    public fun cancel_bulk_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = clearinghouse_perp::market_callbacks(p0);
        let _v1 = &_v0;
        perp_market::cancel_bulk_order(p0, p1, _v1);
    }
    public fun place_bulk_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: u64, p3: vector<u64>, p4: vector<u64>, p5: vector<u64>, p6: vector<u64>, p7: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderIdType
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = perp_engine_types::new_bulk_order_metadata(p7);
        let _v1 = signer::address_of(p1);
        let _v2 = clearinghouse_perp::market_callbacks(p0);
        let _v3 = &_v2;
        let _v4 = perp_market::place_bulk_order(p0, _v1, p2, p3, p4, p5, p6, _v0, _v3);
        trigger_matching(p0, 2u32);
        _v4
    }
    public fun place_market_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: u64, p3: bool, p4: bool, p5: option::Option<string::String>, p6: option::Option<u64>, p7: option::Option<u64>, p8: option::Option<u64>, p9: option::Option<u64>, p10: option::Option<u64>, p11: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderIdType
        acquires Global
    {
        let _v0;
        assert!(is_exchange_open(), 5);
        if (p3) _v0 = 9223372036854775807 else _v0 = 1;
        perp_market_config::validate_price_and_size(p0, _v0, p2, false);
        let _v1 = signer::address_of(p1);
        let _v2 = order_book_types::immediate_or_cancel();
        let _v3 = option::none<order_book_types::OrderIdType>();
        async_matching_engine::place_order(p0, _v1, _v0, p2, p3, _v2, p4, _v3, p5, p6, p7, p8, p9, p10, p11)
    }
    public fun place_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: u64, p3: u64, p4: bool, p5: order_book_types::TimeInForce, p6: bool, p7: option::Option<string::String>, p8: option::Option<u64>, p9: option::Option<u64>, p10: option::Option<u64>, p11: option::Option<u64>, p12: option::Option<u64>, p13: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderIdType
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        perp_market_config::validate_price_and_size(p0, p2, p3, false);
        let _v0 = signer::address_of(p1);
        let _v1 = option::none<order_book_types::OrderIdType>();
        async_matching_engine::place_order(p0, _v0, p2, p3, p4, p5, p6, _v1, p7, p8, p9, p10, p11, p12, p13)
    }
    public fun cancel_client_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: string::String)
        acquires Global
    {
        let _v0 = p0;
        assert!(is_exchange_open(), 5);
        let _v1 = clearinghouse_perp::market_callbacks(_v0);
        let _v2 = &_v1;
        perp_market::cancel_client_order(_v0, p1, p2, _v2);
        async_matching_engine::trigger_matching(p0, 5u32);
    }
    public fun get_oracle_price(p0: object::Object<perp_market::PerpMarket>): u64 {
        price_management::get_oracle_price(p0)
    }
    public fun primary_asset_metadata(): object::Object<fungible_asset::Metadata> {
        accounts_collateral::primary_asset_metadata()
    }
    friend fun delist_market(p0: object::Object<perp_market::PerpMarket>, p1: option::Option<string::String>) {
        perp_market_config::delist_market(p0, p1);
    }
    public fun get_market_mode(p0: object::Object<perp_market::PerpMarket>): perp_market_config::MarketMode {
        perp_market_config::get_market_mode(p0)
    }
    public fun get_oracle_source(p0: object::Object<perp_market::PerpMarket>): oracle::OracleSource {
        perp_market_config::get_oracle_source(p0)
    }
    public fun get_mark_and_oracle_price(p0: object::Object<perp_market::PerpMarket>): (u64, u64) {
        let (_v0,_v1) = price_management::get_mark_and_oracle_price(p0);
        (_v0, _v1)
    }
    public fun get_mark_price(p0: object::Object<perp_market::PerpMarket>): u64 {
        price_management::get_mark_price(p0)
    }
    public fun backstop_liquidator(): address {
        accounts_collateral::backstop_liquidator()
    }
    public fun market_max_leverage(p0: object::Object<perp_market::PerpMarket>): u8 {
        perp_market_config::get_max_leverage(p0)
    }
    public fun configure_user_settings_for_market(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: u8)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        perp_positions::configure_user_settings_for_market(p0, p1, p2, p3);
    }
    public fun get_position_is_long(p0: address, p1: object::Object<perp_market::PerpMarket>): bool {
        perp_positions::get_position_is_long(p0, p1)
    }
    public fun get_position_size(p0: address, p1: object::Object<perp_market::PerpMarket>): u64 {
        perp_positions::get_position_size(p0, p1)
    }
    public fun has_any_assets_or_positions(p0: address): bool {
        if (accounts_collateral::has_any_assets_or_positions(p0)) return true;
        pending_order_tracker::has_any_pending_orders(p0)
    }
    public fun has_position(p0: address, p1: object::Object<perp_market::PerpMarket>): bool {
        perp_positions::has_position(p0, p1)
    }
    #[persistent]
    friend fun init_user_if_new(p0: &signer, p1: address) {
        perp_positions::init_user_if_new(p0, p1);
    }
    public fun is_position_isolated(p0: address, p1: object::Object<perp_market::PerpMarket>): bool {
        perp_positions::is_position_isolated(p0, p1)
    }
    public fun is_position_liquidatable(p0: address, p1: object::Object<perp_market::PerpMarket>): bool {
        accounts_collateral::is_position_liquidatable(p0, p1, false)
    }
    public fun transfer_margin_to_isolated_position(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: object::Object<fungible_asset::Metadata>, p4: u64)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        assert!(p4 > 0, 8);
        assert!(accounts_collateral::is_asset_supported(p3), 9);
        accounts_collateral::transfer_margin_fungible_to_isolated_position(signer::address_of(p0), p1, p2, p4);
    }
    public fun deposit_to_isolated_position_margin(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: fungible_asset::FungibleAsset)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = &p2;
        assert!(accounts_collateral::is_asset_supported(fungible_asset::metadata_from_asset(_v0)), 9);
        assert!(fungible_asset::amount(_v0) > 0, 8);
        perp_positions::assert_user_initialized(signer::address_of(p0));
        accounts_collateral::deposit_to_isolated_position_margin(p0, p1, p2);
    }
    public fun get_account_balance_fungible(p0: address): u64 {
        accounts_collateral::get_account_balance_fungible(p0)
    }
    public fun get_account_net_asset_value_fungible(p0: address, p1: bool): i64 {
        accounts_collateral::get_account_net_asset_value_fungible(p0, p1)
    }
    public fun get_isolated_position_margin(p0: address, p1: object::Object<perp_market::PerpMarket>): u64 {
        accounts_collateral::get_isolated_position_margin(p0, p1)
    }
    public fun withdraw_fungible(p0: &signer, p1: object::Object<fungible_asset::Metadata>, p2: u64): fungible_asset::FungibleAsset
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        assert!(p2 > 0, 8);
        assert!(accounts_collateral::is_asset_supported(p1), 9);
        let _v0 = accounts_collateral::withdraw_fungible(p0, p1, p2);
        let _v1 = fungible_asset::metadata_from_asset(&_v0);
        assert!(p1 == _v1, 7);
        _v0
    }
    public fun get_current_open_interest(p0: object::Object<perp_market::PerpMarket>): u64 {
        open_interest_tracker::get_current_open_interest(p0)
    }
    public fun get_max_notional_open_interest(p0: object::Object<perp_market::PerpMarket>): u64 {
        open_interest_tracker::get_max_notional_open_interest(p0)
    }
    friend fun close_delisted_position(p0: address, p1: object::Object<perp_market::PerpMarket>)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        assert!(perp_market_config::is_market_delisted(p1), 22);
        clearinghouse_perp::close_delisted_position(p0, p1);
    }
    public fun cancel_twap_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: order_book_types::OrderIdType)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        async_matching_engine::cancel_twap_order(p0, p1, p2);
    }
    friend fun drain_async_queue(p0: object::Object<perp_market::PerpMarket>)
        acquires Global
    {
        if (is_exchange_open()) abort 4;
        async_matching_engine::drain_async_queue(p0);
    }
    friend fun liquidate_position(p0: address, p1: object::Object<perp_market::PerpMarket>)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        async_matching_engine::liquidate_position(p0, p1);
    }
    public fun place_twap_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: u64, p3: bool, p4: bool, p5: u64, p6: u64, p7: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderIdType
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        perp_positions::assert_user_initialized(signer::address_of(p1));
        async_matching_engine::place_twap_order(p0, p1, p2, p3, p4, p5, p6, p7)
    }
    public fun cancel_orders(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: vector<order_book_types::OrderIdType>)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = p2;
        vector::reverse<order_book_types::OrderIdType>(&mut _v0);
        let _v1 = _v0;
        let _v2 = vector::length<order_book_types::OrderIdType>(&_v1);
        while (_v2 > 0) {
            let _v3 = vector::pop_back<order_book_types::OrderIdType>(&mut _v1);
            let _v4 = signer::address_of(p1);
            let _v5 = clearinghouse_perp::market_callbacks(p0);
            let _v6 = &_v5;
            let _v7 = perp_market::cancel_order(p0, _v4, _v3, true, _v6);
            _v2 = _v2 - 1;
            continue
        };
        vector::destroy_empty<order_book_types::OrderIdType>(_v1);
        async_matching_engine::trigger_matching(p0, 5u32);
    }
    public fun cancel_tp_sl_order_for_position(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: order_book_types::OrderIdType)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        position_tp_sl::cancel_tp_sl(signer::address_of(p1), p0, p2);
    }
    friend fun delist_market_with_mark_price(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: option::Option<string::String>) {
        perp_market_config::delist_market(p0, p2);
        price_management::override_mark_price(p0, p1);
    }
    friend fun get_and_check_oracle_price(p0: object::Object<perp_market::PerpMarket>, p1: math::Precision): u64 {
        let _v0 = perp_market_config::get_oracle_data(p0, p1);
        if (oracle::is_status_invalid(&_v0)) {
            let _v1 = vector::empty<address>();
            let _v2 = option::some<string::String>(string::utf8(vector[79u8, 114u8, 97u8, 99u8, 108u8, 101u8, 32u8, 105u8, 110u8, 118u8, 97u8, 108u8, 105u8, 100u8]));
            perp_market_config::set_reduce_only(p0, _v1, _v2);
            return price_management::get_book_mid_ema_px(p0)
        };
        if (oracle::is_status_down(&_v0)) {
            let _v3 = vector::empty<address>();
            let _v4 = option::some<string::String>(string::utf8(vector[79u8, 114u8, 97u8, 99u8, 108u8, 101u8, 32u8, 115u8, 116u8, 97u8, 108u8, 101u8]));
            perp_market_config::set_reduce_only(p0, _v3, _v4);
            return price_management::get_book_mid_px(p0)
        };
        oracle::get_price(&_v0)
    }
    public fun get_max_open_interest_delta(p0: object::Object<perp_market::PerpMarket>): u64 {
        open_interest_tracker::get_max_open_interest_delta_for_market(p0)
    }
    public fun get_position_avg_price(p0: address, p1: object::Object<perp_market::PerpMarket>): u64 {
        let _v0;
        let _v1;
        let _v2 = perp_positions::get_position_entry_px_times_size_sum(p0, p1);
        let _v3 = perp_positions::get_position_size(p0, p1);
        if (_v3 == 0) _v1 = _v2 == 0u128 else _v1 = false;
        loop {
            if (!_v1) {
                let _v4 = _v2;
                let _v5 = _v3 as u128;
                if (!perp_positions::get_position_is_long(p0, p1)) {
                    _v0 = _v4 / _v5;
                    break
                };
                let _v6 = _v4;
                let _v7 = _v5;
                if (!(_v6 == 0u128)) {
                    _v0 = (_v6 - 1u128) / _v7 + 1u128;
                    break
                };
                if (!(_v7 != 0u128)) {
                    let _v8 = error::invalid_argument(4);
                    abort _v8
                };
                _v0 = 0u128;
                break
            };
            return 0
        };
        _v0 as u64
    }
    public fun get_position_entry_price_times_size_sum(p0: address, p1: object::Object<perp_market::PerpMarket>): u128 {
        perp_positions::get_position_entry_px_times_size_sum(p0, p1)
    }
    public fun get_remaining_size_for_order(p0: object::Object<perp_market::PerpMarket>, p1: u128): u64 {
        let _v0 = order_book_types::new_order_id_type(p1);
        perp_market::get_remaining_size(p0, _v0)
    }
    public fun is_market_open(p0: object::Object<perp_market::PerpMarket>): bool {
        perp_market_config::is_open(p0)
    }
    public fun is_supported_collateral(p0: object::Object<fungible_asset::Metadata>): bool {
        accounts_collateral::is_asset_supported(p0)
    }
    public fun list_markets(): vector<address>
        acquires Global
    {
        let _v0 = vector::empty<address>();
        let _v1 = &borrow_global<Global>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).market_refs;
        let _v2 = big_ordered_map::is_empty<object::Object<perp_market::PerpMarket>,object::ExtendRef>(_v1);
        'l0: loop {
            if (!_v2) {
                let (_v3,_v4) = big_ordered_map::borrow_front<object::Object<perp_market::PerpMarket>,object::ExtendRef>(_v1);
                let _v5 = _v3;
                loop {
                    let _v6 = &mut _v0;
                    let _v7 = object::object_address<perp_market::PerpMarket>(&_v5);
                    vector::push_back<address>(_v6, _v7);
                    let _v8 = &_v5;
                    let _v9 = big_ordered_map::next_key<object::Object<perp_market::PerpMarket>,object::ExtendRef>(_v1, _v8);
                    if (!option::is_some<object::Object<perp_market::PerpMarket>>(&_v9)) break 'l0;
                    _v5 = option::destroy_some<object::Object<perp_market::PerpMarket>>(_v9);
                    continue
                }
            };
            return _v0
        };
        _v0
    }
    public fun market_lot_size(p0: object::Object<perp_market::PerpMarket>): u64 {
        perp_market_config::get_lot_size(p0)
    }
    public fun market_min_size(p0: object::Object<perp_market::PerpMarket>): u64 {
        perp_market_config::get_min_size(p0)
    }
    public fun market_name(p0: object::Object<perp_market::PerpMarket>): string::String {
        perp_market_config::get_name(p0)
    }
    public fun market_sz_decimals(p0: object::Object<perp_market::PerpMarket>): u8 {
        perp_market_config::get_sz_decimals(p0)
    }
    public fun market_ticker_size(p0: object::Object<perp_market::PerpMarket>): u64 {
        perp_market_config::get_ticker_size(p0)
    }
    public entry fun migrate_position_tp_sl_tracker(p0: address, p1: u64)
        acquires Global
    {
        assert!(exists<Global>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 3);
        let _v0 = &borrow_global_mut<Global>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).market_refs;
        let _v1 = object::address_to_object<perp_market::PerpMarket>(p0);
        let _v2 = &_v1;
        let _v3 = object::generate_signer_for_extending(big_ordered_map::borrow<object::Object<perp_market::PerpMarket>,object::ExtendRef>(_v0, _v2));
        position_tp_sl_tracker::migrate_market(&_v3, _v1, p1);
    }
    public fun place_tp_sl_order_for_position(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: option::Option<u64>, p3: option::Option<u64>, p4: option::Option<u64>, p5: option::Option<u64>, p6: option::Option<u64>, p7: option::Option<u64>, p8: option::Option<builder_code_registry::BuilderCode>): (option::Option<order_book_types::OrderIdType>, option::Option<order_book_types::OrderIdType>)
        acquires Global
    {
        let _v0;
        assert!(is_exchange_open(), 5);
        perp_positions::assert_user_initialized(signer::address_of(p1));
        assert!(get_position_size(signer::address_of(p1), p0) > 0, 23);
        if (option::is_some<u64>(&p2)) _v0 = true else _v0 = option::is_some<u64>(&p5);
        assert!(_v0, 6);
        let _v1 = signer::address_of(p1);
        if (option::is_some<builder_code_registry::BuilderCode>(&p8)) {
            let _v2 = option::destroy_some<builder_code_registry::BuilderCode>(p8);
            let _v3 = &_v2;
            builder_code_registry::validate_builder_code(_v1, _v3)
        };
        let _v4 = process_tp_sl_order(p0, _v1, p2, p3, p4, true, p8);
        let _v5 = process_tp_sl_order(p0, _v1, p5, p6, p7, false, p8);
        (_v4, _v5)
    }
    fun process_tp_sl_order(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: option::Option<u64>, p3: option::Option<u64>, p4: option::Option<u64>, p5: bool, p6: option::Option<builder_code_registry::BuilderCode>): option::Option<order_book_types::OrderIdType> {
        let _v0 = option::is_some<u64>(&p2);
        loop {
            if (!_v0) {
                assert!(option::is_none<u64>(&p3), 6);
                if (option::is_none<u64>(&p4)) break;
                abort 6
            };
            let _v1 = option::destroy_some<u64>(p2);
            let _v2 = option::none<order_book_types::OrderIdType>();
            return option::some<order_book_types::OrderIdType>(tp_sl_utils::place_tp_sl_order_for_position_internal(p0, p1, _v1, p3, p4, p5, _v2, p6, true, false))
        };
        option::none<order_book_types::OrderIdType>()
    }
    friend fun refresh_liquidate_and_trigger(p0: object::Object<perp_market::PerpMarket>, p1: price_management::MarkPriceRefreshInput, p2: vector<address>, p3: bool)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        refresh_mark_price(p0, p1);
        let _v0 = p2;
        vector::reverse<address>(&mut _v0);
        let _v1 = _v0;
        let _v2 = vector::length<address>(&_v1);
        while (_v2 > 0) {
            async_matching_engine::liquidate_position_with_fill_limit(vector::pop_back<address>(&mut _v1), p0, 0u32);
            _v2 = _v2 - 1
        };
        vector::destroy_empty<address>(_v1);
        async_matching_engine::add_adl_to_pending(p0);
        if (p3) {
            _v2 = price_management::get_mark_price(p0);
            trigger_position_based_tp_sl(p0, _v2);
            async_matching_engine::trigger_price_based_conditional_orders(p0, _v2);
            async_matching_engine::trigger_twap_orders(p0);
            trigger_matching(p0, 5u32);
            return ()
        };
    }
    fun refresh_mark_price(p0: object::Object<perp_market::PerpMarket>, p1: price_management::MarkPriceRefreshInput) {
        let _v0 = accounts_collateral::collateral_balance_precision();
        let _v1 = get_and_check_oracle_price(p0, _v0);
        price_management::update_price(p0, _v1, p1);
    }
    friend fun trigger_position_based_tp_sl(p0: object::Object<perp_market::PerpMarket>, p1: u64) {
        trigger_position_based_tp_sl_internal(p0, p1, true);
        trigger_position_based_tp_sl_internal(p0, p1, false);
    }
    friend fun register_market_internal(p0: string::String, p1: u8, p2: u64, p3: u64, p4: u64, p5: u64, p6: u8, p7: bool, p8: oracle::OracleSource): object::Object<perp_market::PerpMarket>
        acquires Global
    {
        assert!(exists<Global>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 3);
        let _v0 = borrow_global_mut<Global>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
        let _v1 = object::generate_signer_for_extending(&_v0.extend_ref);
        let _v2 = &_v1;
        let _v3 = bcs::to_bytes<string::String>(&p0);
        let _v4 = object::create_named_object(_v2, _v3);
        let _v5 = object::generate_signer(&_v4);
        async_matching_engine::register_market(&_v5, p7);
        let _v6 = &_v5;
        let _v7 = &_v1;
        let _v8 = &_v5;
        let _v9 = market_types::new_market_config(false, true, 5);
        let _v10 = market_types::new_market<perp_engine_types::OrderMetadata>(_v7, _v8, _v9);
        perp_market::register_market(_v6, _v10);
        adl_tracker::initialize(&_v5);
        open_interest_tracker::register_open_interest_tracker(&_v5, p5);
        perp_market_config::register_market(&_v5, p0, p1, p2, p3, p4, p6, p8);
        position_tp_sl_tracker::register_market(&_v5);
        let _v11 = object::object_from_constructor_ref<perp_market::PerpMarket>(&_v4);
        let _v12 = &mut _v0.market_refs;
        let _v13 = object::generate_extend_ref(&_v4);
        big_ordered_map::add<object::Object<perp_market::PerpMarket>,object::ExtendRef>(_v12, _v11, _v13);
        let _v14 = &_v5;
        let _v15 = accounts_collateral::collateral_balance_precision();
        let _v16 = get_and_check_oracle_price(_v11, _v15);
        let _v17 = perp_market_config::get_size_multiplier(_v11);
        price_management::register_market(_v14, _v16, _v17, p6);
        backstop_liquidator_profit_tracker::initialize_market(_v11);
        event::emit<MarketRegistrationEvent>(MarketRegistrationEvent{market: _v11, name: p0, sz_decimals: p1, max_leverage: p6, max_open_interest: p5, min_size: p2, lot_size: p3, ticker_size: p4});
        _v11
    }
    friend fun register_market_with_composite_oracle_primary_chainlink(p0: string::String, p1: u8, p2: u64, p3: u64, p4: u64, p5: u64, p6: u8, p7: bool, p8: vector<u8>, p9: u64, p10: i8, p11: u64, p12: u64, p13: u64, p14: u8)
        acquires Global
    {
        let _v0 = oracle::new_chainlink_source(p8, p9, p10);
        let _v1 = object::generate_signer_for_extending(&borrow_global<Global>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).extend_ref);
        let _v2 = oracle::create_new_internal_oracle_source(&_v1, p11, p12);
        let _v3 = oracle::new_composite_oracle(_v0, _v2, p13, p14);
        let _v4 = register_market_internal(p0, p1, p2, p3, p4, p5, p6, p7, _v3);
    }
    friend fun register_market_with_composite_oracle_primary_pyth(p0: string::String, p1: u8, p2: u64, p3: u64, p4: u64, p5: u64, p6: u8, p7: bool, p8: vector<u8>, p9: u64, p10: u64, p11: i8, p12: u64, p13: u64, p14: u64, p15: u8)
        acquires Global
    {
        let _v0 = oracle::new_pyth_source(p8, p9, p10, p11);
        let _v1 = object::generate_signer_for_extending(&borrow_global<Global>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).extend_ref);
        let _v2 = oracle::create_new_internal_oracle_source(&_v1, p12, p13);
        let _v3 = oracle::new_composite_oracle(_v0, _v2, p14, p15);
        let _v4 = register_market_internal(p0, p1, p2, p3, p4, p5, p6, p7, _v3);
    }
    friend fun register_market_with_internal_oracle(p0: string::String, p1: u8, p2: u64, p3: u64, p4: u64, p5: u64, p6: u8, p7: bool, p8: u64, p9: u64)
        acquires Global
    {
        let _v0 = object::generate_signer_for_extending(&borrow_global<Global>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).extend_ref);
        let _v1 = oracle::new_single_oracle(oracle::create_new_internal_oracle_source(&_v0, p8, p9));
        let _v2 = register_market_internal(p0, p1, p2, p3, p4, p5, p6, p7, _v1);
    }
    friend fun register_market_with_pyth_oracle(p0: string::String, p1: u8, p2: u64, p3: u64, p4: u64, p5: u64, p6: u8, p7: bool, p8: vector<u8>, p9: u64, p10: u64, p11: i8)
        acquires Global
    {
        let _v0 = oracle::new_single_oracle(oracle::new_pyth_source(p8, p9, p10, p11));
        let _v1 = register_market_internal(p0, p1, p2, p3, p4, p5, p6, p7, _v0);
    }
    friend fun set_backstop_liquidator_high_watermark(p0: object::Object<perp_market::PerpMarket>, p1: i64) {
        backstop_liquidator_profit_tracker::set_realized_pnl_watermark(p0, p1);
    }
    friend fun set_global_exchange_open(p0: bool)
        acquires Global
    {
        let _v0 = &mut borrow_global_mut<Global>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).is_exchange_open;
        *_v0 = p0;
    }
    friend fun set_market_allowlist_only(p0: object::Object<perp_market::PerpMarket>, p1: vector<address>, p2: option::Option<string::String>) {
        perp_market_config::allowlist_only(p0, p1, p2);
    }
    friend fun set_market_halted(p0: object::Object<perp_market::PerpMarket>, p1: option::Option<string::String>) {
        perp_market_config::halt_market(p0, p1);
    }
    friend fun set_market_max_leverage(p0: object::Object<perp_market::PerpMarket>, p1: u8) {
        perp_market_config::set_max_leverage(p0, p1);
        let _v0 = perp_market_config::get_name(p0);
        let _v1 = perp_market_config::get_sz_decimals(p0);
        let _v2 = perp_market_config::get_max_leverage(p0);
        let _v3 = open_interest_tracker::get_max_open_interest(p0);
        let _v4 = perp_market_config::get_min_size(p0);
        let _v5 = perp_market_config::get_lot_size(p0);
        let _v6 = perp_market_config::get_ticker_size(p0);
        event::emit<MarketUpdateEvent>(MarketUpdateEvent{market: p0, name: _v0, sz_decimals: _v1, max_leverage: _v2, max_open_interest: _v3, min_size: _v4, lot_size: _v5, ticker_size: _v6});
    }
    friend fun set_market_notional_open_interest(p0: object::Object<perp_market::PerpMarket>, p1: u64) {
        open_interest_tracker::set_max_notional_open_interest(p0, p1);
    }
    friend fun set_market_open(p0: object::Object<perp_market::PerpMarket>, p1: option::Option<string::String>) {
        perp_market_config::set_open(p0, p1);
    }
    friend fun set_market_open_interest(p0: object::Object<perp_market::PerpMarket>, p1: u64) {
        open_interest_tracker::set_max_open_interest(p0, p1);
        let _v0 = perp_market_config::get_name(p0);
        let _v1 = perp_market_config::get_sz_decimals(p0);
        let _v2 = perp_market_config::get_max_leverage(p0);
        let _v3 = open_interest_tracker::get_max_open_interest(p0);
        let _v4 = perp_market_config::get_min_size(p0);
        let _v5 = perp_market_config::get_lot_size(p0);
        let _v6 = perp_market_config::get_ticker_size(p0);
        event::emit<MarketUpdateEvent>(MarketUpdateEvent{market: p0, name: _v0, sz_decimals: _v1, max_leverage: _v2, max_open_interest: _v3, min_size: _v4, lot_size: _v5, ticker_size: _v6});
    }
    friend fun set_market_reduce_only(p0: object::Object<perp_market::PerpMarket>, p1: vector<address>, p2: option::Option<string::String>) {
        perp_market_config::set_reduce_only(p0, p1, p2);
    }
    friend fun set_market_unrealized_pnl_haircut(p0: object::Object<perp_market::PerpMarket>, p1: u64) {
        price_management::set_unrealized_pnl_haircut_bps(p0, p1);
    }
    friend fun set_market_withdrawable_margin_leverage(p0: object::Object<perp_market::PerpMarket>, p1: u8) {
        let _v0 = perp_market_config::get_max_leverage(p0);
        price_management::set_withdrawable_margin_leverage(p0, p1, _v0);
    }
    fun trigger_position_based_tp_sl_internal(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: bool) {
        let _v0 = position_tp_sl::take_ready_tp_sl_orders(p0, p1, p2, 10);
        p1 = 0;
        loop {
            let _v1;
            let _v2;
            let _v3 = vector::length<position_tp_sl_tracker::PendingRequest>(&_v0);
            if (!(p1 < _v3)) break;
            let (_v4,_v5,_v6,_v7,_v8) = position_tp_sl_tracker::destroy_pending_request(*vector::borrow<position_tp_sl_tracker::PendingRequest>(&_v0, p1));
            let _v9 = _v8;
            let _v10 = _v7;
            let _v11 = _v6;
            let _v12 = _v5;
            let _v13 = _v4;
            p2 = !perp_positions::get_position_is_long(_v13, p0);
            if (option::is_some<u64>(&_v10)) _v2 = option::destroy_some<u64>(_v10) else _v2 = perp_positions::get_position_size(_v13, p0);
            if (_v2 == 0) {
                p1 = p1 + 1;
                continue
            };
            if (option::is_some<u64>(&_v11)) {
                _v1 = option::destroy_some<u64>(_v11);
                _v1 = perp_market_config::round_price_to_ticker(p0, _v1, p2);
                perp_market_config::validate_price_and_size_allow_below_min_size(p0, _v1, _v2);
                let _v14 = order_book_types::good_till_cancelled();
                let _v15 = option::some<order_book_types::OrderIdType>(_v12);
                let _v16 = option::none<string::String>();
                let _v17 = option::none<u64>();
                let _v18 = option::none<u64>();
                let _v19 = option::none<u64>();
                let _v20 = option::none<u64>();
                let _v21 = option::none<u64>();
                let _v22 = async_matching_engine::place_order(p0, _v13, _v1, _v2, p2, _v14, true, _v15, _v16, _v17, _v18, _v19, _v20, _v21, _v9);
            } else {
                if (p2) _v1 = 9223372036854775807 else _v1 = 1;
                let _v23 = order_book_types::immediate_or_cancel();
                let _v24 = option::some<order_book_types::OrderIdType>(_v12);
                let _v25 = option::none<string::String>();
                let _v26 = option::none<u64>();
                let _v27 = option::none<u64>();
                let _v28 = option::none<u64>();
                let _v29 = option::none<u64>();
                let _v30 = option::none<u64>();
                let _v31 = async_matching_engine::place_order(p0, _v13, _v1, _v2, p2, _v23, true, _v24, _v25, _v26, _v27, _v28, _v29, _v30, _v9);
            };
            p1 = p1 + 1;
            continue
        };
    }
    public fun update_client_order(p0: &signer, p1: string::String, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: u64, p5: bool, p6: order_book_types::TimeInForce, p7: bool, p8: option::Option<u64>, p9: option::Option<u64>, p10: option::Option<u64>, p11: option::Option<u64>, p12: option::Option<builder_code_registry::BuilderCode>)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = clearinghouse_perp::market_callbacks(p2);
        let _v1 = &_v0;
        perp_market::cancel_client_order(p2, p0, p1, _v1);
        let _v2 = option::some<string::String>(p1);
        let _v3 = option::none<u64>();
        let _v4 = place_order(p2, p0, p3, p4, p5, p6, p7, _v2, _v3, p8, p9, p10, p11, p12);
    }
    friend fun update_oracle_and_mark_price_and_liquidate_and_trigger(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: option::Option<u64>, p3: option::Option<vector<u8>>, p4: option::Option<vector<u8>>, p5: price_management::MarkPriceRefreshInput, p6: vector<address>, p7: bool)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        if (option::is_some<u64>(&p2)) {
            let _v0 = option::destroy_some<u64>(p2);
            perp_market_config::update_internal_oracle_price(p1, _v0)
        };
        if (option::is_some<vector<u8>>(&p3)) {
            let _v1 = option::destroy_some<vector<u8>>(p3);
            chainlink_state::verify_and_store_single_price(p0, _v1)
        };
        if (option::is_some<vector<u8>>(&p4)) {
            let _v2 = option::destroy_some<vector<u8>>(p4);
            let _v3 = vector::empty<vector<u8>>();
            vector::push_back<vector<u8>>(&mut _v3, _v2);
            pyth::update_price_feeds_with_funder(p0, _v3)
        };
        refresh_liquidate_and_trigger(p1, p5, p6, p7);
    }
    public fun update_order(p0: &signer, p1: order_book_types::OrderIdType, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: u64, p5: bool, p6: order_book_types::TimeInForce, p7: bool, p8: option::Option<u64>, p9: option::Option<u64>, p10: option::Option<u64>, p11: option::Option<u64>, p12: option::Option<builder_code_registry::BuilderCode>)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = signer::address_of(p0);
        let _v1 = clearinghouse_perp::market_callbacks(p2);
        let _v2 = &_v1;
        let _v3 = perp_market::cancel_order(p2, _v0, p1, true, _v2);
        let _v4 = option::none<string::String>();
        let _v5 = option::none<u64>();
        let _v6 = place_order(p2, p0, p3, p4, p5, p6, p7, _v4, _v5, p8, p9, p10, p11, p12);
    }
    public fun view_position_status(p0: address, p1: object::Object<perp_market::PerpMarket>): perp_positions::AccountStatusDetailed {
        accounts_collateral::position_status(p0, p1)
    }
    public fun withdraw_from_isolated_position_margin(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: object::Object<fungible_asset::Metadata>, p3: u64): fungible_asset::FungibleAsset
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        assert!(p3 > 0, 8);
        assert!(accounts_collateral::is_asset_supported(p2), 9);
        let _v0 = accounts_collateral::withdraw_fungible_from_isolated_position_margin(p0, p1, p3);
        let _v1 = fungible_asset::metadata_from_asset(&_v0);
        assert!(p2 == _v1, 7);
        _v0
    }
}
