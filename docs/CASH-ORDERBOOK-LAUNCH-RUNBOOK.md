# CASH/USDC Orderbook Launch Runbook

This runbook covers the independent CASH orderbook on Aptos mainnet. Every
preflight command is read-only. Signing stays in the approved wallet or
multisig. Never paste a private key into an agent, ticket, chat, or shell
history.

The launch manifest is
`../cash-orderbook/launch/mainnet-cash-usdc.json`. It fixes the following
values:

- CASH metadata: `0xc692943f7b340f02191c5de8dac2f827e0b66b3ed2206206a3526bcb0cae6e40`
- USDC metadata: `0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b`
- pair ID: `0`
- CASH lot: `1,000 CASH`
- minimum order: `10,000 CASH`
- price tick: `0.00000001 USDC`
- launch fees: `0 maker bps` and `0 taker bps`
- LP asks: `600,000,000 CASH` total
- LP bids: `249.923160 USDC` total, capped below `250 USDC`
- LP gas threshold: `0.5 APT`

## Inputs the operator must supply

Keep these public values in the launch record:

| Input | Meaning |
| --- | --- |
| `CASH_CONTRACT_ADDRESS` | Address that publishes the immutable package |
| `CASH_ADMIN_ADDRESS` | Final protocol admin, preferably a named multisig |
| `CASH_LP_ADDRESS` | Wallet that owns the launch ladder |
| `CASH_APPROVED_FINGERPRINT` | SHA-256 approved by the code auditor |
| `CASH_MODULES_DIR` | Clean auditor-approved `bytecode_modules` directory |
| `CASH_AUDITOR_APPROVAL_FILE` | Mode-0400 detached approval for the exact publisher-bound candidate |
| `CASH_AUDITOR_PUBLIC_KEY_FILE` | Mode-0400 auditor Ed25519 public key obtained through a separate channel |
| `CASH_FRONTEND_ENV` | Non-secret production environment snapshot |
| `CASH_PREVIEW_URL` | Protected deployment used for the ready check |
| `CASH_INDEXER_HEALTH_URL` | Production indexer `/health` endpoint |
| `CASH_SMOKE_PROOF` | Mode-0400 JSON record for the reviewed buy and sell smoke swaps |

The operator also needs approved wallet or multisig access for the publisher,
final admin, LP, and smoke-test wallet. No private key belongs in the repository,
an environment variable, or a shell command. The smoke-test wallet must differ
from the LP wallet because the contract prevents self-trades.

## Stop conditions

Stop the launch when any preflight prints `BLOCKED` or any transaction fails.
Do not retry a changed payload. Regenerate the unsigned plan, compare it with
the launch manifest, and repeat the prior read-only stage.

Publication is irreversible. A published Aptos package cannot be removed.
The operational recovery path pauses market 0, removes the frontend deployment,
cancels LP orders, and withdraws unlocked balances.

## 1. Build, audit, and publish the exact package

Run this only after choosing the public publisher address. V1 supports a fresh
legacy-Ed25519 publisher. The final protocol admin may be a multisig after the
two-step handoff. Multisig package publication needs a separately reviewed
release path and is not supported by this procedure.

Create the offline auditor candidate in a new mode-0700 directory:

```bash
cd /Users/maxmohammadi/cash-orderbook
export CASH_CONTRACT_ADDRESS="0x..."
export CASH_AUDIT_DIR="/absolute/secure/path/cash-audit-candidate"

install -d -m 700 "$CASH_AUDIT_DIR"
pnpm --filter @cash/scripts prepublish-candidate -- \
  --publisher-address "$CASH_CONTRACT_ADDRESS" \
  --output-dir "$CASH_AUDIT_DIR"

export CASH_MODULES_DIR="/Users/maxmohammadi/cash-orderbook/contracts/build/cash_orderbook/bytecode_modules"
```

`prepublish-candidate` pins compiler 2.0, language 2.3, default optimization,
`--included-artifacts none`, the Aptos framework revision, the immutable policy,
all eleven production modules, and the canonical publish payload. It never
reads a profile or private key and cannot contact mainnet, sign, or submit.

The directory must contain exactly these eleven files:

```text
accounts.mv
admin.mv
cancel.mv
fees.mv
market.mv
matching.mv
order_placement.mv
settlement.mv
subaccounts.mv
types.mv
views.mv
```

Run the local gate from the app repository:

```bash
cd /Users/maxmohammadi/decibrrr
pnpm cash-orderbook:preflight -- \
  --stage local \
  --modules-dir "$CASH_MODULES_DIR"
```

The app's local preflight prints the aggregate module fingerprint. Record it
with `build-candidate.json`, `publish-payload.json`,
`auditor-signing-message.txt`, the exact source revision, and the audit report.
The auditor must review that complete publisher-bound candidate and return the
signed approval described in
[`cash-orderbook/contracts/RELEASE_SECURITY.md`](../../cash-orderbook/contracts/RELEASE_SECURITY.md).
Obtain the auditor public key through a separate authenticated channel. After
approval, set these public paths and values:

```bash
export CASH_APPROVED_FINGERPRINT="<64 lowercase hex characters>"
export CASH_AUDITOR_APPROVAL_FILE="/secure/release/auditor-approval.json"
export CASH_AUDITOR_PUBLIC_KEY_FILE="/secure/release/auditor-ed25519-public-key.hex"
chmod 0400 "$CASH_AUDITOR_APPROVAL_FILE" "$CASH_AUDITOR_PUBLIC_KEY_FILE"
```

Repeat the local gate with the approved value:

```bash
CASH_ORDERBOOK_AUDITED_MODULES_SHA256="$CASH_APPROVED_FINGERPRINT" \
pnpm cash-orderbook:preflight -- \
  --stage local \
  --modules-dir "$CASH_MODULES_DIR"
```

At key time, follow the mandatory signed pre-publish gate in
[`RELEASE_SECURITY.md`](../../cash-orderbook/contracts/RELEASE_SECURITY.md#mandatory-signed-pre-publish-gate)
without changing its commands. `deploy-mainnet.sh` performs two full builds,
auditor-signature checks, and same-ledger freshness checks. It creates a chain-1
raw transaction with one exact sequence, gas cap, absolute expiration, and
reviewed payload. The script stops after writing the raw BCS transaction and
the publisher signing message.

The external publisher signer must decode `publisher-signing-message.hex` and
sign those bytes. The separate `submit-signed-publish` command accepts only the
raw public key and detached signature, repeats every release and chain check,
submits the exact signed bytes, and requires the returned hash to match the
locally computed hash. Reconcile that hash and verify successful finality before
running any admin or market payload. A timeout is not permission to resubmit.

Do not use `aptos move publish`, `aptos move run`, an Aptos profile, or a private
key environment variable for package publication.

## 2. Generate unsigned activation payloads

These commands cannot sign or submit a transaction. The first emits the exact
ordered activation and emergency transaction plan together with its seal. The
second reproduces that same plan only after the independently approved seal
matches.

```bash
cd /Users/maxmohammadi/cash-orderbook
export CASH_ADMIN_ADDRESS="0x..."
export CASH_LP_ADDRESS="0x..."
export CASH_PUBLISHER_ADDRESS="$CASH_CONTRACT_ADDRESS"
export CASH_RELEASE_ID="cash-usdc-mainnet-v1"
export CASH_MANIFEST_SHA256="3b24865d6b849822e7d5174c28a9be38019a8c7aec20ea6d08b19475eb2be524"

install -d -m 700 /secure/release
umask 077
pnpm --silent --filter @cash/scripts launch-payloads -- \
  --seal-only \
  --contract-address "$CASH_CONTRACT_ADDRESS" \
  --publisher-address "$CASH_PUBLISHER_ADDRESS" \
  --admin-address "$CASH_ADMIN_ADDRESS" \
  --lp-address "$CASH_LP_ADDRESS" \
  --expected-release-id "$CASH_RELEASE_ID" \
  --expected-manifest-sha256 "$CASH_MANIFEST_SHA256" \
  > /secure/release/cash-launch-seal.json

chmod 0400 /secure/release/cash-launch-seal.json
```

The seal-only pass cannot sign or submit anything, but it deliberately includes
`seal.transactionPlan`: the complete ordered activation and emergency evidence.
Have a second operator compare the normalized package, publisher, admin, and LP
addresses with the approved wallets; compare the manifest SHA-256 with the
constant above; then review every transaction step, signer, function ID, type
argument, and function argument. `transactionPlanSha256` commits that complete
transaction plan. `planSha256` additionally commits the plan, manifest digest,
activation mode, network, chain ID, and all four normalized roles. After this
full review, copy the approved `planSha256` into the controlled shell that still
holds the four reviewed address variables, then run:

```bash
cd /Users/maxmohammadi/cash-orderbook
export CASH_RELEASE_ID="cash-usdc-mainnet-v1"
export CASH_MANIFEST_SHA256="3b24865d6b849822e7d5174c28a9be38019a8c7aec20ea6d08b19475eb2be524"
export CASH_PLAN_SHA256="approved planSha256 from cash-launch-seal.json"

umask 077
pnpm --silent --filter @cash/scripts launch-payloads -- \
  --contract-address "$CASH_CONTRACT_ADDRESS" \
  --publisher-address "$CASH_PUBLISHER_ADDRESS" \
  --admin-address "$CASH_ADMIN_ADDRESS" \
  --lp-address "$CASH_LP_ADDRESS" \
  --expected-release-id "$CASH_RELEASE_ID" \
  --expected-manifest-sha256 "$CASH_MANIFEST_SHA256" \
  --expected-plan-sha256 "$CASH_PLAN_SHA256" \
  > /secure/release/cash-launch-payloads.json

chmod 0400 /secure/release/cash-launch-payloads.json
```

The second pass checks the approved seal before it emits the signing copy. Its
top-level `activation` and `emergency` arrays must equal the corresponding arrays
inside `seal.transactionPlan` byte for byte. The canonical manifest fixes both
metadata addresses, 6 decimals, pair 0, all lot, tick, and minimum settings, the
exact 10-by-10 ladder, `600,000,000 CASH`, and `249.92316 USDC`. Canonical hashing
omits only the `release.canonicalSha256` field. Any manifest, transaction-order,
signer, function, type-argument, or function-argument change stops the release.

If the publisher and final admin differ, the first payload proposes the final
admin and the second payload accepts the role. Finish both transactions before
registering a market. The package-stage preflight requires the final admin and
an empty pending-admin slot.

Sign each payload in the named approved wallet or multisig only after comparing
its array index, signer, function, type arguments, and function arguments with
the approved `seal.transactionPlan`. The file is evidence, not a transaction,
and cannot sign or submit. Never use `--skip-tests` for the package release gate.

### Activation transaction evidence and unknown outcomes

The approved activation order contains six transactions when the publisher and
final admin differ, or four when they are the same: optional admin proposal and
acceptance, paused pair-0 registration, exact CASH deposit, exact USDC deposit,
then atomic seed-and-activate. Do not open the next signing request until the
previous transaction is canonically committed and its read-only stage passes.

For every item, keep a mode-0400 execution record containing the approved
`planSha256`, `transactionPlanSha256`, array index, normalized signer, exact
payload, chain ID, pre-sign account sequence, expiration, submission time,
returned hash, committed version, success flag, and VM status. Keep that signer
under exclusive transaction custody from the sequence read through final
reconciliation. For a multisig, also record its proposal or request ID and final
Aptos execution hash.

A timeout, wallet dismissal after signing, or missing hash is an unknown outcome,
not a failed transaction. Stop that signer and every later launch step. From one
fresh trusted mainnet ledger snapshot:

1. Read the signer's current sequence. Query the canonical transaction at the
   captured pre-sign sequence and, when available, the returned hash.
2. If a transaction committed at that sequence, require its sender, sequence,
   function, type arguments, and function arguments to equal the sealed array
   item exactly. Adopt only that exact match and record its canonical hash.
3. A different transaction, mismatched payload, or unavailable canonical slot
   after the sequence advanced is a stop condition. A committed abort must be
   recorded and its expected pre-step state proved before diagnosing it; never
   convert an abort into an automatic retry.
4. If the sequence is unchanged and no transaction committed, wait until trusted
   Aptos chain time is later than the signed expiration plus a one-hour margin.
   Re-read the same sequence and canonical slot. Only then may an operator build
   a new raw transaction with the same sealed payload. Never resubmit ambiguous
   signed bytes or change an argument.

Reconcile state for the specific step as well: exact current/pending admin for a
handoff; paused pair 0 with its original LP and four committed ladder vectors for
registration; exact primary-to-internal balance deltas and unchanged locks for a
deposit; or active pair 0 with cleared bootstrap state, the exact LP-owned book,
and exact locked collateral for activation. Any other shape stops the launch.

## 3. Attest the published package

When the publisher differs from the final admin, attest the package first with
the publisher as the current admin:

```bash
cd /Users/maxmohammadi/decibrrr
pnpm cash-orderbook:preflight -- \
  --stage package \
  --modules-dir "$CASH_MODULES_DIR" \
  --contract-address "$CASH_CONTRACT_ADDRESS" \
  --admin-address "$CASH_PUBLISHER_ADDRESS" \
  --expected-fingerprint "$CASH_APPROVED_FINGERPRINT"
```

That run must pass. Submit the propose and accept payloads, then repeat the same
command with `--admin-address "$CASH_ADMIN_ADDRESS"`. The second run must also
pass before market registration.

This stage checks chain ID 1, immutable first-publish package metadata, the
exact module list, byte-for-byte local and deployed bytecode, the approved
fingerprint, the final admin, the empty pending-admin slot, and both token
metadata resources.

## 4. Register paused market 0 with its exact ladder commitment

Submit only the `register paused CASH/USDC pair 0 with exact bootstrap
commitment` item from the sealed unsigned plan. Its signer must be the final
admin. The payload commits the LP address, all ten bid prices and quantities,
and all ten ask prices and quantities on-chain. Compare the wallet or multisig
request with the plan before approving it. Wait for successful finality and
record the hash. That LP becomes the immutable designated maker for pair 0.
Only the LP owner, or an authorized delegate acting for that owner, can later
rest GTC/PostOnly liquidity. Public wallets can still take liquidity through
IOC, FOK, and the retail wallet-swap entry functions.

Run the market gate before depositing LP funds:

```bash
cd /Users/maxmohammadi/decibrrr
pnpm cash-orderbook:preflight -- \
  --stage market \
  --modules-dir "$CASH_MODULES_DIR" \
  --contract-address "$CASH_CONTRACT_ADDRESS" \
  --admin-address "$CASH_ADMIN_ADDRESS" \
  --lp-address "$CASH_LP_ADDRESS" \
  --expected-fingerprint "$CASH_APPROVED_FINGERPRINT"
```

This stage checks the exact pair parameters, paused state, sealed LP and ladder
commitment, immutable designated maker, the contract's 16-node matching bound,
locked zero fees, LP wallet CASH and USDC, and at least `0.5 APT` for gas.
Public order entry and ordinary admin unpause remain disabled while the
bootstrap commitment is pending.

## 5. Prepare and deposit LP funds

The LP needs primary fungible-asset balances of `600,000,000 CASH` and
`250 USDC`. If the CASH balance remains in the legacy CoinStore, use the
audited CASH migration action in the Swap UI or approve this exact entry
function in the LP wallet:

```text
function:       0x1::coin::migrate_to_fungible_store
type argument:  0x61ed8b048636516b4eaf4c74250fa4f9440d9c3e163d96aeb863fe658a4bdc67::CASH::CASH
arguments:      []
```

Wait for finality, then verify the LP's primary CASH fungible-asset balance.

Submit the two generated deposit payloads from the LP wallet. Their exact
amounts are:

```text
CASH  600000000000000 atomic
USDC  250000000 atomic
```

Treat each deposit as a separate sequence-bound operation. Record the LP
sequence number, exact payload, returned hash, and final status before opening
the next wallet request. If the wallet or RPC returns no usable hash, do not
retry. Read pair-0 internal balances at a fresh pinned mainnet ledger version
first. A committed CASH deposit is exactly `600000000000000` available CASH; a
committed USDC deposit is exactly `250000000` available USDC. The funded gate
rejects both missing and excess capital, so a duplicate deposit cannot be
silently carried into launch.

Then run:

```bash
cd /Users/maxmohammadi/decibrrr
pnpm cash-orderbook:preflight -- \
  --stage funded \
  --modules-dir "$CASH_MODULES_DIR" \
  --contract-address "$CASH_CONTRACT_ADDRESS" \
  --admin-address "$CASH_ADMIN_ADDRESS" \
  --lp-address "$CASH_LP_ADDRESS" \
  --expected-fingerprint "$CASH_APPROVED_FINGERPRINT"
```

This stage requires those two internal available balances exactly, with zero
locked collateral. After atomic activation, the ready gate requires zero
available CASH, the exact bid-capital remainder in available USDC, and exact
locked collateral. Never clear an ambiguous wallet outcome or retry based only
on a timeout.

## 6. Atomically seed and activate the reviewed ladder

Submit the single `atomically seed exact 10x10 ladder and activate CASH/USDC`
item from the approved LP wallet. It takes only pair ID `0`; the contract reads
the exact admin-committed ladder, inserts all twenty post-only orders, verifies
the complete book, clears the bootstrap commitment, and activates the market in
one transaction. Compare the wallet request with the sealed plan, wait for
successful finality, and record the hash.

Any balance, validation, gas, or insertion failure rolls back every order and
leaves the market paused with the same commitment, so a failed attempt cannot
expose a partial live book or consume the one-shot CASH inventory. Do not use
ordinary unpause as a recovery path; it is rejected while bootstrap is pending.

## 7. Verify a protected frontend deployment

Create a non-secret environment snapshot that matches the protected deployment:

```bash
export CASH_FRONTEND_ENV="/absolute/path/cash-orderbook-production.env"
```

The file must contain:

```dotenv
CASH_ORDERBOOK_CONTRACT_ADDRESS="0x..."
CASH_ORDERBOOK_ADMIN_ADDRESS="0x..."
CASH_ORDERBOOK_LP_ADDRESS="0x..."
CASH_ORDERBOOK_AUDITED_MODULES_SHA256="<64 lowercase hex characters>"
CASH_ORDERBOOK_API_URL="https://<production-indexer-origin>"
APTOS_NODE_URL_MAINNET="https://api.mainnet.aptoslabs.com/v1"
CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN=""
NEXT_PUBLIC_DECIBEL_NETWORK="mainnet"
DECIBEL_NETWORK="mainnet"
```

`CASH_ORDERBOOK_API_URL` must be the origin whose `/health` URL is supplied as
`CASH_INDEXER_HEALTH_URL`. `CASH_ORDERBOOK_DEV_UNSAFE_SKIP_VERIFY` must be
absent. The fullnode values must match the endpoint used by the preflight. A
custom endpoint needs its exact HTTPS origin in
`CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN`; use the dedicated
`CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_API_KEY` secret if it needs credentials.
Provider keys are never forwarded to a custom RPC. Deploy the exact release to
a protected preview URL, then run:

```bash
cd /Users/maxmohammadi/decibrrr
pnpm cash-orderbook:preflight -- \
  --stage ready \
  --modules-dir "$CASH_MODULES_DIR" \
  --contract-address "$CASH_CONTRACT_ADDRESS" \
  --admin-address "$CASH_ADMIN_ADDRESS" \
  --lp-address "$CASH_LP_ADDRESS" \
  --expected-fingerprint "$CASH_APPROVED_FINGERPRINT" \
  --frontend-env "$CASH_FRONTEND_ENV" \
  --frontend-url "$CASH_PREVIEW_URL" \
  --indexer-health-url "$CASH_INDEXER_HEALTH_URL"
```

This stage requires the exact atomically seeded twenty-order launch ladder,
active state with no pending bootstrap, the sealed LP as designated maker, and
the owner-aware 16-node executable-prefix view used by the matcher itself. It
also requires a responsive Swap page, wallet-balance reads, the public
shared Trades tape, and a current mainnet indexer checkpoint whose health
reports `authoritativeReplayComplete: true`. That proof is earned only after a
complete GraphQL replay; a recent-window REST fallback is never accepted on
mainnet. Promote only the preview build that passed.

### CASH wallet recovery gate

Before the wallet opens, the Swap UI stores the normalized owner, exact
CASH/USDC buy or sell economics, pre-sign account sequence, ledger version,
ledger timestamp, and the requested transaction expiration. Legacy CASH
migration records pin the zero-argument framework entry function, the exact
legacy CASH type, and its entire-balance behavior. The wallet-signed raw
transaction must match this record before the app submits it.

If a wallet or submitter does not return the expected hash, use **Check Aptos
status**. The internal `POST /api/cash-orderbook/recovery` protocol can only:

- recover the exact matching committed transaction and continue confirmation;
- unlock after a different canonical transaction consumed the captured
  sequence; or
- unlock after the signed expiration plus a one-hour grace has elapsed in
  Aptos chain time with an unchanged sequence.

The UI has no manual clear. Missing candidate data, an advanced sequence
without its canonical transaction, stale or regressed ledger evidence,
malformed storage, and failed quarantine writes keep CASH wallet actions
locked. A quarantined record needs manual code and storage review. Support must
never request a seed phrase, private key, wallet export, or a second
transaction.

## 8. Run the public smoke test

Use a separate wallet with enough APT for gas and at least `1 USDC`. Buy the
minimum `10,000 CASH`, then sell all `10,000 CASH` back into the best bid. The
two transaction hashes must be distinct, and both transactions must come from
the same smoke wallet.

Before signing each swap, record the exact atomic arguments shown in the wallet
review. After confirmation, record the transaction hash and sum `quantity` and
`quote_amount` across every pair-0 `settlement::TradeEvent` in that transaction.
Save the result as a mode-0400 file outside the repository:

```json
{
  "schemaVersion": 1,
  "sender": "0x...",
  "buy": {
    "transactionHash": "0x...",
    "maxQuoteAtomic": "...",
    "baseQuantityAtomic": "10000000000",
    "minBaseAtomic": "10000000000",
    "filledBaseAtomic": "10000000000",
    "filledQuoteAtomic": "..."
  },
  "sell": {
    "transactionHash": "0x...",
    "baseAmountAtomic": "10000000000",
    "minQuoteAtomic": "...",
    "filledBaseAtomic": "10000000000",
    "filledQuoteAtomic": "..."
  }
}
```

The metadata addresses and pair ID are taken from the sealed launch manifest.
Do not infer the reviewed payload arguments from an unrelated transaction or
change them after a mismatch. Run the smoke gate once both swaps and the proof
file are complete:

```bash
export CASH_SMOKE_PROOF="/secure/release/cash-smoke-proof.json"
export CASH_PUBLIC_URL="https://cash.trading"
chmod 0400 "$CASH_SMOKE_PROOF"

cd /Users/maxmohammadi/decibrrr
pnpm cash-orderbook:preflight -- \
  --stage smoke \
  --modules-dir "$CASH_MODULES_DIR" \
  --contract-address "$CASH_CONTRACT_ADDRESS" \
  --admin-address "$CASH_ADMIN_ADDRESS" \
  --lp-address "$CASH_LP_ADDRESS" \
  --expected-fingerprint "$CASH_APPROVED_FINGERPRINT" \
  --frontend-env "$CASH_FRONTEND_ENV" \
  --frontend-url "$CASH_PUBLIC_URL" \
  --indexer-health-url "$CASH_INDEXER_HEALTH_URL" \
  --smoke-proof "$CASH_SMOKE_PROOF"
```

The gate binds both receipts to the reviewed sender, exact buy and sell entry
functions, all payload arguments, event taker side, and exact aggregate fills.
It also requires both transaction versions with the correct side on the public
shared Trades tape. Any mismatch blocks launch completion.

## Emergency stop and recovery

1. Submit the generated `pause CASH/USDC market 0` payload from the final admin.
2. Remove or roll back the frontend production release so new swap attempts fail closed.
3. Read `views::get_user_orders($CASH_LP_ADDRESS, 0)` and record every order ID.
4. Submit `cancel::cancel_order(0, order_id)` from the LP for every open order.
5. Read `views::get_user_balances` again. Withdraw only the available atomic balances.
6. Record transaction hashes, ledger versions, deployment identity, and the failed check.

Pausing still permits cancellation. It does not remove the immutable package or
reverse completed trades.
