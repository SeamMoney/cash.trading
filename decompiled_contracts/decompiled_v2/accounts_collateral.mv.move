module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::accounts_collateral {
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::collateral_balance_sheet;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::liquidation_config;
    use 0x1::object;
    use 0x1::fungible_asset;
    use 0x1::signer;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::price_management;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::trading_fees_manager;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::fee_treasury;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::backstop_liquidator_profit_tracker;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::pending_order_tracker;
    use 0x1::error;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market;
    use 0x1::option;
    use 0x1::string;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::order_margin;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::oracle;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::fee_distribution;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_book_types;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine_types;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_positions;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::position_update;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::builder_code_registry;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::math;
    use 0x1::math64;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::clearinghouse_perp;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::liquidation;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::async_matching_engine;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine;
    enum GlobalAccountStates has key {
        V1 {
            collateral: collateral_balance_sheet::CollateralBalanceSheet,
            liquidation_config: liquidation_config::LiquidationConfig,
        }
    }
    public fun initialize(p0: &signer, p1: object::Object<fungible_asset::Metadata>, p2: u8, p3: address) {
        if (!(signer::address_of(p0) == @0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75)) {
            let _v0 = error::invalid_argument(4);
            abort _v0
        };
        price_management::new_price_management(p0);
        trading_fees_manager::initialize(p0);
        fee_treasury::initialize(p0, p1);
        backstop_liquidator_profit_tracker::initialize(p0);
        pending_order_tracker::initialize(p0);
        if (exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75)) abort 7;
        let _v1 = collateral_balance_sheet::initialize(p0, p1, p2);
        let _v2 = liquidation_config::new_config(p3);
        let _v3 = GlobalAccountStates::V1{collateral: _v1, liquidation_config: _v2};
        move_to<GlobalAccountStates>(p0, _v3);
    }
    friend fun deposit(p0: &signer, p1: fungible_asset::FungibleAsset)
        acquires GlobalAccountStates
    {
        let _v0 = signer::address_of(p0);
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v1 = &mut borrow_global_mut<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
        let _v2 = collateral_balance_sheet::balance_type_cross(_v0);
        let _v3 = collateral_balance_sheet::change_type_user_movement();
        collateral_balance_sheet::deposit_collateral(_v1, _v2, p1, _v3);
    }
    friend fun validate_order_placement(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: bool, p4: u64): option::Option<string::String>
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        order_margin::validate_order_placement(&borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral, p0, p1, p2, p3, p4)
    }
    friend fun add_secondary_asset(p0: &signer, p1: object::Object<fungible_asset::Metadata>, p2: oracle::OracleSource, p3: u64)
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        collateral_balance_sheet::add_secondary_asset(&mut borrow_global_mut<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral, p0, p1, p2, p3);
    }
    public fun is_asset_supported(p0: object::Object<fungible_asset::Metadata>): bool
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        collateral_balance_sheet::is_asset_supported(&borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral, p0)
    }
    public fun primary_asset_metadata(): object::Object<fungible_asset::Metadata>
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        collateral_balance_sheet::primary_asset_metadata(&borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral)
    }
    friend fun update_secondary_asset_oracle_price(p0: object::Object<fungible_asset::Metadata>, p1: u64)
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        collateral_balance_sheet::update_secondary_asset_oracle_price(&mut borrow_global_mut<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral, p0, p1);
    }
    friend fun distribute_fees(p0: &fee_distribution::FeeDistribution, p1: &fee_distribution::FeeDistribution)
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v0 = borrow_global_mut<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
        let _v1 = &mut _v0.collateral;
        let _v2 = liquidation_config::backstop_liquidator(&_v0.liquidation_config);
        trading_fees_manager::distribute_fees(p0, p1, _v1, _v2);
    }
    friend fun backstop_liquidator(): address
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        liquidation_config::backstop_liquidator(&borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).liquidation_config)
    }
    friend fun add_reduce_only_order(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: order_book_types::OrderIdType, p3: u64, p4: bool): vector<perp_engine_types::SingleOrderAction> {
        order_margin::add_reduce_only_order(p0, p1, p2, p3, p4)
    }
    public fun get_account_balance(p0: address): u64
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v0 = &borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
        let _v1 = collateral_balance_sheet::balance_type_cross(p0);
        collateral_balance_sheet::total_asset_collateral_value(_v0, _v1)
    }
    friend fun has_any_assets_or_positions(p0: address): bool
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        perp_positions::has_any_assets_or_positions(&borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral, p0)
    }
    friend fun is_position_liquidatable(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool): bool
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v0 = &borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v1 = &borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).liquidation_config;
        perp_positions::is_position_liquidatable(_v0, _v1, p0, p1, p2)
    }
    friend fun position_status(p0: address, p1: object::Object<perp_market::PerpMarket>): perp_positions::AccountStatusDetailed
        acquires GlobalAccountStates
    {
        let _v0 = perp_positions::position_status(&borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral, p0, p1);
        let _v1 = &borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).liquidation_config;
        perp_positions::add_liquidation_details(_v0, _v1)
    }
    friend fun transfer_balance_to_liquidator(p0: address, p1: address, p2: object::Object<perp_market::PerpMarket>)
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        perp_positions::transfer_balance_to_liquidator(&mut borrow_global_mut<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral, p0, p1, p2);
    }
    friend fun validate_liquidation_position_update(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: bool, p4: bool, p5: u64): position_update::UpdatePositionResult
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        position_update::validate_liquidation_position_update(&borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral, p0, p1, p2, p3, p4, p5)
    }
    friend fun validate_position_update(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: bool, p4: bool, p5: u64, p6: option::Option<builder_code_registry::BuilderCode>, p7: bool): position_update::UpdatePositionResult
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v0 = borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
        let _v1 = &_v0.collateral;
        let _v2 = &_v0.liquidation_config;
        position_update::validate_position_update(_v1, _v2, p0, p1, p2, p3, p4, p5, p6, p7)
    }
    friend fun validate_reduce_only_update(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: u64): position_update::ReduceOnlyValidationResult {
        position_update::validate_reduce_only_update(p0, p1, p2, p3)
    }
    friend fun add_pending_order(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: bool, p4: u64) {
        order_margin::add_pending_order(p0, p1, p2, p3, p4);
    }
    public fun available_order_margin(p0: address): u64
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        order_margin::available_order_margin(&borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral, p0)
    }
    public fun collateral_balance_precision(): math::Precision
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        collateral_balance_sheet::balance_precision(&borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral)
    }
    friend fun commit_update_position(p0: option::Option<order_book_types::OrderIdType>, p1: option::Option<string::String>, p2: u64, p3: bool, p4: u64, p5: option::Option<builder_code_registry::BuilderCode>, p6: position_update::UpdatePositionResult, p7: u128): (u64, bool, u8)
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v0 = borrow_global_mut<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
        let _v1 = &mut _v0.collateral;
        let _v2 = liquidation_config::backstop_liquidator(&_v0.liquidation_config);
        let (_v3,_v4,_v5) = position_update::commit_update(_v1, p0, p1, p2, p3, p4, p5, p6, _v2, p7);
        (_v3, _v4, _v5)
    }
    friend fun commit_update_position_with_backstop_liquidator(p0: u64, p1: bool, p2: u64, p3: position_update::UpdatePositionResult, p4: address): (u64, bool, u8)
        acquires GlobalAccountStates
    {
        let _v0 = position_update::extract_backstop_liquidator_covered_loss(&mut p3);
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v1 = borrow_global_mut<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
        if (_v0 > 0) {
            let _v2 = collateral_balance_sheet::balance_type_cross(p4);
            assert!(collateral_balance_sheet::balance_of_primary_asset_at_least(&_v1.collateral, _v2, _v0), 5);
            let _v3 = &mut _v1.collateral;
            let _v4 = collateral_balance_sheet::change_type_liquidation();
            collateral_balance_sheet::decrease_balance(_v3, _v2, _v0, _v4)
        };
        let _v5 = &mut _v1.collateral;
        let _v6 = option::none<order_book_types::OrderIdType>();
        let _v7 = option::none<string::String>();
        let _v8 = option::none<builder_code_registry::BuilderCode>();
        let _v9 = liquidation_config::backstop_liquidator(&_v1.liquidation_config);
        let (_v10,_v11,_v12) = position_update::commit_update(_v5, _v6, _v7, p0, p1, p2, _v8, p3, _v9, 0u128);
        (_v10, _v11, _v12)
    }
    friend fun deposit_to_isolated_position_margin(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: fungible_asset::FungibleAsset)
        acquires GlobalAccountStates
    {
        let _v0 = signer::address_of(p0);
        let _v1 = fungible_asset::asset_metadata(&p2);
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v2 = collateral_balance_sheet::primary_asset_metadata(&borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral);
        if (!(_v1 == _v2)) {
            let _v3 = error::invalid_argument(3);
            abort _v3
        };
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v4 = &mut borrow_global_mut<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
        let _v5 = collateral_balance_sheet::balance_type_isolated(_v0, p1);
        let _v6 = collateral_balance_sheet::change_type_user_movement();
        collateral_balance_sheet::deposit_collateral(_v4, _v5, p2, _v6);
    }
    public fun get_account_balance_fungible(p0: address): u64
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v0 = &borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
        let _v1 = collateral_balance_sheet::balance_type_cross(p0);
        let _v2 = collateral_balance_sheet::total_asset_collateral_value(_v0, _v1);
        collateral_balance_sheet::convert_balance_to_fungible_amount(_v0, _v2, false)
    }
    friend fun get_account_net_asset_value_fungible(p0: address, p1: bool): i64
        acquires GlobalAccountStates
    {
        let _v0;
        let _v1;
        let _v2;
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v3 = &borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
        let _v4 = perp_positions::get_account_net_asset_value(_v3, p0);
        if (_v4 >= 0i64) {
            _v2 = true;
            _v1 = _v4 as u64
        } else {
            _v2 = false;
            _v1 = (-_v4) as u64
        };
        if (_v2) _v0 = p1 else _v0 = !p1;
        let _v5 = collateral_balance_sheet::convert_balance_to_fungible_amount(_v3, _v1, _v0) as i64;
        if (_v2) return _v5;
        -_v5
    }
    public fun get_account_secondary_asset_balance(p0: address, p1: object::Object<fungible_asset::Metadata>): u64
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v0 = &borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
        let _v1 = collateral_balance_sheet::balance_type_cross(p0);
        collateral_balance_sheet::secondary_asset_fungible_amount(_v0, _v1, p1)
    }
    public fun get_account_usdc_balance(p0: address): i64
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v0 = &borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
        let _v1 = collateral_balance_sheet::balance_type_cross(p0);
        collateral_balance_sheet::balance_of_primary_asset(_v0, _v1)
    }
    public fun get_isolated_position_margin(p0: address, p1: object::Object<perp_market::PerpMarket>): u64
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v0 = &borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
        let _v1 = collateral_balance_sheet::balance_type_isolated(p0, p1);
        collateral_balance_sheet::total_asset_collateral_value(_v0, _v1)
    }
    public fun get_isolated_position_usdc_balance(p0: address, p1: object::Object<perp_market::PerpMarket>): i64
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v0 = &borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
        let _v1 = collateral_balance_sheet::balance_type_isolated(p0, p1);
        collateral_balance_sheet::balance_of_primary_asset(_v0, _v1)
    }
    friend fun get_user_usdc_balance(p0: address, p1: object::Object<perp_market::PerpMarket>): i64
        acquires GlobalAccountStates
    {
        let _v0 = perp_positions::is_position_isolated(p0, p1);
        'l0: loop {
            loop {
                if (_v0) {
                    if (exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75)) break;
                    abort 8
                };
                if (exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75)) break 'l0;
                abort 8
            };
            let _v1 = &borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
            let _v2 = collateral_balance_sheet::balance_type_isolated(p0, p1);
            return collateral_balance_sheet::balance_of_primary_asset(_v1, _v2)
        };
        let _v3 = &borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
        let _v4 = collateral_balance_sheet::balance_type_cross(p0);
        collateral_balance_sheet::balance_of_primary_asset(_v3, _v4)
    }
    friend fun max_allowed_withdraw_amount(p0: address, p1: object::Object<fungible_asset::Metadata>): u64
        acquires GlobalAccountStates
    {
        let _v0;
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v1 = &borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
        let _v2 = collateral_balance_sheet::primary_asset_metadata(_v1);
        loop {
            let _v3;
            let _v4;
            if (p1 == _v2) return perp_positions::max_allowed_primary_asset_withdraw_from_cross_margin(_v1, p0, 0i64) else {
                _v3 = p0;
                _v4 = p1;
                let _v5 = collateral_balance_sheet::balance_type_cross(_v3);
                _v0 = collateral_balance_sheet::secondary_asset_fungible_amount(_v1, _v5, _v4);
                if (!perp_positions::has_crossed_position(_v3)) break
            };
            let _v6 = perp_positions::free_collateral_for_crossed(_v1, _v3, 0i64);
            return math64::min(collateral_balance_sheet::fungible_amount_from_usd_value(_v1, _v6, _v4), _v0)
        };
        _v0
    }
    friend fun transfer_margin_fungible_to_isolated_position(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: u64)
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v0 = &mut borrow_global_mut<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
        let _v1 = collateral_balance_sheet::convert_fungible_to_balance_amount(freeze(_v0), p3);
        perp_positions::transfer_margin_to_isolated_position(_v0, p0, p1, p2, _v1);
    }
    friend fun validate_position_update_for_settlement(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: bool, p4: bool, p5: u64, p6: option::Option<builder_code_registry::BuilderCode>, p7: bool): position_update::UpdatePositionResult
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v0 = borrow_global<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75);
        let _v1 = &_v0.collateral;
        let _v2 = &_v0.liquidation_config;
        let _v3 = position_update::validate_position_update(_v1, _v2, p0, p1, p2, p3, p4, p5, p6, p7);
        let _v4 = &_v0.collateral;
        let _v5 = &_v0.liquidation_config;
        position_update::verify_position_update_result_for_settlement(_v4, _v5, p0, p1, p2, p3, p5, p7, _v3)
    }
    friend fun withdraw_fungible(p0: &signer, p1: object::Object<fungible_asset::Metadata>, p2: u64): fungible_asset::FungibleAsset
        acquires GlobalAccountStates
    {
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v0 = &mut borrow_global_mut<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
        let _v1 = signer::address_of(p0);
        let _v2 = collateral_balance_sheet::primary_asset_metadata(freeze(_v0));
        'l0: loop {
            let _v3;
            loop {
                let _v4;
                if (p1 == _v2) {
                    _v3 = collateral_balance_sheet::convert_fungible_to_balance_amount(freeze(_v0), p2);
                    if (perp_positions::is_max_allowed_withdraw_from_cross_margin_at_least(freeze(_v0), _v1, 0i64, _v3)) break;
                    abort 6
                };
                let _v5 = freeze(_v0);
                let _v6 = _v1;
                let _v7 = p1;
                let _v8 = collateral_balance_sheet::balance_type_cross(_v6);
                let _v9 = collateral_balance_sheet::secondary_asset_fungible_amount(_v5, _v8, _v7);
                if (perp_positions::has_crossed_position(_v6)) {
                    _v4 = perp_positions::free_collateral_for_crossed(_v5, _v6, 0i64);
                    _v4 = math64::min(collateral_balance_sheet::fungible_amount_from_usd_value(_v5, _v4, _v7), _v9)
                } else _v4 = _v9;
                if (p2 <= _v4) break 'l0;
                abort 6
            };
            let _v10 = collateral_balance_sheet::balance_type_cross(_v1);
            let _v11 = collateral_balance_sheet::change_type_user_movement();
            return collateral_balance_sheet::withdraw_primary_asset_unchecked(_v0, _v10, _v3, false, _v11)
        };
        let _v12 = collateral_balance_sheet::balance_type_cross(_v1);
        let _v13 = collateral_balance_sheet::change_type_user_movement();
        collateral_balance_sheet::withdraw_collateral_unchecked_for_asset(_v0, _v12, p2, p1, false, _v13)
    }
    friend fun withdraw_fungible_from_isolated_position_margin(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64): fungible_asset::FungibleAsset
        acquires GlobalAccountStates
    {
        let _v0 = signer::address_of(p0);
        assert!(exists<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75), 8);
        let _v1 = &mut borrow_global_mut<GlobalAccountStates>(@0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75).collateral;
        let _v2 = collateral_balance_sheet::convert_fungible_to_balance_amount(freeze(_v1), p2);
        assert!(perp_positions::max_allowed_primary_asset_withdraw_from_isolated_margin(freeze(_v1), _v0, p1) >= _v2, 6);
        let _v3 = collateral_balance_sheet::balance_type_isolated(_v0, p1);
        let _v4 = collateral_balance_sheet::change_type_user_movement();
        collateral_balance_sheet::withdraw_primary_asset_unchecked(_v1, _v3, _v2, false, _v4)
    }
}
