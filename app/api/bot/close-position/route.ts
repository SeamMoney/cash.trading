import { NextRequest, NextResponse } from 'next/server'
import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Ed25519Account } from '@aptos-labs/ts-sdk'
import { getMarkPrice } from '@/lib/price-feed'
import { DECIBEL_PACKAGE } from '@/lib/decibel-client'
import { prisma } from '@/lib/prisma'

// Market configs for size/price decimals and ticker sizes (updated Feb 5, 2026)
const MARKET_CONFIG: Record<string, { pxDecimals: number; szDecimals: number; tickerSize: bigint }> = {
  'BTC/USD': { pxDecimals: 6, szDecimals: 8, tickerSize: 100000n },
  'ETH/USD': { pxDecimals: 6, szDecimals: 8, tickerSize: 100000n },
  'SOL/USD': { pxDecimals: 6, szDecimals: 8, tickerSize: 100000n },
  'APT/USD': { pxDecimals: 6, szDecimals: 8, tickerSize: 100000n },
  'XRP/USD': { pxDecimals: 6, szDecimals: 8, tickerSize: 100000n },
  'AAVE/USD': { pxDecimals: 6, szDecimals: 8, tickerSize: 100000n },
  'HYPE/USD': { pxDecimals: 6, szDecimals: 8, tickerSize: 100000n },
  'WLFI/USD': { pxDecimals: 6, szDecimals: 8, tickerSize: 100000n },
  'SUI/USD': { pxDecimals: 6, szDecimals: 8, tickerSize: 100000n },
  'BNB/USD': { pxDecimals: 6, szDecimals: 8, tickerSize: 100000n },
  'DOGE/USD': { pxDecimals: 6, szDecimals: 8, tickerSize: 100000n },
  'ZEC/USD': { pxDecimals: 6, szDecimals: 8, tickerSize: 100000n },
}

export const runtime = 'nodejs'
export const maxDuration = 60 // 1 minute for TWAP close

function roundPriceToTickerSize(priceUSD: number, tickerSize: bigint): bigint {
  const priceInChainUnits = BigInt(Math.floor(priceUSD * 1e6))
  return (priceInChainUnits / tickerSize) * tickerSize
}

/**
 * POST /api/bot/close-position - Close a position via TWAP
 * Body: { userSubaccount, marketAddress, marketName, sizeRaw, isLong }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userWalletAddress, userSubaccount, marketAddress, marketName, sizeRaw, isLong } = body

    if (!userSubaccount || !marketAddress || sizeRaw === undefined || isLong === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: userSubaccount, marketAddress, sizeRaw, isLong' },
        { status: 400 }
      )
    }

    // Get bot operator key from env
    const botPrivateKey = process.env.BOT_OPERATOR_PRIVATE_KEY
    if (!botPrivateKey) {
      return NextResponse.json(
        { error: 'Bot operator not configured' },
        { status: 500 }
      )
    }

    // Get API key for Aptos
    const apiKey = (process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY || '')
      .replace(/\\n/g, '').replace(/\n/g, '').trim()

    const config = new AptosConfig({
      network: Network.TESTNET,
      clientConfig: apiKey ? { HEADERS: { Authorization: `Bearer ${apiKey}` } } : undefined
    })
    const aptos = new Aptos(config)

    // Check if subaccount is compatible with current package
    try {
      const resources = await aptos.getAccountResources({ accountAddress: userSubaccount })
      const subaccountResource = resources.find((r: any) => r.type.includes('::dex_accounts_entry::Subaccount'))
      if (subaccountResource) {
        const packageAddr = subaccountResource.type.split('::')[0]
        if (packageAddr.toLowerCase() !== DECIBEL_PACKAGE.toLowerCase()) {
          console.log(`⚠️ Subaccount package mismatch: ${packageAddr} vs ${DECIBEL_PACKAGE}`)
          return NextResponse.json({
            error: 'Subaccount incompatible',
            details: 'This position was created before the Dec 16 testnet reset. Please close it manually on the Decibel UI or create a new subaccount.',
            subaccountPackage: packageAddr,
            expectedPackage: DECIBEL_PACKAGE,
          }, { status: 400 })
        }
      }
    } catch (e) {
      console.warn('Could not verify subaccount compatibility:', e)
    }

    // Create bot account - strip prefix if present
    const keyHex = botPrivateKey.replace('ed25519-priv-', '').trim()
    const privateKey = new Ed25519PrivateKey(keyHex)
    const botAccount = new Ed25519Account({ privateKey })

    // Get market config
    const mktConfig = MARKET_CONFIG[marketName] || { pxDecimals: 6, szDecimals: 6, tickerSize: 1000n }

    // Get current price for TWAP limit
    let currentPrice = 0
    try {
      const priceData = await getMarkPrice(marketAddress, 'testnet', 2000)
      if (priceData) {
        currentPrice = priceData.markPx
      } else {
        // Fallback to on-chain
        const priceRes = await fetch(
          `https://api.testnet.aptoslabs.com/v1/accounts/${marketAddress}/resources`
        )
        const priceResources = await priceRes.json()
        const priceResource = priceResources.find((r: any) =>
          r.type.includes('price_management::Price')
        )
        if (priceResource) {
          currentPrice = Number(priceResource.data.oracle_px) / Math.pow(10, mktConfig.pxDecimals)
        }
      }
    } catch (e) {
      console.error('Could not fetch current price:', e)
      return NextResponse.json(
        { error: 'Could not fetch current price for position close' },
        { status: 500 }
      )
    }

    // Calculate TWAP limit price (aggressive to ensure fill)
    // Close direction is opposite of position direction
    const closeIsLong = !isLong
    const slippagePct = 0.02 // 2% slippage
    const limitPrice = closeIsLong
      ? currentPrice * (1 + slippagePct)
      : currentPrice * (1 - slippagePct)
    const limitPriceChain = roundPriceToTickerSize(limitPrice, mktConfig.tickerSize)

    console.log(`📝 [CLOSE] Closing ${isLong ? 'LONG' : 'SHORT'} ${marketName} position`)
    console.log(`   Size: ${sizeRaw} (raw chain units)`)
    console.log(`   Current Price: $${currentPrice.toFixed(2)}`)
    console.log(`   TWAP Limit: $${(Number(limitPriceChain) / 1e6).toFixed(2)}`)

    // Build TWAP close transaction
    // Function signature: subaccount, market, size, is_long, reduce_only, min_duration, max_duration, builder_address, max_builder_fee
    // Using faster TWAP: 30-60 seconds (minimum the protocol allows)
    const transaction = await aptos.transaction.build.simple({
      sender: botAccount.accountAddress,
      data: {
        function: `${DECIBEL_PACKAGE}::dex_accounts_entry::place_twap_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          userSubaccount,
          marketAddress,
          sizeRaw.toString(),    // size
          closeIsLong,           // is_long (opposite of position direction to close)
          true,                  // reduce_only (closing position)
          60,                    // min_duration seconds (protocol minimum)
          120,                   // max_duration seconds
          undefined,             // builder_address
          undefined,             // max_builder_fee
        ],
      },
    })

    // Sign and submit
    const committedTxn = await aptos.signAndSubmitTransaction({
      signer: botAccount,
      transaction,
    })
    console.log(`   TX submitted: ${committedTxn.hash}`)

    // Wait for confirmation
    const executedTxn = await aptos.waitForTransaction({
      transactionHash: committedTxn.hash,
    })

    if (executedTxn.success) {
      console.log(`✅ [CLOSE] TWAP close order placed successfully!`)

      // Record the close trade to orderHistory if we have a bot instance
      try {
        if (userWalletAddress) {
          const botInstance = await prisma.botInstance.findUnique({
            where: {
              userWalletAddress_userSubaccount: {
                userWalletAddress,
                userSubaccount,
              }
            }
          })

          if (botInstance) {
            // Calculate notional value
            const szDecimals = mktConfig.szDecimals
            const sizeInBaseAsset = Number(sizeRaw) / Math.pow(10, szDecimals)
            const notionalValue = sizeInBaseAsset * currentPrice

            // Record the close order
            await prisma.orderHistory.create({
              data: {
                botId: botInstance.id,
                userSubaccount,
                txHash: committedTxn.hash,
                direction: closeIsLong ? 'long' : 'short', // Close direction (opposite of position)
                strategy: 'manual_close',
                size: BigInt(sizeRaw),
                volumeGenerated: notionalValue,
                success: true,
                entryPrice: currentPrice, // Use current price as approximate close price
                market: marketName,
                leverage: 10, // Default leverage for display
              }
            })
            console.log(`📝 [CLOSE] Recorded trade to orderHistory`)

            // Update cumulative volume
            await prisma.botInstance.update({
              where: { id: botInstance.id },
              data: {
                cumulativeVolume: { increment: notionalValue }
              }
            })
          }
        }
      } catch (dbError) {
        console.warn('Could not record close trade to database:', dbError)
      }

      return NextResponse.json({
        success: true,
        txHash: committedTxn.hash,
        message: `TWAP close order placed for ${isLong ? 'LONG' : 'SHORT'} ${marketName}. Will fill in ~1 minute.`,
        direction: isLong ? 'long' : 'short',
        market: marketName,
        closePrice: Number(limitPriceChain) / 1e6,
      })
    } else {
      console.error(`❌ [CLOSE] TX failed:`, executedTxn.vm_status)
      return NextResponse.json(
        { error: `Transaction failed: ${executedTxn.vm_status}` },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Error closing position:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Check for delegation error
    if (errorMessage.includes('LACKS_PERP_TRADING_PERMISSIONS') || errorMessage.includes('lacks trading permissions')) {
      return NextResponse.json({
        error: 'Delegation required',
        details: 'You need to delegate trading permissions to the bot operator before closing positions. Click "Delegate Permissions" in the app.',
        needsDelegation: true,
      }, { status: 403 })
    }

    return NextResponse.json(
      { error: 'Failed to close position', details: errorMessage },
      { status: 500 }
    )
  }
}
