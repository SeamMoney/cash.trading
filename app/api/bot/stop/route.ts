import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Ed25519PrivateKey, Ed25519Account } from '@aptos-labs/ts-sdk'
import { getMarkPrice } from '@/lib/price-feed'
import { createAuthenticatedAptos, TESTNET_CONFIG, getAllMarketAddresses } from '@/lib/decibel-sdk'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes - need time for TWAP cancellation and close

const DECIBEL_PACKAGE = TESTNET_CONFIG.deployment.package ||
  process.env.NEXT_PUBLIC_DECIBEL_PACKAGE ||
  '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'

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
    const { userWalletAddress, userSubaccount } = body

    console.log('🛑 Stop request for wallet:', userWalletAddress, 'subaccount:', userSubaccount?.slice(0, 20))

    if (!userWalletAddress) {
      return NextResponse.json(
        { error: 'Missing userWalletAddress' },
        { status: 400 }
      )
    }

    // Find the bot in the database - use composite key if subaccount provided
    let bot
    if (userSubaccount) {
      bot = await prisma.botInstance.findUnique({
        where: {
          userWalletAddress_userSubaccount: {
            userWalletAddress,
            userSubaccount,
          }
        },
      })
    } else {
      // Fallback: find first running bot for this wallet
      bot = await prisma.botInstance.findFirst({
        where: { userWalletAddress, isRunning: true },
      })
    }

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
    let cancelledBulkOrders = false

    if (bot.strategy === 'high_risk') {
      const aptos = createAuthenticatedAptos()

      // First, cancel ALL pending TWAP orders to prevent more position buildup
      try {
        console.log('🛑 Cancelling all pending TWAP orders...')
        const privateKey = new Ed25519PrivateKey(process.env.BOT_OPERATOR_PRIVATE_KEY!)
        const botAccount = new Ed25519Account({ privateKey })

        const cancelTransaction = await aptos.transaction.build.simple({
          sender: botAccount.accountAddress,
          data: {
            function: `${DECIBEL_PACKAGE}::dex_accounts_entry::cancel_twap_orders_to_subaccount`,
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
                function: `${DECIBEL_PACKAGE}::dex_accounts_entry::place_twap_order_to_subaccount`,
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
            console.log(`   Waiting for TWAP to fully fill...`)

            // CRITICAL: Wait for the TWAP to fully close the position (max 3 minutes)
            const closeStartTime = Date.now()
            const MAX_WAIT_MS = 3 * 60 * 1000 // 3 minutes

            while (Date.now() - closeStartTime < MAX_WAIT_MS) {
              await new Promise(r => setTimeout(r, 10000)) // Wait 10 seconds

              // Re-fetch position
              const updatedResources = await aptos.getAccountResources({
                accountAddress: bot.userSubaccount
              })
              const updatedPositionsResource = updatedResources.find((r: any) =>
                r.type.includes('perp_positions::UserPositions')
              )

              if (updatedPositionsResource) {
                const updatedData = updatedPositionsResource.data as any
                const updatedEntries = updatedData.positions?.root?.children?.entries || []
                const updatedMarketPosition = updatedEntries.find((e: any) =>
                  e.key.inner.toLowerCase() === bot.market.toLowerCase()
                )

                if (!updatedMarketPosition || parseInt(updatedMarketPosition.value.value.size) === 0) {
                  console.log(`✅ Position fully closed!`)
                  break
                }

                const remainingSize = parseInt(updatedMarketPosition.value.value.size)
                const remainingPct = (remainingSize / positionSize) * 100
                console.log(`   TWAP filling... ${remainingPct.toFixed(1)}% remaining`)
              }
            }

            // Calculate volume and PnL
            const marketConfig = MARKET_CONFIG[bot.marketName] || { szDecimals: 8 }
            const sizeInBaseAsset = positionSize / Math.pow(10, marketConfig.szDecimals)
            const volumeGenerated = sizeInBaseAsset * currentPrice
            const priceChange = positionIsLong
              ? (currentPrice - entryPrice) / entryPrice
              : (entryPrice - currentPrice) / entryPrice
            const estimatedPnl = volumeGenerated * priceChange

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
                success: true,
                strategy: bot.strategy,
                market: bot.marketName,
                userSubaccount: bot.userSubaccount,
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

    // For dlp_grid strategy, cancel bulk orders so the passive grid doesn't keep trading after stop.
    if (bot.strategy === 'dlp_grid') {
      const aptos = createAuthenticatedAptos()

      try {
        console.log('🧊 DLP Grid: cancelling bulk orders...')
        const privateKey = new Ed25519PrivateKey(process.env.BOT_OPERATOR_PRIVATE_KEY!)
        const botAccount = new Ed25519Account({ privateKey })

        const raw = (process.env.DLP_GRID_MARKETS || '').trim()
        let marketNames: string[] = []
        if (!raw) {
          marketNames = [bot.marketName]
        } else if (raw.toUpperCase() === 'ALL') {
          marketNames = (await getAllMarketAddresses()).map((m) => m.name)
        } else {
          marketNames = raw.split(',').map((s) => s.trim()).filter(Boolean)
        }

        // Resolve market addresses from SDK; fallback to stored bot.market for bot.marketName.
        let sdkMarkets: Array<{ name: string; address: string }> = []
        try {
          sdkMarkets = await getAllMarketAddresses()
        } catch {
          // non-fatal
        }
        const addrByName = new Map(sdkMarkets.map((m) => [m.name, m.address]))

        const addrs = marketNames
          .map((name) => addrByName.get(name) || (name === bot.marketName ? bot.market : null))
          .filter((x): x is string => Boolean(x))

        // Dedup (case-insensitive)
        const uniqueAddrsLower = Array.from(new Set(addrs.map((a) => a.toLowerCase())))
        const uniqueAddrs = uniqueAddrsLower.map((a) => addrs.find((orig) => orig.toLowerCase() === a) as string)

        let cancelled = 0
        for (const marketAddr of uniqueAddrs) {
          const cancelTransaction = await aptos.transaction.build.simple({
            sender: botAccount.accountAddress,
            data: {
              function: `${DECIBEL_PACKAGE}::dex_accounts_entry::cancel_bulk_order_to_subaccount`,
              typeArguments: [],
              functionArguments: [
                bot.userSubaccount,
                marketAddr,
              ],
            },
          })

          const committed = await aptos.signAndSubmitTransaction({
            signer: botAccount,
            transaction: cancelTransaction,
          })
          await aptos.waitForTransaction({ transactionHash: committed.hash })
          cancelled++
        }

        cancelledBulkOrders = true
        console.log(`✅ DLP Grid: cancelled ${cancelled}/${uniqueAddrs.length} bulk order(s)`)
      } catch (e: any) {
        console.error('⚠️ DLP Grid: failed to cancel bulk orders:', e?.message || e)
        // Continue: still mark bot stopped in DB
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
        : cancelledBulkOrders
          ? 'Bot stopped. Bulk orders cancelled.'
          : cancelledTwaps
            ? 'Bot stopped. All pending TWAPs cancelled.'
            : 'Volume bot stopped successfully',
      closedPosition,
      closeResult,
      cancelledTwaps,
      cancelledBulkOrders,
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
