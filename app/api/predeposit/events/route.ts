import { NextRequest, NextResponse } from 'next/server'
import { getMainnetUserDepositEvents } from '@/lib/mainnet-predeposit'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const account = searchParams.get('account')
  const limit = parseInt(searchParams.get('limit') || '100')

  if (!account) {
    return NextResponse.json({ error: 'Missing account parameter' }, { status: 400 })
  }

  try {
    const events = await getMainnetUserDepositEvents(account, { limit })
    return NextResponse.json({ events, total: events.length })
  } catch (error) {
    console.error('Error fetching balance events:', error)
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 })
  }
}
