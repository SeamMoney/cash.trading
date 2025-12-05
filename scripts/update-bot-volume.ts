import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function fix() {
  const orders = await prisma.orderHistory.findMany()
  const totalVolume = orders.reduce((s, o) => s + o.volumeGenerated, 0)
  const totalPnl = orders.reduce((s, o) => s + (o.pnl || 0), 0)

  const bot = await prisma.botInstance.findFirst()
  if (bot) {
    await prisma.botInstance.update({
      where: { id: bot.id },
      data: { cumulativeVolume: totalVolume }
    })
    console.log('Updated bot cumulative volume to:', totalVolume.toLocaleString())
  }

  const tradesWithPnl = orders.filter(o => o.pnl !== null && o.pnl !== 0)
  const winners = tradesWithPnl.filter(o => (o.pnl || 0) > 0)

  console.log('')
  console.log('=== FINAL STATS ===')
  console.log('Total trades:', orders.length)
  console.log('Total volume: $' + totalVolume.toLocaleString())
  console.log('Total PnL: $' + totalPnl.toFixed(2))
  console.log('Win rate:', (winners.length / tradesWithPnl.length * 100).toFixed(1) + '% (' + winners.length + '/' + tradesWithPnl.length + ')')

  await prisma.$disconnect()
}
fix()
