import { NextRequest, NextResponse } from 'next/server'
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk'
import { BOT_OPERATOR, DECIBEL_PACKAGE } from '@/lib/decibel-client'

const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }))

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

    // Fetch the subaccount resources to check delegation permissions
    const resources = await aptos.getAccountResources({
      accountAddress: userSubaccount,
    })

    // Find the Subaccount resource which contains delegated_permissions
    const subaccountResource = resources.find(
      (r) => r.type.includes('dex_accounts::Subaccount')
    )

    if (!subaccountResource) {
      return NextResponse.json({
        hasDelegation: false,
        reason: 'Subaccount resource not found',
      })
    }

    // Check if bot operator is in the delegated_permissions
    const data = subaccountResource.data as {
      delegated_permissions?: {
        entries?: Array<{
          key: string
          value: any
        }>
      }
    }

    const entries = data.delegated_permissions?.entries || []
    const hasDelegation = entries.some(
      (entry) => entry.key.toLowerCase() === BOT_OPERATOR.toLowerCase()
    )

    return NextResponse.json({
      hasDelegation,
      botOperator: BOT_OPERATOR,
      delegatedTo: entries.map((e) => e.key),
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
