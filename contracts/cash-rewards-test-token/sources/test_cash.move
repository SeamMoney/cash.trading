module cash_test_token::test_cash {
    use aptos_framework::managed_coin;

    struct TestCash {}

    fun init_module(publisher: &signer) {
        managed_coin::initialize<TestCash>(
            publisher,
            b"cash.trading Test CASH",
            b"tCASH",
            6,
            false,
        );
    }

    /// Testnet-only mint helper for end-to-end reward claim verification.
    public entry fun mint(publisher: &signer, recipient: address, amount: u64) {
        managed_coin::mint<TestCash>(publisher, recipient, amount);
    }
}
