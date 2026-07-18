import { NextRequest, NextResponse } from 'next/server'

import { checkApiRateLimit } from '@/lib/api-rate-limit'
import {
  buildDecibelBuilderApprovalPayload,
  getDecibelBuilderStatus,
} from '@/lib/decibel-builder'
import {
  isValidAptosAddress,
  normalizeAptosAddress,
  resolveDecibelNetwork,
} from '@/lib/decibel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

function rateLimited(rate: { retryAfterS?: number }) {
  return NextResponse.json(
    { error: 'rate limited', retryAfterS: rate.retryAfterS },
    {
      status: 429,
      headers: {
        ...NO_STORE_HEADERS,
        'Retry-After': String(rate.retryAfterS ?? 60),
      },
    },
  )
}

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, 'decibel-builder-read', 60, 60_000)
  if (!rate.allowed) return rateLimited(rate)
  const rawSubaccount = request.nextUrl.searchParams.get('subaccount')
  if (!isValidAptosAddress(rawSubaccount)) {
    return NextResponse.json(
      { error: 'A valid Decibel subaccount is required' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  const network = resolveDecibelNetwork(request.nextUrl.searchParams.get('network'))
  const status = await getDecibelBuilderStatus({
    network,
    subaccount: normalizeAptosAddress(rawSubaccount, 'subaccount'),
    signal: request.signal,
  })
  return NextResponse.json(status, { headers: NO_STORE_HEADERS })
}

export async function POST(request: NextRequest) {
  const rate = checkApiRateLimit(request, 'decibel-builder-build', 20, 60_000)
  if (!rate.allowed) return rateLimited(rate)
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'A valid JSON object is required' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  const input = body as { action?: unknown; network?: unknown; subaccount?: unknown }
  if (
    (input.action !== 'approve' && input.action !== 'revoke') ||
    !isValidAptosAddress(input.subaccount) ||
    (input.network !== undefined && input.network !== 'mainnet' && input.network !== 'testnet')
  ) {
    return NextResponse.json(
      { error: 'action, network, or subaccount is invalid' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  const network = resolveDecibelNetwork(input.network)
  try {
    const payload = buildDecibelBuilderApprovalPayload({
      action: input.action,
      network,
      subaccount: input.subaccount,
    })
    const status = await getDecibelBuilderStatus({
      network,
      subaccount: input.subaccount,
      signal: request.signal,
    })
    return NextResponse.json({ payload, status }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Builder transaction is unavailable' },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}
