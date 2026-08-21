# SEALED-INDICATOR.md — private, tamper-proof, on-chain-enforced strategy vaults

> Supersedes the "publish the transpiled strategy as Move bytecode" path for any curator who
> wants to keep alpha private. That path stays available for curators who *want* full public
> verifiability (open-source strategies); this document describes the sealed alternative.
>
> Status: the zero-builder-fee revision is published and initialized on Aptos mainnet at
> [`0x3590…5105`](https://explorer.aptoslabs.com/account/0x3590fbae95f65fd00d01be6bf2d5e0049b5b447e749ed269d8cca744d71b5105/modules?network=mainnet).
> All five modules independently match the local build byte for byte. Publication created no
> vault and spent no USDC; the first funded mainnet vault and directional order remain a separate
> money-moving production check.
> Production runbook: [DEPLOY-SEALED.md](./DEPLOY-SEALED.md).

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

### 3.1 Commit (once, at creation)

```
program_commitment = sha3_256(
    canonical_pine || 0x00 || emitted_move || 0x00 || manifest_json
)
```

`manifest_json` pins transpiler version + options (marketAddr, lot, min, szPow) so emission is
reproducible byte-for-byte. Same formula as `docs/SHELBY-PIN.md` — reuse it, don't invent a
second one. The commitment, attestor key, market binding and risk parameters go on-chain at
creation and cannot be edited in that vault resource. The package authority described in §5 can
still replace compatible execution code. `create_sealed_vault` has no second seal step.

### 3.2 Attest (every bar, off-chain)

The attestor holds an ed25519 key and runs the committed program. It signs a BCS-serialized
struct. Chain state determines every field except the signal and the issuance timestamp; the
contract binds that timestamp to the signature and rejects it once it is stale:

```move
struct Attestation has drop {
    domain:             vector<u8>,   // "cash.trading/sealed-vault/v2"
    chain_id:           u8,
    strategy_vault:     address,
    program_commitment: vector<u8>,
    seq:                u64,          // next on-chain sequence — no accepted-tick replays
    input_digest:       vector<u8>,   // digest through the previous accepted bar
    bar_ts:             u64,          // signed issuance time; expires on-chain
    signal:             u8,
}
```

### 3.3 Verify + execute (on-chain, one small module)

`tick_attested(cranker, sv_addr, bar_ts, signal, signature)`:

1. Enforce the minimum bar interval, reject timestamps more than 60 seconds in the future, and
   reject attestations more than 5 minutes old.
2. Reconstruct the `Attestation` from chain state plus the submitted `bar_ts` and `signal`.
3. `ed25519::signature_verify_strict` against the sealed `attestor_pubkey`. Because `bar_ts` is
   signed, a permissionless cranker cannot move the instruction to a later timestamp.
4. Read mark price **on-chain** via `public_read_api::get_mark_price` — neither the attestor nor
   the cranker supplies it.
5. Append `(price, bar_ts)` to the bounded on-chain trace; update the all-history digest.
6. `seq += 1`.
7. If the signal is a flip: size from NAV, enforce leverage cap, place reduce-only close +
   open via the module's own `ExtendRef` signer.
8. Emit `AttestedTick` (every bar) and `VaultTraded` (on trades).

The signature binds `input_digest` from chain state, `seq` from the module's counter,
`strategy_vault` and `program_commitment` from sealed storage, plus the submitted signal and
timestamp. Price is deliberately absent from the message and is read on-chain only after the
signature verifies. The attestor controls the signal; tier 1 still trusts it to run the
committed program honestly (§6).

### 3.4 Trace

Two on-chain artifacts make the history checkable by anyone:

- **`input_digest`** — a rolling `sha3_256(prev_digest || bar_ts || price)` over every bar the
  module has ever processed. Commits the complete input history in 32 bytes.
- **`seq`** — strictly monotonic with no replays. It proves the order of accepted ticks.
- **timestamps** — expose liveness gaps. The contract enforces a minimum cadence, not a maximum;
  a missing crank cannot make the vault misfire, but it can make the vault miss a trade.

## 4. Why this is not "a middleware bot managing the vault"

The distinction is enforceable, not rhetorical:

| A bot manager can… | The attestor can… |
|---|---|
| Pick any market | Nothing — market is sealed at creation |
| Pick any size | Nothing — size is `nav × pct_bps`, computed on-chain |
| Pick entry price | Nothing — price is the on-chain mark |
| Trade whenever | Only once per `min_bar_interval_s`, on a monotonic seq |
| Skip ticks | Can stop submitting; timestamp gaps remain public |
| Reorder/replay accepted ticks | Nothing — `seq`, digest and signed timestamp bind the order |
| Withdraw funds | Nothing — no funds-movement capability is ever delegated |
| Trade on a whim | Only emit `signal ∈ {neutral, buy, sell}` |

The attestor's entire authority is **one trit per bar**, and every one of them is signed,
sequenced, and bound to an on-chain-derived input digest. It cannot manage the vault; it can
only answer one question the vault asks it.

## 5. Threat model — honest residue

| Threat | Mitigated by | Residual |
|---|---|---|
| Attestor forges the price | Price read on-chain | None |
| Cranker delays a signed signal | Signed `bar_ts` + 5-minute expiry | At most the expiry window |
| Attestor replays an old signal | `seq` + signed `bar_ts` | None |
| Attestor skips an unfavourable bar | Accepted timestamps expose the cadence gap | Detectable, not prevented in tier 1 |
| Attestor trades another market | `market` sealed at creation | None |
| Attestor oversizes | Size computed on-chain from NAV + leverage cap | None |
| Attestor withdraws | No funds-movement delegation | None |
| Curator changes the strategy | `program_commitment` sealed one-way | None |
| Curator adds a second Decibel delegate | **Not fixed here** — needs `CURATOR-RULES.md` §3.6 admin custody | **Real.** Monitor + de-badge |
| **Attestor runs a different program than the one committed** | Nothing, in tier 1 | **Real — the core residue.** See §6 |
| Package upgraded to change rules | The package uses Aptos `compatible` policy because its live Decibel dependencies use that policy. The publish tool verifies all five modules byte-for-byte; the deployer key stays offline | **Real.** A deployer-signed compatible upgrade can change execution logic. Existing vaults cannot protect themselves from that package authority |

**Do not claim more than this.** The tier-1 guarantee is: *the signal came from the holder of
the sealed attestor key, on inputs the chain verified, under rules the chain enforced.* It is
not yet: *the signal is the output of the committed program.*

## 6. Closing the residue — three tiers, same module

The verifier is deliberately swappable. `attestor_pubkey` + signature is tier 1; tiers 2 and 3
change how step 3.3.5 is satisfied and nothing else.

**Tier 1 — bare attestation (ship now).** Trust = "we hold the key honestly." Adequate for
testnet and open beta. Weak, and must be labelled weak in the UI.

**Tier 2 — TEE attestation (next).** Run the strategy inside an AWS Nitro enclave. Bind the
enclave measurement (PCR set) into `program_commitment` at creation, and publish the
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

**Preferred testnet validation: `pnpm sealed:e2e run --network testnet`** — one resumable
command from empty account to live attested ticks (publish → testnet USDC mint → subaccount →
Decibel vault → create → delegate → seal → attest). It is the release gate for the exact
checkout that will go to mainnet.

**Mainnet package deployment: `pnpm sealed:publish --network mainnet`**, with the explicit
compatible-publish confirmation documented in [DEPLOY-SEALED.md](./DEPLOY-SEALED.md). It stops
after publishing, exact bytecode verification and `init_platform`; it does not spend USDC or
create a vault. Do not substitute the full `sealed:e2e run` command on mainnet: that path creates
and funds a real vault and costs 250 USDC, so the tool requires a second spending confirmation.

`verify-markets` re-reads lot/min/szDecimals from both chains and fails on drift. The Aptos CLI
installs via `scripts/install-aptos-cli.sh`; CI compiles the package and runs the Move tests on
every push. The manual sequence below remains for reference.

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
- Mainnet uses Aptos `compatible` policy. Decibel's imported packages use policy 1, and Aptos
  rejects an immutable dependent package with `EDEP_WEAKER_POLICY`. The supported
  `sealed:publish` command copies the package into its protected state directory, injects the
  compatible policy, publishes, recompiles at the final address, and compares every module
  byte-for-byte with the fullnode response. Keep the deployer key offline after release. Do not
  use the manual command above for mainnet.
- Lot/min are hardcoded testnet BTC/USD constants (`strategy_vault.move:46-50`). Sealed vaults
  read them per market from creation args instead — pass the real values.

### 8.2 Per-vault launch (3 wallet signatures, no CLI)

1. `vault_api::create_and_fund_vault(...)` — Decibel vault holding depositor funds. Costs the
   100 USDC protocol fee plus the initial funding, both drawn from the creator's Decibel
   subaccount (not their wallet). `fee_bps = 1000`, `fee_interval_s = 2_592_000`;
   `delegate_to_creator = false`, so no human is ever a delegate.
2. `sealed_vault::create_sealed_vault(creator, commitment, attestor_pubkey, vault, market, …,
   enclave_measurement)` → returns object address `R`. **This call seals the vault resource**:
   the commitment, attestor key, market binding and stored limits cannot be edited after it
   returns. The compatible package authority remains the trust limit described in §5.
3. `vault_admin_api::delegate_dex_actions_to(vault, R, expiry)` — **always pass an expiry**.
   Until this lands the vault cannot place an order, which is why it is last: no step before it
   grants any trading authority.

Automated vault orders currently carry no builder fee. Decibel checks builder approval against
the vault's primary trading subaccount; the strategy object's signer cannot approve that separate
identity through the current public API. The contract locks its automated builder fee to zero and
the cranker preflights older positive-fee vaults before signing. Direct user orders keep their
separate 10 bp builder fee because users can approve their own subaccounts.

**Why three signatures and not one.** Decibel declares both `create_and_fund_vault` and
`delegate_dex_actions_to` as `private entry` (verified against the live mainnet ABI). A
`private entry` function is unreachable from any other Move module *and* from a transaction
script, so neither can be composed into one of our entry points or batched into a single
script. On top of that, the vault object address is not derivable — it exists only in the
writeset of step 1 — so steps 2 and 3 cannot be built until step 1 has landed. Three is the
floor the protocol permits, not an implementation shortcut.

**Why sealing happens at creation.** An earlier design had a separate one-way `seal()` as step
4. That was a footgun in both directions: between create and seal the rule set was mutable and
the vault was untradeable, and `seal()` would happily freeze a vault whose delegation had
failed — permanently bricking it with no recovery. Sealing at birth is strictly stronger (no
mutable window exists at all) and strictly safer: an undelegated vault simply cannot trade
until the delegation lands, which is recoverable. `set_sizing` was removed with it; sizing is
part of the sealed rule set and is chosen at creation.

The UI drives all three from one button (`components/sealed/SealedLaunch.tsx`) and is
resumable — each completed step's address is retained, so a rejected signature restarts from
the first incomplete step rather than paying for a second Decibel vault.

### 8.2b Swapping the strategy

The launch fee is charged once per DECIBEL VAULT (`LaunchLicenses`, keyed by vault address), so
re-pointing a vault at a new indicator costs gas alone. A swap is:

1. `create_sealed_vault` against the same Decibel vault — free, and flagged `is_swap`.
2. `vault_admin_api::revoke_dex_actions_delegation(vault, [old])`
3. `vault_admin_api::delegate_dex_actions_to(vault, new, expiry)`

**The notice period.** A replacement strategy may not trade a vault that holds other people's
money until it has been publicly announced (`announce_swap`, which emits `SwapAnnounced`) for
24h — and the announcement expires after 7 days. Three properties make this real rather than
decorative:

- **It gates the TRADE, not the delegation.** `delegate_dex_actions_to` is a Decibel `private
  entry`; this module can neither hook nor observe it. A creator can hand a replacement
  strategy trading rights at any moment — what they cannot do is make it place an order.
  Enforcement lives in `tick_attested`, which is ours.
- **It applies only when someone else's money is present.** The first strategy on a vault is
  what depositors bought into and is never gated; a creator alone in their own vault iterates
  instantly. `has_outside_depositors` counts the creator's shares in BOTH their wallet and
  their Decibel subaccount — `create_and_fund_vault` pays shares to the subaccount, and
  counting only the wallet made every vault look like it had depositors.
- **The announcement expires.** Without `ANNOUNCE_VALIDITY_SECS` a creator could announce while
  the vault was still empty, wait for deposits, and activate instantly months later on an
  announcement that was technically satisfied.

24h is meaningful because vaults launched by this rail set `contribution_lockup_duration_s = 0`
and allow synchronous redemptions — a depositor who dislikes the new algo can leave
immediately, so the window is a real exit rather than a formality. A creator who needs to stop
a bad algo *now* uses `set_paused`, which is instant and always available.

Verified adversarially on testnet (`scripts/swap-security-test.ts`): a swap with no outside
depositors trades immediately; the same swap after a real outside deposit aborts even when
fully delegated, and still aborts after announcing until the 24h has elapsed.

### 8.3 Attestor service

Needs: the ed25519 signing key and the committed program. Per bar: read the contract's bounded
price trace (through the previous accepted tick) → run the program → sign that exact
sequence and digest → submit `tick_attested`. The contract then reads the new mark price,
appends it, and executes the already-signed prior-history decision. The attestor never rebuilds
the signed input from a separate price feed.

**Who holds the program.** This is the load-bearing question, not an implementation detail. A
vault does nothing until something runs its committed strategy every bar, and that something
needs the source. Two arrangements exist:

| | Managed (`managedAttestation = true`) | Self-hosted |
|---|---|---|
| Who runs it | `/api/cron/sealed-tick`, every minute | The creator |
| Where the source lives | AES-256-GCM in `SealedVault.encryptedPine`, key in `SEALED_SOURCE_KEY` | Only the creator's machine |
| Can we read it | **Yes** — the attestor holds the key | No |
| Vault trades when | Always | Only while the creator's process runs |

Managed custody is a real trust concession, not a cryptographic guarantee, and the UI says so
in those words. A database dump alone reveals nothing (the key is not in the database and the
vault address is bound in as AAD, so a row swap fails closed), but an operator with production
access can decrypt a creator's alpha. Tier 2 (§4) is what removes us from that equation: the
enclave holds the key and its measurement is bound into the vault at creation.

Both paths run the SAME code — `lib/sealed-tick.ts` — because two implementations of the
signing path is how a cron quietly starts signing something the manual endpoint would have
refused. It refuses to sign when the supplied source does not reproduce the vault's on-chain
commitment, when the vault is not sealed, when the committed trace is malformed, when the trace
changes during evaluation, or when the evaluator cannot execute the whole committed program.

`E_BAR_TOO_SOON` is the normal state of a vault whose cadence is slower than the cron and is
never counted as a failure; a genuinely failing vault backs off exponentially rather than
burning gas every minute.

### 8.3b Track record

`GET /api/sealed/vaults/:addr/performance` rebuilds a vault's record: bars processed, closed
round trips, win rate, compounded return and max drawdown.

Aptos's hosted indexer removed its `events` table, so `VaultTraded` cannot be queried after the
fact. We are the party submitting every managed tick, though, so fills are read out of our own
transaction receipt and persisted to `SealedTrade` — a cache of on-chain facts, each row
re-derivable from its `txHash`. Self-hosted vaults therefore have no rows, which the endpoint
reports as *unavailable*, never as *no trades*, unless their keeper submits through
`POST /api/sealed/attest`. That server endpoint sees the confirmed receipt and persists it with
the same path as the managed cron; a fully standalone keeper does not.

For managed single-market vaults, those receipt rows and `SealedVault.lastTickSeq` are committed
in one idempotent database transaction. A Neon failure after Aptos confirms the trade is surfaced
as a `persistenceWarning` with the transaction hash in the authenticated cron result and logs;
it is never discarded as a clean success.

Returns are per-trade price moves before leverage, fees and slippage — not the vault's net
return to depositors. The UI says that verbatim.

The cranker pays gas and contributes nothing else. It cannot alter the signal or its signed
timestamp, and an expired or wrong signature aborts the transaction.

### 8.4 Environment

```bash
SEALED_VAULT_PACKAGE=0x...           # published module address
SEALED_ATTESTOR_PRIVATE_KEY=ed25519-priv-0x...   # attestor only; NOT a trading key
SEALED_ATTESTOR_PUBLIC_KEY=0x...     # cross-checked against on-chain at boot
```

The attestor key holds **no funds and no trading authority**. Losing it stops the vault
trading; it does not put deposits at risk. Rotation requires a new sealed vault by design —
the seal is set at creation and never writable again, and that is the point.

## 9. What this does not solve

- **Curator-as-vault-admin can add a second delegate** (`CURATOR-RULES.md` §3.6). Until admin
  custody ships, an adversarial curator can trade around the sealed module. Detection, not
  prevention. This is the single largest remaining hole in the trust story and it is
  independent of everything in this document.
- **Fill quality.** Signals are enforced; slippage, spread and funding are not.
- **Keeper liveness.** If nobody cranks, the vault does not trade. It cannot misfire; it can miss.
