/**
 * Audit All Orders Script
 *
 * Checks every order in the database against the on-chain transaction
 * to verify:
 * 1. Transaction succeeded
 * 2. Order was actually filled (not cancelled)
 * 3. Volume is correct based on actual fill
 *
 * Usage:
 *   npx tsx scripts/audit-all-orders.ts [--fix]
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APTOS_NODE = 'https://api.testnet.aptoslabs.com/v1'

interface TxResult {
  success: boolean
  filled: boolean
  filledSize: number
  fillPrice: number
  cancelled: boolean
  cancelReason?: string
}

async function checkTransaction(txHash: string): Promise<TxResult | null> {
  try {
    const response = await fetch(`${APTOS_NODE}/transactions/by_hash/${txHash}`)
    if (!response.ok) return null

    const tx = await response.json()
    if (!tx.success) {
      return { success: false, filled: false, filledSize: 0, fillPrice: 0, cancelled: false }
    }

    const events = tx.events || []
    let filled = false
    let filledSize = 0
    let fillPrice = 0
    let cancelled = false
    let cancelReason: string | undefined

    for (const event of events) {
      // Check for TradeEvent - indicates actual fill
      if (event.type?.includes('TradeEvent')) {
        const data = event.data || {}
        // Only count if this is for our subaccount
        if (data.account === '0xfd59a5bbaa2d534533385511c79adace521eb67e3ac824c9ad0b8e0eaad4f14d') {
          filledSize += parseInt(data.size || '0')
          fillPrice = parseInt(data.price || '0')
          filled = true
        }
      }

      // Check for OrderEvent with status
      if (event.type?.includes('OrderEvent')) {
        const data = event.data || {}
        if (data.status?.__variant__ === 'CANCELLED') {
          cancelled = true
          cancelReason = data.details || 'Unknown'
        }
        if (data.status?.__variant__ === 'FILLED') {
          filled = true
          if (data.orig_size) {
            filledSize = parseInt(data.orig_size)
          }
          if (data.price) {
            fillPrice = parseInt(data.price)
          }
        }
      }
    }

    return { success: true, filled, filledSize, fillPrice, cancelled, cancelReason }
  } catch (e) {
    console.error(`Error checking tx ${txHash}:`, e)
    return null
  }
}

async function main() {
  const shouldFix = process.argv.includes('--fix')

  console.log('='.repeat(60))
  console.log('AUDIT ALL ORDERS')
  console.log('='.repeat(60))
  console.log(`Mode: ${shouldFix ? 'FIX MODE' : 'AUDIT ONLY'}`)
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log('')

  // Get all orders with non-zero volume
  const orders = await prisma.orderHistory.findMany({
    where: { volumeGenerated: { gt: 0 } },
    orderBy: { timestamp: 'desc' }
  })

  console.log(`Found ${orders.length} orders with volume to audit`)
  console.log('')

  let totalIssues = 0
  let unfilled = 0
  let cancelled = 0
  let wrongVolume = 0
  const toDelete: string[] = []
  const toFix: { id: string; volume: number }[] = []

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i]

    if (!order.txHash) {
      console.log(`  [${i + 1}] No txHash - skipping`)
      continue
    }

    const result = await checkTransaction(order.txHash)

    if (!result) {
      console.log(`  [${i + 1}] Could not fetch tx ${order.txHash.slice(0, 20)}...`)
      continue
    }

    if (!result.success) {
      console.log(`  [${i + 1}] TX FAILED: ${order.txHash.slice(0, 20)}...`)
      toDelete.push(order.id)
      totalIssues++
      continue
    }

    if (result.cancelled && !result.filled) {
      console.log(`  [${i + 1}] CANCELLED (${result.cancelReason}): ${order.txHash.slice(0, 20)}... vol=$${order.volumeGenerated.toFixed(0)}`)
      toDelete.push(order.id)
      cancelled++
      totalIssues++
      continue
    }

    if (!result.filled) {
      console.log(`  [${i + 1}] NOT FILLED: ${order.txHash.slice(0, 20)}... vol=$${order.volumeGenerated.toFixed(0)}`)
      toDelete.push(order.id)
      unfilled++
      totalIssues++
      continue
    }

    // Calculate expected volume from fill
    if (result.filledSize > 0 && result.fillPrice > 0) {
      const sizeInBtc = result.filledSize / 1e8  // Assuming BTC
      const priceInUsd = result.fillPrice / 1e6
      const expectedVolume = sizeInBtc * priceInUsd

      const volumeDiff = Math.abs(order.volumeGenerated - expectedVolume)
      const volumeDiffPct = (volumeDiff / expectedVolume) * 100

      if (volumeDiffPct > 10) {
        console.log(`  [${i + 1}] WRONG VOLUME: ${order.txHash.slice(0, 20)}... expected=$${expectedVolume.toFixed(0)} got=$${order.volumeGenerated.toFixed(0)}`)
        toFix.push({ id: order.id, volume: expectedVolume })
        wrongVolume++
        totalIssues++
      }
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 50))

    if ((i + 1) % 50 === 0) {
      console.log(`  Checked ${i + 1}/${orders.length}...`)
    }
  }

  console.log('')
  console.log('=== SUMMARY ===')
  console.log(`Total orders checked: ${orders.length}`)
  console.log(`Issues found: ${totalIssues}`)
  console.log(`  - Cancelled: ${cancelled}`)
  console.log(`  - Unfilled: ${unfilled}`)
  console.log(`  - Wrong volume: ${wrongVolume}`)
  console.log(`  - To delete: ${toDelete.length}`)
  console.log(`  - To fix: ${toFix.length}`)

  if (!shouldFix) {
    console.log('')
    console.log('Run with --fix to apply changes')
    await prisma.$disconnect()
    return
  }

  // Apply fixes
  console.log('')
  console.log('=== APPLYING FIXES ===')

  // Delete bad orders
  for (const id of toDelete) {
    try {
      await prisma.orderHistory.delete({ where: { id } })
    } catch (e) {
      console.error(`Error deleting ${id}:`, e)
    }
  }
  console.log(`Deleted ${toDelete.length} orders`)

  // Fix volumes
  for (const fix of toFix) {
    try {
      await prisma.orderHistory.update({
        where: { id: fix.id },
        data: { volumeGenerated: fix.volume }
      })
    } catch (e) {
      console.error(`Error fixing ${fix.id}:`, e)
    }
  }
  console.log(`Fixed ${toFix.length} volumes`)

  // Recalculate bot totals
  const bot = await prisma.botInstance.findFirst()
  if (bot) {
    const allOrders = await prisma.orderHistory.findMany({ where: { botId: bot.id } })
    const totalVolume = allOrders.reduce((sum, o) => sum + o.volumeGenerated, 0)

    await prisma.botInstance.update({
      where: { id: bot.id },
      data: { cumulativeVolume: totalVolume }
    })

    console.log(`Updated bot volume to: $${totalVolume.toLocaleString()}`)
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('✅ AUDIT COMPLETE')
  console.log('='.repeat(60))

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
