import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Ed25519Account } from '@aptos-labs/ts-sdk'

export const runtime = 'nodejs'
export const maxDuration = 60

const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userWalletAddress } = body

    console.log('🛑 Stop request for wallet:', userWalletAddress)

    if (!userWalletAddress) {
      return NextResponse.json(
        { error: 'Missing userWalletAddress' },
        { status: 400 }
      )
    }

    // Find the bot in the database
    const bot = await prisma.botInstance.findFirst({
      where: { userWalletAddress },
    })

    if (!bot) {
      console.log('❌ Bot not found in database for:', userWalletAddress)
      return NextResponse.json(
        { error: 'No bot found for this wallet' },
        { status: 404 }
      )
    }

    // For high_risk strategy, check if there's an open position and close it
    let closedPosition = false
    let closeResult: any = null

    if (bot.strategy === 'high_risk') {
      const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }))

      try {
        // Check on-chain position
        const resources = await aptos.getAccountResources({
          accountAddress: bot.userSubaccount
        })
        const positionsResource = resources.find((r: any) =>
          r.type.includes('perp_positions::UserPositions')
        )

        if (positionsResource) {
          const data = positionsResource.data as any
          const entries = data.positions?.root?.children?.entries || []
          const marketPosition = entries.find((e: any) =>
            e.key.inner.toLowerCase() === bot.market.toLowerCase()
          )

          if (marketPosition && parseInt(marketPosition.value.value.size) > 0) {
            const pos = marketPosition.value.value
            const positionSize = parseInt(pos.size)
            const positionIsLong = pos.is_long
            const closeDirection = !positionIsLong

            console.log(`📊 Found open ${positionIsLong ? 'LONG' : 'SHORT'} position, closing...`)
            console.log(`   Size: ${positionSize}`)

            // Close the position with TWAP
            const privateKey = new Ed25519PrivateKey(process.env.BOT_OPERATOR_PRIVATE_KEY!)
            const botAccount = new Ed25519Account({ privateKey })

            const closeTransaction = await aptos.transaction.build.simple({
              sender: botAccount.accountAddress,
              data: {
                function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
                typeArguments: [],
                functionArguments: [
                  bot.userSubaccount,
                  bot.market,
                  positionSize.toString(),
                  closeDirection,
                  true,  // reduce_only
                  60,    // min duration
                  120,   // max duration
                  undefined,
                  undefined,
                ],
              },
            })

            const closeCommittedTxn = await aptos.signAndSubmitTransaction({
              signer: botAccount,
              transaction: closeTransaction,
            })

            await aptos.waitForTransaction({ transactionHash: closeCommittedTxn.hash })

            console.log(`✅ Close TWAP submitted: ${closeCommittedTxn.hash}`)
            closedPosition = true
            closeResult = {
              txHash: closeCommittedTxn.hash,
              direction: positionIsLong ? 'LONG' : 'SHORT',
              size: positionSize,
            }
          }
        }
      } catch (e) {
        console.error('Error checking/closing position:', e)
        // Continue with stopping the bot even if close fails
      }
    }

    // Update the bot to stopped in the database
    const updatedBot = await prisma.botInstance.update({
      where: { id: bot.id },
      data: {
        isRunning: false,
        activePositionSize: null,
        activePositionIsLong: null,
        activePositionEntry: null,
        activePositionTxHash: null,
      },
    })

    console.log('✅ Bot stopped in database for:', userWalletAddress)

    return NextResponse.json({
      success: true,
      message: closedPosition
        ? `Bot stopped. Closing ${closeResult.direction} position (TWAP will fill in 1-2 min)`
        : 'Volume bot stopped successfully',
      closedPosition,
      closeResult,
      status: {
        isRunning: false,
        cumulativeVolume: updatedBot.cumulativeVolume,
        ordersPlaced: updatedBot.ordersPlaced,
        lastOrderTime: updatedBot.lastOrderTime,
      },
    })
  } catch (error) {
    console.error('Error stopping bot:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to stop bot' },
      { status: 500 }
    )
  }
}
