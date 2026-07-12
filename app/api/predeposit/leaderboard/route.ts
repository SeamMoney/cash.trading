import { NextRequest, NextResponse } from 'next/server'
import { getDecibelPointsLeaderboard } from '@/lib/decibel-points'
import { checkApiRateLimit } from '@/lib/api-rate-limit'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, 'predeposit-leaderboard', 30, 60_000)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate limited', retryAfterS: rate.retryAfterS },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(rate.retryAfterS ?? 60) } },
    )
  }
  const searchParams = request.nextUrl.searchParams
  const rawLimit = searchParams.get('limit') || '100'
  const rawOffset = searchParams.get('offset') || '0'
  const limit = Number(rawLimit)
  const offset = Number(rawOffset)
  if (
    !/^\d{1,3}$/.test(rawLimit) ||
    !/^\d{1,5}$/.test(rawOffset) ||
    !Number.isInteger(limit) ||
    !Number.isInteger(offset) ||
    limit < 1 ||
    limit > 100 ||
    offset < 0 ||
    offset > 10_000
  ) {
    return NextResponse.json(
      { error: 'limit or offset is invalid' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    const leaderboard = await getDecibelPointsLeaderboard({ limit, offset })
    return NextResponse.json(
      {
        entries: leaderboard.entries.map((entry) => ({
          rank: entry.rank,
          account: entry.owner,
          points: entry.totalAmps,
          vault_points: entry.vaultAmps,
          trading_points: entry.tradingAmps,
          referral_points: entry.referralAmps,
          streak_points: entry.streakAmps,
          bonus_points: entry.bonusAmps,
          total_deposited: '0',
          dlp_balance: '0',
          ua_balance: '0',
        })),
        total: leaderboard.total,
        offset,
        limit,
        season: 1,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Leaderboard lookup failed'
    console.error('Error fetching leaderboard:', message)
    return NextResponse.json(
      { unavailable: true, entries: [], total: 0, offset, limit },
      { status: 502, headers: NO_STORE_HEADERS },
    )
  }
}
