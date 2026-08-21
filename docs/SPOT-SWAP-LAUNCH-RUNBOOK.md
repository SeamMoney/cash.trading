# Spot Swap launch runbook

Status: code verification only. Do not publish the CASH package, seed liquidity,
or submit a wallet transaction until the contract audit and key-time checks are
complete.

## What the Swap page routes

The page has one asset-first interface and one shared Book/Trades renderer:

- `CASH / USDC` routes to the independent cash.trading orderbook. This is our
  hardened Move implementation, informed by Decibel's CLOB design. It is not a
  fork of Decibel's current production package.
- `APT / USDC` and `BTC / USDC` route to Decibel mainnet spot through the
  reviewed direct-wallet `place_spot_order` entry function.
- The asset buttons use the Trade page's existing responsive market selector.
  It opens as a bottom sheet through 767 px and as the existing dialog above
  that width.
- The Book and Trades tabs are the exact `components/trade/OrderBook.tsx`
  component used on Trade. Swap supplies a different verified feed; it does not
  fork the renderer.

Decibel's installed SDK does not currently expose the documented spot helpers,
so the integration builds the reviewed seven-argument IOC payload directly.
The builder code and builder fee arguments are both empty. cash.trading does not
add a fee to Decibel spot orders.

Official references:

- [Place a spot order](https://docs.decibel.trade/developer-hub/on-chain/order-management/place-spot-order)
- [Get user order history](https://docs.decibel.trade/api-reference/account/get-user-order-history)
- [Get trades](https://docs.decibel.trade/api-reference/market-data/get-trades)

## Hard launch gates

All gates must be green. A partial pass is not approval to launch.

### 1. CASH contract and indexer

Complete every gate in the
[CASH orderbook launch runbook](./CASH-ORDERBOOK-LAUNCH-RUNBOOK.md). In
particular:

- external audit approval for the exact immutable bytecode;
- a fresh mainnet address with no pre-existing resources;
- exact CASH and native USDC metadata;
- pair `0`, active, zero maker fee, and zero taker fee;
- completed multisig admin handoff with no pending admin;
- auditor-approved module fingerprint;
- direct owner-aware 16-node executable-prefix depth working for the public site;
- indexer health reports `authoritativeReplayComplete: true`, with stable trade
  IDs working for the non-executable tape;
- the exact $250 / 600 million CASH launch ladder reviewed before signing.

Do not put a publisher, admin, or LP private key into the frontend environment.

### 2. Mainnet environment

The protected deployment must set and verify:

```text
NEXT_PUBLIC_DECIBEL_NETWORK=mainnet
DECIBEL_NETWORK=mainnet
CASH_ORDERBOOK_CONTRACT_ADDRESS=<audited address>
CASH_ORDERBOOK_ADMIN_ADDRESS=<final multisig>
CASH_ORDERBOOK_LP_ADDRESS=<immutable designated maker / launch LP>
CASH_ORDERBOOK_AUDITED_MODULES_SHA256=<approved fingerprint>
CASH_ORDERBOOK_API_URL=<HTTPS indexer origin>
APTOS_NODE_URL_MAINNET=https://api.mainnet.aptoslabs.com/v1
CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN=
```

The server also needs its existing Aptos Labs API credential. It is sent only
to the official fullnode base. A custom fullnode must name its exact HTTPS
origin and, when required, use the separate
`CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_API_KEY`; provider credentials are never
forwarded to it. Never expose either credential through a `NEXT_PUBLIC_`
variable.

### 3. Decibel deployment attestation

The public quote routes fail closed unless Aptos mainnet still reports the
reviewed packages below at the pinned Decibel account
`0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06`.
The attestation compares each package's upgrade number, upgrade policy `1`,
source digest, and exact module inventory. A matching market registry alone is
not sufficient.

| Package | Upgrade | Source digest |
|---|---:|---|
| `aptos_market` | 30 | `9CAAAC918B853E8FC47E7D9BC22A2C8902D27ADBF813BB623DCCC3E6A11EE648` |
| `decibel_accounts` | 27 | `14F71F1F5AAB878412EF7610964F75939AB5AE44004A7BA4FE4487BFB2B8151E` |
| `decibel_spot_dex` | 1 | `4F384AA816A091CAD2496B30309B8D0863DCA691176CF5E146647F6E9E1BC7C3` |
| `decibel_trade_tracking` | 3 | `826045EFC1580F84A1A30EE9B3B03160341F1F21346E0290B89F3E3D04C7A999` |

These packages are upgradeable. Any change must pause new quotes until the new
bytecode and behavior are reviewed and the pins are intentionally updated.
Settlement recovery for an already-submitted order must remain available while
new quotes are paused.

Every market, orderbook, and balance request runs this four-package check. The
server may reuse a successful package attestation for at most three seconds.
The signing preflight's `fresh=1` flag does not skip or weaken that check; it
additionally forces an uncached Decibel market-registry read.

### 4. Public endpoint checks

Run these against the protected production URL, not localhost:

```bash
curl -fsS "$FRONTEND_URL/api/decibel/spot?resource=markets&network=mainnet"
curl -fsS "$FRONTEND_URL/api/decibel/spot?resource=orderbook&network=mainnet&market=APT%2FUSDC&depth=25"
curl -fsS "$FRONTEND_URL/api/decibel/spot?resource=orderbook&network=mainnet&market=APT%2FUSDC&depth=25&fresh=1"
curl -fsS "$FRONTEND_URL/api/decibel/spot?resource=orderbook&network=mainnet&market=BTC%2FUSDC&depth=25"
curl -fsS "$FRONTEND_URL/api/cash-orderbook/depth"
curl -fsS "$FRONTEND_URL/api/cash-orderbook/trades"
```

Expected behavior:

- the app response contains exactly the reviewed, allowlisted open spot markets;
  additional upstream markets remain unavailable until they are separately reviewed;
- APT may show live depth;
- BTC may have an empty book, but the response must still be verified and the
  UI must say that no liquidity is available;
- CASH remains visibly unavailable until the audited contract and pair are
  connected;
- `fresh=1` is accepted only for an orderbook signing preflight and forces an
  uncached registry read; any other use must fail closed;
- every response is `no-store` and a validation failure returns `ready:false`;
- a changed package, wrong chain, stale ledger, malformed level, or unsupported
  fee pauses new swaps before the wallet opens.

Immediately before signing, the app must repeat the orderbook request with
`fresh=1`, recompute the exact quote, re-read balances, and capture the Aptos
account sequence and ledger watermark. If the quote changed or any check fails,
the wallet must stay closed and the user must review the refreshed quote.

### 5. Low-value wallet canary

Only after the audit and endpoint checks, use a dedicated low-value mainnet
wallet. Do not use the publisher or protocol-admin wallet.

1. Confirm the wallet reports Aptos chain ID `1`.
2. Confirm the UI shows the expected input balance and reserves at least `0.01
   APT` for gas when selling APT.
3. Submit the smallest practical APT/USDC IOC supported by the current book.
4. Compare the wallet payload with the review screen: market, side, limit price,
   size, IOC code `2`, and empty builder arguments.
5. Confirm the returned hash is exactly 32 bytes and opens on Aptos Explorer.
6. Confirm the receipt uses the matching Decibel trade event and shows the
   actual paid, received, and fee amounts.
7. Test a no-fill order and confirm it cannot leave a resting order.
8. If Decibel emits a pending CBS order, keep the swap locked until the
   authoritative pending queue and indexed terminal order prove settlement.
9. If the wallet returns no hash, use **Check Aptos and recover**. Do not submit
   a second order until the account sequence and exact transaction identity
   prove that retrying is safe.

Record both canary transaction hashes in the launch log.

### 6. CBS settlement and unknown-submit recovery

#### Confirmed hash with pending CBS settlement

Poll the exact confirmed order through the protected production URL. Use the
owner, market, order ID, price, size, and side saved from the reviewed order;
do not substitute display-rounded amounts.

```bash
curl -fsS --get "$FRONTEND_URL/api/decibel/spot" \
  --data-urlencode "resource=settlement" \
  --data-urlencode "network=mainnet" \
  --data-urlencode "owner=$CANARY_OWNER" \
  --data-urlencode "market=APT/USDC" \
  --data-urlencode "orderId=$CANARY_ORDER_ID" \
  --data-urlencode "priceAtomic=$CANARY_PRICE_ATOMIC" \
  --data-urlencode "sizeAtomic=$CANARY_SIZE_ATOMIC" \
  --data-urlencode "isBid=$CANARY_IS_BID"
```

Only `filled` and `no-fill` are terminal. `pending` and `unverified` keep the
affected wallet flow locked. In particular, a missing indexed order is
`unverified` with reason `awaiting-order-history`; it is never evidence of no
fill. A timeout, malformed response, incomplete fill history, or polling limit
must not unlock another submission.

This settlement route intentionally remains usable when package attestation has
paused new quotes. That separation lets an already-confirmed order finish
reconciliation without permitting another signature.

#### Wallet returned no transaction hash

The app creates and durably stores a wallet-safety record before opening the
wallet. It contains the normalized owner, Aptos mainnet chain ID `1`, the full
exact IOC order identity, pre-sign account sequence and ledger watermark,
requested transaction expiration, and creation time. The signed raw transaction
must match that record before it is submitted. It is also rejected if the
wallet-supplied gas limits could authorize more than `0.5 APT`, even when the
order itself is unchanged.

Use **Check Aptos and recover** in the Swap UI. Do not hand-craft requests to
`POST /api/decibel/spot/recovery`; its `prepare` and `resolve` actions are an
internal fail-closed protocol, not an operator override. Recovery can do only
one of the following:

- adopt the exact matching committed Aptos transaction and continue normal
  confirmation;
- permit a fresh review after a different canonical committed transaction
  consumed the captured sequence; or
- permit a fresh review after the requested expiration plus the conservative
  one-hour grace has elapsed in Aptos chain time while the sequence remains
  unchanged.

Missing, malformed, stale, or conflicting proof remains blocked. An advanced
sequence without its canonical committed transaction also remains blocked.
The CASH and Decibel swap paths use one account-scoped browser lock and inspect
each other's durable pending, ambiguity, and quarantine records. Resolve the
existing wallet action before starting a transaction on the other venue.
Never clear site data, delete local-storage records, switch to another tab to
retry, or tell the user to reconnect around the lock. Malformed records are
quarantined so their evidence is preserved.

If recovery says the record needs support, stop submissions for that wallet,
preserve the Arc profile and browser storage, and record the normalized owner,
UTC time, market, exact reviewed amounts, and displayed error. Never request a
seed phrase, private key, or wallet export. Recovery requires the explicit
mainnet environment and the server-side Aptos Labs API credential; if either is
unavailable, keep the wallet locked.

### 7. UI acceptance matrix

Use only the existing signed-in Arc profile and the installed Playwriter
extension. Do not launch Chrome, Chromium, a headless browser, or a second
browser profile. Start one dedicated task tab and reuse its returned session:

```bash
/usr/local/bin/playwriter skill
arc-browser connect "$FRONTEND_URL/swap"
# Reuse the returned session ID for every following command:
/usr/local/bin/playwriter -s <session-id> -e 'console.log(state.page.url()); console.log(await snapshot({ page: state.page })); console.log(await getLatestLogs({ page: state.page, sinceLastCall: true }))'
```

Prefer accessibility snapshots for state and interaction checks. Use
screenshots only for visual spacing and alignment, and inspect console logs
after every navigation or action. Do not clear browser-wide cookies or cache,
and do not close Arc or tabs that the task did not create.

Verify the production build at these widths:

- 320 px and 375 px phone;
- 640–767 px tablet/mobile sheet range;
- 768 px dialog boundary;
- 1024 px compact desktop;
- 1280 px and 1440 px desktop.

At every width confirm:

- no horizontal overflow;
- pay and receive panels have matching geometry;
- the swap rail and Book rail align at desktop;
- the asset sheet traps focus, restores focus, and closes with Escape;
- CASH, APT, BTC, and USDC selections produce the expected pair and side;
- Book/Trades row counts and heights match Trade at the same breakpoint;
- long exact amounts remain readable on the review screen;
- warnings never rely on color alone;
- stale or unavailable data clears executable state and never opens the wallet.

Exercise the selector as a bottom sheet at 320, 375, and 640–767 px, then as a
dialog at 768 px and above. Confirm focus trapping, Escape, backdrop close,
focus restoration, scroll containment, and safe-area spacing at the boundary.

Before the production wallet canary, verify these non-signing states with local
fixtures or controlled API responses: disconnected wallet, wrong network,
stale quote refresh, CASH unavailable before audit, APT with live depth, BTC
with an empty verified book, pending CBS settlement, `unverified` settlement,
and no-hash recovery. Do not manufacture a real ambiguous submission or CBS
pending order merely to test presentation. The only production signatures
permitted by this runbook are the explicitly approved low-value canary orders
after every earlier gate passes.

## Local verification

Run under the repository's Node 22 and pnpm 10.19.0 toolchain:

```bash
pnpm exec tsc --noEmit --incremental false
pnpm test:decibel-spot
pnpm test:decibel-spot-confirmation
pnpm test:decibel-spot-ambiguity
pnpm test:decibel-spot-deployment
pnpm test:cash-orderbook
pnpm test:cash-orderbook-ambiguity
pnpm test:cash-orderbook-launch
pnpm test:reliability
pnpm build
git diff --check
```

The sibling CASH orderbook repository must also pass its warning-free production
Move compile, full Move suite, API suite, scripts suite, typechecks, and build.

## Stop conditions

Pause new swaps immediately if any of these occur:

- a pinned Decibel package changes;
- the mainnet registry removes, closes, or mutates a reviewed spot market, or an
  unreviewed market becomes selectable in the app;
- the immediate `fresh=1` signing preflight is unavailable or changes the
  reviewed quote;
- the fee view exceeds the reviewed bound;
- depth, ledger, or package proofs become stale or disagree;
- CBS settlement is `pending` or `unverified`, or settlement polling cannot
  prove an exact terminal order identity, for that wallet;
- an unknown-submit record is blocked, malformed, quarantined, or cannot reach
  the authoritative Aptos recovery service, for that wallet;
- the CASH module fingerprint, market configuration, admin, or zero-fee state
  differs from the audited launch record;
- the public UI and server point at different networks or contract addresses;
- any Arc acceptance width has overflow, broken selector behavior, mismatched
  Trade/Swap rails, inaccessible warnings, or an executable stale-data state.

During a pause, keep recovery, settlement, and transaction history readable for
already-submitted orders. Never "fix" an outage by weakening a validator,
clearing safety storage, treating missing history as no-fill, or retrying an
unknown wallet outcome.
