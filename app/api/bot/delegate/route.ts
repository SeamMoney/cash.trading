import { NextRequest, NextResponse } from 'next/server'
import { BOT_OPERATOR } from '@/lib/decibel-client'
import { getActiveNetwork, MAINNET_CONFIG, TESTNET_CONFIG } from '@/lib/decibel-sdk'
import { denyUnlessBotOwner } from '@/lib/bot-owner-guard'
import { checkRateLimitForKey } from '@/lib/api-rate-limit'

export const runtime = 'nodejs'

/**
 * How long the operator may trade a subaccount before the user has to say yes
 * again. Thirty days, not the year-2100 timestamp this used to mint: the whole
 * point of delegation is that it is revocable, and a permission nobody ever has
 * to renew is one nobody ever revisits. A user who forgets they authorized this
 * gets it back automatically within a month.
 */
const DELEGATION_TTL_SECONDS = 30 * 24 * 60 * 60

/**
 * Returns the transaction payload for delegating permissions to the bot
 *
 * The frontend will sign this with the user's wallet
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    // Requires the owning wallet: this mints a payload naming a subaccount, and
    // previously would do so for any address supplied.
    const { userSubaccount, userWalletAddress } = body

    const denied = await denyUnlessBotOwner({ walletAddress: userWalletAddress, subaccount: userSubaccount })
    if (denied) return denied

    // Keyed by wallet, not IP: the authorized identity is the thing worth
    // bounding, and this mints a payload that grants trading rights.
    const rate = checkRateLimitForKey('bot-delegate', String(userWalletAddress).toLowerCase(), 12, 60000)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfterS: rate.retryAfterS },
        { status: 429 },
      )
    }

    if (!userSubaccount) {
      return NextResponse.json(
        { error: 'Missing userSubaccount' },
        { status: 400 }
      )
    }

    // Return the payload for the frontend to sign
    // Using the InputEntryFunctionData format expected by @aptos-labs/wallet-adapter-react.
    // The fourth argument is Option<u64>; a bare value is Some(value).
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + DELEGATION_TTL_SECONDS

    return NextResponse.json({
      success: true,
      payload: {
        function: `${getActiveNetwork() === 'mainnet' ? MAINNET_CONFIG.deployment.package : TESTNET_CONFIG.deployment.package}::dex_accounts_entry::delegate_trading_to_for_subaccount`,
        typeArguments: [],
        functionArguments: [
          userSubaccount,
          BOT_OPERATOR,
          String(expiresAtSeconds),
        ],
      },
      botOperator: BOT_OPERATOR,
      expiresAtSeconds,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      ttlDays: DELEGATION_TTL_SECONDS / 86_400,
    })
  } catch (error) {
    console.error('Error creating delegation payload:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create delegation payload' },
      { status: 500 }
    )
  }
}
