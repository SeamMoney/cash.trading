# Depth Capture Worker (WS5.3)

Standalone worker that records point-in-time Decibel order-book depth into
Postgres: `scripts/depth-capture-worker.mjs`.

## Why

Order-book depth only exists while it is live. Unlike candles or trades,
**point-in-time depth history cannot be backfilled** — once a book updates,
the old levels are gone forever. Every day the worker is not running is a day
of data we can never recover. This dataset is a moat for:

- **Fill-accurate backtests** — simulate slippage and partial fills against
  the real book instead of assuming infinite liquidity at mid.
- **Vault capacity limits** — size each strategy vault's max deposits against
  the liquidity its market can actually absorb.

## Upstream

The Decibel SDK's old `GET /api/v1/depth` REST endpoint is gone (404; the
method is commented out in `@decibeltrade/sdk`'s `MarketDepthReader`). The
working endpoint, found by probing the live API:

```
GET https://api.mainnet.aptoslabs.com/decibel/api/v1/markets
GET https://api.mainnet.aptoslabs.com/decibel/api/v1/orderbook?ticker_id=<BASE>-PERP
Authorization: Bearer <GEOMI_API_KEY>
```

`ticker_id` is the market name's base symbol plus `-PERP` (`BTC/USD` →
`BTC-PERP`; verified for all 39 open markets including `SPY`, `COPPER`,
`NATGAS`, `MEGA`). The response is
`{ ticker_id, timestamp, bids: [["price","size"], …], asks: […] }` with up to
~50 levels per side, best-first. There is no server-side level limit param —
the worker slices the top `DEPTH_LEVELS` client-side. Markets with
`mode !== "Open"` are skipped.

## How to run

The worker never auto-starts. It only runs when invoked:

```bash
# dry run: one full cycle against the real API, prints would-be rows,
# never connects to the database
DRY_RUN=1 node scripts/depth-capture-worker.mjs

# real run: creates the table/index if missing, then captures forever
node scripts/depth-capture-worker.mjs

# storage report only (the default is always read-only)
pnpm depth:storage

# explicitly audit the production env when local env files differ
ENV_FILE=.env.production pnpm depth:storage

# compact one bounded batch after reviewing the report
APPLY=1 CONFIRM_DEPTH_COMPACTION=compact pnpm depth:storage
```

Env (read from process env, falling back to `.env` at repo root):

| Var                  | Default | Meaning                              |
| -------------------- | ------- | ------------------------------------ |
| `DATABASE_URL`       | —       | Postgres DSN (required unless dry)   |
| `GEOMI_API_KEY`      | —       | Aptos Build key (required)           |
| `CAPTURE_INTERVAL_S` | 60      | Seconds between capture cycles       |
| `DEPTH_LEVELS`       | 10      | Levels per side stored               |
| `RAW_RETENTION_DAYS` | 3       | Full books kept before compaction     |
| `SUMMARY_BUCKET_MINUTES` | 15  | Long-term rollup resolution           |
| `SUMMARY_RETENTION_DAYS` | 365 | Long-term rollup retention            |
| `COMPACTION_BATCH_HOURS` | 6   | Maximum raw time span per sweep       |
| `DRY_RUN`            | unset   | `1` = one cycle, print, exit         |

Dependency: `pg` is a direct production dependency. The worker still guards
the import and exits with a clear message if an incomplete install omits it.

## Schema

Raw SQL, created by the worker on startup. Deliberately **not** in
`prisma/schema.prisma` (that file is owned by the backend lane; this table is
worker-private).

```sql
CREATE TABLE IF NOT EXISTS decibel_depth_snapshots (
  id          bigserial PRIMARY KEY,
  market_addr text        NOT NULL,
  market_name text        NOT NULL,
  ts          timestamptz NOT NULL DEFAULT now(),
  best_bid    double precision,
  best_ask    double precision,
  bids        jsonb       NOT NULL,  -- [[price, size], …] best-first, numbers
  asks        jsonb       NOT NULL
);
CREATE INDEX IF NOT EXISTS decibel_depth_snapshots_market_ts_idx
  ON decibel_depth_snapshots (market_addr, ts);
CREATE INDEX IF NOT EXISTS decibel_depth_snapshots_ts_idx
  ON decibel_depth_snapshots (ts);
```

Long-term data is written to `decibel_depth_summaries`. Each 15-minute row
retains mid-price OHLC, spread min/average/max, sample count, the first/last
timestamps, and the final full bid/ask ladder from the bucket. This preserves
useful liquidity and slippage evidence without keeping every repeated JSONB
book forever.

## Behavior

- **Cycle**: every `CAPTURE_INTERVAL_S`, fetch all open markets' books.
  Requests start 100 ms apart (staggered-concurrent — upstream latency is
  ~1–2 s/call, so serial fetching would take >90 s/cycle). One multi-row
  `INSERT` per cycle. One log line per cycle: captured / failed / ms.
- **Market list** refreshed hourly; refresh failure keeps the old list.
- **Per-market failures** are logged and skipped — they never crash the loop.
- **Backoff**: a cycle with zero successful inserts doubles the wait
  (capped at 5 min) until a healthy cycle resets it.
- **Compaction**: hourly, one bounded raw span is rolled up transactionally,
  then those source rows are removed. A Postgres advisory lock prevents the
  worker and storage doctor from compacting concurrently. Closed buckets only
  are processed, so a bucket is never split between runs.
- **Retention**: full books remain hot for `RAW_RETENTION_DAYS`; summaries
  remain for `SUMMARY_RETENTION_DAYS`.
- **Shutdown**: SIGINT/SIGTERM aborts in-flight fetches, closes the pool,
  exits 0.
- Secrets (`GEOMI_API_KEY`, `DATABASE_URL`) are never printed.

## Storage math

Measured on the first live cycle (2026-06-13, 39 open markets, 10
levels/side): **~15.6 KB/cycle**. The original 5-second/60-day defaults could
grow toward 15.4 GB and caused the Neon free project to exhaust its 0.54 GB
allowance. They are intentionally no longer the defaults.

| Interval | Cycles/day | Est. raw/day | At 3 d raw retention |
| -------- | ---------- | ------------ | -------------------- |
| 5 s      | 17,280     | ~257 MB      | ~771 MB              |
| 30 s     | 2,880      | ~43 MB       | ~129 MB              |
| 60 s     | 1,440      | ~21.5 MB     | ~64.5 MB             |

The worker logs both its raw and summary estimates from the first real cycle
on every startup. The 60-second default is deliberate: this dataset currently
has no latency-sensitive production reader, while the live app uses Decibel's
stream directly. Tighten capture only after measuring the resulting storage
budget.

Note the actual cycle takes ~6–11 s with 39 markets (stagger + upstream RTT),
so at `CAPTURE_INTERVAL_S=5` the effective cadence is "back-to-back". The
60-second default leaves upstream and database headroom.

## Storage doctor and existing data

`pnpm depth:storage` connects read-only and reports row counts, date ranges,
relation sizes, and how many rows exceed raw retention. It does not even create
the summary table in dry-run mode. When multiple env files have different
databases, set `ENV_FILE=.env.production` (or the intended file) explicitly.
Applying compaction requires both flags:

```bash
APPLY=1 CONFIRM_DEPTH_COMPACTION=compact pnpm depth:storage
```

One invocation processes one six-hour batch by default. Use `MAX_BATCHES=N`
only after reviewing the first result. Compaction is transactional: summary
rows and raw deletion commit together, or neither does. Deleted Postgres pages
become reusable immediately; Neon may take a normal garbage-collection cycle
to show lower physical storage. Do not run `VACUUM FULL` against production
without a planned maintenance window because it rewrites and locks the table.

Production also calls `/api/cron/depth-compact` hourly. Vercel authenticates
the route with `Authorization: Bearer $CRON_SECRET`; it uses the same
transactional compactor and advisory lock as the worker. This keeps storage
bounded even if a stale worker process is still running. `DATABASE_URL` and
`CRON_SECRET` must both be configured in the Vercel Production environment.

## VPS notes

Runs on the same box as the compile service + crank loop (WS5.2). Postgres
can be local or the existing managed DB — the worker only needs
`DATABASE_URL`. Systemd unit (also in the script header):

```ini
# /etc/systemd/system/decibel-depth-capture.service
[Unit]
Description=Decibel order-book depth capture worker
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=decibel
WorkingDirectory=/srv/decibrrr
EnvironmentFile=/srv/decibrrr/.env
ExecStart=/usr/bin/node scripts/depth-capture-worker.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now decibel-depth-capture
journalctl -u decibel-depth-capture -f   # tail the one-line-per-cycle logs
```

Monitoring hook (WS5.4): alert if no new `decibel_depth_snapshots` row in
5 minutes — `SELECT max(ts) FROM decibel_depth_snapshots`.
