import { NextRequest, NextResponse } from 'next/server'
import { getDecibelGlobalPoints } from '@/lib/decibel-points'
import { checkApiRateLimit } from '@/lib/api-rate-limit'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, 'predeposit-total', 60, 60_000)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate limited', retryAfterS: rate.retryAfterS },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(rate.retryAfterS ?? 60) } },
    )
  }
  try {
    const stats = await getDecibelGlobalPoints()
    return NextResponse.json(
      {
        total_points: Math.round(stats.totalAmpsDistributed * 10000) / 10000,
        total_deposited: 0,
        total_dlp: 0,
        total_ua: 0,
        depositor_count: stats.totalUsers,
        status: 'live',
        season: 1,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=300' } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Points total lookup failed'
    console.error('Error fetching points total:', message)
    return NextResponse.json(
      {
        unavailable: true,
        total_points: 0,
        total_deposited: 0,
        total_dlp: 0,
        total_ua: 0,
        depositor_count: 0,
        status: 'error',
      },
      { status: 502, headers: NO_STORE_HEADERS },
    )
  }
}
