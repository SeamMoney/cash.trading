/**
 * Cleanup script to find and remove corrupted trade records
 *
 * The issue: Some trades were recorded with wrong entry prices due to
 * incorrect price decimal handling in earlier code. For example:
 * - BTC entry price of $1.44 instead of ~$87,000
 * - This causes massively incorrect PnL calculations
 */

import { prisma } from '../lib/prisma'

async function main() {
  console.log('🔍 Searching for corrupted trade records...\n')

  // Find all OrderHistory records
  const allOrders = await prisma.orderHistory.findMany({
    orderBy: { timestamp: 'desc' },
    include: { bot: { select: { marketName: true, userWalletAddress: true } } }
  })

  console.log(`Total orders in database: ${allOrders.length}\n`)

  // Identify corrupted records based on unrealistic entry prices
  const corrupted: typeof allOrders = []

  for (const order of allOrders) {
    const market = order.market || order.bot?.marketName || ''
    const entry = order.entryPrice || 0
    const exit = order.exitPrice || 0

    // BTC should be $50k-$150k range, not $1-$100
    if (market.includes('BTC')) {
      if ((entry > 0 && entry < 1000) || (exit > 0 && exit < 1000)) {
        corrupted.push(order)
        continue
      }
    }

    // ETH should be $2k-$10k range
    if (market.includes('ETH')) {
      if ((entry > 0 && entry < 100) || (exit > 0 && exit < 100)) {
        corrupted.push(order)
        continue
      }
    }

    // SOL should be $50-$500 range
    if (market.includes('SOL')) {
      if ((entry > 0 && entry < 1) || (exit > 0 && exit < 1)) {
        corrupted.push(order)
        continue
      }
    }

    // APT should be $5-$50 range
    if (market.includes('APT')) {
      if ((entry > 0 && entry < 0.1) || (exit > 0 && exit < 0.1)) {
        corrupted.push(order)
        continue
      }
    }

    // Also flag any trade with absurdly high PnL (likely corrupted)
    if (Math.abs(order.pnl) > 10000) {
      corrupted.push(order)
      continue
    }
  }

  if (corrupted.length === 0) {
    console.log('✅ No corrupted records found!')
    await prisma.$disconnect()
    return
  }

  console.log(`⚠️  Found ${corrupted.length} corrupted records:\n`)

  for (const order of corrupted) {
    console.log(`ID: ${order.id}`)
    console.log(`  Market: ${order.market || order.bot?.marketName}`)
    console.log(`  Direction: ${order.direction}`)
    console.log(`  Entry: $${order.entryPrice?.toFixed(6) || 'n/a'}`)
    console.log(`  Exit: $${order.exitPrice?.toFixed(6) || 'n/a'}`)
    console.log(`  PnL: $${order.pnl.toFixed(2)}`)
    console.log(`  Volume: $${order.volumeGenerated.toFixed(2)}`)
    console.log(`  Wallet: ${order.bot?.userWalletAddress?.slice(0, 10)}...`)
    console.log(`  Date: ${order.timestamp.toISOString()}`)
    console.log('')
  }

  // Check for --delete flag
  const shouldDelete = process.argv.includes('--delete')

  if (shouldDelete) {
    console.log('🗑️  Deleting corrupted records...')

    const ids = corrupted.map(o => o.id)
    const result = await prisma.orderHistory.deleteMany({
      where: { id: { in: ids } }
    })

    console.log(`✅ Deleted ${result.count} corrupted records`)
  } else {
    console.log('ℹ️  Run with --delete flag to remove these records:')
    console.log('   npx tsx scripts/cleanup-corrupted-trades.ts --delete')
  }

  await prisma.$disconnect()
}

main().catch(console.error)
