import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function fix() {
  const duplicateIds = [
    'cmipa2rgf0003sokigcatw1my',
    'cmipa2gjt0001sokiez7tvcxi',
    'cmipa231m0002jsby21dq6z26',
    'cmip6rvan00159kbqf4pu8jj8',
  ]

  for (const id of duplicateIds) {
    await prisma.orderHistory.update({
      where: { id },
      data: { pnl: 0 }
    })
    console.log('Fixed:', id)
  }

  // Recalculate totals
  const orders = await prisma.orderHistory.findMany()
  const totalPnl = orders.reduce((s, o) => s + (o.pnl || 0), 0)
  const totalVolume = orders.reduce((s, o) => s + o.volumeGenerated, 0)

  console.log('')
  console.log('After fix:')
  console.log('Total PnL:', totalPnl.toFixed(2))
  console.log('Total Volume:', totalVolume.toLocaleString())

  // Count trades with PnL
  const tradesWithPnl = orders.filter(o => o.pnl !== null && o.pnl !== 0)
  const winners = tradesWithPnl.filter(o => (o.pnl || 0) > 0)
  console.log('Trades with PnL:', tradesWithPnl.length)
  console.log('Winners:', winners.length)
  console.log('Win rate:', ((winners.length / tradesWithPnl.length) * 100).toFixed(1) + '%')

  await prisma.$disconnect()
}
fix()
