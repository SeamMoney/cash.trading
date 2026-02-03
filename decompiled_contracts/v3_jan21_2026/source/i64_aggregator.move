module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::i64_aggregator {
    use 0x1::aggregator_v2;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::collateral_balance_sheet;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_positions;
    struct I64Aggregator has drop, store {
        offset_balance: aggregator_v2::Aggregator<u64>,
    }
    enum I64Snapshot has drop, store {
        V1 {
            offset_balance: aggregator_v2::AggregatorSnapshot<u64>,
        }
    }
    friend fun add(p0: &mut I64Aggregator, p1: i64) {
        if (p1 >= 0i64) {
            let _v0 = &mut p0.offset_balance;
            let _v1 = p1 as u64;
            aggregator_v2::add<u64>(_v0, _v1);
            return ()
        };
        let _v2 = &mut p0.offset_balance;
        let _v3 = (-p1) as u64;
        aggregator_v2::sub<u64>(_v2, _v3);
    }
    friend fun read(p0: &I64Aggregator): i64 {
        ((aggregator_v2::read<u64>(&p0.offset_balance) as i128) - 9223372036854775808i128) as i64
    }
    friend fun snapshot(p0: &I64Aggregator): I64Snapshot {
        I64Snapshot::V1{offset_balance: aggregator_v2::snapshot<u64>(&p0.offset_balance)}
    }
    friend fun is_at_least(p0: &I64Aggregator, p1: i64): bool {
        let _v0 = &p0.offset_balance;
        let _v1 = ((p1 as i128) + 9223372036854775808i128) as u64;
        aggregator_v2::is_at_least<u64>(_v0, _v1)
    }
    friend fun create_i64_snapshot(p0: i64): I64Snapshot {
        I64Snapshot::V1{offset_balance: aggregator_v2::create_snapshot<u64>(((p0 as i128) + 9223372036854775808i128) as u64)}
    }
    friend fun new_i64_aggregator(): I64Aggregator {
        I64Aggregator{offset_balance: aggregator_v2::create_unbounded_aggregator_with_value<u64>(9223372036854775808)}
    }
    friend fun new_i64_aggregator_with_value(p0: i64): I64Aggregator {
        I64Aggregator{offset_balance: aggregator_v2::create_unbounded_aggregator_with_value<u64>(((p0 as i128) + 9223372036854775808i128) as u64)}
    }
}
