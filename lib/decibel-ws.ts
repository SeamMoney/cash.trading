/**
 * Decibel WebSocket API Client
 *
 * Provides methods to fetch data from Decibel's WebSocket API.
 * WebSocket is used because REST API requires authentication.
 */

import WebSocket from 'ws'

const TESTNET_WS_URL = 'wss://api.testnet.aptoslabs.com/decibel/ws'
const MAINNET_WS_URL = 'wss://api.aptoslabs.com/decibel/ws'

export interface AccountOverview {
  perp_equity_balance: number
  unrealized_pnl: number
  unrealized_funding_cost: number
  cross_margin_ratio: number
  maintenance_margin: number
  cross_account_leverage_ratio: number
  volume: number
  all_time_return: number
  pnl_90d: number
  sharpe_ratio: number
  max_drawdown: number
  weekly_win_rate_12w: number
  average_cash_position: number
  average_leverage: number
  cross_account_position: number
  total_margin: number
  usdc_cross_withdrawable_balance: number
  usdc_isolated_withdrawable_balance: number
}

export interface Trade {
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

/**
 * Fetch account overview via WebSocket
 * Note: volume field may be 0 if not tracked by Decibel for this account
 */
export async function getAccountOverview(
  userAddr: string,
  network: 'testnet' | 'mainnet' = 'testnet',
  timeoutMs: number = 10000
): Promise<AccountOverview | null> {
  const wsUrl = network === 'testnet' ? TESTNET_WS_URL : MAINNET_WS_URL

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl)
    let resolved = false

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        ws.close()
        resolve(null)
      }
    }, timeoutMs)

    ws.on('open', () => {
      ws.send(JSON.stringify({
        Subscribe: {
          topic: `account_overview:${userAddr}`
        }
      }))
    })

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString())

        if (message.account_overview) {
          if (!resolved) {
            resolved = true
            clearTimeout(timeout)
            ws.close()
            resolve(message.account_overview)
          }
        }
      } catch (e) {
        console.error('Parse error:', e)
      }
    })

    ws.on('error', () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        resolve(null)
      }
    })

    ws.on('close', () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        resolve(null)
      }
    })
  })
}

/**
 * Fetch recent trades via WebSocket
 * Note: Returns last ~50 trades, no pagination available via WebSocket
 */
export async function getRecentTrades(
  userAddr: string,
  network: 'testnet' | 'mainnet' = 'testnet',
  timeoutMs: number = 10000
): Promise<Trade[]> {
  const wsUrl = network === 'testnet' ? TESTNET_WS_URL : MAINNET_WS_URL

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl)
    const trades: Trade[] = []
    let resolved = false

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        ws.close()
        resolve(trades)
      }
    }, timeoutMs)

    ws.on('open', () => {
      ws.send(JSON.stringify({
        Subscribe: {
          topic: `user_trade_history:${userAddr}`
        }
      }))
    })

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString())

        if (message.trades) {
          trades.push(...message.trades)

          // Wait a bit for any additional messages, then resolve
          setTimeout(() => {
            if (!resolved) {
              resolved = true
              clearTimeout(timeout)
              ws.close()
              resolve(trades)
            }
          }, 1000)
        }
      } catch (e) {
        console.error('Parse error:', e)
      }
    })

    ws.on('error', () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        resolve(trades)
      }
    })

    ws.on('close', () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        resolve(trades)
      }
    })
  })
}

/**
 * Calculate volume statistics from trades
 */
export function calculateTradeStats(trades: Trade[]) {
  let totalVolume = 0
  let totalPnl = 0
  let totalFees = 0
  let wins = 0
  let losses = 0

  for (const trade of trades) {
    const volume = trade.size * trade.price
    totalVolume += volume
    totalPnl += trade.realized_pnl_amount || 0
    totalFees += trade.fee_amount || 0

    if (trade.realized_pnl_amount > 0) wins++
    else if (trade.realized_pnl_amount < 0) losses++
  }

  return {
    totalVolume,
    totalPnl,
    totalFees,
    tradeCount: trades.length,
    wins,
    losses,
    winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0
  }
}
