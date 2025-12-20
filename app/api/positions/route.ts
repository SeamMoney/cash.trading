import { NextRequest, NextResponse } from 'next/server'
import { getMarkPrice } from '@/lib/price-feed'
import { createAuthenticatedAptos } from '@/lib/decibel-sdk'

// Market configs for size/price decimals
const MARKET_CONFIG: Record<string, { pxDecimals: number; szDecimals: number }> = {
  'BTC/USD': { pxDecimals: 6, szDecimals: 8 },
  'APT/USD': { pxDecimals: 6, szDecimals: 4 },
  'WLFI/USD': { pxDecimals: 6, szDecimals: 3 },
  'SOL/USD': { pxDecimals: 6, szDecimals: 6 },
  'ETH/USD': { pxDecimals: 6, szDecimals: 7 },
  'XRP/USD': { pxDecimals: 6, szDecimals: 4 },
  'LINK/USD': { pxDecimals: 6, szDecimals: 5 },
  'AAVE/USD': { pxDecimals: 6, szDecimals: 6 },
  'ENA/USD': { pxDecimals: 6, szDecimals: 3 },
  'HYPE/USD': { pxDecimals: 6, szDecimals: 5 },
}

export const runtime = 'nodejs'

/**
 * GET /api/positions - Fetch all open positions for a subaccount
 * Query params: userSubaccount (required)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userSubaccount = searchParams.get('userSubaccount')

    if (!userSubaccount) {
      return NextResponse.json(
        { error: 'userSubaccount is required' },
        { status: 400 }
      )
    }

    const aptos = createAuthenticatedAptos()
    const positions: Array<{
      market: string
      marketAddress: string
      direction: 'long' | 'short'
      size: number
      sizeRaw: number
      entryPrice: number
      currentPrice?: number
      pnlPercent?: number
      pnlUsd?: number
      leverage?: number
      notionalValue?: number
    }> = []

    // Fetch all positions from on-chain
    const resources = await aptos.getAccountResources({
      accountAddress: userSubaccount
    })

    const positionsResource = resources.find((r: any) =>
      r.type.includes('perp_positions::UserPositions')
    )

    if (!positionsResource) {
      return NextResponse.json({ positions: [] })
    }

    const data = positionsResource.data as any
    const entries = data.positions?.root?.children?.entries || []

    // Process each position
    for (const entry of entries) {
      const pos = entry.value?.value
      const sizeRaw = parseInt(pos?.size || '0')
      if (!pos || sizeRaw === 0) continue

      const marketAddr = entry.key?.inner

      // Look up market name by fetching market config from chain
      let marketName = 'Unknown'
      let pxDecimals = 6
      let szDecimals = 6

      try {
        const marketRes = await fetch(
          `https://api.testnet.aptoslabs.com/v1/accounts/${marketAddr}/resources`
        )
        const marketResources = await marketRes.json()
        const configResource = marketResources.find((r: any) =>
          r.type.includes('perp_market_config::PerpMarketConfig')
        )
        if (configResource?.data?.name) {
          marketName = configResource.data.name
          const mktConfig = MARKET_CONFIG[marketName]
          if (mktConfig) {
            pxDecimals = mktConfig.pxDecimals
            szDecimals = mktConfig.szDecimals
          }
        }
      } catch (e) {
        console.warn(`Could not fetch market info for ${marketAddr}`)
      }

      // Convert values
      const size = sizeRaw / Math.pow(10, szDecimals)
      const entryPrice = parseInt(pos.avg_acquire_entry_px) / Math.pow(10, pxDecimals)
      const leverage = pos.user_leverage || 1
      const direction = pos.is_long ? 'long' : 'short'

      // Fetch current price
      let currentPrice: number | undefined
      let pnlPercent: number | undefined
      let pnlUsd: number | undefined
      let notionalValue: number | undefined

      try {
        const priceData = await getMarkPrice(marketAddr, 'testnet', 2000)
        if (priceData) {
          currentPrice = priceData.markPx
        } else {
          // Fallback to on-chain oracle
          const priceRes = await fetch(
            `https://api.testnet.aptoslabs.com/v1/accounts/${marketAddr}/resources`
          )
          const priceResources = await priceRes.json()
          const priceResource = priceResources.find((r: any) =>
            r.type.includes('price_management::Price')
          )
          if (priceResource) {
            currentPrice = Number(priceResource.data.oracle_px) / Math.pow(10, pxDecimals)
          }
        }

        if (currentPrice && entryPrice) {
          pnlPercent = pos.is_long
            ? ((currentPrice - entryPrice) / entryPrice) * 100
            : ((entryPrice - currentPrice) / entryPrice) * 100

          notionalValue = size * entryPrice
          pnlUsd = (pnlPercent / 100) * notionalValue
        }
      } catch (e) {
        console.warn(`Could not fetch price for ${marketName}`)
      }

      positions.push({
        market: marketName,
        marketAddress: marketAddr,
        direction: direction as 'long' | 'short',
        size,
        sizeRaw,
        entryPrice,
        currentPrice,
        pnlPercent,
        pnlUsd,
        leverage,
        notionalValue,
      })
    }

    return NextResponse.json({ positions })
  } catch (error) {
    console.error('Error fetching positions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch positions', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
