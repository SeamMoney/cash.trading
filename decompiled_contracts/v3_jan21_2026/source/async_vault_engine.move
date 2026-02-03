module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_vault_engine {
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::vault;
    use 0x1::big_ordered_map;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::decibel_time;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_vault_work;
    use 0x1::option;
    use 0x1::transaction_context;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::vault_api;
    enum PendingRequest has copy, drop, store {
        VaultProgress {
            vault: object::Object<vault::Vault>,
        }
    }
    struct PendingRequestKey has copy, drop, store {
        time: u64,
        tie_breaker: u128,
    }
    enum AsyncVaultEngine has key {
        V1 {
            pending_requests: big_ordered_map::BigOrderedMap<PendingRequestKey, PendingRequest>,
            vaults_with_pending_requests: big_ordered_map::BigOrderedMap<object::Object<vault::Vault>, bool>,
        }
    }
    fun init_module(p0: &signer) {
        register_async_vault_engine(p0);
    }
    friend fun register_async_vault_engine(p0: &signer) {
        let _v0 = big_ordered_map::new_with_config<PendingRequestKey,PendingRequest>(0u16, 16u16, true);
        let _v1 = big_ordered_map::new<object::Object<vault::Vault>,bool>();
        let _v2 = AsyncVaultEngine::V1{pending_requests: _v0, vaults_with_pending_requests: _v1};
        move_to<AsyncVaultEngine>(p0, _v2);
    }
    friend fun process_pending_requests(p0: u32)
        acquires AsyncVaultEngine
    {
        let _v0 = borrow_global_mut<AsyncVaultEngine>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v1 = decibel_time::now_microseconds();
        assert!(p0 > 0u32, 1);
        'l0: loop {
            'l1: loop {
                'l2: loop {
                    loop {
                        let _v2;
                        let _v3;
                        if (big_ordered_map::is_empty<PendingRequestKey,PendingRequest>(&_v0.pending_requests)) _v3 = false else _v3 = p0 > 0u32;
                        if (!_v3) break 'l0;
                        let (_v4,_v5) = big_ordered_map::borrow_front<PendingRequestKey,PendingRequest>(&_v0.pending_requests);
                        let _v6 = _v4;
                        if (*&(&_v6).time >= _v1) break 'l1;
                        let (_v7,_v8) = big_ordered_map::pop_front<PendingRequestKey,PendingRequest>(&mut _v0.pending_requests);
                        let _v9 = _v8;
                        if (!(_v7 == _v6)) break 'l2;
                        if (!(&_v9 is VaultProgress)) break;
                        let PendingRequest::VaultProgress{vault: _v10} = _v9;
                        let _v11 = _v10;
                        let _v12 = &mut p0;
                        let _v13 = async_vault_work::process_pending_work(_v11, _v12);
                        if (!option::is_some<u64>(&_v13)) {
                            let _v14 = &mut _v0.vaults_with_pending_requests;
                            let _v15 = &_v11;
                            let _v16 = big_ordered_map::remove<object::Object<vault::Vault>,bool>(_v14, _v15);
                            continue
                        };
                        let _v17 = option::destroy_some<u64>(_v13);
                        if (_v17 > 0) _v2 = decibel_time::now_microseconds() + _v17 else _v2 = 0;
                        let _v18 = transaction_context::monotonically_increasing_counter();
                        let _v19 = PendingRequestKey{time: _v2, tie_breaker: _v18};
                        let _v20 = &mut _v0.pending_requests;
                        let _v21 = PendingRequest::VaultProgress{vault: _v11};
                        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v20, _v19, _v21);
                        continue
                    };
                    abort 14566554180833181697
                };
                abort 2
            };
            return ()
        };
    }
    friend fun queue_vault_progress_if_needed(p0: object::Object<vault::Vault>)
        acquires AsyncVaultEngine
    {
        let _v0 = borrow_global_mut<AsyncVaultEngine>(@0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88);
        let _v1 = &_v0.vaults_with_pending_requests;
        let _v2 = &p0;
        if (big_ordered_map::contains<object::Object<vault::Vault>,bool>(_v1, _v2)) return ();
        let _v3 = transaction_context::monotonically_increasing_counter();
        let _v4 = PendingRequestKey{time: 0, tie_breaker: _v3};
        let _v5 = &mut _v0.pending_requests;
        let _v6 = PendingRequest::VaultProgress{vault: p0};
        big_ordered_map::add<PendingRequestKey,PendingRequest>(_v5, _v4, _v6);
        big_ordered_map::add<object::Object<vault::Vault>,bool>(&mut _v0.vaults_with_pending_requests, p0, true);
    }
}
