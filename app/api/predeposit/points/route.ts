import { NextRequest, NextResponse } from 'next/server'
import { getDecibelOwnerPoints } from '@/lib/decibel-points'
import { checkApiRateLimit } from '@/lib/api-rate-limit'
import { isValidAptosAddress, normalizeAptosAddress } from '@/lib/decibel'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, 'predeposit-points', 60, 60_000)
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
    const points = await getDecibelOwnerPoints(normalizedAccount)
    return NextResponse.json({
      account: points.owner,
      points: Math.round(points.totalAmps * 10000) / 10000,
      rank: points.rank || null,
      trading_points: points.tradingAmps,
      vault_points: points.vaultAmps,
      referral_points: points.referralAmps,
      streak_points: points.streakAmps,
      bonus_points: points.bonusAmps,
      season: 1,
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Points lookup failed'
    console.error('Error fetching points:', message)
    return NextResponse.json(
      { unavailable: true, error: 'Points are temporarily unavailable' },
      { status: 502, headers: NO_STORE_HEADERS },
    )
  }
}
