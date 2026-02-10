import { NextRequest, NextResponse } from 'next/server'
import { getDecibelAccountOverview } from '@/lib/decibel-api'

export const runtime = 'nodejs'

// Decibel testnet DLP vault backstop_liquidator subaccount
const DLP_VAULT_SUBACCOUNT = '0x1aa8a40a749aacc063fd541f17ab13bd1e87f3eca8de54d73b6552263571e3d9'

function toNumberMaybe(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function netPnl(ov: any): number {
  // account_overviews exposes liquidation_losses separately (negative when losing).
  // We include it for a "true" net view.
  const realized = toNumberMaybe(ov?.realized_pnl)
  const unrealized = toNumberMaybe(ov?.unrealized_pnl)
  const liqLosses = toNumberMaybe(ov?.liquidation_losses)
  const liqFees = toNumberMaybe(ov?.liquidation_fees_paid)
  return realized + unrealized + liqLosses - liqFees
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const cloneSubaccount = searchParams.get('cloneSubaccount') || ''

    if (!cloneSubaccount || !cloneSubaccount.startsWith('0x')) {
      return NextResponse.json({ error: 'Missing/invalid cloneSubaccount' }, { status: 400 })
    }

    const [clone, dlp] = await Promise.all([
      getDecibelAccountOverview(cloneSubaccount, { includePerformance: true }),
      getDecibelAccountOverview(DLP_VAULT_SUBACCOUNT, { includePerformance: true }),
    ])

    if (!clone) {
      return NextResponse.json({ error: 'Failed to fetch clone account overview' }, { status: 502 })
    }
    if (!dlp) {
      return NextResponse.json({ error: 'Failed to fetch DLP vault account overview' }, { status: 502 })
    }

    return NextResponse.json({
      ts_unix_ms: Date.now(),
      cloneSubaccount,
      dlpSubaccount: DLP_VAULT_SUBACCOUNT,
      clone,
      dlp,
      clone_net_pnl: netPnl(clone),
      dlp_net_pnl: netPnl(dlp),
      net_pnl_diff: netPnl(clone) - netPnl(dlp),
    })
  } catch (error) {
    console.error('DLP benchmark API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

