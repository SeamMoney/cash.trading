import { isValidAptosAddress, normalizeAptosAddress } from '@/lib/decibel'

const MAINNET_API_URL = 'https://api.mainnet.aptoslabs.com/decibel/api/v1'
const REQUEST_TIMEOUT_MS = 5_000

function apiKey(): string {
  const key = (
    process.env.GEOMI_API_KEY ||
    process.env.APTOS_NODE_API_KEY ||
    process.env.APTOS_API_KEY ||
    ''
  ).replace(/\r?\n/g, '').trim()
  if (!key) throw new Error('Decibel API key is not configured')
  return key
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(`${MAINNET_API_URL}${path}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Decibel points request failed (${response.status})`)
  return response.json() as Promise<unknown>
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Decibel returned invalid ${label}`)
  }
  return value as Record<string, unknown>
}

function finiteNonnegative(value: unknown, label: string): number {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    throw new Error(`Decibel returned invalid ${label}`)
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Decibel returned invalid ${label}`)
  }
  return number
}

function finite(value: unknown, label: string): number {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    throw new Error(`Decibel returned invalid ${label}`)
  }
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`Decibel returned invalid ${label}`)
  return number
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    throw new Error(`Decibel returned invalid ${label}`)
  }
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Decibel returned invalid ${label}`)
  }
  return number
}

export interface DecibelGlobalPoints {
  totalUsers: number
  totalAmpsDistributed: number
}

export async function getDecibelGlobalPoints(): Promise<DecibelGlobalPoints> {
  const data = record(await fetchJson('/points/global'), 'global points')
  return {
    totalUsers: nonnegativeInteger(data.total_users, 'points user count'),
    totalAmpsDistributed: finiteNonnegative(
      data.total_amps_distributed,
      'distributed amps',
    ),
  }
}

export interface DecibelPointsEntry {
  rank: number
  owner: string
  totalAmps: number
  tradingAmps: number
  referralAmps: number
  vaultAmps: number
  streakAmps: number
  bonusAmps: number
  realizedPnl: number
}

function parsePointsEntry(value: unknown): DecibelPointsEntry {
  const item = record(value, 'points leaderboard entry')
  if (!isValidAptosAddress(item.owner)) {
    throw new Error('Decibel returned an invalid points owner')
  }
  const totalAmps = finiteNonnegative(item.total_amps, 'total amps')
  const referralAmps = finiteNonnegative(item.referral_amps, 'referral amps')
  const vaultAmps = finiteNonnegative(item.vault_amps, 'vault amps')
  const streakAmps = finiteNonnegative(item.streak_amps, 'streak amps')
  const bonusAmps = finiteNonnegative(item.bonus_amps, 'bonus amps')
  const tradingAmps = Math.max(
    0,
    totalAmps - referralAmps - vaultAmps - streakAmps - bonusAmps,
  )

  return {
    rank: nonnegativeInteger(item.rank, 'points rank'),
    owner: normalizeAptosAddress(item.owner, 'points owner'),
    totalAmps,
    tradingAmps,
    referralAmps,
    vaultAmps,
    streakAmps,
    bonusAmps,
    realizedPnl: finite(item.realized_pnl, 'realized PnL'),
  }
}

export const DECIBEL_TIER_FILTERS = ['top20', 'diamond', 'doublePlatinum', 'gold'] as const
export type DecibelTierFilter = (typeof DECIBEL_TIER_FILTERS)[number]

export function isDecibelTierFilter(value: unknown): value is DecibelTierFilter {
  return typeof value === 'string' && (DECIBEL_TIER_FILTERS as readonly string[]).includes(value)
}

export async function getDecibelPointsLeaderboard(options: {
  limit: number
  offset: number
  searchTerm?: string
  tier?: DecibelTierFilter
}): Promise<{ entries: DecibelPointsEntry[]; total: number }> {
  const params = new URLSearchParams({
    limit: String(options.limit),
    offset: String(options.offset),
    sort_key: 'total_amps',
    sort_dir: 'DESC',
  })
  if (options.searchTerm) {
    if (!isValidAptosAddress(options.searchTerm)) throw new Error('Invalid Aptos account address')
    params.set('search_term', normalizeAptosAddress(options.searchTerm, 'search term'))
  }
  if (options.tier) params.set('tier', options.tier)
  const data = record(
    await fetchJson(`/points_leaderboard?${params}`),
    'points leaderboard',
  )
  if (!Array.isArray(data.items)) throw new Error('Decibel returned an invalid points leaderboard')
  return {
    entries: data.items.map(parsePointsEntry),
    total: nonnegativeInteger(data.total_count, 'points leaderboard total'),
  }
}

export async function getDecibelOwnerPoints(owner: string): Promise<DecibelPointsEntry> {
  if (!isValidAptosAddress(owner)) throw new Error('Invalid Aptos account address')
  const normalizedOwner = normalizeAptosAddress(owner, 'points owner')
  const params = new URLSearchParams({ owner: normalizedOwner })
  const data = record(await fetchJson(`/points/amps?${params}`), 'owner points')
  if (!isValidAptosAddress(data.owner)) throw new Error('Decibel returned an invalid points owner')

  const totalAmps = finiteNonnegative(data.total_amps, 'total amps')
  return {
    rank: data.rank === null ? 0 : nonnegativeInteger(data.rank, 'points rank'),
    owner: normalizeAptosAddress(data.owner, 'points owner'),
    totalAmps,
    tradingAmps: finiteNonnegative(data.trading_amps, 'trading amps'),
    referralAmps: finiteNonnegative(data.referral_amps, 'referral amps'),
    vaultAmps: finiteNonnegative(data.vault_amps, 'vault amps'),
    streakAmps: finiteNonnegative(data.streak_amps, 'streak amps'),
    bonusAmps: finiteNonnegative(data.bonus_amps, 'bonus amps'),
    realizedPnl: finite(data.realized_pnl, 'realized PnL'),
  }
}

// ---------------------------------------------------------------------------
// Tiers, streaks and the 7-day trading window. All values are AMPs; the
// legacy /points/trading/account total_points is a different unit and is
// deliberately not read here.
// ---------------------------------------------------------------------------

export const DECIBEL_TIER_NAMES = ['gold', 'doublePlatinum', 'diamond'] as const
export type DecibelTierName = (typeof DECIBEL_TIER_NAMES)[number]

export const DECIBEL_TIER_LABELS: Record<DecibelTierName, string> = {
  gold: 'Gold',
  doublePlatinum: 'Double Platinum',
  diamond: 'Diamond',
}

export interface DecibelTierThreshold {
  name: DecibelTierName
  /** AMPs required to hold the tier (upstream `hz_threshold`). */
  amps: number
  /** 0-100, for the owner the thresholds were read with. */
  progress: number
}

export interface DecibelOwnerTier {
  owner: string
  totalAmps: number
  rank: number | null
  current: DecibelTierName | null
  tiers: DecibelTierThreshold[]
}

function isTierName(value: unknown): value is DecibelTierName {
  return typeof value === 'string' && (DECIBEL_TIER_NAMES as readonly string[]).includes(value)
}

function parseTierThreshold(value: unknown): DecibelTierThreshold {
  const item = record(value, 'tier threshold')
  if (!isTierName(item.name)) throw new Error('Decibel returned an unknown tier')
  return {
    name: item.name,
    amps: finiteNonnegative(item.hz_threshold, 'tier threshold'),
    progress: Math.min(100, Math.max(0, finite(item.progress, 'tier progress'))),
  }
}

// Thresholds are global (identical for every owner), so one read serves the
// leaderboard's per-row tier column for a while without another upstream hit.
const TIER_THRESHOLD_TTL_MS = 10 * 60_000
let tierThresholdCache: { tiers: DecibelTierThreshold[]; at: number } | null = null

export async function getDecibelOwnerTier(owner: string): Promise<DecibelOwnerTier> {
  if (!isValidAptosAddress(owner)) throw new Error('Invalid Aptos account address')
  const normalizedOwner = normalizeAptosAddress(owner, 'tier owner')
  const params = new URLSearchParams({ owner: normalizedOwner })
  const data = record(await fetchJson(`/points/tier?${params}`), 'owner tier')
  if (!Array.isArray(data.tiers) || data.tiers.length === 0) {
    throw new Error('Decibel returned invalid tier thresholds')
  }
  if (data.current_tier !== null && data.current_tier !== undefined && !isTierName(data.current_tier)) {
    throw new Error('Decibel returned an unknown current tier')
  }
  const tiers = data.tiers
    .map(parseTierThreshold)
    .sort((a, b) => a.amps - b.amps)
  tierThresholdCache = {
    tiers: tiers.map((tier) => ({ ...tier, progress: 0 })),
    at: Date.now(),
  }
  return {
    owner: normalizedOwner,
    totalAmps: finiteNonnegative(data.total_amps, 'total amps'),
    rank: data.rank === null || data.rank === undefined ? null : nonnegativeInteger(data.rank, 'points rank'),
    current: isTierName(data.current_tier) ? data.current_tier : null,
    tiers,
  }
}

/**
 * Global tier thresholds. Upstream only exposes them through the per-owner
 * endpoint, so the first call borrows `seedOwner` (any real owner) and the
 * result is memoised per instance.
 */
export async function getDecibelTierThresholds(seedOwner: string): Promise<DecibelTierThreshold[]> {
  if (tierThresholdCache && Date.now() - tierThresholdCache.at < TIER_THRESHOLD_TTL_MS) {
    return tierThresholdCache.tiers
  }
  const tier = await getDecibelOwnerTier(seedOwner)
  return tier.tiers.map((item) => ({ ...item, progress: 0 }))
}

/** Highest tier whose threshold `amps` meets; null below Gold. */
export function tierForAmps(
  amps: number,
  tiers: ReadonlyArray<Pick<DecibelTierThreshold, 'name' | 'amps'>>,
): DecibelTierName | null {
  let current: DecibelTierName | null = null
  for (const tier of [...tiers].sort((a, b) => a.amps - b.amps)) {
    if (amps >= tier.amps) current = tier.name
  }
  return current
}

export interface DecibelOwnerStreak {
  owner: string
  days: number
  graceAvailable: number
  graceUsed: number
  qualifyingDays: number
}

export async function getDecibelOwnerStreak(owner: string): Promise<DecibelOwnerStreak> {
  if (!isValidAptosAddress(owner)) throw new Error('Invalid Aptos account address')
  const normalizedOwner = normalizeAptosAddress(owner, 'streak owner')
  const params = new URLSearchParams({ owner: normalizedOwner })
  const data = record(await fetchJson(`/streaks/account?${params}`), 'owner streak')
  return {
    owner: normalizedOwner,
    days: nonnegativeInteger(data.currentStreak, 'current streak'),
    graceAvailable: nonnegativeInteger(data.graceDaysAvailable, 'grace days available'),
    graceUsed: nonnegativeInteger(data.graceDaysUsed, 'grace days used'),
    qualifyingDays: Array.isArray(data.qualifyingDates) ? data.qualifyingDates.length : 0,
  }
}

/** AMPs earned in the trailing `days` window (upstream `/points/trading/amps`). */
export async function getDecibelOwnerAmpsWindow(owner: string, days: number): Promise<number> {
  if (!isValidAptosAddress(owner)) throw new Error('Invalid Aptos account address')
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw new Error('Invalid window')
  const normalizedOwner = normalizeAptosAddress(owner, 'amps owner')
  const params = new URLSearchParams({ owner: normalizedOwner, days: String(days) })
  const data = record(await fetchJson(`/points/trading/amps?${params}`), 'owner amps window')
  return finiteNonnegative(data.total_amps, 'window amps')
}
