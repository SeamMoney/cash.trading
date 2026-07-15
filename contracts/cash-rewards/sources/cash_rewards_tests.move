#[test_only]
module cash_rewards::cash_rewards_tests {
    use std::signer;
    use std::string;
    use aptos_framework::account;
    use aptos_framework::chain_id;
    use aptos_framework::coin;
    use aptos_framework::timestamp;
    use cash_rewards::cash_rewards;

    struct TestCoin {}

    fun issuer_key(): vector<u8> {
        vector[
            208, 74, 178, 50, 116, 43, 180, 171,
            58, 19, 104, 189, 70, 21, 228, 230,
            208, 34, 74, 183, 26, 1, 107, 175,
            133, 32, 163, 50, 201, 119, 135, 55,
        ]
    }

    /// Produced by the TypeScript BCS serializer for:
    /// chain=4, the configured manager, TestCoin, recipient=0xa11ce,
    /// epoch=0, cumulative=100, expiry=1000.
    fun voucher_signature(): vector<u8> {
        vector[
            180, 128, 47, 64, 161, 175, 104, 225,
            128, 94, 47, 163, 237, 37, 138, 11,
            241, 53, 201, 224, 79, 59, 197, 67,
            70, 25, 46, 180, 160, 138, 80, 79,
            137, 6, 62, 28, 165, 60, 96, 157,
            1, 87, 135, 57, 209, 40, 97, 101,
            220, 17, 249, 19, 36, 93, 27, 49,
            146, 148, 170, 30, 31, 48, 183, 1,
        ]
    }

    fun setup(
        aptos_framework: &signer,
        manager: &signer,
        alice: &signer,
        max_epoch: u64,
        max_wallet: u64,
    ): (
        coin::BurnCapability<TestCoin>,
        coin::FreezeCapability<TestCoin>,
        coin::MintCapability<TestCoin>,
    ) {
        account::create_account_for_test(signer::address_of(manager));
        account::create_account_for_test(signer::address_of(alice));
        chain_id::initialize_for_test(aptos_framework, 4);
        timestamp::set_time_has_started_for_testing(aptos_framework);
        coin::create_coin_conversion_map(aptos_framework);
        let (burn, freeze, mint) = coin::initialize<TestCoin>(
            manager,
            string::utf8(b"Test CASH"),
            string::utf8(b"TCASH"),
            6,
            false,
        );
        coin::deposit(signer::address_of(manager), coin::mint(10_000, &mint));
        cash_rewards::initialize<TestCoin>(manager, issuer_key(), 604_800, max_epoch, max_wallet);
        cash_rewards::fund<TestCoin>(manager, 10_000);
        cash_rewards::set_paused<TestCoin>(manager, false);
        (burn, freeze, mint)
    }

    fun destroy_caps(
        burn: coin::BurnCapability<TestCoin>,
        freeze: coin::FreezeCapability<TestCoin>,
        mint: coin::MintCapability<TestCoin>,
    ) {
        coin::destroy_burn_cap(burn);
        coin::destroy_freeze_cap(freeze);
        coin::destroy_mint_cap(mint);
    }

    #[test(aptos_framework = @aptos_framework, manager = @cash_rewards, alice = @0xa11ce)]
    fun cumulative_claim_only_pays_the_delta(
        aptos_framework: &signer,
        manager: &signer,
        alice: &signer,
    ) {
        let (burn, freeze, mint) = setup(aptos_framework, manager, alice, 1_000, 500);
        cash_rewards::settle_claim_for_test<TestCoin>(alice, 0, 100);
        cash_rewards::settle_claim_for_test<TestCoin>(alice, 0, 175);

        assert!(cash_rewards::claimed_by(signer::address_of(alice), 0) == 175, 100);
        assert!(cash_rewards::emitted_in_epoch(0) == 175, 101);
        assert!(coin::balance<TestCoin>(signer::address_of(alice)) == 175, 102);
        let (_, _, _, _, _, _, vault_balance) = cash_rewards::get_state<TestCoin>();
        assert!(vault_balance == 9_825, 103);
        destroy_caps(burn, freeze, mint);
    }

    #[test(aptos_framework = @aptos_framework, manager = @cash_rewards, alice = @0xa11ce)]
    fun typescript_bcs_voucher_verifies_in_move(
        aptos_framework: &signer,
        manager: &signer,
        alice: &signer,
    ) {
        let (burn, freeze, mint) = setup(aptos_framework, manager, alice, 1_000, 500);
        cash_rewards::claim<TestCoin>(alice, 0, 100, 1_000, voucher_signature());
        assert!(coin::balance<TestCoin>(signer::address_of(alice)) == 100, 104);
        destroy_caps(burn, freeze, mint);
    }

    #[test(aptos_framework = @aptos_framework, manager = @cash_rewards, alice = @0xa11ce)]
    #[expected_failure(abort_code = 10, location = cash_rewards::cash_rewards)]
    fun wallet_cap_is_enforced(
        aptos_framework: &signer,
        manager: &signer,
        alice: &signer,
    ) {
        let (burn, freeze, mint) = setup(aptos_framework, manager, alice, 1_000, 100);
        cash_rewards::settle_claim_for_test<TestCoin>(alice, 0, 101);
        destroy_caps(burn, freeze, mint);
    }

    #[test(
        aptos_framework = @aptos_framework,
        manager = @cash_rewards,
        alice = @0xa11ce,
        bob = @0xb0b
    )]
    #[expected_failure(abort_code = 11, location = cash_rewards::cash_rewards)]
    fun global_epoch_cap_is_enforced(
        aptos_framework: &signer,
        manager: &signer,
        alice: &signer,
        bob: &signer,
    ) {
        let (burn, freeze, mint) = setup(aptos_framework, manager, alice, 150, 100);
        account::create_account_for_test(signer::address_of(bob));
        cash_rewards::settle_claim_for_test<TestCoin>(alice, 0, 100);
        cash_rewards::settle_claim_for_test<TestCoin>(bob, 0, 51);
        destroy_caps(burn, freeze, mint);
    }

    #[test(aptos_framework = @aptos_framework, manager = @cash_rewards, alice = @0xa11ce)]
    #[expected_failure(abort_code = 9, location = cash_rewards::cash_rewards)]
    fun voucher_replay_has_nothing_to_claim(
        aptos_framework: &signer,
        manager: &signer,
        alice: &signer,
    ) {
        let (burn, freeze, mint) = setup(aptos_framework, manager, alice, 1_000, 500);
        cash_rewards::settle_claim_for_test<TestCoin>(alice, 0, 100);
        cash_rewards::settle_claim_for_test<TestCoin>(alice, 0, 100);
        destroy_caps(burn, freeze, mint);
    }
}
