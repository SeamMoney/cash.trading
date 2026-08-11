/// Cross-language tests for `portfolio_vault`.
///
/// The critical one is `typescript_bcs_attestation_verifies_in_move`: a signature produced by
/// the TypeScript attestor (lib/portfolio-attestor.ts) over a TypeScript-serialized message is
/// verified INSIDE the VM against a Move-serialized message. If the two BCS layouts drift,
/// nothing fails loudly in either language — every tick just aborts with E_INVALID_SIGNATURE on
/// a vault that looks correctly configured.
///
/// The action-digest test matters as much. The signed message carries only a hash of the
/// action vector, so the whole widening of the attestor's authority rests on Move and
/// TypeScript hashing the same bytes. A disagreement there would either brick every vault or,
/// worse, let a signature issued over one action list be paired with a different one.
///
/// Fixtures are printed by `pnpm test:portfolio` (deterministic key, stable output).
/// Regenerate them together.
#[test_only]
module cash_strategy::portfolio_vault_tests {
    use std::vector;
    use aptos_std::ed25519;

    use cash_strategy::portfolio_vault;

    // ── Fixtures from scripts/portfolio-attestor-selftest.ts ──────────────
    const FIXTURE_PUBKEY: vector<u8> = x"ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
    const FIXTURE_COMMITMENT: vector<u8> = x"2626262626262626262626262626262626262626262626262626262626262626";
    const FIXTURE_GENESIS: vector<u8> = x"c687f35c7d0fdddc3f5b149cef4d7409e04f5032fc3cebb9ed55007caea8c594";
    const FIXTURE_ACTIONS_DIGEST: vector<u8> = x"533d4ba6724e6efa86e1fb19f12940cc915754ba3515161c81e75c517f5fa550";
    const FIXTURE_SIGNATURE: vector<u8> = x"8df30ad38f5efa27ebbdfd8fe1bf6bdad5b272f7bce85ae09320a298a59de523ac4ec7912a7fcc4cc621588ce1ca06f3926be7887ee45b224602f63ba8352203";
    const FIXTURE_MESSAGE: vector<u8> = x"1f636173682e74726164696e672f706f7274666f6c696f2d7661756c742f763202cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd202626262626262626262626262626262626262626262626262626262626262626000000000000000020c687f35c7d0fdddc3f5b149cef4d7409e04f5032fc3cebb9ed55007caea8c594e80300000000000020533d4ba6724e6efa86e1fb19f12940cc915754ba3515161c81e75c517f5fa550";
    /// sha3_256(genesis || bcs(1000u64) || bcs(vector[7e12, 3.5e11, 2e10, 9e8])) per TypeScript.
    const FIXTURE_FOLD: vector<u8> = x"a2c5770e0d96a5376294d2bc437f94b160445e262f7228a9325aa4413f3aa0ca";

    const FIXTURE_SV: address = @0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd;
    const FIXTURE_CHAIN_ID: u8 = 2;
    const FIXTURE_BAR_TS: u64 = 1000;

    /// The fixture action vector: long market 0 at 15% / 2x, short market 2 at 8% / 1.5x,
    /// close market 3.
    fun fixture_actions(): (vector<u8>, vector<u8>, vector<u16>, vector<u16>) {
        (vector[0u8, 2u8, 3u8], vector[1u8, 2u8, 0u8], vector[1500u16, 800u16, 0u16], vector[200u16, 150u16, 0u16])
    }

    /// Move must hash the action vector to the same 32 bytes TypeScript did. Everything the
    /// attestor is newly allowed to say rides on this one equality.
    #[test]
    fun action_digest_matches_typescript() {
        let (idxs, sides, pcts, levs) = fixture_actions();
        let d = portfolio_vault::actions_digest_for_test(idxs, sides, pcts, levs);
        assert!(d == FIXTURE_ACTIONS_DIGEST, 1);
    }

    /// Reordering the same actions must change the digest. The contract applies them in order,
    /// and close-then-open is not the same trade as open-then-close, so a digest that ignored
    /// order would let a cranker rearrange a signed vector into a different strategy.
    #[test]
    fun action_digest_is_order_sensitive() {
        let (idxs, sides, pcts, levs) = fixture_actions();
        let a = portfolio_vault::actions_digest_for_test(idxs, sides, pcts, levs);
        let b = portfolio_vault::actions_digest_for_test(
            vector[2u8, 0u8, 3u8],
            vector[2u8, 1u8, 0u8],
            vector[800u16, 1500u16, 0u16],
            vector[150u16, 200u16, 0u16],
        );
        assert!(a != b, 2);
    }

    /// Every field of an action is covered — changing the leverage alone must move the digest,
    /// or an attestor could sign at 1x and a cranker submit at 10x.
    #[test]
    fun action_digest_covers_every_field() {
        let (idxs, sides, pcts, levs) = fixture_actions();
        let base = portfolio_vault::actions_digest_for_test(idxs, sides, pcts, levs);

        let d_market = portfolio_vault::actions_digest_for_test(
            vector[1u8, 2u8, 3u8], vector[1u8, 2u8, 0u8], vector[1500u16, 800u16, 0u16], vector[200u16, 150u16, 0u16]);
        let d_side = portfolio_vault::actions_digest_for_test(
            vector[0u8, 2u8, 3u8], vector[2u8, 2u8, 0u8], vector[1500u16, 800u16, 0u16], vector[200u16, 150u16, 0u16]);
        let d_pct = portfolio_vault::actions_digest_for_test(
            vector[0u8, 2u8, 3u8], vector[1u8, 2u8, 0u8], vector[1501u16, 800u16, 0u16], vector[200u16, 150u16, 0u16]);
        let d_lev = portfolio_vault::actions_digest_for_test(
            vector[0u8, 2u8, 3u8], vector[1u8, 2u8, 0u8], vector[1500u16, 800u16, 0u16], vector[1000u16, 150u16, 0u16]);

        assert!(base != d_market, 3);
        assert!(base != d_side, 4);
        assert!(base != d_pct, 5);
        assert!(base != d_lev, 6);
    }

    /// The BCS layout Move produces must equal the bytes TypeScript signed.
    #[test]
    fun move_bcs_matches_typescript_bytes() {
        let msg = portfolio_vault::attestation_message_for_test(
            FIXTURE_SV,
            FIXTURE_COMMITMENT,
            0,
            FIXTURE_GENESIS,
            FIXTURE_BAR_TS,
            FIXTURE_ACTIONS_DIGEST,
            FIXTURE_CHAIN_ID,
        );
        assert!(msg == FIXTURE_MESSAGE, 7);
    }

    /// A TypeScript-produced signature verifies inside the VM over a Move-serialized message.
    /// This is the cross-language contract.
    #[test]
    fun typescript_bcs_attestation_verifies_in_move() {
        let msg = portfolio_vault::attestation_message_for_test(
            FIXTURE_SV,
            FIXTURE_COMMITMENT,
            0,
            FIXTURE_GENESIS,
            FIXTURE_BAR_TS,
            FIXTURE_ACTIONS_DIGEST,
            FIXTURE_CHAIN_ID,
        );
        let sig = ed25519::new_signature_from_bytes(FIXTURE_SIGNATURE);
        let pk = ed25519::new_unvalidated_public_key_from_bytes(FIXTURE_PUBKEY);
        assert!(ed25519::signature_verify_strict(&sig, &pk, msg), 8);
    }

    /// The action digest is bound by the signature: swapping in a different action vector must
    /// fail verification. If it did not, the actions would be advisory.
    #[test]
    fun actions_are_bound_by_the_signature() {
        let (idxs, sides, pcts, levs) = fixture_actions();
        let _ = idxs; let _ = sides; let _ = pcts; let _ = levs;
        let other = portfolio_vault::actions_digest_for_test(
            vector[0u8], vector[1u8], vector[1500u16], vector[200u16]);
        let msg = portfolio_vault::attestation_message_for_test(
            FIXTURE_SV, FIXTURE_COMMITMENT, 0, FIXTURE_GENESIS, FIXTURE_BAR_TS, other, FIXTURE_CHAIN_ID);
        let sig = ed25519::new_signature_from_bytes(FIXTURE_SIGNATURE);
        let pk = ed25519::new_unvalidated_public_key_from_bytes(FIXTURE_PUBKEY);
        assert!(!ed25519::signature_verify_strict(&sig, &pk, msg), 9);
    }

    /// Replaying a signature at a later sequence number must fail.
    #[test]
    fun seq_is_bound_by_the_signature() {
        let msg = portfolio_vault::attestation_message_for_test(
            FIXTURE_SV, FIXTURE_COMMITMENT, 1, FIXTURE_GENESIS, FIXTURE_BAR_TS, FIXTURE_ACTIONS_DIGEST, FIXTURE_CHAIN_ID);
        let sig = ed25519::new_signature_from_bytes(FIXTURE_SIGNATURE);
        let pk = ed25519::new_unvalidated_public_key_from_bytes(FIXTURE_PUBKEY);
        assert!(!ed25519::signature_verify_strict(&sig, &pk, msg), 10);
    }

    /// Replaying one vault's signature against another must fail.
    #[test]
    fun strategy_vault_is_bound_by_the_signature() {
        let msg = portfolio_vault::attestation_message_for_test(
            @0xabababababababababababababababababababababababababababababababab,
            FIXTURE_COMMITMENT, 0, FIXTURE_GENESIS, FIXTURE_BAR_TS, FIXTURE_ACTIONS_DIGEST, FIXTURE_CHAIN_ID);
        let sig = ed25519::new_signature_from_bytes(FIXTURE_SIGNATURE);
        let pk = ed25519::new_unvalidated_public_key_from_bytes(FIXTURE_PUBKEY);
        assert!(!ed25519::signature_verify_strict(&sig, &pk, msg), 11);
    }

    /// A permissionless cranker cannot move a signed action vector to another
    /// timestamp and choose a different on-chain execution price.
    #[test]
    fun bar_timestamp_is_bound_by_the_signature() {
        let msg = portfolio_vault::attestation_message_for_test(
            FIXTURE_SV,
            FIXTURE_COMMITMENT,
            0,
            FIXTURE_GENESIS,
            FIXTURE_BAR_TS + 1,
            FIXTURE_ACTIONS_DIGEST,
            FIXTURE_CHAIN_ID,
        );
        let sig = ed25519::new_signature_from_bytes(FIXTURE_SIGNATURE);
        let pk = ed25519::new_unvalidated_public_key_from_bytes(FIXTURE_PUBKEY);
        assert!(!ed25519::signature_verify_strict(&sig, &pk, msg), 16);
    }

    /// A new vault must start at the DOMAIN-SEEDED genesis digest, not an empty vector.
    /// An empty digest cannot be signed (the message layout requires 32 bytes), so bar 0 of
    /// every portfolio vault would abort — and the domain seed is also what stops a signature
    /// from one protocol version being replayed at another's genesis.
    #[test]
    fun genesis_is_sha3_of_domain() {
        assert!(
            portfolio_vault::genesis_digest_for_test()
                == std::hash::sha3_256(b"cash.trading/portfolio-vault/v2"),
            14,
        );
        assert!(portfolio_vault::genesis_digest_for_test() == FIXTURE_GENESIS, 15);
    }

    /// The multi-market fold matches TypeScript, and every market's price is committed.
    #[test]
    fun fold_matches_typescript_and_commits_every_market() {
        let prices = vector[7000000000000u64, 350000000000u64, 20000000000u64, 900000000u64];
        let folded = portfolio_vault::fold_digest_for_test(FIXTURE_GENESIS, 1000, prices);
        assert!(folded == FIXTURE_FOLD, 12);

        // Bump each market's price in turn — the digest must move every time, or a market's
        // price is present in the trace but absent from what the strategy committed to.
        let i = 0;
        while (i < 4) {
            let bumped = vector[7000000000000u64, 350000000000u64, 20000000000u64, 900000000u64];
            let v = vector::borrow_mut(&mut bumped, i);
            *v = *v + 1;
            let d = portfolio_vault::fold_digest_for_test(FIXTURE_GENESIS, 1000, bumped);
            assert!(d != FIXTURE_FOLD, 13);
            i = i + 1;
        };
    }
}
