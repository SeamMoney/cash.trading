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

export async function getDecibelPointsLeaderboard(options: {
  limit: number
  offset: number
}): Promise<{ entries: DecibelPointsEntry[]; total: number }> {
  const params = new URLSearchParams({
    limit: String(options.limit),
    offset: String(options.offset),
    sort_key: 'total_amps',
    sort_dir: 'DESC',
  })
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
