import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Ed25519PrivateKey, Ed25519Account } from '@aptos-labs/ts-sdk'
import { getMarkPrice } from '@/lib/price-feed'
import { createAuthenticatedAptos, TESTNET_CONFIG, MAINNET_CONFIG, getActiveNetwork, getAllMarketAddresses } from '@/lib/decibel-sdk'
import { legacyBotAutomationUnavailable } from '@/lib/legacy-bot-guard'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes - need time for TWAP cancellation and close

const net = getActiveNetwork();
const DECIBEL_PACKAGE = net === 'mainnet'
  ? MAINNET_CONFIG.deployment.package
  : (process.env.NEXT_PUBLIC_DECIBEL_PACKAGE || TESTNET_CONFIG.deployment.package)

// Market configs for size decimals (differ between testnet and mainnet)
const TESTNET_SIZE_CONFIG: Record<string, { szDecimals: number }> = {
  'BTC/USD': { szDecimals: 8 },
  'ETH/USD': { szDecimals: 8 },
  'SOL/USD': { szDecimals: 8 },
  'APT/USD': { szDecimals: 8 },
  'WLFI/USD': { szDecimals: 3 },
}
const MAINNET_SIZE_CONFIG: Record<string, { szDecimals: number }> = {
  'BTC/USD': { szDecimals: 8 },
  'ETH/USD': { szDecimals: 8 },
  'SOL/USD': { szDecimals: 7 },
  'APT/USD': { szDecimals: 5 },
  'HYPE/USD': { szDecimals: 6 },
}
const MARKET_CONFIG = net === 'mainnet' ? MAINNET_SIZE_CONFIG : TESTNET_SIZE_CONFIG

/**
 * Read a subaccount's position for one market through the perp_engine granular
 * views. `perp_positions::UserPositions` is now an enum, so the old raw
 * `positions.root.children.entries[].value.value` walk is fragile — these views
 * return primitives (bool/u64) with no struct nesting to break.
 */
async function readPositionViaViews(
  aptos: any,
  subaccount: string,
  market: string,
): Promise<{ size: number; isLong: boolean; avgPrice: number } | null> {
  const args = [subaccount, market]
  const has = await aptos.view({ payload: { function: `${DECIBEL_PACKAGE}::perp_engine::has_position`, functionArguments: args } })
  if (!(Array.isArray(has) ? has[0] : has)) return null
  const [sizeRes, longRes, avgRes] = await Promise.all([
    aptos.view({ payload: { function: `${DECIBEL_PACKAGE}::perp_engine::get_position_size`, functionArguments: args } }),
    aptos.view({ payload: { function: `${DECIBEL_PACKAGE}::perp_engine::get_position_is_long`, functionArguments: args } }),
    aptos.view({ payload: { function: `${DECIBEL_PACKAGE}::perp_engine::get_position_avg_price`, functionArguments: args } }),
  ])
  const size = Number(Array.isArray(sizeRes) ? sizeRes[0] : sizeRes)
  if (!Number.isFinite(size) || size === 0) return null
  return {
    size,
    isLong: Boolean(Array.isArray(longRes) ? longRes[0] : longRes),
    avgPrice: Number(Array.isArray(avgRes) ? avgRes[0] : avgRes) / 1_000_000,
  }
}

/** Live size decimals for a market, falling back to the static table. */
async function readSzDecimals(aptos: any, market: string, marketName: string): Promise<number> {
  try {
    const res = await aptos.view({ payload: { function: `${DECIBEL_PACKAGE}::perp_engine::market_sz_decimals`, functionArguments: [market] } })
    const n = Number(Array.isArray(res) ? res[0] : res)
    if (Number.isFinite(n) && n >= 0) return n
  } catch { /* fall through */ }
  return (MARKET_CONFIG[marketName] || { szDecimals: 8 }).szDecimals
}

export async function POST(request: NextRequest) {
  const unavailable = legacyBotAutomationUnavailable()
  if (unavailable) return unavailable

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

      // First, cancel ALL pending TWAP orders to prevent more position buildup.
      // `cancel_twap_orders_to_subaccount` now REQUIRES the u128 TWAP order id
      // (a bare subaccount+market call no longer builds), so enumerate the
      // active TWAPs and cancel each by id via the SDK — matching what
      // bot-engine's cancelTwapOrderSDK does.
      try {
        console.log('🛑 Cancelling all pending TWAP orders...')
        const { getReadDex, getWriteDex } = await import('@/lib/decibel-sdk')
        const readDex = getReadDex()
        const activeTwaps = await readDex.userActiveTwaps.getByAddr({ subAddr: bot.userSubaccount })
        const forThisMarket = (activeTwaps || []).filter((t) => {
          const m = (t.market ?? '').toString().toLowerCase()
          return !m || m === bot.market.toLowerCase()
        })
        if (forThisMarket.length === 0) {
          console.log('   no active TWAPs to cancel')
          cancelledTwaps = true
        } else {
          const writeDex = getWriteDex()
          let cancelledCount = 0
          for (const twap of forThisMarket) {
            const orderId = twap.order_id?.toString()
            if (!orderId) continue
            try {
              await writeDex.cancelTwapOrder({
                orderId,
                marketAddr: bot.market,
                subaccountAddr: bot.userSubaccount,
              })
              cancelledCount++
              console.log(`   cancelled TWAP ${orderId}`)
            } catch (inner: any) {
              console.warn(`   failed to cancel TWAP ${orderId}:`, inner?.message || inner)
            }
          }
          cancelledTwaps = cancelledCount > 0
          console.log(`✅ Cancelled ${cancelledCount}/${forThisMarket.length} TWAPs`)
        }
      } catch (e: any) {
        console.error('Error cancelling TWAPs:', e.message || e)
        // Continue - maybe there were no TWAPs to cancel
      }

      try {
        // Check on-chain position via perp_engine views (enum-safe)
        const position = await readPositionViaViews(aptos, bot.userSubaccount, bot.market)

        if (position && position.size > 0) {
          {
            const positionSize = position.size
            const positionIsLong = position.isLong
            const closeDirection = !positionIsLong
            const entryPrice = position.avgPrice // already scaled to USDC (6dp)

            console.log(`📊 Found open ${positionIsLong ? 'LONG' : 'SHORT'} position, closing...`)
            console.log(`   Size: ${positionSize}, Entry: $${entryPrice.toFixed(2)}`)

            // Get current mark price for volume/PnL calculation
            const priceData = await getMarkPrice(bot.market, getActiveNetwork(), 3000)
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

              // Re-fetch position via views (enum-safe)
              const updatedPosition = await readPositionViaViews(aptos, bot.userSubaccount, bot.market)

              if (!updatedPosition || updatedPosition.size === 0) {
                console.log(`✅ Position fully closed!`)
                break
              }

              const remainingPct = (updatedPosition.size / positionSize) * 100
              console.log(`   TWAP filling... ${remainingPct.toFixed(1)}% remaining`)
            }

            // Calculate volume and PnL
            const szDecimals = await readSzDecimals(aptos, bot.market, bot.marketName)
            const sizeInBaseAsset = positionSize / Math.pow(10, szDecimals)
            const volumeGenerated = sizeInBaseAsset * currentPrice
            const priceChange = positionIsLong
              ? (currentPrice - entryPrice) / entryPrice
              : (entryPrice - currentPrice) / entryPrice
            const estimatedPnl = volumeGenerated * priceChange

            console.log(`   Volume: $${volumeGenerated.toFixed(2)}, Est PnL: $${estimatedPnl.toFixed(2)}`)

            // Record the close order in history
            const orderHistory = await prisma.orderHistory.create({
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

            const { recordCashRewardForTrade } = await import('@/lib/cash-rewards')
            recordCashRewardForTrade({
              orderHistoryId: orderHistory.id,
              sourceId: `order:${orderHistory.id}`,
              userWalletAddress: bot.userWalletAddress,
              userSubaccount: bot.userSubaccount,
              sourceTxHash: closeCommittedTxn.hash,
              volumeGenerated,
              market: bot.marketName,
              strategy: bot.strategy,
            }).catch((rewardError) => {
              console.error('⚠️  [STOP] Failed to verify CASH reward eligibility:', rewardError)
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
