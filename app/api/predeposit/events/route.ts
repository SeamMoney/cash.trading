import { NextRequest, NextResponse } from 'next/server'
import { getPredepositBalanceEvents } from '@/lib/decibel-api'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const account = searchParams.get('account')
  const eventKind = searchParams.get('event_kind') as 'deposit' | 'withdraw' | 'promote' | 'transition' | null
  const fundType = searchParams.get('fund_type') as 'ua' | 'dlp' | null
  const limit = parseInt(searchParams.get('limit') || '100')

  if (!account) {
    return NextResponse.json({ error: 'Missing account parameter' }, { status: 400 })
  }

  try {
    const events = await getPredepositBalanceEvents(account, {
      eventKind: eventKind || undefined,
      fundType: fundType || undefined,
      limit,
    })

    return NextResponse.json({ events, total: events.length })
  } catch (error) {
    console.error('Error fetching balance events:', error)
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 })
  }
}
