module cash_rewards::cash_rewards {
    use std::bcs;
    use std::signer;
    use std::type_info;
    use std::vector;
    use aptos_framework::chain_id;
    use aptos_framework::coin::{Self, Coin};
    use aptos_framework::event;
    use aptos_framework::timestamp;
    use aptos_std::ed25519;
    use aptos_std::table::{Self, Table};

    const VOUCHER_VERSION: u8 = 1;

    const E_ALREADY_INITIALIZED: u64 = 1;
    const E_NOT_INITIALIZED: u64 = 2;
    const E_NOT_ADMIN: u64 = 3;
    const E_INVALID_CONFIG: u64 = 4;
    const E_REWARDS_PAUSED: u64 = 5;
    const E_INVALID_EPOCH: u64 = 6;
    const E_VOUCHER_EXPIRED: u64 = 7;
    const E_INVALID_SIGNATURE: u64 = 8;
    const E_NOTHING_TO_CLAIM: u64 = 9;
    const E_WALLET_CAP_EXCEEDED: u64 = 10;
    const E_EPOCH_CAP_EXCEEDED: u64 = 11;
    const E_INSUFFICIENT_REWARDS: u64 = 12;
    const E_INVALID_RECIPIENT: u64 = 13;
    const E_INVALID_COIN_TYPE: u64 = 14;
    const E_WRONG_MANAGER: u64 = 15;
    const E_WRONG_CHAIN: u64 = 16;
    const E_WRONG_VERSION: u64 = 17;
    const E_NOT_PAUSED: u64 = 18;

    struct ClaimKey has copy, drop, store {
        recipient: address,
        epoch: u64,
    }

    /// Exact BCS payload signed by the off-chain eligibility issuer. Every
    /// replay domain is explicit: version, chain, module publisher, asset,
    /// recipient, epoch, cumulative entitlement, and expiry.
    struct Voucher has drop, store {
        version: u8,
        chain_id: u8,
        manager: address,
        asset_type: vector<u8>,
        recipient: address,
        epoch: u64,
        cumulative_amount: u64,
        expires_at_secs: u64,
    }

    struct Config has key {
        admin: address,
        issuer_public_key: vector<u8>,
        asset_type: vector<u8>,
        paused: bool,
        epoch_duration_secs: u64,
        max_epoch_emission: u64,
        max_wallet_epoch: u64,
        epoch_emitted: Table<u64, u64>,
        claimed: Table<ClaimKey, u64>,
    }

    struct RewardVault<phantom CoinType> has key {
        balance: Coin<CoinType>,
    }

    #[event]
    struct RewardsFunded has drop, store {
        funder: address,
        amount: u64,
        vault_balance: u64,
    }

    #[event]
    struct RewardsClaimed has drop, store {
        recipient: address,
        epoch: u64,
        amount: u64,
        cumulative_amount: u64,
        epoch_emitted: u64,
    }

    #[event]
    struct RewardsConfigured has drop, store {
        admin: address,
        issuer_public_key: vector<u8>,
        paused: bool,
        max_epoch_emission: u64,
        max_wallet_epoch: u64,
    }

    #[event]
    struct EmergencyWithdrawal has drop, store {
        recipient: address,
        amount: u64,
        vault_balance: u64,
    }

    public entry fun initialize<CoinType>(
        manager: &signer,
        issuer_public_key: vector<u8>,
        epoch_duration_secs: u64,
        max_epoch_emission: u64,
        max_wallet_epoch: u64,
    ) {
        let manager_address = signer::address_of(manager);
        assert!(manager_address == @cash_rewards, E_WRONG_MANAGER);
        assert!(!exists<Config>(@cash_rewards), E_ALREADY_INITIALIZED);
        assert!(vector::length(&issuer_public_key) == 32, E_INVALID_CONFIG);
        assert!(epoch_duration_secs > 0, E_INVALID_CONFIG);
        assert!(max_epoch_emission > 0, E_INVALID_CONFIG);
        assert!(max_wallet_epoch > 0 && max_wallet_epoch <= max_epoch_emission, E_INVALID_CONFIG);

        let asset_type = asset_type<CoinType>();
        move_to(manager, Config {
            admin: manager_address,
            issuer_public_key,
            asset_type,
            paused: true,
            epoch_duration_secs,
            max_epoch_emission,
            max_wallet_epoch,
            epoch_emitted: table::new(),
            claimed: table::new(),
        });
        move_to(manager, RewardVault<CoinType> { balance: coin::zero<CoinType>() });
    }

    /// Anyone may add CASH. Only the claim path can release normal rewards.
    public entry fun fund<CoinType>(funder: &signer, amount: u64) acquires Config, RewardVault {
        assert_initialized<CoinType>();
        assert!(amount > 0, E_INVALID_CONFIG);
        let rewards = coin::withdraw<CoinType>(funder, amount);
        let vault = borrow_global_mut<RewardVault<CoinType>>(@cash_rewards);
        coin::merge(&mut vault.balance, rewards);
        event::emit(RewardsFunded {
            funder: signer::address_of(funder),
            amount,
            vault_balance: coin::value(&vault.balance),
        });
    }

    public entry fun claim<CoinType>(
        recipient: &signer,
        epoch: u64,
        cumulative_amount: u64,
        expires_at_secs: u64,
        signature_bytes: vector<u8>,
    ) acquires Config, RewardVault {
        let recipient_address = signer::address_of(recipient);
        let voucher = Voucher {
            version: VOUCHER_VERSION,
            chain_id: chain_id::get(),
            manager: @cash_rewards,
            asset_type: asset_type<CoinType>(),
            recipient: recipient_address,
            epoch,
            cumulative_amount,
            expires_at_secs,
        };
        verify_voucher(&voucher, signature_bytes);
        settle_claim<CoinType>(recipient_address, epoch, cumulative_amount);
    }

    public entry fun set_paused<CoinType>(admin: &signer, paused: bool) acquires Config {
        assert_initialized<CoinType>();
        let config = borrow_global_mut<Config>(@cash_rewards);
        assert_admin(admin, config);
        config.paused = paused;
        emit_config(config);
    }

    public entry fun rotate_issuer<CoinType>(
        admin: &signer,
        issuer_public_key: vector<u8>,
    ) acquires Config {
        assert_initialized<CoinType>();
        assert!(vector::length(&issuer_public_key) == 32, E_INVALID_CONFIG);
        let config = borrow_global_mut<Config>(@cash_rewards);
        assert_admin(admin, config);
        config.issuer_public_key = issuer_public_key;
        emit_config(config);
    }

    public entry fun set_caps<CoinType>(
        admin: &signer,
        max_epoch_emission: u64,
        max_wallet_epoch: u64,
    ) acquires Config {
        assert_initialized<CoinType>();
        assert!(max_epoch_emission > 0, E_INVALID_CONFIG);
        assert!(max_wallet_epoch > 0 && max_wallet_epoch <= max_epoch_emission, E_INVALID_CONFIG);
        let config = borrow_global_mut<Config>(@cash_rewards);
        assert_admin(admin, config);
        config.max_epoch_emission = max_epoch_emission;
        config.max_wallet_epoch = max_wallet_epoch;
        emit_config(config);
    }

    public entry fun transfer_admin<CoinType>(
        admin: &signer,
        new_admin: address,
    ) acquires Config {
        assert_initialized<CoinType>();
        assert!(new_admin != @0x0, E_INVALID_CONFIG);
        let config = borrow_global_mut<Config>(@cash_rewards);
        assert_admin(admin, config);
        config.admin = new_admin;
        emit_config(config);
    }

    /// Cold-admin escape hatch. Keep the admin key out of the web runtime.
    public entry fun emergency_withdraw<CoinType>(
        admin: &signer,
        recipient: address,
        amount: u64,
    ) acquires Config, RewardVault {
        assert_initialized<CoinType>();
        assert!(amount > 0, E_INVALID_CONFIG);
        assert!(recipient != @0x0, E_INVALID_RECIPIENT);
        let config = borrow_global<Config>(@cash_rewards);
        assert_admin(admin, config);
        assert!(config.paused, E_NOT_PAUSED);
        let vault = borrow_global_mut<RewardVault<CoinType>>(@cash_rewards);
        assert!(coin::value(&vault.balance) >= amount, E_INSUFFICIENT_REWARDS);
        let withdrawn = coin::extract(&mut vault.balance, amount);
        coin::deposit(recipient, withdrawn);
        event::emit(EmergencyWithdrawal {
            recipient,
            amount,
            vault_balance: coin::value(&vault.balance),
        });
    }

    #[view]
    public fun get_state<CoinType>(): (address, vector<u8>, bool, u64, u64, u64, u64) acquires Config, RewardVault {
        assert_initialized<CoinType>();
        let config = borrow_global<Config>(@cash_rewards);
        let vault = borrow_global<RewardVault<CoinType>>(@cash_rewards);
        (
            config.admin,
            config.issuer_public_key,
            config.paused,
            config.epoch_duration_secs,
            config.max_epoch_emission,
            config.max_wallet_epoch,
            coin::value(&vault.balance),
        )
    }

    #[view]
    public fun current_epoch(): u64 acquires Config {
        assert!(exists<Config>(@cash_rewards), E_NOT_INITIALIZED);
        timestamp::now_seconds() / borrow_global<Config>(@cash_rewards).epoch_duration_secs
    }

    #[view]
    public fun claimed_by(recipient: address, epoch: u64): u64 acquires Config {
        assert!(exists<Config>(@cash_rewards), E_NOT_INITIALIZED);
        let config = borrow_global<Config>(@cash_rewards);
        *table::borrow_with_default(&config.claimed, ClaimKey { recipient, epoch }, &0)
    }

    #[view]
    public fun emitted_in_epoch(epoch: u64): u64 acquires Config {
        assert!(exists<Config>(@cash_rewards), E_NOT_INITIALIZED);
        let config = borrow_global<Config>(@cash_rewards);
        *table::borrow_with_default(&config.epoch_emitted, epoch, &0)
    }

    #[view]
    public fun voucher_bytes<CoinType>(
        recipient: address,
        epoch: u64,
        cumulative_amount: u64,
        expires_at_secs: u64,
    ): vector<u8> {
        let voucher = Voucher {
            version: VOUCHER_VERSION,
            chain_id: chain_id::get(),
            manager: @cash_rewards,
            asset_type: asset_type<CoinType>(),
            recipient,
            epoch,
            cumulative_amount,
            expires_at_secs,
        };
        bcs::to_bytes(&voucher)
    }

    fun verify_voucher(voucher: &Voucher, signature_bytes: vector<u8>) acquires Config {
        assert!(voucher.version == VOUCHER_VERSION, E_WRONG_VERSION);
        assert!(voucher.chain_id == chain_id::get(), E_WRONG_CHAIN);
        assert!(voucher.manager == @cash_rewards, E_WRONG_MANAGER);
        assert!(voucher.recipient != @0x0, E_INVALID_RECIPIENT);
        assert!(voucher.expires_at_secs >= timestamp::now_seconds(), E_VOUCHER_EXPIRED);
        let config = borrow_global<Config>(@cash_rewards);
        assert!(voucher.asset_type == config.asset_type, E_INVALID_COIN_TYPE);
        let signature = ed25519::new_signature_from_bytes(signature_bytes);
        let public_key = ed25519::new_unvalidated_public_key_from_bytes(config.issuer_public_key);
        assert!(
            ed25519::signature_verify_strict(&signature, &public_key, bcs::to_bytes(voucher)),
            E_INVALID_SIGNATURE,
        );
    }

    fun settle_claim<CoinType>(
        recipient: address,
        epoch: u64,
        cumulative_amount: u64,
    ) acquires Config, RewardVault {
        assert_initialized<CoinType>();
        let config = borrow_global_mut<Config>(@cash_rewards);
        assert!(!config.paused, E_REWARDS_PAUSED);
        assert!(epoch == timestamp::now_seconds() / config.epoch_duration_secs, E_INVALID_EPOCH);
        assert!(cumulative_amount <= config.max_wallet_epoch, E_WALLET_CAP_EXCEEDED);

        let claim_key = ClaimKey { recipient, epoch };
        let already_claimed = *table::borrow_with_default(&config.claimed, claim_key, &0);
        assert!(cumulative_amount > already_claimed, E_NOTHING_TO_CLAIM);
        let amount = cumulative_amount - already_claimed;
        let epoch_emitted = *table::borrow_with_default(&config.epoch_emitted, epoch, &0);
        let next_epoch_emitted = epoch_emitted + amount;
        assert!(next_epoch_emitted <= config.max_epoch_emission, E_EPOCH_CAP_EXCEEDED);

        let vault = borrow_global_mut<RewardVault<CoinType>>(@cash_rewards);
        assert!(coin::value(&vault.balance) >= amount, E_INSUFFICIENT_REWARDS);

        *table::borrow_mut_with_default(&mut config.claimed, claim_key, 0) = cumulative_amount;
        *table::borrow_mut_with_default(&mut config.epoch_emitted, epoch, 0) = next_epoch_emitted;

        let reward = coin::extract(&mut vault.balance, amount);
        coin::deposit(recipient, reward);
        event::emit(RewardsClaimed {
            recipient,
            epoch,
            amount,
            cumulative_amount,
            epoch_emitted: next_epoch_emitted,
        });
    }

    fun assert_initialized<CoinType>() {
        assert!(exists<Config>(@cash_rewards), E_NOT_INITIALIZED);
        assert!(exists<RewardVault<CoinType>>(@cash_rewards), E_INVALID_COIN_TYPE);
        assert!(borrow_global<Config>(@cash_rewards).asset_type == asset_type<CoinType>(), E_INVALID_COIN_TYPE);
    }

    fun assert_admin(admin: &signer, config: &Config) {
        assert!(signer::address_of(admin) == config.admin, E_NOT_ADMIN);
    }

    fun asset_type<CoinType>(): vector<u8> {
        *type_info::type_name<CoinType>().bytes()
    }

    fun emit_config(config: &Config) {
        event::emit(RewardsConfigured {
            admin: config.admin,
            issuer_public_key: config.issuer_public_key,
            paused: config.paused,
            max_epoch_emission: config.max_epoch_emission,
            max_wallet_epoch: config.max_wallet_epoch,
        });
    }

    #[test_only]
    public fun settle_claim_for_test<CoinType>(
        recipient: &signer,
        epoch: u64,
        cumulative_amount: u64,
    ) acquires Config, RewardVault {
        settle_claim<CoinType>(
            signer::address_of(recipient),
            epoch,
            cumulative_amount,
        );
    }
}
