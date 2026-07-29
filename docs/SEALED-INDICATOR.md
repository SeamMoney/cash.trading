# SEALED-INDICATOR.md — private, tamper-proof, on-chain-enforced strategy vaults

> Supersedes the "publish the transpiled strategy as Move bytecode" path for any curator who
> wants to keep alpha private. That path stays available for curators who *want* full public
> verifiability (open-source strategies); this document describes the sealed alternative.
>
> Status: module written (`contracts/strategy-vaults/sources/sealed_vault.move`), not yet
> published. Testnet deploy runbook in §8.

## 1. The problem with what we shipped

The current V3 rail transpiles PineScript → Move and **publishes the module**. That gives
verifiability and takes privacy to zero: the strategy logic is readable bytecode, and
`StrategyArtifact.pineScript` stores the verbatim source (`lib/strategy-artifacts.ts:99`),
served by `/api/launchpad/verify` and `/api/launchpad/move-source`.

`ProprietaryConfig.algo_hash` (`indicator.move:132`) looks like the answer but isn't. It lives
only on the *legacy generic* path, where `create_indicator` publishes `indicator_type`,
`short_period`, `long_period` in plaintext and exposes them via `#[view] get_info`. For a
generic indicator, the parameters **are** the strategy — hashing the Pine text hides comments
and variable names, nothing more.

Two further problems the sealed design also fixes:

- **Attack surface scales with strategies.** Every deploy publishes bespoke, never-audited Move.
  Seven such packages exist on testnet today, with *drifting ABIs* (the four oldest lack
  `get_signal_view`) and all seven bound to the **old** Decibel package `0x952535…be9f`.
- **On-chain TA is expensive and inaccurate.** The on-chain buffer is close-only, so `high`/
  `low`/`open` alias `close` and ATR/Stochastic/SuperTrend are approximations
  (`move-codegen.ts:521,551`).

## 2. What "private + tamper-proof + on-chain" can actually mean

You cannot execute logic in plaintext bytecode and keep it secret. So we split the problem:

| Concern | Where it lives | Why |
|---|---|---|
| Strategy **logic** | Off-chain, committed by hash | Secret; too expensive on-chain anyway |
| Strategy **inputs** (prices) | **On-chain**, read from Decibel's oracle | Attestor cannot lie about what it saw |
| Strategy **rules** (market, NAV cap, leverage, cooldown, pause) | **On-chain**, enforced per trade | This is the depositor guarantee |
| **Execution** (order placement) | **On-chain**, module-only signer | No bot ever holds a trading key |
| **Trace** (what fired, on what input, signed by whom) | **On-chain** events | Independently checkable, forever |

This matches the constraint directly: *rules enforced on-chain, logic attested*. The curator's
edge stays private; the depositor's protection stays on-chain.

## 3. Architecture — commit → attest → verify → execute → trace

### 3.1 Commit (once, at seal time)

```
program_commitment = sha3_256(
    canonical_pine || 0x00 || emitted_move || 0x00 || manifest_json
)
```

`manifest_json` pins transpiler version + options (marketAddr, lot, min, szPow) so emission is
reproducible byte-for-byte. Same formula as `docs/SHELBY-PIN.md` — reuse it, don't invent a
second one. The commitment goes on-chain at creation; `seal()` makes it and the rule set
one-way immutable.

### 3.2 Attest (every bar, off-chain)

The attestor holds an ed25519 key and runs the committed program. It signs a BCS-serialized
struct whose fields the chain can **independently reconstruct**:

```move
struct Attestation has drop {
    domain:             vector<u8>,   // "cash.trading/sealed-vault/v1"
    chain_id:           u8,
    strategy_vault:     address,
    program_commitment: vector<u8>,
    seq:                u64,          // strictly monotonic — no gaps, no replays
    bar_ts:             u64,
    price:              u64,          // must equal the on-chain mark price
    input_digest:       vector<u8>,   // rolling hash of ALL bars seen so far
    signal:             u8,
}
```

### 3.3 Verify + execute (on-chain, one small module)

`tick_attested(cranker, sv_addr, bar_ts, signal, signature)`:

1. Read mark price **on-chain** via `perp_engine::get_mark_price` — the caller never supplies it.
2. Enforce `bar_ts > last_bar_ts + min_bar_interval_s` (no bar stuffing, no back-dating).
3. Append `(price, bar_ts)` to the on-chain trace; update `input_digest`.
4. Reconstruct the `Attestation` struct from **chain state**, not from caller input.
5. `ed25519::signature_verify_strict` against the sealed `attestor_pubkey`.
6. `seq += 1`.
7. If the signal is a flip: size from NAV, enforce leverage cap, place reduce-only close +
   open via the module's own `ExtendRef` signer.
8. Emit `AttestedTick` (every bar) and `VaultTraded` (on trades).

The signature covers a message the attestor **cannot choose**: price and `input_digest` come
from chain state, `seq` from the module's counter, `strategy_vault` and `program_commitment`
from sealed storage. The only free field is `signal`.

### 3.4 Trace

Two on-chain artifacts make the history checkable by anyone:

- **`input_digest`** — a rolling `sha3_256(prev_digest || bar_ts || price)` over every bar the
  module has ever processed. Commits the complete input history in 32 bytes.
- **`seq`** — strictly monotonic with no gaps. The attestor cannot hide a bar it didn't like,
  because skipping a bar breaks the chain and any missing `seq` is publicly visible.

## 4. Why this is not "a middleware bot managing the vault"

The distinction is enforceable, not rhetorical:

| A bot manager can… | The attestor can… |
|---|---|
| Pick any market | Nothing — market is sealed at creation |
| Pick any size | Nothing — size is `nav × pct_bps`, computed on-chain |
| Pick entry price | Nothing — price is the on-chain mark |
| Trade whenever | Only once per `min_bar_interval_s`, on a monotonic seq |
| Skip/reorder trades silently | Nothing — gaps in `seq` are public |
| Withdraw funds | Nothing — no funds-movement capability is ever delegated |
| Trade on a whim | Only emit `signal ∈ {neutral, buy, sell}` |

The attestor's entire authority is **one trit per bar**, and every one of them is signed,
sequenced, and bound to an on-chain-derived input digest. It cannot manage the vault; it can
only answer one question the vault asks it.

## 5. Threat model — honest residue

| Threat | Mitigated by | Residual |
|---|---|---|
| Attestor forges the price | Price read on-chain | None |
| Attestor replays an old signal | `seq` + `bar_ts` monotonic | None |
| Attestor hides an unfavourable bar | `seq` gaps are public | None (detectable) |
| Attestor trades another market | `market` sealed at creation | None |
| Attestor oversizes | Size computed on-chain from NAV + leverage cap | None |
| Attestor withdraws | No funds-movement delegation | None |
| Curator changes the strategy | `program_commitment` sealed one-way | None |
| Curator adds a second Decibel delegate | **Not fixed here** — needs `CURATOR-RULES.md` §3.6 admin custody | **Real.** Monitor + de-badge |
| **Attestor runs a different program than the one committed** | Nothing, in tier 1 | **Real — the core residue.** See §6 |
| Package upgraded to change rules | `Move.toml` must set `upgrade_policy = "immutable"` before mainnet | Currently unset |

**Do not claim more than this.** The tier-1 guarantee is: *the signal came from the holder of
the sealed attestor key, on inputs the chain verified, under rules the chain enforced.* It is
not yet: *the signal is the output of the committed program.*

## 6. Closing the residue — three tiers, same module

The verifier is deliberately swappable. `attestor_pubkey` + signature is tier 1; tiers 2 and 3
change how step 3.3.5 is satisfied and nothing else.

**Tier 1 — bare attestation (ship now).** Trust = "we hold the key honestly." Adequate for
testnet and open beta. Weak, and must be labelled weak in the UI.

**Tier 2 — TEE attestation (next).** Run the strategy inside an AWS Nitro enclave. Bind the
enclave measurement (PCR set) into `program_commitment` at seal time, and publish the
attestation document. The key becomes enclave-resident and non-exfiltratable, so "holder of the
key" and "the committed program running unmodified" collapse into the same statement. This is
weeks of work, not quarters, and it is the recommended production target.

**Tier 3 — ZK proof (later).** Replace the signature with a SNARK proving *"`signal` is the
output of the program with hash `program_commitment` applied to the price series committed by
`input_digest`."* Aptos has BN254 / Groth16 verification available in Move, so on-chain
verification is affordable. The expensive part is a zkVM circuit for a Pine interpreter — a
research-grade project, and not worth starting until the transpiler is trustworthy (see §7).

**Delayed reveal — available at every tier, and it is the product story.** Because the module
commits the *complete* input history (`input_digest`) and every signal is signed and sequenced,
a curator can reveal the program later — after an alpha-decay window, on redemption, or on
demand — and the **entire trade history becomes retroactively verifiable**. Replay the price
trace through the revealed program; every signal must match, or the divergence is provable
against the curator's own signature. That converts privacy from a permanent trust hole into a
*timed disclosure*, which is a far easier thing to sell to a depositor.

## 7. Dependency: the transpiler must stop lying

The commitment is only meaningful if `emitted_move` faithfully represents `canonical_pine`.
Today it does not, and these must be fixed before any sealed vault takes real money:

1. `ta.vwap`/`wma`/`hma`/`cci`/`mfi`/`obv` silently lower to SMA/EMA/RSI (`pine-ir.ts:203-204`).
2. Static `close[N]` collapses to `close[1]` — `offset` is discarded (`pine-ir.ts:277-289`).
3. `high`/`low`/`open` alias `close` (`pine-ir.ts:256-258`).

Fixed in the same change-set as this module; see the commit that adds this file.

## 8. Deployment runbook (testnet → mainnet)

Everything below is blocked on signing keys we do not hold in CI; this is the sequence a human
runs.

### 8.1 Publish the sealed module

```bash
cd contracts/strategy-vaults
aptos move compile --named-addresses cash_strategy=<DEPLOYER>
aptos move test                              # sealed_vault tests must pass
aptos move publish --named-addresses cash_strategy=<DEPLOYER> \
  --url https://api.testnet.aptoslabs.com/v1
```

Publish **once**. Unlike the V3 rail, no per-strategy publish ever happens again — every sealed
vault is a resource on this one module. That is the attack-surface win.

Prerequisites and gotchas:
- Point `deps/decibel_perp_dex` and `deps/decibel_accounts` at the **current** Decibel package
  `0xe7da2794b1d8af76532ed95f38bfdf1136abfd8ea3a240189971988a83101b7f`. The seven existing
  testnet packages bind the old `0x952535…be9f` and cannot be migrated — they are abandoned.
- Set `upgrade_policy = "immutable"` in `Move.toml` before the **mainnet** publish (testnet
  stays upgradeable while iterating). Not set today.
- Lot/min are hardcoded testnet BTC/USD constants (`strategy_vault.move:46-50`). Sealed vaults
  read them per market from creation args instead — pass the real values.

### 8.2 Per-vault launch (3 wallet signatures, no CLI)

1. `vault_api::create_and_fund_vault(...)` — Decibel vault holding depositor funds.
2. `sealed_vault::create_sealed_vault(creator, commitment, attestor_pubkey, vault, market, …)`
   → returns object address `R`.
3. `vault_admin_api::delegate_dex_actions_to(vault, R, expiry)` — **always pass an expiry**.
4. `sealed_vault::seal(creator, sv_addr)` — one-way; freezes commitment, attestor key, market,
   and rule set. The UI should call this as the final launch step so "launched" means "sealed".

### 8.3 Attestor service

Needs: the ed25519 signing key, the committed program, and a Decibel price feed. Runs beside
the crank on Fly (`infra/fly/fly.toml` already has an always-on process model and bakes in the
aptos CLI). Per bar: read mark price → run program → sign → submit `tick_attested`.

The cranker pays gas and contributes nothing else — it cannot alter the signal, and a wrong
signature simply aborts the transaction.

### 8.4 Environment

```bash
SEALED_VAULT_PACKAGE=0x...           # published module address
SEALED_ATTESTOR_PRIVATE_KEY=ed25519-priv-0x...   # attestor only; NOT a trading key
SEALED_ATTESTOR_PUBLIC_KEY=0x...     # cross-checked against on-chain at boot
```

The attestor key holds **no funds and no trading authority**. Losing it stops the vault
trading; it does not put deposits at risk. Rotation requires a new sealed vault by design —
`seal()` is one-way, and that is the point.

## 9. What this does not solve

- **Curator-as-vault-admin can add a second delegate** (`CURATOR-RULES.md` §3.6). Until admin
  custody ships, an adversarial curator can trade around the sealed module. Detection, not
  prevention. This is the single largest remaining hole in the trust story and it is
  independent of everything in this document.
- **Fill quality.** Signals are enforced; slippage, spread and funding are not.
- **Keeper liveness.** If nobody cranks, the vault does not trade. It cannot misfire; it can miss.
