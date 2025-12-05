/**
 * Cleanup Unfilled Orders
 *
 * Checks each order's transaction for TradeEvents.
 * If no TradeEvent exists for our subaccount, the order never filled
 * and should be deleted.
 *
 * Usage:
 *   npx tsx scripts/cleanup-unfilled-orders.ts [--fix]
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APTOS_NODE = 'https://api.testnet.aptoslabs.com/v1'
const OUR_SUBACCOUNT = '0xfd59a5bbaa2d534533385511c79adace521eb67e3ac824c9ad0b8e0eaad4f14d'

interface FillInfo {
  filled: boolean
  filledSize: number
  fillPrice: number
}

async function checkOrderFilled(txHash: string): Promise<FillInfo | null> {
  try {
    const response = await fetch(`${APTOS_NODE}/transactions/by_hash/${txHash}`)
    if (!response.ok) return null

    const tx = await response.json()
    if (!tx.success) return { filled: false, filledSize: 0, fillPrice: 0 }

    const events = tx.events || []
    let filledSize = 0
    let fillPrice = 0

    for (const event of events) {
      // TradeEvent indicates actual fill
      if (event.type?.includes('TradeEvent')) {
        const data = event.data || {}
        // Check if this trade is for our account
        if (data.account === OUR_SUBACCOUNT) {
          filledSize += parseInt(data.size || '0')
          fillPrice = parseInt(data.price || '0')
        }
      }
    }

    return {
      filled: filledSize > 0,
      filledSize,
      fillPrice
    }
  } catch (e) {
    return null
  }
}

async function main() {
  const shouldFix = process.argv.includes('--fix')

  console.log('='.repeat(60))
  console.log('CLEANUP UNFILLED ORDERS')
  console.log('='.repeat(60))
  console.log(`Mode: ${shouldFix ? 'FIX' : 'DRY RUN'}`)
  console.log('')

  // Get all orders sorted by volume (check big ones first)
  const orders = await prisma.orderHistory.findMany({
    where: { volumeGenerated: { gt: 0 } },
    orderBy: { volumeGenerated: 'desc' }
  })

  console.log(`Checking ${orders.length} orders...`)
  console.log('')

  const toDelete: { id: string; volume: number; txHash: string }[] = []
  const toFix: { id: string; oldVolume: number; newVolume: number }[] = []
  let checked = 0
  let unfetchable = 0

  for (const order of orders) {
    checked++

    if (!order.txHash) {
      console.log(`[${checked}] No txHash - marking for delete`)
      toDelete.push({ id: order.id, volume: order.volumeGenerated, txHash: 'none' })
      continue
    }

    const result = await checkOrderFilled(order.txHash)

    if (result === null) {
      unfetchable++
      // Can't verify - skip for now
      continue
    }

    if (!result.filled) {
      console.log(`[${checked}] UNFILLED: ${order.txHash.slice(0, 20)}... vol=$${order.volumeGenerated.toFixed(0)}`)
      toDelete.push({ id: order.id, volume: order.volumeGenerated, txHash: order.txHash })
    } else if (result.filledSize > 0) {
      // Calculate actual volume from fill
      const sizeInBtc = result.filledSize / 1e8
      const priceInUsd = result.fillPrice / 1e6
      const actualVolume = sizeInBtc * priceInUsd

      // If volume differs significantly (>5%), mark for fix
      const diff = Math.abs(order.volumeGenerated - actualVolume)
      if (diff / actualVolume > 0.05 && diff > 100) {
        console.log(`[${checked}] WRONG VOL: ${order.txHash.slice(0, 20)}... recorded=$${order.volumeGenerated.toFixed(0)} actual=$${actualVolume.toFixed(0)}`)
        toFix.push({ id: order.id, oldVolume: order.volumeGenerated, newVolume: actualVolume })
      }
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 100))

    if (checked % 50 === 0) {
      console.log(`  Progress: ${checked}/${orders.length} (${toDelete.length} to delete, ${toFix.length} to fix)`)
    }
  }

  const volumeToRemove = toDelete.reduce((s, o) => s + o.volume, 0)
  const volumeToAdjust = toFix.reduce((s, o) => s + (o.oldVolume - o.newVolume), 0)

  console.log('')
  console.log('=== SUMMARY ===')
  console.log(`Checked: ${checked}`)
  console.log(`Unfetchable (skipped): ${unfetchable}`)
  console.log(`Unfilled (to delete): ${toDelete.length}`)
  console.log(`Wrong volume (to fix): ${toFix.length}`)
  console.log('')
  console.log(`Volume to remove: $${volumeToRemove.toLocaleString()}`)
  console.log(`Volume to adjust: $${volumeToAdjust.toLocaleString()}`)

  if (!shouldFix) {
    console.log('')
    console.log('Run with --fix to apply changes')
    await prisma.$disconnect()
    return
  }

  console.log('')
  console.log('=== APPLYING FIXES ===')

  // Delete unfilled orders
  let deleted = 0
  for (const item of toDelete) {
    try {
      await prisma.orderHistory.delete({ where: { id: item.id } })
      deleted++
    } catch (e) {
      console.error(`Failed to delete ${item.id}`)
    }
  }
  console.log(`Deleted ${deleted} unfilled orders`)

  // Fix wrong volumes
  let fixed = 0
  for (const item of toFix) {
    try {
      await prisma.orderHistory.update({
        where: { id: item.id },
        data: { volumeGenerated: item.newVolume }
      })
      fixed++
    } catch (e) {
      console.error(`Failed to fix ${item.id}`)
    }
  }
  console.log(`Fixed ${fixed} order volumes`)

  // Update bot total
  const bot = await prisma.botInstance.findFirst()
  if (bot) {
    const allOrders = await prisma.orderHistory.findMany({ where: { botId: bot.id } })
    const newTotal = allOrders.reduce((s, o) => s + o.volumeGenerated, 0)
    await prisma.botInstance.update({
      where: { id: bot.id },
      data: { cumulativeVolume: newTotal }
    })
    console.log(`Updated bot volume to: $${newTotal.toLocaleString()}`)
  }

  console.log('')
  console.log('✅ CLEANUP COMPLETE')

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
