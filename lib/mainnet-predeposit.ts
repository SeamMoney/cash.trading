/**
 * Mainnet Predeposit Data Module
 *
 * Fetches predeposit data directly from Aptos mainnet:
 * - Fullnode view functions for real-time balances and global stats
 * - Indexer GraphQL for depositor list (with server-side caching)
 * - Client-side points calculation based on time-weighted formula
 */

// Mainnet constants
export const MAINNET_PACKAGE = '0xc5939ec6e7e656cb6fed9afa155e390eb2aa63ba74e73157161829b2f80e1538'
export const MAINNET_PREDEPOSIT_OBJECT = '0xbd0c23dbc2e9ac041f5829f79b4c4c1361ddfa2125d5072a96b817984a013d69'
export const MAINNET_USDC_METADATA = '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b'
export const USDC_DECIMALS = 6

const FULLNODE_URL = process.env.APTOS_MAINNET_FULLNODE_URL || 'https://api.mainnet.aptoslabs.com/v1'
const INDEXER_URL = process.env.APTOS_MAINNET_INDEXER_URL || 'https://api.mainnet.aptoslabs.com/v1/graphql'

// Points formula: ~0.00157 points per $1 per day (recalibrated: Decibel shows ~1049 pts for ~$18.96M)
const POINTS_PER_DOLLAR_PER_SECOND = 0.00157 / 86400 // ~1.817e-8

// Predeposit launch time (Feb 10, 2026 7:30pm ET = Feb 11, 2026 00:30 UTC)
export const PREDEPOSIT_LAUNCH_TIME = new Date('2026-02-11T00:30:00Z')

// Seed depositor data (snapshot from initial launch, used when indexer is rate limited)
import seedDepositors from './mainnet-depositors-seed.json'

// ============================================================
// Types
// ============================================================

export interface MainnetGlobalStats {
  total_deposited: number // USD
  total_dlp: number // USD
  total_ua: number // USD
  dlp_cap: number // USD
  depositor_count: number
  total_points: number
  is_deposit_paused: boolean
  status: 'live' | 'paused' | 'error'
}

export interface MainnetUserBalance {
  account: string
  dlp_balance: number // USD
  ua_balance: number // USD
  total_deposited: number // USD
  points: number
  first_deposit_time?: string
}

export interface MainnetDepositor {
  address: string
  total_deposited: number // raw USDC (6 decimals)
  deposit_count: number
  first_deposit_time: string // ISO timestamp
  last_deposit_time: string
}

export interface MainnetLeaderboardEntry {
  rank: number
  account: string
  points: number
  total_deposited: string // USD string for UI compatibility
  dlp_balance: string
  ua_balance: string
}

// ============================================================
// Fullnode View Function Helpers
// ============================================================

async function callViewFunction(
  functionId: string,
  args: string[],
  typeArgs: string[] = []
): Promise<string[]> {
  const response = await fetch(`${FULLNODE_URL}/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      function: `${MAINNET_PACKAGE}::predeposit::${functionId}`,
      type_arguments: typeArgs,
      arguments: args,
    }),
  })

  if (!response.ok) {
    throw new Error(`View function ${functionId} failed: ${response.status} ${await response.text()}`)
  }

  return response.json()
}

// ============================================================
// Global Stats (via fullnode view functions)
// ============================================================

let globalStatsCache: { data: MainnetGlobalStats; timestamp: number } | null = null
const GLOBAL_STATS_CACHE_TTL = 30_000 // 30 seconds

export async function getMainnetGlobalStats(): Promise<MainnetGlobalStats> {
  // Check cache
  if (globalStatsCache && Date.now() - globalStatsCache.timestamp < GLOBAL_STATS_CACHE_TTL) {
    return globalStatsCache.data
  }

  try {
    const [dlpTotal, uaTotal, dlpCap, isPaused] = await Promise.all([
      callViewFunction('dlp_total', [MAINNET_PREDEPOSIT_OBJECT]),
      callViewFunction('ua_total', [MAINNET_PREDEPOSIT_OBJECT]),
      callViewFunction('dlp_cap', [MAINNET_PREDEPOSIT_OBJECT]),
      callViewFunction('is_deposit_paused', [MAINNET_PREDEPOSIT_OBJECT]),
    ])

    const dlpTotalUsd = Number(dlpTotal[0]) / 10 ** USDC_DECIMALS
    const uaTotalUsd = Number(uaTotal[0]) / 10 ** USDC_DECIMALS
    const dlpCapUsd = Number(dlpCap[0]) / 10 ** USDC_DECIMALS

    // Get depositor count from cached depositor list
    const depositors = await getMainnetDepositors()
    const depositorCount = depositors.length

    // Calculate total points based on time-weighted deposits
    const totalPoints = calculateTotalPoints(depositors)

    const stats: MainnetGlobalStats = {
      total_deposited: dlpTotalUsd + uaTotalUsd,
      total_dlp: dlpTotalUsd,
      total_ua: uaTotalUsd,
      dlp_cap: dlpCapUsd,
      depositor_count: depositorCount,
      total_points: totalPoints,
      is_deposit_paused: isPaused[0] === true || isPaused[0] === 'true',
      status: isPaused[0] === true || isPaused[0] === 'true' ? 'paused' : 'live',
    }

    globalStatsCache = { data: stats, timestamp: Date.now() }
    return stats
  } catch (error) {
    console.error('Error fetching mainnet global stats:', error)
    return {
      total_deposited: 0,
      total_dlp: 0,
      total_ua: 0,
      dlp_cap: 30_000_000,
      depositor_count: 0,
      total_points: 0,
      is_deposit_paused: false,
      status: 'error',
    }
  }
}

// ============================================================
// User Balance (via fullnode view function)
// ============================================================

export async function getMainnetUserBalance(userAddr: string): Promise<MainnetUserBalance> {
  try {
    const result = await callViewFunction('predepositor_balance', [
      MAINNET_PREDEPOSIT_OBJECT,
      userAddr,
    ])

    const dlpBalance = Number(result[0]) / 10 ** USDC_DECIMALS
    const uaBalance = Number(result[1]) / 10 ** USDC_DECIMALS
    const totalDeposited = dlpBalance + uaBalance

    // Find deposit time from cached depositor list for points calculation
    const depositors = await getMainnetDepositors()
    const depositor = depositors.find(
      (d) => d.address.toLowerCase() === userAddr.toLowerCase()
    )

    const points = depositor
      ? calculateDepositorPoints(depositor)
      : calculatePointsFromAmount(totalDeposited)

    return {
      account: userAddr,
      dlp_balance: dlpBalance,
      ua_balance: uaBalance,
      total_deposited: totalDeposited,
      points,
      first_deposit_time: depositor?.first_deposit_time,
    }
  } catch (error) {
    console.error(`Error fetching balance for ${userAddr}:`, error)
    return {
      account: userAddr,
      dlp_balance: 0,
      ua_balance: 0,
      total_deposited: 0,
      points: 0,
    }
  }
}

// ============================================================
// Depositor List (via indexer with caching)
// ============================================================

let depositorsCache: { data: MainnetDepositor[]; timestamp: number } | null = null
const DEPOSITORS_CACHE_TTL = 300_000 // 5 minutes

export async function getMainnetDepositors(): Promise<MainnetDepositor[]> {
  // Check cache
  if (depositorsCache && Date.now() - depositorsCache.timestamp < DEPOSITORS_CACHE_TTL) {
    return depositorsCache.data
  }

  try {
    const depositors = await fetchDepositorsFromIndexer()
    depositorsCache = { data: depositors, timestamp: Date.now() }
    return depositors
  } catch (error) {
    console.error('Error fetching depositors from indexer, using fallback:', error)
    // Return cached data if available, even if stale
    if (depositorsCache) {
      return depositorsCache.data
    }
    // Fall back to seed data from initial launch snapshot
    return getSeedDepositors()
  }
}

function getSeedDepositors(): MainnetDepositor[] {
  return (seedDepositors as Array<{
    address: string
    total_deposited: number
    deposit_count: number
    first_deposit_time: string
    last_deposit_time: string
  }>).map((d) => ({
    address: d.address,
    total_deposited: d.total_deposited,
    deposit_count: d.deposit_count,
    first_deposit_time: d.first_deposit_time,
    last_deposit_time: d.last_deposit_time,
  }))
}

async function fetchDepositorsFromIndexer(): Promise<MainnetDepositor[]> {
  const allEvents: Array<{
    amount: number
    owner_address: string
    transaction_timestamp: string
    transaction_version: number
  }> = []

  // Paginate through all Withdraw events from predeposit::deposit calls
  let offset = 0
  const limit = 100

  while (true) {
    const query = `query {
      fungible_asset_activities(
        where: {
          asset_type: { _eq: "${MAINNET_USDC_METADATA}" }
          entry_function_id_str: { _eq: "${MAINNET_PACKAGE}::predeposit::deposit" }
          type: { _eq: "0x1::fungible_asset::Withdraw" }
        }
        order_by: { transaction_timestamp: asc }
        limit: ${limit}
        offset: ${offset}
      ) {
        transaction_version
        amount
        owner_address
        transaction_timestamp
      }
    }`

    const response = await fetch(INDEXER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Indexer query failed: ${response.status} ${text}`)
    }

    const data = await response.json()

    if (data.errors) {
      throw new Error(`Indexer query error: ${data.errors[0]?.message}`)
    }

    const events = data.data?.fungible_asset_activities || []
    allEvents.push(...events)

    if (events.length < limit) break
    offset += limit
  }

  // Group by depositor address
  const depositorMap = new Map<string, MainnetDepositor>()

  for (const event of allEvents) {
    const addr = event.owner_address
    const existing = depositorMap.get(addr)

    if (existing) {
      existing.total_deposited += Number(event.amount)
      existing.deposit_count++
      if (event.transaction_timestamp < existing.first_deposit_time) {
        existing.first_deposit_time = event.transaction_timestamp
      }
      if (event.transaction_timestamp > existing.last_deposit_time) {
        existing.last_deposit_time = event.transaction_timestamp
      }
    } else {
      depositorMap.set(addr, {
        address: addr,
        total_deposited: Number(event.amount),
        deposit_count: 1,
        first_deposit_time: event.transaction_timestamp,
        last_deposit_time: event.transaction_timestamp,
      })
    }
  }

  // Sort by total deposited descending
  return Array.from(depositorMap.values()).sort(
    (a, b) => b.total_deposited - a.total_deposited
  )
}

// ============================================================
// Points Calculation
// ============================================================

function calculateDepositorPoints(depositor: MainnetDepositor): number {
  const depositTimeMs = new Date(depositor.first_deposit_time + 'Z').getTime()
  const nowMs = Date.now()
  const secondsHeld = Math.max(0, (nowMs - depositTimeMs) / 1000)
  const amountUsd = depositor.total_deposited / 10 ** USDC_DECIMALS
  return amountUsd * secondsHeld * POINTS_PER_DOLLAR_PER_SECOND
}

function calculatePointsFromAmount(amountUsd: number): number {
  // Fallback: assume deposited at launch time
  const secondsHeld = Math.max(0, (Date.now() - PREDEPOSIT_LAUNCH_TIME.getTime()) / 1000)
  return amountUsd * secondsHeld * POINTS_PER_DOLLAR_PER_SECOND
}

function calculateTotalPoints(depositors: MainnetDepositor[]): number {
  return depositors.reduce((sum, d) => sum + calculateDepositorPoints(d), 0)
}

// ============================================================
// Leaderboard (combines depositor list + points calculation)
// ============================================================

export async function getMainnetLeaderboard(
  options: { limit?: number; offset?: number } = {}
): Promise<MainnetLeaderboardEntry[]> {
  const { limit = 100, offset = 0 } = options

  const depositors = await getMainnetDepositors()

  // Calculate points for each depositor and sort by points (descending)
  const withPoints = depositors.map((d) => ({
    ...d,
    points: calculateDepositorPoints(d),
    amountUsd: d.total_deposited / 10 ** USDC_DECIMALS,
  }))

  withPoints.sort((a, b) => b.points - a.points)

  // Apply pagination and format for UI
  return withPoints.slice(offset, offset + limit).map((d, i) => ({
    rank: offset + i + 1,
    account: d.address,
    points: Math.round(d.points * 10000) / 10000,
    total_deposited: d.amountUsd.toFixed(2),
    dlp_balance: d.amountUsd.toFixed(2), // All predeposits go to DLP for now
    ua_balance: '0',
  }))
}

// ============================================================
// Deposit Events for a specific user (via indexer)
// ============================================================

export async function getMainnetUserDepositEvents(
  userAddr: string,
  options: { limit?: number } = {}
): Promise<Array<{
  event_kind: string
  fund_type: string
  amount: string
  balance_after: string
  timestamp: number
  transaction_version: number
}>> {
  const { limit = 50 } = options

  try {
    const query = `query {
      fungible_asset_activities(
        where: {
          asset_type: { _eq: "${MAINNET_USDC_METADATA}" }
          entry_function_id_str: { _eq: "${MAINNET_PACKAGE}::predeposit::deposit" }
          type: { _eq: "0x1::fungible_asset::Withdraw" }
          owner_address: { _eq: "${userAddr}" }
        }
        order_by: { transaction_timestamp: desc }
        limit: ${limit}
      ) {
        transaction_version
        amount
        transaction_timestamp
      }
    }`

    const response = await fetch(INDEXER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })

    if (!response.ok) throw new Error(`Indexer query failed: ${response.status}`)

    const data = await response.json()
    if (data.errors) throw new Error(data.errors[0]?.message)

    const events = data.data?.fungible_asset_activities || []

    return events.map((e: { amount: number; transaction_timestamp: string; transaction_version: number }) => ({
      event_kind: 'deposit',
      fund_type: 'dlp',
      amount: (Number(e.amount) / 10 ** USDC_DECIMALS).toFixed(2),
      balance_after: '0', // Would need cumulative calc
      timestamp: new Date(e.transaction_timestamp + 'Z').getTime() / 1000,
      transaction_version: Number(e.transaction_version),
    }))
  } catch (error) {
    console.error(`Error fetching deposit events for ${userAddr}:`, error)
    return []
  }
}
