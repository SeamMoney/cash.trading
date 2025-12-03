/**
 * Fix Zero Volume Orders Script
 *
 * Finds orders with $0 volumeGenerated and recalculates their volume
 * by fetching the actual fill price and size from on-chain transaction events.
 *
 * Also fixes orders where the size was incorrectly recorded (e.g., limit orders
 * where price was recorded as size due to different argument positions).
 *
 * Usage:
 *   npx tsx scripts/fix-zero-volume.ts [--dry-run]
 *
 * Options:
 *   --dry-run    Show what would be updated without actually updating
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APTOS_NODE = 'https://api.testnet.aptoslabs.com/v1'
const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'

// Market configurations
const MARKETS: Record<string, { name: string; pxDecimals: number; szDecimals: number }> = {
  'BTC/USD': { name: 'BTC/USD', pxDecimals: 6, szDecimals: 8 },
  'ETH/USD': { name: 'ETH/USD', pxDecimals: 6, szDecimals: 7 },
  'SOL/USD': { name: 'SOL/USD', pxDecimals: 6, szDecimals: 6 },
  'APT/USD': { name: 'APT/USD', pxDecimals: 6, szDecimals: 4 },
  'WLFI/USD': { name: 'WLFI/USD', pxDecimals: 6, szDecimals: 3 },
}

interface TxDetails {
  price: number
  size: number
  notional: number
  filled: boolean
  functionType: 'twap' | 'limit' | 'market' | 'unknown'
}

async function fetchTxDetails(txHash: string): Promise<TxDetails | null> {
  try {
    const response = await fetch(`${APTOS_NODE}/transactions/by_hash/${txHash}`)
    if (!response.ok) return null

    const tx = await response.json()
    if (!tx.success) return null

    const func = tx.payload?.function || ''
    let functionType: TxDetails['functionType'] = 'unknown'
    if (func.includes('place_twap_order')) {
      functionType = 'twap'
    } else if (func.includes('place_market_order')) {
      functionType = 'market'
    } else if (func.includes('place_order')) {
      functionType = 'limit'
    }

    const events = tx.events || []
    let price = 0
    let size = 0
    let notional = 0
    let filled = false

    // Look for fill events to get actual traded size and price
    for (const event of events) {
      // TradeEvent has the actual fill data
      if (event.type?.includes('TradeEvent')) {
        const data = event.data || {}
        if (data.price) {
          price = parseInt(data.price)
        }
        if (data.size) {
          size = parseInt(data.size)
          filled = true
        }
      }

      // BulkOrderFilledEvent also has fill data
      if (event.type?.includes('BulkOrderFilledEvent')) {
        const data = event.data || {}
        if (data.price) {
          price = parseInt(data.price)
        }
        if (data.filled_size) {
          size = parseInt(data.filled_size)
          filled = true
        }
      }

      // OrderEvent with FILLED status
      if (event.type?.includes('OrderEvent')) {
        const data = event.data || {}
        if (data.status?.__variant__ === 'FILLED' && data.orig_size) {
          size = parseInt(data.orig_size)
          filled = true
          if (data.price) {
            price = parseInt(data.price)
          }
        }
      }

      // TwapOrder events
      if (event.type?.includes('TwapOrder')) {
        const data = event.data || {}
        if (data.avg_fill_px) {
          price = parseInt(data.avg_fill_px)
        }
        if (data.filled_size) {
          size = parseInt(data.filled_size)
          filled = true
        }
      }

      // PositionUpdate for backup price
      if (event.type?.includes('PositionUpdate') && price === 0) {
        const data = event.data || {}
        if (data.entry_price) {
          price = parseInt(data.entry_price)
        }
      }
    }

    return { price, size, notional, filled, functionType }
  } catch (e) {
    console.error(`Error fetching tx ${txHash}:`, e)
    return null
  }
}

async function fetchCurrentPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {}
  const marketAddresses: Record<string, string> = {
    '0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e': 'BTC/USD',
    '0x5d4a373896cc46ce5bd27f795587c1d682e7f57a3de6149d19cc3f3cb6c6800d': 'ETH/USD',
    '0xef5eee5ae8ba5726efcd8af6ee89dffe2ca08d20631fff3bafe98d89137a58c4': 'SOL/USD',
    '0xfaade75b8302ef13835f40c66ee812c3c0c8218549c42c0aebe24d79c27498d2': 'APT/USD',
    '0x25d0f38fb7a4210def4e62d41aa8e616172ea37692605961df63a1c773661c2': 'WLFI/USD',
  }

  console.log('Fetching current market prices...')

  for (const [address, name] of Object.entries(marketAddresses)) {
    try {
      const response = await fetch(`${APTOS_NODE}/accounts/${address}/resources`)
      if (response.ok) {
        const resources = await response.json()
        const priceResource = resources.find((r: any) => r.type?.includes('price_management::Price'))
        if (priceResource?.data?.oracle_px) {
          prices[name] = parseInt(priceResource.data.oracle_px) / Math.pow(10, MARKETS[name].pxDecimals)
        }
      }
    } catch (e) {
      console.error(`Failed to fetch price for ${name}`)
    }
  }

  return prices
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run')

  console.log('='.repeat(60))
  console.log('FIX ZERO VOLUME ORDERS')
  console.log('='.repeat(60))
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE (will update records)'}`)
  console.log(`Timestamp: ${new Date().toISOString()}`)

  // Find orders with $0 volume
  const zeroVolumeOrders = await prisma.orderHistory.findMany({
    where: { volumeGenerated: 0 },
    orderBy: { timestamp: 'desc' },
  })

  console.log(`\nFound ${zeroVolumeOrders.length} orders with $0 volume`)

  if (zeroVolumeOrders.length === 0) {
    console.log('No orders to fix!')
    await prisma.$disconnect()
    return
  }

  // Fetch current prices as fallback
  const currentPrices = await fetchCurrentPrices()
  console.log('Current prices:', currentPrices)

  let fixed = 0
  let skipped = 0
  let unfilled = 0
  let errors = 0
  let totalVolumeRecovered = 0

  console.log('\n--- Processing Orders ---')

  for (const order of zeroVolumeOrders) {
    const marketInfo = MARKETS[order.market || 'BTC/USD']
    if (!marketInfo) {
      console.log(`  ⚠️ Unknown market: ${order.market}`)
      skipped++
      continue
    }

    let entryPrice = 0
    let volumeGenerated = 0
    let correctSize = Number(order.size)

    // Try to get actual fill data from on-chain transaction
    if (order.txHash) {
      const txDetails = await fetchTxDetails(order.txHash)

      if (txDetails) {
        // If not filled, this order generated no volume
        if (!txDetails.filled) {
          console.log(`  ⏭️ Order not filled (${txDetails.functionType}): ${order.txHash?.slice(0, 20)}...`)
          unfilled++

          // For unfilled orders, we should delete them or mark them somehow
          // For now, just skip them - they shouldn't count as volume
          continue
        }

        // Get the actual fill price and size from events
        if (txDetails.price > 0) {
          entryPrice = txDetails.price / Math.pow(10, marketInfo.pxDecimals)
        }
        if (txDetails.size > 0) {
          correctSize = txDetails.size
        }
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 50))
    }

    // Calculate size in base asset using the correct size
    const sizeInBaseAsset = correctSize / Math.pow(10, marketInfo.szDecimals)

    // Fallback to current price if no fill price found
    if (entryPrice === 0) {
      const fallbackPrice = currentPrices[order.market || 'BTC/USD']
      if (fallbackPrice) {
        entryPrice = fallbackPrice
      }
    }

    if (entryPrice === 0) {
      console.log(`  ⚠️ Could not get price for ${order.txHash?.slice(0, 20)}...`)
      skipped++
      continue
    }

    volumeGenerated = sizeInBaseAsset * entryPrice

    // Sanity check: cap unreasonable volumes
    const MAX_REASONABLE_VOLUME = 500_000
    if (volumeGenerated > MAX_REASONABLE_VOLUME) {
      const isReasonableSize = (
        (order.market === 'BTC/USD' && sizeInBaseAsset < 10) ||
        (order.market === 'ETH/USD' && sizeInBaseAsset < 50) ||
        (order.market === 'APT/USD' && sizeInBaseAsset < 100000) ||
        (order.market === 'SOL/USD' && sizeInBaseAsset < 1000)
      )

      if (!isReasonableSize) {
        console.log(`  ⚠️ Unreasonable volume $${volumeGenerated.toFixed(2)} for ${order.market} size ${sizeInBaseAsset.toFixed(6)}`)
        skipped++
        continue
      }
    }

    if (!isDryRun) {
      try {
        await prisma.orderHistory.update({
          where: { id: order.id },
          data: {
            entryPrice,
            volumeGenerated,
            size: BigInt(correctSize),
          },
        })
        fixed++
        totalVolumeRecovered += volumeGenerated
      } catch (e) {
        console.error(`  ❌ Error updating ${order.id}:`, e)
        errors++
      }
    } else {
      console.log(`  Would fix: ${order.market} | size: ${sizeInBaseAsset.toFixed(6)} | price: $${entryPrice.toFixed(2)} | vol: $${volumeGenerated.toFixed(2)}`)
      fixed++
      totalVolumeRecovered += volumeGenerated
    }

    if (fixed % 50 === 0 && fixed > 0) {
      console.log(`  Processed ${fixed}/${zeroVolumeOrders.length}...`)
    }
  }

  console.log('\n--- Summary ---')
  console.log(`Fixed: ${fixed}`)
  console.log(`Unfilled (no volume): ${unfilled}`)
  console.log(`Skipped: ${skipped}`)
  console.log(`Errors: ${errors}`)
  console.log(`Volume recovered: $${totalVolumeRecovered.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)

  if (!isDryRun && fixed > 0) {
    // Update bot cumulative volume
    const botInstance = await prisma.botInstance.findFirst()
    if (botInstance) {
      const allOrders = await prisma.orderHistory.findMany({
        where: { botId: botInstance.id },
      })
      const newTotalVolume = allOrders.reduce((sum, o) => sum + o.volumeGenerated, 0)

      await prisma.botInstance.update({
        where: { id: botInstance.id },
        data: { cumulativeVolume: newTotalVolume },
      })

      console.log(`\nUpdated bot cumulative volume: $${newTotalVolume.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
    }
  }

  if (isDryRun) {
    console.log('\n🔍 DRY RUN - No changes made')
    console.log('Run without --dry-run to apply fixes')
  }

  console.log('\n' + '='.repeat(60))
  console.log('✅ COMPLETE')
  console.log('='.repeat(60))

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
