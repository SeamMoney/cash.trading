import { NextRequest, NextResponse } from 'next/server'
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk'

export const runtime = 'nodejs'

/**
 * Debug endpoint to check position and market data
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const subaccount = searchParams.get('subaccount')
    const market = searchParams.get('market')

    if (!subaccount || !market) {
      return NextResponse.json({ error: 'Missing subaccount or market' }, { status: 400 })
    }

    const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }))

    const resources = await aptos.getAccountResources({
      accountAddress: subaccount
    })

    const positionsResource = resources.find(r =>
      r.type.includes('perp_positions::UserPositions')
    )

    if (!positionsResource) {
      return NextResponse.json({
        hasPositionsResource: false,
        message: 'No UserPositions resource found'
      })
    }

    const data = positionsResource.data as any
    const entries = data.positions?.root?.children?.entries || []

    const marketPosition = entries.find((e: any) =>
      e.key.inner.toLowerCase() === market.toLowerCase()
    )

    const allPositions = entries.map((e: any) => ({
      market: e.key.inner,
      size: e.value?.value?.size,
      is_long: e.value?.value?.is_long,
      entry_px: e.value?.value?.avg_acquire_entry_px,
    }))

    return NextResponse.json({
      hasPositionsResource: true,
      targetMarket: market,
      marketFound: !!marketPosition,
      marketPosition: marketPosition ? {
        size: marketPosition.value?.value?.size,
        is_long: marketPosition.value?.value?.is_long,
        entry_px: marketPosition.value?.value?.avg_acquire_entry_px,
        parsedSize: parseInt(marketPosition.value?.value?.size || '0'),
        hasPosition: parseInt(marketPosition.value?.value?.size || '0') > 0,
      } : null,
      allPositions,
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
