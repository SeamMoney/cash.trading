import { NextRequest, NextResponse } from 'next/server'
import { getPredepositPoints } from '@/lib/decibel-api'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const account = searchParams.get('account')

  if (!account) {
    return NextResponse.json({ error: 'Missing account parameter' }, { status: 400 })
  }

  try {
    const points = await getPredepositPoints(account)
    if (!points) {
      return NextResponse.json({ account, points: 0 })
    }
    return NextResponse.json(points)
  } catch (error) {
    console.error('Error fetching predeposit points:', error)
    return NextResponse.json({ error: 'Failed to fetch points' }, { status: 500 })
  }
}
