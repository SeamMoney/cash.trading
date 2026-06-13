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
```

Env (read from process env, falling back to `.env` at repo root):

| Var                  | Default | Meaning                              |
| -------------------- | ------- | ------------------------------------ |
| `DATABASE_URL`       | —       | Postgres DSN (required unless dry)   |
| `GEOMI_API_KEY`      | —       | Aptos Build key (required)           |
| `CAPTURE_INTERVAL_S` | 5       | Seconds between capture cycles       |
| `DEPTH_LEVELS`       | 10      | Levels per side stored               |
| `RETENTION_DAYS`     | 60      | Hourly delete of rows older than this|
| `DRY_RUN`            | unset   | `1` = one cycle, print, exit         |

Dependency: `pg`. It currently resolves transitively in `node_modules`, but
it is **not** a direct dependency — run `pnpm add pg` before relying on the
worker in production. The script guards the import and exits with a clear
message if `pg` is missing.

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
```

## Behavior

- **Cycle**: every `CAPTURE_INTERVAL_S`, fetch all open markets' books.
  Requests start 100 ms apart (staggered-concurrent — upstream latency is
  ~1–2 s/call, so serial fetching would take >90 s/cycle). One multi-row
  `INSERT` per cycle. One log line per cycle: captured / failed / ms.
- **Market list** refreshed hourly; refresh failure keeps the old list.
- **Per-market failures** are logged and skipped — they never crash the loop.
- **Backoff**: a cycle with zero successful inserts doubles the wait
  (capped at 5 min) until a healthy cycle resets it.
- **Retention**: hourly `DELETE … WHERE ts < now() - RETENTION_DAYS days`.
- **Shutdown**: SIGINT/SIGTERM aborts in-flight fetches, closes the pool,
  exits 0.
- Secrets (`GEOMI_API_KEY`, `DATABASE_URL`) are never printed.

## Storage math

Measured on the first live cycle (2026-06-13, 39 open markets, 10
levels/side): **~15.6 KB/cycle**.

| Interval | Cycles/day | Est. ingest/day | At 60 d retention |
| -------- | ---------- | --------------- | ----------------- |
| 5 s      | 17,280     | ~257 MB         | ~15.4 GB          |
| 15 s     | 5,760      | ~86 MB          | ~5.2 GB           |
| 30 s     | 2,880      | ~43 MB          | ~2.6 GB           |

The worker logs its own estimate from the first real cycle on every startup.
If the VPS disk is small, start with `CAPTURE_INTERVAL_S=15` — 15 s depth is
still far better than no depth, and the interval can be tightened later
without any schema change. For long-horizon retention consider rolling old
rows into 1-min downsamples before deletion (future work).

Note the actual cycle takes ~6–11 s with 39 markets (stagger + upstream RTT),
so at `CAPTURE_INTERVAL_S=5` the effective cadence is "back-to-back", roughly
one snapshot per market every ~10 s. The math above is therefore an upper
bound at 5 s.

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
