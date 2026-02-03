import { NextRequest, NextResponse } from 'next/server'
import { BOT_OPERATOR, DECIBEL_PACKAGE } from '@/lib/decibel-client'

/**
 * Returns the transaction payload for delegating permissions to the bot
 *
 * The frontend will sign this with the user's wallet
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userSubaccount } = body

    if (!userSubaccount) {
      return NextResponse.json(
        { error: 'Missing userSubaccount' },
        { status: 400 }
      )
    }

    // Return the payload for the frontend to sign
    // Using the InputEntryFunctionData format expected by @aptos-labs/wallet-adapter-react
    // Use far-future timestamp (year 2100) for expiration instead of 0
    const farFutureExpiration = "4102444800" // Jan 1, 2100 in seconds

    return NextResponse.json({
      success: true,
      payload: {
        function: `${DECIBEL_PACKAGE}::dex_accounts_entry::delegate_trading_to_for_subaccount`,
        typeArguments: [],
        functionArguments: [
          userSubaccount,
          BOT_OPERATOR,
          farFutureExpiration,
        ],
      },
      botOperator: BOT_OPERATOR,
    })
  } catch (error) {
    console.error('Error creating delegation payload:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create delegation payload' },
      { status: 500 }
    )
  }
}
