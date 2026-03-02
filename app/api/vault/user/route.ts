import { NextRequest, NextResponse } from 'next/server'
import { getAccountVaultPerformance } from '@/lib/decibel-api'

export async function GET(request: NextRequest) {
  const account = request.nextUrl.searchParams.get('account')

  if (!account) {
    return NextResponse.json({ error: 'Missing account parameter' }, { status: 400 })
  }

  try {
    const performances = await getAccountVaultPerformance(account)

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
      account,
      totalDeposited,
      currentValue,
      totalPnl,
      vaults,
    })
  } catch (error) {
    console.error('Error fetching vault user data:', error)
    return NextResponse.json({ error: 'Failed to fetch vault data' }, { status: 500 })
  }
}
