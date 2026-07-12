/**
 * Mainnet Predeposit Data Module
 *
 * Fetches predeposit data directly from Aptos mainnet:
 * - Fullnode view functions for real-time balances and global stats
 * - Indexer GraphQL for depositor list (with server-side caching)
 * - Client-side points calculation based on time-weighted formula
 */

import { isValidAptosAddress, normalizeAptosAddress } from '@/lib/decibel'

// Mainnet constants
export const MAINNET_PACKAGE = '0xc5939ec6e7e656cb6fed9afa155e390eb2aa63ba74e73157161829b2f80e1538'
export const MAINNET_PREDEPOSIT_OBJECT = '0xbd0c23dbc2e9ac041f5829f79b4c4c1361ddfa2125d5072a96b817984a013d69'
export const MAINNET_USDC_METADATA = '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b'
export const USDC_DECIMALS = 6

const FULLNODE_URL = process.env.APTOS_MAINNET_FULLNODE_URL || 'https://api.mainnet.aptoslabs.com/v1'
const INDEXER_URL = process.env.APTOS_MAINNET_INDEXER_URL || 'https://api.mainnet.aptoslabs.com/v1/graphql'
const FULLNODE_TIMEOUT_MS = 5_000

// Anonymous indexer queries hit Geomi's per-IP rate limits (429s flip DLP/points
// to $0). Authenticate server-side with whichever Aptos/Geomi key is configured.
function aptosAuthHeaders(): Record<string, string> {
  const key = (
    process.env.APTOS_API_KEY_MAINNET ||
    process.env.APTOS_NODE_API_KEY_MAINNET ||
    process.env.GEOMI_API_KEY_MAINNET ||
    process.env.APTOS_API_KEY ||
    process.env.APTOS_NODE_API_KEY ||
    process.env.GEOMI_API_KEY ||
    ''
  ).trim()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

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
    headers: aptosAuthHeaders(),
    body: JSON.stringify({
      function: `${MAINNET_PACKAGE}::predeposit::${functionId}`,
      type_arguments: typeArgs,
      arguments: args,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(FULLNODE_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`View function ${functionId} failed (${response.status})`)
  }

  const data = await response.json() as unknown
  if (!Array.isArray(data)) throw new Error(`View function ${functionId} returned invalid data`)
  return data as string[]
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
    if (
      !Number.isFinite(dlpTotalUsd) ||
      !Number.isFinite(uaTotalUsd) ||
      !Number.isFinite(dlpCapUsd) ||
      dlpTotalUsd < 0 ||
      uaTotalUsd < 0 ||
      dlpCapUsd < 0
    ) {
      throw new Error('Predeposit global stats returned invalid data')
    }

    // Get depositor count from cached depositor list
    const depositors = await getMainnetDepositors()
    const depositorCount = depositors.length

    // Calculate total points based on time-weighted deposits
    const totalPoints = calculateTotalPoints(depositors)

    const pausedValue = isPaused[0] as unknown
    const isDepositPaused = pausedValue === true || pausedValue === 'true'

    const stats: MainnetGlobalStats = {
      total_deposited: dlpTotalUsd + uaTotalUsd,
      total_dlp: dlpTotalUsd,
      total_ua: uaTotalUsd,
      dlp_cap: dlpCapUsd,
      depositor_count: depositorCount,
      total_points: totalPoints,
      is_deposit_paused: isDepositPaused,
      status: isDepositPaused ? 'paused' : 'live',
    }

    globalStatsCache = { data: stats, timestamp: Date.now() }
    return stats
  } catch (error) {
    console.error('Error fetching mainnet global stats:', error)
    if (globalStatsCache) return globalStatsCache.data
    throw error
  }
}

// ============================================================
// User Balance (via fullnode view function)
// ============================================================

export async function getMainnetUserBalance(userAddr: string): Promise<MainnetUserBalance> {
  if (!isValidAptosAddress(userAddr)) {
    throw new Error('Invalid Aptos account address')
  }
  const normalizedUser = normalizeAptosAddress(userAddr, 'account')
  const result = await callViewFunction('predepositor_balance', [
    MAINNET_PREDEPOSIT_OBJECT,
    normalizedUser,
  ])

  const dlpBalance = Number(result[0]) / 10 ** USDC_DECIMALS
  const uaBalance = Number(result[1]) / 10 ** USDC_DECIMALS
  if (
    !Number.isFinite(dlpBalance) ||
    !Number.isFinite(uaBalance) ||
    dlpBalance < 0 ||
    uaBalance < 0
  ) {
    throw new Error('Predeposit balance returned invalid data')
  }
  let resolvedDlpBalance = dlpBalance
  let resolvedUaBalance = uaBalance
  if (dlpBalance === 0 && uaBalance === 0) {
    const transitioned = await callViewFunction('has_depositor_transitioned', [
      MAINNET_PREDEPOSIT_OBJECT,
      normalizedUser,
    ])
    const transitionedValue = transitioned[0] as unknown
    if (transitionedValue === true || transitionedValue === 'true') {
      const contributions = await getTransitionContributions(normalizedUser)
      resolvedDlpBalance = contributions.dlp
      resolvedUaBalance = contributions.ua
    }
  }
  const totalDeposited = resolvedDlpBalance + resolvedUaBalance

  return {
    account: normalizedUser,
    dlp_balance: resolvedDlpBalance,
    ua_balance: resolvedUaBalance,
    total_deposited: totalDeposited,
    points: 0,
  }
}

// ============================================================
// Depositor List (via indexer with caching)
// ============================================================

let depositorsCache: { data: MainnetDepositor[]; timestamp: number; ttl: number } | null = null
let depositorsInFlight: Promise<MainnetDepositor[]> | null = null
const DEPOSITORS_CACHE_TTL = 300_000 // 5 minutes
const DEPOSITORS_FALLBACK_CACHE_TTL = 60_000
const INDEXER_TIMEOUT_MS = 3_500
const MAX_INDEXER_PAGES = 200
const TRANSITION_CACHE_TTL_MS = 300_000
const transitionCache = new Map<
  string,
  { data: { dlp: number; ua: number }; timestamp: number }
>()

async function getTransitionContributions(userAddr: string): Promise<{ dlp: number; ua: number }> {
  const cached = transitionCache.get(userAddr)
  if (cached && Date.now() - cached.timestamp < TRANSITION_CACHE_TTL_MS) return cached.data

  const transitionFunction = `${MAINNET_PACKAGE}::predeposit::transition_depositors`
  const query = `query {
    account_transactions(
      where: {
        account_address: { _eq: "${userAddr}" }
        user_transaction: { entry_function_id_str: { _eq: "${transitionFunction}" } }
      }
      order_by: { transaction_version: desc }
      limit: 10
    ) {
      transaction_version
    }
  }`
  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: aptosAuthHeaders(),
    body: JSON.stringify({ query }),
    cache: 'no-store',
    signal: AbortSignal.timeout(INDEXER_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Transition index lookup failed (${response.status})`)

  const payload = await response.json() as unknown
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Transition index lookup returned invalid data')
  }
  const payloadRecord = payload as Record<string, unknown>
  if (payloadRecord.errors) throw new Error('Transition index lookup returned an error')
  if (
    !payloadRecord.data ||
    typeof payloadRecord.data !== 'object' ||
    Array.isArray(payloadRecord.data)
  ) {
    throw new Error('Transition index lookup returned invalid data')
  }
  const rows = (payloadRecord.data as Record<string, unknown>).account_transactions
  if (!Array.isArray(rows)) throw new Error('Transition index lookup returned invalid data')

  const versions = rows.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Transition index lookup returned an invalid version')
    }
    const version = Number((value as Record<string, unknown>).transaction_version)
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new Error('Transition index lookup returned an invalid version')
    }
    return version
  })

  for (const version of versions) {
    const transactionResponse = await fetch(`${FULLNODE_URL}/transactions/by_version/${version}`, {
      headers: aptosAuthHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(FULLNODE_TIMEOUT_MS),
    })
    if (!transactionResponse.ok) {
      throw new Error(`Transition transaction lookup failed (${transactionResponse.status})`)
    }
    const transaction = await transactionResponse.json() as unknown
    if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
      throw new Error('Transition transaction returned invalid data')
    }
    const events = (transaction as Record<string, unknown>).events
    if (!Array.isArray(events)) throw new Error('Transition transaction returned invalid data')

    for (const value of events) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const event = value as Record<string, unknown>
      if (
        event.type !== `${MAINNET_PACKAGE}::predeposit::LaunchTransitionEvent` ||
        !event.data ||
        typeof event.data !== 'object' ||
        Array.isArray(event.data)
      ) {
        continue
      }
      const data = event.data as Record<string, unknown>
      if (
        typeof data.depositor !== 'string' ||
        !isValidAptosAddress(data.depositor) ||
        normalizeAptosAddress(data.depositor, 'depositor').toLowerCase() !==
          userAddr.toLowerCase() ||
        typeof data.dlp_contribution !== 'string' ||
        !/^\d+$/.test(data.dlp_contribution) ||
        typeof data.ua_contribution !== 'string' ||
        !/^\d+$/.test(data.ua_contribution)
      ) {
        continue
      }
      const contributions = {
        dlp: Number(data.dlp_contribution) / 10 ** USDC_DECIMALS,
        ua: Number(data.ua_contribution) / 10 ** USDC_DECIMALS,
      }
      if (
        !Number.isFinite(contributions.dlp) ||
        !Number.isFinite(contributions.ua) ||
        contributions.dlp < 0 ||
        contributions.ua < 0
      ) {
        throw new Error('Transition transaction returned invalid contributions')
      }
      transitionCache.set(userAddr, { data: contributions, timestamp: Date.now() })
      return contributions
    }
  }

  throw new Error('Transition contributions were not found')
}

export async function getMainnetDepositors(): Promise<MainnetDepositor[]> {
  // Check cache
  if (depositorsCache && Date.now() - depositorsCache.timestamp < depositorsCache.ttl) {
    return depositorsCache.data
  }
  if (depositorsInFlight) return depositorsInFlight

  depositorsInFlight = (async () => {
    try {
      const depositors = await fetchDepositorsFromIndexer()
      depositorsCache = { data: depositors, timestamp: Date.now(), ttl: DEPOSITORS_CACHE_TTL }
      return depositors
    } catch (error) {
      console.error('Error fetching depositors from indexer, using fallback:', error)
      if (depositorsCache) return depositorsCache.data
      const fallback = getSeedDepositors()
      depositorsCache = {
        data: fallback,
        timestamp: Date.now(),
        ttl: DEPOSITORS_FALLBACK_CACHE_TTL,
      }
      return fallback
    }
  })()

  try {
    return await depositorsInFlight
  } finally {
    depositorsInFlight = null
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

  while (offset / limit < MAX_INDEXER_PAGES) {
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

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), INDEXER_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(INDEXER_URL, {
        method: 'POST',
        headers: aptosAuthHeaders(),
        body: JSON.stringify({ query }),
        signal: controller.signal,
        cache: 'no-store',
      })
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      throw new Error(`Indexer query failed (${response.status})`)
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
  if (offset / limit >= MAX_INDEXER_PAGES) {
    throw new Error('Indexer pagination exceeded the safety limit')
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
  const depositTime = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(depositor.first_deposit_time)
    ? depositor.first_deposit_time
    : `${depositor.first_deposit_time}Z`
  const depositTimeMs = new Date(depositTime).getTime()
  if (!Number.isFinite(depositTimeMs) || !Number.isFinite(depositor.total_deposited)) return 0
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
  options: {
    limit?: number
    eventKind?: 'deposit' | 'withdraw' | 'promote'
  } = {}
): Promise<Array<{
  event_kind: string
  fund_type: string
  amount: string
  balance_after: string
  timestamp: number
  transaction_version: number
  tx_hash: string
}>> {
  const { limit = 50, eventKind } = options
  if (!isValidAptosAddress(userAddr)) throw new Error('Invalid Aptos account address')
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('limit must be an integer from 1 to 100')
  }
  const normalizedUser = normalizeAptosAddress(userAddr, 'account')
  const relevantFunctions = [
    `${MAINNET_PACKAGE}::predeposit::deposit`,
    `${MAINNET_PACKAGE}::predeposit::withdraw_dlp`,
    `${MAINNET_PACKAGE}::predeposit::withdraw_ua_from_entry`,
  ]

  const query = `query {
    user_transactions(
      where: {
        sender: { _eq: "${normalizedUser}" }
        entry_function_id_str: { _in: ${JSON.stringify(relevantFunctions)} }
      }
      order_by: { version: desc }
      limit: ${limit}
    ) {
      version
    }
  }`

  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: aptosAuthHeaders(),
    body: JSON.stringify({ query }),
    cache: 'no-store',
    signal: AbortSignal.timeout(INDEXER_TIMEOUT_MS),
  })

  if (!response.ok) throw new Error(`Indexer query failed (${response.status})`)

  const data = await response.json() as unknown
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Indexer returned invalid transaction data')
  }
  const dataRecord = data as Record<string, unknown>
  if (dataRecord.errors) throw new Error('Indexer returned a query error')
  if (!dataRecord.data || typeof dataRecord.data !== 'object' || Array.isArray(dataRecord.data)) {
    throw new Error('Indexer returned invalid transaction data')
  }
  const transactionRows = (dataRecord.data as Record<string, unknown>).user_transactions
  if (!Array.isArray(transactionRows)) {
    throw new Error('Indexer returned invalid transaction data')
  }
  const versions: number[] = transactionRows.map((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Indexer returned an invalid transaction version')
    }
    const version = Number((row as Record<string, unknown>).version)
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new Error('Indexer returned an invalid transaction version')
    }
    return version
  })

  const transactions: unknown[] = []
  for (let offset = 0; offset < versions.length; offset += 10) {
    const batch = await Promise.all(versions.slice(offset, offset + 10).map(async (version: number) => {
      const transactionResponse = await fetch(`${FULLNODE_URL}/transactions/by_version/${version}`, {
        headers: aptosAuthHeaders(),
        cache: 'no-store',
        signal: AbortSignal.timeout(FULLNODE_TIMEOUT_MS),
      })
      if (!transactionResponse.ok) {
        throw new Error(`Transaction ${version} lookup failed (${transactionResponse.status})`)
      }
      return transactionResponse.json() as Promise<unknown>
    }))
    transactions.push(...batch)
  }

  const parsedEvents: Array<{
    event_kind: string
    fund_type: string
    amount: string
    balance_after: string
    timestamp: number
    transaction_version: number
    tx_hash: string
  }> = []

  for (const value of transactions) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Fullnode returned invalid transaction data')
    }
    const transaction = value as Record<string, unknown>
    const transactionVersion = Number(transaction.version)
    const timestampMicros = typeof transaction.timestamp === 'string'
      ? Number(transaction.timestamp)
      : Number.NaN
    const txHash = typeof transaction.hash === 'string' ? transaction.hash : ''
    if (
      !Number.isSafeInteger(transactionVersion) ||
      transactionVersion < 0 ||
      !Number.isFinite(timestampMicros) ||
      timestampMicros < 0 ||
      !/^0x[0-9a-fA-F]{64}$/.test(txHash) ||
      !Array.isArray(transaction.events)
    ) {
      throw new Error('Fullnode returned invalid transaction fields')
    }

    for (const rawEvent of transaction.events) {
      if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) continue
      const event = rawEvent as Record<string, unknown>
      if (typeof event.type !== 'string' || !event.data || typeof event.data !== 'object') continue
      const eventData = event.data as Record<string, unknown>
      if (
        typeof eventData.depositor !== 'string' ||
        !isValidAptosAddress(eventData.depositor) ||
        normalizeAptosAddress(eventData.depositor, 'depositor').toLowerCase() !==
          normalizedUser.toLowerCase() ||
        typeof eventData.amount !== 'string' ||
        !/^\d+$/.test(eventData.amount)
      ) {
        continue
      }

      let kind: 'deposit' | 'withdraw' | 'promote' | null = null
      let fundType: 'ua' | 'dlp' = 'ua'
      if (event.type === `${MAINNET_PACKAGE}::predeposit::DepositEvent`) {
        kind = 'deposit'
      } else if (event.type === `${MAINNET_PACKAGE}::predeposit::PromoteEvent`) {
        kind = 'promote'
        fundType = 'dlp'
      } else if (event.type === `${MAINNET_PACKAGE}::predeposit::WithdrawEvent`) {
        kind = 'withdraw'
        fundType = eventData.is_dlp_else_ua === true || eventData.is_dlp_else_ua === 'true'
          ? 'dlp'
          : 'ua'
      }
      if (!kind || (eventKind && kind !== eventKind)) continue

      const rawAmount = BigInt(eventData.amount)
      const cents = (rawAmount + 5_000n) / 10_000n
      const amount = `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`
      parsedEvents.push({
        event_kind: kind,
        fund_type: fundType,
        amount,
        balance_after: '',
        timestamp: timestampMicros / 1_000_000,
        transaction_version: transactionVersion,
        tx_hash: txHash,
      })
    }
  }

  return parsedEvents.slice(0, limit)
}
