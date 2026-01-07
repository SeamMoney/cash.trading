/// ============================================================================
/// CHAINLINK STATE - Chainlink Price Feed Integration
/// ============================================================================
///
/// This module manages Chainlink price feeds for the Decibel protocol.
/// It stores verified price data from Chainlink Data Streams and provides
/// price conversion functionality.
///
/// KEY FEATURES:
/// - Stores verified Chainlink price reports
/// - Converts prices between different decimal precisions
/// - Supports multiple price feeds via feed_id lookup
/// - Timestamps ensure price freshness can be verified
///
/// PRICE FORMAT:
/// - Chainlink prices are stored as u256 with 18 decimal places
/// - Prices can be converted to different precisions using rescale_decimals
///
/// VERIFICATION:
/// Price reports must be verified by the Chainlink verifier contract
/// before being stored. Only newer prices overwrite existing ones.
///
/// ============================================================================

module decibel::chainlink_state {
    use std::table;
    use std::signer;
    use std::vector;

    use decibel::math;

    // External dependency: Chainlink verifier
    // use chainlink_verifier::verifier;

    // ============================================================================
    // CONSTANTS
    // ============================================================================

    /// Chainlink prices have 18 decimal places
    const CHAINLINK_DECIMALS: u8 = 18;

    /// Bitmask for checking if a u256 value represents a negative number
    /// This is the sign bit for Chainlink's signed price format
    const NEGATIVE_MASK: u256 = 3138550867693340381917894711603833208051177722232017256448u256;

    // ============================================================================
    // CORE STRUCTURES
    // ============================================================================

    /// Price data for a single feed
    struct PriceData has copy, drop, store {
        /// The raw price value (18 decimal places)
        price: u256,
        /// Unix timestamp when price was published
        timestamp: u32,
    }

    /// Global storage for all Chainlink price feeds
    struct PriceStore has key {
        /// Map of feed_id -> PriceData
        feeds: table::Table<vector<u8>, PriceData>,
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Initialize the Chainlink price store
    fun initialize(deployer: &signer) {
        assert!(signer::address_of(deployer) == @decibel, 5);

        if (!exists<PriceStore>(@decibel)) {
            let store = PriceStore {
                feeds: table::new<vector<u8>, PriceData>(),
            };
            move_to<PriceStore>(deployer, store);
        };
    }

    /// Module initialization
    fun init_module(deployer: &signer) {
        initialize(deployer);
    }

    // ============================================================================
    // VALIDATION
    // ============================================================================

    /// Assert that the price store is initialized
    public fun assert_initialized() {
        assert!(exists<PriceStore>(@decibel), 3);
    }

    // ============================================================================
    // PRICE CONVERSION
    // ============================================================================

    /// Convert a Chainlink price to a different precision
    ///
    /// # Parameters
    /// - `feed_id`: The Chainlink feed identifier
    /// - `rescale_decimals`: Decimal adjustment (can be negative)
    /// - `target_decimals`: Target number of decimal places
    ///
    /// # Returns
    /// - `price`: The converted price as u64
    /// - `timestamp`: The price timestamp
    ///
    /// # Calculation
    /// target_decimals + rescale_decimals - chainlink_decimals (18)
    /// If positive: multiply by 10^diff
    /// If negative: divide by 10^diff
    public fun convert_price(
        feed_id: vector<u8>,
        source_decimals: u8,
        rescale_decimals: i8,
        target_decimals: u8
    ): (u64, u32) acquires PriceStore {
        let (raw_price, timestamp) = get_latest_price(feed_id);
        let price_u128 = raw_price as u128;

        // Calculate decimal adjustment
        // target = target_decimals + rescale_decimals - source_decimals
        let target_adjustment = (target_decimals as i8) + rescale_decimals;
        let source_adjustment = source_decimals as i8;
        let decimal_diff = target_adjustment - source_adjustment;

        if (decimal_diff < 0i8) {
            // Need to divide (reduce precision)
            let precision = math::new_precision((-decimal_diff) as u8);
            let divisor = math::get_decimals_multiplier(&precision) as u128;
            price_u128 = price_u128 / divisor;
        } else if (decimal_diff > 0i8) {
            // Need to multiply (increase precision)
            let precision = math::new_precision(decimal_diff as u8);
            let multiplier = math::get_decimals_multiplier(&precision) as u128;
            price_u128 = price_u128 * multiplier;
        };

        (price_u128 as u64, timestamp)
    }

    /// Get the latest price for a feed
    ///
    /// # Parameters
    /// - `feed_id`: The Chainlink feed identifier
    ///
    /// # Returns
    /// - `price`: The raw price (u256, 18 decimals)
    /// - `timestamp`: The price timestamp
    public fun get_latest_price(feed_id: vector<u8>): (u256, u32) acquires PriceStore {
        let store = borrow_global<PriceStore>(@decibel);
        let price_data = table::borrow<vector<u8>, PriceData>(&store.feeds, feed_id);
        (price_data.price, price_data.timestamp)
    }

    /// Get price converted to target decimals (convenience function)
    ///
    /// Uses default 18 decimal source (standard Chainlink format)
    public fun get_converted_price(
        feed_id: vector<u8>,
        rescale_decimals: i8,
        target_decimals: u8
    ): u64 acquires PriceStore {
        let (price, _timestamp) = convert_price(feed_id, CHAINLINK_DECIMALS, rescale_decimals, target_decimals);
        price
    }

    /// Check if a u256 price represents a negative value
    ///
    /// Chainlink uses a specific bit pattern to indicate negative prices
    public fun is_price_negative(price: u256): bool {
        (price & NEGATIVE_MASK) != 0u256
    }

    // ============================================================================
    // REPORT PARSING
    // ============================================================================

    /// Parse a Chainlink v3 report to extract feed_id and price data
    ///
    /// Report format (simplified):
    /// - Bytes 0-31: feed_id
    /// - Bytes 64+28-95: timestamp (u32)
    /// - Bytes 192+8-223: price (u256, actually 24 bytes used)
    fun parse_v3_report(report: &vector<u8>): (vector<u8>, PriceData) {
        // Extract feed_id (first 32 bytes)
        let feed_id = vector::slice<u8>(report, 0, 32);

        // Extract timestamp at offset 64 (reading 4 bytes at offset 64+28)
        let timestamp = read_u32(report, 64);

        // Extract price at offset 192 (reading 24 bytes at offset 192+8)
        let price = read_u256(report, 192);

        let price_data = PriceData { price, timestamp };
        (feed_id, price_data)
    }

    /// Read a u32 value from a byte vector at the given offset
    /// Reads from offset + 28 to get the last 4 bytes of a 32-byte slot
    fun read_u32(data: &vector<u8>, offset: u64): u32 {
        let pos = offset + 28;
        let b0 = (*vector::borrow<u8>(data, pos) as u32) << 24u8;
        let b1 = (*vector::borrow<u8>(data, pos + 1) as u32) << 16u8;
        let b2 = (*vector::borrow<u8>(data, pos + 2) as u32) << 8u8;
        let b3 = (*vector::borrow<u8>(data, pos + 3) as u32);
        b0 | b1 | b2 | b3
    }

    /// Read a u256 value from a byte vector at the given offset
    /// Reads 24 bytes starting at offset + 8
    fun read_u256(data: &vector<u8>, offset: u64): u256 {
        let result = 0u256;
        let pos = offset + 8;
        let i = 0;

        while (i < 24) {
            result = (result << 8u8);
            let byte = (*vector::borrow<u8>(data, pos + i) as u256);
            result = result | byte;
            i = i + 1;
        };

        result
    }

    // ============================================================================
    // PRICE STORAGE
    // ============================================================================

    /// Verify and store multiple Chainlink price reports
    ///
    /// # Parameters
    /// - `caller`: The signer submitting the reports
    /// - `reports`: Vector of encoded price reports
    ///
    /// Each report is verified by the Chainlink verifier contract.
    /// Only prices newer than existing ones are stored.
    public entry fun verify_and_store_multiple_prices(
        caller: &signer,
        reports: vector<vector<u8>>
    ) acquires PriceStore {
        assert_initialized();

        let store = borrow_global_mut<PriceStore>(@decibel);

        while (!vector::is_empty<vector<u8>>(&reports)) {
            let report = vector::pop_back<vector<u8>>(&mut reports);

            // Verify the report with Chainlink verifier
            // This returns the verified payload
            // let verified_payload = verifier::verify(caller, report);
            // For decompiled code, we call the external verifier
            let verified_payload = 0xc68769ae9efe2d02f10bc5baed793cfe0fe780c41e428d087d5d61286448090::verifier::verify(caller, report);

            // Parse the verified report
            let (feed_id, price_data) = parse_v3_report(&verified_payload);

            // Add or update the price
            if (!table::contains<vector<u8>, PriceData>(&store.feeds, feed_id)) {
                // New feed - add it
                table::add<vector<u8>, PriceData>(&mut store.feeds, feed_id, price_data);
            } else {
                // Existing feed - only update if newer
                let existing = table::borrow<vector<u8>, PriceData>(&store.feeds, feed_id);
                if (existing.timestamp < price_data.timestamp) {
                    table::upsert<vector<u8>, PriceData>(&mut store.feeds, feed_id, price_data);
                };
            };
        };
    }

    /// Verify and store a single Chainlink price report
    public entry fun verify_and_store_single_price(
        caller: &signer,
        report: vector<u8>
    ) acquires PriceStore {
        let reports = vector::empty<vector<u8>>();
        vector::push_back<vector<u8>>(&mut reports, report);
        verify_and_store_multiple_prices(caller, reports);
    }
}
