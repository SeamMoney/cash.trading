import { NextRequest, NextResponse } from 'next/server'
import { getMainnetUserDepositEvents } from '@/lib/mainnet-predeposit'
import { checkApiRateLimit } from '@/lib/api-rate-limit'
import { isValidAptosAddress, normalizeAptosAddress } from '@/lib/decibel'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, 'predeposit-events', 30, 60_000)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate limited', retryAfterS: rate.retryAfterS },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(rate.retryAfterS ?? 60) } },
    )
  }
  const searchParams = request.nextUrl.searchParams
  const account = searchParams.get('account')
  const rawLimit = searchParams.get('limit') || '100'
  const limit = Number(rawLimit)
  const rawEventKind = searchParams.get('event_kind')
  const eventKind = rawEventKind === 'deposit' || rawEventKind === 'withdraw' ||
    rawEventKind === 'promote'
    ? rawEventKind
    : undefined

  if (
    !isValidAptosAddress(account) ||
    !/^\d{1,3}$/.test(rawLimit) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (rawEventKind !== null && eventKind === undefined)
  ) {
    return NextResponse.json(
      { error: 'A valid account, event kind, and limit from 1 to 100 are required' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  const normalizedAccount = normalizeAptosAddress(account, 'account')

  try {
    const events = await getMainnetUserDepositEvents(normalizedAccount, { limit, eventKind })
    return NextResponse.json(
      { events, total: events.length },
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Predeposit event lookup failed'
    console.error('Error fetching balance events:', message)
    return NextResponse.json(
      { unavailable: true, error: 'Predeposit events are temporarily unavailable' },
      { status: 502, headers: NO_STORE_HEADERS },
    )
  }
}
