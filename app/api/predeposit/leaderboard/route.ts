import { NextRequest, NextResponse } from 'next/server'
import { getMainnetLeaderboard } from '@/lib/mainnet-predeposit'

export const revalidate = 60 // Cache for 60 seconds

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const limit = parseInt(searchParams.get('limit') || '100')
  const offset = parseInt(searchParams.get('offset') || '0')

  try {
    const leaderboard = await getMainnetLeaderboard({ limit, offset })
    return NextResponse.json({
      entries: leaderboard,
      total: leaderboard.length,
      offset,
      limit,
    })
  } catch (error) {
    console.error('Error fetching leaderboard:', error)
    return NextResponse.json({ entries: [], total: 0, offset, limit })
  }
}
