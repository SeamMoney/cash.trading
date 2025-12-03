/**
 * Cleanup Bad Orders Script
 *
 * Identifies and removes orders with incorrect data:
 * - Orders where price was stored as size (backfill bug)
 * - Unfilled orders that shouldn't count as volume
 * - Orders with unreasonable sizes
 *
 * Usage:
 *   npx tsx scripts/cleanup-bad-orders.ts [--dry-run]
 *
 * Options:
 *   --dry-run    Show what would be deleted without actually deleting
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APTOS_NODE = 'https://api.testnet.aptoslabs.com/v1'

interface TxStatus {
  filled: boolean
  actualSize: number
  actualPrice: number
}

async function checkTxStatus(txHash: string): Promise<TxStatus | null> {
  try {
    const response = await fetch(`${APTOS_NODE}/transactions/by_hash/${txHash}`)
    if (!response.ok) return null

    const tx = await response.json()
    if (!tx.success) return null

    const events = tx.events || []
    let filled = false
    let actualSize = 0
    let actualPrice = 0

    for (const event of events) {
      // TradeEvent has the actual fill data
      if (event.type?.includes('TradeEvent')) {
        const data = event.data || {}
        if (data.size) {
          actualSize = parseInt(data.size)
          filled = true
        }
        if (data.price) {
          actualPrice = parseInt(data.price)
        }
      }

      // BulkOrderFilledEvent
      if (event.type?.includes('BulkOrderFilledEvent')) {
        const data = event.data || {}
        if (data.filled_size) {
          actualSize = parseInt(data.filled_size)
          filled = true
        }
        if (data.price) {
          actualPrice = parseInt(data.price)
        }
      }

      // OrderEvent with FILLED status
      if (event.type?.includes('OrderEvent')) {
        const data = event.data || {}
        if (data.status?.__variant__ === 'FILLED') {
          if (data.orig_size) {
            actualSize = parseInt(data.orig_size)
          }
          if (data.price) {
            actualPrice = parseInt(data.price)
          }
          filled = true
        }
      }
    }

    return { filled, actualSize, actualPrice }
  } catch (e) {
    console.error(`Error checking tx ${txHash}:`, e)
    return null
  }
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run')

  console.log('='.repeat(60))
  console.log('CLEANUP BAD ORDERS')
  console.log('='.repeat(60))
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE (will delete records)'}`)
  console.log(`Timestamp: ${new Date().toISOString()}`)

  // Find suspicious orders - size looks like a price value
  // BTC price is ~$90k, so sizes that are 90 billion+ are suspicious
  const suspiciousOrders = await prisma.orderHistory.findMany({
    where: {
      OR: [
        // Size looks like BTC price (80k-150k range when divided by 1e8)
        { size: { gte: 80_000_000_000n, lte: 150_000_000_000n } },
        // Or very large sizes with $0 volume
        { size: { gt: 1_000_000_000n }, volumeGenerated: 0 },
      ]
    },
    orderBy: { timestamp: 'desc' },
  })

  console.log(`\nFound ${suspiciousOrders.length} suspicious orders`)

  let toDelete: string[] = []
  let toFix: { id: string; size: bigint; price: number; volume: number }[] = []
  let checked = 0

  console.log('\n--- Checking Orders ---')

  for (const order of suspiciousOrders) {
    checked++

    if (!order.txHash) {
      console.log(`  ⚠️ No txHash: ${order.id}`)
      toDelete.push(order.id)
      continue
    }

    const status = await checkTxStatus(order.txHash)

    if (!status) {
      // Can't verify the transaction - if it has $0 volume and unreasonable size, delete it
      if (order.volumeGenerated === 0 && Number(order.size) > 1_000_000_000) {
        console.log(`  🗑️ Unverifiable + $0 vol + bad size: ${order.txHash.slice(0, 20)}... (will delete)`)
        toDelete.push(order.id)
      } else {
        console.log(`  ⚠️ Could not verify (keeping): ${order.txHash.slice(0, 20)}...`)
      }
      continue
    }

    if (!status.filled) {
      // Order was never filled - should not count as volume
      console.log(`  🗑️ Unfilled order: ${order.txHash.slice(0, 20)}... (will delete)`)
      toDelete.push(order.id)
    } else if (status.actualSize > 0 && status.actualSize !== Number(order.size)) {
      // Order was filled but size is wrong
      const marketInfo = { pxDecimals: 6, szDecimals: 8 } // Assume BTC for now
      const sizeInBase = status.actualSize / Math.pow(10, marketInfo.szDecimals)
      const price = status.actualPrice / Math.pow(10, marketInfo.pxDecimals)
      const volume = sizeInBase * price

      console.log(`  🔧 Fix size: ${order.txHash.slice(0, 20)}... (${Number(order.size)} -> ${status.actualSize}, vol: $${volume.toFixed(2)})`)
      toFix.push({ id: order.id, size: BigInt(status.actualSize), price, volume })
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 50))

    if (checked % 20 === 0) {
      console.log(`  Checked ${checked}/${suspiciousOrders.length}...`)
    }
  }

  console.log('\n--- Summary ---')
  console.log(`Orders to delete (unfilled): ${toDelete.length}`)
  console.log(`Orders to fix (wrong size): ${toFix.length}`)

  if (isDryRun) {
    console.log('\n🔍 DRY RUN - No changes made')
    console.log('Run without --dry-run to apply changes')
    await prisma.$disconnect()
    return
  }

  // Delete unfilled orders
  if (toDelete.length > 0) {
    console.log('\n--- Deleting Unfilled Orders ---')
    for (const id of toDelete) {
      try {
        await prisma.orderHistory.delete({ where: { id } })
      } catch (e) {
        console.error(`  Error deleting ${id}:`, e)
      }
    }
    console.log(`  Deleted ${toDelete.length} orders`)
  }

  // Fix orders with wrong sizes
  if (toFix.length > 0) {
    console.log('\n--- Fixing Order Sizes ---')
    for (const fix of toFix) {
      try {
        await prisma.orderHistory.update({
          where: { id: fix.id },
          data: {
            size: fix.size,
            entryPrice: fix.price,
            volumeGenerated: fix.volume,
          },
        })
      } catch (e) {
        console.error(`  Error fixing ${fix.id}:`, e)
      }
    }
    console.log(`  Fixed ${toFix.length} orders`)
  }

  // Update bot cumulative volume
  if (toDelete.length > 0 || toFix.length > 0) {
    console.log('\n--- Updating Bot Volume ---')
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

      console.log(`  New total volume: $${newTotalVolume.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('✅ CLEANUP COMPLETE')
  console.log('='.repeat(60))

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
