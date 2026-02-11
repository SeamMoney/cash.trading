import { NextResponse } from 'next/server'
import { getMainnetGlobalStats } from '@/lib/mainnet-predeposit'

export const revalidate = 30 // Cache for 30 seconds

export async function GET() {
  try {
    const stats = await getMainnetGlobalStats()
    return NextResponse.json({
      total_points: Math.round(stats.total_points * 10000) / 10000,
      total_deposited: stats.total_deposited,
      total_dlp: stats.total_dlp,
      total_ua: stats.total_ua,
      depositor_count: stats.depositor_count,
      dlp_cap: stats.dlp_cap,
      status: stats.status,
    })
  } catch (error) {
    console.error('Error fetching predeposit total:', error)
    return NextResponse.json({
      total_points: 0,
      total_deposited: 0,
      total_dlp: 0,
      total_ua: 0,
      depositor_count: 0,
      status: 'error',
    })
  }
}
