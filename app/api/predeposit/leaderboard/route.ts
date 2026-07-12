import { NextRequest, NextResponse } from 'next/server'
import { getMainnetLeaderboard } from '@/lib/mainnet-predeposit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const parsedLimit = Number.parseInt(searchParams.get('limit') || '100', 10)
  const parsedOffset = Number.parseInt(searchParams.get('offset') || '0', 10)
  const limit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 100
  const offset = Number.isFinite(parsedOffset) ? Math.min(10_000, Math.max(0, parsedOffset)) : 0

  try {
    const leaderboard = await getMainnetLeaderboard({ limit, offset })
    return NextResponse.json(
      {
        entries: leaderboard,
        total: leaderboard.length,
        offset,
        limit,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
    )
  } catch (error) {
    console.error('Error fetching leaderboard:', error)
    return NextResponse.json(
      { entries: [], total: 0, offset, limit },
      { headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60' } },
    )
  }
}
