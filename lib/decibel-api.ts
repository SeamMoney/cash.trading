/**
 * Decibel REST API Client
 *
 * Provides authenticated access to Decibel's REST API endpoints.
 * Requires GEOMI_API_KEY environment variable.
 *
 * Updated Feb 3, 2026:
 * - API responses now use { items: [], total: x } format for list endpoints
 * - Rate limit: 200 req/30s via Geomi API key
 */

import { normalizeArrayResponse } from './api-helpers'

const TESTNET_API_URL = 'https://api.testnet.aptoslabs.com/decibel/api/v1'
const MAINNET_API_URL = 'https://api.mainnet.aptoslabs.com/decibel/api/v1'

export type VolumeWindow = '7d' | '14d' | '30d' | '90d'

export interface DecibelAccountOverview {
  perp_equity_balance: number
  unrealized_pnl: number
  realized_pnl: number
  // Liquidation/backstop-specific fields (present on testnet)
  liquidation_fees_paid?: number | null
  liquidation_losses?: number | null
  unrealized_funding_cost: number
  cross_margin_ratio: number
  maintenance_margin: number
  cross_account_leverage_ratio: number
  cross_account_position: number
  total_margin: number
  usdc_cross_withdrawable_balance: number
  usdc_isolated_withdrawable_balance: number
  // Volume (requires volume_window param)
  volume?: number
  // Net deposits (present in account overview response)
  net_deposits?: number | null
  // Performance metrics (requires include_performance param)
  all_time_return?: number | null
  pnl_90d?: number | null
  sharpe_ratio?: number | null
  max_drawdown?: number | null
  weekly_win_rate_12w?: number | null
  average_cash_position?: number | null
  average_leverage?: number | null
}

export interface DecibelTrade {
  account: string
  market: string
  action: string
  trade_id: number
  size: number
  price: number
  is_profit: boolean
  realized_pnl_amount: number
  is_funding_positive: boolean
  realized_funding_amount: number
  is_rebate: boolean
  fee_amount: number
  order_id: string
  client_order_id: string
  transaction_unix_ms: number
  transaction_version: number
}

export interface DecibelOpenOrder {
  parent: string
  market: string
  client_order_id: string
  order_id: string
  status: string
  order_type: string
  trigger_condition: string
  order_direction: string
  orig_size: number
  remaining_size: number
  size_delta: number | null
  price: number
  is_buy: boolean
  is_reduce_only: boolean
  details: string
  tp_order_id: string | null
  tp_trigger_price: number | null
  tp_limit_price: number | null
  sl_order_id: string | null
  sl_trigger_price: number | null
  sl_limit_price: number | null
  transaction_version: number
  unix_ms: number
}

/**
 * Get the API key from environment
 */
function getApiKey(): string {
  const apiKey = process.env.GEOMI_API_KEY
  if (!apiKey) {
    throw new Error('GEOMI_API_KEY environment variable is not set')
  }
  // Clean key to prevent "invalid HTTP header (authorization)" errors
  return apiKey.replace(/\r?\n/g, '').trim()
}

/**
 * Get base URL for the specified network
 */
function getBaseUrl(network: 'testnet' | 'mainnet' = 'testnet'): string {
  return network === 'testnet' ? TESTNET_API_URL : MAINNET_API_URL
}

/**
 * Fetch account overview from Decibel REST API
 *
 * @param userAddr - User's wallet or subaccount address
 * @param options - Optional parameters
 * @returns Account overview with equity, PnL, volume, and performance metrics
 */
export async function getDecibelAccountOverview(
  userAddr: string,
  options: {
    network?: 'testnet' | 'mainnet'
    volumeWindow?: VolumeWindow
    includePerformance?: boolean
    performanceLookbackDays?: number
  } = {}
): Promise<DecibelAccountOverview | null> {
  const {
    network = 'testnet',
    volumeWindow = '30d',
    includePerformance = false,
    performanceLookbackDays = 90
  } = options

  try {
    const baseUrl = getBaseUrl(network)
    const apiKey = getApiKey()

    const params = new URLSearchParams({
      user: userAddr,
      volume_window: volumeWindow,
    })

    if (includePerformance) {
      params.set('include_performance', 'true')
      params.set('performance_lookback_days', performanceLookbackDays.toString())
    }

    const response = await fetch(`${baseUrl}/account_overviews?${params}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })

    if (!response.ok) {
      console.error(`Decibel API error: ${response.status} ${response.statusText}`)
      return null
    }

    return await response.json()
  } catch (error) {
    console.error('Error fetching Decibel account overview:', error)
    return null
  }
}

/**
 * Fetch trade history from Decibel REST API
 *
 * @param userAddr - User's wallet or subaccount address
 * @param options - Optional parameters
 * @returns Array of trades
 */
export async function getDecibelTradeHistory(
  userAddr: string,
  options: {
    network?: 'testnet' | 'mainnet'
    limit?: number
    offset?: number
    market?: string
    orderId?: string
  } = {}
): Promise<DecibelTrade[]> {
  const {
    network = 'testnet',
    limit = 100,
    offset = 0,
    market,
    orderId
  } = options

  try {
    const baseUrl = getBaseUrl(network)
    const apiKey = getApiKey()

    const params = new URLSearchParams({
      user: userAddr,
      limit: limit.toString(),
      offset: offset.toString(),
    })

    if (market) params.set('market', market)
    if (orderId) params.set('order_id', orderId)

    const response = await fetch(`${baseUrl}/trade_history?${params}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })

    if (!response.ok) {
      console.error(`Decibel API error: ${response.status} ${response.statusText}`)
      return []
    }

    // Handle both array (legacy) and paginated (new) response formats
    const data = await response.json()
    return normalizeArrayResponse<DecibelTrade>(data)
  } catch (error) {
    console.error('Error fetching Decibel trade history:', error)
    return []
  }
}

/**
 * Fetch open orders for a user/subaccount from Decibel REST API
 *
 * NOTE: API docs use `account` + `pagination[limit]`/`pagination[offset]`, but the
 * testnet endpoint also accepts `user` + `limit`/`offset` (consistent with other endpoints).
 */
export async function getDecibelOpenOrders(
  userAddr: string,
  options: {
    network?: 'testnet' | 'mainnet'
    limit?: number
    offset?: number
    market?: string
  } = {}
): Promise<{ items: DecibelOpenOrder[]; total_count?: number }> {
  const {
    network = 'testnet',
    limit = 100,
    offset = 0,
    market,
  } = options

  try {
    const baseUrl = getBaseUrl(network)
    const apiKey = getApiKey()

    const params = new URLSearchParams({
      user: userAddr,
      limit: limit.toString(),
      offset: offset.toString(),
    })

    if (market) params.set('market', market)

    const response = await fetch(`${baseUrl}/open_orders?${params}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })

    if (!response.ok) {
      console.error(`Decibel API error: ${response.status} ${response.statusText}`)
      return { items: [], total_count: 0 }
    }

    const data = await response.json()
    // Expected: { items: [...], total_count: N }
    if (Array.isArray(data)) {
      return { items: data as DecibelOpenOrder[] }
    }
    return { items: (data?.items || []) as DecibelOpenOrder[], total_count: data?.total_count }
  } catch (error) {
    console.error('Error fetching Decibel open orders:', error)
    return { items: [], total_count: 0 }
  }
}

/**
 * Get volume for a user from Decibel
 * Convenience function that returns just the volume
 *
 * @param userAddr - User's wallet or subaccount address
 * @param volumeWindow - Time window for volume calculation
 * @param network - Network to query
 * @returns Volume in USD or null if unavailable
 */
export async function getDecibelVolume(
  userAddr: string,
  volumeWindow: VolumeWindow = '30d',
  network: 'testnet' | 'mainnet' = 'testnet'
): Promise<number | null> {
  const overview = await getDecibelAccountOverview(userAddr, {
    network,
    volumeWindow,
  })

  return overview?.volume ?? null
}

/**
 * Format volume for display
 */
export function formatVolume(volume: number): string {
  if (volume >= 1_000_000) {
    return `$${(volume / 1_000_000).toFixed(2)}M`
  } else if (volume >= 1_000) {
    return `$${(volume / 1_000).toFixed(2)}K`
  } else {
    return `$${volume.toFixed(2)}`
  }
}

// ============================================
// PREDEPOSIT API ENDPOINTS
// ============================================

export interface PredepositPoints {
  account: string
  points: number
}

export interface PredepositDlpBalance {
  account: string
  balance: string // Decimal string
}

export interface PredepositUaPosition {
  position_id: string
  balance: string
  timestamp: number
}

export interface PredepositBalanceEvent {
  event_kind: 'deposit' | 'withdraw' | 'promote' | 'transition'
  fund_type: 'ua' | 'dlp'
  amount: string
  balance_after: string
  timestamp: number
  transaction_version: number
}

export interface PredepositTotal {
  total_points: number
  total_deposited: number
  total_dlp: number
  total_ua: number
  depositor_count: number
}

export interface LeaderboardEntry {
  rank: number
  account: string
  points: number
  dlp_balance: string
  ua_balance: string
  total_deposited: string
}

/**
 * Get predeposit points for a user
 */
export async function getPredepositPoints(
  userAddr: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): Promise<PredepositPoints | null> {
  try {
    const baseUrl = getBaseUrl(network)
    const apiKey = getApiKey()

    const response = await fetch(`${baseUrl}/predeposits/points?account=${userAddr}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })

    if (!response.ok) return null
    return await response.json()
  } catch (error) {
    console.error('Error fetching predeposit points:', error)
    return null
  }
}

/**
 * Get DLP balance for a user
 */
export async function getPredepositDlpBalance(
  userAddr: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): Promise<PredepositDlpBalance | null> {
  try {
    const baseUrl = getBaseUrl(network)
    const apiKey = getApiKey()

    const response = await fetch(`${baseUrl}/predeposits/positions/dlp?account=${userAddr}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })

    if (!response.ok) return null
    return await response.json()
  } catch (error) {
    console.error('Error fetching DLP balance:', error)
    return null
  }
}

/**
 * Get UA positions for a user
 */
export async function getPredepositUaPositions(
  userAddr: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): Promise<PredepositUaPosition[]> {
  try {
    const baseUrl = getBaseUrl(network)
    const apiKey = getApiKey()

    const response = await fetch(`${baseUrl}/predeposits/positions/ua?account=${userAddr}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })

    if (!response.ok) return []
    const data = await response.json()
    return normalizeArrayResponse<PredepositUaPosition>(data)
  } catch (error) {
    console.error('Error fetching UA positions:', error)
    return []
  }
}

/**
 * Get predeposit balance event history for a user
 */
export async function getPredepositBalanceEvents(
  userAddr: string,
  options: {
    network?: 'testnet' | 'mainnet'
    eventKind?: 'deposit' | 'withdraw' | 'promote' | 'transition'
    fundType?: 'ua' | 'dlp'
    limit?: number
  } = {}
): Promise<PredepositBalanceEvent[]> {
  const { network = 'testnet', eventKind, fundType, limit = 100 } = options

  try {
    const baseUrl = getBaseUrl(network)
    const apiKey = getApiKey()

    const params = new URLSearchParams({
      account: userAddr,
      limit: limit.toString(),
    })
    if (eventKind) params.set('event_kind', eventKind)
    if (fundType) params.set('fund_type', fundType)

    const response = await fetch(`${baseUrl}/predeposits/balance_events?${params}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })

    if (!response.ok) return []
    const data = await response.json()
    return normalizeArrayResponse<PredepositBalanceEvent>(data)
  } catch (error) {
    console.error('Error fetching balance events:', error)
    return []
  }
}

/**
 * Get total predeposit stats (Season 0)
 */
export async function getPredepositTotal(
  network: 'testnet' | 'mainnet' = 'testnet'
): Promise<PredepositTotal | null> {
  try {
    const baseUrl = getBaseUrl(network)
    const apiKey = getApiKey()

    const response = await fetch(`${baseUrl}/predeposits/total`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })

    if (!response.ok) return null
    return await response.json()
  } catch (error) {
    console.error('Error fetching predeposit total:', error)
    return null
  }
}

/**
 * Get predeposit leaderboard
 */
export async function getPredepositLeaderboard(
  options: {
    network?: 'testnet' | 'mainnet'
    limit?: number
    offset?: number
  } = {}
): Promise<LeaderboardEntry[]> {
  const { network = 'testnet', limit = 100, offset = 0 } = options

  try {
    const baseUrl = getBaseUrl(network)
    const apiKey = getApiKey()

    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    })

    const response = await fetch(`${baseUrl}/leaderboard?${params}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })

    if (!response.ok) return []
    const data = await response.json()
    return normalizeArrayResponse<LeaderboardEntry>(data)
  } catch (error) {
    console.error('Error fetching leaderboard:', error)
    return []
  }
}
