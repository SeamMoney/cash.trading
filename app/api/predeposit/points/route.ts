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
      points: Math.round(balance.points * 10000) / 10000,
    })
  } catch (error) {
    console.error('Error fetching predeposit points:', error)
    return NextResponse.json({ error: 'Failed to fetch points' }, { status: 500 })
  }
}
