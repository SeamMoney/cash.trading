import { NextRequest, NextResponse } from 'next/server'
import { getPredepositLeaderboard } from '@/lib/decibel-api'

export const revalidate = 30 // Cache for 30 seconds

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const limit = parseInt(searchParams.get('limit') || '100')
  const offset = parseInt(searchParams.get('offset') || '0')

  try {
    const leaderboard = await getPredepositLeaderboard({ limit, offset })
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
