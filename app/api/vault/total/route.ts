import { NextRequest, NextResponse } from 'next/server'
import { getVaults } from '@/lib/decibel-api'
import { checkApiRateLimit } from '@/lib/api-rate-limit'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, 'vault-total', 30, 60_000)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate limited', retryAfterS: rate.retryAfterS },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(rate.retryAfterS ?? 60) } },
    )
  }
  try {
    const result = await getVaults({ network: 'mainnet', limit: 1000, strict: true })

    // Keep all-vault TVL separate from protocol DLP TVL. The dashboard
    // displays both and must not silently hide user-managed vaults.
    let totalTvl = 0
    let protocolTvl = 0
    let totalDepositors = 0
    const activeVaults = result.items.filter((vault) => vault.status === 'active')

    for (const vault of activeVaults) {
      const tvl = Number(vault.tvl ?? 0)
      const depositors = Number(vault.depositors ?? 0)
      if (!Number.isFinite(tvl) || tvl < 0 || !Number.isFinite(depositors) || depositors < 0) {
        throw new Error('Decibel vaults returned invalid totals')
      }
      totalTvl += tvl
      if (vault.vault_type === 'protocol') protocolTvl += tvl
      totalDepositors += depositors
    }

    return NextResponse.json({
      totalTvl,
      protocolTvl,
      totalDepositors,
      vaultCount: activeVaults.length,
      vaults: activeVaults.map(v => ({
        name: v.name,
        address: v.address,
        tvl: v.tvl,
        depositors: v.depositors,
        allTimeReturn: v.all_time_return,
        pastMonthReturn: v.past_month_return,
      })),
    }, { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=300' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Vault total lookup failed'
    console.error('Error fetching vault totals:', message)
    return NextResponse.json(
      { unavailable: true, totalTvl: 0, totalDepositors: 0, vaultCount: 0, vaults: [] },
      { status: 502, headers: NO_STORE_HEADERS },
    )
  }
}
