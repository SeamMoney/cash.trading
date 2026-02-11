import { NextRequest, NextResponse } from 'next/server'
import { getMainnetUserBalance } from '@/lib/mainnet-predeposit'

export async function GET(request: NextRequest) {
  const account = request.nextUrl.searchParams.get('account')

  if (!account) {
    return NextResponse.json({ error: 'Missing account parameter' }, { status: 400 })
  }

  try {
    const balance = await getMainnetUserBalance(account)
    return NextResponse.json({
      account,
      points: Math.round(balance.points * 10000) / 10000,
      dlp_balance: balance.dlp_balance.toString(),
      ua_balance: balance.ua_balance.toString(),
      total_deposited: balance.total_deposited.toString(),
    })
  } catch (error) {
    console.error('Error fetching user data:', error)
    return NextResponse.json({ error: 'Failed to fetch user data' }, { status: 500 })
  }
}
