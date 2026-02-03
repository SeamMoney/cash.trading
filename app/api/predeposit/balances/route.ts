import { NextRequest, NextResponse } from 'next/server'
import { getPredepositDlpBalance, getPredepositUaPositions } from '@/lib/decibel-api'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const account = searchParams.get('account')

  if (!account) {
    return NextResponse.json({ error: 'Missing account parameter' }, { status: 400 })
  }

  try {
    const [dlpBalance, uaPositions] = await Promise.all([
      getPredepositDlpBalance(account),
      getPredepositUaPositions(account),
    ])

    const totalUa = uaPositions.reduce((sum, p) => sum + parseFloat(p.balance || '0'), 0)

    return NextResponse.json({
      account,
      dlp_balance: dlpBalance?.balance || '0',
      ua_balance: totalUa.toString(),
      ua_positions: uaPositions,
      total_deposited: (parseFloat(dlpBalance?.balance || '0') + totalUa).toString(),
    })
  } catch (error) {
    console.error('Error fetching predeposit balances:', error)
    return NextResponse.json({ error: 'Failed to fetch balances' }, { status: 500 })
  }
}
