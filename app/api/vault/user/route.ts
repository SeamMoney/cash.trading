import { NextRequest, NextResponse } from 'next/server'
import { getAccountVaultPerformance } from '@/lib/decibel-api'
import { checkApiRateLimit } from '@/lib/api-rate-limit'
import { isValidAptosAddress, normalizeAptosAddress } from '@/lib/decibel'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, 'vault-user', 30, 60_000)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate limited', retryAfterS: rate.retryAfterS },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(rate.retryAfterS ?? 60) } },
    )
  }
  const account = request.nextUrl.searchParams.get('account')

  if (!isValidAptosAddress(account)) {
    return NextResponse.json(
      { error: 'A valid account parameter is required' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  const normalizedAccount = normalizeAptosAddress(account, 'account')

  try {
    const performances = await getAccountVaultPerformance(normalizedAccount, 'mainnet', true)

    // Sum across all vaults the user has deposited into
    let totalDeposited = 0
    let currentValue = 0
    let totalPnl = 0
    const vaults: Array<{
      name: string
      address: string
      deposited: number
      currentValue: number
      pnl: number
      shares: number
      vaultType: string | null
    }> = []

    for (const p of performances) {
      const deposited = p.total_deposited ?? 0
      const value = p.current_value_of_shares ?? 0
      const pnl = p.all_time_earned ?? (value - deposited)

      totalDeposited += deposited
      currentValue += value
      totalPnl += pnl

      vaults.push({
        name: p.vault?.name || 'Unknown Vault',
        address: p.vault?.address || '',
        deposited,
        currentValue: value,
        pnl,
        shares: p.current_num_shares ?? 0,
        vaultType: p.vault?.vault_type || null,
      })
    }

    return NextResponse.json({
      account: normalizedAccount,
      totalDeposited,
      currentValue,
      totalPnl,
      vaults,
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Vault user lookup failed'
    console.error('Error fetching vault user data:', message)
    return NextResponse.json(
      { unavailable: true, error: 'Vault data is temporarily unavailable' },
      { status: 502, headers: NO_STORE_HEADERS },
    )
  }
}
