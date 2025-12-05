import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function check() {
  // Get all orders
  const ordersWithPnl = await prisma.orderHistory.findMany({
    orderBy: { timestamp: 'desc' }
  })

  // Filter to only non-zero PnL
  const nonZeroPnl = ordersWithPnl.filter(o => o.pnl !== 0)

  console.log('=== ALL ORDERS WITH NON-ZERO PNL ===')
  console.log('Count:', nonZeroPnl.length)
  console.log('')

  // Group by entry price + direction
  const byKey = new Map<string, typeof nonZeroPnl>()
  for (const o of nonZeroPnl) {
    const key = `${o.entryPrice?.toFixed(2)}-${o.direction}`
    const existing = byKey.get(key) || []
    existing.push(o)
    byKey.set(key, existing)
  }

  let duplicatePnl = 0
  let realPnl = 0
  const duplicateIds: string[] = []

  for (const [key, orders] of byKey) {
    if (orders.length > 1) {
      console.log('DUPLICATE KEY:', key)
      console.log('  Count:', orders.length)

      // Keep only the first (most recent) one as "real"
      const real = orders[0]
      const duplicates = orders.slice(1)

      realPnl += real.pnl || 0
      for (const dup of duplicates) {
        duplicatePnl += dup.pnl || 0
        duplicateIds.push(dup.id)
        console.log(`  DUP: ${dup.timestamp.toISOString().slice(0, 19)} | PnL: ${(dup.pnl || 0).toFixed(2)} | Exit: ${dup.exitPrice?.toFixed(2) || 'N/A'}`)
      }
      console.log(`  REAL: ${real.timestamp.toISOString().slice(0, 19)} | PnL: ${(real.pnl || 0).toFixed(2)} | Exit: ${real.exitPrice?.toFixed(2) || 'N/A'}`)
      console.log('')
    } else {
      realPnl += orders[0].pnl || 0
    }
  }

  console.log('=== SUMMARY ===')
  console.log('Total PnL (current):', nonZeroPnl.reduce((s, o) => s + (o.pnl || 0), 0).toFixed(2))
  console.log('Duplicate PnL to remove:', duplicatePnl.toFixed(2))
  console.log('Real PnL after dedup:', realPnl.toFixed(2))
  console.log('')
  console.log('Duplicate IDs to fix:', duplicateIds.length)

  // Ask if we should fix
  if (duplicateIds.length > 0) {
    console.log('')
    console.log('IDs to set PnL to 0:')
    for (const id of duplicateIds) {
      console.log('  ', id)
    }
  }

  await prisma.$disconnect()
}
check()
