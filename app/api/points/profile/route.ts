import { NextRequest, NextResponse } from 'next/server'
import { checkApiRateLimit } from '@/lib/api-rate-limit'
import { isValidAptosAddress, normalizeAptosAddress } from '@/lib/decibel'
import {
  getDecibelOwnerAmpsWindow,
  getDecibelOwnerPoints,
  getDecibelOwnerStreak,
  getDecibelOwnerTier,
  type DecibelTierName,
} from '@/lib/decibel-points'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
// Every upstream call burns Geomi credit; let the CDN absorb repeat views.
const CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' }

export type PointsProfilePiece = 'points' | 'tier' | 'streak' | 'last7d'

type NextTier = { name: DecibelTierName; needed: number; progress: number } | null

export interface PointsProfile {
  owner: string
  rank: number | null
  totalAmps: number | null
  bySource: { trading: number; vault: number; referral: number; streak: number; bonus: number } | null
  realizedPnl: number | null
  tier: { current: DecibelTierName | null; next: NextTier } | null
  streak: { days: number; graceLeft: number; graceTotal: number } | null
  last7d: number | null
  unavailable: PointsProfilePiece[]
  season: 1
  fetchedAt: number
}

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, 'points-profile', 30, 60_000)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate limited', retryAfterS: rate.retryAfterS },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(rate.retryAfterS ?? 60) } },
    )
  }

  const rawOwner = request.nextUrl.searchParams.get('owner')
  if (!isValidAptosAddress(rawOwner)) {
    return NextResponse.json(
      { error: 'A valid Aptos owner address is required' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  const owner = normalizeAptosAddress(rawOwner, 'owner')

  const [points, tier, streak, last7d] = await Promise.allSettled([
    getDecibelOwnerPoints(owner),
    getDecibelOwnerTier(owner),
    getDecibelOwnerStreak(owner),
    getDecibelOwnerAmpsWindow(owner, 7),
  ])

  const unavailable: PointsProfilePiece[] = []
  if (points.status === 'rejected') unavailable.push('points')
  if (tier.status === 'rejected') unavailable.push('tier')
  if (streak.status === 'rejected') unavailable.push('streak')
  if (last7d.status === 'rejected') unavailable.push('last7d')

  if (unavailable.length === 4) {
    const reason = points.status === 'rejected' && points.reason instanceof Error ? points.reason.message : 'unknown'
    console.error('Error fetching points profile:', reason)
    return NextResponse.json(
      { unavailable: true, error: 'Points are temporarily unavailable' },
      { status: 502, headers: NO_STORE_HEADERS },
    )
  }

  const pointsValue = points.status === 'fulfilled' ? points.value : null
  const tierValue = tier.status === 'fulfilled' ? tier.value : null
  const streakValue = streak.status === 'fulfilled' ? streak.value : null

  // /points/amps and /points/tier both carry rank + total; either one is enough.
  const totalAmps = pointsValue?.totalAmps ?? tierValue?.totalAmps ?? null
  const rank = pointsValue ? pointsValue.rank || null : tierValue?.rank ?? null

  let nextTier: NextTier = null
  if (tierValue && totalAmps != null) {
    const next = tierValue.tiers.find((item) => totalAmps < item.amps)
    if (next) {
      nextTier = {
        name: next.name,
        needed: Math.max(0, next.amps - totalAmps),
        progress: next.amps > 0 ? Math.min(100, Math.max(0, (totalAmps / next.amps) * 100)) : 100,
      }
    }
  }

  const profile: PointsProfile = {
    owner,
    rank,
    totalAmps,
    bySource: pointsValue
      ? {
          trading: pointsValue.tradingAmps,
          vault: pointsValue.vaultAmps,
          referral: pointsValue.referralAmps,
          streak: pointsValue.streakAmps,
          bonus: pointsValue.bonusAmps,
        }
      : null,
    realizedPnl: pointsValue?.realizedPnl ?? null,
    tier: tierValue ? { current: tierValue.current, next: nextTier } : null,
    streak: streakValue
      ? {
          days: streakValue.days,
          graceLeft: Math.max(0, streakValue.graceAvailable - streakValue.graceUsed),
          graceTotal: streakValue.graceAvailable,
        }
      : null,
    last7d: last7d.status === 'fulfilled' ? last7d.value : null,
    unavailable,
    season: 1,
    fetchedAt: Date.now(),
  }

  // A partial profile is still useful, but don't let the CDN pin a gap for
  // ten minutes — only fully-resolved profiles get the long cache.
  return NextResponse.json(profile, { headers: unavailable.length ? NO_STORE_HEADERS : CACHE_HEADERS })
}
