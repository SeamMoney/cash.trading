/// ============================================================================
/// FEE DISTRIBUTION - Trading Fee Routing and Settlement
/// ============================================================================
///
/// This module handles the distribution of trading fees between:
/// - Treasury (protocol revenue)
/// - Builders (frontend operators who bring users)
/// - Referrers (users who refer other users)
/// - Backstop vault (insurance fund)
///
/// FEE FLOW:
///
/// 1. When a trade occurs, fees are calculated for maker and taker
/// 2. FeeDistribution structs track:
///    - position_fee_delta: Amount charged to/credited to the trader
///    - treasury_fee_delta: Amount going to treasury
///    - builder_or_referrer_fees: Optional portion to builder/referrer
///
/// 3. During distribution:
///    - Positive position_fee_delta: withdraw from trader, deposit to treasury
///    - Negative position_fee_delta: withdraw from treasury, deposit to trader (rebate)
///    - Builder/referrer portion is extracted and sent to their accounts
///    - Backstop vault percentage is sent to the vault
///
/// FEE MATH:
///
/// For a trade with fee F and builder/referrer rebate R:
/// - position_fee_delta = F (what trader pays)
/// - treasury_fee_delta = R - F (negative means treasury receives F - R)
/// - builder_or_referrer_fees = R
///
/// ============================================================================

module decibel::fee_distribution {
    use std::option;
    use std::error;
    use std::fungible_asset;

    use decibel::collateral_balance_sheet;
    use decibel::fee_treasury;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::trading_fees_manager;
    friend decibel::position_update;

    // ============================================================================
    // CORE STRUCTURES
    // ============================================================================

    /// Represents fee distribution for a single trade side
    enum FeeDistribution has copy, drop, store {
        V1 {
            /// Balance type (cross or isolated) for fee settlement
            balance_type: collateral_balance_sheet::CollateralBalanceType,
            /// Fee delta applied to the position (positive = pays, negative = receives)
            position_fee_delta: i64,
            /// Fee delta to/from treasury (positive = receives, negative = pays)
            treasury_fee_delta: i64,
            /// Optional builder or referrer fee portion
            builder_or_referrer_fees: option::Option<FeeWithDestination>,
        }
    }

    /// Fee amount with destination address
    struct FeeWithDestination has copy, drop, store {
        /// Address receiving the fee
        address: address,
        /// Fee amount
        fees: u64,
    }

    // ============================================================================
    // CONSTRUCTION
    // ============================================================================

    /// Create a new fee distribution
    ///
    /// # Parameters
    /// - `balance_type`: The balance type for settlement
    /// - `position_fee`: Fee charged to the position
    /// - `builder_or_referrer`: Optional builder/referrer fee
    ///
    /// Treasury fee is calculated as: builder_fee - position_fee
    /// This ensures: position pays position_fee, builder gets builder_fee,
    /// treasury gets the difference
    friend fun new_fee_distribution(
        balance_type: collateral_balance_sheet::CollateralBalanceType,
        position_fee: i64,
        builder_or_referrer: option::Option<FeeWithDestination>
    ): FeeDistribution {
        // Calculate builder/referrer fee amount
        let builder_fee: u64;
        if (option::is_some<FeeWithDestination>(&builder_or_referrer)) {
            let fee_info = option::destroy_some<FeeWithDestination>(builder_or_referrer);
            builder_fee = *&(&fee_info).fees;
        } else {
            builder_fee = 0;
        };

        // Treasury delta = builder_fee - position_fee
        // If position pays 100 and builder gets 10, treasury gets 90 (treasury_delta = -90)
        let treasury_delta = (builder_fee as i64) - position_fee;

        FeeDistribution::V1 {
            balance_type,
            position_fee_delta: position_fee,
            treasury_fee_delta: treasury_delta,
            builder_or_referrer_fees: builder_or_referrer,
        }
    }

    /// Create a zero-fee distribution
    friend fun zero_fees(
        balance_type: collateral_balance_sheet::CollateralBalanceType
    ): FeeDistribution {
        let none = option::none<FeeWithDestination>();
        FeeDistribution::V1 {
            balance_type,
            position_fee_delta: 0i64,
            treasury_fee_delta: 0i64,
            builder_or_referrer_fees: none,
        }
    }

    /// Create a fee with destination
    friend fun new_fee_with_destination(
        address: address,
        fees: u64
    ): FeeWithDestination {
        FeeWithDestination { address, fees }
    }

    // ============================================================================
    // GETTERS
    // ============================================================================

    /// Get the position fee delta
    friend fun get_position_fee_delta(dist: &FeeDistribution): i64 {
        *&dist.position_fee_delta
    }

    /// Get the treasury (system) fee delta
    friend fun get_system_fee_delta(dist: &FeeDistribution): i64 {
        *&dist.treasury_fee_delta
    }

    /// Get the builder or referrer fee
    friend fun get_builder_or_referrer_fees(dist: &FeeDistribution): option::Option<FeeWithDestination> {
        *&dist.builder_or_referrer_fees
    }

    // ============================================================================
    // FEE ARITHMETIC
    // ============================================================================

    /// Add two fee distributions together
    ///
    /// Both must have same balance type and builder/referrer address (if present)
    friend fun add(
        dist1: &FeeDistribution,
        dist2: FeeDistribution
    ): FeeDistribution {
        // Validate same balance type
        let type1 = *&dist1.balance_type;
        let type2 = *&(&dist2).balance_type;
        if (!(type1 == type2)) {
            abort error::invalid_argument(4)
        };

        // Validate builder/referrer consistency
        let none1 = option::is_none<FeeWithDestination>(&dist1.builder_or_referrer_fees);
        let none2 = option::is_none<FeeWithDestination>(&(&dist2).builder_or_referrer_fees);
        if (!(none1 == none2)) {
            abort error::invalid_argument(4)
        };

        // If both have builder fees, validate same address
        if (option::is_some<FeeWithDestination>(&dist1.builder_or_referrer_fees)) {
            let addr1 = *&option::borrow<FeeWithDestination>(&dist1.builder_or_referrer_fees).address;
            let addr2 = *&option::borrow<FeeWithDestination>(&(&dist2).builder_or_referrer_fees).address;
            if (!(addr1 == addr2)) {
                abort error::invalid_argument(3)
            };
        };

        // Sum up the fees
        let balance_type = *&dist1.balance_type;
        let position_delta = *&dist1.position_fee_delta + *&(&dist2).position_fee_delta;
        let treasury_delta = *&dist1.treasury_fee_delta + *&(&dist2).treasury_fee_delta;

        // Sum builder fees if present
        let builder_fees: option::Option<FeeWithDestination>;
        if (option::is_some<FeeWithDestination>(&dist1.builder_or_referrer_fees)) {
            let addr = *&option::borrow<FeeWithDestination>(&dist1.builder_or_referrer_fees).address;
            let fee1 = *&option::borrow<FeeWithDestination>(&dist1.builder_or_referrer_fees).fees;
            let fee2 = *&option::borrow<FeeWithDestination>(&(&dist2).builder_or_referrer_fees).fees;
            let total_fee = fee1 + fee2;
            builder_fees = option::some<FeeWithDestination>(FeeWithDestination {
                address: addr,
                fees: total_fee,
            });
        } else {
            builder_fees = option::none<FeeWithDestination>();
        };

        FeeDistribution::V1 {
            balance_type,
            position_fee_delta: position_delta,
            treasury_fee_delta: treasury_delta,
            builder_or_referrer_fees: builder_fees,
        }
    }

    // ============================================================================
    // FEE SETTLEMENT
    // ============================================================================

    /// Distribute fees for maker and taker combined
    ///
    /// # Parameters
    /// - `maker_dist`: Maker's fee distribution
    /// - `taker_dist`: Taker's fee distribution
    /// - `balance_sheet`: The collateral balance sheet
    /// - `backstop_addr`: Address of backstop vault
    /// - `backstop_pct`: Percentage of fees going to backstop (0-100)
    friend fun distribute_fees(
        maker_dist: &FeeDistribution,
        taker_dist: &FeeDistribution,
        balance_sheet: &mut collateral_balance_sheet::CollateralBalanceSheet,
        backstop_addr: address,
        backstop_pct: u64
    ) {
        // Verify total treasury delta is non-positive (treasury receives, not pays)
        let total_treasury = *&taker_dist.treasury_fee_delta + *&maker_dist.treasury_fee_delta;
        if (!(total_treasury <= 0i64)) {
            abort error::invalid_argument(5)
        };

        // Distribute individual position fees
        distribute_fees_for_position(maker_dist, balance_sheet);
        distribute_fees_for_position(taker_dist, balance_sheet);

        // Send backstop portion to vault
        let treasury_received = (-total_treasury) as u64;
        let backstop_amount = treasury_received * backstop_pct / 100;

        if (backstop_amount > 0) {
            let fungible_amount = collateral_balance_sheet::convert_balance_to_fungible_amount(
                /*immutable*/ balance_sheet,
                backstop_amount,
                false
            );
            if (fungible_amount > 0) {
                let assets = fee_treasury::withdraw_fees(fungible_amount);
                let backstop_balance_type = collateral_balance_sheet::balance_type_cross(backstop_addr);
                distribute_fees_to_address(balance_sheet, assets, backstop_balance_type);
            };
        };
    }

    /// Distribute fees for a single position
    ///
    /// Handles the flow of funds:
    /// - If position pays (positive delta): withdraw from position, deposit to treasury
    /// - If position receives (negative delta): withdraw from treasury, deposit to position
    friend fun distribute_fees_for_position(
        dist: &FeeDistribution,
        balance_sheet: &mut collateral_balance_sheet::CollateralBalanceSheet
    ) {
        let position_delta = *&dist.position_fee_delta;

        // No fees to distribute
        if (position_delta == 0i64) {
            return
        };

        if (position_delta >= 0i64) {
            // Position PAYS fees
            let fee_amount = position_delta as u64;
            let balance_type = *&dist.balance_type;
            let change_type = collateral_balance_sheet::change_type_fee();

            // Withdraw from position
            let assets = collateral_balance_sheet::withdraw_primary_asset_unchecked(
                balance_sheet,
                balance_type,
                fee_amount,
                true,
                change_type
            );

            // Add any additional treasury contribution
            if (*&dist.treasury_fee_delta > 0i64) {
                let treasury_amount = (*&dist.treasury_fee_delta) as u64;
                let fungible_amount = collateral_balance_sheet::convert_balance_to_fungible_amount(
                    /*immutable*/ balance_sheet,
                    treasury_amount,
                    true
                );
                if (fungible_amount > 0) {
                    let treasury_assets = fee_treasury::withdraw_fees(fungible_amount);
                    fungible_asset::merge(&mut assets, treasury_assets);
                };
            };

            // Distribute builder/referrer portion
            if (option::is_some<FeeWithDestination>(&dist.builder_or_referrer_fees)) {
                let FeeWithDestination { address, fees } = option::destroy_some<FeeWithDestination>(
                    *&dist.builder_or_referrer_fees
                );
                let fungible_amount = collateral_balance_sheet::convert_balance_to_fungible_amount(
                    /*immutable*/ balance_sheet,
                    fees,
                    false
                );
                let builder_assets = fungible_asset::extract(&mut assets, fungible_amount);
                let builder_balance_type = collateral_balance_sheet::balance_type_cross(address);
                distribute_fees_to_address(balance_sheet, builder_assets, builder_balance_type);
            };

            // Deposit remaining to treasury
            if (fungible_asset::amount(&assets) > 0) {
                fee_treasury::deposit_fees(assets);
            } else {
                fungible_asset::destroy_zero(assets);
            };
        } else {
            // Position RECEIVES fees (rebate)
            let treasury_delta = *&dist.treasury_fee_delta;

            // Treasury delta must be non-negative for rebates
            if (!(treasury_delta >= 0i64)) {
                abort error::invalid_argument(1)
            };

            let rebate_amount = treasury_delta as u64;
            let fungible_amount = collateral_balance_sheet::convert_balance_to_fungible_amount(
                /*immutable*/ balance_sheet,
                rebate_amount,
                false
            );

            if (fungible_amount == 0) {
                return
            };

            // Withdraw from treasury
            let assets = fee_treasury::withdraw_fees(fungible_amount);

            // Distribute builder/referrer portion first
            if (option::is_some<FeeWithDestination>(&dist.builder_or_referrer_fees)) {
                let FeeWithDestination { address, fees } = option::destroy_some<FeeWithDestination>(
                    *&dist.builder_or_referrer_fees
                );
                let builder_fungible = collateral_balance_sheet::convert_balance_to_fungible_amount(
                    /*immutable*/ balance_sheet,
                    fees,
                    false
                );
                let builder_assets = fungible_asset::extract(&mut assets, builder_fungible);
                let builder_balance_type = collateral_balance_sheet::balance_type_cross(address);
                distribute_fees_to_address(balance_sheet, builder_assets, builder_balance_type);
            };

            // Deposit remaining to position
            let balance_type = *&dist.balance_type;
            let change_type = collateral_balance_sheet::change_type_fee();
            collateral_balance_sheet::deposit_collateral(
                balance_sheet,
                balance_type,
                assets,
                change_type
            );
        };
    }

    /// Distribute fees to a specific address
    fun distribute_fees_to_address(
        balance_sheet: &mut collateral_balance_sheet::CollateralBalanceSheet,
        assets: fungible_asset::FungibleAsset,
        balance_type: collateral_balance_sheet::CollateralBalanceType
    ) {
        let change_type = collateral_balance_sheet::change_type_fee();
        collateral_balance_sheet::deposit_collateral(
            balance_sheet,
            balance_type,
            assets,
            change_type
        );
    }
}
