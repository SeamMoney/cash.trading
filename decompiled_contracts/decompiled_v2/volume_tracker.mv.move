module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::volume_tracker {
    use 0x1::aggregator_v2;
    use 0x1::table;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::decibel_time;
    use 0x1::event;
    use 0x1::vector;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::trading_fees_manager;
    struct DayVolume has copy, drop, store {
        day_since_epoch: u64,
        volume: u128,
    }
    struct VolumeHistory has drop, store {
        latest_day_since_epoch: u64,
        latest_day_volume: aggregator_v2::Aggregator<u128>,
        history: vector<DayVolume>,
        total_volume_in_window: u128,
        total_volume_all_time: aggregator_v2::Aggregator<u128>,
    }
    struct VolumeHistoryUpdateEvent has copy, drop, store {
        volume_type: VolumeType,
        latest_day_since_epoch: u64,
        latest_day_volume: u128,
        history: vector<DayVolume>,
        total_volume_in_window: u128,
        total_volume_all_time: u128,
    }
    enum VolumeType has copy, drop, store {
        Global,
        Maker {
            _0: address,
        }
        Taker {
            _0: address,
        }
    }
    struct VolumeStats has store {
        global_history: VolumeHistory,
        user_taker_volume_history: table::Table<address, VolumeHistory>,
        user_maker_volume_history: table::Table<address, VolumeHistory>,
    }
    friend fun initialize(): VolumeStats {
        let _v0 = decibel_time::now_seconds() / 86400;
        let _v1 = aggregator_v2::create_aggregator_with_value<u128>(0u128, 340282366920938463463374607431768211455u128);
        let _v2 = vector::empty<DayVolume>();
        let _v3 = aggregator_v2::create_aggregator_with_value<u128>(0u128, 340282366920938463463374607431768211455u128);
        let _v4 = VolumeHistory{latest_day_since_epoch: _v0, latest_day_volume: _v1, history: _v2, total_volume_in_window: 0u128, total_volume_all_time: _v3};
        let _v5 = table::new<address,VolumeHistory>();
        let _v6 = table::new<address,VolumeHistory>();
        VolumeStats{global_history: _v4, user_taker_volume_history: _v5, user_maker_volume_history: _v6}
    }
    friend fun get_global_volume_in_window(p0: &mut VolumeStats): u128 {
        let _v0 = &mut p0.global_history;
        let _v1 = VolumeType::Global{};
        let _v2 = decibel_time::now_seconds() / 86400;
        let _v3 = false;
        let _v4 = *&_v0.latest_day_since_epoch;
        if (_v2 != _v4) {
            _v3 = true;
            rollover_volume_history(_v0);
            let _v5 = aggregator_v2::read<u128>(&_v0.latest_day_volume);
            assert!(aggregator_v2::try_sub<u128>(&mut _v0.latest_day_volume, _v5), 3);
            let _v6 = &mut _v0.latest_day_since_epoch;
            *_v6 = _v2
        };
        if (_v3) {
            let _v7 = *&_v0.latest_day_since_epoch;
            let _v8 = aggregator_v2::read<u128>(&_v0.latest_day_volume);
            let _v9 = *&_v0.history;
            let _v10 = *&_v0.total_volume_in_window;
            let _v11 = aggregator_v2::read<u128>(&_v0.total_volume_all_time);
            event::emit<VolumeHistoryUpdateEvent>(VolumeHistoryUpdateEvent{volume_type: _v1, latest_day_since_epoch: _v7, latest_day_volume: _v8, history: _v9, total_volume_in_window: _v10, total_volume_all_time: _v11})
        };
        *&(&p0.global_history).total_volume_in_window
    }
    fun rollover_volume_history(p0: &mut VolumeHistory) {
        let _v0 = decibel_time::now_seconds() / 86400;
        let _v1 = &mut p0.history;
        let _v2 = *&p0.latest_day_since_epoch;
        let _v3 = aggregator_v2::read<u128>(&p0.latest_day_volume);
        let _v4 = DayVolume{day_since_epoch: _v2, volume: _v3};
        vector::push_back<DayVolume>(_v1, _v4);
        let _v5 = aggregator_v2::read<u128>(&p0.latest_day_volume);
        let _v6 = &mut p0.total_volume_in_window;
        *_v6 = *_v6 + _v5;
        let _v7 = 0;
        loop {
            let _v8 = vector::length<DayVolume>(&p0.history);
            if (!(_v7 < _v8)) break;
            let _v9 = *&vector::borrow<DayVolume>(&p0.history, _v7).day_since_epoch;
            let _v10 = _v0 - 30;
            if (_v9 < _v10) {
                _v5 = *&vector::borrow<DayVolume>(&p0.history, _v7).volume;
                _v6 = &mut p0.total_volume_in_window;
                *_v6 = *_v6 - _v5;
                let _v11 = vector::swap_remove<DayVolume>(&mut p0.history, _v7);
                continue
            };
            _v7 = _v7 + 1;
            continue
        };
    }
    friend fun get_maker_volume_all_time(p0: &mut VolumeStats, p1: address): u128 {
        if (!table::contains<address,VolumeHistory>(&p0.user_maker_volume_history, p1)) return 0u128;
        aggregator_v2::read<u128>(&table::borrow_mut<address,VolumeHistory>(&mut p0.user_maker_volume_history, p1).total_volume_all_time)
    }
    friend fun get_maker_volume_in_window(p0: &mut VolumeStats, p1: address): u128 {
        let _v0;
        let _v1 = table::contains<address,VolumeHistory>(&p0.user_maker_volume_history, p1);
        loop {
            if (_v1) {
                _v0 = table::borrow_mut<address,VolumeHistory>(&mut p0.user_maker_volume_history, p1);
                let _v2 = _v0;
                let _v3 = VolumeType::Maker{_0: p1};
                let _v4 = decibel_time::now_seconds() / 86400;
                let _v5 = false;
                let _v6 = *&_v2.latest_day_since_epoch;
                if (_v4 != _v6) {
                    _v5 = true;
                    rollover_volume_history(_v2);
                    let _v7 = aggregator_v2::read<u128>(&_v2.latest_day_volume);
                    assert!(aggregator_v2::try_sub<u128>(&mut _v2.latest_day_volume, _v7), 3);
                    let _v8 = &mut _v2.latest_day_since_epoch;
                    *_v8 = _v4
                };
                if (_v5) {
                    let _v9 = *&_v2.latest_day_since_epoch;
                    let _v10 = aggregator_v2::read<u128>(&_v2.latest_day_volume);
                    let _v11 = *&_v2.history;
                    let _v12 = *&_v2.total_volume_in_window;
                    let _v13 = aggregator_v2::read<u128>(&_v2.total_volume_all_time);
                    event::emit<VolumeHistoryUpdateEvent>(VolumeHistoryUpdateEvent{volume_type: _v3, latest_day_since_epoch: _v9, latest_day_volume: _v10, history: _v11, total_volume_in_window: _v12, total_volume_all_time: _v13});
                    break
                };
                break
            };
            return 0u128
        };
        *&_v0.total_volume_in_window
    }
    friend fun get_taker_volume_all_time(p0: &mut VolumeStats, p1: address): u128 {
        if (!table::contains<address,VolumeHistory>(&p0.user_taker_volume_history, p1)) return 0u128;
        aggregator_v2::read<u128>(&table::borrow_mut<address,VolumeHistory>(&mut p0.user_taker_volume_history, p1).total_volume_all_time)
    }
    friend fun get_taker_volume_in_window(p0: &mut VolumeStats, p1: address): u128 {
        let _v0;
        let _v1 = table::contains<address,VolumeHistory>(&p0.user_taker_volume_history, p1);
        loop {
            if (_v1) {
                _v0 = table::borrow_mut<address,VolumeHistory>(&mut p0.user_taker_volume_history, p1);
                let _v2 = _v0;
                let _v3 = VolumeType::Taker{_0: p1};
                let _v4 = decibel_time::now_seconds() / 86400;
                let _v5 = false;
                let _v6 = *&_v2.latest_day_since_epoch;
                if (_v4 != _v6) {
                    _v5 = true;
                    rollover_volume_history(_v2);
                    let _v7 = aggregator_v2::read<u128>(&_v2.latest_day_volume);
                    assert!(aggregator_v2::try_sub<u128>(&mut _v2.latest_day_volume, _v7), 3);
                    let _v8 = &mut _v2.latest_day_since_epoch;
                    *_v8 = _v4
                };
                if (_v5) {
                    let _v9 = *&_v2.latest_day_since_epoch;
                    let _v10 = aggregator_v2::read<u128>(&_v2.latest_day_volume);
                    let _v11 = *&_v2.history;
                    let _v12 = *&_v2.total_volume_in_window;
                    let _v13 = aggregator_v2::read<u128>(&_v2.total_volume_all_time);
                    event::emit<VolumeHistoryUpdateEvent>(VolumeHistoryUpdateEvent{volume_type: _v3, latest_day_since_epoch: _v9, latest_day_volume: _v10, history: _v11, total_volume_in_window: _v12, total_volume_all_time: _v13});
                    break
                };
                break
            };
            return 0u128
        };
        *&_v0.total_volume_in_window
    }
    friend fun track_maker_and_global_volume(p0: &mut VolumeStats, p1: address, p2: u128) {
        let _v0;
        let _v1;
        let _v2 = &mut p0.global_history;
        let _v3 = p2;
        let _v4 = VolumeType::Global{};
        let _v5 = decibel_time::now_seconds() / 86400;
        let _v6 = false;
        let _v7 = *&_v2.latest_day_since_epoch;
        if (_v5 != _v7) {
            _v6 = true;
            rollover_volume_history(_v2);
            _v1 = aggregator_v2::read<u128>(&_v2.latest_day_volume);
            assert!(aggregator_v2::try_sub<u128>(&mut _v2.latest_day_volume, _v1), 3);
            _v0 = &mut _v2.latest_day_since_epoch;
            *_v0 = _v5
        };
        if (_v3 > 0u128) {
            aggregator_v2::add<u128>(&mut _v2.latest_day_volume, _v3);
            aggregator_v2::add<u128>(&mut _v2.total_volume_all_time, _v3)
        };
        if (_v6) {
            let _v8 = *&_v2.latest_day_since_epoch;
            let _v9 = aggregator_v2::read<u128>(&_v2.latest_day_volume);
            let _v10 = *&_v2.history;
            let _v11 = *&_v2.total_volume_in_window;
            let _v12 = aggregator_v2::read<u128>(&_v2.total_volume_all_time);
            event::emit<VolumeHistoryUpdateEvent>(VolumeHistoryUpdateEvent{volume_type: _v4, latest_day_since_epoch: _v8, latest_day_volume: _v9, history: _v10, total_volume_in_window: _v11, total_volume_all_time: _v12})
        };
        let _v13 = &mut p0.user_maker_volume_history;
        let _v14 = p1;
        if (!table::contains<address,VolumeHistory>(freeze(_v13), _v14)) {
            let _v15 = decibel_time::now_seconds() / 86400;
            let _v16 = aggregator_v2::create_aggregator_with_value<u128>(0u128, 340282366920938463463374607431768211455u128);
            let _v17 = vector::empty<DayVolume>();
            let _v18 = aggregator_v2::create_aggregator_with_value<u128>(0u128, 340282366920938463463374607431768211455u128);
            let _v19 = VolumeHistory{latest_day_since_epoch: _v15, latest_day_volume: _v16, history: _v17, total_volume_in_window: 0u128, total_volume_all_time: _v18};
            table::add<address,VolumeHistory>(_v13, _v14, _v19)
        };
        let _v20 = table::borrow_mut<address,VolumeHistory>(_v13, _v14);
        _v1 = p2;
        let _v21 = VolumeType::Maker{_0: p1};
        let _v22 = decibel_time::now_seconds() / 86400;
        let _v23 = false;
        let _v24 = *&_v20.latest_day_since_epoch;
        if (_v22 != _v24) {
            _v23 = true;
            rollover_volume_history(_v20);
            let _v25 = aggregator_v2::read<u128>(&_v20.latest_day_volume);
            assert!(aggregator_v2::try_sub<u128>(&mut _v20.latest_day_volume, _v25), 3);
            _v0 = &mut _v20.latest_day_since_epoch;
            *_v0 = _v22
        };
        if (_v1 > 0u128) {
            aggregator_v2::add<u128>(&mut _v20.latest_day_volume, _v1);
            aggregator_v2::add<u128>(&mut _v20.total_volume_all_time, _v1)
        };
        if (_v23) {
            let _v26 = *&_v20.latest_day_since_epoch;
            let _v27 = aggregator_v2::read<u128>(&_v20.latest_day_volume);
            let _v28 = *&_v20.history;
            let _v29 = *&_v20.total_volume_in_window;
            let _v30 = aggregator_v2::read<u128>(&_v20.total_volume_all_time);
            event::emit<VolumeHistoryUpdateEvent>(VolumeHistoryUpdateEvent{volume_type: _v21, latest_day_since_epoch: _v26, latest_day_volume: _v27, history: _v28, total_volume_in_window: _v29, total_volume_all_time: _v30});
            return ()
        };
    }
    friend fun track_taker_volume(p0: &mut VolumeStats, p1: address, p2: u128) {
        let _v0 = &mut p0.user_taker_volume_history;
        let _v1 = p1;
        if (!table::contains<address,VolumeHistory>(freeze(_v0), _v1)) {
            let _v2 = decibel_time::now_seconds() / 86400;
            let _v3 = aggregator_v2::create_aggregator_with_value<u128>(0u128, 340282366920938463463374607431768211455u128);
            let _v4 = vector::empty<DayVolume>();
            let _v5 = aggregator_v2::create_aggregator_with_value<u128>(0u128, 340282366920938463463374607431768211455u128);
            let _v6 = VolumeHistory{latest_day_since_epoch: _v2, latest_day_volume: _v3, history: _v4, total_volume_in_window: 0u128, total_volume_all_time: _v5};
            table::add<address,VolumeHistory>(_v0, _v1, _v6)
        };
        let _v7 = table::borrow_mut<address,VolumeHistory>(_v0, _v1);
        let _v8 = VolumeType::Taker{_0: p1};
        let _v9 = decibel_time::now_seconds() / 86400;
        let _v10 = false;
        let _v11 = *&_v7.latest_day_since_epoch;
        if (_v9 != _v11) {
            _v10 = true;
            rollover_volume_history(_v7);
            let _v12 = aggregator_v2::read<u128>(&_v7.latest_day_volume);
            assert!(aggregator_v2::try_sub<u128>(&mut _v7.latest_day_volume, _v12), 3);
            let _v13 = &mut _v7.latest_day_since_epoch;
            *_v13 = _v9
        };
        if (p2 > 0u128) {
            aggregator_v2::add<u128>(&mut _v7.latest_day_volume, p2);
            aggregator_v2::add<u128>(&mut _v7.total_volume_all_time, p2)
        };
        if (_v10) {
            let _v14 = *&_v7.latest_day_since_epoch;
            let _v15 = aggregator_v2::read<u128>(&_v7.latest_day_volume);
            let _v16 = *&_v7.history;
            let _v17 = *&_v7.total_volume_in_window;
            let _v18 = aggregator_v2::read<u128>(&_v7.total_volume_all_time);
            event::emit<VolumeHistoryUpdateEvent>(VolumeHistoryUpdateEvent{volume_type: _v8, latest_day_since_epoch: _v14, latest_day_volume: _v15, history: _v16, total_volume_in_window: _v17, total_volume_all_time: _v18});
            return ()
        };
    }
    friend fun track_volume(p0: &mut VolumeStats, p1: address, p2: address, p3: u128) {
        let _v0;
        let _v1;
        let _v2;
        let _v3 = &mut p0.global_history;
        let _v4 = p3;
        let _v5 = VolumeType::Global{};
        let _v6 = decibel_time::now_seconds() / 86400;
        let _v7 = false;
        let _v8 = *&_v3.latest_day_since_epoch;
        if (_v6 != _v8) {
            _v7 = true;
            rollover_volume_history(_v3);
            _v2 = aggregator_v2::read<u128>(&_v3.latest_day_volume);
            assert!(aggregator_v2::try_sub<u128>(&mut _v3.latest_day_volume, _v2), 3);
            _v1 = &mut _v3.latest_day_since_epoch;
            *_v1 = _v6
        };
        if (_v4 > 0u128) {
            aggregator_v2::add<u128>(&mut _v3.latest_day_volume, _v4);
            aggregator_v2::add<u128>(&mut _v3.total_volume_all_time, _v4)
        };
        if (_v7) {
            let _v9 = *&_v3.latest_day_since_epoch;
            let _v10 = aggregator_v2::read<u128>(&_v3.latest_day_volume);
            let _v11 = *&_v3.history;
            let _v12 = *&_v3.total_volume_in_window;
            let _v13 = aggregator_v2::read<u128>(&_v3.total_volume_all_time);
            event::emit<VolumeHistoryUpdateEvent>(VolumeHistoryUpdateEvent{volume_type: _v5, latest_day_since_epoch: _v9, latest_day_volume: _v10, history: _v11, total_volume_in_window: _v12, total_volume_all_time: _v13})
        };
        let _v14 = &mut p0.user_taker_volume_history;
        let _v15 = p2;
        if (!table::contains<address,VolumeHistory>(freeze(_v14), _v15)) {
            let _v16 = decibel_time::now_seconds() / 86400;
            let _v17 = aggregator_v2::create_aggregator_with_value<u128>(0u128, 340282366920938463463374607431768211455u128);
            let _v18 = vector::empty<DayVolume>();
            let _v19 = aggregator_v2::create_aggregator_with_value<u128>(0u128, 340282366920938463463374607431768211455u128);
            let _v20 = VolumeHistory{latest_day_since_epoch: _v16, latest_day_volume: _v17, history: _v18, total_volume_in_window: 0u128, total_volume_all_time: _v19};
            table::add<address,VolumeHistory>(_v14, _v15, _v20)
        };
        let _v21 = table::borrow_mut<address,VolumeHistory>(_v14, _v15);
        _v2 = p3;
        let _v22 = VolumeType::Taker{_0: p2};
        let _v23 = decibel_time::now_seconds() / 86400;
        let _v24 = false;
        let _v25 = *&_v21.latest_day_since_epoch;
        if (_v23 != _v25) {
            _v24 = true;
            rollover_volume_history(_v21);
            _v0 = aggregator_v2::read<u128>(&_v21.latest_day_volume);
            assert!(aggregator_v2::try_sub<u128>(&mut _v21.latest_day_volume, _v0), 3);
            _v1 = &mut _v21.latest_day_since_epoch;
            *_v1 = _v23
        };
        if (_v2 > 0u128) {
            aggregator_v2::add<u128>(&mut _v21.latest_day_volume, _v2);
            aggregator_v2::add<u128>(&mut _v21.total_volume_all_time, _v2)
        };
        if (_v24) {
            let _v26 = *&_v21.latest_day_since_epoch;
            let _v27 = aggregator_v2::read<u128>(&_v21.latest_day_volume);
            let _v28 = *&_v21.history;
            let _v29 = *&_v21.total_volume_in_window;
            let _v30 = aggregator_v2::read<u128>(&_v21.total_volume_all_time);
            event::emit<VolumeHistoryUpdateEvent>(VolumeHistoryUpdateEvent{volume_type: _v22, latest_day_since_epoch: _v26, latest_day_volume: _v27, history: _v28, total_volume_in_window: _v29, total_volume_all_time: _v30})
        };
        _v14 = &mut p0.user_maker_volume_history;
        _v15 = p1;
        if (!table::contains<address,VolumeHistory>(freeze(_v14), _v15)) {
            let _v31 = decibel_time::now_seconds() / 86400;
            let _v32 = aggregator_v2::create_aggregator_with_value<u128>(0u128, 340282366920938463463374607431768211455u128);
            let _v33 = vector::empty<DayVolume>();
            let _v34 = aggregator_v2::create_aggregator_with_value<u128>(0u128, 340282366920938463463374607431768211455u128);
            let _v35 = VolumeHistory{latest_day_since_epoch: _v31, latest_day_volume: _v32, history: _v33, total_volume_in_window: 0u128, total_volume_all_time: _v34};
            table::add<address,VolumeHistory>(_v14, _v15, _v35)
        };
        let _v36 = table::borrow_mut<address,VolumeHistory>(_v14, _v15);
        _v0 = p3;
        let _v37 = VolumeType::Maker{_0: p1};
        let _v38 = decibel_time::now_seconds() / 86400;
        let _v39 = false;
        let _v40 = *&_v36.latest_day_since_epoch;
        if (_v38 != _v40) {
            _v39 = true;
            rollover_volume_history(_v36);
            let _v41 = aggregator_v2::read<u128>(&_v36.latest_day_volume);
            assert!(aggregator_v2::try_sub<u128>(&mut _v36.latest_day_volume, _v41), 3);
            _v1 = &mut _v36.latest_day_since_epoch;
            *_v1 = _v38
        };
        if (_v0 > 0u128) {
            aggregator_v2::add<u128>(&mut _v36.latest_day_volume, _v0);
            aggregator_v2::add<u128>(&mut _v36.total_volume_all_time, _v0)
        };
        if (_v39) {
            let _v42 = *&_v36.latest_day_since_epoch;
            let _v43 = aggregator_v2::read<u128>(&_v36.latest_day_volume);
            let _v44 = *&_v36.history;
            let _v45 = *&_v36.total_volume_in_window;
            let _v46 = aggregator_v2::read<u128>(&_v36.total_volume_all_time);
            event::emit<VolumeHistoryUpdateEvent>(VolumeHistoryUpdateEvent{volume_type: _v37, latest_day_since_epoch: _v42, latest_day_volume: _v43, history: _v44, total_volume_in_window: _v45, total_volume_all_time: _v46});
            return ()
        };
    }
}
