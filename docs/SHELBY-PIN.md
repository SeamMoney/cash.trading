# Shelby pin: verifiable Pine ⇄ bytecode (design stub)

The trust story's last mile: depositors should be able to verify that the deployed vault module
actually came from the published PineScript — not trust our UI's claim.

## What gets pinned to Shelby (per deployed strategy)
1. **Canonical PineScript** — the exact source the creator submitted (normalized line endings).
2. **Emitted Move source** — `transpileV3(pine, addr, {target:"vault", marketAddr, …})` output.
3. **Build manifest** — transpiler version + opts (marketAddr/lot/min/szPow) + compiler version, so
   the emission is reproducible byte-for-byte.

Shelby gives content-addressed, durable storage on Aptos — the pin returns a content hash/URI.

## Where the hash lives on-chain (reuse, don't add)
The indicator module **already has a commitment slot**: `ProprietaryConfig.algo_hash` (set via
`set_proprietary`, surfaced by `get_creator_info`). Define:

```
algo_hash = sha3_256(canonical_pine || 0x00 || emitted_move || 0x00 || manifest_json)
```

Deploy flow sets it at publish time; the Shelby URI goes in the strategy registry row
(`/api/launchpad/strategy-vaults` — add `shelbyUri` column, backend lane).

## Depositor verification (one API call + local hash)
`GET /api/launchpad/verify?sv=0x…` →
1. Fetch the three artifacts from Shelby by URI.
2. Recompute `algo_hash`; compare to on-chain `get_creator_info(indicator)`.
3. Re-run the transpiler (pinned version) on the Pine; diff against the pinned Move.
4. (Strong mode) recompile the Move and compare module bytecode against the on-chain package
   (`code::PackageRegistry` module bytes).
Return `{verified, checks: {hash, emission, bytecode}}` — the card shows a "Verified source" badge.

## Lane split
- **Mine (UI):** hashing helper, the verify route under app/api/launchpad, the badge on strategy
  cards, pin step in the deploy progress rail.
- **Backend:** Shelby upload client + creds, `shelbyUri` registry column, the strong-mode recompile
  worker (same sandbox as the compile service in DEPLOY-FROM-UI.md).

## Open question
Shelby SDK/API account setup — the `~/shelby-cash` repo (shelby-pulse) has a working upload path
with API-key support; lift the client from there.
