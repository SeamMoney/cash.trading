import { NextRequest, NextResponse } from 'next/server'
import { checkApiRateLimit } from '@/lib/api-rate-limit'
import { getDecibelPointsLeaderboard, getDecibelTierThresholds } from '@/lib/decibel-points'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

/**
 * Global tier thresholds (AMPs needed for Gold / Double Platinum / Diamond).
 * Upstream only publishes them per owner, so the top leaderboard owner seeds
 * the read; the lib memoises the result for ten minutes per instance.
 */
export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, 'points-tiers', 30, 60_000)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate limited', retryAfterS: rate.retryAfterS },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(rate.retryAfterS ?? 60) } },
    )
  }
  try {
    const top = await getDecibelPointsLeaderboard({ limit: 1, offset: 0 })
    const seed = top.entries[0]?.owner
    if (!seed) throw new Error('Decibel returned an empty leaderboard')
    const tiers = await getDecibelTierThresholds(seed)
    return NextResponse.json(
      { tiers: tiers.map((tier) => ({ name: tier.name, amps: tier.amps })), season: 1 },
      { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tier lookup failed'
    console.error('Error fetching points tiers:', message)
    return NextResponse.json(
      { unavailable: true, tiers: [] },
      { status: 502, headers: NO_STORE_HEADERS },
    )
  }
}
