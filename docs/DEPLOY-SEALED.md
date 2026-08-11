# Deploying sealed vaults to production

A step-by-step runbook. The current contract revision is published and initialized on Aptos
mainnet. It was independently recompiled at the published address and every module matched the
on-chain bytecode exactly. Every address and number below is read from the live chain rather
than copied from memory. Where something has **not** been proven, it says so.

Read [SEALED-INDICATOR.md](./SEALED-INDICATOR.md) first if you don't know what a sealed vault is.
This document assumes you do and only covers getting it live.

---

## 0. Where things stand

| | Status |
|---|---|
| Contract on **testnet** | **Current zero-builder-fee checkout still needs a fresh directional proof.** The preceding package at `0x4ad6f9f4f650bf26417255db304c5131b94136ea63063fef176bb2c515c7c0e9` completed creation, delegation and three neutral ticks, then exposed the builder-identity bug on its first forced buy. See §0.1. |
| Contract on **mainnet** | **Published and initialized.** Package [`0x3590…5105`](https://explorer.aptoslabs.com/account/0x3590fbae95f65fd00d01be6bf2d5e0049b5b447e749ed269d8cca744d71b5105/modules?network=mainnet); publish [`0x19ee…c6b`](https://explorer.aptoslabs.com/txn/0x19ee80346da94d44a13434808656b2047802ab1737577ad0a69dc62d18da5c6b?network=mainnet); platform init [`0x1e50…611`](https://explorer.aptoslabs.com/txn/0x1e50ab268a3d3732e5a772897d59d713c111818130616306ab3e6b6ac19e4611?network=mainnet). No vault was created and no USDC was spent during publication. |
| Automated-vault builder fee | **Locked to 0 bp.** Decibel validates approval against the vault's actual trading subaccount, which a delegated strategy cannot approve through the current public API. Direct user orders still use the separately configured 1 bp builder fee. See §8.5b. |
| Prod database | **Current.** All 18 repository migrations were applied and verified on 2026-08-11 (§3). |
| Prod env vars | The package, public attestor, managed attestor, cranker, source-encryption key and cron secret are configured for the next production build (§3). `/api/sealed/config` is the live readiness probe. |
| Tick cron | Scheduled in `vercel.json`; intentionally inert until the sealed package, keys and registry are ready |

The current checkout uses the v2 attestation layout, which binds the submitted bar timestamp
and expires signed instructions on-chain. Every earlier testnet package used v1 and is historical
evidence only. The package publish and platform initialization are proven on mainnet; no funded
mainnet vault has been created, so the first funded launch and directional order remain a separate
money-moving production check.

The app degrades honestly when production configuration is incomplete: the launchpad shows
"Preview mode · launching is unavailable" and the primary action renders as disabled. The live
readiness endpoint also checks that `platform_terms` exists before enabling launch.

### 0.1 Mainnet release evidence

The package was published from a dedicated mainnet deployer on 2026-08-11 with Aptos compatible
upgrade policy. A second clean compile at the final address matched all five modules byte for
byte:

| Module | SHA-256 prefix |
|---|---|
| `math_lib` | `aee9afc62c7ca1e3` |
| `indicator` | `8af44bc1da40c7cc` |
| `sealed_vault` | `20e4ed03dd10e3a9` |
| `strategy_vault` | `4dc72ae2572ed22b` |
| `portfolio_vault` | `c12dfe2767e86a6a` |

The live `platform_terms` view returns a 50 USDC launch fee, treasury and builder address
`0x69d3…39fa`, and an automated-vault builder fee of 0 bp. The package registry reports policy
`1` (`compatible`) and upgrade number `0`.

### 0.2 Previous testnet release evidence and the directional failure

The 2026-08-11 run began with a fresh deployer and no package state. It published the preceding
positive-builder-fee revision,
verified the bytecode, initialized platform terms, minted test USDC, created and funded a real
Decibel testnet vault, created and sealed a strategy vault, delegated it, stored the manifest,
and submitted three signed attested ticks. The final on-chain state was `sealed=true`,
`seq=3`, `trades=0`; neutral warm-up signals correctly placed no order.

- Package: [`0x4ad6…c0e9`](https://explorer.aptoslabs.com/account/0x4ad6f9f4f650bf26417255db304c5131b94136ea63063fef176bb2c515c7c0e9/modules?network=testnet)
- Publish: [`0xf1b171…4975`](https://explorer.aptoslabs.com/txn/0xf1b171ead28c009bd35dd69e306f64627d63f3502bd1d8ec0cecc69fbe084975?network=testnet)
- Platform initialization: [`0x3d4564…681e`](https://explorer.aptoslabs.com/txn/0x3d45643e48d3865630309d643258cc9cf03a2e9e802f4b324c3103b78f20681e?network=testnet)
- Decibel vault: [`0x90d7…99ea`](https://explorer.aptoslabs.com/account/0x90d7ce26226aeb7e4bb80a8d8b7837839afa10ddac7392200ec0ccf6793199ea?network=testnet)
- Sealed strategy vault: [`0x2cf1…22d4`](https://explorer.aptoslabs.com/account/0x2cf1857c0d644ecf0021bf2176db14fdc0e458919b630f74c0f06680aacb22d4?network=testnet)
- Create and seal: [`0x243dad…9d5d`](https://explorer.aptoslabs.com/txn/0x243dad4c0cf4aa25e833b90b87128d19134ad3dcf6c0c0e44ba575d1d7a29d5d?network=testnet)
- Delegate: [`0x2eaffe…d2d2`](https://explorer.aptoslabs.com/txn/0x2eaffe4223121080d042d0143758ba186d527e03102f241ff9dcbf7852ffd2d2?network=testnet)
- Attested ticks: [`seq 0`](https://explorer.aptoslabs.com/txn/0x9521d9a5b8a7f50326bec4a27a488e69d5cff928730864f98b072454fa1ce14e?network=testnet), [`seq 1`](https://explorer.aptoslabs.com/txn/0x3e944b4ce7da6aa99f4f4c77e24f6b1b79f65c709f37b806e9e6aa851ff936df?network=testnet), [`seq 2`](https://explorer.aptoslabs.com/txn/0xd2234a9271d6fc5f5531424230b913b70b9f24255ecaf490fc8cc2febbfe4d22?network=testnet)

Independent local/on-chain SHA-256 prefixes were identical for every module in that preceding
revision:
`math_lib 8384122af805f753`, `indicator 4af0ab05ed6c8184`,
`sealed_vault 6283b660724340c4`, `strategy_vault 4eb9157e5b3e050e`, and
`portfolio_vault f8dd51151e8c62c7`. This supersedes the legacy `0xacc35a…1740c`
package, whose `portfolio_vault` does not match the current checkout.

The neutral ticks proved the committed runner and attestor path, but did not exercise Decibel's
order validation. A forced buy then aborted with
`builder_code_registry::EBUILDER_NOT_REGISTERED(0x2)`. The strategy object had approved the
builder; Decibel checked the separate primary subaccount owned by the vault. The current source
removes that invalid approval, locks automated fees to zero, and preflights legacy positive-fee
vaults against the actual subaccount before signing. A fresh buy/sell testnet run is the remaining
release gate.

To exercise the order plumbing deterministically, the deploy tool accepts
`--test-signal buy|sell|neutral` **only on testnet**. It records those ticks as
`source:"test-override"`; it does not pretend the committed strategy emitted them. The flag is
parsed before state or key material and is unconditionally rejected outside testnet.

---

## 1. Decide first

Three decisions that are painful to change later.

### 1.1 Network

`NEXT_PUBLIC_DECIBEL_NETWORK` currently reads `mainnet` in `vercel.json`. The sealed feature
follows it. **Recommendation: run the first real vault on testnet**, by overriding this in a
preview deployment, before spending mainnet USDC.

### 1.2 The mainnet package uses Aptos compatible policy

The sealed package imports Decibel's live mainnet modules. Those packages use Aptos upgrade
policy 1 (`compatible`). Aptos rejects an immutable package that depends on them with
`0x1::code::EDEP_WEAKER_POLICY`, so `sealed:publish --network mainnet` explicitly injects
`upgrade_policy = "compatible"` into its protected package copy.

Consequences:

- Aptos only permits backward-compatible upgrades, signed by the deployer. The deployer key is
  therefore a package upgrade authority and must stay offline after release.
- Ship only after the Move tests and exact-address preflight pass. Any later upgrade needs the
  same review, compilation, tests, publish guard and bytecode verification as the first release.
- The publish tool compiles at the final package address and compares all five local `.mv`
  modules byte-for-byte with the fullnode response before it records the package or initializes
  platform terms. A mismatch stops the pipeline.
- Mainnet mutation is blocked unless the operator supplies the exact confirmation phrase shown
  in §2.3. The guard runs before state or key files are created.

### 1.3 Managed attestation is a trust concession

`SEALED_SOURCE_KEY` decrypts every creator's private strategy. Whoever holds production env
access can read their alpha. The UI states this plainly. If you are not comfortable operating
that, don't set the key — creators then self-host their attestor and vaults only trade while
their process runs.

### 1.4 Four keys, four jobs — all fresh for mainnet

An Aptos address is derived from its keypair, **not from the network**. The same key gives the
same address string on testnet and mainnet; only the accounts are separate. So there is no such
thing as "the testnet address" of a role — there is one address per role, and the question is
only whether that keypair is fresh.

Treat every development or testnet key as burned. Production roles require separate keys that
have never appeared in logs, transcripts, shell arguments or committed files. The mainnet
deployer and attestor used for the release above were generated locally into ignored, mode-0600
files; only their public addresses are recorded here. Generate each production role separately:

| Role | Where it lives | What it does | Compromise means |
|---|---|---|---|
| **Deployer / admin** | cold — signs a handful of times, ever | Publishes or compatibly upgrades the package (its address **is** `@cash_strategy`), and is the only account `init_platform` / `set_platform_config` accept | Attacker can change future compatible bytecode and platform terms. Existing vault resources keep their stored terms, but upgraded code can change how those resources are interpreted. Keep this key offline (§1.2) |
| **Treasury** | cold, ideally hardware | Receives the one-time launch fee. The automated-vault package cannot charge a builder fee. | Launch revenue theft only |
| **Attestor** | hot — Vercel env, `SEALED_ATTESTOR_PRIVATE_KEY` | Signs one bounded action per bar. Its public key is sealed into every vault at birth | Attacker can steer trades **within** the frozen bounds: market allowlist, per-leg and aggregate leverage, max positions, bar cadence, max-hold. Cannot withdraw, cannot exceed caps, cannot unseal |
| **Cranker** | hot — Vercel env, `SEALED_CRANK_PRIVATE_KEY` | Submits the tick transaction and pays gas. No authority whatsoever | Attacker gets a gas wallet. Signals are verified against the attestor pubkey on chain |

Rules that follow from the table:

- **Never reuse one key for two roles.** Deployer = admin is already a doubling-up the contract
  forces on us; don't add more. Attestor ≠ cranker is enforced by §4.2's guidance and is the
  reason a stolen gas wallet can't forge signals.
- **Treasury ≠ deployer.** The treasury accumulates launch revenue; it should never be an
  account whose key ever touched a server.
- The deployer is cold **but not disposable** — losing it means no future `set_platform_config`,
  so back it up the way you back up the attestor key.
- The two hot keys are the only ones that go in Vercel. If either leaks, rotating the cranker is
  trivial; rotating the **attestor is not** — its pubkey is frozen into every live vault, so a
  rotation means relaunching every vault. Treat it accordingly.

Generate them separately, and write down which is which before funding anything:

```bash
for role in deployer treasury attestor cranker; do
  aptos key generate --output-file "mainnet-$role.key" --assume-yes
done
```

Fund a fresh deployer with at least 2.5 APT (§2.2) and fund the cranker (§5). The treasury and
attestor need no APT. The treasury never submits a transaction from this system, and the attestor
only signs off-chain.

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
# Expect: Test result: OK. Total tests: 20; passed: 20; failed: 0
```

### 2.2 Deployer key and funding

The package address **is** the deployer address, and it is permanent.

```bash
# Generate a dedicated deployer, or set SEALED_DEPLOYER_PRIVATE_KEY to an existing funded key.
export SEALED_DEPLOYER_PRIVATE_KEY=ed25519-priv-0x...

# Required on mainnet. This cold Aptos address receives the one-time 50 USDC launch fee.
# The deployer is never used as an implicit mainnet revenue recipient.
export SEALED_TREASURY_ADDRESS=0x...

# Automated vault orders must omit the builder fee until Decibel exposes a public approval
# path for a vault's actual primary trading subaccount. The deploy tool rejects any other value.
export SEALED_VAULT_BUILDER_FEE_BPS=0

# Optional compatibility/audit stamp stored in platform and vault state. It receives no
# automated-order revenue while the fee is zero. When omitted it equals the treasury address.
export DECIBEL_BUILDER_ADDRESS=0x...
```

Before loading the deployer key into the publish command, run the read-only preflight with its
public address:

```bash
pnpm sealed:preflight-mainnet --package 0x<fresh-deployer-address>
```

It checks the Aptos CLI, chain ID, Decibel market parameters, native USDC metadata, mainnet
platform economics, exact-address compatible Move compilation/tests, existing package bytecode (if any),
and the APT balance. It does not read deployment state, load or create a key, sign, or submit a
transaction. Every line must report `PASS` before publishing.

The eventual publish fee is well under 1 APT, but Aptos validates the transaction against the
CLI's 2,000,000-unit maximum-gas ceiling before submission. A clean-room publish funded with
1 APT fails that validation. Fund a fresh deployer with **at least 2.5 APT on mainnet**. The
script enforces that fresh-publish reserve, then drops to a 0.4 APT gate after a package exists
so an interrupted setup remains resumable.

The deploy tool passes the publisher key through a temporary mode-`0600` file and removes it
after the CLI exits. It never places the mainnet key in the process argument list. Its state
directory and files are also forced to mode `0700` and `0600` respectively.

### 2.3 Publish

```bash
pnpm sealed:publish --network mainnet \
  --confirm-mainnet PUBLISH_COMPATIBLE_SEALED_VAULTS_ON_APTOS_MAINNET
```

This publishes and calls `init_platform`, then **stops**. It does not create a vault and
spends no USDC.

If this package address already has platform terms, the tool verifies the launch fee, treasury,
builder address and builder fee exactly. A mismatch aborts the deployment; it never continues
with stale terms or silently redirects revenue.

> Do **not** use `pnpm sealed:e2e run --network mainnet` for this. `run` continues into the
> full pipeline: it creates a real Decibel vault, paying Decibel's 100 USDC protocol fee, the
> 100 USDC seed and our 50 USDC launch fee — 250 USDC of real money. The tool requires a
> separate `SPEND_250_USDC_ON_MAINNET_SEALED_E2E` confirmation for that path, but package
> deployment should still use `sealed:publish`.

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
pnpm sealed:e2e verify-package --network mainnet --package 0x<package-address>
```

`verify-package` recompiles the current checkout at the exact published address, hashes the
local and on-chain bytes for each module, and exits nonzero on any mismatch or missing module.
The publish command runs this check automatically before `init_platform`; the standalone command
is the repeatable release/audit check. It must report `MATCH` for `math_lib`, `indicator`,
`sealed_vault`, `strategy_vault`, and `portfolio_vault`.

Then confirm the platform config landed, substituting your package address:

```bash
curl -s https://api.mainnet.aptoslabs.com/v1/view \
  -H 'content-type: application/json' \
  -d '{"function":"<PKG>::sealed_vault::platform_terms","type_arguments":[],"arguments":[]}'
# Expect: ["50000000","<treasury>","<builder-stamp>","0"]
#          launch fee (50 USDC)                 automated builder fee (0 bp)
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

Six migrations touch sealed vaults. All are **additive** — new tables and nullable columns
with defaults — so they are safe against a live database with existing rows.

| Migration | Adds |
|---|---|
| `20260730000000_add_sealed_vaults` | `SealedVault` table |
| `20260804120000_sealed_managed_attestation` | encrypted-source + tick-health columns |
| `20260804130000_sealed_trades` | `SealedTrade` table |
| `20260804140000_sealed_pending_swap` | `SealedPendingSwap` table |
| `20260805000000_sealed_portfolio_mode` | `vaultKind`, `marketNames` (the ordered allowlist) |
| `20260806000000_sealed_vault_retirement` | `retiredAt` / `retiredBy` — **the tick cron filters on these** (§8.5c) |

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

SELECT column_name FROM information_schema.columns
WHERE table_name = 'SealedVault' AND column_name IN ('retiredAt','retiredBy');
-- expect both. Without them the tick cron's working-set query fails outright, which is the
-- loud failure; the quiet one is running the app against a database missing them and having
-- every swap leave its vault dark (§8.5c).
```

---

## 4. Environment variables

Set in Vercel (Production). Every one was confirmed by grepping `process.env` across the
sealed surface.

### 4.1 Required for launching and registering

| Variable | Value | Missing ⇒ |
|---|---|---|
| `SEALED_VAULT_PACKAGE` | package address from §2 | `config.launchReady:false` |
| `NEXT_PUBLIC_SEALED_VAULT_PACKAGE` | same value; compatibility mirror | older tooling can build against the wrong package |
| `SEALED_ATTESTOR_PUBLIC_KEY` | `0x` + 64 hex, printed by §2 | `config.launchReady:false` |
| `DATABASE_URL` | migrated production registry | the launched vault cannot enter the cron working set |
| `NEXT_PUBLIC_DECIBEL_NETWORK` | `mainnet` | defaults to testnet |

Set both forms of the package address to the same value. The server value is authoritative and
`/api/sealed/config` serves the normalized address to the client; the public mirror remains for
deployment tooling and older builds.

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

`/api/sealed/config` deliberately exposes three separate signals:

- `launchReady`: the package, public key and registry are valid.
- `managedReady`: the matching signer, cranker, encrypted-source key and Vercel cron are also
  configured.
- `ready`: currently equals `managedReady`, because managed execution is the default launch
  mode. This fails closed until the full product can trade; it no longer sells an on-chain vault
  that the scheduler cannot run. The endpoint cannot prove that the cranker wallet holds APT, so
  the funded-wallet check in §5 remains mandatory.

`launchReady` also requires a successful live read of
`<SEALED_VAULT_PACKAGE>::sealed_vault::platform_terms`. A well-formed address is not proof that
the package was published or that `init_platform` landed. The first `decibel-vault` payload
repeats this check before it returns a transaction for the creator to sign, because that step
charges Decibel's protocol fee and seeds the vault. If Aptos RPC or the sealed package is
unavailable, launch fails closed before any funds are spent.

`POST /api/sealed/vaults` repeats this gate for managed source registration and also requires the
on-chain attestor key to equal the configured platform key. A stale or custom client therefore
cannot place an impossible-to-sign vault into the cron working set.

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
# { "ok": true, "degraded": false, "considered": N, "ticked": N,
#   "failed": 0, "persistenceWarnings": 0, "results": [...] }
```

Behaviour worth knowing:

- **`too soon` is healthy.** A vault whose cadence is slower than the cron reports
  `skipped: "too soon"`. It is never counted as a failure — counting it would back off every
  healthy vault.
- **Failures back off exponentially**, `2^failures` minutes capped at 60, so a broken vault
  doesn't burn gas every minute.
- **Only managed vaults are touched.** Self-hosted ones are the creator's responsibility.
- **Confirmed single-market fills and the vault cursor commit together.** Receipt replay is
  idempotent. If Neon rejects the transaction after the Aptos transaction succeeds, the cron
  still returns HTTP 200 so Vercel does not replay every vault, but sets `degraded: true`, adds
  `persistenceWarning` beside the affected transaction hash, increments
  `persistenceWarnings`, and writes the full error to Vercel logs.
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
| Neon write fails after Aptos succeeds | chain trade exists but local analytics lag | `degraded: true`, `persistenceWarnings > 0`, transaction hash in `results[]` and Vercel logs |

`lastTickAt`, `lastTickSeq`, `tickFailures` and `lastTickError` are written to `SealedVault` on
every persisted run. Query them for normal health, and alert on `degraded` or
`persistenceWarnings` so a database outage cannot masquerade as a clean tick.

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
maker/taker fees and slippage. Automated vault orders currently carry no builder fee. The UI
labels the series as pre-cost. It is **not** a depositor's net return and should not be presented
as one in marketing.

### 8.5 One market in the single-market path

Only BTC/USD is in `SEALED_MARKETS`. Mainnet params verified against the live chain
(lot 1000, min 2000, tick 100000, 1e8 precision) — and note they **differ from testnet**
(lot 10000, min 20000, 1e9), which is exactly the kind of drift that has caused aborts before.

`portfolio_vault` takes its allowlist per vault at creation, so it is not limited to that
table — but every market you put in a vault's allowlist needs its own verified lot / min /
tick, from the same live-chain read, for the same reason.

### 8.5a Portfolio mode — PROVEN on the live testnet engine

`pnpm test:portfolio-cleanroom` builds a whole stack from nothing (fresh account → minted USDC
→ package published at a fresh address → `init_platform` → subaccount → Decibel vault →
portfolio vault → delegate → tick) and a portfolio vault **placed four real orders across four
live markets in one attested tick**:

```
ok   tick  seq 0, 4 action(s)
       BTC/USD side=2 20% @ 2x     PortfolioTraded  market 0 SELL size=310000  px=64270000000
       ETH/USD side=1 20% @ 2x                      market 1 BUY  size=1050000 px=1902500000
       SOL/USD side=2 20% @ 2x                      market 2 SELL size=2720000 px=73190000
       APT/USD side=1 20% @ 2x                      market 3 BUY  size=3360000 px=596500
get_positions ["0x00010203",[false,true,false,true],…]   4 legs, long AND short simultaneously
get_trace     4 prices / 4 markets per row
```

That single run verifies, against the real engine: multi-market trading, simultaneous long and
short legs, multiple open positions, script-declared sizing and leverage (20% @ 2x came from
`default_qty_type=percent_of_equity` + `margin_long/short=50`), the multi-market price fold,
per-market lot/tick rounding on four markets with **different** size precisions,
`view_position` / `get_position_size` / `get_market_round_price_to_ticker`, permissionless
`force_close_stale`, `is_swap` deriving `false` on a fresh vault and `true` on the second
strategy, and **no launch fee on the second launch** — the free-algo-swap promise, confirmed on
chain.

Bugs it found, all fixed: the `PositionViewInfo` stub's abilities (publish-time
`TYPE_MISMATCH`), an empty `input_digest` that made bar zero unsignable for every vault, a
hex-encoded `vector<u8>` read as an array, and `is_swap` being caller-asserted. A later forced
single-market buy found the separate builder-identity failure described below.

**Still unproven:** the max-hold and adverse-funding force-closes (both need a position held
across many bars), gas per tick at 16 markets, and the funding sign convention (§2.5).

---

### 8.5b Builder-code identity invariant

Decibel requires the trading subaccount charged by a fee-bearing order to approve the builder
address and maximum fee first. Without that exact `(subaccount, builder)` approval, the order
aborts with:

```
Move abort in …::builder_code_registry: EBUILDER_NOT_REGISTERED(0x2)
```

The name means the approval pair is absent. It does not refer to a Decibel-admin builder
allowlist. The registry stores a global cap and per-subaccount approvals.

The critical identity is the Decibel vault resource's `portfolio.dex_primary_subaccount`.
`perp_engine_api::approve_max_fee(&strategy_object_signer, ...)` approves the strategy object,
which is not that trading subaccount. The order still fails. Decibel's public
`dex_accounts_entry::approve_max_builder_fee_for_subaccount` path is owner-scoped; a delegated
strategy cannot use it to approve a subaccount owned by the vault.

The current automated-vault package therefore enforces `builder_fee_bps == 0` and omits the
Builder Code from every order. The deployment tool rejects a nonzero
`SEALED_VAULT_BUILDER_FEE_BPS`. Direct cash.trading orders are separate: the connected user can
approve the app's 1 bp fee for their own subaccount, so those orders keep builder revenue.

The cranker also protects legacy positive-fee vaults. Before signing any directional tick, it
reads the frozen builder terms, resolves the Decibel vault's actual primary subaccount, and calls
`builder_code_registry::get_approved_max_fee`. A missing, undersized or mismatched approval is a
permanent `builder-preflight` failure. The cranker does not sign or spend gas retrying it. A legacy
vault can only proceed when the actual subaccount already has enough approval.

### 8.5c 🚨 Two strategy vaults on one Decibel vault corrupt each other

Reproduced on testnet. Two `portfolio_vault` objects were delegated to the same Decibel vault.
They share **one** trading subaccount, so the engine holds a single NET position per market:

```
vault A opened  BTC SHORT 310000
vault B opened  BTC LONG  300000
engine holds    BTC SHORT  10000      ← net, and below the 20000 market minimum
```

Each vault's own `positions` book still says it holds its full leg. Consequences:

- A close reads the NET size, not the vault's own leg. `close_leg` now takes
  `min(live, pos.size)` so it can never close through another vault's position, but the
  accounting is still two books over one account.
- The netted remainder can land **below the market minimum**, and a reduce-only order for it is
  rejected with `ESIZE_NOT_RESPECTING_MIN_SIZE`. That used to abort the whole tick — and since
  `close_expired` runs before anything else, the vault became **permanently unable to tick,
  trade, or close**. Fixed: sub-minimum legs are dropped from the book and reported as
  `PortfolioSkipped`, never placed.

**The rule: exactly one delegate per Decibel vault, always.** The contract cannot enforce it —
it cannot enumerate Decibel's delegate list — so the swap flow does, and it now does it the only
way that can't be wrong:

- The handover calls **`revoke_all_dex_actions_delegations`**, not the targeted form. A list only
  disarms the delegates we know about; one created by an abandoned swap, or delegated outside
  this app, would survive it and keep trading the same subaccount as its replacement. Revoke-all
  needs no such knowledge. `buildRevokeDelegationPayload` with no `strategyVaultAddrs` builds it;
  the targeted form is still there for revoking one strategy without disarming the vault.
- The vault is disarmed for the seconds between the revoke and the delegate. That is the safe
  direction to fail in: a vault nobody can trade, not a vault two strategies are fighting over.

**A second bug, found while fixing that one, and worse.** The swap updated the chain and never
updated the registry. The tick cron's working set is every managed, unpaused, sealed row — so
after a swap it kept ticking the OLD strategy, whose delegation had just been revoked, and never
ticked the replacement, which was never registered at all. **The vault silently stopped
trading**, with nothing in the UI saying so. Same shape as the `CRON_SECRET` trap in §4.2.

Fixed by making retirement a first-class state:

- `SealedVault.retiredAt` / `retiredBy` (migration `20260806000000_sealed_vault_retirement`).
  NULL means live; the cron filters on `retiredAt: null` and the feed excludes retired rows.
- `POST /api/sealed/vaults` takes `retiresStrategyVaultAddrs[]` and does both writes in one
  `prisma.$transaction`. Half-applied is exactly the two states worth preventing: two live
  strategies on one vault, or none. Retirement is authorized the same way `/api/sealed/pending-swap`
  is — the outgoing rows must already be registered to the same creator **and** the same Decibel
  vault — because these routes still have no wallet-signature auth (§8.1).
- The handover re-derives the replacement's commitment from the catalog id stored on the pending
  swap, so a page reload mid-swap cannot register a row that disagrees with what the chain
  sealed. The server rejects a source that doesn't hash to the commitment anyway, so a wrong
  guess fails loudly instead of quietly.
- `managedAttestation` is carried forward. A creator running their own attestor is not silently
  moved onto ours, and a creator on ours is not silently dropped off it — the latter being another
  way to end up with a vault nothing ticks.

Guarded in `pnpm test:reliability`.

### 8.5d Crank gas, measured

From real 4-market ticks on testnet:

| Tick | Gas | Per tick | Per day @ 1/min |
|---|---|---|---|
| No action (the common case) | 316 | 0.000316 APT | **0.46 APT** |
| Four orders placed | 1,428 | 0.001428 APT | 2.06 APT |

Against 0.000186 APT/tick for a single-market vault, a 4-market idle tick is ~1.7× — four mark
reads instead of one. The dominant lever is **cadence, not market count**: 5-minute bars cut it
to ~0.09 APT/day per vault. Budget the crank wallet on the idle figure plus expected turnover,
and re-measure before offering 16-market vaults.

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
| Contract bug | Pause affected vaults. Prefer a new package and migration for a clean trust boundary; use a compatible in-place upgrade only after the full release gate and public bytecode review. |
| Key compromise (attestor) | Pause every vault. Rotating the key requires new vaults — the key is sealed into each one at creation. |

Migrations are additive, so a frontend rollback never needs a database rollback.

---

## 10. Command reference

```bash
# Contract
bash scripts/install-aptos-cli.sh && export APTOS_BIN="$PWD/.aptos-cli/aptos"
pnpm sealed:preflight-mainnet --package 0x<fresh-deployer-address>
pnpm sealed:publish --network mainnet \
  --confirm-mainnet PUBLISH_COMPATIBLE_SEALED_VAULTS_ON_APTOS_MAINNET
                                             # publish + init_platform, spends no USDC
pnpm sealed:e2e status  --network mainnet # read state back
pnpm sealed:e2e verify-package --network mainnet --package 0x<package-address>
pnpm sealed:e2e run     --network testnet # FULL pipeline — creates a funded vault

# Database
pnpm db:migrate:deploy

# Tests (all must pass before deploying)
pnpm test:reliability      # invariants across the whole sealed surface
pnpm test:source-vault     # encryption: nonces, tamper, cross-vault, rotation
pnpm test:sealed-readiness # launch/registry/runner config and attestor keypair
pnpm test:economics        # re-reads Decibel's limits from BOTH chains
pnpm test:catalog          # every strategy commits; blurbs match their scripts
pnpm test:sealed           # attestation BCS layout vs Move
pnpm test:sealed-package   # exact local/on-chain package comparison logic
pnpm test:sealed-deploy    # live publish + funded-run confirmation guards
pnpm test:transpiler       # transpiler rejects what it cannot honestly compile

# Ops
curl -s "https://<domain>/api/cron/sealed-tick?secret=$CRANK_SECRET" | jq
curl -s "https://<domain>/api/sealed/config" | jq '{launchReady,managedReady,ready,missing,economics}'
```

## 11. Order of operations

```
 1. pnpm test:reliability && cd contracts/strategy-vaults && aptos move test   # green
 2. Set SEALED_TREASURY_ADDRESS and run sealed:preflight-mainnet with the
    fresh deployer's public address; fund it to at least 2.5 APT until all checks pass
 3. pnpm sealed:publish --network mainnet \
      --confirm-mainnet PUBLISH_COMPATIBLE_SEALED_VAULTS_ON_APTOS_MAINNET      # §2
 4. Back up .sealed-e2e-mainnet/                                               # §2.3
 5. pnpm db:migrate:deploy                                                     # §3
 6. Set §4.1 vars → redeploy → config shows launchReady:true, managedReady:false
 7. Generate SEALED_SOURCE_KEY + CRANK_SECRET, set §4.2 vars                   # §4.2
 8. Fund the crank wallet                                                      # §5
 9. Redeploy → config shows ready:true; curl the cron, expect ok:true          # §6
10. Smoke test one real vault                                                  # §7
```

Steps 1–2 are read-only or reversible. Step 3 writes permanent chain history and installs a
compatible package. Later configuration can change, and a deployer-signed compatible upgrade can
replace package bytecode; neither action removes the original transaction history.
