import { NextResponse } from 'next/server'
import { getVaults } from '@/lib/decibel-api'

export const revalidate = 30

export async function GET() {
  try {
    const result = await getVaults({ vaultType: 'protocol' })

    // Sum up protocol vault stats
    let totalTvl = 0
    let totalDepositors = 0

    for (const vault of result.items) {
      totalTvl += vault.tvl ?? 0
      totalDepositors += vault.depositors ?? 0
    }

    return NextResponse.json({
      totalTvl: result.total_value_locked ?? totalTvl,
      totalDepositors,
      vaultCount: result.items.length,
      vaults: result.items.map(v => ({
        name: v.name,
        address: v.address,
        tvl: v.tvl,
        depositors: v.depositors,
        allTimeReturn: v.all_time_return,
        pastMonthReturn: v.past_month_return,
      })),
    })
  } catch (error) {
    console.error('Error fetching vault totals:', error)
    return NextResponse.json({ totalTvl: 0, totalDepositors: 0, vaultCount: 0, vaults: [] })
  }
}
