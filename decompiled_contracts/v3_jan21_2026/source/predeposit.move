module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::predeposit {
    use 0x1::option;
    use 0x1::fungible_asset;
    use 0x1::string;
    use 0x1::object;
    use 0x1::ordered_map;
    use 0x1::smart_vector;
    use 0x1::big_ordered_map;
    use 0x1::signer;
    use 0x1::vector;
    use 0x1::primary_fungible_store;
    use 0x1::event;
    use 0x1::timestamp;
    enum StoredPermission has copy, drop, store {
        Unlimited,
        UnlimitedUntil {
            _0: u64,
        }
    }
    struct Deposit has store {
        owner: address,
        remaining: u64,
    }
    enum DepositEvent has drop, store {
        V1 {
            depositor: address,
            amount: u64,
            idx: u64,
        }
    }
    enum WithdrawEvent has drop, store {
        V1 {
            depositor: address,
            idx: u64,
            amount: u64,
            is_dlp_else_ua: bool,
        }
    }
    enum ConfigUpdatedEvent has drop, store {
        V1 {
            rebalance_max_steps_depositor: u32,
            max_deposit_balance_per_depositor: u64,
            deposit_min_amount: u64,
            dlp_cap: u64,
            is_deposit_paused: bool,
            depositors_bypass_maximum_deposit_balance: vector<address>,
            post_cap_dlp_percentage_bps: u64,
        }
    }
    enum DepositorState has copy, drop, store {
        V1 {
            dlp_balance: u64,
            ua_balance: u64,
            has_transitioned: bool,
        }
    }
    enum DlpVault has key {
        V1 {
            vault: option::Option<address>,
        }
    }
    enum ExternalCallbacks has key {
        V1 {
            get_or_create_primary_subaccount_wrapper_f: |address|(address) has copy + drop + store,
            deposit_funds_to_subaccount_f: |address, fungible_asset::FungibleAsset, address| has copy + drop + store,
            contribute_funds_to_vault_f: |address, address, fungible_asset::FungibleAsset| has copy + drop + store,
            admin_register_referral_code_f: |&signer, address, string::String| has copy + drop + store,
            admin_register_referrer_f: |&signer, address, string::String| has copy + drop + store,
            add_to_allow_list_f: |&signer, vector<address>| has copy + drop + store,
            set_max_referral_codes_f: |&signer, address, u64| has copy + drop + store,
        }
    }
    enum InitialDepositEvent has drop, store {
        V1 {
            depositor: address,
        }
    }
    enum InitializedEvent has drop, store {
        V1 {
            admin: address,
            predeposit_addr: address,
            dlp_cap: u64,
            asset_type: object::Object<fungible_asset::Metadata>,
        }
    }
    enum LaunchTransitionEvent has drop, store {
        V1 {
            depositor: address,
            subaccount: address,
            dlp_contribution: u64,
            ua_contribution: u64,
        }
    }
    enum LifecycleEvent has drop, store {
        V1 {
            ts: u64,
            prev_lifecycle: PredepositLifecycle,
            new_lifecycle: PredepositLifecycle,
        }
    }
    enum PredepositLifecycle has copy, drop, store {
        AcceptingDeposits,
        PreparingAllowList,
        InitializingReferrers,
        Rebalancing,
        Launching,
        Launched,
    }
    struct PredepositAdminPermissions has key {
        delegated_permissions: ordered_map::OrderedMap<address, StoredPermission>,
    }
    struct PredepositState has key {
        extend_ref: object::ExtendRef,
        deposit_paused: bool,
        lifecycle: PredepositLifecycle,
        dlp_cap: u64,
        asset_type: object::Object<fungible_asset::Metadata>,
        max_deposit_balance_per_depositor: u64,
        deposit_min_amount: u64,
        post_cap_dlp_percentage_bps: u64,
        rebalance_ua_total: u64,
        rebalance_dlp_total: u64,
        ua_total: u64,
        dlp_total: u64,
        promote_idx: u64,
        rebalance_max_steps_depositor: u32,
        deposits: smart_vector::SmartVector<Deposit>,
        depositors: big_ordered_map::BigOrderedMap<address, DepositorState>,
        depositors_bypass_maximum_deposit_balance: vector<address>,
    }
    enum PromoteEvent has drop, store {
        V1 {
            depositor: address,
            idx: u64,
            amount: u64,
        }
    }
    enum RebalanceNeededEvent has drop, store {
        V1 {
            deficit: u64,
        }
    }
    enum ReferralCodeRegisteredEvent has drop, store {
        V1 {
            referrer_addr: address,
            referral_code: string::String,
        }
    }
    enum ReferralLinkedEvent has drop, store {
        V1 {
            depositor_addr: address,
            referral_code: string::String,
            referrer_addr: address,
        }
    }
    struct ReferralRegistry has key {
        addr_to_referral_code: big_ordered_map::BigOrderedMap<address, string::String>,
        referral_code_to_addr: big_ordered_map::BigOrderedMap<string::String, address>,
        addr_to_used_referral_code: big_ordered_map::BigOrderedMap<address, string::String>,
        referral_code_to_active_referral_count: big_ordered_map::BigOrderedMap<string::String, u64>,
    }
    enum ReferralSetEvent has drop, store {
        V1 {
            depositor_addr: address,
            referral_code: string::String,
        }
    }
    enum ReferrerInitializedEvent has drop, store {
        V1 {
            referrer_addr: address,
            referral_code: string::String,
        }
    }
    public fun dlp_cap(p0: address): u64
        acquires PredepositState
    {
        *&borrow_global<PredepositState>(p0).dlp_cap
    }
    public fun is_deposit_paused(p0: address): bool
        acquires PredepositState
    {
        *&borrow_global<PredepositState>(p0).deposit_paused
    }
    public fun post_cap_dlp_percentage_bps(p0: address): u64
        acquires PredepositState
    {
        *&borrow_global<PredepositState>(p0).post_cap_dlp_percentage_bps
    }
    public fun rebalance_ua_total(p0: address): u64
        acquires PredepositState
    {
        *&borrow_global<PredepositState>(p0).rebalance_ua_total
    }
    public fun rebalance_dlp_total(p0: address): u64
        acquires PredepositState
    {
        *&borrow_global<PredepositState>(p0).rebalance_dlp_total
    }
    public fun ua_total(p0: address): u64
        acquires PredepositState
    {
        *&borrow_global<PredepositState>(p0).ua_total
    }
    public fun dlp_total(p0: address): u64
        acquires PredepositState
    {
        *&borrow_global<PredepositState>(p0).dlp_total
    }
    public entry fun deposit(p0: &signer, p1: address, p2: u64, p3: option::Option<string::String>)
        acquires PredepositState, ReferralRegistry
    {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4 = borrow_global_mut<PredepositState>(p1);
        let _v5 = *&_v4.lifecycle;
        let _v6 = PredepositLifecycle::AcceptingDeposits{};
        assert!(_v5 == _v6, 3);
        let _v7 = *&_v4.deposit_min_amount;
        assert!(p2 >= _v7, 6);
        if (*&_v4.deposit_paused) abort 4;
        let _v8 = signer::address_of(p0);
        let _v9 = &_v4.depositors;
        let _v10 = &_v8;
        if (big_ordered_map::contains<address,DepositorState>(_v9, _v10)) {
            let _v11 = &_v4.depositors;
            let _v12 = &_v8;
            let _v13 = big_ordered_map::borrow<address,DepositorState>(_v11, _v12);
            _v3 = *&_v13.dlp_balance;
            _v2 = *&_v13.ua_balance
        } else {
            _v3 = 0;
            _v2 = 0
        };
        let _v14 = _v3 + _v2;
        let _v15 = &_v4.depositors_bypass_maximum_deposit_balance;
        let _v16 = &_v8;
        if (vector::contains<address>(_v15, _v16)) _v1 = true else {
            let _v17 = _v14 + p2;
            let _v18 = *&_v4.max_deposit_balance_per_depositor;
            _v1 = _v17 <= _v18
        };
        assert!(_v1, 8);
        if (option::is_some<string::String>(&p3)) {
            let _v19 = option::destroy_some<string::String>(p3);
            try_set_depositor_referral(p1, _v8, _v19)
        } else if (_v14 == 0) {
            let _v20 = borrow_global_mut<ReferralRegistry>(p1);
            let _v21 = &_v20.addr_to_used_referral_code;
            let _v22 = &_v8;
            if (big_ordered_map::contains<address,string::String>(_v21, _v22)) {
                let _v23 = &_v20.addr_to_used_referral_code;
                let _v24 = &_v8;
                let _v25 = *big_ordered_map::borrow<address,string::String>(_v23, _v24);
                increment_active_referral_count(_v20, _v25)
            }
        };
        let _v26 = *&_v4.asset_type;
        let _v27 = primary_fungible_store::withdraw<fungible_asset::Metadata>(p0, _v26, p2);
        primary_fungible_store::deposit(p1, _v27);
        let _v28 = push_deposit(_v4, _v8, p2);
        event::emit<DepositEvent>(DepositEvent::V1{depositor: _v8, amount: p2, idx: _v28});
        let _v29 = *&_v4.dlp_cap;
        let _v30 = *&_v4.dlp_total;
        if (_v29 > _v30) _v0 = *&_v4.ua_total > 0 else _v0 = false;
        if (_v0) {
            let _v31 = option::none<u32>();
            promote_ua_to_dlp(_v4, _v31);
            return ()
        };
    }
    fun try_set_depositor_referral(p0: address, p1: address, p2: string::String)
        acquires ReferralRegistry
    {
        let _v0 = borrow_global_mut<ReferralRegistry>(p0);
        let _v1 = &_v0.addr_to_used_referral_code;
        let _v2 = &p1;
        let _v3 = big_ordered_map::contains<address,string::String>(_v1, _v2);
        loop {
            if (!_v3) {
                let _v4 = &_v0.referral_code_to_addr;
                let _v5 = &p2;
                assert!(big_ordered_map::contains<string::String,address>(_v4, _v5), 25);
                let _v6 = &_v0.referral_code_to_addr;
                let _v7 = &p2;
                if (*big_ordered_map::borrow<string::String,address>(_v6, _v7) != p1) break;
                abort 27
            };
            return ()
        };
        big_ordered_map::add<address,string::String>(&mut _v0.addr_to_used_referral_code, p1, p2);
        increment_active_referral_count(_v0, p2);
        event::emit<ReferralSetEvent>(ReferralSetEvent::V1{depositor_addr: p1, referral_code: p2});
    }
    fun push_deposit(p0: &mut PredepositState, p1: address, p2: u64): u64 {
        let _v0 = smart_vector::length<Deposit>(&p0.deposits);
        let _v1 = &mut p0.deposits;
        let _v2 = Deposit{owner: p1, remaining: p2};
        smart_vector::push_back<Deposit>(_v1, _v2);
        let _v3 = &p0.depositors;
        let _v4 = &p1;
        if (!big_ordered_map::contains<address,DepositorState>(_v3, _v4)) {
            let _v5 = &mut p0.depositors;
            let _v6 = DepositorState::V1{dlp_balance: 0, ua_balance: 0, has_transitioned: false};
            big_ordered_map::add<address,DepositorState>(_v5, p1, _v6);
            event::emit<InitialDepositEvent>(InitialDepositEvent::V1{depositor: p1})
        };
        let _v7 = &mut p0.depositors;
        let _v8 = &p1;
        let _v9 = big_ordered_map::remove<address,DepositorState>(_v7, _v8);
        if (*&(&_v9).has_transitioned) abort 15;
        let _v10 = *&(&_v9).dlp_balance;
        let _v11 = *&(&_v9).ua_balance + p2;
        let _v12 = *&(&_v9).has_transitioned;
        let _v13 = DepositorState::V1{dlp_balance: _v10, ua_balance: _v11, has_transitioned: _v12};
        big_ordered_map::add<address,DepositorState>(&mut p0.depositors, p1, _v13);
        let _v14 = &mut p0.ua_total;
        *_v14 = *_v14 + p2;
        _v0
    }
    fun promote_ua_to_dlp(p0: &mut PredepositState, p1: option::Option<u32>) {
        let _v0;
        if (option::is_none<u32>(&p1)) _v0 = *&p0.rebalance_max_steps_depositor else _v0 = option::extract<u32>(&mut p1);
        let _v1 = *&p0.dlp_total;
        let _v2 = *&p0.dlp_cap;
        'l0: loop {
            if (!(_v1 >= _v2)) {
                let _v3 = *&p0.dlp_cap;
                let _v4 = *&p0.dlp_total;
                let _v5 = _v3 - _v4;
                let _v6 = 0u32;
                let _v7 = smart_vector::length<Deposit>(&p0.deposits);
                loop {
                    let _v8;
                    let _v9;
                    let _v10;
                    let _v11;
                    if (_v5 > 0) _v11 = _v6 < _v0 else _v11 = false;
                    if (_v11) _v10 = *&p0.promote_idx < _v7 else _v10 = false;
                    if (!_v10) break 'l0;
                    let _v12 = &mut p0.deposits;
                    let _v13 = *&p0.promote_idx;
                    let _v14 = smart_vector::borrow_mut<Deposit>(_v12, _v13);
                    let _v15 = *&p0.promote_idx;
                    if (*&_v14.remaining == 0) {
                        _v9 = &mut p0.promote_idx;
                        *_v9 = *_v9 + 1;
                        _v6 = _v6 + 1u32;
                        continue
                    };
                    if (*&_v14.remaining <= _v5) _v8 = *&_v14.remaining else _v8 = _v5;
                    let _v16 = *&_v14.owner;
                    let _v17 = &p0.depositors;
                    let _v18 = &_v16;
                    if (*&big_ordered_map::borrow<address,DepositorState>(_v17, _v18).has_transitioned) {
                        _v9 = &mut p0.promote_idx;
                        *_v9 = *_v9 + 1;
                        _v6 = _v6 + 1u32;
                        continue
                    };
                    let _v19 = _v8;
                    _v9 = &mut _v14.remaining;
                    *_v9 = *_v9 - _v19;
                    _v19 = _v8;
                    _v9 = &mut p0.ua_total;
                    *_v9 = *_v9 - _v19;
                    _v19 = _v8;
                    _v9 = &mut p0.dlp_total;
                    *_v9 = *_v9 + _v19;
                    let _v20 = &mut p0.depositors;
                    let _v21 = &_v16;
                    let _v22 = big_ordered_map::remove<address,DepositorState>(_v20, _v21);
                    let _v23 = *&(&_v22).dlp_balance + _v8;
                    let _v24 = *&(&_v22).ua_balance - _v8;
                    let _v25 = *&(&_v22).has_transitioned;
                    let _v26 = DepositorState::V1{dlp_balance: _v23, ua_balance: _v24, has_transitioned: _v25};
                    big_ordered_map::add<address,DepositorState>(&mut p0.depositors, _v16, _v26);
                    event::emit<PromoteEvent>(PromoteEvent::V1{depositor: _v16, idx: _v15, amount: _v8});
                    _v19 = _v8;
                    _v5 = _v5 - _v19;
                    _v6 = _v6 + 1u32;
                    continue
                }
            };
            return ()
        };
    }
    fun increment_active_referral_count(p0: &mut ReferralRegistry, p1: string::String) {
        let _v0 = &p0.referral_code_to_active_referral_count;
        let _v1 = &p1;
        if (big_ordered_map::contains<string::String,u64>(_v0, _v1)) {
            let _v2 = &mut p0.referral_code_to_active_referral_count;
            let _v3 = &p1;
            let _v4 = big_ordered_map::remove<string::String,u64>(_v2, _v3);
            let _v5 = &mut p0.referral_code_to_active_referral_count;
            let _v6 = _v4 + 1;
            big_ordered_map::add<string::String,u64>(_v5, p1, _v6);
            return ()
        };
        big_ordered_map::add<string::String,u64>(&mut p0.referral_code_to_active_referral_count, p1, 1);
    }
    public entry fun add_admin(p0: &signer, p1: address, p2: address)
        acquires PredepositAdminPermissions
    {
        assert!(is_deployer(p0), 0);
        add_permission_internal(p1, p2);
    }
    fun is_deployer(p0: &signer): bool {
        signer::address_of(p0) == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88
    }
    fun add_permission_internal(p0: address, p1: address)
        acquires PredepositAdminPermissions
    {
        assert!(exists<PredepositAdminPermissions>(p0), 14);
        let _v0 = &mut borrow_global_mut<PredepositAdminPermissions>(p0).delegated_permissions;
        let _v1 = StoredPermission::Unlimited{};
        let _v2 = ordered_map::upsert<address,StoredPermission>(_v0, p1, _v1);
    }
    public entry fun add_depositors_to_allow_list(p0: &signer, p1: address, p2: vector<address>)
        acquires ExternalCallbacks, PredepositAdminPermissions, PredepositState
    {
        assert_admin_capability(p0, p1);
        assert!(vector::length<address>(&p2) <= 16, 19);
        assert!(vector::length<address>(&p2) > 0, 20);
        let _v0 = *&borrow_global<PredepositState>(p1).lifecycle;
        let _v1 = PredepositLifecycle::PreparingAllowList{};
        assert!(_v0 == _v1, 30);
        assert!(exists<ExternalCallbacks>(p1), 18);
        let _v2 = *&borrow_global<ExternalCallbacks>(p1).add_to_allow_list_f;
        _v2(p0, p2);
    }
    fun assert_admin_capability(p0: &signer, p1: address)
        acquires PredepositAdminPermissions
    {
        assert!(has_permission(p0, p1), 1);
    }
    public entry fun admin_complete_launching(p0: &signer, p1: address)
        acquires PredepositAdminPermissions, PredepositState
    {
        let _v0;
        let _v1 = borrow_global_mut<PredepositState>(p1);
        assert_admin_capability(p0, p1);
        let _v2 = *&_v1.lifecycle;
        let _v3 = PredepositLifecycle::Launching{};
        assert!(_v2 == _v3, 17);
        if (*&_v1.dlp_total == 0) _v0 = *&_v1.ua_total == 0 else _v0 = false;
        assert!(_v0, 21);
        let _v4 = PredepositLifecycle::Launched{};
        let _v5 = &mut _v1.lifecycle;
        *_v5 = _v4;
        let _v6 = timestamp::now_seconds();
        let _v7 = PredepositLifecycle::Launching{};
        let _v8 = PredepositLifecycle::Launched{};
        event::emit<LifecycleEvent>(LifecycleEvent::V1{ts: _v6, prev_lifecycle: _v7, new_lifecycle: _v8});
    }
    public entry fun admin_enable_allow_list_preparation(p0: &signer, p1: address)
        acquires PredepositAdminPermissions, PredepositState
    {
        let _v0 = borrow_global_mut<PredepositState>(p1);
        assert_admin_capability(p0, p1);
        let _v1 = *&_v0.lifecycle;
        let _v2 = PredepositLifecycle::AcceptingDeposits{};
        assert!(_v1 == _v2, 3);
        let _v3 = PredepositLifecycle::PreparingAllowList{};
        let _v4 = &mut _v0.lifecycle;
        *_v4 = _v3;
        let _v5 = timestamp::now_seconds();
        let _v6 = PredepositLifecycle::AcceptingDeposits{};
        let _v7 = PredepositLifecycle::PreparingAllowList{};
        event::emit<LifecycleEvent>(LifecycleEvent::V1{ts: _v5, prev_lifecycle: _v6, new_lifecycle: _v7});
    }
    public entry fun admin_enable_launching(p0: &signer, p1: address)
        acquires PredepositAdminPermissions, PredepositState
    {
        let _v0;
        let _v1 = borrow_global_mut<PredepositState>(p1);
        assert_admin_capability(p0, p1);
        let _v2 = *&_v1.lifecycle;
        let _v3 = PredepositLifecycle::Rebalancing{};
        assert!(_v2 == _v3, 31);
        let _v4 = freeze(_v1);
        let _v5 = *&_v4.dlp_cap;
        let _v6 = *&_v4.dlp_total;
        if (_v5 > _v6) _v0 = *&_v4.ua_total > 0 else _v0 = false;
        if (_v0) abort 11;
        let _v7 = PredepositLifecycle::Launching{};
        let _v8 = &mut _v1.lifecycle;
        *_v8 = _v7;
        let _v9 = *&_v1.ua_total;
        let _v10 = &mut _v1.rebalance_ua_total;
        *_v10 = _v9;
        let _v11 = *&_v1.dlp_total;
        let _v12 = &mut _v1.rebalance_dlp_total;
        *_v12 = _v11;
        let _v13 = timestamp::now_seconds();
        let _v14 = PredepositLifecycle::Rebalancing{};
        let _v15 = PredepositLifecycle::Launching{};
        event::emit<LifecycleEvent>(LifecycleEvent::V1{ts: _v13, prev_lifecycle: _v14, new_lifecycle: _v15});
    }
    public entry fun admin_enable_rebalancing(p0: &signer, p1: address)
        acquires PredepositAdminPermissions, PredepositState
    {
        let _v0 = borrow_global_mut<PredepositState>(p1);
        assert_admin_capability(p0, p1);
        let _v1 = *&_v0.lifecycle;
        let _v2 = PredepositLifecycle::InitializingReferrers{};
        assert!(_v1 == _v2, 29);
        let _v3 = PredepositLifecycle::Rebalancing{};
        let _v4 = &mut _v0.lifecycle;
        *_v4 = _v3;
        let _v5 = timestamp::now_seconds();
        let _v6 = PredepositLifecycle::InitializingReferrers{};
        let _v7 = PredepositLifecycle::Rebalancing{};
        event::emit<LifecycleEvent>(LifecycleEvent::V1{ts: _v5, prev_lifecycle: _v6, new_lifecycle: _v7});
    }
    public entry fun admin_enable_referrer_initialization(p0: &signer, p1: address)
        acquires PredepositAdminPermissions, PredepositState
    {
        let _v0 = borrow_global_mut<PredepositState>(p1);
        assert_admin_capability(p0, p1);
        let _v1 = *&_v0.lifecycle;
        let _v2 = PredepositLifecycle::PreparingAllowList{};
        assert!(_v1 == _v2, 30);
        let _v3 = PredepositLifecycle::InitializingReferrers{};
        let _v4 = &mut _v0.lifecycle;
        *_v4 = _v3;
        let _v5 = timestamp::now_seconds();
        let _v6 = PredepositLifecycle::PreparingAllowList{};
        let _v7 = PredepositLifecycle::InitializingReferrers{};
        event::emit<LifecycleEvent>(LifecycleEvent::V1{ts: _v5, prev_lifecycle: _v6, new_lifecycle: _v7});
    }
    public entry fun admin_set_accounts_bypass_maximum_deposit_balance(p0: &signer, p1: address, p2: vector<address>)
        acquires PredepositAdminPermissions, PredepositState
    {
        let _v0 = borrow_global_mut<PredepositState>(p1);
        assert_admin_capability(p0, p1);
        let _v1 = &mut _v0.depositors_bypass_maximum_deposit_balance;
        *_v1 = p2;
        let _v2 = freeze(_v0);
        let _v3 = *&_v2.rebalance_max_steps_depositor;
        let _v4 = *&_v2.max_deposit_balance_per_depositor;
        let _v5 = *&_v2.deposit_min_amount;
        let _v6 = *&_v2.dlp_cap;
        let _v7 = *&_v2.deposit_paused;
        let _v8 = *&_v2.depositors_bypass_maximum_deposit_balance;
        let _v9 = *&_v2.post_cap_dlp_percentage_bps;
        event::emit<ConfigUpdatedEvent>(ConfigUpdatedEvent::V1{rebalance_max_steps_depositor: _v3, max_deposit_balance_per_depositor: _v4, deposit_min_amount: _v5, dlp_cap: _v6, is_deposit_paused: _v7, depositors_bypass_maximum_deposit_balance: _v8, post_cap_dlp_percentage_bps: _v9});
    }
    public entry fun admin_set_deposit_min_amount(p0: &signer, p1: address, p2: u64)
        acquires PredepositAdminPermissions, PredepositState
    {
        let _v0 = borrow_global_mut<PredepositState>(p1);
        assert_admin_capability(p0, p1);
        assert!(p2 > 0, 12);
        let _v1 = &mut _v0.deposit_min_amount;
        *_v1 = p2;
        let _v2 = freeze(_v0);
        let _v3 = *&_v2.rebalance_max_steps_depositor;
        let _v4 = *&_v2.max_deposit_balance_per_depositor;
        let _v5 = *&_v2.deposit_min_amount;
        let _v6 = *&_v2.dlp_cap;
        let _v7 = *&_v2.deposit_paused;
        let _v8 = *&_v2.depositors_bypass_maximum_deposit_balance;
        let _v9 = *&_v2.post_cap_dlp_percentage_bps;
        event::emit<ConfigUpdatedEvent>(ConfigUpdatedEvent::V1{rebalance_max_steps_depositor: _v3, max_deposit_balance_per_depositor: _v4, deposit_min_amount: _v5, dlp_cap: _v6, is_deposit_paused: _v7, depositors_bypass_maximum_deposit_balance: _v8, post_cap_dlp_percentage_bps: _v9});
    }
    public entry fun admin_set_deposit_paused(p0: &signer, p1: address, p2: bool)
        acquires PredepositAdminPermissions, PredepositState
    {
        let _v0 = borrow_global_mut<PredepositState>(p1);
        assert_admin_capability(p0, p1);
        let _v1 = &mut _v0.deposit_paused;
        *_v1 = p2;
        let _v2 = freeze(_v0);
        let _v3 = *&_v2.rebalance_max_steps_depositor;
        let _v4 = *&_v2.max_deposit_balance_per_depositor;
        let _v5 = *&_v2.deposit_min_amount;
        let _v6 = *&_v2.dlp_cap;
        let _v7 = *&_v2.deposit_paused;
        let _v8 = *&_v2.depositors_bypass_maximum_deposit_balance;
        let _v9 = *&_v2.post_cap_dlp_percentage_bps;
        event::emit<ConfigUpdatedEvent>(ConfigUpdatedEvent::V1{rebalance_max_steps_depositor: _v3, max_deposit_balance_per_depositor: _v4, deposit_min_amount: _v5, dlp_cap: _v6, is_deposit_paused: _v7, depositors_bypass_maximum_deposit_balance: _v8, post_cap_dlp_percentage_bps: _v9});
    }
    public entry fun admin_set_dlp_cap(p0: &signer, p1: address, p2: u64)
        acquires PredepositAdminPermissions, PredepositState
    {
        let _v0 = borrow_global_mut<PredepositState>(p1);
        assert_admin_capability(p0, p1);
        assert!(p2 > 0, 12);
        let _v1 = *&_v0.lifecycle;
        let _v2 = PredepositLifecycle::AcceptingDeposits{};
        assert!(_v1 == _v2, 3);
        let _v3 = &mut _v0.dlp_cap;
        *_v3 = p2;
        let _v4 = option::none<u32>();
        promote_ua_to_dlp(_v0, _v4);
        let _v5 = freeze(_v0);
        let _v6 = *&_v5.rebalance_max_steps_depositor;
        let _v7 = *&_v5.max_deposit_balance_per_depositor;
        let _v8 = *&_v5.deposit_min_amount;
        let _v9 = *&_v5.dlp_cap;
        let _v10 = *&_v5.deposit_paused;
        let _v11 = *&_v5.depositors_bypass_maximum_deposit_balance;
        let _v12 = *&_v5.post_cap_dlp_percentage_bps;
        event::emit<ConfigUpdatedEvent>(ConfigUpdatedEvent::V1{rebalance_max_steps_depositor: _v6, max_deposit_balance_per_depositor: _v7, deposit_min_amount: _v8, dlp_cap: _v9, is_deposit_paused: _v10, depositors_bypass_maximum_deposit_balance: _v11, post_cap_dlp_percentage_bps: _v12});
    }
    public entry fun admin_set_dlp_vault(p0: &signer, p1: address, p2: address)
        acquires DlpVault, PredepositAdminPermissions
    {
        assert_admin_capability(p0, p1);
        let _v0 = borrow_global_mut<DlpVault>(p1);
        let _v1 = option::some<address>(p2);
        let _v2 = &mut _v0.vault;
        *_v2 = _v1;
    }
    public entry fun admin_set_max_deposit_balance_per_depositor(p0: &signer, p1: address, p2: u64)
        acquires PredepositAdminPermissions, PredepositState
    {
        let _v0 = borrow_global_mut<PredepositState>(p1);
        assert_admin_capability(p0, p1);
        assert!(p2 > 0, 12);
        let _v1 = &mut _v0.max_deposit_balance_per_depositor;
        *_v1 = p2;
        let _v2 = freeze(_v0);
        let _v3 = *&_v2.rebalance_max_steps_depositor;
        let _v4 = *&_v2.max_deposit_balance_per_depositor;
        let _v5 = *&_v2.deposit_min_amount;
        let _v6 = *&_v2.dlp_cap;
        let _v7 = *&_v2.deposit_paused;
        let _v8 = *&_v2.depositors_bypass_maximum_deposit_balance;
        let _v9 = *&_v2.post_cap_dlp_percentage_bps;
        event::emit<ConfigUpdatedEvent>(ConfigUpdatedEvent::V1{rebalance_max_steps_depositor: _v3, max_deposit_balance_per_depositor: _v4, deposit_min_amount: _v5, dlp_cap: _v6, is_deposit_paused: _v7, depositors_bypass_maximum_deposit_balance: _v8, post_cap_dlp_percentage_bps: _v9});
    }
    public entry fun admin_set_max_rebalance_steps(p0: &signer, p1: address, p2: u32)
        acquires PredepositAdminPermissions, PredepositState
    {
        let _v0 = borrow_global_mut<PredepositState>(p1);
        assert_admin_capability(p0, p1);
        assert!(p2 > 0u32, 12);
        let _v1 = &mut _v0.rebalance_max_steps_depositor;
        *_v1 = p2;
        let _v2 = freeze(_v0);
        let _v3 = *&_v2.rebalance_max_steps_depositor;
        let _v4 = *&_v2.max_deposit_balance_per_depositor;
        let _v5 = *&_v2.deposit_min_amount;
        let _v6 = *&_v2.dlp_cap;
        let _v7 = *&_v2.deposit_paused;
        let _v8 = *&_v2.depositors_bypass_maximum_deposit_balance;
        let _v9 = *&_v2.post_cap_dlp_percentage_bps;
        event::emit<ConfigUpdatedEvent>(ConfigUpdatedEvent::V1{rebalance_max_steps_depositor: _v3, max_deposit_balance_per_depositor: _v4, deposit_min_amount: _v5, dlp_cap: _v6, is_deposit_paused: _v7, depositors_bypass_maximum_deposit_balance: _v8, post_cap_dlp_percentage_bps: _v9});
    }
    public entry fun admin_set_post_cap_dlp_percentage_bps(p0: &signer, p1: address, p2: u64)
        acquires PredepositAdminPermissions, PredepositState
    {
        let _v0 = borrow_global_mut<PredepositState>(p1);
        assert_admin_capability(p0, p1);
        assert!(p2 <= 10000, 12);
        let _v1 = *&_v0.lifecycle;
        let _v2 = PredepositLifecycle::AcceptingDeposits{};
        assert!(_v1 == _v2, 3);
        let _v3 = &mut _v0.post_cap_dlp_percentage_bps;
        *_v3 = p2;
        let _v4 = freeze(_v0);
        let _v5 = *&_v4.rebalance_max_steps_depositor;
        let _v6 = *&_v4.max_deposit_balance_per_depositor;
        let _v7 = *&_v4.deposit_min_amount;
        let _v8 = *&_v4.dlp_cap;
        let _v9 = *&_v4.deposit_paused;
        let _v10 = *&_v4.depositors_bypass_maximum_deposit_balance;
        let _v11 = *&_v4.post_cap_dlp_percentage_bps;
        event::emit<ConfigUpdatedEvent>(ConfigUpdatedEvent::V1{rebalance_max_steps_depositor: _v5, max_deposit_balance_per_depositor: _v6, deposit_min_amount: _v7, dlp_cap: _v8, is_deposit_paused: _v9, depositors_bypass_maximum_deposit_balance: _v10, post_cap_dlp_percentage_bps: _v11});
    }
    public fun are_deposits_closed(p0: address): bool
        acquires PredepositState
    {
        let _v0 = *&borrow_global<PredepositState>(p0).lifecycle;
        let _v1 = PredepositLifecycle::AcceptingDeposits{};
        _v0 != _v1
    }
    fun has_permission(p0: &signer, p1: address): bool
        acquires PredepositAdminPermissions
    {
        let _v0;
        let _v1 = signer::address_of(p0);
        let _v2 = is_deployer(p0);
        loop {
            if (_v2) return true else {
                assert!(exists<PredepositAdminPermissions>(p1), 14);
                let _v3 = &borrow_global<PredepositAdminPermissions>(p1).delegated_permissions;
                let _v4 = &_v1;
                _v0 = ordered_map::get<address,StoredPermission>(_v3, _v4);
                if (!option::is_none<StoredPermission>(&_v0)) break
            };
            return false
        };
        is_stored_permission_valid(option::destroy_some<StoredPermission>(_v0))
    }
    fun decrement_active_referral_count(p0: &mut ReferralRegistry, p1: string::String) {
        let _v0 = &p0.referral_code_to_active_referral_count;
        let _v1 = &p1;
        if (big_ordered_map::contains<string::String,u64>(_v0, _v1)) {
            let _v2 = &mut p0.referral_code_to_active_referral_count;
            let _v3 = &p1;
            let _v4 = big_ordered_map::remove<string::String,u64>(_v2, _v3);
            if (_v4 > 1) {
                let _v5 = &mut p0.referral_code_to_active_referral_count;
                let _v6 = _v4 - 1;
                big_ordered_map::add<string::String,u64>(_v5, p1, _v6);
                return ()
            };
            return ()
        };
    }
    public fun deposit_min_amount_per_account(p0: address): u64
        acquires PredepositState
    {
        *&borrow_global<PredepositState>(p0).deposit_min_amount
    }
    public fun dlp_vault_address(p0: address): option::Option<address>
        acquires DlpVault
    {
        *&borrow_global<DlpVault>(p0).vault
    }
    public fun get_active_referral_count(p0: address, p1: string::String): u64
        acquires ReferralRegistry
    {
        let _v0 = borrow_global<ReferralRegistry>(p0);
        let _v1 = &_v0.referral_code_to_active_referral_count;
        let _v2 = &p1;
        if (big_ordered_map::contains<string::String,u64>(_v1, _v2)) {
            let _v3 = &_v0.referral_code_to_active_referral_count;
            let _v4 = &p1;
            return *big_ordered_map::borrow<string::String,u64>(_v3, _v4)
        };
        0
    }
    public fun get_referral_code(p0: address, p1: address): string::String
        acquires ReferralRegistry
    {
        let _v0 = borrow_global<ReferralRegistry>(p0);
        let _v1 = &_v0.addr_to_referral_code;
        let _v2 = &p1;
        assert!(big_ordered_map::contains<address,string::String>(_v1, _v2), 25);
        let _v3 = &_v0.addr_to_referral_code;
        let _v4 = &p1;
        *big_ordered_map::borrow<address,string::String>(_v3, _v4)
    }
    public fun get_referrer_addr(p0: address, p1: string::String): address
        acquires ReferralRegistry
    {
        let _v0 = borrow_global<ReferralRegistry>(p0);
        let _v1 = &_v0.referral_code_to_addr;
        let _v2 = &p1;
        assert!(big_ordered_map::contains<string::String,address>(_v1, _v2), 25);
        let _v3 = &_v0.referral_code_to_addr;
        let _v4 = &p1;
        *big_ordered_map::borrow<string::String,address>(_v3, _v4)
    }
    public fun get_used_referral_code(p0: address, p1: address): string::String
        acquires ReferralRegistry
    {
        let _v0 = borrow_global<ReferralRegistry>(p0);
        let _v1 = &_v0.addr_to_used_referral_code;
        let _v2 = &p1;
        assert!(big_ordered_map::contains<address,string::String>(_v1, _v2), 25);
        let _v3 = &_v0.addr_to_used_referral_code;
        let _v4 = &p1;
        *big_ordered_map::borrow<address,string::String>(_v3, _v4)
    }
    fun is_stored_permission_valid(p0: StoredPermission): bool {
        let _v0 = &p0;
        loop {
            if (!(_v0 is Unlimited)) {
                if (_v0 is UnlimitedUntil) break;
                abort 14566554180833181697
            };
            let StoredPermission::Unlimited{} = p0;
            return true
        };
        let StoredPermission::UnlimitedUntil{_0: _v1} = p0;
        timestamp::now_seconds() < _v1
    }
    public fun has_referral_code(p0: address, p1: address): bool
        acquires ReferralRegistry
    {
        let _v0 = &borrow_global<ReferralRegistry>(p0).addr_to_referral_code;
        let _v1 = &p1;
        big_ordered_map::contains<address,string::String>(_v0, _v1)
    }
    public fun has_used_referral_code(p0: address, p1: address): bool
        acquires ReferralRegistry
    {
        let _v0 = &borrow_global<ReferralRegistry>(p0).addr_to_used_referral_code;
        let _v1 = &p1;
        big_ordered_map::contains<address,string::String>(_v0, _v1)
    }
    fun init_internal(p0: &signer, p1: u64, p2: object::Object<fungible_asset::Metadata>) {
        assert!(is_deployer(p0), 0);
        let _v0 = predeposit_address(signer::address_of(p0));
        if (exists<PredepositState>(_v0)) abort 2;
        let _v1 = object::create_named_object(p0, vector[112u8, 114u8, 101u8, 100u8, 101u8, 112u8, 111u8, 115u8, 105u8, 116u8]);
        let _v2 = object::generate_extend_ref(&_v1);
        let _v3 = object::generate_signer_for_extending(&_v2);
        let _v4 = &_v3;
        let _v5 = PredepositLifecycle::AcceptingDeposits{};
        let _v6 = smart_vector::empty<Deposit>();
        let _v7 = big_ordered_map::new_with_config<address,DepositorState>(0u16, 16u16, false);
        let _v8 = vector::empty<address>();
        let _v9 = PredepositState{extend_ref: _v2, deposit_paused: false, lifecycle: _v5, dlp_cap: p1, asset_type: p2, max_deposit_balance_per_depositor: 1000000000000, deposit_min_amount: 50000000, post_cap_dlp_percentage_bps: 3000, rebalance_ua_total: 0, rebalance_dlp_total: 0, ua_total: 0, dlp_total: 0, promote_idx: 0, rebalance_max_steps_depositor: 32u32, deposits: _v6, depositors: _v7, depositors_bypass_maximum_deposit_balance: _v8};
        move_to<PredepositState>(_v4, _v9);
        let _v10 = &_v3;
        let _v11 = PredepositAdminPermissions{delegated_permissions: ordered_map::new<address,StoredPermission>()};
        move_to<PredepositAdminPermissions>(_v10, _v11);
        let _v12 = &_v3;
        let _v13 = DlpVault::V1{vault: option::none<address>()};
        move_to<DlpVault>(_v12, _v13);
        let _v14 = &_v3;
        let _v15 = big_ordered_map::new_with_config<address,string::String>(8u16, 8u16, true);
        let _v16 = big_ordered_map::new_with_config<string::String,address>(8u16, 8u16, true);
        let _v17 = big_ordered_map::new_with_config<address,string::String>(8u16, 8u16, true);
        let _v18 = big_ordered_map::new_with_config<string::String,u64>(8u16, 8u16, true);
        let _v19 = ReferralRegistry{addr_to_referral_code: _v15, referral_code_to_addr: _v16, addr_to_used_referral_code: _v17, referral_code_to_active_referral_count: _v18};
        move_to<ReferralRegistry>(_v14, _v19);
        event::emit<InitializedEvent>(InitializedEvent::V1{admin: signer::address_of(p0), predeposit_addr: _v0, dlp_cap: p1, asset_type: p2});
    }
    public fun predeposit_address(p0: address): address {
        object::create_object_address(&p0, vector[112u8, 114u8, 101u8, 100u8, 101u8, 112u8, 111u8, 115u8, 105u8, 116u8])
    }
    fun init_module(p0: &signer) {
        let _v0 = object::address_to_object<fungible_asset::Metadata>(@0xca39acbe6a905a77c5836f209c343bcff9a3fc7ee511f28767d9de3e7efbeb90);
        init_internal(p0, 30000000000000, _v0);
    }
    fun initialize_referrer(p0: &signer, p1: &PredepositState, p2: &ReferralRegistry, p3: address, p4: &ExternalCallbacks) {
        let _v0;
        let _v1;
        let _v2;
        let _v3 = &p2.addr_to_referral_code;
        let _v4 = &p3;
        assert!(big_ordered_map::contains<address,string::String>(_v3, _v4), 28);
        let _v5 = &p2.addr_to_referral_code;
        let _v6 = &p3;
        let _v7 = *big_ordered_map::borrow<address,string::String>(_v5, _v6);
        let _v8 = &p1.depositors;
        let _v9 = &p3;
        if (big_ordered_map::contains<address,DepositorState>(_v8, _v9)) {
            let _v10 = &p1.depositors;
            let _v11 = &p3;
            let _v12 = big_ordered_map::borrow<address,DepositorState>(_v10, _v11);
            if (*&_v12.dlp_balance > 0) _v2 = true else _v2 = *&_v12.ua_balance > 0
        } else _v2 = false;
        let _v13 = &p2.referral_code_to_active_referral_count;
        let _v14 = &_v7;
        if (big_ordered_map::contains<string::String,u64>(_v13, _v14)) {
            let _v15 = &p2.referral_code_to_active_referral_count;
            let _v16 = &_v7;
            _v1 = *big_ordered_map::borrow<string::String,u64>(_v15, _v16)
        } else _v1 = 0;
        if (_v2) _v0 = true else _v0 = _v1 > 0;
        assert!(_v0, 32);
        let _v17 = *&p4.admin_register_referral_code_f;
        _v17(p0, p3, _v7);
        let _v18 = *&p4.set_max_referral_codes_f;
        _v18(p0, p3, 6);
        event::emit<ReferrerInitializedEvent>(ReferrerInitializedEvent::V1{referrer_addr: p3, referral_code: _v7});
    }
    public entry fun initialize_referrers(p0: &signer, p1: address, p2: vector<address>)
        acquires ExternalCallbacks, PredepositAdminPermissions, PredepositState, ReferralRegistry
    {
        assert_admin_capability(p0, p1);
        assert!(vector::length<address>(&p2) <= 16, 19);
        assert!(vector::length<address>(&p2) > 0, 20);
        let _v0 = borrow_global<PredepositState>(p1);
        let _v1 = *&_v0.lifecycle;
        let _v2 = PredepositLifecycle::InitializingReferrers{};
        assert!(_v1 == _v2, 29);
        assert!(exists<ExternalCallbacks>(p1), 18);
        let _v3 = borrow_global<ExternalCallbacks>(p1);
        let _v4 = borrow_global<ReferralRegistry>(p1);
        let _v5 = 0;
        let _v6 = false;
        let _v7 = vector::length<address>(&p2);
        loop {
            if (_v6) _v5 = _v5 + 1 else _v6 = true;
            if (!(_v5 < _v7)) break;
            let _v8 = *vector::borrow<address>(&p2, _v5);
            initialize_referrer(p0, _v0, _v4, _v8, _v3);
            continue
        };
    }
    public fun is_admin(p0: address, p1: address): bool
        acquires PredepositAdminPermissions
    {
        let _v0;
        'l0: loop {
            'l1: loop {
                loop {
                    if (!(p1 == @0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88)) {
                        if (!exists<PredepositAdminPermissions>(p0)) break;
                        let _v1 = &borrow_global<PredepositAdminPermissions>(p0).delegated_permissions;
                        let _v2 = &p1;
                        _v0 = ordered_map::get<address,StoredPermission>(_v1, _v2);
                        if (!option::is_none<StoredPermission>(&_v0)) break 'l0;
                        break 'l1
                    };
                    return true
                };
                return false
            };
            return false
        };
        is_stored_permission_valid(option::destroy_some<StoredPermission>(_v0))
    }
    fun is_ascii_alphanumeric(p0: &string::String): bool {
        let _v0 = string::bytes(p0);
        let _v1 = string::length(p0);
        let _v2 = 0;
        'l0: loop {
            loop {
                let _v3;
                let _v4;
                let _v5;
                if (!(_v2 < _v1)) break 'l0;
                let _v6 = *vector::borrow<u8>(_v0, _v2);
                if (_v6 >= 48u8) _v5 = _v6 <= 57u8 else _v5 = false;
                if (_v5) _v4 = true else if (_v6 >= 65u8) _v4 = _v6 <= 90u8 else _v4 = false;
                if (_v4) _v3 = true else if (_v6 >= 97u8) _v3 = _v6 <= 122u8 else _v3 = false;
                if (!_v3) break;
                _v2 = _v2 + 1;
                continue
            };
            return false
        };
        true
    }
    public fun is_launched(p0: address): bool
        acquires PredepositState
    {
        let _v0 = *&borrow_global<PredepositState>(p0).lifecycle;
        let _v1 = PredepositLifecycle::Launched{};
        _v0 == _v1
    }
    public fun is_launching(p0: address): bool
        acquires PredepositState
    {
        let _v0 = *&borrow_global<PredepositState>(p0).lifecycle;
        let _v1 = PredepositLifecycle::Launching{};
        _v0 == _v1
    }
    public fun is_rebalance_needed(p0: address): bool
        acquires PredepositState
    {
        let _v0 = borrow_global<PredepositState>(p0);
        let _v1 = *&_v0.dlp_cap;
        let _v2 = *&_v0.dlp_total;
        if (_v1 > _v2) return *&_v0.ua_total > 0;
        false
    }
    public fun is_rebalancing(p0: address): bool
        acquires PredepositState
    {
        let _v0 = *&borrow_global<PredepositState>(p0).lifecycle;
        let _v1 = PredepositLifecycle::Rebalancing{};
        _v0 == _v1
    }
    public fun is_referral_code_valid(p0: address, p1: string::String): bool
        acquires ReferralRegistry
    {
        let _v0 = &borrow_global<ReferralRegistry>(p0).referral_code_to_addr;
        let _v1 = &p1;
        big_ordered_map::contains<string::String,address>(_v0, _v1)
    }
    public fun max_deposit_balance_per_account(p0: address): u64
        acquires PredepositState
    {
        *&borrow_global<PredepositState>(p0).max_deposit_balance_per_depositor
    }
    public fun predepositor_balance(p0: address, p1: address): (u64, u64)
        acquires PredepositState
    {
        let _v0 = borrow_global<PredepositState>(p0);
        let _v1 = &_v0.depositors;
        let _v2 = &p1;
        assert!(big_ordered_map::contains<address,DepositorState>(_v1, _v2), 7);
        let _v3 = &_v0.depositors;
        let _v4 = &p1;
        let _v5 = big_ordered_map::borrow<address,DepositorState>(_v3, _v4);
        let _v6 = *&_v5.dlp_balance;
        let _v7 = *&_v5.ua_balance;
        (_v6, _v7)
    }
    public entry fun rebalance(p0: address, p1: option::Option<u32>)
        acquires PredepositState
    {
        let _v0;
        let _v1;
        let _v2;
        let _v3;
        let _v4 = borrow_global_mut<PredepositState>(p0);
        let _v5 = *&_v4.lifecycle;
        let _v6 = PredepositLifecycle::AcceptingDeposits{};
        if (_v5 == _v6) _v3 = true else {
            let _v7 = *&_v4.lifecycle;
            let _v8 = PredepositLifecycle::InitializingReferrers{};
            _v3 = _v7 == _v8
        };
        if (_v3) _v2 = true else {
            let _v9 = *&_v4.lifecycle;
            let _v10 = PredepositLifecycle::PreparingAllowList{};
            _v2 = _v9 == _v10
        };
        if (_v2) _v1 = true else {
            let _v11 = *&_v4.lifecycle;
            let _v12 = PredepositLifecycle::Rebalancing{};
            _v1 = _v11 == _v12
        };
        assert!(_v1, 31);
        promote_ua_to_dlp(_v4, p1);
        let _v13 = *&_v4.dlp_total;
        let _v14 = *&_v4.dlp_cap;
        if (_v13 >= _v14) _v0 = 0 else {
            let _v15 = *&_v4.dlp_cap;
            let _v16 = *&_v4.dlp_total;
            _v0 = _v15 - _v16
        };
        if (_v0 > 0) {
            event::emit<RebalanceNeededEvent>(RebalanceNeededEvent::V1{deficit: _v0});
            return ()
        };
    }
    public fun register_callbacks(p0: &signer, p1: address, p2: |address|(address) has copy + drop + store, p3: |address, fungible_asset::FungibleAsset, address| has copy + drop + store, p4: |address, address, fungible_asset::FungibleAsset| has copy + drop + store, p5: |&signer, address, string::String| has copy + drop + store, p6: |&signer, address, string::String| has copy + drop + store, p7: |&signer, vector<address>| has copy + drop + store, p8: |&signer, address, u64| has copy + drop + store)
        acquires PredepositAdminPermissions, PredepositState
    {
        assert_admin_capability(p0, p1);
        if (exists<ExternalCallbacks>(p1)) abort 2;
        let _v0 = object::generate_signer_for_extending(&borrow_global<PredepositState>(p1).extend_ref);
        let _v1 = ExternalCallbacks::V1{get_or_create_primary_subaccount_wrapper_f: p2, deposit_funds_to_subaccount_f: p3, contribute_funds_to_vault_f: p4, admin_register_referral_code_f: p5, admin_register_referrer_f: p6, add_to_allow_list_f: p7, set_max_referral_codes_f: p8};
        let _v2 = &_v0;
        move_to<ExternalCallbacks>(_v2, _v1);
    }
    public entry fun register_referral_code(p0: &signer, p1: address, p2: string::String)
        acquires PredepositState, ReferralRegistry
    {
        let _v0;
        let _v1;
        let _v2 = *&borrow_global<PredepositState>(p1).lifecycle;
        let _v3 = PredepositLifecycle::AcceptingDeposits{};
        assert!(_v2 == _v3, 3);
        if (string::length(&p2) > 0) _v1 = string::length(&p2) <= 32 else _v1 = false;
        assert!(_v1, 24);
        assert!(is_ascii_alphanumeric(&p2), 26);
        let _v4 = signer::address_of(p0);
        let _v5 = borrow_global_mut<ReferralRegistry>(p1);
        let _v6 = &_v5.addr_to_referral_code;
        let _v7 = &_v4;
        if (big_ordered_map::contains<address,string::String>(_v6, _v7)) _v0 = false else {
            let _v8 = &_v5.referral_code_to_addr;
            let _v9 = &p2;
            _v0 = !big_ordered_map::contains<string::String,address>(_v8, _v9)
        };
        assert!(_v0, 23);
        big_ordered_map::add<address,string::String>(&mut _v5.addr_to_referral_code, _v4, p2);
        big_ordered_map::add<string::String,address>(&mut _v5.referral_code_to_addr, p2, _v4);
        event::emit<ReferralCodeRegisteredEvent>(ReferralCodeRegisteredEvent::V1{referrer_addr: _v4, referral_code: p2});
    }
    public entry fun remove_admin(p0: &signer, p1: address, p2: address)
        acquires PredepositAdminPermissions
    {
        assert!(is_deployer(p0), 0);
        remove_permission_internal(p1, p2);
    }
    fun remove_permission_internal(p0: address, p1: address)
        acquires PredepositAdminPermissions
    {
        assert!(exists<PredepositAdminPermissions>(p0), 14);
        let _v0 = &mut borrow_global_mut<PredepositAdminPermissions>(p0).delegated_permissions;
        let _v1 = &p1;
        let _v2 = ordered_map::remove<address,StoredPermission>(_v0, _v1);
    }
    fun transition_depositor(p0: &signer, p1: &mut PredepositState, p2: &ReferralRegistry, p3: &signer, p4: address, p5: address, p6: &ExternalCallbacks) {
        let _v0;
        let _v1;
        let _v2;
        let _v3 = &p1.depositors;
        let _v4 = &p5;
        assert!(big_ordered_map::contains<address,DepositorState>(_v3, _v4), 7);
        let _v5 = &p1.depositors;
        let _v6 = &p5;
        let _v7 = big_ordered_map::borrow<address,DepositorState>(_v5, _v6);
        if (*&_v7.has_transitioned) abort 15;
        if (*&_v7.dlp_balance > 0) _v1 = true else _v1 = *&_v7.ua_balance > 0;
        assert!(_v1, 13);
        let _v8 = &p2.addr_to_used_referral_code;
        let _v9 = &p5;
        if (big_ordered_map::contains<address,string::String>(_v8, _v9)) {
            let _v10 = &p2.addr_to_used_referral_code;
            let _v11 = &p5;
            let _v12 = *big_ordered_map::borrow<address,string::String>(_v10, _v11);
            let _v13 = &p2.referral_code_to_addr;
            let _v14 = &_v12;
            _v0 = *big_ordered_map::borrow<string::String,address>(_v13, _v14);
            let _v15 = *&p6.admin_register_referrer_f;
            _v15(p0, p5, _v12);
            event::emit<ReferralLinkedEvent>(ReferralLinkedEvent::V1{depositor_addr: p5, referral_code: _v12, referrer_addr: _v0})
        };
        let _v16 = *&p6.get_or_create_primary_subaccount_wrapper_f;
        _v0 = _v16(p5);
        let _v17 = *&_v7.ua_balance;
        let _v18 = *&p1.post_cap_dlp_percentage_bps;
        let _v19 = _v17 * _v18 / 10000;
        let _v20 = *&_v7.dlp_balance + _v19;
        _v19 = *&_v7.ua_balance - _v19;
        if (_v20 > 0) {
            let _v21 = *&p1.asset_type;
            _v2 = primary_fungible_store::withdraw<fungible_asset::Metadata>(p3, _v21, _v20);
            let _v22 = *&p6.contribute_funds_to_vault_f;
            _v22(_v0, p4, _v2)
        };
        if (_v19 > 0) {
            let _v23 = *&p1.asset_type;
            _v2 = primary_fungible_store::withdraw<fungible_asset::Metadata>(p3, _v23, _v19);
            let _v24 = *&p6.deposit_funds_to_subaccount_f;
            _v24(p5, _v2, _v0)
        };
        let _v25 = *&_v7.ua_balance;
        let _v26 = &mut p1.ua_total;
        *_v26 = *_v26 - _v25;
        _v25 = *&_v7.dlp_balance;
        _v26 = &mut p1.dlp_total;
        *_v26 = *_v26 - _v25;
        let _v27 = &mut p1.depositors;
        let _v28 = &p5;
        let _v29 = big_ordered_map::remove<address,DepositorState>(_v27, _v28);
        let _v30 = DepositorState::V1{dlp_balance: 0, ua_balance: 0, has_transitioned: true};
        big_ordered_map::add<address,DepositorState>(&mut p1.depositors, p5, _v30);
        event::emit<LaunchTransitionEvent>(LaunchTransitionEvent::V1{depositor: p5, subaccount: _v0, dlp_contribution: _v20, ua_contribution: _v19});
    }
    public entry fun transition_depositors(p0: &signer, p1: address, p2: vector<address>)
        acquires DlpVault, ExternalCallbacks, PredepositAdminPermissions, PredepositState, ReferralRegistry
    {
        let _v0;
        assert_admin_capability(p0, p1);
        assert!(vector::length<address>(&p2) <= 16, 19);
        assert!(vector::length<address>(&p2) > 0, 20);
        let _v1 = borrow_global_mut<PredepositState>(p1);
        let _v2 = *&_v1.lifecycle;
        let _v3 = PredepositLifecycle::Launching{};
        assert!(_v2 == _v3, 17);
        let _v4 = *&_v1.rebalance_dlp_total;
        let _v5 = *&_v1.dlp_cap;
        if (_v4 >= _v5) _v0 = true else _v0 = *&_v1.rebalance_ua_total == 0;
        assert!(_v0, 11);
        let _v6 = borrow_global<DlpVault>(p1);
        assert!(option::is_some<address>(&_v6.vault), 16);
        assert!(exists<ExternalCallbacks>(p1), 18);
        let _v7 = object::generate_signer_for_extending(&_v1.extend_ref);
        let _v8 = borrow_global<ExternalCallbacks>(p1);
        let _v9 = borrow_global<ReferralRegistry>(p1);
        let _v10 = 0;
        let _v11 = false;
        let _v12 = vector::length<address>(&p2);
        loop {
            if (_v11) _v10 = _v10 + 1 else _v11 = true;
            if (!(_v10 < _v12)) break;
            let _v13 = *vector::borrow<address>(&p2, _v10);
            let _v14 = &_v7;
            let _v15 = *option::borrow<address>(&_v6.vault);
            transition_depositor(p0, _v1, _v9, _v14, _v15, _v13, _v8);
            continue
        };
    }
    public entry fun withdraw_dlp(p0: &signer, p1: address, p2: u64)
        acquires PredepositState, ReferralRegistry
    {
        let _v0;
        let _v1;
        assert!(p2 > 0, 12);
        let _v2 = borrow_global_mut<PredepositState>(p1);
        let _v3 = *&_v2.lifecycle;
        let _v4 = PredepositLifecycle::AcceptingDeposits{};
        assert!(_v3 == _v4, 3);
        let _v5 = signer::address_of(p0);
        let _v6 = &_v2.depositors;
        let _v7 = &_v5;
        assert!(big_ordered_map::contains<address,DepositorState>(_v6, _v7), 7);
        let _v8 = &mut _v2.depositors;
        let _v9 = &_v5;
        let _v10 = big_ordered_map::remove<address,DepositorState>(_v8, _v9);
        if (*&(&_v10).has_transitioned) abort 15;
        assert!(*&(&_v10).dlp_balance >= p2, 9);
        let _v11 = *&(&_v10).dlp_balance - p2;
        if (_v11 >= 50000000) _v1 = true else _v1 = _v11 == 0;
        assert!(_v1, 10);
        let _v12 = *&(&_v10).ua_balance;
        let _v13 = _v11 + _v12;
        let _v14 = *&(&_v10).ua_balance;
        let _v15 = *&(&_v10).has_transitioned;
        let _v16 = DepositorState::V1{dlp_balance: _v11, ua_balance: _v14, has_transitioned: _v15};
        big_ordered_map::add<address,DepositorState>(&mut _v2.depositors, _v5, _v16);
        let _v17 = &mut _v2.dlp_total;
        *_v17 = *_v17 - p2;
        if (_v13 == 0) {
            let _v18 = borrow_global_mut<ReferralRegistry>(p1);
            let _v19 = &_v18.addr_to_used_referral_code;
            let _v20 = &_v5;
            if (big_ordered_map::contains<address,string::String>(_v19, _v20)) {
                let _v21 = &_v18.addr_to_used_referral_code;
                let _v22 = &_v5;
                let _v23 = *big_ordered_map::borrow<address,string::String>(_v21, _v22);
                decrement_active_referral_count(_v18, _v23)
            }
        };
        let _v24 = object::generate_signer_for_extending(&_v2.extend_ref);
        let _v25 = &_v24;
        let _v26 = *&_v2.asset_type;
        let _v27 = primary_fungible_store::withdraw<fungible_asset::Metadata>(_v25, _v26, p2);
        primary_fungible_store::deposit(_v5, _v27);
        event::emit<WithdrawEvent>(WithdrawEvent::V1{depositor: _v5, idx: 0, amount: p2, is_dlp_else_ua: true});
        let _v28 = *&_v2.dlp_cap;
        let _v29 = *&_v2.dlp_total;
        if (_v28 > _v29) _v0 = *&_v2.ua_total > 0 else _v0 = false;
        if (_v0) {
            let _v30 = option::none<u32>();
            promote_ua_to_dlp(_v2, _v30);
            return ()
        };
    }
    public entry fun withdraw_ua_from_entry(p0: &signer, p1: address, p2: u64, p3: u64)
        acquires PredepositState, ReferralRegistry
    {
        let _v0;
        assert!(p3 > 0, 12);
        let _v1 = borrow_global_mut<PredepositState>(p1);
        let _v2 = *&_v1.lifecycle;
        let _v3 = PredepositLifecycle::AcceptingDeposits{};
        assert!(_v2 == _v3, 3);
        let _v4 = signer::address_of(p0);
        let _v5 = smart_vector::length<Deposit>(&_v1.deposits);
        assert!(p2 < _v5, 22);
        let _v6 = smart_vector::borrow_mut<Deposit>(&mut _v1.deposits, p2);
        assert!(*&_v6.owner == _v4, 5);
        let _v7 = *&_v6.remaining;
        assert!(p3 <= _v7, 9);
        let _v8 = *&_v6.remaining - p3;
        if (_v8 >= 50000000) _v0 = true else _v0 = _v8 == 0;
        assert!(_v0, 10);
        let _v9 = p3;
        let _v10 = &mut _v6.remaining;
        *_v10 = *_v10 - _v9;
        let _v11 = &mut _v1.depositors;
        let _v12 = &_v4;
        let _v13 = big_ordered_map::remove<address,DepositorState>(_v11, _v12);
        if (*&(&_v13).has_transitioned) abort 15;
        _v9 = *&(&_v13).ua_balance - p3;
        let _v14 = *&(&_v13).dlp_balance + _v9;
        let _v15 = *&(&_v13).dlp_balance;
        let _v16 = *&(&_v13).has_transitioned;
        let _v17 = DepositorState::V1{dlp_balance: _v15, ua_balance: _v9, has_transitioned: _v16};
        big_ordered_map::add<address,DepositorState>(&mut _v1.depositors, _v4, _v17);
        _v10 = &mut _v1.ua_total;
        *_v10 = *_v10 - p3;
        if (_v14 == 0) {
            let _v18 = borrow_global_mut<ReferralRegistry>(p1);
            let _v19 = &_v18.addr_to_used_referral_code;
            let _v20 = &_v4;
            if (big_ordered_map::contains<address,string::String>(_v19, _v20)) {
                let _v21 = &_v18.addr_to_used_referral_code;
                let _v22 = &_v4;
                let _v23 = *big_ordered_map::borrow<address,string::String>(_v21, _v22);
                decrement_active_referral_count(_v18, _v23)
            }
        };
        let _v24 = object::generate_signer_for_extending(&_v1.extend_ref);
        let _v25 = &_v24;
        let _v26 = *&_v1.asset_type;
        let _v27 = primary_fungible_store::withdraw<fungible_asset::Metadata>(_v25, _v26, p3);
        primary_fungible_store::deposit(_v4, _v27);
        event::emit<WithdrawEvent>(WithdrawEvent::V1{depositor: _v4, idx: p2, amount: p3, is_dlp_else_ua: false});
    }
}
