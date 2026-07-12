import { NextRequest, NextResponse } from 'next/server'
import { getMainnetUserBalance } from '@/lib/mainnet-predeposit'
import { checkApiRateLimit } from '@/lib/api-rate-limit'
import { isValidAptosAddress, normalizeAptosAddress } from '@/lib/decibel'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, 'predeposit-balances', 60, 60_000)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate limited', retryAfterS: rate.retryAfterS },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(rate.retryAfterS ?? 60) } },
    )
  }
  const searchParams = request.nextUrl.searchParams
  const account = searchParams.get('account')

  if (!isValidAptosAddress(account)) {
    return NextResponse.json(
      { error: 'A valid account parameter is required' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  const normalizedAccount = normalizeAptosAddress(account, 'account')

  try {
    const balance = await getMainnetUserBalance(normalizedAccount)
    return NextResponse.json({
      account: balance.account,
      dlp_balance: balance.dlp_balance.toString(),
      ua_balance: balance.ua_balance.toString(),
      ua_positions: [],
      total_deposited: balance.total_deposited.toString(),
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Predeposit balance lookup failed'
    console.error('Error fetching predeposit balances:', message)
    return NextResponse.json(
      { unavailable: true, error: 'Predeposit balances are temporarily unavailable' },
      { status: 502, headers: NO_STORE_HEADERS },
    )
  }
}
