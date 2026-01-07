/// ============================================================================
/// Module: collateral_balance_sheet
/// Description: Core collateral tracking with multi-asset support
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module is the foundation of collateral management on Decibel. It tracks:
/// - Primary asset (USDC) balances per account
/// - Secondary asset balances (other collateral types)
/// - Cross-margin vs isolated-margin positions
/// - Balance changes with full audit trail
///
/// Key Concepts:
///
/// 1. Balance Types:
///    - Cross: Shared collateral across all positions for an account
///    - Isolated: Collateral locked to a specific market/position
///
/// 2. Asset Types:
///    - Primary (USDC): Main collateral, can go negative (borrowing)
///    - Secondary: Other tokens with haircuts applied to value
///
/// 3. Balance Precision:
///    - Uses internal precision (8 decimals) for calculations
///    - Converts to/from fungible asset precision (6 decimals) for actual tokens
///
/// 4. Audit Trail:
///    - Every balance change emits events with change type
///    - Change types: UserMovement, Fee, PnL, Margin, Liquidation, TestOnly
///
/// This module uses friend declarations to restrict access to trusted modules.
/// ============================================================================

module decibel::collateral_balance_sheet {
    use aptos_framework::object::{Self, Object, ExtendRef};
    use aptos_framework::fungible_asset::{Self, FungibleAsset, FungibleStore, Metadata};
    use aptos_framework::table::{Self, Table};
    use aptos_framework::signer;
    use aptos_framework::bcs;
    use aptos_framework::vector;
    use aptos_framework::primary_fungible_store;
    use aptos_framework::dispatchable_fungible_asset;
    use aptos_framework::event;
    use aptos_framework::error;

    use decibel::i64_aggregator::{Self, I64Aggregator, I64Snapshot};
    use decibel::math::{Self, Precision};
    use decibel::perp_market::PerpMarket;
    use decibel::oracle::{Self, OracleSource};

    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================

    /// Fee distribution module for handling fee payments
    friend decibel::fee_distribution;

    /// Position tracking for PnL settlements
    friend decibel::perp_positions;

    /// Position update for margin changes
    friend decibel::position_update;

    /// Accounts collateral for deposits/withdrawals
    friend decibel::accounts_collateral;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// Contract address for verification
    const DECIBEL_ADDRESS: address = @0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844;

    /// Object seed for the primary collateral store
    const COLLATERAL_STORE_SEED: vector<u8> = b"collateral_balance_sheet";

    /// Prefix for secondary asset store creation
    const SECONDARY_STORE_PREFIX: vector<u8> = b"secondary_";

    /// Basis points divisor (10000 = 100%)
    const BPS_DIVISOR: u64 = 10000;

    /// Error codes
    const E_UNSUPPORTED_ASSET: u64 = 0;
    const E_INSUFFICIENT_BALANCE: u64 = 1;
    const E_ZERO_AMOUNT: u64 = 2;
    const E_BALANCE_CHECK_FAILED: u64 = 4;
    const E_UNAUTHORIZED: u64 = 5;

    // =========================================================================
    // TYPES - BALANCE TRACKING
    // =========================================================================

    /// Tracks balance for a secondary asset
    struct AssetBalance has copy, drop, store {
        /// The metadata object identifying the asset type
        asset_type: Object<Metadata>,
        /// Balance amount in asset's native precision
        balance: u64,
    }

    /// Event emitted when collateral balance changes
    enum CollateralBalanceChangeEvent has drop, store {
        V1 {
            /// The asset type that changed
            asset_type: Object<Metadata>,
            /// Which balance changed (cross or isolated)
            balance_type: CollateralBalanceType,
            /// Signed change amount (negative for decrease)
            delta: i64,
            /// Snapshot of balance after change (for verification)
            offset_balance_after: I64Snapshot,
            /// Reason for the change
            change_type: CollateralBalanceChangeType,
        }
    }

    /// Identifies a specific balance (cross-margin or isolated position)
    enum CollateralBalanceType has copy, drop, store {
        /// Cross-margin balance shared across positions
        Cross {
            account: address,
        },
        /// Isolated-margin balance for a specific market
        Isolated {
            account: address,
            market: Object<PerpMarket>,
        }
    }

    /// Reason for balance change (for audit trail)
    enum CollateralBalanceChangeType has copy, drop, store {
        /// User deposit or withdrawal
        UserMovement,
        /// Trading fee charged or rebate
        Fee,
        /// Realized profit and loss
        PnL,
        /// Margin requirement change
        Margin,
        /// Liquidation-related transfer
        Liquidation,
        /// Testing purposes only
        TestOnly,
    }

    // =========================================================================
    // TYPES - STORAGE
    // =========================================================================

    /// Main collateral balance sheet storage
    /// One instance exists globally, storing all user balances
    struct CollateralBalanceSheet has store, key {
        /// The primary collateral asset (USDC)
        primary_asset_type: Object<Metadata>,
        /// Store holding the actual primary asset tokens
        primary_store: CollateralStore,
        /// Primary asset balances per account: CollateralBalanceType -> signed balance
        primary_balance_table: Table<CollateralBalanceType, I64Aggregator>,
        /// Secondary asset configurations: asset metadata -> SecondaryAssetInfo
        secondary_stores: Table<Object<Metadata>, SecondaryAssetInfo>,
        /// Secondary asset balances per account: CollateralBalanceType -> balances
        secondary_balance_tables: Table<CollateralBalanceType, SecondaryBalances>,
        /// Precision for internal balance calculations (typically 8 decimals)
        balance_precision: Precision,
    }

    /// Storage for fungible asset tokens
    struct CollateralStore has store {
        /// The asset type this store holds
        asset_type: Object<Metadata>,
        /// Decimal precision of this asset (e.g., 6 for USDC)
        asset_precision: Precision,
        /// The actual fungible store holding tokens
        store: Object<FungibleStore>,
        /// Reference for generating signers to withdraw
        store_extend_ref: ExtendRef,
    }

    /// Configuration for a secondary collateral asset
    enum SecondaryAssetInfo has store {
        V1 {
            /// Oracle source for price feed
            oracle_source: OracleSource,
            /// Current USD value per unit (in balance precision)
            usd_value_per_unit: u64,
            /// Haircut in basis points (reduces effective collateral value)
            /// e.g., 2000 = 20% haircut, so 80% of value counts
            haircut_bps: u64,
            /// Store holding the actual tokens
            store: CollateralStore,
        }
    }

    /// Container for secondary asset balances for an account
    struct SecondaryBalances has drop, store {
        /// List of (asset, balance) pairs
        asset_balances: vector<AssetBalance>,
    }

    // =========================================================================
    // FRIEND FUNCTIONS - INITIALIZATION
    // =========================================================================

    /// Initializes the collateral balance sheet
    ///
    /// # Arguments
    /// * `admin` - Contract admin signer
    /// * `primary_asset` - The primary collateral asset (USDC)
    /// * `balance_decimals` - Decimal precision for internal calculations
    ///
    /// # Returns
    /// New CollateralBalanceSheet struct
    friend fun initialize(
        admin: &signer,
        primary_asset: Object<Metadata>,
        balance_decimals: u8
    ): CollateralBalanceSheet {
        let primary_store = create_collateral_store(admin, primary_asset, COLLATERAL_STORE_SEED);

        CollateralBalanceSheet {
            primary_asset_type: primary_asset,
            primary_store,
            primary_balance_table: table::new<CollateralBalanceType, I64Aggregator>(),
            secondary_stores: table::new<Object<Metadata>, SecondaryAssetInfo>(),
            secondary_balance_tables: table::new<CollateralBalanceType, SecondaryBalances>(),
            balance_precision: math::new_precision(balance_decimals),
        }
    }

    /// Adds a secondary collateral asset type
    ///
    /// # Arguments
    /// * `sheet` - The balance sheet to modify
    /// * `admin` - Admin signer (must be contract address)
    /// * `asset` - The new asset type to support
    /// * `oracle` - Oracle source for price feed
    /// * `haircut_bps` - Haircut percentage in basis points
    friend fun add_secondary_asset(
        sheet: &mut CollateralBalanceSheet,
        admin: &signer,
        asset: Object<Metadata>,
        oracle: OracleSource,
        haircut_bps: u64
    ) {
        assert!(signer::address_of(admin) == DECIBEL_ADDRESS, E_UNAUTHORIZED);

        // Create unique seed for secondary store
        let seed = SECONDARY_STORE_PREFIX;
        let asset_addr = object::object_address(&asset);
        let addr_bytes = bcs::to_bytes(&asset_addr);
        vector::append(&mut seed, addr_bytes);

        // Get initial price from oracle
        let oracle_data = oracle::get_oracle_data(&mut oracle, sheet.balance_precision);
        let initial_price = oracle::get_price(&oracle_data);

        // Create store and add to registry
        let store = create_collateral_store(admin, asset, seed);
        let info = SecondaryAssetInfo::V1 {
            oracle_source: oracle,
            usd_value_per_unit: initial_price,
            haircut_bps,
            store,
        };

        table::add(&mut sheet.secondary_stores, asset, info);
    }

    // =========================================================================
    // FRIEND FUNCTIONS - BALANCE TYPE CONSTRUCTORS
    // =========================================================================

    /// Creates a cross-margin balance type for an account
    friend fun balance_type_cross(account: address): CollateralBalanceType {
        CollateralBalanceType::Cross { account }
    }

    /// Creates an isolated-margin balance type for an account's market position
    friend fun balance_type_isolated(
        account: address,
        market: Object<PerpMarket>
    ): CollateralBalanceType {
        CollateralBalanceType::Isolated { account, market }
    }

    // =========================================================================
    // FRIEND FUNCTIONS - CHANGE TYPE CONSTRUCTORS
    // =========================================================================

    /// User-initiated deposit or withdrawal
    friend fun change_type_user_movement(): CollateralBalanceChangeType {
        CollateralBalanceChangeType::UserMovement
    }

    /// Trading fee charged or rebate
    friend fun change_type_fee(): CollateralBalanceChangeType {
        CollateralBalanceChangeType::Fee
    }

    /// Profit and loss realization
    friend fun change_type_pnl(): CollateralBalanceChangeType {
        CollateralBalanceChangeType::PnL
    }

    /// Margin requirement change
    friend fun change_type_margin(): CollateralBalanceChangeType {
        CollateralBalanceChangeType::Margin
    }

    /// Liquidation-related transfer
    friend fun change_type_liquidation(): CollateralBalanceChangeType {
        CollateralBalanceChangeType::Liquidation
    }

    // =========================================================================
    // FRIEND FUNCTIONS - BALANCE QUERIES
    // =========================================================================

    /// Returns the balance precision used for calculations
    friend fun balance_precision(sheet: &CollateralBalanceSheet): Precision {
        sheet.balance_precision
    }

    /// Returns the primary asset metadata (USDC)
    friend fun primary_asset_metadata(sheet: &CollateralBalanceSheet): Object<Metadata> {
        sheet.primary_asset_type
    }

    /// Checks if an asset type is supported (primary or secondary)
    friend fun is_asset_supported(sheet: &CollateralBalanceSheet, asset: Object<Metadata>): bool {
        if (asset == sheet.primary_asset_type) {
            return true
        };
        table::contains(&sheet.secondary_stores, asset)
    }

    /// Gets the primary asset balance for a balance type (can be negative)
    friend fun balance_of_primary_asset(
        sheet: &CollateralBalanceSheet,
        balance_type: CollateralBalanceType
    ): i64 {
        if (table::contains(&sheet.primary_balance_table, balance_type)) {
            return i64_aggregator::read(table::borrow(&sheet.primary_balance_table, balance_type))
        };
        0i64
    }

    /// Checks if primary asset balance is at least a threshold
    friend fun balance_of_primary_asset_at_least(
        sheet: &CollateralBalanceSheet,
        balance_type: CollateralBalanceType,
        threshold: u64
    ): bool {
        if (table::contains(&sheet.primary_balance_table, balance_type)) {
            let aggregator = table::borrow(&sheet.primary_balance_table, balance_type);
            return i64_aggregator::is_at_least(aggregator, threshold as i64)
        };
        false
    }

    /// Gets total USD value of secondary assets (with haircut applied)
    friend fun balance_of_secondary_assets(
        sheet: &CollateralBalanceSheet,
        balance_type: CollateralBalanceType
    ): u64 {
        let total = 0u64;

        if (!table::contains(&sheet.secondary_balance_tables, balance_type)) {
            return total
        };

        let balances = table::borrow(&sheet.secondary_balance_tables, balance_type);

        // Sum up value of each secondary asset
        let i = 0;
        let len = vector::length(&balances.asset_balances);
        while (i < len) {
            let asset_balance = vector::borrow(&balances.asset_balances, i);
            let asset = asset_balance.asset_type;
            let balance = asset_balance.balance;

            if (balance > 0) {
                let info = table::borrow(&sheet.secondary_stores, asset);

                // Calculate USD value: balance * price / asset_precision
                let price = info.usd_value_per_unit;
                let usd_value = balance * price;
                let asset_decimals = math::get_decimals_multiplier(&info.store.asset_precision);
                let value = usd_value / asset_decimals;

                // Apply haircut
                let haircut_amount = value * info.haircut_bps / BPS_DIVISOR;
                let effective_value = value - haircut_amount;

                total = total + effective_value;
            };

            i = i + 1;
        };

        total
    }

    /// Gets total collateral value (primary + secondary with haircuts)
    friend fun total_asset_collateral_value(
        sheet: &CollateralBalanceSheet,
        balance_type: CollateralBalanceType
    ): u64 {
        let primary = balance_of_primary_asset(sheet, balance_type);
        let secondary = balance_of_secondary_assets(sheet, balance_type) as i64;
        let total = primary + secondary;

        if (total > 0) {
            return total as u64
        };
        0
    }

    /// Checks if account has any assets (primary or secondary)
    friend fun has_any_assets(
        sheet: &CollateralBalanceSheet,
        balance_type: CollateralBalanceType
    ): bool {
        if (balance_of_primary_asset(sheet, balance_type) != 0) {
            return true
        };
        balance_of_secondary_assets(sheet, balance_type) > 0
    }

    /// Gets account address from balance type
    friend fun get_account_from_balance_type(balance_type: &CollateralBalanceType): address {
        balance_type.account
    }

    /// Gets secondary asset balance for specific asset
    friend fun secondary_asset_fungible_amount(
        sheet: &CollateralBalanceSheet,
        balance_type: CollateralBalanceType,
        asset: Object<Metadata>
    ): u64 {
        if (table::contains(&sheet.secondary_balance_tables, balance_type)) {
            return get_secondary_balance(
                table::borrow(&sheet.secondary_balance_tables, balance_type),
                asset
            )
        };
        0
    }

    /// Gets primary store balance in internal precision
    friend fun get_primary_store_balance_in_balance_precision(sheet: &CollateralBalanceSheet): u64 {
        let fungible_balance = fungible_asset::balance(sheet.primary_store.store);
        convert_fungible_to_balance_amount(sheet, fungible_balance)
    }

    /// Gets USD value per unit for secondary asset
    friend fun usd_value_per_unit(sheet: &CollateralBalanceSheet, asset: Object<Metadata>): u64 {
        table::borrow(&sheet.secondary_stores, asset).usd_value_per_unit
    }

    /// Gets haircut percentage for secondary asset
    friend fun haircut_bps(sheet: &CollateralBalanceSheet, asset: Object<Metadata>): u64 {
        table::borrow(&sheet.secondary_stores, asset).haircut_bps
    }

    // =========================================================================
    // FRIEND FUNCTIONS - PRECISION CONVERSION
    // =========================================================================

    /// Converts internal balance precision to fungible asset precision
    friend fun convert_balance_to_fungible_amount(
        sheet: &CollateralBalanceSheet,
        amount: u64,
        round_up: bool
    ): u64 {
        math::convert_decimals(
            amount,
            &sheet.balance_precision,
            &sheet.primary_store.asset_precision,
            round_up
        )
    }

    /// Converts fungible asset precision to internal balance precision
    friend fun convert_fungible_to_balance_amount(sheet: &CollateralBalanceSheet, amount: u64): u64 {
        math::convert_decimals(
            amount,
            &sheet.primary_store.asset_precision,
            &sheet.balance_precision,
            false
        )
    }

    /// Calculates fungible amount for a given USD value of secondary asset
    friend fun fungible_amount_from_usd_value(
        sheet: &CollateralBalanceSheet,
        usd_value: u64,
        asset: Object<Metadata>
    ): u64 {
        let info = table::borrow(&sheet.secondary_stores, asset);
        let decimals_mult = math::get_decimals_multiplier(&info.store.asset_precision);
        let price = info.usd_value_per_unit;

        if (price == 0) {
            abort error::invalid_argument(E_BALANCE_CHECK_FAILED)
        };

        // amount = usd_value * decimals / price
        let value_u128 = usd_value as u128;
        let decimals_u128 = decimals_mult as u128;
        let price_u128 = price as u128;

        ((value_u128 * decimals_u128) / price_u128) as u64
    }

    // =========================================================================
    // FRIEND FUNCTIONS - BALANCE MODIFICATIONS
    // =========================================================================

    /// Deposits collateral to a balance
    ///
    /// Handles both primary and secondary assets automatically.
    /// Emits balance change event for audit trail.
    friend fun deposit_collateral(
        sheet: &mut CollateralBalanceSheet,
        balance_type: CollateralBalanceType,
        asset: FungibleAsset,
        change_type: CollateralBalanceChangeType
    ) {
        let asset_metadata = fungible_asset::metadata_from_asset(&asset);

        if (asset_metadata == sheet.primary_asset_type) {
            // Primary asset deposit
            let balance_amount = convert_fungible_to_balance_amount(sheet, fungible_asset::amount(&asset));

            let aggregator = table::borrow_mut_with_default(
                &mut sheet.primary_balance_table,
                balance_type,
                i64_aggregator::new_i64_aggregator()
            );

            i64_aggregator::add(aggregator, balance_amount as i64);

            let delta = balance_amount as i64;
            emit_balance_change_event(asset_metadata, aggregator, delta, balance_type, change_type);

            // Deposit to store
            dispatchable_fungible_asset::deposit(sheet.primary_store.store, asset);
        } else {
            // Secondary asset deposit
            let amount = fungible_asset::amount(&asset);
            assert!(table::contains(&sheet.secondary_stores, asset_metadata), E_UNSUPPORTED_ASSET);

            // Ensure balance table exists
            if (!table::contains(&sheet.secondary_balance_tables, balance_type)) {
                table::add(&mut sheet.secondary_balance_tables, balance_type, create_empty_secondary_balances());
            };

            // Update balance
            let balances = table::borrow_mut(&mut sheet.secondary_balance_tables, balance_type);
            let balance_ref = get_secondary_balance_mut(balances, asset_metadata);
            *balance_ref = *balance_ref + amount;

            emit_secondary_balance_change_event(
                asset_metadata,
                *balance_ref,
                amount as i64,
                balance_type,
                change_type
            );

            // Deposit to secondary store
            let info = table::borrow(&sheet.secondary_stores, asset_metadata);
            dispatchable_fungible_asset::deposit(info.store.store, asset);
        };
    }

    /// Deposits to user balance without fungible asset (internal credit)
    friend fun deposit_to_user(
        sheet: &mut CollateralBalanceSheet,
        balance_type: CollateralBalanceType,
        amount: u64,
        change_type: CollateralBalanceChangeType
    ) {
        if (amount == 0) {
            return
        };

        let asset_type = sheet.primary_asset_type;
        let aggregator = table::borrow_mut_with_default(
            &mut sheet.primary_balance_table,
            balance_type,
            i64_aggregator::new_i64_aggregator()
        );

        i64_aggregator::add(aggregator, amount as i64);

        let delta = amount as i64;
        emit_balance_change_event(asset_type, aggregator, delta, balance_type, change_type);
    }

    /// Decreases balance with underflow check
    friend fun decrease_balance(
        sheet: &mut CollateralBalanceSheet,
        balance_type: CollateralBalanceType,
        amount: u64,
        change_type: CollateralBalanceChangeType
    ) {
        if (amount == 0) {
            return
        };

        let asset_type = sheet.primary_asset_type;
        let aggregator = table::borrow_mut(&mut sheet.primary_balance_table, balance_type);

        // Check sufficient balance
        if (!i64_aggregator::is_at_least(aggregator, amount as i64)) {
            abort E_BALANCE_CHECK_FAILED
        };

        let delta = -(amount as i64);
        i64_aggregator::add(aggregator, delta);

        emit_balance_change_event(asset_type, aggregator, delta, balance_type, change_type);
    }

    /// Decreases balance without underflow check (can go negative)
    friend fun decrease_balance_unchecked(
        sheet: &mut CollateralBalanceSheet,
        balance_type: CollateralBalanceType,
        amount: u64,
        change_type: CollateralBalanceChangeType
    ) {
        if (amount == 0) {
            return
        };

        let asset_type = sheet.primary_asset_type;
        let aggregator = table::borrow_mut(&mut sheet.primary_balance_table, balance_type);

        let delta = -(amount as i64);
        i64_aggregator::add(aggregator, delta);

        emit_balance_change_event(asset_type, aggregator, delta, balance_type, change_type);
    }

    /// Withdraws primary asset (unchecked - caller must verify balance)
    friend fun withdraw_primary_asset_unchecked(
        sheet: &mut CollateralBalanceSheet,
        balance_type: CollateralBalanceType,
        amount: u64,
        round_up: bool,
        change_type: CollateralBalanceChangeType
    ): FungibleAsset {
        let asset_type = sheet.primary_asset_type;
        withdraw_collateral_unchecked_for_asset(sheet, balance_type, amount, asset_type, round_up, change_type)
    }

    /// Withdraws collateral for any supported asset
    friend fun withdraw_collateral_unchecked_for_asset(
        sheet: &mut CollateralBalanceSheet,
        balance_type: CollateralBalanceType,
        amount: u64,
        asset: Object<Metadata>,
        round_up: bool,
        change_type: CollateralBalanceChangeType
    ): FungibleAsset {
        if (amount == 0) {
            abort error::invalid_argument(E_ZERO_AMOUNT)
        };

        if (asset == sheet.primary_asset_type) {
            // Primary asset withdrawal
            let fungible_amount = convert_balance_to_fungible_amount(sheet, amount, round_up);

            let aggregator = table::borrow_mut(&mut sheet.primary_balance_table, balance_type);
            let delta = -(amount as i64);
            i64_aggregator::add(aggregator, delta);

            emit_balance_change_event(asset, aggregator, delta, balance_type, change_type);

            // Withdraw from store
            let signer = object::generate_signer_for_extending(&sheet.primary_store.store_extend_ref);
            dispatchable_fungible_asset::withdraw(&signer, sheet.primary_store.store, fungible_amount)
        } else {
            // Secondary asset withdrawal
            assert!(table::contains(&sheet.secondary_stores, asset), E_UNSUPPORTED_ASSET);
            assert!(table::contains(&sheet.secondary_balance_tables, balance_type), E_UNSUPPORTED_ASSET);

            let info = table::borrow(&sheet.secondary_stores, asset);
            let balances = table::borrow_mut(&mut sheet.secondary_balance_tables, balance_type);
            let balance_ref = get_secondary_balance_mut(balances, asset);

            if (*balance_ref < amount) {
                abort error::invalid_argument(E_INSUFFICIENT_BALANCE)
            };

            *balance_ref = *balance_ref - amount;

            let delta = -(amount as i64);
            emit_secondary_balance_change_event(asset, *balance_ref, delta, balance_type, change_type);

            // Withdraw from secondary store
            let signer = object::generate_signer_for_extending(&info.store.store_extend_ref);
            dispatchable_fungible_asset::withdraw(&signer, info.store.store, amount)
        }
    }

    // =========================================================================
    // FRIEND FUNCTIONS - MARGIN TRANSFERS
    // =========================================================================

    /// Transfers balance from cross-margin to isolated position
    friend fun transfer_from_crossed_to_isolated(
        sheet: &mut CollateralBalanceSheet,
        account: address,
        amount: u64,
        market: Object<PerpMarket>,
        change_type: CollateralBalanceChangeType
    ) {
        let from = balance_type_cross(account);
        let to = balance_type_isolated(account, market);
        transfer_primary_asset(sheet, from, to, amount, change_type, change_type);
    }

    /// Transfers balance from isolated position to cross-margin
    friend fun transfer_from_isolated_to_crossed(
        sheet: &mut CollateralBalanceSheet,
        account: address,
        amount: u64,
        market: Object<PerpMarket>,
        change_type: CollateralBalanceChangeType
    ) {
        let from = balance_type_isolated(account, market);
        let to = balance_type_cross(account);
        transfer_primary_asset(sheet, from, to, amount, change_type, change_type);
    }

    /// Transfers all balance to backstop liquidator during liquidation
    friend fun transfer_to_backstop_liquidator(
        sheet: &mut CollateralBalanceSheet,
        from_balance: CollateralBalanceType,
        to_balance: CollateralBalanceType
    ) {
        let change_type = change_type_liquidation();

        // Transfer primary asset
        if (table::contains(&sheet.primary_balance_table, from_balance)) {
            let removed = table::remove(&mut sheet.primary_balance_table, from_balance);
            let amount = i64_aggregator::read(&removed);

            let to_aggregator = table::borrow_mut_with_default(
                &mut sheet.primary_balance_table,
                to_balance,
                i64_aggregator::new_i64_aggregator()
            );
            i64_aggregator::add(to_aggregator, amount);
        };

        // Transfer secondary assets
        if (table::contains(&sheet.secondary_balance_tables, from_balance)) {
            if (!table::contains(&sheet.secondary_balance_tables, to_balance)) {
                table::add(&mut sheet.secondary_balance_tables, to_balance, create_empty_secondary_balances());
            };

            let from_balances = table::remove(&mut sheet.secondary_balance_tables, from_balance);
            let to_balances = table::borrow_mut(&mut sheet.secondary_balance_tables, to_balance);

            let asset_balances = from_balances.asset_balances;
            let i = 0;
            let len = vector::length(&asset_balances);
            while (i < len) {
                let ab = vector::borrow(&asset_balances, i);
                if (ab.balance > 0) {
                    let to_ref = get_secondary_balance_mut(to_balances, ab.asset_type);
                    *to_ref = *to_ref + ab.balance;

                    // Emit events
                    let neg_delta = -(ab.balance as i64);
                    emit_secondary_balance_change_event(ab.asset_type, 0, neg_delta, from_balance, change_type);
                    emit_secondary_balance_change_event(ab.asset_type, *to_ref, ab.balance as i64, to_balance, change_type);
                };
                i = i + 1;
            };
        };
    }

    // =========================================================================
    // FRIEND FUNCTIONS - ORACLE UPDATES
    // =========================================================================

    /// Updates the oracle price for a secondary asset
    friend fun update_secondary_asset_oracle_price(
        sheet: &mut CollateralBalanceSheet,
        asset: Object<Metadata>,
        new_price: u64
    ) {
        let info = table::borrow_mut(&mut sheet.secondary_stores, asset);
        oracle::update_internal_oracle_price(&info.oracle_source, new_price);
        update_usd_value_from_oracle(sheet, asset);
    }

    /// Refreshes USD value from oracle for secondary asset
    friend fun update_usd_value_from_oracle(sheet: &mut CollateralBalanceSheet, asset: Object<Metadata>) {
        let precision = sheet.balance_precision;
        let info = table::borrow_mut(&mut sheet.secondary_stores, asset);
        let oracle_data = oracle::get_oracle_data(&mut info.oracle_source, precision);
        info.usd_value_per_unit = oracle::get_price(&oracle_data);
    }

    /// Updates haircut for secondary asset
    friend fun update_haircut_bps(
        sheet: &mut CollateralBalanceSheet,
        asset: Object<Metadata>,
        new_haircut: u64
    ) {
        assert!(asset != sheet.primary_asset_type, E_UNSUPPORTED_ASSET);
        let info = table::borrow_mut(&mut sheet.secondary_stores, asset);
        info.haircut_bps = new_haircut;
    }

    // =========================================================================
    // INTERNAL FUNCTIONS
    // =========================================================================

    /// Creates a new collateral store for holding tokens
    fun create_collateral_store(
        admin: &signer,
        asset: Object<Metadata>,
        seed: vector<u8>
    ): CollateralStore {
        let constructor_ref = object::create_named_object(admin, seed);
        let extend_ref = object::generate_extend_ref(&constructor_ref);
        let store_addr = object::address_from_constructor_ref(&constructor_ref);
        let store = primary_fungible_store::ensure_primary_store_exists<Metadata>(store_addr, asset);
        let asset_precision = math::new_precision(fungible_asset::decimals(asset));

        CollateralStore {
            asset_type: asset,
            asset_precision,
            store,
            store_extend_ref: extend_ref,
        }
    }

    /// Creates empty secondary balances container
    fun create_empty_secondary_balances(): SecondaryBalances {
        SecondaryBalances {
            asset_balances: vector::empty<AssetBalance>(),
        }
    }

    /// Transfers primary asset between balance types
    fun transfer_primary_asset(
        sheet: &mut CollateralBalanceSheet,
        from: CollateralBalanceType,
        to: CollateralBalanceType,
        amount: u64,
        from_change_type: CollateralBalanceChangeType,
        to_change_type: CollateralBalanceChangeType
    ) {
        if (amount == 0) {
            return
        };

        let asset_type = sheet.primary_asset_type;

        // Decrease from balance
        let from_agg = table::borrow_mut(&mut sheet.primary_balance_table, from);
        let neg_delta = -(amount as i64);
        i64_aggregator::add(from_agg, neg_delta);
        emit_balance_change_event(asset_type, from_agg, neg_delta, from, from_change_type);

        // Increase to balance
        let to_agg = table::borrow_mut_with_default(
            &mut sheet.primary_balance_table,
            to,
            i64_aggregator::new_i64_aggregator()
        );
        let pos_delta = amount as i64;
        i64_aggregator::add(to_agg, pos_delta);
        emit_balance_change_event(asset_type, to_agg, pos_delta, to, to_change_type);
    }

    /// Gets mutable reference to secondary asset balance
    fun get_secondary_balance_mut(
        balances: &mut SecondaryBalances,
        asset: Object<Metadata>
    ): &mut u64 {
        let assets = &mut balances.asset_balances;

        // Find existing balance
        let i = 0;
        let len = vector::length(assets);
        while (i < len) {
            let ab = vector::borrow(assets, i);
            if (ab.asset_type == asset) {
                return &mut vector::borrow_mut(assets, i).balance
            };
            i = i + 1;
        };

        // Create new entry if not found
        vector::push_back(assets, AssetBalance { asset_type: asset, balance: 0 });
        let new_idx = vector::length(assets) - 1;
        &mut vector::borrow_mut(assets, new_idx).balance
    }

    /// Gets secondary asset balance (read-only)
    fun get_secondary_balance(balances: &SecondaryBalances, asset: Object<Metadata>): u64 {
        let i = 0;
        let len = vector::length(&balances.asset_balances);
        while (i < len) {
            let ab = vector::borrow(&balances.asset_balances, i);
            if (ab.asset_type == asset) {
                return ab.balance
            };
            i = i + 1;
        };
        0
    }

    /// Emits balance change event for primary asset
    fun emit_balance_change_event(
        asset: Object<Metadata>,
        aggregator: &I64Aggregator,
        delta: i64,
        balance_type: CollateralBalanceType,
        change_type: CollateralBalanceChangeType
    ) {
        let snapshot = i64_aggregator::snapshot(aggregator);
        event::emit(CollateralBalanceChangeEvent::V1 {
            asset_type: asset,
            balance_type,
            delta,
            offset_balance_after: snapshot,
            change_type,
        });
    }

    /// Emits balance change event for secondary asset
    fun emit_secondary_balance_change_event(
        asset: Object<Metadata>,
        balance_after: u64,
        delta: i64,
        balance_type: CollateralBalanceType,
        change_type: CollateralBalanceChangeType
    ) {
        let snapshot = i64_aggregator::create_i64_snapshot(balance_after as i64);
        event::emit(CollateralBalanceChangeEvent::V1 {
            asset_type: asset,
            balance_type,
            delta,
            offset_balance_after: snapshot,
            change_type,
        });
    }
}
