#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  compactDepthBatch,
  ensureDepthStorageTables,
  formatBytes,
  getDepthStorageReport,
} from "./lib/depth-storage.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv() {
  const explicitFile = (process.env.ENV_FILE || "").trim();
  const names = explicitFile
    ? [explicitFile]
    : [".env.local", ".env.production", ".env"];
  for (const name of names) {
    let raw;
    try {
      raw = readFileSync(resolve(REPO_ROOT, name), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  }
}

function positiveInt(raw, fallback) {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function printReport(report, rawRetentionDays) {
  console.log("Depth storage report");
  console.log(
    `  raw: ${Number(report.raw.rows).toLocaleString()} rows, ${formatBytes(report.raw.bytes)}, ` +
      `${report.raw.oldest ?? "no oldest timestamp"} -> ${report.raw.newest ?? "no newest timestamp"}`,
  );
  console.log(
    `  eligible for ${rawRetentionDays}d compaction: ` +
      `${Number(report.raw.eligible_rows).toLocaleString()} rows`,
  );
  console.log(
    `  ingest: ${Number(report.raw.rows_1h).toLocaleString()} rows/1h across ` +
      `${Number(report.raw.markets_1h).toLocaleString()} markets; ` +
      `${Number(report.raw.rows_24h).toLocaleString()} rows/24h`,
  );
  console.log(
    `  summaries: ${Number(report.summary.rows).toLocaleString()} rows, ` +
      `${Number(report.summary.source_rows).toLocaleString()} represented raw samples, ` +
      `${formatBytes(report.summary.bytes)}, ` +
      `${report.summary.oldest ?? "no oldest timestamp"} -> ${report.summary.newest ?? "no newest timestamp"}`,
  );
}

loadDotEnv();

const DATABASE_URL = (process.env.DATABASE_URL || "").trim();
const RAW_RETENTION_DAYS = positiveInt(process.env.RAW_RETENTION_DAYS, 3);
const SUMMARY_BUCKET_MINUTES = positiveInt(process.env.SUMMARY_BUCKET_MINUTES, 15);
const SUMMARY_RETENTION_DAYS = positiveInt(process.env.SUMMARY_RETENTION_DAYS, 365);
const COMPACTION_BATCH_HOURS = positiveInt(process.env.COMPACTION_BATCH_HOURS, 6);
const MAX_BATCHES = positiveInt(process.env.MAX_BATCHES, 1);
const APPLY = process.env.APPLY === "1";
const CONFIRMED = process.env.CONFIRM_DEPTH_COMPACTION === "compact";

if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL is not set. No database connection was attempted.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });

try {
  const before = await getDepthStorageReport(pool, RAW_RETENTION_DAYS);
  printReport(before, RAW_RETENTION_DAYS);
  console.log(
    `  policy: ${RAW_RETENTION_DAYS}d raw -> ${SUMMARY_BUCKET_MINUTES}m summaries ` +
      `for ${SUMMARY_RETENTION_DAYS}d; ${COMPACTION_BATCH_HOURS}h per batch`,
  );

  if (!APPLY) {
    console.log("DRY RUN: no schema or data changes were made.");
    console.log(
      "To compact, rerun with APPLY=1 CONFIRM_DEPTH_COMPACTION=compact. " +
        "Each invocation processes a bounded number of batches.",
    );
  } else if (!CONFIRMED) {
    console.error(
      "REFUSED: APPLY=1 also requires CONFIRM_DEPTH_COMPACTION=compact. No changes were made.",
    );
    process.exitCode = 2;
  } else {
    await ensureDepthStorageTables(pool);
    for (let index = 0; index < MAX_BATCHES; index += 1) {
      const result = await compactDepthBatch(pool, {
        rawRetentionDays: RAW_RETENTION_DAYS,
        summaryBucketMinutes: SUMMARY_BUCKET_MINUTES,
        summaryRetentionDays: SUMMARY_RETENTION_DAYS,
        batchHours: COMPACTION_BATCH_HOURS,
      });
      console.log(`  batch ${index + 1}: ${JSON.stringify(result)}`);
      if (result.skipped || result.deleted === 0) break;
    }
    const after = await getDepthStorageReport(pool, RAW_RETENTION_DAYS);
    printReport(after, RAW_RETENTION_DAYS);
    console.log(
      "Compaction completed. Deleted pages are reusable immediately; Neon may report " +
        "lower physical storage only after its normal garbage-collection cycle.",
    );
  }
} catch (error) {
  console.error("FATAL:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
