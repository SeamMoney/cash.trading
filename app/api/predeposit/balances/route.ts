import { NextRequest, NextResponse } from 'next/server'
import { getMainnetUserBalance } from '@/lib/mainnet-predeposit'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const account = searchParams.get('account')

  if (!account) {
    return NextResponse.json({ error: 'Missing account parameter' }, { status: 400 })
  }

  try {
    const balance = await getMainnetUserBalance(account)
    return NextResponse.json({
      account,
      dlp_balance: balance.dlp_balance.toString(),
      ua_balance: balance.ua_balance.toString(),
      ua_positions: [],
      total_deposited: balance.total_deposited.toString(),
    })
  } catch (error) {
    console.error('Error fetching predeposit balances:', error)
    return NextResponse.json({ error: 'Failed to fetch balances' }, { status: 500 })
  }
}
