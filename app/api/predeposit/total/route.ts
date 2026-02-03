import { NextResponse } from 'next/server'
import { getPredepositTotal } from '@/lib/decibel-api'

export const revalidate = 60 // Cache for 60 seconds

export async function GET() {
  try {
    const total = await getPredepositTotal()
    if (!total) {
      // Return placeholder data if API not available yet (pre-launch)
      return NextResponse.json({
        total_points: 0,
        total_deposited: 0,
        total_dlp: 0,
        total_ua: 0,
        depositor_count: 0,
        status: 'pre-launch',
        launch_date: '2026-02-07',
      })
    }
    return NextResponse.json({ ...total, status: 'live' })
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
