/**
 * Price feed helper to get mark prices from Decibel WebSocket
 */

import WebSocket from 'ws'

const TESTNET_WS_URL = 'wss://api.testnet.aptoslabs.com/decibel/ws'
const MAINNET_WS_URL = 'wss://api.netna.aptoslabs.com/decibel/ws'

// Market address mapping
export const MARKET_ADDRESSES: Record<string, string> = {
  'BTC/USD': '0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e',
  'ETH/USD': '0x...',  // Add when needed
  'SOL/USD': '0x...',
  'APT/USD': '0x...',
}

export interface MarketPrice {
  market: string
  oracle_px: number
  mark_px: number
  mid_px: number
  funding_rate_bps: number
  is_funding_positive: boolean
  transaction_unix_ms: number
  open_interest: number
}

/**
 * Fetch mark price from Decibel WebSocket
 * Opens a connection, subscribes, gets the price, and closes
 */
export async function getMarkPrice(
  marketAddress: string,
  network: 'testnet' | 'mainnet' = 'testnet',
  timeoutMs: number = 5000
): Promise<{ markPx: number; oraclePx: number; midPx: number } | null> {
  const wsUrl = network === 'testnet' ? TESTNET_WS_URL : MAINNET_WS_URL

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl)
    const timeout = setTimeout(() => {
      ws.close()
      resolve(null)
    }, timeoutMs)

    ws.on('open', () => {
      ws.send(JSON.stringify({ Subscribe: { topic: 'all_market_prices' } }))
    })

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.topic === 'all_market_prices' && msg.prices) {
          const marketPrice = msg.prices.find(
            (p: MarketPrice) => p.market.toLowerCase() === marketAddress.toLowerCase()
          )
          if (marketPrice) {
            clearTimeout(timeout)
            ws.close()
            resolve({
              markPx: marketPrice.mark_px,
              oraclePx: marketPrice.oracle_px,
              midPx: marketPrice.mid_px,
            })
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    })

    ws.on('error', () => {
      clearTimeout(timeout)
      ws.close()
      resolve(null)
    })
  })
}

/**
 * Get mark price by market name
 */
export async function getMarkPriceByName(
  marketName: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): Promise<{ markPx: number; oraclePx: number; midPx: number } | null> {
  const marketAddress = MARKET_ADDRESSES[marketName]
  if (!marketAddress) {
    console.warn(`Unknown market: ${marketName}`)
    return null
  }
  return getMarkPrice(marketAddress, network)
}
