# Decibel HotIndex evaluation

Decision: prepare a shadow deployment, but do not put HotIndex on cash.trading's
production request path yet.

Evaluated July 18, 2026 at upstream commit
`c3052559ec06b573241691cef9de7d22d4225e87`.

Upstream:

- https://github.com/machinemuse0/decibel-hotindex
- Official event-parser reference:
  https://github.com/aptos-labs/decibel-indexer-example

## What was verified

The repository was cloned outside this workspace and tested without modifying it.

- The default Rust workspace passed 53 unit tests plus doc tests.
- The RocksDB feature compiled and passed all 9 storage tests, including memory vs
  RocksDB checksum equivalence, replay stability, and the shared conformance suite.
- The design correctly uses immutable transaction-stream archives, deterministic
  replay, recent-first keys, and backend checksums.
- The Rust workspace declares `Apache-2.0`, but the repository currently has no
  root `LICENSE` or `COPYING` file. Do not copy source into cash.trading until the
  upstream repository includes the license text or the owner confirms the license.

The test commands required a current Rust toolchain and a usable `libclang` path for
RocksDB on macOS. That is an expected native-service deployment concern, not a
cash.trading frontend dependency.

## Why it is not production-ready

1. The REST API milestone has not started. `decibel-hotindex-api/src/main.rs` only
   prints the crate status; there is no health, account, market, or Builder endpoint
   for cash.trading to call.
2. There is no tagged release or stable API contract.
3. The repository explicitly says publishable release-mode mainnet benchmarks are
   still pending. Synthetic/fixture smoke results are not evidence that it will make
   cash.trading faster in production.
4. Mainnet recording has a 1,000-transaction raw smoke, but serving workloads still
   need a Decibel-active range and full parser validation.
5. Parser coverage is initial. The official Aptos example currently documents 31
   Decibel event types, including vault contribution/redemption/fees, referrals,
   collateral changes, TWAPs, and market changes. Those must be covered before the
   index becomes a source for user or vault history.
6. RocksDB needs a persistent process and attached disk. Vercel serverless functions
   cannot host this safely because their filesystems and process lifetimes are
   ephemeral.
7. Builder metrics are analytics estimates, not official settlement statements.

## Where it can improve cash.trading

After the gates below, HotIndex is a good fit for immutable historical/event queries:

| cash.trading surface | Future HotIndex role | Current authoritative fallback |
| --- | --- | --- |
| Public user analytics | Recent fills, fees, active days, liquidation history | Decibel REST and Aptos views |
| CASH reward verification | Fast candidate fill/account scans before on-chain verification | Decibel account history |
| Builder dashboard | Attributed fills, unique funded accounts, estimated routed volume | On-chain fee receipts |
| Points intelligence | Trading activity inputs and cohort analytics | Official Decibel AMPs endpoints |
| Portfolio history | Fill/activity annotations only | Decibel portfolio-chart API |
| Vault activity | Contributions, redemptions, fee events after parser parity | Decibel vault APIs and Aptos views |

It should **not** serve:

- Real-time price, candles, order book, or trade tape. Keep Decibel WebSocket/REST
  feeds because transaction-stream finality is a different latency class.
- Order preflight, signing, or submission.
- Official AMPs totals or official Builder settlement totals.
- A fabricated equity/PnL chart. Reconstructing account value requires complete
  collateral, position, funding, fill, and price histories—not fills alone.
- Historical order-book depth. On-chain events do not recreate every book state;
  keep the dedicated depth capture/rollup pipeline.

## Target architecture

```text
Aptos Transaction Stream
  -> pinned HotIndex ingest/parser
  -> immutable compressed raw chunks
  -> RocksDB on persistent NVMe volume
  -> authenticated read-only HTTP API
  -> cash.trading server routes
       -> HotIndex first for supported historical queries
       -> official Decibel API/Aptos fallback on timeout, lag, or mismatch

Decibel WebSocket/REST -> charts, prices, book, tape, live positions
Neon/Postgres          -> depth history, app state, automation state
```

The first deployment should be a separate Rust service on a host with persistent
storage (for example, a small VPS, Fly volume, Railway volume, or equivalent). It
must not share wallet keys or the CASH reward manager key. Its only secret is the
Aptos transaction-stream credential plus an internal API token.

## Adoption gates

### Gate 0: upstream/legal contract

- Root license text is present and matches the Cargo metadata.
- Pin a reviewed commit; never deploy unreviewed `main` automatically.
- REST API is implemented with versioned response DTOs, health, ingest status,
  pagination, timeouts, request limits, and authentication.
- Address and integer fields remain lossless strings where required.

### Gate 1: parser parity and real data

- Compare against every event type in `aptos-labs/decibel-indexer-example`.
- Add fixtures from real mainnet transactions for trades, orders, positions,
  collateral, funding, liquidations, vaults, referrals, and Builder attribution.
- Unknown/new event payloads remain preserved and alertable.
- Record a Decibel-active bounded dataset once, replay it, and checksum it.
- Reconcile counts and sampled rows against Aptos fullnode transactions and the
  official Decibel APIs.

### Gate 2: shadow service

- Deploy RocksDB with a persistent volume, automated checkpoint backup, disk alerts,
  and process supervision.
- Track indexed version, chain head, lag seconds, unknown-event count, parse errors,
  disk usage, and endpoint p50/p95/p99.
- Run for at least seven days without gaps or unreconciled count drift.
- No production response should depend on it during this phase.

### Gate 3: narrow production reads

- Add a server-only `DECIBEL_HOTINDEX_URL` and API token.
- Start with public fill/activity annotations and Builder analytics.
- Use a short timeout and automatic Decibel fallback; expose `source` and indexed
  version/lag in internal diagnostics.
- Compare both sources in shadow mode before returning HotIndex data to users.

### Gate 4: rewards and cohort analytics

- Use HotIndex only to accelerate candidate selection and aggregation.
- Retain the existing server-side ownership checks, caps, and on-chain voucher
  guards. Never trust a client or an index estimate for payout authorization.
- Builder revenue remains reconciled against actual on-chain receipts.

## Performance acceptance criteria

These are targets to measure, not claims about the current repository:

- Historical account/Builder query p95 under 50 ms at the service.
- cash.trading server-route p95 improved by at least 25% versus the current upstream
  call on the same query, including network time.
- Chain-head lag under 10 seconds for normal operation and visible degraded status
  above 30 seconds.
- Zero checksum drift, zero missing indexed version ranges, and zero silent unknown
  event drops.
- Automatic fallback adds no more than two seconds before returning official data.

If those measurements do not beat the current Decibel routes after network overhead,
do not add it to the request path. The architecture is useful only when it improves
measured user latency or supplies trustworthy history that the official API lacks.

## Immediate next action

Watch upstream for its M6 REST API and license-file addition. Once those land, fork
or pin the reviewed commit, add full official-parser parity, and run a seven-day
shadow service. Until then, cash.trading should continue using Decibel WebSocket/REST
for live data and the bounded Neon depth pipeline, while treating HotIndex as a
promising historical analytics service—not a chart or execution accelerator.
