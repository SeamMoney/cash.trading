import { NextRequest, NextResponse } from 'next/server'
import { BOT_OPERATOR } from '@/lib/decibel-client'
import { createAuthenticatedAptos, TESTNET_CONFIG, MAINNET_CONFIG, getActiveNetwork } from '@/lib/decibel-sdk'
import { denyUnlessBotOwner } from '@/lib/bot-owner-guard'

// Use authenticated Aptos client to avoid 429 rate limits
const aptos = createAuthenticatedAptos()

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
    const hasDelegation = delegatedTo.some(
      (key) => key.toLowerCase() === BOT_OPERATOR.toLowerCase()
    )

    return NextResponse.json({
      hasDelegation,
      botOperator: BOT_OPERATOR,
      delegatedTo,
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
