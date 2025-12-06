import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Ed25519Account } from '@aptos-labs/ts-sdk'
import { getMarkPrice } from '@/lib/price-feed'

export const runtime = 'nodejs'
export const maxDuration = 60

const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'

// Market configs for size decimals
const MARKET_CONFIG: Record<string, { szDecimals: number }> = {
  'BTC/USD': { szDecimals: 8 },
  'APT/USD': { szDecimals: 4 },
  'WLFI/USD': { szDecimals: 3 },
  'SOL/USD': { szDecimals: 6 },
  'ETH/USD': { szDecimals: 7 },
}

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

    // For high_risk strategy, cancel all pending TWAPs and close position
    let closedPosition = false
    let closeResult: any = null
    let cancelledTwaps = false

    if (bot.strategy === 'high_risk') {
      const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }))

      // First, cancel ALL pending TWAP orders to prevent more position buildup
      try {
        console.log('🛑 Cancelling all pending TWAP orders...')
        const privateKey = new Ed25519PrivateKey(process.env.BOT_OPERATOR_PRIVATE_KEY!)
        const botAccount = new Ed25519Account({ privateKey })

        const cancelTransaction = await aptos.transaction.build.simple({
          sender: botAccount.accountAddress,
          data: {
            function: `${DECIBEL_PACKAGE}::dex_accounts::cancel_twap_orders_to_subaccount`,
            typeArguments: [],
            functionArguments: [
              bot.userSubaccount,
              bot.market,
            ],
          },
        })

        const cancelCommittedTxn = await aptos.signAndSubmitTransaction({
          signer: botAccount,
          transaction: cancelTransaction,
        })

        await aptos.waitForTransaction({ transactionHash: cancelCommittedTxn.hash })
        console.log(`✅ Cancelled all TWAPs: ${cancelCommittedTxn.hash}`)
        cancelledTwaps = true
      } catch (e: any) {
        console.error('Error cancelling TWAPs:', e.message || e)
        // Continue - maybe there were no TWAPs to cancel
      }

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
            const entryPrice = parseInt(pos.avg_acquire_entry_px) / 1e6 // BTC uses 6 decimals for price

            console.log(`📊 Found open ${positionIsLong ? 'LONG' : 'SHORT'} position, closing...`)
            console.log(`   Size: ${positionSize}, Entry: $${entryPrice.toFixed(2)}`)

            // Get current mark price for volume/PnL calculation
            const priceData = await getMarkPrice(bot.market, 'testnet', 3000)
            const currentPrice = priceData?.markPx || entryPrice // Fallback to entry if WebSocket fails

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

            // Calculate volume and PnL
            const marketConfig = MARKET_CONFIG[bot.marketName] || { szDecimals: 8 }
            const sizeInBaseAsset = positionSize / Math.pow(10, marketConfig.szDecimals)
            const volumeGenerated = sizeInBaseAsset * currentPrice
            const priceChange = positionIsLong
              ? (currentPrice - entryPrice) / entryPrice
              : (entryPrice - currentPrice) / entryPrice
            const estimatedPnl = volumeGenerated * priceChange

            console.log(`✅ Close TWAP submitted: ${closeCommittedTxn.hash}`)
            console.log(`   Volume: $${volumeGenerated.toFixed(2)}, Est PnL: $${estimatedPnl.toFixed(2)}`)

            // Record the close order in history
            await prisma.orderHistory.create({
              data: {
                botId: bot.id,
                direction: positionIsLong ? 'long' : 'short',
                size: positionSize,
                entryPrice: entryPrice,
                exitPrice: currentPrice,
                volumeGenerated: volumeGenerated,
                pnl: estimatedPnl,
                txHash: closeCommittedTxn.hash,
                timestamp: new Date(),
              }
            })

            // Update cumulative volume
            await prisma.botInstance.update({
              where: { id: bot.id },
              data: {
                cumulativeVolume: { increment: volumeGenerated },
                ordersPlaced: { increment: 1 },
                lastOrderTime: new Date(),
              }
            })

            closedPosition = true
            closeResult = {
              txHash: closeCommittedTxn.hash,
              direction: positionIsLong ? 'LONG' : 'SHORT',
              size: positionSize,
              volumeGenerated,
              estimatedPnl,
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
        : cancelledTwaps
          ? 'Bot stopped. All pending TWAPs cancelled.'
          : 'Volume bot stopped successfully',
      closedPosition,
      closeResult,
      cancelledTwaps,
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
