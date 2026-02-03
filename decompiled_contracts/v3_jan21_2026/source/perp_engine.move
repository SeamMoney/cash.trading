module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine {
    use 0x1::object;
    use 0x1::big_ordered_map;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0x1::fungible_asset;
    use 0x1::string;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::accounts_collateral;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_positions;
    use 0x1::event;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::clearinghouse_perp;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::market_types;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine_types;
    use 0x1::option;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::builder_code_registry;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book_types;
    use 0x1::signer;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::work_unit_utils;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::single_order_types;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_matching_engine;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_order;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market_config;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::price_management;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::oracle;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::pending_order_tracker;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::trading_fees_manager;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_view_types;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::open_interest_tracker;
    use 0x1::vector;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_tp_sl;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::math;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::backstop_liquidator_profit_tracker;
    use 0x1::error;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::tp_sl_utils;
    use 0x1::bcs;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::adl_tracker;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_tp_sl_tracker;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::chainlink_state;
    use 0x7e783b349d3e89cf5931af376ebeadbfab855b3fa239b7ada8f5a92fbea6b387::pyth;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::account_management_apis;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::admin_apis;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::order_apis;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine_api;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::public_apis;
    enum Global has key {
        V1 {
            extend_ref: object::ExtendRef,
            market_refs: big_ordered_map::BigOrderedMap<object::Object<perp_market::PerpMarket>, object::ExtendRef>,
            is_exchange_open: bool,
        }
    }
    enum AccountCreationRestrictions has key {
        V1 {
            invite_only_account_creation: bool,
            allow_list: big_ordered_map::BigOrderedMap<address, bool>,
        }
    }
    enum DexRegistrationEvent has drop, store {
        V1 {
            dex: object::Object<object::ObjectCore>,
            collateral_asset: object::Object<fungible_asset::Metadata>,
            collateral_balance_decimals: u8,
        }
    }
    enum InvalidLiquidationRequestsEvent has drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            invalidated: vector<address>,
        }
    }
    enum MarketRegistrationEvent has drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            name: string::String,
            sz_decimals: u8,
            max_leverage: u8,
            max_open_interest: u64,
            min_size: u64,
            lot_size: u64,
            ticker_size: u64,
            unrealized_pnl_haircut_bps: u64,
        }
    }
    enum MarketUpdateEvent has drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            name: string::String,
            sz_decimals: u8,
            max_leverage: u8,
            max_open_interest: u64,
            min_size: u64,
            lot_size: u64,
            ticker_size: u64,
            unrealized_pnl_haircut_bps: u64,
        }
    }
    enum OracleInternalSnapshot {
        V1 {
            oracle_type: u8,
            primary_price: u64,
            secondary_price: u64,
        }
    }
    enum PerpOrderCancelationReason {
        MaxOpenInterestViolation,
    }
    public fun is_exchange_open(): bool
        acquires Global
    {
        *&borrow_global<Global>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).is_exchange_open
    }
    public fun collateral_balance_decimals(): u8 {
        let _v0 = accounts_collateral::collateral_balance_precision();
        math::get_decimals(&_v0)
    }
    friend fun initialize(p0: &signer, p1: object::Object<fungible_asset::Metadata>, p2: u8, p3: address) {
        let _v0 = object::create_named_object(p0, vector[71u8, 108u8, 111u8, 98u8, 97u8, 108u8, 80u8, 101u8, 114u8, 112u8, 69u8, 110u8, 103u8, 105u8, 110u8, 101u8]);
        let _v1 = object::generate_extend_ref(&_v0);
        if (exists<Global>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88)) abort 2;
        let _v2 = big_ordered_map::new<object::Object<perp_market::PerpMarket>,object::ExtendRef>();
        let _v3 = Global::V1{extend_ref: _v1, market_refs: _v2, is_exchange_open: true};
        move_to<Global>(p0, _v3);
        let _v4 = big_ordered_map::new<address,bool>();
        let _v5 = AccountCreationRestrictions::V1{invite_only_account_creation: false, allow_list: _v4};
        move_to<AccountCreationRestrictions>(p0, _v5);
        accounts_collateral::initialize(p0, p1, p2, p3);
        perp_positions::initialize(p0);
        init_account_status_cache(p3);
        event::emit<DexRegistrationEvent>(DexRegistrationEvent::V1{dex: object::object_from_constructor_ref<object::ObjectCore>(&_v0), collateral_asset: p1, collateral_balance_decimals: p2});
    }
    friend fun init_account_status_cache(p0: address) {
        perp_positions::init_account_status_cache(p0);
    }
    friend fun deposit(p0: address, p1: fungible_asset::FungibleAsset)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = &p1;
        assert!(accounts_collateral::is_asset_supported(fungible_asset::metadata_from_asset(_v0)), 9);
        assert!(fungible_asset::amount(_v0) > 0, 8);
        perp_positions::assert_user_initialized(p0);
        accounts_collateral::deposit(p0, p1);
    }
    friend fun cancel_bulk_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = clearinghouse_perp::market_callbacks(p0);
        let _v1 = &_v0;
        perp_market::cancel_bulk_order(p0, p1, _v1);
    }
    friend fun place_bulk_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: u64, p3: vector<u64>, p4: vector<u64>, p5: vector<u64>, p6: vector<u64>, p7: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderId
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = perp_engine_types::new_bulk_order_metadata(p7);
        let _v1 = signer::address_of(p1);
        let _v2 = clearinghouse_perp::market_callbacks(p0);
        let _v3 = &_v2;
        let _v4 = perp_market::place_bulk_order(p0, _v1, p2, p3, p4, p5, p6, _v0, _v3);
        let _v5 = work_unit_utils::get_default_work_units();
        work_unit_utils::consume_bulk_order_work_units(&mut _v5);
        trigger_matching(p0, _v5);
        _v4
    }
    friend fun trigger_matching(p0: object::Object<perp_market::PerpMarket>, p1: work_unit_utils::WorkUnit)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        async_matching_engine::trigger_matching(p0, p1);
    }
    friend fun cancel_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: order_book_types::OrderId)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = signer::address_of(p1);
        let _v1 = market_types::order_cancellation_reason_cancelled_by_user();
        let _v2 = string::utf8(vector[]);
        let _v3 = clearinghouse_perp::market_callbacks(p0);
        let _v4 = &_v3;
        let _v5 = perp_market::cancel_order(p0, _v0, p2, true, _v1, _v2, _v4);
        let _v6 = work_unit_utils::get_default_work_units();
        async_matching_engine::trigger_matching_sometimes(p0, _v6);
    }
    friend fun place_market_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: u64, p3: bool, p4: bool, p5: option::Option<string::String>, p6: option::Option<u64>, p7: perp_order::PerpOrderRequestTpSlArgs, p8: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderId
        acquires Global
    {
        let _v0;
        assert!(is_exchange_open(), 5);
        if (p3) _v0 = 9223372036854775807 else _v0 = 1;
        perp_market_config::validate_price_and_size(p0, _v0, p2, false);
        let _v1 = signer::address_of(p1);
        let _v2 = order_book_types::immediate_or_cancel();
        let _v3 = perp_order::new_order_common_args(_v0, p2, p3, _v2, p5);
        let _v4 = option::none<order_book_types::OrderId>();
        let _v5 = async_matching_engine::place_maker_or_queue_taker(p0, _v1, _v3, _v4, p4, p6, p7, p8);
        let _v6 = work_unit_utils::get_default_work_units();
        work_unit_utils::consume_small_work_units(&mut _v6);
        async_matching_engine::trigger_matching_sometimes(p0, _v6);
        _v5
    }
    friend fun cancel_client_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: string::String)
        acquires Global
    {
        let _v0 = p0;
        assert!(is_exchange_open(), 5);
        let _v1 = clearinghouse_perp::market_callbacks(_v0);
        let _v2 = &_v1;
        perp_market::cancel_client_order(_v0, p1, p2, _v2);
        let _v3 = work_unit_utils::get_default_work_units();
        async_matching_engine::trigger_matching_sometimes(p0, _v3);
    }
    public fun get_oracle_price(p0: object::Object<perp_market::PerpMarket>): u64 {
        price_management::get_oracle_price(p0)
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
    public fun get_primary_store_balance_in_balance_precision(): u64 {
        accounts_collateral::get_primary_store_balance_in_balance_precision()
    }
    public fun primary_asset_metadata(): object::Object<fungible_asset::Metadata> {
        accounts_collateral::primary_asset_metadata()
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
    friend fun configure_user_settings_for_market(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: u8)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        perp_positions::configure_user_settings_for_market(p0, p1, p2, p3);
    }
    public fun cross_position_status(p0: address): perp_positions::AccountStatusDetailed {
        accounts_collateral::get_cross_position_status(p0)
    }
    public fun get_position_funding_index_at_last_update(p0: address, p1: object::Object<perp_market::PerpMarket>): i128 {
        let _v0 = perp_positions::get_position_funding_index_at_last_update(p0, p1);
        price_management::accumulative_index(&_v0)
    }
    public fun get_position_is_long(p0: address, p1: object::Object<perp_market::PerpMarket>): bool {
        perp_positions::get_position_is_long(p0, p1)
    }
    public fun get_position_size(p0: address, p1: object::Object<perp_market::PerpMarket>): u64 {
        perp_positions::get_position_size(p0, p1)
    }
    public fun get_position_unrealized_funding_amount_before_last_update(p0: address, p1: object::Object<perp_market::PerpMarket>): i64 {
        perp_positions::get_position_unrealized_funding_amount_before_last_update(p0, p1)
    }
    public fun get_position_unrealized_funding_cost(p0: address, p1: object::Object<perp_market::PerpMarket>): i64 {
        perp_positions::get_position_unrealized_funding_cost(p0, p1)
    }
    public fun has_any_assets_or_positions(p0: address): bool {
        if (accounts_collateral::has_any_assets_or_positions(p0)) return true;
        pending_order_tracker::has_any_pending_orders(p0)
    }
    public fun has_position(p0: address, p1: object::Object<perp_market::PerpMarket>): bool {
        perp_positions::has_position(p0, p1)
    }
    #[persistent]
    friend fun init_user_if_new(p0: &signer, p1: address)
        acquires AccountCreationRestrictions
    {
        if (exists<AccountCreationRestrictions>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88)) {
            if (*&borrow_global<AccountCreationRestrictions>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).invite_only_account_creation) {
                let _v0 = trading_fees_manager::get_referrer_addr(p1);
                if (option::is_none<address>(&_v0)) {
                    let _v1 = &borrow_global<AccountCreationRestrictions>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).allow_list;
                    let _v2 = &p1;
                    assert!(big_ordered_map::contains<address,bool>(_v1, _v2), 29)
                }
            }};
        perp_positions::init_user_if_new(p0, p1);
    }
    public fun is_position_isolated(p0: address, p1: object::Object<perp_market::PerpMarket>): bool {
        perp_positions::is_position_isolated(p0, p1)
    }
    public fun is_position_liquidatable(p0: address, p1: object::Object<perp_market::PerpMarket>): bool {
        accounts_collateral::is_position_liquidatable(p0, p1, false)
    }
    public fun list_positions(p0: address): vector<position_view_types::PositionViewInfo> {
        perp_positions::list_positions(p0)
    }
    friend fun transfer_margin_to_isolated_position(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: object::Object<fungible_asset::Metadata>, p4: u64)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        assert!(p4 > 0, 8);
        assert!(accounts_collateral::is_asset_supported(p3), 9);
        accounts_collateral::transfer_margin_fungible_to_isolated_position(signer::address_of(p0), p1, p2, p4);
    }
    public fun view_position(p0: address, p1: object::Object<perp_market::PerpMarket>): option::Option<position_view_types::PositionViewInfo> {
        perp_positions::view_position(p0, p1)
    }
    public fun get_current_open_interest(p0: object::Object<perp_market::PerpMarket>): u64 {
        open_interest_tracker::get_current_open_interest(p0)
    }
    public fun get_max_notional_open_interest(p0: object::Object<perp_market::PerpMarket>): u64 {
        open_interest_tracker::get_max_notional_open_interest(p0)
    }
    friend fun deposit_to_isolated_position_margin(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: fungible_asset::FungibleAsset)
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
    public fun max_allowed_withdraw_fungible_amount(p0: address, p1: object::Object<fungible_asset::Metadata>): u64 {
        assert!(accounts_collateral::is_asset_supported(p1), 9);
        accounts_collateral::max_allowed_withdraw_fungible_amount(p0, p1)
    }
    friend fun withdraw_fungible(p0: &signer, p1: object::Object<fungible_asset::Metadata>, p2: u64): fungible_asset::FungibleAsset
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
    friend fun close_delisted_position(p0: address, p1: object::Object<perp_market::PerpMarket>)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        assert!(perp_market_config::is_market_delisted(p1), 22);
        clearinghouse_perp::close_delisted_position(p0, p1);
    }
    friend fun cancel_twap_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: order_book_types::OrderId)
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
    friend fun get_async_queue_length(p0: object::Object<perp_market::PerpMarket>): u64 {
        async_matching_engine::get_async_queue_length(p0)
    }
    friend fun place_twap_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: u64, p3: bool, p4: bool, p5: option::Option<string::String>, p6: u64, p7: u64, p8: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderId
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        perp_positions::assert_user_initialized(signer::address_of(p1));
        let _v0 = async_matching_engine::place_twap_order(p0, p1, p2, p3, p4, p5, p6, p7, p8);
        let _v1 = work_unit_utils::get_default_work_units();
        let _v2 = &mut _v1;
        async_matching_engine::trigger_twap_orders(p0, _v2);
        _v0
    }
    public fun market_min_size(p0: object::Object<perp_market::PerpMarket>): u64 {
        perp_market_config::get_min_size(p0)
    }
    public fun market_lot_size(p0: object::Object<perp_market::PerpMarket>): u64 {
        perp_market_config::get_lot_size(p0)
    }
    friend fun add_to_account_creation_allow_list(p0: vector<address>)
        acquires AccountCreationRestrictions
    {
        let _v0 = p0;
        vector::reverse<address>(&mut _v0);
        let _v1 = _v0;
        let _v2 = vector::length<address>(&_v1);
        while (_v2 > 0) {
            let _v3 = vector::pop_back<address>(&mut _v1);
            big_ordered_map::add<address,bool>(&mut borrow_global_mut<AccountCreationRestrictions>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).allow_list, _v3, true);
            _v2 = _v2 - 1;
            continue
        };
        vector::destroy_empty<address>(_v1);
    }
    public fun cancel_orders(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: vector<order_book_types::OrderId>)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        if (vector::is_empty<order_book_types::OrderId>(&p2)) abort 28;
        let _v0 = p2;
        vector::reverse<order_book_types::OrderId>(&mut _v0);
        let _v1 = _v0;
        let _v2 = vector::length<order_book_types::OrderId>(&_v1);
        while (_v2 > 0) {
            let _v3 = vector::pop_back<order_book_types::OrderId>(&mut _v1);
            let _v4 = signer::address_of(p1);
            let _v5 = market_types::order_cancellation_reason_cancelled_by_user();
            let _v6 = string::utf8(vector[]);
            let _v7 = clearinghouse_perp::market_callbacks(p0);
            let _v8 = &_v7;
            let _v9 = perp_market::cancel_order(p0, _v4, _v3, true, _v5, _v6, _v8);
            _v2 = _v2 - 1;
            continue
        };
        vector::destroy_empty<order_book_types::OrderId>(_v1);
        let _v10 = work_unit_utils::get_default_work_units();
        async_matching_engine::trigger_matching_sometimes(p0, _v10);
    }
    friend fun cancel_tp_sl_order_for_position(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: order_book_types::OrderId)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        position_tp_sl::cancel_tp_sl(signer::address_of(p1), p0, p2);
    }
    friend fun decrease_market_notional_open_interest(p0: object::Object<perp_market::PerpMarket>, p1: u64) {
        open_interest_tracker::decrease_max_notional_open_interest(p0, p1);
    }
    friend fun decrease_market_open_interest(p0: object::Object<perp_market::PerpMarket>, p1: u64) {
        open_interest_tracker::decrease_max_open_interest(p0, p1);
        let _v0 = perp_market_config::get_name(p0);
        let _v1 = perp_market_config::get_sz_decimals(p0);
        let _v2 = perp_market_config::get_max_leverage(p0);
        let _v3 = open_interest_tracker::get_max_open_interest(p0);
        let _v4 = perp_market_config::get_min_size(p0);
        let _v5 = perp_market_config::get_lot_size(p0);
        let _v6 = perp_market_config::get_ticker_size(p0);
        let _v7 = price_management::get_unrealized_pnl_haircut_bps(p0);
        event::emit<MarketUpdateEvent>(MarketUpdateEvent::V1{market: p0, name: _v0, sz_decimals: _v1, max_leverage: _v2, max_open_interest: _v3, min_size: _v4, lot_size: _v5, ticker_size: _v6, unrealized_pnl_haircut_bps: _v7});
    }
    friend fun delist_market_with_mark_price(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: option::Option<string::String>) {
        perp_market_config::delist_market(p0, p2);
        let (_v0,_v1) = price_management::into_old_and_new_market_state(price_management::add_override_mark_price(p0, p1));
        perp_positions::update_account_status_cache_on_market_state_change(p0, _v0, _v1);
        async_matching_engine::schedule_commit_mark_price(p0, p1);
    }
    public fun get_account_balance_fungible_signed(p0: address): i64 {
        accounts_collateral::get_account_balance_fungible(p0) as i64
    }
    friend fun get_and_check_oracle_price(p0: object::Object<perp_market::PerpMarket>, p1: math::Precision): u64 {
        let _v0 = perp_market_config::get_oracle_data(p0, p1);
        if (oracle::is_status_invalid(&_v0)) return price_management::get_book_mid_ema_px(p0);
        if (oracle::is_status_down(&_v0)) return price_management::get_book_mid_px(p0);
        oracle::get_price(&_v0)
    }
    public fun get_blp_pnl(p0: object::Object<perp_market::PerpMarket>): i64 {
        let _v0 = price_management::get_mark_price(p0);
        backstop_liquidator_profit_tracker::get_total_pnl(p0, _v0)
    }
    public fun get_isolated_position_margin_signed(p0: address, p1: object::Object<perp_market::PerpMarket>): i64 {
        accounts_collateral::get_isolated_position_margin(p0, p1) as i64
    }
    public fun get_max_open_interest_delta(p0: object::Object<perp_market::PerpMarket>): u64 {
        open_interest_tracker::get_max_open_interest_delta_for_market(p0)
    }
    public fun get_oracle_internal_snapshot(p0: object::Object<perp_market::PerpMarket>): OracleInternalSnapshot {
        let _v0;
        let _v1 = perp_market_config::get_oracle_source(p0);
        let _v2 = accounts_collateral::collateral_balance_precision();
        if (oracle::is_composite(&_v1)) _v0 = oracle::get_secondary_oracle_price(&_v1, _v2) else _v0 = 0;
        let _v3 = oracle::get_oracle_type(&_v1);
        let _v4 = oracle::get_primary_oracle_price(&_v1, _v2);
        OracleInternalSnapshot::V1{oracle_type: _v3, primary_price: _v4, secondary_price: _v0}
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
    friend fun increase_market_notional_open_interest(p0: object::Object<perp_market::PerpMarket>, p1: u64) {
        open_interest_tracker::increase_max_notional_open_interest(p0, p1);
    }
    friend fun increase_market_open_interest(p0: object::Object<perp_market::PerpMarket>, p1: u64) {
        open_interest_tracker::increase_max_open_interest(p0, p1);
        let _v0 = perp_market_config::get_name(p0);
        let _v1 = perp_market_config::get_sz_decimals(p0);
        let _v2 = perp_market_config::get_max_leverage(p0);
        let _v3 = open_interest_tracker::get_max_open_interest(p0);
        let _v4 = perp_market_config::get_min_size(p0);
        let _v5 = perp_market_config::get_lot_size(p0);
        let _v6 = perp_market_config::get_ticker_size(p0);
        let _v7 = price_management::get_unrealized_pnl_haircut_bps(p0);
        event::emit<MarketUpdateEvent>(MarketUpdateEvent::V1{market: p0, name: _v0, sz_decimals: _v1, max_leverage: _v2, max_open_interest: _v3, min_size: _v4, lot_size: _v5, ticker_size: _v6, unrealized_pnl_haircut_bps: _v7});
    }
    public fun is_market_open(p0: object::Object<perp_market::PerpMarket>): bool {
        perp_market_config::is_open(p0)
    }
    public fun is_supported_collateral(p0: object::Object<fungible_asset::Metadata>): bool {
        accounts_collateral::is_asset_supported(p0)
    }
    friend fun liquidate_positions(p0: vector<address>, p1: object::Object<perp_market::PerpMarket>)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = vector::empty<address>();
        let _v1 = vector::empty<address>();
        let _v2 = work_unit_utils::get_default_work_units();
        let _v3 = p0;
        vector::reverse<address>(&mut _v3);
        let _v4 = _v3;
        let _v5 = vector::length<address>(&_v4);
        while (_v5 > 0) {
            let _v6 = vector::pop_back<address>(&mut _v4);
            work_unit_utils::consume_position_status_work_units(&mut _v2);
            let _v7 = accounts_collateral::position_status(_v6, p1);
            if (perp_positions::is_account_liquidatable_detailed(&_v7, false)) {
                async_matching_engine::schedule_liquidation(_v6, p1);
                vector::push_back<address>(&mut _v0, _v6)
            } else vector::push_back<address>(&mut _v1, _v6);
            _v5 = _v5 - 1;
            continue
        };
        vector::destroy_empty<address>(_v4);
        if (vector::length<address>(&_v1) > 0) event::emit<InvalidLiquidationRequestsEvent>(InvalidLiquidationRequestsEvent::V1{market: p1, invalidated: _v1});
        if (vector::length<address>(&_v0) > 0) async_matching_engine::add_adl_to_pending(p1);
        if (work_unit_utils::has_more_work(&_v2)) {
            trigger_matching(p1, _v2);
            return ()
        };
    }
    public fun list_markets(): vector<address>
        acquires Global
    {
        let _v0 = vector::empty<address>();
        let _v1 = &borrow_global<Global>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).market_refs;
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
    public fun market_margin_call_fee_pct(p0: object::Object<perp_market::PerpMarket>): u64 {
        perp_market_config::get_margin_call_fee_pct(p0)
    }
    public fun market_name(p0: object::Object<perp_market::PerpMarket>): string::String {
        perp_market_config::get_name(p0)
    }
    public fun market_slippage_pcts(p0: object::Object<perp_market::PerpMarket>): vector<u64> {
        perp_market_config::get_slippage_pcts(p0)
    }
    public fun market_sz_decimals(p0: object::Object<perp_market::PerpMarket>): u8 {
        perp_market_config::get_sz_decimals(p0)
    }
    public fun market_ticker_size(p0: object::Object<perp_market::PerpMarket>): u64 {
        perp_market_config::get_ticker_size(p0)
    }
    friend fun place_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: perp_order::PerpOrderRequestCommonArgs, p3: bool, p4: option::Option<u64>, p5: perp_order::PerpOrderRequestTpSlArgs, p6: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderId
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = perp_order::get_price(&p2);
        let _v1 = perp_order::get_orig_size(&p2);
        perp_market_config::validate_price_and_size(p0, _v0, _v1, false);
        let _v2 = signer::address_of(p1);
        let _v3 = option::none<order_book_types::OrderId>();
        let _v4 = async_matching_engine::place_maker_or_queue_taker(p0, _v2, p2, _v3, p3, p4, p5, p6);
        let _v5 = work_unit_utils::get_default_work_units();
        work_unit_utils::consume_order_placement_work_units(&mut _v5);
        async_matching_engine::trigger_matching_sometimes(p0, _v5);
        _v4
    }
    friend fun place_tp_sl_order_for_position(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: option::Option<u64>, p3: option::Option<u64>, p4: option::Option<u64>, p5: option::Option<u64>, p6: option::Option<u64>, p7: option::Option<u64>, p8: option::Option<builder_code_registry::BuilderCode>): (option::Option<order_book_types::OrderId>, option::Option<order_book_types::OrderId>)
        acquires Global
    {
        let _v0;
        assert!(is_exchange_open(), 5);
        perp_positions::assert_user_initialized(signer::address_of(p1));
        assert!(get_position_size(signer::address_of(p1), p0) > 0, 26);
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
    fun process_tp_sl_order(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: option::Option<u64>, p3: option::Option<u64>, p4: option::Option<u64>, p5: bool, p6: option::Option<builder_code_registry::BuilderCode>): option::Option<order_book_types::OrderId> {
        let _v0 = option::is_some<u64>(&p2);
        loop {
            if (!_v0) {
                assert!(option::is_none<u64>(&p3), 6);
                if (option::is_none<u64>(&p4)) break;
                abort 6
            };
            let _v1 = order_book_types::next_order_id();
            let _v2 = option::destroy_some<u64>(p2);
            return option::some<order_book_types::OrderId>(tp_sl_utils::place_tp_sl_order_for_position_internal(p0, p1, _v2, p3, p4, p5, _v1, p6, true, false))
        };
        option::none<order_book_types::OrderId>()
    }
    friend fun refresh_liquidate_and_trigger(p0: object::Object<perp_market::PerpMarket>, p1: price_management::MarkPriceRefreshInput, p2: vector<address>, p3: bool)
        acquires Global
    {
        let _v0;
        assert!(is_exchange_open(), 5);
        let _v1 = work_unit_utils::get_default_work_units();
        work_unit_utils::consume_refresh_mark_price_work_units(&mut _v1);
        let (_v2,_v3) = refresh_mark_price(p0, p1);
        let _v4 = _v2;
        let _v5 = p2;
        vector::reverse<address>(&mut _v5);
        let _v6 = _v5;
        let _v7 = vector::length<address>(&_v6);
        while (_v7 > 0) {
            let _v8 = vector::pop_back<address>(&mut _v6);
            work_unit_utils::consume_small_work_units(&mut _v1);
            async_matching_engine::schedule_liquidation(_v8, p0);
            _v7 = _v7 - 1;
            continue
        };
        vector::destroy_empty<address>(_v6);
        if (_v4) _v0 = true else _v0 = !vector::is_empty<address>(&p2);
        if (_v0) async_matching_engine::add_adl_to_pending(p0);
        if (_v4) async_matching_engine::schedule_commit_mark_price(p0, _v3);
        if (p3) {
            _v7 = price_management::get_mark_price(p0);
            let _v9 = &mut _v1;
            trigger_position_based_tp_sl(p0, _v7, _v9);
            let _v10 = &mut _v1;
            async_matching_engine::trigger_price_based_conditional_orders(p0, _v7, _v10);
            let _v11 = &mut _v1;
            async_matching_engine::trigger_twap_orders(p0, _v11);
            if (work_unit_utils::has_more_work(&_v1)) trigger_matching(p0, _v1);
            return ()
        };
    }
    fun refresh_mark_price(p0: object::Object<perp_market::PerpMarket>, p1: price_management::MarkPriceRefreshInput): (bool, u64) {
        let _v0 = accounts_collateral::collateral_balance_precision();
        let _v1 = get_and_check_oracle_price(p0, _v0);
        let _v2 = price_management::update_price(p0, _v1, p1);
        if (option::is_some<price_management::PriceChangeDetails>(&_v2)) {
            let _v3 = option::destroy_some<price_management::PriceChangeDetails>(_v2);
            _v1 = price_management::new_mark_px_from_change_details(&_v3);
            let (_v4,_v5) = price_management::into_old_and_new_market_state(_v3);
            perp_positions::update_account_status_cache_on_market_state_change(p0, _v4, _v5);
            return (true, _v1)
        };
        option::destroy_none<price_management::PriceChangeDetails>(_v2);
        (false, 0)
    }
    friend fun trigger_position_based_tp_sl(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: &mut work_unit_utils::WorkUnit) {
        trigger_position_based_tp_sl_internal(p0, p1, true, p2);
        trigger_position_based_tp_sl_internal(p0, p1, false, p2);
    }
    friend fun register_market_internal(p0: string::String, p1: u8, p2: u64, p3: u64, p4: u64, p5: u64, p6: u8, p7: bool, p8: oracle::OracleSource): object::Object<perp_market::PerpMarket>
        acquires Global
    {
        assert!(exists<Global>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88), 3);
        let _v0 = borrow_global_mut<Global>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v1 = object::generate_signer_for_extending(&_v0.extend_ref);
        let _v2 = &_v1;
        let _v3 = bcs::to_bytes<string::String>(&p0);
        let _v4 = object::create_named_object(_v2, _v3);
        let _v5 = object::generate_signer(&_v4);
        async_matching_engine::register_market(&_v5, p7);
        let _v6 = &_v5;
        let _v7 = &_v1;
        let _v8 = &_v5;
        let _v9 = market_types::new_market_config(false, true, 5, true, 5);
        let _v10 = market_types::new_market<perp_engine_types::OrderMetadata>(_v7, _v8, _v9);
        perp_market::register_market(_v6, _v10);
        adl_tracker::initialize(&_v5);
        open_interest_tracker::register_open_interest_tracker(&_v5, p5, p3);
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
        event::emit<MarketRegistrationEvent>(MarketRegistrationEvent::V1{market: _v11, name: p0, sz_decimals: p1, max_leverage: p6, max_open_interest: p5, min_size: p2, lot_size: p3, ticker_size: p4, unrealized_pnl_haircut_bps: 0});
        _v11
    }
    friend fun register_market_with_composite_oracle_primary_chainlink(p0: string::String, p1: u8, p2: u64, p3: u64, p4: u64, p5: u64, p6: u8, p7: bool, p8: vector<u8>, p9: u64, p10: i8, p11: u64, p12: u64, p13: u64, p14: u8)
        acquires Global
    {
        let _v0 = oracle::new_chainlink_source(p8, p9, p10);
        let _v1 = object::generate_signer_for_extending(&borrow_global<Global>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).extend_ref);
        let _v2 = oracle::create_new_internal_oracle_source(&_v1, p11, p12);
        let _v3 = oracle::new_composite_oracle(_v0, _v2, p13, p14);
        let _v4 = register_market_internal(p0, p1, p2, p3, p4, p5, p6, p7, _v3);
    }
    friend fun register_market_with_composite_oracle_primary_pyth(p0: string::String, p1: u8, p2: u64, p3: u64, p4: u64, p5: u64, p6: u8, p7: bool, p8: vector<u8>, p9: u64, p10: u64, p11: i8, p12: u64, p13: u64, p14: u64, p15: u8)
        acquires Global
    {
        let _v0 = oracle::new_pyth_source(p8, p9, p10, p11);
        let _v1 = object::generate_signer_for_extending(&borrow_global<Global>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).extend_ref);
        let _v2 = oracle::create_new_internal_oracle_source(&_v1, p12, p13);
        let _v3 = oracle::new_composite_oracle(_v0, _v2, p14, p15);
        let _v4 = register_market_internal(p0, p1, p2, p3, p4, p5, p6, p7, _v3);
    }
    friend fun register_market_with_internal_oracle(p0: string::String, p1: u8, p2: u64, p3: u64, p4: u64, p5: u64, p6: u8, p7: bool, p8: u64, p9: u64)
        acquires Global
    {
        let _v0 = object::generate_signer_for_extending(&borrow_global<Global>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).extend_ref);
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
        let _v0 = &mut borrow_global_mut<Global>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).is_exchange_open;
        *_v0 = p0;
    }
    friend fun set_invite_only_account_creation(p0: bool)
        acquires AccountCreationRestrictions
    {
        let _v0 = &mut borrow_global_mut<AccountCreationRestrictions>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88).invite_only_account_creation;
        *_v0 = p0;
    }
    friend fun set_market_allowlist_only(p0: object::Object<perp_market::PerpMarket>, p1: vector<address>, p2: option::Option<string::String>) {
        perp_market_config::allowlist_only(p0, p1, p2);
    }
    friend fun set_market_halted(p0: object::Object<perp_market::PerpMarket>, p1: option::Option<string::String>) {
        perp_market_config::halt_market(p0, p1);
    }
    friend fun set_market_margin_call_backstop_pct(p0: object::Object<perp_market::PerpMarket>, p1: u64) {
        assert!(p1 <= 100, 25);
        perp_market_config::set_margin_call_backstop_pct(p0, p1);
    }
    friend fun set_market_margin_call_fee_pct(p0: object::Object<perp_market::PerpMarket>, p1: u64) {
        assert!(p1 < 20000, 24);
        perp_market_config::set_margin_call_fee_pct(p0, p1);
    }
    friend fun set_market_max_leverage(p0: object::Object<perp_market::PerpMarket>, p1: u8) {
        set_market_max_leverage_without_event(p0, p1);
        let _v0 = perp_market_config::get_name(p0);
        let _v1 = perp_market_config::get_sz_decimals(p0);
        let _v2 = perp_market_config::get_max_leverage(p0);
        let _v3 = open_interest_tracker::get_max_open_interest(p0);
        let _v4 = perp_market_config::get_min_size(p0);
        let _v5 = perp_market_config::get_lot_size(p0);
        let _v6 = perp_market_config::get_ticker_size(p0);
        let _v7 = price_management::get_unrealized_pnl_haircut_bps(p0);
        event::emit<MarketUpdateEvent>(MarketUpdateEvent::V1{market: p0, name: _v0, sz_decimals: _v1, max_leverage: _v2, max_open_interest: _v3, min_size: _v4, lot_size: _v5, ticker_size: _v6, unrealized_pnl_haircut_bps: _v7});
    }
    friend fun set_market_max_leverage_without_event(p0: object::Object<perp_market::PerpMarket>, p1: u8) {
        perp_market_config::set_max_leverage(p0, p1);
        let _v0 = price_management::get_market_state_for_position_status(p0);
        price_management::set_max_leverage(p0, p1);
        let _v1 = price_management::get_market_state_for_position_status(p0);
        perp_positions::update_account_status_cache_on_market_state_change(p0, _v0, _v1);
    }
    friend fun set_market_open(p0: object::Object<perp_market::PerpMarket>, p1: option::Option<string::String>) {
        perp_market_config::set_open(p0, p1);
    }
    friend fun set_market_reduce_only(p0: object::Object<perp_market::PerpMarket>, p1: vector<address>, p2: option::Option<string::String>) {
        perp_market_config::set_reduce_only(p0, p1, p2);
    }
    friend fun set_market_slippage_pcts(p0: object::Object<perp_market::PerpMarket>, p1: vector<u64>) {
        if (vector::is_empty<u64>(&p1)) abort 23;
        let _v0 = 0;
        let _v1 = vector::length<u64>(&p1);
        'l0: loop {
            'l1: loop {
                'l2: loop {
                    loop {
                        if (!(_v0 < _v1)) break 'l0;
                        let _v2 = *vector::borrow<u64>(&p1, _v0);
                        if (!(_v2 > 0)) break 'l1;
                        if (!(_v2 < 300000)) break 'l2;
                        if (_v0 > 0) {
                            let _v3 = &p1;
                            let _v4 = _v0 - 1;
                            if (!(*vector::borrow<u64>(_v3, _v4) < _v2)) break
                        };
                        _v0 = _v0 + 1;
                        continue
                    };
                    abort 23
                };
                abort 23
            };
            abort 23
        };
        perp_market_config::set_slippage_pcts(p0, p1);
    }
    friend fun set_market_unrealized_pnl_haircut(p0: object::Object<perp_market::PerpMarket>, p1: u64) {
        let _v0 = price_management::get_market_state_for_position_status(p0);
        price_management::set_unrealized_pnl_haircut_bps(p0, p1);
        let _v1 = price_management::get_market_state_for_position_status(p0);
        perp_positions::update_account_status_cache_on_market_state_change(p0, _v0, _v1);
        let _v2 = perp_market_config::get_name(p0);
        let _v3 = perp_market_config::get_sz_decimals(p0);
        let _v4 = perp_market_config::get_max_leverage(p0);
        let _v5 = open_interest_tracker::get_max_open_interest(p0);
        let _v6 = perp_market_config::get_min_size(p0);
        let _v7 = perp_market_config::get_lot_size(p0);
        let _v8 = perp_market_config::get_ticker_size(p0);
        let _v9 = price_management::get_unrealized_pnl_haircut_bps(p0);
        event::emit<MarketUpdateEvent>(MarketUpdateEvent::V1{market: p0, name: _v2, sz_decimals: _v3, max_leverage: _v4, max_open_interest: _v5, min_size: _v6, lot_size: _v7, ticker_size: _v8, unrealized_pnl_haircut_bps: _v9});
    }
    friend fun set_market_withdrawable_margin_leverage(p0: object::Object<perp_market::PerpMarket>, p1: u8) {
        let _v0 = price_management::get_market_state_for_position_status(p0);
        price_management::set_withdrawable_margin_leverage(p0, p1);
        let _v1 = price_management::get_market_state_for_position_status(p0);
        perp_positions::update_account_status_cache_on_market_state_change(p0, _v0, _v1);
        let _v2 = perp_market_config::get_name(p0);
        let _v3 = perp_market_config::get_sz_decimals(p0);
        let _v4 = perp_market_config::get_max_leverage(p0);
        let _v5 = open_interest_tracker::get_max_open_interest(p0);
        let _v6 = perp_market_config::get_min_size(p0);
        let _v7 = perp_market_config::get_lot_size(p0);
        let _v8 = perp_market_config::get_ticker_size(p0);
        let _v9 = price_management::get_unrealized_pnl_haircut_bps(p0);
        event::emit<MarketUpdateEvent>(MarketUpdateEvent::V1{market: p0, name: _v2, sz_decimals: _v3, max_leverage: _v4, max_open_interest: _v5, min_size: _v6, lot_size: _v7, ticker_size: _v8, unrealized_pnl_haircut_bps: _v9});
    }
    fun trigger_position_based_tp_sl_internal(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: bool, p3: &mut work_unit_utils::WorkUnit) {
        let _v0 = work_unit_utils::get_max_order_placement_limit(freeze(p3), 10u32);
        let _v1 = position_tp_sl::take_ready_tp_sl_orders(p0, p1, p2, _v0);
        p1 = 0;
        loop {
            let _v2;
            let _v3;
            let _v4 = vector::length<position_tp_sl_tracker::PendingRequest>(&_v1);
            if (!(p1 < _v4)) break;
            work_unit_utils::consume_order_placement_work_units(p3);
            let (_v5,_v6,_v7,_v8,_v9) = position_tp_sl_tracker::destroy_pending_request(*vector::borrow<position_tp_sl_tracker::PendingRequest>(&_v1, p1));
            let _v10 = _v9;
            let _v11 = _v8;
            let _v12 = _v7;
            let _v13 = _v6;
            let _v14 = _v5;
            p2 = !perp_positions::get_position_is_long(_v14, p0);
            if (option::is_some<u64>(&_v11)) _v3 = option::destroy_some<u64>(_v11) else _v3 = perp_positions::get_position_size(_v14, p0);
            if (_v3 == 0) {
                p1 = p1 + 1;
                continue
            };
            if (option::is_some<u64>(&_v12)) {
                _v2 = option::destroy_some<u64>(_v12);
                _v2 = perp_market_config::round_price_to_ticker(p0, _v2, p2);
                perp_market_config::validate_price_and_size_allow_below_min_size(p0, _v2, _v3);
                let _v15 = order_book_types::good_till_cancelled();
                let _v16 = option::none<string::String>();
                let _v17 = perp_order::new_order_common_args(_v2, _v3, p2, _v15, _v16);
                let _v18 = option::some<order_book_types::OrderId>(_v13);
                let _v19 = option::none<u64>();
                let _v20 = perp_order::new_empty_order_tp_sl_args();
                let _v21 = async_matching_engine::place_maker_or_queue_taker(p0, _v14, _v17, _v18, true, _v19, _v20, _v10);
            } else {
                if (p2) _v2 = 9223372036854775807 else _v2 = 1;
                let _v22 = order_book_types::immediate_or_cancel();
                let _v23 = option::none<string::String>();
                let _v24 = perp_order::new_order_common_args(_v2, _v3, p2, _v22, _v23);
                let _v25 = option::some<order_book_types::OrderId>(_v13);
                let _v26 = option::none<u64>();
                let _v27 = perp_order::new_empty_order_tp_sl_args();
                let _v28 = async_matching_engine::place_maker_or_queue_taker(p0, _v14, _v24, _v25, true, _v26, _v27, _v10);
            };
            p1 = p1 + 1;
            continue
        };
    }
    friend fun update_client_order(p0: &signer, p1: string::String, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: u64, p5: bool, p6: order_book_types::TimeInForce, p7: bool, p8: perp_order::PerpOrderRequestTpSlArgs, p9: option::Option<builder_code_registry::BuilderCode>)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = clearinghouse_perp::market_callbacks(p2);
        let _v1 = &_v0;
        perp_market::cancel_client_order(p2, p0, p1, _v1);
        let _v2 = option::some<string::String>(p1);
        let _v3 = perp_order::new_order_common_args(p3, p4, p5, p6, _v2);
        let _v4 = option::none<u64>();
        let _v5 = place_order(p2, p0, _v3, p7, _v4, p8, p9);
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
        let _v4 = accounts_collateral::collateral_balance_precision();
        perp_market_config::update_oracle_status(p1, _v4);
        accounts_collateral::resume_market_to_previous_mode_if_oracle_recovered(p1);
        refresh_liquidate_and_trigger(p1, p5, p6, p7);
    }
    friend fun update_order(p0: &signer, p1: order_book_types::OrderId, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: u64, p5: bool, p6: order_book_types::TimeInForce, p7: bool, p8: perp_order::PerpOrderRequestTpSlArgs, p9: option::Option<builder_code_registry::BuilderCode>)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let _v0 = signer::address_of(p0);
        let _v1 = market_types::order_cancellation_reason_cancelled_by_user();
        let _v2 = string::utf8(vector[]);
        let _v3 = clearinghouse_perp::market_callbacks(p2);
        let _v4 = &_v3;
        let _v5 = perp_market::cancel_order(p2, _v0, p1, true, _v1, _v2, _v4);
        let _v6 = option::none<string::String>();
        let _v7 = perp_order::new_order_common_args(p3, p4, p5, p6, _v6);
        let _v8 = option::none<u64>();
        let _v9 = place_order(p2, p0, _v7, p7, _v8, p8, p9);
    }
    public fun view_position_status(p0: address, p1: object::Object<perp_market::PerpMarket>): perp_positions::AccountStatusDetailed {
        accounts_collateral::position_status(p0, p1)
    }
    friend fun withdraw_from_isolated_position_margin(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: object::Object<fungible_asset::Metadata>, p3: u64): fungible_asset::FungibleAsset
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
