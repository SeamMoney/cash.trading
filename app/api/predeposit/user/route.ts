import { NextRequest, NextResponse } from 'next/server'
import { getMainnetUserBalance } from '@/lib/mainnet-predeposit'
import { getDecibelOwnerPoints } from '@/lib/decibel-points'
import { checkApiRateLimit } from '@/lib/api-rate-limit'
import { isValidAptosAddress, normalizeAptosAddress } from '@/lib/decibel'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, 'predeposit-user', 60, 60_000)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate limited', retryAfterS: rate.retryAfterS },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(rate.retryAfterS ?? 60) } },
    )
  }
  const account = request.nextUrl.searchParams.get('account')

  if (!isValidAptosAddress(account)) {
    return NextResponse.json(
      { error: 'A valid account parameter is required' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  const normalizedAccount = normalizeAptosAddress(account, 'account')

  try {
    const [balance, points] = await Promise.all([
      getMainnetUserBalance(normalizedAccount),
      getDecibelOwnerPoints(normalizedAccount),
    ])
    return NextResponse.json({
      account: balance.account,
      points: Math.round(points.totalAmps * 10000) / 10000,
      rank: points.rank || null,
      trading_points: points.tradingAmps,
      vault_points: points.vaultAmps,
      referral_points: points.referralAmps,
      streak_points: points.streakAmps,
      bonus_points: points.bonusAmps,
      dlp_balance: balance.dlp_balance.toString(),
      ua_balance: balance.ua_balance.toString(),
      total_deposited: balance.total_deposited.toString(),
      season: 1,
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Predeposit user lookup failed'
    console.error('Error fetching user data:', message)
    return NextResponse.json(
      { unavailable: true, error: 'Predeposit user data is temporarily unavailable' },
      { status: 502, headers: NO_STORE_HEADERS },
    )
  }
}
