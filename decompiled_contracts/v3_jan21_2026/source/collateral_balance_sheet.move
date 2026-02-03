module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::collateral_balance_sheet {
    use 0x1::object;
    use 0x1::fungible_asset;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::i64_aggregator;
    use 0x1::table;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::math;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::oracle;
    use 0x1::signer;
    use 0x1::bcs;
    use 0x1::vector;
    use 0x1::primary_fungible_store;
    use 0x1::dispatchable_fungible_asset;
    use 0x1::event;
    use 0x1::error;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::fee_distribution;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_positions;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_update;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::accounts_collateral;
    struct AssetBalance has copy, drop, store {
        asset_type: object::Object<fungible_asset::Metadata>,
        balance: u64,
    }
    enum CollateralBalanceChangeEvent has drop, store {
        V1 {
            asset_type: object::Object<fungible_asset::Metadata>,
            balance_type: CollateralBalanceType,
            delta: i64,
            offset_balance_after: i64_aggregator::I64Snapshot,
            change_type: CollateralBalanceChangeType,
        }
    }
    enum CollateralBalanceType has copy, drop, store {
        Cross {
            account: address,
        }
        Isolated {
            account: address,
            market: object::Object<perp_market::PerpMarket>,
        }
    }
    enum CollateralBalanceChangeType has copy, drop, store {
        UserMovement,
        Fee,
        PnL,
        Margin,
        Liquidation,
        TestOnly,
    }
    struct CollateralBalanceSheet has store, key {
        primary_asset_type: object::Object<fungible_asset::Metadata>,
        primary_store: CollateralStore,
        primary_balance_table: table::Table<CollateralBalanceType, i64_aggregator::I64Aggregator>,
        secondary_stores: table::Table<object::Object<fungible_asset::Metadata>, SecondaryAssetInfo>,
        secondary_balance_tables: table::Table<CollateralBalanceType, SecondaryBalances>,
        balance_precision: math::Precision,
    }
    struct CollateralStore has store {
        asset_type: object::Object<fungible_asset::Metadata>,
        asset_precision: math::Precision,
        store: object::Object<fungible_asset::FungibleStore>,
        store_extend_ref: object::ExtendRef,
    }
    enum SecondaryAssetInfo has store {
        V1 {
            oracle_source: oracle::OracleSource,
            usd_value_per_unit: u64,
            haircut_bps: u64,
            store: CollateralStore,
        }
    }
    struct SecondaryBalances has drop, store {
        asset_balances: vector<AssetBalance>,
    }
    friend fun balance_precision(p0: &CollateralBalanceSheet): math::Precision {
        *&p0.balance_precision
    }
    friend fun usd_value_per_unit(p0: &CollateralBalanceSheet, p1: object::Object<fungible_asset::Metadata>): u64 {
        *&table::borrow<object::Object<fungible_asset::Metadata>,SecondaryAssetInfo>(&p0.secondary_stores, p1).usd_value_per_unit
    }
    friend fun haircut_bps(p0: &CollateralBalanceSheet, p1: object::Object<fungible_asset::Metadata>): u64 {
        *&table::borrow<object::Object<fungible_asset::Metadata>,SecondaryAssetInfo>(&p0.secondary_stores, p1).haircut_bps
    }
    friend fun initialize(p0: &signer, p1: object::Object<fungible_asset::Metadata>, p2: u8): CollateralBalanceSheet {
        let _v0 = create_collateral_store(p0, p1, vector[99u8, 111u8, 108u8, 108u8, 97u8, 116u8, 101u8, 114u8, 97u8, 108u8, 95u8, 98u8, 97u8, 108u8, 97u8, 110u8, 99u8, 101u8, 95u8, 115u8, 104u8, 101u8, 101u8, 116u8]);
        let _v1 = table::new<CollateralBalanceType,i64_aggregator::I64Aggregator>();
        let _v2 = table::new<object::Object<fungible_asset::Metadata>,SecondaryAssetInfo>();
        let _v3 = table::new<CollateralBalanceType,SecondaryBalances>();
        let _v4 = math::new_precision(p2);
        CollateralBalanceSheet{primary_asset_type: p1, primary_store: _v0, primary_balance_table: _v1, secondary_stores: _v2, secondary_balance_tables: _v3, balance_precision: _v4}
    }
    fun create_collateral_store(p0: &signer, p1: object::Object<fungible_asset::Metadata>, p2: vector<u8>): CollateralStore {
        let _v0 = object::create_named_object(p0, p2);
        let _v1 = object::generate_extend_ref(&_v0);
        let _v2 = primary_fungible_store::ensure_primary_store_exists<fungible_asset::Metadata>(object::address_from_constructor_ref(&_v0), p1);
        let _v3 = math::new_precision(fungible_asset::decimals<fungible_asset::Metadata>(p1));
        CollateralStore{asset_type: p1, asset_precision: _v3, store: _v2, store_extend_ref: _v1}
    }
    friend fun add_secondary_asset(p0: &mut CollateralBalanceSheet, p1: &signer, p2: object::Object<fungible_asset::Metadata>, p3: oracle::OracleSource, p4: u64) {
        assert!(signer::address_of(p1) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88, 5);
        let _v0 = vector[115u8, 101u8, 99u8, 111u8, 110u8, 100u8, 97u8, 114u8, 121u8, 95u8];
        let _v1 = object::object_address<fungible_asset::Metadata>(&p2);
        let _v2 = &mut _v0;
        let _v3 = bcs::to_bytes<address>(&_v1);
        vector::append<u8>(_v2, _v3);
        let _v4 = &p3;
        let _v5 = *&p0.balance_precision;
        let _v6 = oracle::get_oracle_data(_v4, _v5);
        let _v7 = oracle::get_price(&_v6);
        let _v8 = create_collateral_store(p1, p2, _v0);
        let _v9 = &mut p0.secondary_stores;
        let _v10 = SecondaryAssetInfo::V1{oracle_source: p3, usd_value_per_unit: _v7, haircut_bps: p4, store: _v8};
        table::add<object::Object<fungible_asset::Metadata>,SecondaryAssetInfo>(_v9, p2, _v10);
    }
    friend fun balance_of_primary_asset(p0: &CollateralBalanceSheet, p1: CollateralBalanceType): i64 {
        if (table::contains<CollateralBalanceType,i64_aggregator::I64Aggregator>(&p0.primary_balance_table, p1)) return i64_aggregator::read(table::borrow<CollateralBalanceType,i64_aggregator::I64Aggregator>(&p0.primary_balance_table, p1));
        0i64
    }
    friend fun balance_of_primary_asset_at_least(p0: &CollateralBalanceSheet, p1: CollateralBalanceType, p2: u64): bool {
        if (table::contains<CollateralBalanceType,i64_aggregator::I64Aggregator>(&p0.primary_balance_table, p1)) {
            let _v0 = table::borrow<CollateralBalanceType,i64_aggregator::I64Aggregator>(&p0.primary_balance_table, p1);
            let _v1 = p2 as i64;
            return i64_aggregator::is_at_least(_v0, _v1)
        };
        false
    }
    friend fun balance_of_secondary_assets(p0: &CollateralBalanceSheet, p1: CollateralBalanceType): u64 {
        let _v0 = 0;
        if (table::contains<CollateralBalanceType,SecondaryBalances>(&p0.secondary_balance_tables, p1)) {
            let _v1 = *&table::borrow<CollateralBalanceType,SecondaryBalances>(&p0.secondary_balance_tables, p1).asset_balances;
            let _v2 = 0;
            let _v3 = _v1;
            vector::reverse<AssetBalance>(&mut _v3);
            let _v4 = _v3;
            let _v5 = vector::length<AssetBalance>(&_v4);
            loop {
                let _v6;
                if (!(_v5 > 0)) break;
                let _v7 = vector::pop_back<AssetBalance>(&mut _v4);
                let _v8 = _v2;
                let _v9 = _v7;
                let _v10 = *&(&_v9).asset_type;
                let _v11 = *&(&_v9).balance;
                if (_v11 > 0) {
                    let _v12 = table::borrow<object::Object<fungible_asset::Metadata>,SecondaryAssetInfo>(&p0.secondary_stores, _v10);
                    let _v13 = *&_v12.usd_value_per_unit;
                    let _v14 = _v11 * _v13;
                    let _v15 = math::get_decimals_multiplier(&(&_v12.store).asset_precision);
                    _v6 = _v14 / _v15;
                    let _v16 = *&_v12.haircut_bps;
                    let _v17 = _v6 * _v16 / 10000;
                    _v6 = _v6 - _v17;
                    _v6 = _v8 + _v6
                } else _v6 = _v8;
                _v2 = _v6;
                _v5 = _v5 - 1;
                continue
            };
            vector::destroy_empty<AssetBalance>(_v4);
            _v0 = _v0 + _v2
        };
        _v0
    }
    friend fun balance_type_cross(p0: address): CollateralBalanceType {
        CollateralBalanceType::Cross{account: p0}
    }
    friend fun balance_type_isolated(p0: address, p1: object::Object<perp_market::PerpMarket>): CollateralBalanceType {
        CollateralBalanceType::Isolated{account: p0, market: p1}
    }
    friend fun change_type_fee(): CollateralBalanceChangeType {
        CollateralBalanceChangeType::Fee{}
    }
    friend fun change_type_liquidation(): CollateralBalanceChangeType {
        CollateralBalanceChangeType::Liquidation{}
    }
    friend fun change_type_margin(): CollateralBalanceChangeType {
        CollateralBalanceChangeType::Margin{}
    }
    friend fun change_type_pnl(): CollateralBalanceChangeType {
        CollateralBalanceChangeType::PnL{}
    }
    friend fun change_type_user_movement(): CollateralBalanceChangeType {
        CollateralBalanceChangeType::UserMovement{}
    }
    friend fun convert_balance_to_fungible_amount(p0: &CollateralBalanceSheet, p1: u64, p2: bool): u64 {
        let _v0 = &p0.balance_precision;
        let _v1 = &(&p0.primary_store).asset_precision;
        math::convert_decimals(p1, _v0, _v1, p2)
    }
    friend fun convert_fungible_to_balance_amount(p0: &CollateralBalanceSheet, p1: u64): u64 {
        let _v0 = &(&p0.primary_store).asset_precision;
        let _v1 = &p0.balance_precision;
        math::convert_decimals(p1, _v0, _v1, false)
    }
    fun create_empty_secondary_balances(): SecondaryBalances {
        SecondaryBalances{asset_balances: vector::empty<AssetBalance>()}
    }
    friend fun decrease_balance(p0: &mut CollateralBalanceSheet, p1: CollateralBalanceType, p2: u64, p3: CollateralBalanceChangeType) {
        let _v0;
        let _v1;
        loop {
            if (!(p2 == 0)) {
                _v1 = *&p0.primary_asset_type;
                _v0 = table::borrow_mut<CollateralBalanceType,i64_aggregator::I64Aggregator>(&mut p0.primary_balance_table, p1);
                let _v2 = freeze(_v0);
                let _v3 = p2 as i64;
                if (i64_aggregator::is_at_least(_v2, _v3)) break;
                abort 4
            };
            return ()
        };
        let _v4 = -(p2 as i64);
        i64_aggregator::add(_v0, _v4);
        let _v5 = freeze(_v0);
        emit_balance_change_event(_v1, _v5, _v4, p1, p3);
    }
    fun emit_balance_change_event(p0: object::Object<fungible_asset::Metadata>, p1: &i64_aggregator::I64Aggregator, p2: i64, p3: CollateralBalanceType, p4: CollateralBalanceChangeType) {
        let _v0 = i64_aggregator::snapshot(p1);
        event::emit<CollateralBalanceChangeEvent>(CollateralBalanceChangeEvent::V1{asset_type: p0, balance_type: p3, delta: p2, offset_balance_after: _v0, change_type: p4});
    }
    friend fun decrease_balance_unchecked(p0: &mut CollateralBalanceSheet, p1: CollateralBalanceType, p2: u64, p3: CollateralBalanceChangeType) {
        if (p2 == 0) return ();
        let _v0 = *&p0.primary_asset_type;
        let _v1 = table::borrow_mut<CollateralBalanceType,i64_aggregator::I64Aggregator>(&mut p0.primary_balance_table, p1);
        let _v2 = -(p2 as i64);
        i64_aggregator::add(_v1, _v2);
        let _v3 = freeze(_v1);
        emit_balance_change_event(_v0, _v3, _v2, p1, p3);
    }
    friend fun deposit_collateral(p0: &mut CollateralBalanceSheet, p1: CollateralBalanceType, p2: fungible_asset::FungibleAsset, p3: CollateralBalanceChangeType) {
        let _v0;
        let _v1;
        let _v2 = fungible_asset::metadata_from_asset(&p2);
        let _v3 = *&p0.primary_asset_type;
        loop {
            if (!(_v2 == _v3)) {
                _v1 = fungible_asset::amount(&p2);
                assert!(table::contains<object::Object<fungible_asset::Metadata>,SecondaryAssetInfo>(&p0.secondary_stores, _v2), 0);
                _v0 = table::borrow<object::Object<fungible_asset::Metadata>,SecondaryAssetInfo>(&p0.secondary_stores, _v2);
                if (table::contains<CollateralBalanceType,SecondaryBalances>(&p0.secondary_balance_tables, p1)) break;
                let _v4 = &mut p0.secondary_balance_tables;
                let _v5 = create_empty_secondary_balances();
                table::add<CollateralBalanceType,SecondaryBalances>(_v4, p1, _v5);
                break
            };
            let _v6 = freeze(p0);
            let _v7 = fungible_asset::amount(&p2);
            _v1 = convert_fungible_to_balance_amount(_v6, _v7);
            let _v8 = &mut p0.primary_balance_table;
            let _v9 = i64_aggregator::new_i64_aggregator();
            let _v10 = table::borrow_mut_with_default<CollateralBalanceType,i64_aggregator::I64Aggregator>(_v8, p1, _v9);
            let _v11 = _v1 as i64;
            i64_aggregator::add(_v10, _v11);
            let _v12 = freeze(_v10);
            let _v13 = _v1 as i64;
            emit_balance_change_event(_v2, _v12, _v13, p1, p3);
            dispatchable_fungible_asset::deposit<fungible_asset::FungibleStore>(*&(&p0.primary_store).store, p2);
            return ()
        };
        let _v14 = get_secondary_balance_mut(table::borrow_mut<CollateralBalanceType,SecondaryBalances>(&mut p0.secondary_balance_tables, p1), _v2);
        let _v15 = _v14;
        *_v15 = *_v15 + _v1;
        let _v16 = *_v14;
        let _v17 = _v1 as i64;
        emit_secondary_balance_change_event(_v2, _v16, _v17, p1, p3);
        dispatchable_fungible_asset::deposit<fungible_asset::FungibleStore>(*&(&_v0.store).store, p2);
    }
    fun get_secondary_balance_mut(p0: &mut SecondaryBalances, p1: object::Object<fungible_asset::Metadata>): &mut u64 {
        let _v0 = &mut p0.asset_balances;
        let _v1 = freeze(_v0);
        let _v2 = false;
        let _v3 = 0;
        let _v4 = 0;
        let _v5 = vector::length<AssetBalance>(_v1);
        'l0: loop {
            loop {
                if (!(_v4 < _v5)) break 'l0;
                let _v6 = &vector::borrow<AssetBalance>(_v1, _v4).asset_type;
                let _v7 = &p1;
                if (_v6 == _v7) break;
                _v4 = _v4 + 1;
                continue
            };
            _v2 = true;
            _v3 = _v4;
            break
        };
        let _v8 = _v3;
        if (_v2) return &mut vector::borrow_mut<AssetBalance>(_v0, _v8).balance;
        let _v9 = AssetBalance{asset_type: p1, balance: 0};
        vector::push_back<AssetBalance>(_v0, _v9);
        _v8 = vector::length<AssetBalance>(freeze(_v0)) - 1;
        &mut vector::borrow_mut<AssetBalance>(_v0, _v8).balance
    }
    fun emit_secondary_balance_change_event(p0: object::Object<fungible_asset::Metadata>, p1: u64, p2: i64, p3: CollateralBalanceType, p4: CollateralBalanceChangeType) {
        let _v0 = i64_aggregator::create_i64_snapshot(p1 as i64);
        event::emit<CollateralBalanceChangeEvent>(CollateralBalanceChangeEvent::V1{asset_type: p0, balance_type: p3, delta: p2, offset_balance_after: _v0, change_type: p4});
    }
    friend fun deposit_to_user(p0: &mut CollateralBalanceSheet, p1: CollateralBalanceType, p2: u64, p3: CollateralBalanceChangeType) {
        if (p2 == 0) return ();
        let _v0 = *&p0.primary_asset_type;
        let _v1 = &mut p0.primary_balance_table;
        let _v2 = i64_aggregator::new_i64_aggregator();
        let _v3 = table::borrow_mut_with_default<CollateralBalanceType,i64_aggregator::I64Aggregator>(_v1, p1, _v2);
        let _v4 = p2 as i64;
        i64_aggregator::add(_v3, _v4);
        let _v5 = freeze(_v3);
        let _v6 = p2 as i64;
        emit_balance_change_event(_v0, _v5, _v6, p1, p3);
    }
    friend fun fungible_amount_from_usd_value(p0: &CollateralBalanceSheet, p1: u64, p2: object::Object<fungible_asset::Metadata>): u64 {
        let _v0 = table::borrow<object::Object<fungible_asset::Metadata>,SecondaryAssetInfo>(&p0.secondary_stores, p2);
        let _v1 = math::get_decimals_multiplier(&(&_v0.store).asset_precision);
        let _v2 = *&_v0.usd_value_per_unit;
        if (!(_v2 != 0)) {
            let _v3 = error::invalid_argument(4);
            abort _v3
        };
        let _v4 = p1 as u128;
        let _v5 = _v1 as u128;
        let _v6 = _v4 * _v5;
        let _v7 = _v2 as u128;
        (_v6 / _v7) as u64
    }
    friend fun get_account_from_balance_type(p0: &CollateralBalanceType): address {
        *&p0.account
    }
    friend fun get_primary_store_balance_in_balance_precision(p0: &CollateralBalanceSheet): u64 {
        let _v0 = fungible_asset::balance<fungible_asset::FungibleStore>(*&(&p0.primary_store).store);
        convert_fungible_to_balance_amount(p0, _v0)
    }
    fun get_secondary_balance(p0: &SecondaryBalances, p1: object::Object<fungible_asset::Metadata>): u64 {
        let _v0 = &p0.asset_balances;
        let _v1 = _v0;
        let _v2 = false;
        let _v3 = 0;
        let _v4 = 0;
        let _v5 = vector::length<AssetBalance>(_v1);
        'l0: loop {
            loop {
                if (!(_v4 < _v5)) break 'l0;
                let _v6 = &vector::borrow<AssetBalance>(_v1, _v4).asset_type;
                let _v7 = &p1;
                if (_v6 == _v7) break;
                _v4 = _v4 + 1;
                continue
            };
            _v2 = true;
            _v3 = _v4;
            break
        };
        if (_v2) return *&vector::borrow<AssetBalance>(_v0, _v3).balance;
        0
    }
    friend fun has_any_assets(p0: &CollateralBalanceSheet, p1: CollateralBalanceType): bool {
        if (balance_of_primary_asset(p0, p1) != 0i64) return true;
        balance_of_secondary_assets(p0, p1) > 0
    }
    friend fun is_asset_supported(p0: &CollateralBalanceSheet, p1: object::Object<fungible_asset::Metadata>): bool {
        let _v0 = *&p0.primary_asset_type;
        if (p1 == _v0) return true;
        table::contains<object::Object<fungible_asset::Metadata>,SecondaryAssetInfo>(&p0.secondary_stores, p1)
    }
    friend fun primary_asset_metadata(p0: &CollateralBalanceSheet): object::Object<fungible_asset::Metadata> {
        *&p0.primary_asset_type
    }
    friend fun secondary_asset_fungible_amount(p0: &CollateralBalanceSheet, p1: CollateralBalanceType, p2: object::Object<fungible_asset::Metadata>): u64 {
        if (table::contains<CollateralBalanceType,SecondaryBalances>(&p0.secondary_balance_tables, p1)) return get_secondary_balance(table::borrow<CollateralBalanceType,SecondaryBalances>(&p0.secondary_balance_tables, p1), p2);
        0
    }
    friend fun total_asset_collateral_value(p0: &CollateralBalanceSheet, p1: CollateralBalanceType): u64 {
        let _v0 = balance_of_primary_asset(p0, p1);
        let _v1 = balance_of_secondary_assets(p0, p1) as i64;
        let _v2 = _v0 + _v1;
        if (_v2 > 0i64) return _v2 as u64;
        0
    }
    friend fun transfer_from_crossed_to_isolated(p0: &mut CollateralBalanceSheet, p1: address, p2: u64, p3: object::Object<perp_market::PerpMarket>, p4: CollateralBalanceChangeType) {
        let _v0 = balance_type_cross(p1);
        let _v1 = balance_type_isolated(p1, p3);
        transfer_primary_asset(p0, _v0, _v1, p2, p4, p4);
    }
    fun transfer_primary_asset(p0: &mut CollateralBalanceSheet, p1: CollateralBalanceType, p2: CollateralBalanceType, p3: u64, p4: CollateralBalanceChangeType, p5: CollateralBalanceChangeType) {
        if (p3 == 0) return ();
        let _v0 = *&p0.primary_asset_type;
        let _v1 = table::borrow_mut<CollateralBalanceType,i64_aggregator::I64Aggregator>(&mut p0.primary_balance_table, p1);
        let _v2 = -(p3 as i64);
        i64_aggregator::add(_v1, _v2);
        let _v3 = freeze(_v1);
        emit_balance_change_event(_v0, _v3, _v2, p1, p4);
        let _v4 = &mut p0.primary_balance_table;
        let _v5 = i64_aggregator::new_i64_aggregator();
        _v1 = table::borrow_mut_with_default<CollateralBalanceType,i64_aggregator::I64Aggregator>(_v4, p2, _v5);
        let _v6 = p3 as i64;
        i64_aggregator::add(_v1, _v6);
        let _v7 = freeze(_v1);
        let _v8 = p3 as i64;
        emit_balance_change_event(_v0, _v7, _v8, p2, p5);
    }
    friend fun transfer_from_isolated_to_crossed(p0: &mut CollateralBalanceSheet, p1: address, p2: u64, p3: object::Object<perp_market::PerpMarket>, p4: CollateralBalanceChangeType) {
        let _v0 = balance_type_isolated(p1, p3);
        let _v1 = balance_type_cross(p1);
        transfer_primary_asset(p0, _v0, _v1, p2, p4, p4);
    }
    friend fun transfer_to_backstop_liquidator(p0: &mut CollateralBalanceSheet, p1: CollateralBalanceType, p2: CollateralBalanceType) {
        let _v0;
        let _v1 = change_type_liquidation();
        let _v2 = change_type_liquidation();
        if (table::contains<CollateralBalanceType,i64_aggregator::I64Aggregator>(&p0.primary_balance_table, p1)) {
            let _v3 = table::remove<CollateralBalanceType,i64_aggregator::I64Aggregator>(&mut p0.primary_balance_table, p1);
            let _v4 = i64_aggregator::read(&_v3);
            _v0 = primary_asset_metadata(freeze(p0));
            let _v5 = &_v3;
            let _v6 = -_v4;
            emit_balance_change_event(_v0, _v5, _v6, p1, _v2);
            let _v7 = &mut p0.primary_balance_table;
            let _v8 = i64_aggregator::new_i64_aggregator();
            let _v9 = table::borrow_mut_with_default<CollateralBalanceType,i64_aggregator::I64Aggregator>(_v7, p2, _v8);
            i64_aggregator::add(_v9, _v4);
            let _v10 = freeze(_v9);
            emit_balance_change_event(_v0, _v10, _v4, p2, _v1)
        };
        if (table::contains<CollateralBalanceType,SecondaryBalances>(&p0.secondary_balance_tables, p1)) {
            if (!table::contains<CollateralBalanceType,SecondaryBalances>(&p0.secondary_balance_tables, p2)) {
                let _v11 = &mut p0.secondary_balance_tables;
                let _v12 = create_empty_secondary_balances();
                table::add<CollateralBalanceType,SecondaryBalances>(_v11, p2, _v12)
            };
            let _v13 = table::remove<CollateralBalanceType,SecondaryBalances>(&mut p0.secondary_balance_tables, p1);
            let _v14 = *&(&_v13).asset_balances;
            let _v15 = table::borrow_mut<CollateralBalanceType,SecondaryBalances>(&mut p0.secondary_balance_tables, p2);
            let _v16 = _v14;
            vector::reverse<AssetBalance>(&mut _v16);
            let _v17 = _v16;
            let _v18 = vector::length<AssetBalance>(&_v17);
            while (_v18 > 0) {
                let _v19 = vector::pop_back<AssetBalance>(&mut _v17);
                _v0 = *&(&_v19).asset_type;
                let _v20 = *&(&_v19).balance;
                if (_v20 > 0) {
                    let _v21 = get_secondary_balance_mut(_v15, _v0);
                    let _v22 = _v21;
                    *_v22 = *_v22 + _v20;
                    let _v23 = -(_v20 as i64);
                    emit_secondary_balance_change_event(_v0, 0, _v23, p1, _v2);
                    let _v24 = *_v21;
                    let _v25 = _v20 as i64;
                    emit_secondary_balance_change_event(_v0, _v24, _v25, p2, _v1)
                };
                _v18 = _v18 - 1;
                continue
            };
            vector::destroy_empty<AssetBalance>(_v17);
            return ()
        };
    }
    friend fun update_haircut_bps(p0: &mut CollateralBalanceSheet, p1: object::Object<fungible_asset::Metadata>, p2: u64) {
        let _v0 = *&p0.primary_asset_type;
        assert!(p1 != _v0, 0);
        let _v1 = &mut table::borrow_mut<object::Object<fungible_asset::Metadata>,SecondaryAssetInfo>(&mut p0.secondary_stores, p1).haircut_bps;
        *_v1 = p2;
    }
    friend fun update_secondary_asset_oracle_price(p0: &mut CollateralBalanceSheet, p1: object::Object<fungible_asset::Metadata>, p2: u64) {
        oracle::update_internal_oracle_price(&table::borrow_mut<object::Object<fungible_asset::Metadata>,SecondaryAssetInfo>(&mut p0.secondary_stores, p1).oracle_source, p2);
        update_usd_value_from_oracle(p0, p1);
    }
    friend fun update_usd_value_from_oracle(p0: &mut CollateralBalanceSheet, p1: object::Object<fungible_asset::Metadata>) {
        let _v0 = *&p0.balance_precision;
        let _v1 = table::borrow_mut<object::Object<fungible_asset::Metadata>,SecondaryAssetInfo>(&mut p0.secondary_stores, p1);
        let _v2 = oracle::get_oracle_data(&_v1.oracle_source, _v0);
        let _v3 = oracle::get_price(&_v2);
        let _v4 = &mut _v1.usd_value_per_unit;
        *_v4 = _v3;
    }
    friend fun withdraw_collateral_unchecked_for_asset(p0: &mut CollateralBalanceSheet, p1: CollateralBalanceType, p2: u64, p3: object::Object<fungible_asset::Metadata>, p4: bool, p5: CollateralBalanceChangeType): fungible_asset::FungibleAsset {
        let _v0;
        let _v1;
        if (!(p2 > 0)) {
            let _v2 = error::invalid_argument(2);
            abort _v2
        };
        let _v3 = *&p0.primary_asset_type;
        loop {
            if (!(p3 == _v3)) {
                assert!(table::contains<object::Object<fungible_asset::Metadata>,SecondaryAssetInfo>(&p0.secondary_stores, p3), 0);
                assert!(table::contains<CollateralBalanceType,SecondaryBalances>(&p0.secondary_balance_tables, p1), 0);
                _v1 = &table::borrow<object::Object<fungible_asset::Metadata>,SecondaryAssetInfo>(&p0.secondary_stores, p3).store;
                _v0 = get_secondary_balance_mut(table::borrow_mut<CollateralBalanceType,SecondaryBalances>(&mut p0.secondary_balance_tables, p1), p3);
                if (*_v0 >= p2) break;
                let _v4 = error::invalid_argument(1);
                abort _v4
            };
            let _v5 = convert_balance_to_fungible_amount(freeze(p0), p2, p4);
            let _v6 = table::borrow_mut<CollateralBalanceType,i64_aggregator::I64Aggregator>(&mut p0.primary_balance_table, p1);
            let _v7 = -(p2 as i64);
            i64_aggregator::add(_v6, _v7);
            let _v8 = freeze(_v6);
            emit_balance_change_event(p3, _v8, _v7, p1, p5);
            let _v9 = object::generate_signer_for_extending(&(&p0.primary_store).store_extend_ref);
            let _v10 = &_v9;
            let _v11 = *&(&p0.primary_store).store;
            return dispatchable_fungible_asset::withdraw<fungible_asset::FungibleStore>(_v10, _v11, _v5)
        };
        let _v12 = _v0;
        *_v12 = *_v12 - p2;
        let _v13 = *_v0;
        let _v14 = -(p2 as i64);
        emit_secondary_balance_change_event(p3, _v13, _v14, p1, p5);
        let _v15 = object::generate_signer_for_extending(&_v1.store_extend_ref);
        let _v16 = &_v15;
        let _v17 = *&_v1.store;
        dispatchable_fungible_asset::withdraw<fungible_asset::FungibleStore>(_v16, _v17, p2)
    }
    friend fun withdraw_primary_asset_unchecked(p0: &mut CollateralBalanceSheet, p1: CollateralBalanceType, p2: u64, p3: bool, p4: CollateralBalanceChangeType): fungible_asset::FungibleAsset {
        let _v0 = *&p0.primary_asset_type;
        withdraw_collateral_unchecked_for_asset(p0, p1, p2, _v0, p3, p4)
    }
}
