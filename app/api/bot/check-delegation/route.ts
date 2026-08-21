import { NextRequest, NextResponse } from 'next/server'
import { BOT_OPERATOR } from '@/lib/decibel-client'
import { createAuthenticatedAptos, TESTNET_CONFIG, MAINNET_CONFIG, getActiveNetwork } from '@/lib/decibel-sdk'
import { denyUnlessBotOwner } from '@/lib/bot-owner-guard'
import { checkRateLimitForKey } from '@/lib/api-rate-limit'

export const runtime = 'nodejs'

// Use authenticated Aptos client to avoid 429 rate limits
const aptos = createAuthenticatedAptos()

/**
 * Delegations now carry a 30-day expiry (see app/api/bot/delegate/route.ts), so
 * "the operator is in the map" is no longer the same question as "the operator
 * can trade". The DelegatedPermissions value is an on-chain enum whose JSON
 * shape is not pinned by the module ABI, so read the expiry defensively: walk
 * the value for an expiration-ish number and only downgrade on an unambiguous
 * one that has already passed. A zero (or missing) expiry means unlimited,
 * which is what the older year-2100 delegations look like.
 */
const EXPIRY_KEYS = ['expiration', 'expiration_secs', 'expiration_time', 'expires_at', 'expiry']

function findExpirySeconds(value: unknown, depth = 0): number | null {
  if (depth > 6 || value === null || typeof value !== 'object') return null
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (EXPIRY_KEYS.includes(key)) {
      const inner = typeof raw === 'object' && raw !== null
        ? (raw as { vec?: unknown[] }).vec?.[0]
        : raw
      const n = Number(inner)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  for (const raw of Object.values(value as Record<string, unknown>)) {
    const found = findExpirySeconds(raw, depth + 1)
    if (found !== null) return found
  }
  return null
}

const DECIBEL_PACKAGE = getActiveNetwork() === 'mainnet'
  ? MAINNET_CONFIG.deployment.package
  : (process.env.NEXT_PUBLIC_DECIBEL_PACKAGE || TESTNET_CONFIG.deployment.package)

/**
 * Check if the bot operator has trading permissions for a user's subaccount
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userSubaccount = searchParams.get('userSubaccount')

    if (!userSubaccount) {
      return NextResponse.json(
        { error: 'Missing userSubaccount parameter' },
        { status: 400 }
      )
    }

    // Requires the owning wallet so the subaccount can be tied to an allowlisted
    // owner; previously this leaked delegation state for any address.
    const userWalletAddress = searchParams.get('userWalletAddress')
    const denied = await denyUnlessBotOwner({ walletAddress: userWalletAddress, subaccount: userSubaccount })
    if (denied) return denied

    // Keyed by wallet, not IP: the authorized identity is the thing worth
    // bounding, and every call here costs an upstream view.
    const rate = checkRateLimitForKey(
      'bot-check-delegation',
      String(userWalletAddress).toLowerCase(),
      60,
      60000,
    )
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfterS: rate.retryAfterS },
        { status: 429 },
      )
    }

    // The Subaccount type moved to `dex_accounts` and is now an enum whose
    // delegated_permissions live in a nested BigOrderedMap — the old raw
    // resource walk (`dex_accounts_entry::Subaccount` → `.delegated_permissions.entries`)
    // matched nothing and always reported hasDelegation:false. Read the
    // `view_delegated_permissions` view, which returns an
    // OrderedMap<address, DelegatedPermissions> deserialized for us.
    const viewResult = await aptos.view({
      payload: {
        function: `${DECIBEL_PACKAGE}::dex_accounts::view_delegated_permissions`,
        functionArguments: [userSubaccount],
      },
    })

    // OrderedMap serializes as { entries: [{ key: address, value: {...} }] }.
    const map = Array.isArray(viewResult) ? viewResult[0] : viewResult
    const entries: Array<{ key: string; value: unknown }> =
      (map as any)?.entries ?? (map as any)?.data ?? []
    const delegatedTo = entries
      .map((e) => (typeof e.key === 'string' ? e.key : String(e.key)))
      .filter(Boolean)
    const operatorEntry = entries.find(
      (e) => String(e.key ?? '').toLowerCase() === BOT_OPERATOR.toLowerCase()
    )

    const expiresAtSeconds = operatorEntry ? findExpirySeconds(operatorEntry.value) : null
    const nowSeconds = Math.floor(Date.now() / 1000)
    const expired = expiresAtSeconds !== null && expiresAtSeconds <= nowSeconds
    const hasDelegation = Boolean(operatorEntry) && !expired

    return NextResponse.json({
      hasDelegation,
      botOperator: BOT_OPERATOR,
      delegatedTo,
      expired,
      expiresAtSeconds,
      expiresAt: expiresAtSeconds === null ? null : new Date(expiresAtSeconds * 1000).toISOString(),
    })
  } catch (error) {
    console.error('Error checking delegation:', error)

    // If the account doesn't exist yet, no delegation
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({
        hasDelegation: false,
        reason: 'Account not found',
      })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check delegation' },
      { status: 500 }
    )
  }
}
