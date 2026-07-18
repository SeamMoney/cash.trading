import { NextRequest, NextResponse } from 'next/server'
import pg from 'pg'

import {
  compactDepthBatch,
  ensureDepthStorageTables,
} from '@/scripts/lib/depth-storage.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RAW_RETENTION_DAYS = 3
const SUMMARY_BUCKET_MINUTES = 15
const SUMMARY_RETENTION_DAYS = 365
const COMPACTION_BATCH_HOURS = 6
const MAX_BATCHES_PER_RUN = 6
const SOFT_DEADLINE_MS = 50_000

/**
 * Daily safety net for the always-on depth worker.
 *
 * The worker also compacts its own data, but this protected Vercel job keeps
 * Neon bounded if an older worker process remains alive or is restarted from
 * stale code. Vercel supplies `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    return NextResponse.json({ error: 'Depth compaction cron is not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    return NextResponse.json({ error: 'Depth storage database is not configured' }, { status: 503 })
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
  })

  try {
    await ensureDepthStorageTables(pool)
    const startedAt = Date.now()
    const results: Array<Awaited<ReturnType<typeof compactDepthBatch>>> = []
    for (let index = 0; index < MAX_BATCHES_PER_RUN; index += 1) {
      if (Date.now() - startedAt >= SOFT_DEADLINE_MS) break
      const result = await compactDepthBatch(pool, {
        rawRetentionDays: RAW_RETENTION_DAYS,
        summaryBucketMinutes: SUMMARY_BUCKET_MINUTES,
        summaryRetentionDays: SUMMARY_RETENTION_DAYS,
        batchHours: COMPACTION_BATCH_HOURS,
      })
      results.push(result)
      if (result.skipped || result.deleted === 0) break
    }

    return NextResponse.json({
      ok: true,
      policy: {
        rawRetentionDays: RAW_RETENTION_DAYS,
        summaryBucketMinutes: SUMMARY_BUCKET_MINUTES,
        summaryRetentionDays: SUMMARY_RETENTION_DAYS,
      },
      batches: results,
      elapsedMs: Date.now() - startedAt,
    })
  } catch (error) {
    console.error(
      '[depth-compact] failed',
      error instanceof Error ? error.message : 'unknown error',
    )
    return NextResponse.json({ error: 'Depth compaction failed' }, { status: 500 })
  } finally {
    await pool.end().catch(() => {})
  }
}
