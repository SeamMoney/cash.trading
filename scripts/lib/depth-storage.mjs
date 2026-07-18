const RAW_TABLE = "decibel_depth_snapshots";
const SUMMARY_TABLE = "decibel_depth_summaries";
const COMPACTION_LOCK = "cash.trading.depth-compaction.v1";

export async function ensureDepthStorageTables(pool) {
  await pool.query(`
    CREATE INDEX IF NOT EXISTS decibel_depth_snapshots_ts_idx
      ON ${RAW_TABLE} (ts)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SUMMARY_TABLE} (
      market_addr    text        NOT NULL,
      market_name    text        NOT NULL,
      bucket         timestamptz NOT NULL,
      sample_count   integer     NOT NULL,
      first_ts       timestamptz NOT NULL,
      last_ts        timestamptz NOT NULL,
      open_mid       double precision,
      high_mid       double precision,
      low_mid        double precision,
      close_mid      double precision,
      min_spread_bps double precision,
      avg_spread_bps double precision,
      max_spread_bps double precision,
      last_bids      jsonb       NOT NULL,
      last_asks      jsonb       NOT NULL,
      PRIMARY KEY (market_addr, bucket)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS decibel_depth_summaries_bucket_idx
      ON ${SUMMARY_TABLE} (bucket)
  `);
}

export async function getDepthStorageReport(pool, rawRetentionDays) {
  const relationResult = await pool.query(
    `SELECT
       to_regclass('public.${RAW_TABLE}') IS NOT NULL AS raw_exists,
       to_regclass('public.${SUMMARY_TABLE}') IS NOT NULL AS summary_exists`,
  );
  const { raw_exists: rawExists, summary_exists: summaryExists } = relationResult.rows[0];

  const raw = rawExists
    ? (
        await pool.query(
          `SELECT
             count(*)::bigint AS rows,
             min(ts) AS oldest,
             max(ts) AS newest,
             count(*) FILTER (
               WHERE ts < now() - make_interval(days => $1)
             )::bigint AS eligible_rows,
             count(*) FILTER (WHERE ts >= now() - interval '1 hour')::bigint AS rows_1h,
             count(*) FILTER (WHERE ts >= now() - interval '24 hours')::bigint AS rows_24h,
             count(DISTINCT market_addr) FILTER (
               WHERE ts >= now() - interval '1 hour'
             )::integer AS markets_1h,
             pg_total_relation_size($2::regclass)::bigint AS bytes
           FROM ${RAW_TABLE}`,
          [rawRetentionDays, `public.${RAW_TABLE}`],
        )
      ).rows[0]
    : {
        rows: "0",
        oldest: null,
        newest: null,
        eligible_rows: "0",
        rows_1h: "0",
        rows_24h: "0",
        markets_1h: 0,
        bytes: "0",
      };

  const summary = summaryExists
    ? (
        await pool.query(
          `SELECT
             count(*)::bigint AS rows,
             coalesce(sum(sample_count), 0)::bigint AS source_rows,
             min(bucket) AS oldest,
             max(bucket) AS newest,
             pg_total_relation_size($1::regclass)::bigint AS bytes
           FROM ${SUMMARY_TABLE}`,
          [`public.${SUMMARY_TABLE}`],
        )
      ).rows[0]
    : { rows: "0", source_rows: "0", oldest: null, newest: null, bytes: "0" };

  return { raw, summary };
}

export async function compactDepthBatch(
  pool,
  {
    rawRetentionDays,
    summaryBucketMinutes,
    summaryRetentionDays,
    batchHours,
  },
) {
  const bucketMs = summaryBucketMinutes * 60_000;
  const cutoffMs = Date.now() - rawRetentionDays * 86_400_000;
  const closedBucketCutoffMs = Math.floor(cutoffMs / bucketMs) * bucketMs;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const lock = await client.query(
      "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired",
      [COMPACTION_LOCK],
    );
    if (!lock.rows[0]?.acquired) {
      await client.query("ROLLBACK");
      return { skipped: "another compactor holds the lock", summaries: 0, deleted: 0 };
    }

    const oldestResult = await client.query(
      `SELECT min(ts) AS oldest FROM ${RAW_TABLE} WHERE ts < $1`,
      [new Date(closedBucketCutoffMs)],
    );
    const oldest = oldestResult.rows[0]?.oldest
      ? new Date(oldestResult.rows[0].oldest)
      : null;

    if (!oldest) {
      const expired = await client.query(
        `DELETE FROM ${SUMMARY_TABLE}
          WHERE bucket < now() - make_interval(days => $1)`,
        [summaryRetentionDays],
      );
      await client.query("COMMIT");
      return {
        skipped: "no closed raw buckets exceed retention",
        summaries: 0,
        deleted: 0,
        expiredSummaries: expired.rowCount,
      };
    }

    const proposedEndMs = oldest.getTime() + batchHours * 3_600_000;
    const alignedEndMs = Math.ceil(proposedEndMs / bucketMs) * bucketMs;
    const batchEndMs = Math.min(closedBucketCutoffMs, alignedEndMs);
    if (batchEndMs <= oldest.getTime()) {
      await client.query("ROLLBACK");
      return { skipped: "oldest data is in an open summary bucket", summaries: 0, deleted: 0 };
    }

    const bucketSeconds = summaryBucketMinutes * 60;
    const compacted = await client.query(
      `WITH source AS (
         SELECT
           market_addr,
           market_name,
           ts,
           bids,
           asks,
           CASE
             WHEN best_bid IS NOT NULL AND best_ask IS NOT NULL
               AND best_bid > 0 AND best_ask > 0
             THEN (best_bid + best_ask) / 2.0
           END AS mid,
           CASE
             WHEN best_bid IS NOT NULL AND best_ask IS NOT NULL
               AND best_bid > 0 AND best_ask > 0
             THEN ((best_ask - best_bid) / ((best_bid + best_ask) / 2.0)) * 10000.0
           END AS spread_bps,
           to_timestamp(
             floor(extract(epoch FROM ts) / $2::double precision)
             * $2::double precision
           ) AS bucket
         FROM ${RAW_TABLE}
         WHERE ts < $1
       ), rollups AS (
         SELECT
           market_addr,
           (array_agg(market_name ORDER BY ts DESC))[1] AS market_name,
           bucket,
           count(*)::integer AS sample_count,
           min(ts) AS first_ts,
           max(ts) AS last_ts,
           (array_agg(mid ORDER BY ts ASC) FILTER (WHERE mid IS NOT NULL))[1] AS open_mid,
           max(mid) AS high_mid,
           min(mid) AS low_mid,
           (array_agg(mid ORDER BY ts DESC) FILTER (WHERE mid IS NOT NULL))[1] AS close_mid,
           min(spread_bps) AS min_spread_bps,
           avg(spread_bps) AS avg_spread_bps,
           max(spread_bps) AS max_spread_bps,
           (array_agg(bids ORDER BY ts DESC))[1] AS last_bids,
           (array_agg(asks ORDER BY ts DESC))[1] AS last_asks
         FROM source
         GROUP BY market_addr, bucket
       )
       INSERT INTO ${SUMMARY_TABLE} (
         market_addr, market_name, bucket, sample_count, first_ts, last_ts,
         open_mid, high_mid, low_mid, close_mid,
         min_spread_bps, avg_spread_bps, max_spread_bps,
         last_bids, last_asks
       )
       SELECT
         market_addr, market_name, bucket, sample_count, first_ts, last_ts,
         open_mid, high_mid, low_mid, close_mid,
         min_spread_bps, avg_spread_bps, max_spread_bps,
         last_bids, last_asks
       FROM rollups
       ON CONFLICT (market_addr, bucket) DO UPDATE SET
         market_name = EXCLUDED.market_name,
         sample_count = EXCLUDED.sample_count,
         first_ts = EXCLUDED.first_ts,
         last_ts = EXCLUDED.last_ts,
         open_mid = EXCLUDED.open_mid,
         high_mid = EXCLUDED.high_mid,
         low_mid = EXCLUDED.low_mid,
         close_mid = EXCLUDED.close_mid,
         min_spread_bps = EXCLUDED.min_spread_bps,
         avg_spread_bps = EXCLUDED.avg_spread_bps,
         max_spread_bps = EXCLUDED.max_spread_bps,
         last_bids = EXCLUDED.last_bids,
         last_asks = EXCLUDED.last_asks
       RETURNING 1`,
      [new Date(batchEndMs), bucketSeconds],
    );

    const deleted = await client.query(
      `DELETE FROM ${RAW_TABLE} WHERE ts < $1`,
      [new Date(batchEndMs)],
    );
    const expired = await client.query(
      `DELETE FROM ${SUMMARY_TABLE}
        WHERE bucket < now() - make_interval(days => $1)`,
      [summaryRetentionDays],
    );
    await client.query("COMMIT");

    return {
      batchEnd: new Date(batchEndMs).toISOString(),
      summaries: compacted.rowCount,
      deleted: deleted.rowCount,
      expiredSummaries: expired.rowCount,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function formatBytes(raw) {
  const bytes = Number(raw || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}
