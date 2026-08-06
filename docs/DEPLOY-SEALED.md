# Deploying sealed vaults to production

A step-by-step runbook. Every command here has been run against testnet; every address and
number has been verified against the live chain rather than copied from memory. Where something
has **not** been proven on mainnet, it says so.

Read [SEALED-INDICATOR.md](./SEALED-INDICATOR.md) first if you don't know what a sealed vault is.
This document assumes you do and only covers getting it live.

---

## 0. Where things stand

| | Status |
|---|---|
| Contract on **testnet** | Published & exercised end-to-end — `0xacc35ae1a8a692d2070e0f6f4b7e0969752789300e055f6973f0ec8287f1740c` |
| Contract on **mainnet** | **Not published.** Nothing below has run on mainnet. |
| Prod database | 4 sealed migrations pending (§3) |
| Prod env vars | None of the sealed vars are set — `/api/sealed/config` returns `ready:false` |
| Tick cron | Committed to `vercel.json`, never run in prod |

The app degrades honestly with none of this done: the launchpad shows "Preview mode ·
launching is unavailable" and the primary action renders as disabled. Deploying the frontend
without the rest is safe.

---

## 1. Decide first

Three decisions that are painful to change later.

### 1.1 Network

`NEXT_PUBLIC_DECIBEL_NETWORK` currently reads `mainnet` in `vercel.json`. The sealed feature
follows it. **Recommendation: run the first real vault on testnet**, by overriding this in a
preview deployment, before spending mainnet USDC.

### 1.2 The mainnet publish is irreversible

`sealed:publish --network mainnet` injects `upgrade_policy = "immutable"` into `Move.toml`
before publishing (`scripts/sealed-e2e-deploy.ts` ~line 255). That is deliberate — an
upgradeable "sealed" contract is not sealed, since the publisher could rewrite the rules under
existing depositors. Consequences:

- The published bytecode can **never** be changed. A bug means publishing a new package at a
  new address and migrating vaults.
- Ship only a version you would be happy to never patch. The Move tests must pass and the
  testnet vault should have traded.

### 1.3 Managed attestation is a trust concession

`SEALED_SOURCE_KEY` decrypts every creator's private strategy. Whoever holds production env
access can read their alpha. The UI states this plainly. If you are not comfortable operating
that, don't set the key — creators then self-host their attestor and vaults only trade while
their process runs.

---

## 2. Publish the contract

### 2.1 Prerequisites

```bash
# The aptos CLI is required. The npm wrapper's downloader fails behind proxies; this works:
bash scripts/install-aptos-cli.sh          # installs to ./.aptos-cli/
export APTOS_BIN="$PWD/.aptos-cli/aptos"
```

Confirm the Move package builds and its tests pass **before** touching mainnet:

```bash
cd contracts/strategy-vaults
"$APTOS_BIN" move test --skip-fetch-latest-git-deps \
  --named-addresses cash_strategy=0xCA54,decibel=0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06,order_book=0x5
cd ../..
# Expect: Test result: OK. Total tests: 10; passed: 10; failed: 0
```

### 2.2 Deployer key and funding

The package address **is** the deployer address, and it is permanent.

```bash
# Generate a dedicated deployer, or set SEALED_DEPLOYER_PRIVATE_KEY to an existing funded key.
export SEALED_DEPLOYER_PRIVATE_KEY=ed25519-priv-0x...
```

The publish costs well under 1 APT. Fund the deployer with **~1 APT on mainnet**. The script
gates on 0.4 APT and prints the address to fund if short.

### 2.3 Publish

```bash
pnpm sealed:publish --network mainnet
```

This publishes and calls `init_platform`, then **stops**. It does not create a vault and
spends no USDC.

> Do **not** use `pnpm sealed:e2e run --network mainnet` for this. `run` continues into the
> full pipeline: it creates a real Decibel vault, paying Decibel's 100 USDC protocol fee, the
> 100 USDC seed and our 50 USDC launch fee — 250 USDC of real money, by surprise.

The script is resumable. Its state lives in `.sealed-e2e-mainnet/` (deployer key, attestor key,
addresses). **Back that directory up** — the attestor private key in it is what every vault
you publish will commit to.

Two publish failures cost hours on testnet; both are already fixed, but recognise them:

| Symptom | Cause |
|---|---|
| `Out of gas` on `publish_package_txn` | Needs `--max-gas 2000000`. Already passed. |
| package `larger than 60000 bytes` | Needs `--included-artifacts none`. Already passed. |
| `CONSTRAINT_NOT_SATISFIED`, no detail | A dep stubbed under the wrong **package name**. `0x1::code` resolves deps by package name — `vault`/`vault_read_api` live in `decibel_vault`, not `decibel_perp_dex`. |

### 2.4 Verify

```bash
pnpm sealed:e2e status --network mainnet
```

Then confirm the platform config landed, substituting your package address:

```bash
curl -s https://api.mainnet.aptoslabs.com/v1/view \
  -H 'content-type: application/json' \
  -d '{"function":"<PKG>::sealed_vault::platform_terms","type_arguments":[],"arguments":[]}'
# Expect: ["50000000","<treasury>","<builder>","2"]
#          launch fee (50 USDC)          builder fee (2 bps)
```

If this 404s, the package didn't publish. If it aborts, `init_platform` didn't run.

### 2.5 Confirm the funding sign convention — REQUIRED before a portfolio vault

`portfolio_vault::funding_exceeded` force-closes a leg whose accrued funding has eaten more
than `max_adverse_funding_bps` of its notional. It decides *adverse* from the SIGN of
`position_view_types::get_position_info_unrealized_funding_amount_before_last_update`, reading
negative as "this position owes funding".

That reading is inferred from the accessor's name. The ABI does not state it and Decibel's
source is not public, so it gets checked against reality:

```bash
pnpm decibel:funding-canary --network mainnet 0x<account-with-a-long> 0x<account-with-a-short>
```

Pass any accounts with live perp exposure — the check needs a long and a short on the *same*
market. It confirms the field is directional (opposite signs per side) rather than a magnitude.

**If it reports the convention is inverted**, flip the comparison in `funding_exceeded` and the
note in `deps/decibel_perp_dex/sources/position_view_types.move` before publishing. Inverted,
the module force-closes positions that are being *paid* to stay open: a continuous drain that
looks like a bad strategy rather than a bug. This step does not apply to single-market
`sealed_vault`, which never reads funding.

---

## 3. Database

Four migrations touch sealed vaults. All are **additive** — new tables and nullable columns
with defaults — so they are safe against a live database with existing rows.

| Migration | Adds |
|---|---|
| `20260730000000_add_sealed_vaults` | `SealedVault` table |
| `20260804120000_sealed_managed_attestation` | encrypted-source + tick-health columns |
| `20260804130000_sealed_trades` | `SealedTrade` table |
| `20260804140000_sealed_pending_swap` | `SealedPendingSwap` table |

```bash
pnpm db:migrate:deploy
```

Verify:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'SealedVault' AND column_name LIKE '%ncrypted%';
-- expect encryptedPine, encryptedPineIv, encryptedPineTag

SELECT to_regclass('"SealedTrade"'), to_regclass('"SealedPendingSwap"');
-- both non-null
```

---

## 4. Environment variables

Set in Vercel (Production). Every one was confirmed by grepping `process.env` across the
sealed surface.

### 4.1 Required for launching

| Variable | Value | Missing ⇒ |
|---|---|---|
| `SEALED_VAULT_PACKAGE` | package address from §2 | `config.ready:false`, launch disabled |
| `NEXT_PUBLIC_SEALED_VAULT_PACKAGE` | same value | client can't build payloads |
| `SEALED_ATTESTOR_PUBLIC_KEY` | `0x` + 64 hex, printed by §2 | `config.ready:false` |
| `NEXT_PUBLIC_DECIBEL_NETWORK` | `mainnet` | defaults to testnet |

Set both the server and `NEXT_PUBLIC_` forms of the package address. `lib/sealed-vaults.ts:594`
falls back from one to the other, but the client build only sees `NEXT_PUBLIC_`.

### 4.2 Required for vaults to actually trade

| Variable | Value | Missing ⇒ |
|---|---|---|
| `SEALED_ATTESTOR_PRIVATE_KEY` | ed25519 priv matching the public key above | cron 501s |
| `SEALED_CRANK_PRIVATE_KEY` | ed25519 priv of a **funded** wallet | cron 501s |
| `CRON_SECRET` | random ≥32 chars — **this is what Vercel Cron sends** | cron 401s |
| `CRANK_SECRET` | random ≥32 chars | `/api/sealed/attest` 501s |
| `SEALED_SOURCE_KEY` | `openssl rand -hex 32` — exactly 32 bytes | managed attestation refused |

```bash
openssl rand -hex 32   # SEALED_SOURCE_KEY
openssl rand -hex 32   # CRANK_SECRET
```

> **The single worst configuration trap in this system**, and it shipped: the cron originally
> read only `CRANK_SECRET`, while Vercel Cron sends `CRON_SECRET`. Every other cron in the repo
> reads `CRON_SECRET`. The result was a deployment that reported `ready:true`, let creators
> complete the launch flow and pay, and produced vaults that never placed a single order — with
> the 401s visible only in Vercel's cron logs. Fixed, and `pnpm test:reliability` now fails if
> it regresses.

**`SEALED_SOURCE_KEY` is not recoverable.** Lose it and every managed vault's stored strategy
is undecryptable — those vaults stop trading permanently and creators must relaunch. Store it
like a signing key. A wrong length disables the feature loudly (`sourceVaultAvailable()`
returns false) rather than corrupting anything.

**The attestor keypair must match.** `SEALED_ATTESTOR_PUBLIC_KEY` is committed into every vault
at creation and the vault is sealed at birth, so a mismatched pair is *unrecoverable* — every
tick aborts with `E_INVALID_SIGNATURE` forever and the vault must be relaunched. The two values
sit adjacent in `.env.example` and a public key pasted into the private slot is silently
accepted (32 bytes of hex is 32 bytes of hex). The cron now cross-checks them and refuses to
run on a mismatch; verify before launching anything:

```bash
node -e '
const {Ed25519PrivateKey}=require("@aptos-labs/ts-sdk");
console.log(new Ed25519PrivateKey(process.env.SEALED_ATTESTOR_PRIVATE_KEY).publicKey().toString());
'
# must equal SEALED_ATTESTOR_PUBLIC_KEY exactly
```

The attestor and crank should be **different keys**. The attestor signs; the crank pays gas and
has no authority. Keeping them separate means a compromised gas wallet cannot forge signals.

### 4.3 Optional

**Leave `DECIBEL_VAULT_PACKAGE` unset.** The per-network table in `lib/sealed-vaults.ts` is
correct for both networks and is used when this is empty. Setting it overrides that — and
`.env.example` used to ship it pre-filled with the **testnet** package, so copying that file to
production pinned a mainnet deployment to testnet Decibel. Now commented out.

`SEALED_APP_URL` lets the deploy script auto-register vaults it creates. Its registration is
wrapped in a catch that only logs, so a wrong URL leaves the vault on-chain but **absent from
the registry — and the cron only ticks registry rows, so it never trades.** Check the feed
after any script-created vault.

### 4.4 Two traps in how the network is chosen

1. `NEXT_PUBLIC_DECIBEL_NETWORK` takes **precedence** over `DECIBEL_NETWORK` (inverted from the
   usual "server var wins"). A stale `NEXT_PUBLIC_` value makes the server-only one a no-op.
2. Only the exact string `"mainnet"` selects mainnet. `"Mainnet"`, `"MAINNET"` or a trailing
   space silently selects **testnet** — which picks testnet market params (lot 10000 vs 1000)
   and makes the cron filter `network: "testnet"`, skipping every mainnet vault. Nothing logs.

`NEXT_PUBLIC_*` values are inlined at **build** time, so changing them in the dashboard requires
a redeploy, not just a restart.

---

## 5. Fund the crank wallet

Measured from four real testnet ticks: **0.000186 APT per tick**, all identical.

| Vaults | Per day | Per month |
|---:|---:|---:|
| 1 | 0.27 APT | ~8 APT |
| 10 | 2.7 APT | ~80 APT |
| 100 | 27 APT | ~800 APT |

At a 1-minute cron, cost scales linearly with vault count and is **paid whether or not the
vault trades** — most ticks are no-ops that just advance the digest. Ticks that place orders
cost more.

Fund with at least a month of runway and alert on the balance. **A dry crank fails silently**:
the cron logs a submit error, vaults simply stop trading, and nothing else surfaces it.

If ~800 APT/month at scale is unacceptable, raise the cron interval in `vercel.json` — but note
vaults default to a 60-second `min_bar_interval_s`, so a slower cron means they act on fewer
bars than their strategy assumes.

---

## 6. The cron

> **Where the attestor runs: Vercel Cron. Not fly.io.** The fly.io box
> (`cash-trading-jdma7a`) runs depth capture and the legacy `tick_oracle` crank
> only — it has no attestor process and no Aptos CLI. See MASTER-PLAN WS5.2/5.5
> for why. If you find `scripts/sealed-attestor-runner.ts`, it is a local
> simulate/debug tool, not a deployment target: it drives one vault at a time
> and cannot tick a portfolio vault.

```json
{ "path": "/api/cron/sealed-tick", "schedule": "* * * * *" }
```

Per-minute crons need a Vercel **Pro** plan; Hobby caps at daily. Each firing is an invocation —
43,200/month.

Vercel Cron sends `Authorization: Bearer $CRON_SECRET` — **`CRON_SECRET`, not `CRANK_SECRET`**.
The route accepts either, plus a `?secret=` query param for manual runs. Set `CRON_SECRET`;
without it the scheduled run 401s forever while everything else reports healthy.

```bash
curl -s "https://<your-domain>/api/cron/sealed-tick?secret=$CRANK_SECRET" | jq
# { "ok": true, "considered": N, "ticked": N, "failed": 0, "results": [...] }
```

Behaviour worth knowing:

- **`too soon` is healthy.** A vault whose cadence is slower than the cron reports
  `skipped: "too soon"`. It is never counted as a failure — counting it would back off every
  healthy vault.
- **Failures back off exponentially**, `2^failures` minutes capped at 60, so a broken vault
  doesn't burn gas every minute.
- **Only managed vaults are touched.** Self-hosted ones are the creator's responsibility.
- `maxDuration = 300`, batch capped at 200 vaults. Ticks run **sequentially**, so at ~2s each
  the practical ceiling is roughly 100–150 vaults per firing. Past that, ticks get skipped
  silently. Parallelising the loop is the fix; it hasn't been needed yet.

### Failure modes and how you'd notice

| Failure | Symptom | Detection |
|---|---|---|
| Crank out of gas | vaults stop trading | `results[].error` contains `INSUFFICIENT_BALANCE`; balance alert |
| Pyth price feed down | no signals computed | `stage: "prices"` in results |
| `SEALED_SOURCE_KEY` rotated | every managed vault fails | `decrypt failed` in results |
| Commitment mismatch | one vault stuck | `stage: "commitment"`; `SealedVault.lastTickError` |
| Cron not firing | silence | `SealedVault.lastTickAt` goes stale |
| Wrong cron secret | silence | Vercel cron logs show 401; `lastTickAt` never set |
| Attestor keypair mismatch | every vault silent | cron returns HTTP 500 with the derived vs expected key |

`lastTickAt`, `lastTickSeq`, `tickFailures` and `lastTickError` are written to `SealedVault` on
every run — query them for health rather than scraping logs.

---

## 7. Smoke test before announcing anything

Do this on the target network with real money before telling anyone the product exists.

1. Open `/launchpad`. The preview banner must be **gone** and the button must read "Launch bot".
2. Confirm the cost panel quotes from chain — `economics.termsOnChain` must be `true` in
   `/api/sealed/config`.
3. Launch one vault with the minimum seed, **Private**, **We run it**. Approve three signatures.
4. Verify on chain:

```bash
curl -s "https://<domain>/api/sealed/vaults?network=mainnet" | jq '.vaults[0]'
```

5. Wait ~2 minutes, then confirm it ticked:

```sql
SELECT "strategyVaultAddr","lastTickAt","lastTickSeq","tickFailures","lastTickError"
FROM "SealedVault" ORDER BY "createdAt" DESC LIMIT 1;
```

`lastTickSeq` must be advancing. If it is null after 5 minutes, the cron isn't running or isn't
authorised.

6. Check the track record renders: Invest tab → select the vault → "Track record" panel. With no
   closed trades it must say so rather than showing zeros.
7. Swap the strategy (Manage tab). With only your own money in the vault it should activate
   **immediately** — no 24h notice. That confirms `has_outside_depositors` counts your
   subaccount shares correctly.

---

## 8. Known gaps

Real, and none of them block launching — but don't be surprised by them.

### 8.1 No wallet-signature auth on API routes

`/api/sealed/pending-swap` verifies ownership by checking the registry (the outgoing strategy
must be registered to the claimed creator, and belong to the named vault). That stops writing
garbage into someone else's record. It is **not** authentication: addresses are public, so a
determined griefer could still delete another creator's pending-swap row. Blast radius is a
stale UI card — the swap itself is on-chain and unaffected. Proper fix is signed requests.

### 8.2 Tier-1 attestation only

The vault trusts a bare ed25519 key. If the attestor key leaks, an attacker can sign arbitrary
signals for every vault — bounded by the on-chain rules (market, size, leverage, cadence are
all enforced), but they could still steer positions. Tier 2 (enclave measurement bound at
creation) is designed, not built. **Treat `SEALED_ATTESTOR_PRIVATE_KEY` as the most sensitive
secret in the system.**

### 8.3 Self-hosted vaults have no track record

We record fills from our own tick receipts because Aptos's hosted indexer removed its `events`
table. Vaults we don't attest have no rows, reported as *unavailable* — never as *no trades*.

### 8.4 Performance numbers are pre-cost

`cumulativeReturnPct` compounds per-trade price moves. It excludes leverage, Decibel's
maker/taker fees, our 2 bp builder fee and slippage. The UI labels it as such. It is **not** a
depositor's net return, and shouldn't be presented as one in marketing.

### 8.5 One market in the single-market path

Only BTC/USD is in `SEALED_MARKETS`. Mainnet params verified against the live chain
(lot 1000, min 2000, tick 100000, 1e8 precision) — and note they **differ from testnet**
(lot 10000, min 20000, 1e9), which is exactly the kind of drift that has caused aborts before.

`portfolio_vault` takes its allowlist per vault at creation, so it is not limited to that
table — but every market you put in a vault's allowlist needs its own verified lot / min /
tick, from the same live-chain read, for the same reason.

### 8.5a Portfolio mode is unpublished and untested against a live engine

`cash_strategy::portfolio_vault` compiles, its Move unit tests pass, and its BCS layout is
cross-checked against TypeScript inside the VM. **None of it has run against a real Decibel
engine.** In particular these are unverified end-to-end:

- `public_read_api::view_position` / `get_position_size` / `get_market_round_price_to_ticker` /
  `get_market_round_size_to_lot` — all four are present on the live mainnet ABI with matching
  signatures, but this module has never actually called them.
- The funding sign convention (§2.5).
- Gas cost per tick with a multi-market allowlist. Every market is priced on every bar, so a
  16-market vault does 16 mark-price reads per tick, forever, paid by the crank wallet. Measure
  before setting the crank funding in §5 — the 0.000186 APT/tick figure there is single-market.

Do not launch a portfolio vault with depositor money before a testnet vault has ticked, opened,
force-closed on `max_hold_bars`, and had `force_close_stale` called by an unrelated account.

### 8.6 `sealedRegistryAvailable()` only checks that `DATABASE_URL` is non-empty

A syntactically valid but wrong or unmigrated database passes the gate, so routes return
unhandled 500s instead of the honest 503. Run the §3 verification queries against the database
the app actually points at, not the one you think it does.

### 8.7 Not built

- Two-column launch layout, searchable strategy browser, backtest preview (UX audit #11, #23, #24)
- Parallel ticking for >150 vaults (§6)
- Alerting — health data is in the database, nothing watches it

---

## 9. Rollback

| Situation | Action |
|---|---|
| Frontend bad | Revert the Vercel deployment. Vaults keep trading — the cron is independent. |
| Cron misbehaving | Unset `CRANK_SECRET` → cron 501s immediately. Vaults stop trading but hold positions. |
| A single vault misbehaving | `sealed_vault::set_paused(creator, sv_addr, true)` — instant, creator-only, blocks new ticks without touching the position. |
| Contract bug | **No rollback.** The mainnet publish is immutable. Pause affected vaults, publish a new package, migrate. |
| Key compromise (attestor) | Pause every vault. Rotating the key requires new vaults — the key is sealed into each one at creation. |

Migrations are additive, so a frontend rollback never needs a database rollback.

---

## 10. Command reference

```bash
# Contract
bash scripts/install-aptos-cli.sh && export APTOS_BIN="$PWD/.aptos-cli/aptos"
pnpm sealed:publish --network mainnet     # publish + init_platform, spends no USDC
pnpm sealed:e2e status  --network mainnet # read state back
pnpm sealed:e2e run     --network testnet # FULL pipeline — creates a funded vault

# Database
pnpm db:migrate:deploy

# Tests (all must pass before deploying)
pnpm test:reliability      # invariants across the whole sealed surface
pnpm test:source-vault     # encryption: nonces, tamper, cross-vault, rotation
pnpm test:economics        # re-reads Decibel's limits from BOTH chains
pnpm test:catalog          # every strategy commits; blurbs match their scripts
pnpm test:sealed           # attestation BCS layout vs Move
pnpm test:transpiler       # transpiler rejects what it cannot honestly compile

# Ops
curl -s "https://<domain>/api/cron/sealed-tick?secret=$CRANK_SECRET" | jq
curl -s "https://<domain>/api/sealed/config" | jq '.ready, .economics'
```

## 11. Order of operations

```
 1. pnpm test:reliability && cd contracts/strategy-vaults && aptos move test   # green
 2. Fund deployer with ~1 APT (mainnet)
 3. pnpm sealed:publish --network mainnet                                      # §2
 4. Back up .sealed-e2e-mainnet/                                               # §2.3
 5. pnpm db:migrate:deploy                                                     # §3
 6. Set §4.1 vars → redeploy → /api/sealed/config shows ready:true
 7. Generate SEALED_SOURCE_KEY + CRANK_SECRET, set §4.2 vars                   # §4.2
 8. Fund the crank wallet                                                      # §5
 9. Redeploy → curl the cron manually, expect ok:true                          # §6
10. Smoke test one real vault                                                  # §7
```

Steps 1–5 are reversible. Step 3 is not.
