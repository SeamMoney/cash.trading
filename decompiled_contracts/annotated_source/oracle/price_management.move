/// ============================================================================
/// PRICE MANAGEMENT - Mark Price and Funding Rate Calculation
/// ============================================================================
///
/// This module manages price state for perpetual markets, including:
/// - Oracle price tracking
/// - Mark price calculation using multiple EMAs
/// - Funding rate calculation and accumulative index
/// - Withdrawal-safe price tracking
///
/// MARK PRICE CALCULATION:
/// The mark price is the median of three EMA-based prices:
/// 1. 150-second oracle spread EMA
/// 2. 30-second oracle spread EMA
/// 3. 30-second basis spread EMA (mark vs book mid)
///
/// FUNDING RATE:
/// Funding rate is calculated based on the premium/discount of mark vs oracle:
/// - Clamps between -0.4% and +0.4% per hour (-40000 to +40000 bps per million)
/// - Includes interest rate component (default 12 bps annually)
/// - Accumulative index tracks cumulative funding for position PnL
///
/// WITHDRAW MARK PRICE:
/// A separate mark price is maintained for withdrawal margin calculations
/// to prevent manipulation of withdrawable collateral.
///
/// ============================================================================

module decibel::price_management {
    use std::object;
    use std::event;
    use std::error;
    use std::signer;
    use std::option;
    use std::math64;

    use decibel::spread_ema;
    use decibel::perp_market;
    use decibel::perp_market_config;
    use decibel::decibel_time;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::pending_order_tracker;
    friend decibel::perp_positions;
    friend decibel::position_update;
    friend decibel::accounts_collateral;
    friend decibel::tp_sl_utils;
    friend decibel::open_interest_tracker;
    friend decibel::clearinghouse_perp;
    friend decibel::liquidation;
    friend decibel::async_matching_engine;
    friend decibel::perp_engine;
    friend decibel::admin_apis;

    // ============================================================================
    // CONSTANTS
    // ============================================================================

    /// Maximum funding rate: 4% per hour (40000 bps / 1M)
    const MAX_FUNDING_RATE_BPS: i64 = 40000;

    /// Funding rate precision (per million)
    const FUNDING_PRECISION: u128 = 1000000;

    /// Microseconds per hour (for funding calculation)
    const MICROS_PER_HOUR: i256 = 3600000000;

    /// Default funding pause timeout (6 minutes in microseconds)
    const DEFAULT_FUNDING_PAUSE_TIMEOUT: u64 = 360000000;

    /// Default interest rate (12 bps annually, converted to hourly)
    const DEFAULT_INTEREST_RATE: u64 = 12;

    // ============================================================================
    // CORE STRUCTURES
    // ============================================================================

    /// Per-market price state
    enum Price has drop, key {
        V1 {
            /// Last update timestamp (microseconds)
            last_updated: u64,
            /// Timeout for pausing funding rate during price gaps
            funding_rate_pause_timeout_microseconds: u64,
            /// Current oracle price
            oracle_px: u64,
            /// Current mark price
            mark_px: u64,
            /// Mark price for withdrawal calculations
            withdraw_mark_px: u64,
            /// Size multiplier for the market
            size_multiplier: u64,
            /// Cumulative funding index
            accumulative_index: AccumulativeIndex,
            /// Funding index for withdrawal calculations
            withdraw_accumulative_index: AccumulativeIndex,
            /// Current order book mid price
            book_mid_px: u64,
            /// 30-second EMA of book mid price
            book_mid_30_ema: spread_ema::SpreadEMA,
            /// 150-second EMA of oracle spread
            oracle_150_spread_ema: spread_ema::SpreadEMA,
            /// 30-second EMA of oracle spread
            oracle_30_spread_ema: spread_ema::SpreadEMA,
            /// 30-second EMA of basis spread
            basis_30_spread_ema: spread_ema::SpreadEMA,
            /// Haircut for unrealized PnL (basis points)
            unrealized_pnl_haircut_bps: u64,
            /// Leverage for withdrawal margin calculation
            withdrawable_margin_leverage: u8,
            /// Maximum allowed leverage
            max_leverage: u8,
        }
    }

    /// Cumulative funding index for position PnL calculation
    struct AccumulativeIndex has copy, drop, store {
        /// Cumulative funding value (can be negative)
        index: i128,
    }

    /// Input for mark price refresh
    enum MarkPriceRefreshInput has drop {
        /// Use order book prices automatically
        None,
        /// Use provided impact prices
        UseProvidedImpactHint {
            impact_bid_px: u64,
            impact_ask_px: u64,
        }
    }

    /// Global interest rate configuration
    enum PriceIndexStore has key {
        V1 {
            /// Annual interest rate in basis points
            interest_rate: u64,
        }
    }

    // ============================================================================
    // EVENTS
    // ============================================================================

    /// Emitted when price is updated
    enum PriceUpdateEvent has drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            oracle_px: u64,
            mark_px: u64,
            impact_ask_px: u64,
            impact_bid_px: u64,
            funding_index: i128,
            funding_rate_bps: i64,
        }
    }

    // ============================================================================
    // ACCUMULATIVE INDEX
    // ============================================================================

    /// Get the raw index value
    friend fun accumulative_index(index: &AccumulativeIndex): i128 {
        index.index
    }

    // ============================================================================
    // MARKET REGISTRATION
    // ============================================================================

    /// Register price tracking for a new market
    friend fun register_market(
        market_signer: &signer,
        initial_price: u64,
        size_multiplier: u64,
        max_leverage: u8
    ) {
        if (!(initial_price > 0)) {
            abort error::invalid_argument(4)
        };

        // Initialize book mid EMA with initial price
        let book_mid_ema = spread_ema::new_ema(30);
        spread_ema::add_observation(&mut book_mid_ema, initial_price, initial_price);

        let current_time = decibel_time::now_microseconds();

        let price_state = Price::V1 {
            last_updated: current_time,
            funding_rate_pause_timeout_microseconds: DEFAULT_FUNDING_PAUSE_TIMEOUT,
            oracle_px: initial_price,
            mark_px: initial_price,
            withdraw_mark_px: initial_price,
            size_multiplier,
            accumulative_index: AccumulativeIndex { index: 0i128 },
            withdraw_accumulative_index: AccumulativeIndex { index: 0i128 },
            book_mid_px: initial_price,
            book_mid_30_ema: book_mid_ema,
            oracle_150_spread_ema: spread_ema::new_ema(150),
            oracle_30_spread_ema: spread_ema::new_ema(30),
            basis_30_spread_ema: spread_ema::new_ema(30),
            unrealized_pnl_haircut_bps: 0,
            withdrawable_margin_leverage: max_leverage,
            max_leverage,
        };

        move_to<Price>(market_signer, price_state);
    }

    // ============================================================================
    // PRICE GETTERS
    // ============================================================================

    /// Get the current oracle price
    friend fun get_oracle_price(market: object::Object<perp_market::PerpMarket>): u64
        acquires Price
    {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        borrow_global<Price>(market_addr).oracle_px
    }

    /// Get the current mark price
    friend fun get_mark_price(market: object::Object<perp_market::PerpMarket>): u64
        acquires Price
    {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        borrow_global<Price>(market_addr).mark_px
    }

    /// Get both mark and oracle prices
    friend fun get_mark_and_oracle_price(
        market: object::Object<perp_market::PerpMarket>
    ): (u64, u64) acquires Price {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let price_state = borrow_global<Price>(market_addr);
        (price_state.mark_px, price_state.oracle_px)
    }

    /// Get withdrawal mark price
    friend fun get_withdraw_mark_price(market: object::Object<perp_market::PerpMarket>): u64
        acquires Price
    {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        borrow_global<Price>(market_addr).withdraw_mark_px
    }

    /// Get withdrawal mark price and funding index
    friend fun get_withdraw_mark_price_and_funding_index(
        market: object::Object<perp_market::PerpMarket>
    ): (u64, AccumulativeIndex) acquires Price {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let price_state = borrow_global<Price>(market_addr);
        (price_state.withdraw_mark_px, price_state.withdraw_accumulative_index)
    }

    /// Get the current accumulative funding index
    friend fun get_accumulative_index(
        market: object::Object<perp_market::PerpMarket>
    ): AccumulativeIndex acquires Price {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        borrow_global<Price>(market_addr).accumulative_index
    }

    /// Get order book mid price
    friend fun get_book_mid_px(market: object::Object<perp_market::PerpMarket>): u64
        acquires Price
    {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        borrow_global<Price>(market_addr).book_mid_px
    }

    /// Get EMA-smoothed book mid price
    friend fun get_book_mid_ema_px(market: object::Object<perp_market::PerpMarket>): u64
        acquires Price
    {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let price_state = borrow_global<Price>(market_addr);
        spread_ema::get_estimated_px(&price_state.book_mid_30_ema, price_state.book_mid_px)
    }

    /// Get all market info needed for position status calculation
    friend fun get_market_info_for_position_status(
        market: object::Object<perp_market::PerpMarket>,
        for_withdrawal: bool
    ): (u64, AccumulativeIndex, u64, u64, u8, u8) acquires Price {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let price_state = borrow_global<Price>(market_addr);

        let mark_px = if (for_withdrawal) {
            price_state.withdraw_mark_px
        } else {
            price_state.mark_px
        };

        let funding_index = if (for_withdrawal) {
            price_state.withdraw_accumulative_index
        } else {
            price_state.accumulative_index
        };

        (
            mark_px,
            funding_index,
            price_state.size_multiplier,
            price_state.unrealized_pnl_haircut_bps,
            price_state.withdrawable_margin_leverage,
            price_state.max_leverage
        )
    }

    // ============================================================================
    // FUNDING CALCULATION
    // ============================================================================

    /// Calculate funding cost between two indices
    ///
    /// # Parameters
    /// - `entry_index`: Funding index at position entry
    /// - `current_index`: Current funding index
    /// - `position_size`: Size of the position
    /// - `size_multiplier`: Market size multiplier
    /// - `is_long`: True if long position
    ///
    /// # Returns
    /// Funding cost (positive = payment, negative = receipt)
    friend fun get_funding_cost(
        entry_index: &AccumulativeIndex,
        current_index: &AccumulativeIndex,
        position_size: u64,
        size_multiplier: u64,
        is_long: bool
    ): i64 {
        let index_diff = current_index.index - entry_index.index;

        // Long positions pay when index increases
        // Short positions pay when index decreases
        if (!is_long) {
            index_diff = -index_diff;
        };

        let is_positive = index_diff >= 0i128;
        let abs_diff = if (is_positive) {
            index_diff as u128
        } else {
            (-index_diff) as u128
        };

        // Calculate: position_size * index_diff / (size_multiplier * FUNDING_PRECISION)
        let numerator = abs_diff * (position_size as u128);
        let denominator = (size_multiplier as u128) * FUNDING_PRECISION;

        let result = if (is_positive) {
            // Round up for payments (ceil division)
            if (numerator == 0u128) {
                if (denominator != 0u128) {
                    0u128
                } else {
                    abort error::invalid_argument(4)
                }
            } else {
                (numerator - 1u128) / denominator + 1u128
            }
        } else {
            // Round down for receipts
            numerator / denominator
        };

        let cost = result as i64;
        if (is_positive) { cost } else { -cost }
    }

    /// Calculate funding rate for the current period
    ///
    /// # Formula
    /// funding_rate = premium_component + interest_component
    /// premium_component = (impact_mid - oracle) / oracle - (oracle - impact_mid) / oracle (clamped)
    /// interest_component = interest_rate (capped at 500 bps)
    ///
    /// Final rate clamped to [-40000, 40000] bps per million
    fun calculate_funding_rate(
        price_state: &Price,
        oracle_px: u64,
        impact_bid: u64,
        impact_ask: u64,
        interest_rate: u64,
        current_time: u64
    ): i64 {
        // Check for funding pause (large time gap)
        let time_elapsed = current_time - price_state.last_updated;
        if (time_elapsed > price_state.funding_rate_pause_timeout_microseconds) {
            return interest_rate as i64
        };

        // Calculate impact mid price
        let impact_mid = impact_bid as i64;
        let oracle_i64 = oracle_px as i64;

        // Premium = (impact_bid - oracle) clamped to positive
        let bid_premium = (impact_mid as i64) - oracle_i64;
        let positive_premium = if (bid_premium > 0i64) { bid_premium } else { 0i64 };

        // Discount = (oracle - impact_ask) clamped to positive
        let ask_discount = oracle_i64 - (impact_ask as i64);
        let positive_discount = if (ask_discount > 0i64) { ask_discount } else { 0i64 };

        // Net premium in bps
        let net_premium = positive_premium - positive_discount;
        assert!(oracle_px != 0, 4);

        let premium_bps = ((net_premium as i128) * (FUNDING_PRECISION as i128) / (oracle_px as i128)) as i64;

        // Apply interest rate component (capped at 500 bps)
        let interest_adjustment = (interest_rate as i64) - premium_bps;
        let capped_interest = if (interest_adjustment >= 0i64) {
            let cap = math64::min(interest_adjustment as u64, 500) as i64;
            cap
        } else {
            let cap = -(math64::min((-interest_adjustment) as u64, 500) as i64);
            cap
        };

        let final_rate = premium_bps + capped_interest;

        // Clamp to max funding rate
        let is_positive = final_rate >= 0i64;
        let abs_rate = if (is_positive) { final_rate as u64 } else { (-final_rate) as u64 };

        if (abs_rate > (MAX_FUNDING_RATE_BPS as u64)) {
            if (is_positive) {
                return MAX_FUNDING_RATE_BPS
            } else {
                return -MAX_FUNDING_RATE_BPS
            }
        };

        if (is_positive) { abs_rate as i64 } else { -(abs_rate as i64) }
    }

    // ============================================================================
    // MARK PRICE CALCULATION
    // ============================================================================

    /// Calculate mark price from EMA values
    ///
    /// Uses the median of three prices for manipulation resistance:
    /// 1. Oracle 150s EMA spread applied to oracle
    /// 2. Oracle 30s EMA spread applied to oracle
    /// 3. Basis 30s EMA spread applied to book mid
    fun calculate_mark_px(oracle_px: u64, impact_bid: u64, impact_ask: u64): u64 {
        // Simple average of (bid+ask)/2 and oracle
        ((impact_bid + impact_ask) / 2 + oracle_px) / 2
    }

    /// Get median of three prices
    fun get_median_price(a: u64, b: u64, c: u64): u64 {
        if (a >= b) {
            if (b >= c) {
                b  // a >= b >= c
            } else if (a >= c) {
                c  // a >= c > b
            } else {
                a  // c > a >= b
            }
        } else {
            // b > a
            if (a >= c) {
                a  // b > a >= c
            } else if (b >= c) {
                c  // b >= c > a
            } else {
                b  // c > b > a
            }
        }
    }

    /// Update mark price from spread EMAs
    fun update_mark_px(price_state: &mut Price, oracle_px: u64, book_mid: u64) {
        // Get smoothed prices from each EMA
        let oracle_150_px = spread_ema::get_estimated_px(&price_state.oracle_150_spread_ema, oracle_px);
        let oracle_30_px = spread_ema::get_estimated_px(&price_state.oracle_30_spread_ema, oracle_px);
        let basis_30_px = spread_ema::get_estimated_px(&price_state.basis_30_spread_ema, book_mid);

        // Use median for manipulation resistance
        let mark_px = get_median_price(oracle_150_px, oracle_30_px, basis_30_px);
        price_state.mark_px = mark_px;

        assert!(price_state.mark_px > 0, 4);
    }

    // ============================================================================
    // PRICE UPDATES
    // ============================================================================

    /// Update accumulative funding index
    fun update_accumulative_index(
        price_state: &mut Price,
        oracle_px: u64,
        impact_bid: u64,
        impact_ask: u64,
        interest_rate: u64,
        current_time: u64
    ): i64 {
        let funding_rate = calculate_funding_rate(
            price_state,
            oracle_px,
            impact_bid,
            impact_ask,
            interest_rate,
            current_time
        );

        let time_elapsed = current_time - price_state.last_updated;

        // Update index: index += funding_rate * time_elapsed * oracle_px / MICROS_PER_HOUR
        let rate_i128 = funding_rate as i128;
        let time_i128 = time_elapsed as i128;
        let index_delta = (((rate_i128 * time_i128) as i256) * (oracle_px as i256) / MICROS_PER_HOUR) as i128;

        price_state.accumulative_index.index = price_state.accumulative_index.index + index_delta;
        price_state.last_updated = current_time;
        price_state.oracle_px = oracle_px;

        funding_rate
    }

    /// Update book mid price and its EMA
    fun update_book_mid_price_and_ema(price_state: &mut Price, book_mid: u64) {
        let old_book_mid = price_state.book_mid_px;
        spread_ema::add_observation(&mut price_state.book_mid_30_ema, book_mid, old_book_mid);
        price_state.book_mid_px = book_mid;
    }

    /// Update spread EMAs
    fun update_spread_emas(price_state: &mut Price, oracle_px: u64, book_mid: u64) {
        // Update oracle spread EMAs
        spread_ema::add_observation(&mut price_state.oracle_150_spread_ema, oracle_px, book_mid);
        spread_ema::add_observation(&mut price_state.oracle_30_spread_ema, oracle_px, book_mid);

        // Update basis spread EMA (mark vs book mid)
        let current_mark = price_state.mark_px;
        spread_ema::add_observation(&mut price_state.basis_30_spread_ema, book_mid, current_mark);
    }

    /// Create input for no impact hint
    friend fun new_mark_price_refresh_input_none(): MarkPriceRefreshInput {
        MarkPriceRefreshInput::None {}
    }

    /// Create input with impact prices
    friend fun new_mark_price_refresh_input_with_impact_hint(
        impact_bid: u64,
        impact_ask: u64
    ): MarkPriceRefreshInput {
        MarkPriceRefreshInput::UseProvidedImpactHint { impact_bid_px: impact_bid, impact_ask_px: impact_ask }
    }

    /// Main price update function
    ///
    /// # Returns
    /// (was_updated, mark_price, accumulative_index)
    friend fun update_price(
        market: object::Object<perp_market::PerpMarket>,
        oracle_px: u64,
        refresh_input: MarkPriceRefreshInput
    ): (bool, u64, AccumulativeIndex) acquires Price, PriceIndexStore {
        assert!(perp_market_config::can_update_oracle(market), 2);

        // Get best bid/ask, defaulting to oracle price
        let best_bid = option::destroy_with_default<u64>(perp_market::best_bid_price(market), oracle_px);
        let best_ask = option::destroy_with_default<u64>(perp_market::best_ask_price(market), oracle_px);

        // Determine impact prices
        let (impact_bid, impact_ask) = if (&refresh_input is None) {
            (best_bid, best_ask)
        } else if (&refresh_input is UseProvidedImpactHint) {
            let MarkPriceRefreshInput::UseProvidedImpactHint { impact_bid_px, impact_ask_px } = refresh_input;
            // Use more conservative of hint vs book
            let bid = if (impact_bid_px > best_bid) { best_bid } else { impact_bid_px };
            let ask = if (impact_ask_px < best_ask) { best_ask } else { impact_ask_px };
            (bid, ask)
        } else {
            abort 14566554180833181697
        };

        update_price_internal(market, oracle_px, impact_bid, impact_ask)
    }

    /// Internal price update logic
    fun update_price_internal(
        market: object::Object<perp_market::PerpMarket>,
        oracle_px: u64,
        impact_bid: u64,
        impact_ask: u64
    ): (bool, u64, AccumulativeIndex) acquires Price, PriceIndexStore {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let price_state = borrow_global_mut<Price>(market_addr);

        let current_time = decibel_time::now_microseconds();

        // Don't update if already updated this block
        if (price_state.last_updated == current_time) {
            return (false, price_state.mark_px, price_state.accumulative_index)
        };

        // Calculate book mid
        let book_mid = (impact_bid + impact_ask) / 2;

        // Update mark price
        update_mark_px(price_state, oracle_px, book_mid);

        // Update spread EMAs
        update_spread_emas(price_state, oracle_px, book_mid);

        // Update book mid EMA
        update_book_mid_price_and_ema(price_state, book_mid);

        // Get interest rate
        let interest_rate = borrow_global<PriceIndexStore>(@decibel).interest_rate;

        // Update funding index
        let funding_rate = update_accumulative_index(
            price_state,
            oracle_px,
            impact_bid,
            impact_ask,
            interest_rate,
            current_time
        );

        // Emit event
        event::emit<PriceUpdateEvent>(PriceUpdateEvent::V1 {
            market,
            oracle_px,
            mark_px: price_state.mark_px,
            impact_ask_px: impact_ask,
            impact_bid_px: impact_bid,
            funding_index: price_state.accumulative_index.index,
            funding_rate_bps: funding_rate,
        });

        (true, price_state.mark_px, price_state.accumulative_index)
    }

    /// Update withdrawal mark price
    friend fun update_withdraw_mark_px(
        market: object::Object<perp_market::PerpMarket>,
        new_mark_px: u64,
        new_funding_index: AccumulativeIndex
    ): (u64, AccumulativeIndex, u64, u64, u8) acquires Price {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let price_state = borrow_global_mut<Price>(market_addr);

        let old_mark = price_state.withdraw_mark_px;
        let old_index = price_state.withdraw_accumulative_index;

        price_state.withdraw_mark_px = new_mark_px;
        price_state.withdraw_accumulative_index = new_funding_index;

        (
            old_mark,
            old_index,
            price_state.size_multiplier,
            price_state.unrealized_pnl_haircut_bps,
            price_state.withdrawable_margin_leverage
        )
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    /// Initialize price management
    friend fun new_price_management(deployer: &signer) {
        if (!(signer::address_of(deployer) == @decibel)) {
            abort error::invalid_argument(1)
        };

        let store = PriceIndexStore::V1 { interest_rate: DEFAULT_INTEREST_RATE };
        move_to<PriceIndexStore>(deployer, store);
    }

    /// Set max leverage for a market
    friend fun set_max_leverage(market: object::Object<perp_market::PerpMarket>, max_lev: u8)
        acquires Price
    {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        borrow_global_mut<Price>(market_addr).max_leverage = max_lev;
    }

    /// Override mark price (only for delisted markets)
    friend fun override_mark_price(market: object::Object<perp_market::PerpMarket>, price: u64)
        acquires Price
    {
        assert!(perp_market_config::is_market_delisted(market), 3);

        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let price_state = borrow_global_mut<Price>(market_addr);

        price_state.mark_px = price;
        price_state.withdraw_mark_px = price;

        if (!(price > 0)) {
            abort error::invalid_argument(4)
        };

        event::emit<PriceUpdateEvent>(PriceUpdateEvent::V1 {
            market,
            oracle_px: price,
            mark_px: price,
            impact_ask_px: price,
            impact_bid_px: price,
            funding_index: price_state.accumulative_index.index,
            funding_rate_bps: 0i64,
        });
    }

    /// Set funding rate pause timeout
    friend fun set_funding_rate_pause_timeout_microseconds(
        market: object::Object<perp_market::PerpMarket>,
        timeout: u64
    ) acquires Price {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        borrow_global_mut<Price>(market_addr).funding_rate_pause_timeout_microseconds = timeout;
    }

    /// Set global interest rate
    friend fun set_interest_rate(admin: &signer, rate: u64) acquires PriceIndexStore {
        if (!(signer::address_of(admin) == @decibel)) {
            abort error::invalid_argument(1)
        };
        borrow_global_mut<PriceIndexStore>(@decibel).interest_rate = rate;
    }

    /// Set unrealized PnL haircut
    friend fun set_unrealized_pnl_haircut_bps(
        market: object::Object<perp_market::PerpMarket>,
        haircut_bps: u64
    ) acquires Price {
        if (!(haircut_bps < 10000)) {
            abort error::invalid_argument(256)
        };
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        borrow_global_mut<Price>(market_addr).unrealized_pnl_haircut_bps = haircut_bps;
    }

    /// Set withdrawable margin leverage
    friend fun set_withdrawable_margin_leverage(
        market: object::Object<perp_market::PerpMarket>,
        withdraw_lev: u8,
        max_lev: u8
    ) acquires Price {
        if (!(withdraw_lev > 0u8 && withdraw_lev <= max_lev)) {
            abort error::invalid_argument(257)
        };
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        borrow_global_mut<Price>(market_addr).withdrawable_margin_leverage = withdraw_lev;
    }
}
