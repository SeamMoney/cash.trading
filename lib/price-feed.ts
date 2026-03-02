/**
 * Price feed helper to get mark prices from Decibel WebSocket
 *
 * Updated Feb 3, 2026:
 * - API responses may now use { items: [], total: x } format
 */

import WebSocket from 'ws'
import { normalizeArrayResponse } from './api-helpers'
import { getActiveNetwork } from './decibel-sdk'

const TESTNET_WS_URL = 'wss://api.testnet.aptoslabs.com/decibel/ws'
const MAINNET_WS_URL = 'wss://api.mainnet.aptoslabs.com/decibel/ws'

// Market address mapping (testnet — for mainnet, use MAINNET_MARKETS from decibel-client)
export const MARKET_ADDRESSES: Record<string, string> = {
  'BTC/USD': '0x6e9c93c836abebdcf998a7defdd56cd067b6db50127db5d51b000ccfc483b90a',
  'ETH/USD': '0x0dd1772998bb9bbb1189ef7d680353f1b97adb947b178167b03ace95dd2fcf8e',
  'SOL/USD': '0x2b67f9e6b9bb4b83e952058d3e6b17a8970f74175f3c00db4d0c787d86e69fe7',
  'APT/USD': '0x57ba43880ee443eebd5021af91d5a8156fb3e04247c97c30912e6501c187a428',
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
  network: 'testnet' | 'mainnet' = getActiveNetwork(),
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
          // Handle both array and { items: [], total: x } formats
          const pricesArray = normalizeArrayResponse<MarketPrice>(msg.prices)
          const marketPrice = pricesArray.find(
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
  network: 'testnet' | 'mainnet' = getActiveNetwork()
): Promise<{ markPx: number; oraclePx: number; midPx: number } | null> {
  const marketAddress = MARKET_ADDRESSES[marketName]
  if (!marketAddress) {
    console.warn(`Unknown market: ${marketName}`)
    return null
  }
  return getMarkPrice(marketAddress, network)
}
