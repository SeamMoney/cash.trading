/// ============================================================================
/// Module: volume_tracker
/// Description: Tracks trading volume for fee tier calculations
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module tracks trading volume over a rolling 30-day window to determine
/// fee tier eligibility. Features:
///
/// - Global volume tracking (total platform volume)
/// - Per-user maker volume (volume as liquidity provider)
/// - Per-user taker volume (volume as market taker)
/// - Rolling 30-day window with daily granularity
/// - All-time volume statistics
///
/// Volume affects:
/// - Fee tier (higher volume = lower fees)
/// - Market maker rebate eligibility
/// - Referral fee eligibility
///
/// Implementation:
/// - Uses Aptos aggregators for parallel-safe updates
/// - Stores daily volume history for window calculations
/// - Automatically rolls over data when day changes
/// ============================================================================

module decibel::volume_tracker {
    use aptos_framework::aggregator_v2::{Self, Aggregator};
    use aptos_framework::table::{Self, Table};
    use aptos_framework::event;
    use aptos_framework::vector;
    use decibel::decibel_time;

    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================

    /// Trading fees manager uses volume for fee calculations
    friend decibel::trading_fees_manager;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// Seconds in a day for time calculations
    const SECONDS_PER_DAY: u64 = 86400;

    /// Days in the rolling window for fee tier calculation
    const WINDOW_DAYS: u64 = 30;

    /// Maximum u128 value for aggregator bounds
    const MAX_U128: u128 = 340282366920938463463374607431768211455;

    /// Error codes
    const E_AGGREGATOR_UNDERFLOW: u64 = 3;

    // =========================================================================
    // TYPES
    // =========================================================================

    /// Volume for a single day
    struct DayVolume has copy, drop, store {
        /// Day number since Unix epoch (seconds / 86400)
        day_since_epoch: u64,
        /// Total volume on that day (in collateral units)
        volume: u128,
    }

    /// Historical volume data with rolling window
    struct VolumeHistory has drop, store {
        /// Most recent day number
        latest_day_since_epoch: u64,
        /// Current day's volume (aggregator for parallel updates)
        latest_day_volume: Aggregator<u128>,
        /// Historical daily volumes (last 30 days)
        history: vector<DayVolume>,
        /// Sum of volume in the 30-day window
        total_volume_in_window: u128,
        /// All-time total volume (aggregator)
        total_volume_all_time: Aggregator<u128>,
    }

    /// Event emitted when volume history is updated
    enum VolumeHistoryUpdateEvent has copy, drop, store {
        V1 {
            /// Type of volume being tracked
            volume_type: VolumeType,
            /// Current day number
            latest_day_since_epoch: u64,
            /// Volume on current day
            latest_day_volume: u128,
            /// Historical daily volumes
            history: vector<DayVolume>,
            /// Total in rolling window
            total_volume_in_window: u128,
            /// All-time total
            total_volume_all_time: u128,
        }
    }

    /// Type of volume being tracked
    enum VolumeType has copy, drop, store {
        /// Global platform volume
        Global,
        /// User's maker volume (liquidity provision)
        Maker { _0: address },
        /// User's taker volume (market taking)
        Taker { _0: address },
    }

    /// Aggregate volume statistics storage
    struct VolumeStats has store {
        /// Global platform volume history
        global_history: VolumeHistory,
        /// Per-user taker volume: address -> VolumeHistory
        user_taker_volume_history: Table<address, VolumeHistory>,
        /// Per-user maker volume: address -> VolumeHistory
        user_maker_volume_history: Table<address, VolumeHistory>,
    }

    // =========================================================================
    // FRIEND FUNCTIONS - INITIALIZATION
    // =========================================================================

    /// Initializes volume tracking state
    ///
    /// # Returns
    /// New VolumeStats struct with empty history
    friend fun initialize(): VolumeStats {
        let current_day = decibel_time::now_seconds() / SECONDS_PER_DAY;

        let global_history = VolumeHistory {
            latest_day_since_epoch: current_day,
            latest_day_volume: aggregator_v2::create_aggregator_with_value(0u128, MAX_U128),
            history: vector::empty<DayVolume>(),
            total_volume_in_window: 0,
            total_volume_all_time: aggregator_v2::create_aggregator_with_value(0u128, MAX_U128),
        };

        VolumeStats {
            global_history,
            user_taker_volume_history: table::new<address, VolumeHistory>(),
            user_maker_volume_history: table::new<address, VolumeHistory>(),
        }
    }

    // =========================================================================
    // FRIEND FUNCTIONS - VOLUME QUERIES
    // =========================================================================

    /// Gets global platform volume in the 30-day window
    ///
    /// # Arguments
    /// * `stats` - Mutable reference to volume stats (may update on day rollover)
    ///
    /// # Returns
    /// Total platform volume in the rolling 30-day window
    friend fun get_global_volume_in_window(stats: &mut VolumeStats): u128 {
        let history = &mut stats.global_history;
        maybe_rollover_and_emit(history, VolumeType::Global);
        stats.global_history.total_volume_in_window
    }

    /// Gets a user's maker volume in the 30-day window
    friend fun get_maker_volume_in_window(stats: &mut VolumeStats, user: address): u128 {
        if (!table::contains(&stats.user_maker_volume_history, user)) {
            return 0
        };

        let history = table::borrow_mut(&mut stats.user_maker_volume_history, user);
        maybe_rollover_and_emit(history, VolumeType::Maker { _0: user });
        history.total_volume_in_window
    }

    /// Gets a user's taker volume in the 30-day window
    friend fun get_taker_volume_in_window(stats: &mut VolumeStats, user: address): u128 {
        if (!table::contains(&stats.user_taker_volume_history, user)) {
            return 0
        };

        let history = table::borrow_mut(&mut stats.user_taker_volume_history, user);
        maybe_rollover_and_emit(history, VolumeType::Taker { _0: user });
        history.total_volume_in_window
    }

    /// Gets a user's total volume (maker + taker) in the 30-day window
    friend fun get_total_volume_in_window(stats: &mut VolumeStats, user: address): u128 {
        let total = 0u128;

        // Add maker volume
        if (table::contains(&stats.user_maker_volume_history, user)) {
            let history = table::borrow_mut(&mut stats.user_maker_volume_history, user);
            maybe_rollover_and_emit(history, VolumeType::Maker { _0: user });
            total = total + history.total_volume_in_window;
        };

        // Add taker volume
        if (table::contains(&stats.user_taker_volume_history, user)) {
            let history = table::borrow_mut(&mut stats.user_taker_volume_history, user);
            maybe_rollover_and_emit(history, VolumeType::Taker { _0: user });
            total = total + history.total_volume_in_window;
        };

        total
    }

    /// Gets a user's all-time maker volume
    friend fun get_maker_volume_all_time(stats: &mut VolumeStats, user: address): u128 {
        if (!table::contains(&stats.user_maker_volume_history, user)) {
            return 0
        };
        let history = table::borrow_mut(&mut stats.user_maker_volume_history, user);
        aggregator_v2::read(&history.total_volume_all_time)
    }

    /// Gets a user's all-time taker volume
    friend fun get_taker_volume_all_time(stats: &mut VolumeStats, user: address): u128 {
        if (!table::contains(&stats.user_taker_volume_history, user)) {
            return 0
        };
        let history = table::borrow_mut(&mut stats.user_taker_volume_history, user);
        aggregator_v2::read(&history.total_volume_all_time)
    }

    // =========================================================================
    // FRIEND FUNCTIONS - VOLUME TRACKING
    // =========================================================================

    /// Tracks taker volume for a user
    ///
    /// # Arguments
    /// * `stats` - Mutable reference to volume stats
    /// * `taker` - Address of the taker
    /// * `volume` - Volume to add
    friend fun track_taker_volume(stats: &mut VolumeStats, taker: address, volume: u128) {
        ensure_user_history_exists(&mut stats.user_taker_volume_history, taker);

        let history = table::borrow_mut(&mut stats.user_taker_volume_history, taker);
        add_volume_to_history(history, volume, VolumeType::Taker { _0: taker });
    }

    /// Tracks maker and global volume (taker tracked separately)
    friend fun track_maker_and_global_volume(stats: &mut VolumeStats, maker: address, volume: u128) {
        // Track global volume
        add_volume_to_history(&mut stats.global_history, volume, VolumeType::Global);

        // Track maker volume
        ensure_user_history_exists(&mut stats.user_maker_volume_history, maker);
        let history = table::borrow_mut(&mut stats.user_maker_volume_history, maker);
        add_volume_to_history(history, volume, VolumeType::Maker { _0: maker });
    }

    /// Tracks volume for a complete trade (maker, taker, and global)
    ///
    /// # Arguments
    /// * `stats` - Mutable reference to volume stats
    /// * `maker` - Address of the maker (liquidity provider)
    /// * `taker` - Address of the taker (market taker)
    /// * `volume` - Trade volume
    friend fun track_volume(
        stats: &mut VolumeStats,
        maker: address,
        taker: address,
        volume: u128
    ) {
        // Track global volume
        add_volume_to_history(&mut stats.global_history, volume, VolumeType::Global);

        // Track taker volume
        ensure_user_history_exists(&mut stats.user_taker_volume_history, taker);
        let taker_history = table::borrow_mut(&mut stats.user_taker_volume_history, taker);
        add_volume_to_history(taker_history, volume, VolumeType::Taker { _0: taker });

        // Track maker volume
        ensure_user_history_exists(&mut stats.user_maker_volume_history, maker);
        let maker_history = table::borrow_mut(&mut stats.user_maker_volume_history, maker);
        add_volume_to_history(maker_history, volume, VolumeType::Maker { _0: maker });
    }

    // =========================================================================
    // INTERNAL FUNCTIONS
    // =========================================================================

    /// Creates a new volume history for a user if it doesn't exist
    fun ensure_user_history_exists(
        history_table: &mut Table<address, VolumeHistory>,
        user: address
    ) {
        if (!table::contains(history_table, user)) {
            let current_day = decibel_time::now_seconds() / SECONDS_PER_DAY;
            let new_history = VolumeHistory {
                latest_day_since_epoch: current_day,
                latest_day_volume: aggregator_v2::create_aggregator_with_value(0u128, MAX_U128),
                history: vector::empty<DayVolume>(),
                total_volume_in_window: 0,
                total_volume_all_time: aggregator_v2::create_aggregator_with_value(0u128, MAX_U128),
            };
            table::add(history_table, user, new_history);
        };
    }

    /// Adds volume to a history, handling day rollover
    fun add_volume_to_history(
        history: &mut VolumeHistory,
        volume: u128,
        volume_type: VolumeType
    ) {
        let current_day = decibel_time::now_seconds() / SECONDS_PER_DAY;
        let did_rollover = false;

        // Check if we need to roll over to a new day
        if (current_day != history.latest_day_since_epoch) {
            did_rollover = true;
            rollover_volume_history(history);

            // Reset current day volume
            let old_volume = aggregator_v2::read(&history.latest_day_volume);
            assert!(aggregator_v2::try_sub(&mut history.latest_day_volume, old_volume), E_AGGREGATOR_UNDERFLOW);
            history.latest_day_since_epoch = current_day;
        };

        // Add volume to current day and all-time
        if (volume > 0) {
            aggregator_v2::add(&mut history.latest_day_volume, volume);
            aggregator_v2::add(&mut history.total_volume_all_time, volume);
        };

        // Emit event if rollover occurred
        if (did_rollover) {
            emit_volume_update_event(history, volume_type);
        };
    }

    /// Checks for day change and emits event if needed
    fun maybe_rollover_and_emit(history: &mut VolumeHistory, volume_type: VolumeType) {
        let current_day = decibel_time::now_seconds() / SECONDS_PER_DAY;
        let did_rollover = false;

        if (current_day != history.latest_day_since_epoch) {
            did_rollover = true;
            rollover_volume_history(history);

            // Reset current day volume
            let old_volume = aggregator_v2::read(&history.latest_day_volume);
            assert!(aggregator_v2::try_sub(&mut history.latest_day_volume, old_volume), E_AGGREGATOR_UNDERFLOW);
            history.latest_day_since_epoch = current_day;
        };

        if (did_rollover) {
            emit_volume_update_event(history, volume_type);
        };
    }

    /// Rolls over volume history when day changes
    ///
    /// - Archives current day's volume to history
    /// - Removes entries older than 30 days from window
    /// - Updates window total
    fun rollover_volume_history(history: &mut VolumeHistory) {
        let current_day = decibel_time::now_seconds() / SECONDS_PER_DAY;

        // Save current day to history
        let current_volume = aggregator_v2::read(&history.latest_day_volume);
        let day_volume = DayVolume {
            day_since_epoch: history.latest_day_since_epoch,
            volume: current_volume,
        };
        vector::push_back(&mut history.history, day_volume);

        // Add to window total
        history.total_volume_in_window = history.total_volume_in_window + current_volume;

        // Remove old entries (older than 30 days)
        let cutoff_day = current_day - WINDOW_DAYS;
        let i = 0;
        while (i < vector::length(&history.history)) {
            let entry = vector::borrow(&history.history, i);
            if (entry.day_since_epoch < cutoff_day) {
                // Subtract from window total and remove
                history.total_volume_in_window = history.total_volume_in_window - entry.volume;
                vector::swap_remove(&mut history.history, i);
                // Don't increment i since swap_remove puts new element at i
            } else {
                i = i + 1;
            };
        };
    }

    /// Emits a volume history update event
    fun emit_volume_update_event(history: &VolumeHistory, volume_type: VolumeType) {
        event::emit(VolumeHistoryUpdateEvent::V1 {
            volume_type,
            latest_day_since_epoch: history.latest_day_since_epoch,
            latest_day_volume: aggregator_v2::read(&history.latest_day_volume),
            history: history.history,
            total_volume_in_window: history.total_volume_in_window,
            total_volume_all_time: aggregator_v2::read(&history.total_volume_all_time),
        });
    }
}
