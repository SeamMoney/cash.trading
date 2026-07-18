#!/usr/bin/env node
/**
 * Decibel order-book depth capture worker (WS5.3)
 * =================================================
 *
 * Records point-in-time order-book depth snapshots for every open Decibel
 * market into Postgres. This history CANNOT be backfilled — depth only
 * exists while it is live — so this dataset is a moat for fill-accurate
 * backtests and vault capacity limits. Data accrues from the day you start
 * this worker, and not a day earlier.
 *
 * Run (manual, never auto-started):
 *   node scripts/depth-capture-worker.mjs
 *
 * Dry run (one cycle against the real API, NO database touched):
 *   DRY_RUN=1 node scripts/depth-capture-worker.mjs
 *
 * Environment (read from process.env, falling back to .env at repo root):
 *   DATABASE_URL        Postgres connection string   (required unless DRY_RUN)
 *   GEOMI_API_KEY       Aptos Build / Geomi API key  (required)
 *   CAPTURE_INTERVAL_S  Seconds between cycles       (default 60)
 *   DEPTH_LEVELS        Levels per side to store     (default 10)
 *   RAW_RETENTION_DAYS  Full books kept this long    (default 3)
 *   SUMMARY_BUCKET_MINUTES  Long-term rollup size    (default 15)
 *   SUMMARY_RETENTION_DAYS  Rollups kept this long   (default 365)
 *   COMPACTION_BATCH_HOURS  Max raw span per sweep   (default 6)
 *   DRY_RUN             "1" = one cycle, print rows, no DB, exit
 *
 * Dependency: `pg` (node-postgres). It currently resolves transitively in
 * this repo, but it is NOT a direct dependency — run `pnpm add pg` before
 * relying on this worker in production so a lockfile change can't break it.
 * The import is guarded: if pg is missing the script tells you and exits.
 *
 * Upstream API (found via @decibeltrade/sdk + live probing, 2026-06):
 *   GET https://api.mainnet.aptoslabs.com/decibel/api/v1/markets
 *   GET https://api.mainnet.aptoslabs.com/decibel/api/v1/orderbook?ticker_id=<BASE>-PERP
 *     -> { ticker_id, timestamp, bids: [["price","size"],...], asks: [...] }
 *     (bids best-first descending, asks best-first ascending, ~50 levels,
 *      no server-side limit param — we slice top DEPTH_LEVELS client-side)
 *   The SDK's old GET /api/v1/depth endpoint is gone (404; commented out in
 *   the SDK source). Auth: Authorization: Bearer <GEOMI_API_KEY>.
 *
 * Schema (raw SQL only — deliberately NOT in prisma/schema.prisma, another
 * agent owns that file):
 *   decibel_depth_snapshots(id, market_addr, market_name, ts,
 *                           best_bid, best_ask, bids jsonb, asks jsonb)
 *   bids/asks are jsonb arrays of [price, size] number pairs, best-first.
 *
 * Systemd unit for the future VPS (see docs/DEPTH-CAPTURE.md):
 *   ----------------------------------------------------------------
 *   # /etc/systemd/system/decibel-depth-capture.service
 *   [Unit]
 *   Description=Decibel order-book depth capture worker
 *   After=network-online.target postgresql.service
 *   Wants=network-online.target
 *
 *   [Service]
 *   Type=simple
 *   User=decibel
 *   WorkingDirectory=/srv/decibrrr
 *   EnvironmentFile=/srv/decibrrr/.env
 *   ExecStart=/usr/bin/node scripts/depth-capture-worker.mjs
 *   Restart=always
 *   RestartSec=10
 *
 *   [Install]
 *   WantedBy=multi-user.target
 *   ----------------------------------------------------------------
 *   sudo systemctl enable --now decibel-depth-capture
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import {
  compactDepthBatch,
  ensureDepthStorageTables,
} from "./lib/depth-storage.mjs";

// ---------------------------------------------------------------------------
// Minimal .env loader (no dependency, never prints values)
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv() {
  let raw;
  try {
    raw = readFileSync(resolve(REPO_ROOT, ".env"), "utf8");
  } catch {
    return; // no .env — rely on process.env
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    if (process.env[key] !== undefined) continue; // real env wins
    let val = rawVal;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadDotEnv();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = "https://api.mainnet.aptoslabs.com/decibel/api/v1";
const DRY_RUN = process.env.DRY_RUN === "1";
const CAPTURE_INTERVAL_S = positiveInt(process.env.CAPTURE_INTERVAL_S, 60);
const DEPTH_LEVELS = positiveInt(process.env.DEPTH_LEVELS, 10);
const RAW_RETENTION_DAYS = positiveInt(process.env.RAW_RETENTION_DAYS, 3);
const SUMMARY_BUCKET_MINUTES = positiveInt(process.env.SUMMARY_BUCKET_MINUTES, 15);
const SUMMARY_RETENTION_DAYS = positiveInt(process.env.SUMMARY_RETENTION_DAYS, 365);
const COMPACTION_BATCH_HOURS = positiveInt(process.env.COMPACTION_BATCH_HOURS, 6);
const STAGGER_MS = 100; // delay between per-market upstream calls
const MARKETS_REFRESH_MS = 60 * 60 * 1000; // refresh market list hourly
const RETENTION_SWEEP_MS = 60 * 60 * 1000; // retention delete hourly
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

const GEOMI_API_KEY = (process.env.GEOMI_API_KEY || "").trim();
const DATABASE_URL = (process.env.DATABASE_URL || "").trim();

function positiveInt(raw, fallback) {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function log(...args) {
  console.log(new Date().toISOString(), "[depth-capture]", ...args);
}

if (!GEOMI_API_KEY) {
  console.error("FATAL: GEOMI_API_KEY is not set (env or .env). Refusing to start.");
  process.exit(1);
}
if (!DRY_RUN && !DATABASE_URL) {
  console.error("FATAL: DATABASE_URL is not set (env or .env). Refusing to start.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Postgres (dynamic import guard — pg may not be a direct dependency)
// ---------------------------------------------------------------------------

let pool = null;

async function initDb() {
  let pg;
  try {
    pg = (await import("pg")).default;
  } catch {
    console.error(
      "FATAL: the 'pg' package is not installed. Run `pnpm add pg` and retry."
    );
    process.exit(1);
  }
  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
  pool.on("error", (err) => log("pg pool error (idle client):", err.message));

  await pool.query(`
    CREATE TABLE IF NOT EXISTS decibel_depth_snapshots (
      id          bigserial PRIMARY KEY,
      market_addr text        NOT NULL,
      market_name text        NOT NULL,
      ts          timestamptz NOT NULL DEFAULT now(),
      best_bid    double precision,
      best_ask    double precision,
      bids        jsonb       NOT NULL,
      asks        jsonb       NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS decibel_depth_snapshots_market_ts_idx
      ON decibel_depth_snapshots (market_addr, ts)
  `);
  await ensureDepthStorageTables(pool);
  log("connected to Postgres; raw + summary tables ensured");
}

// ---------------------------------------------------------------------------
// Upstream fetch helpers
// ---------------------------------------------------------------------------

async function apiGet(path, signal) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error("timeout")), FETCH_TIMEOUT_MS);
  const onOuterAbort = () => ctl.abort(signal?.reason);
  signal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${GEOMI_API_KEY}` },
      signal: ctl.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${path.split("?")[0]}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** market_name "BTC/USD" -> upstream orderbook ticker_id "BTC-PERP" */
function tickerIdFor(marketName) {
  return `${marketName.split("/")[0]}-PERP`;
}

async function fetchMarkets(signal) {
  const all = await apiGet("/markets", signal);
  if (!Array.isArray(all)) throw new Error("unexpected /markets response shape");
  return all
    .filter((m) => m && m.market_addr && m.market_name && m.mode === "Open")
    .map((m) => ({ addr: m.market_addr, name: m.market_name }));
}

/**
 * Fetch one market's book and shape it into a snapshot row.
 * Upstream levels are ["price","size"] string pairs, best-first.
 */
async function fetchDepthSnapshot(market, signal) {
  const data = await apiGet(
    `/orderbook?ticker_id=${encodeURIComponent(tickerIdFor(market.name))}`,
    signal
  );
  const toLevels = (side) =>
    (Array.isArray(side) ? side : [])
      .slice(0, DEPTH_LEVELS)
      .map(([p, s]) => [Number(p), Number(s)])
      .filter(([p, s]) => Number.isFinite(p) && Number.isFinite(s));
  const bids = toLevels(data.bids);
  const asks = toLevels(data.asks);
  return {
    market_addr: market.addr,
    market_name: market.name,
    best_bid: bids.length ? bids[0][0] : null,
    best_ask: asks.length ? asks[0][0] : null,
    bids,
    asks,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function insertSnapshots(rows) {
  if (!rows.length) return;
  const values = [];
  const params = [];
  rows.forEach((r, i) => {
    const base = i * 6;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}::jsonb)`
    );
    params.push(
      r.market_addr,
      r.market_name,
      r.best_bid,
      r.best_ask,
      JSON.stringify(r.bids),
      JSON.stringify(r.asks)
    );
  });
  await pool.query(
    `INSERT INTO decibel_depth_snapshots
       (market_addr, market_name, best_bid, best_ask, bids, asks)
     VALUES ${values.join(", ")}`,
    params
  );
}

async function runRetentionSweep() {
  const result = await compactDepthBatch(pool, {
    rawRetentionDays: RAW_RETENTION_DAYS,
    summaryBucketMinutes: SUMMARY_BUCKET_MINUTES,
    summaryRetentionDays: SUMMARY_RETENTION_DAYS,
    batchHours: COMPACTION_BATCH_HOURS,
  });
  if (result.skipped) {
    log(`compaction sweep: ${result.skipped}`);
    return;
  }
  log(
    `compaction sweep: raw_deleted=${result.deleted} summaries=${result.summaries} ` +
      `summary_expired=${result.expiredSummaries} through=${result.batchEnd}`
  );
}

// ---------------------------------------------------------------------------
// Storage estimate (requirement 6)
// ---------------------------------------------------------------------------

function logStorageEstimate(rows) {
  // Rough on-disk estimate per row: jsonb payload + fixed columns + tuple
  // header/index overhead (~120 bytes is a fair Postgres heuristic).
  const payloadBytes = rows.reduce(
    (sum, r) =>
      sum +
      JSON.stringify(r.bids).length +
      JSON.stringify(r.asks).length +
      r.market_addr.length +
      r.market_name.length,
    0
  );
  const perCycle = payloadBytes + rows.length * 120;
  const cyclesPerDay = Math.floor(86_400 / CAPTURE_INTERVAL_S);
  const perDay = perCycle * cyclesPerDay;
  const summaryRowsPerDay = Math.ceil(86_400 / (SUMMARY_BUCKET_MINUTES * 60));
  const summaryPerDay = perCycle * summaryRowsPerDay;
  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  log(
    `storage estimate: ~${perCycle} bytes/cycle (${rows.length} markets, ` +
      `${DEPTH_LEVELS} levels/side) x ${cyclesPerDay} cycles/day ` +
      `= ~${mb(perDay)} MB/day; hot raw ~${mb(perDay * RAW_RETENTION_DAYS)} MB ` +
      `at ${RAW_RETENTION_DAYS}d, long-term summaries up to ` +
      `~${mb(summaryPerDay * SUMMARY_RETENTION_DAYS)} MB at ` +
      `${SUMMARY_BUCKET_MINUTES}m/${SUMMARY_RETENTION_DAYS}d`
  );
}

// ---------------------------------------------------------------------------
// Capture loop
// ---------------------------------------------------------------------------

const shutdownController = new AbortController();
let stopping = false;

async function captureCycle(markets) {
  const started = Date.now();
  const rows = [];
  const failures = [];
  // Concurrent but staggered: request i starts at i * STAGGER_MS so we never
  // burst the upstream, yet the cycle takes ~(stagger * n + one RTT) instead
  // of (RTT * n) — upstream latency is ~2s/call, serial would blow the budget.
  const results = await Promise.allSettled(
    markets.map(async (market, i) => {
      if (i > 0) {
        await sleep(i * STAGGER_MS, undefined, { signal: shutdownController.signal });
      }
      if (stopping) throw new Error("shutting down");
      return fetchDepthSnapshot(market, shutdownController.signal);
    })
  );
  results.forEach((res, i) => {
    if (res.status === "fulfilled") rows.push(res.value);
    else failures.push(`${markets[i].name}: ${res.reason?.message ?? res.reason}`);
  });
  return { rows, failures, ms: Date.now() - started };
}

async function main() {
  log(
    `starting (interval=${CAPTURE_INTERVAL_S}s, levels=${DEPTH_LEVELS}, ` +
      `rawRetention=${RAW_RETENTION_DAYS}d, summary=${SUMMARY_BUCKET_MINUTES}m/` +
      `${SUMMARY_RETENTION_DAYS}d, dryRun=${DRY_RUN})`
  );

  if (process.env.RETENTION_DAYS) {
    log("RETENTION_DAYS is obsolete and ignored; use RAW_RETENTION_DAYS instead");
  }

  if (!DRY_RUN) await initDb();

  let markets = await fetchMarkets(shutdownController.signal);
  let marketsFetchedAt = Date.now();
  log(`market list: ${markets.length} open markets`);

  let firstCycle = true;
  let consecutiveBadCycles = 0;
  let lastRetentionAt = 0;

  while (!stopping) {
    const cycleStart = Date.now();

    // Hourly market-list refresh (failure is non-fatal — keep the old list)
    if (Date.now() - marketsFetchedAt >= MARKETS_REFRESH_MS) {
      try {
        markets = await fetchMarkets(shutdownController.signal);
        marketsFetchedAt = Date.now();
        log(`market list refreshed: ${markets.length} open markets`);
      } catch (err) {
        marketsFetchedAt = Date.now(); // don't retry every cycle
        log(`market list refresh failed (keeping ${markets.length}): ${err?.message ?? err}`);
      }
    }

    const { rows, failures, ms } = await captureCycle(markets);
    if (stopping) break;

    if (DRY_RUN) {
      log(`DRY RUN cycle: captured=${rows.length} failed=${failures.length} ms=${ms}`);
      for (const f of failures) log("  failure:", f);
      for (const r of rows.slice(0, 3)) {
        log(
          `  would insert: ${r.market_name} (${r.market_addr.slice(0, 10)}…) ` +
            `best_bid=${r.best_bid} best_ask=${r.best_ask} ` +
            `bids=${JSON.stringify(r.bids.slice(0, 3))}… ` +
            `asks=${JSON.stringify(r.asks.slice(0, 3))}…`
        );
      }
      if (rows.length > 3) log(`  …and ${rows.length - 3} more rows`);
      logStorageEstimate(rows);
      log("DRY RUN complete — exiting without touching the database");
      return;
    }

    let inserted = 0;
    try {
      await insertSnapshots(rows);
      inserted = rows.length;
    } catch (err) {
      failures.push(`db insert: ${err?.message ?? err}`);
    }

    if (firstCycle && rows.length) {
      logStorageEstimate(rows);
      firstCycle = false;
    }

    // One log line per cycle
    log(
      `cycle: captured=${inserted}/${markets.length} failed=${failures.length} ms=${Date.now() - cycleStart}`
    );
    if (failures.length) {
      log(`  failures: ${failures.slice(0, 5).join(" | ")}${failures.length > 5 ? " | …" : ""}`);
    }

    // Hourly bounded compaction sweep (never crash the loop). Raw books are
    // summarized transactionally before their source rows are removed.
    if (Date.now() - lastRetentionAt >= RETENTION_SWEEP_MS) {
      lastRetentionAt = Date.now();
      try {
        await runRetentionSweep();
      } catch (err) {
        log(`retention sweep failed: ${err?.message ?? err}`);
      }
    }

    // Backoff: if the whole cycle produced nothing, the upstream (or DB) is
    // unhealthy — back off exponentially instead of hammering it.
    if (inserted === 0 && markets.length > 0) {
      consecutiveBadCycles += 1;
      const backoff = Math.min(
        CAPTURE_INTERVAL_S * 1000 * 2 ** consecutiveBadCycles,
        MAX_BACKOFF_MS
      );
      log(`unhealthy cycle #${consecutiveBadCycles}: backing off ${Math.round(backoff / 1000)}s`);
      await sleep(backoff, undefined, { signal: shutdownController.signal }).catch(() => {});
      continue;
    }
    consecutiveBadCycles = 0;

    const elapsed = Date.now() - cycleStart;
    const wait = Math.max(0, CAPTURE_INTERVAL_S * 1000 - elapsed);
    if (wait > 0 && !stopping) {
      await sleep(wait, undefined, { signal: shutdownController.signal }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`received ${signal} — shutting down gracefully`);
  shutdownController.abort(new Error(`shutdown: ${signal}`));
  if (pool) {
    try {
      await pool.end();
      log("pg pool closed");
    } catch (err) {
      log(`pg pool close error: ${err?.message ?? err}`);
    }
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main()
  .then(async () => {
    if (pool) await pool.end().catch(() => {});
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(new Date().toISOString(), "[depth-capture] FATAL:", err?.message ?? err);
    if (pool) await pool.end().catch(() => {});
    process.exit(1);
  });
