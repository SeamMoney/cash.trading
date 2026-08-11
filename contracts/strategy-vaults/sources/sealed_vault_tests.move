/// Cross-language tests for `sealed_vault`.
///
/// The critical one is `typescript_bcs_attestation_verifies_in_move`: it takes a
/// signature produced by the TypeScript attestor (lib/sealed-attestor.ts) over a
/// TypeScript-serialized message and verifies it INSIDE the VM against a
/// Move-serialized message. If the two BCS layouts ever drift, this fails —
/// which is the failure mode that would otherwise only show up in production as
/// "every tick aborts with E_INVALID_SIGNATURE".
///
/// Fixtures are printed by `pnpm exec tsx scripts/sealed-attestor-selftest.ts`
/// (deterministic key, so they are stable). Regenerate them together.
#[test_only]
module cash_strategy::sealed_vault_tests {
    use std::hash;
    use std::vector;
    use aptos_std::ed25519;

    use cash_strategy::sealed_vault;

    // ── Fixtures from scripts/sealed-attestor-selftest.ts ─────────────────
    const FIXTURE_PUBKEY: vector<u8> = x"d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737";
    const FIXTURE_COMMITMENT: vector<u8> = x"26804fc18ed3e410c55e76888b9c4a8b131827d82844cadcff1630d329b15be7";
    const FIXTURE_GENESIS: vector<u8> = x"c826b26a4c26c4793209efa352ed1e9774d4b081e63f41cb62fdbcdfb6049542";
    const FIXTURE_SIGNATURE: vector<u8> = x"1a8adb537060b5556028a359879d0653b5c8a1ad994d176c9ff1c3aaf0ab73c60f097e1f612ece2de9d43a071c31012450bf36e0838fa8677b99d205808fd305";
    /// Full BCS message the TS side signed — pins the layout independently of
    /// the signature check below.
    const FIXTURE_MESSAGE: vector<u8> = x"1c636173682e74726164696e672f7365616c65642d7661756c742f763202cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd2026804fc18ed3e410c55e76888b9c4a8b131827d82844cadcff1630d329b15be7000000000000000020c826b26a4c26c4793209efa352ed1e9774d4b081e63f41cb62fdbcdfb6049542e80300000000000001";
    /// sha3_256(genesis || bcs(1000u64) || bcs(7000000000000u64)) per TypeScript.
    const FIXTURE_FOLD: vector<u8> = x"776bad456cf9824e95b6d38fec292c883afd9d0113a63a08c0f7ac8a834583fb";

    const FIXTURE_SV: address = @0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd;
    const FIXTURE_CHAIN_ID: u8 = 2;
    const FIXTURE_BAR_TS: u64 = 1000;
    const SIGNAL_BUY: u8 = 1;
    const SIGNAL_SELL: u8 = 2;

    /// The BCS layout Move produces must equal the bytes TypeScript signed.
    #[test]
    fun move_bcs_matches_typescript_bytes() {
        let msg = sealed_vault::attestation_message_for_test(
            FIXTURE_SV,
            FIXTURE_COMMITMENT,
            0,
            FIXTURE_GENESIS,
            FIXTURE_BAR_TS,
            SIGNAL_BUY,
            FIXTURE_CHAIN_ID,
        );
        assert!(msg == FIXTURE_MESSAGE, 1);
    }

    /// A TypeScript-produced signature verifies inside the VM over a
    /// Move-serialized message. This is the cross-language contract.
    #[test]
    fun typescript_bcs_attestation_verifies_in_move() {
        let msg = sealed_vault::attestation_message_for_test(
            FIXTURE_SV,
            FIXTURE_COMMITMENT,
            0,
            FIXTURE_GENESIS,
            FIXTURE_BAR_TS,
            SIGNAL_BUY,
            FIXTURE_CHAIN_ID,
        );
        let sig = ed25519::new_signature_from_bytes(FIXTURE_SIGNATURE);
        let pk = ed25519::new_unvalidated_public_key_from_bytes(FIXTURE_PUBKEY);
        assert!(ed25519::signature_verify_strict(&sig, &pk, msg), 2);
    }

    /// Flipping the signal must break the signature — the attestor's one degree
    /// of freedom is cryptographically bound.
    #[test]
    fun signal_is_bound_by_the_signature() {
        let msg = sealed_vault::attestation_message_for_test(
            FIXTURE_SV,
            FIXTURE_COMMITMENT,
            0,
            FIXTURE_GENESIS,
            FIXTURE_BAR_TS,
            SIGNAL_SELL, // was BUY
            FIXTURE_CHAIN_ID,
        );
        let sig = ed25519::new_signature_from_bytes(FIXTURE_SIGNATURE);
        let pk = ed25519::new_unvalidated_public_key_from_bytes(FIXTURE_PUBKEY);
        assert!(!ed25519::signature_verify_strict(&sig, &pk, msg), 3);
    }

    /// Replaying an attestation at a later seq must fail — this is the
    /// anti-replay property the module relies on.
    #[test]
    fun seq_is_bound_by_the_signature() {
        let msg = sealed_vault::attestation_message_for_test(
            FIXTURE_SV,
            FIXTURE_COMMITMENT,
            1, // was 0
            FIXTURE_GENESIS,
            FIXTURE_BAR_TS,
            SIGNAL_BUY,
            FIXTURE_CHAIN_ID,
        );
        let sig = ed25519::new_signature_from_bytes(FIXTURE_SIGNATURE);
        let pk = ed25519::new_unvalidated_public_key_from_bytes(FIXTURE_PUBKEY);
        assert!(!ed25519::signature_verify_strict(&sig, &pk, msg), 4);
    }

    /// An attestation signed for one vault cannot be used on another.
    #[test]
    fun strategy_vault_is_bound_by_the_signature() {
        let msg = sealed_vault::attestation_message_for_test(
            @0xabababababababababababababababababababababababababababababababab,
            FIXTURE_COMMITMENT,
            0,
            FIXTURE_GENESIS,
            FIXTURE_BAR_TS,
            SIGNAL_BUY,
            FIXTURE_CHAIN_ID,
        );
        let sig = ed25519::new_signature_from_bytes(FIXTURE_SIGNATURE);
        let pk = ed25519::new_unvalidated_public_key_from_bytes(FIXTURE_PUBKEY);
        assert!(!ed25519::signature_verify_strict(&sig, &pk, msg), 5);
    }

    /// The permissionless cranker must not be able to hold an attestation and
    /// choose a more favorable execution timestamp later.
    #[test]
    fun bar_timestamp_is_bound_by_the_signature() {
        let msg = sealed_vault::attestation_message_for_test(
            FIXTURE_SV,
            FIXTURE_COMMITMENT,
            0,
            FIXTURE_GENESIS,
            FIXTURE_BAR_TS + 1,
            SIGNAL_BUY,
            FIXTURE_CHAIN_ID,
        );
        let sig = ed25519::new_signature_from_bytes(FIXTURE_SIGNATURE);
        let pk = ed25519::new_unvalidated_public_key_from_bytes(FIXTURE_PUBKEY);
        assert!(!ed25519::signature_verify_strict(&sig, &pk, msg), 13);
    }

    /// Genesis digest and the fold step must match TypeScript, or a verifier
    /// replaying the public trace would compute a different digest chain.
    #[test]
    fun digest_chain_matches_typescript() {
        assert!(sealed_vault::genesis_digest_for_test() == FIXTURE_GENESIS, 6);
        let folded = sealed_vault::fold_digest_for_test(FIXTURE_GENESIS, 1000, 7000000000000);
        assert!(folded == FIXTURE_FOLD, 7);
    }

    /// The digest must actually chain — a different bar produces a different
    /// digest, so history cannot be rewritten.
    #[test]
    fun digest_is_history_dependent() {
        let a = sealed_vault::fold_digest_for_test(FIXTURE_GENESIS, 1000, 7000000000000);
        let b = sealed_vault::fold_digest_for_test(FIXTURE_GENESIS, 1001, 7000000000000);
        let c = sealed_vault::fold_digest_for_test(FIXTURE_GENESIS, 1000, 7000000000001);
        assert!(a != b, 8);
        assert!(a != c, 9);
        assert!(vector::length(&a) == 32, 10);
        // Chaining two bars differs from folding either alone.
        let ab = sealed_vault::fold_digest_for_test(a, 1060, 7010000000000);
        assert!(ab != a, 11);
    }

    /// Sanity: the domain separator is what both sides think it is.
    #[test]
    fun genesis_is_sha3_of_domain() {
        assert!(
            sealed_vault::genesis_digest_for_test() == hash::sha3_256(b"cash.trading/sealed-vault/v2"),
            12,
        );
    }
}
