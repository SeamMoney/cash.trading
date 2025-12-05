import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function check() {
  const orders = await prisma.orderHistory.findMany()

  const totalVolume = orders.reduce((sum, o) => sum + o.volumeGenerated, 0)
  const totalPnl = orders.reduce((sum, o) => sum + (o.pnl || 0), 0)

  const tradesWithPnl = orders.filter(o => o.pnl !== 0 && o.pnl !== null)
  const winningTrades = tradesWithPnl.filter(o => o.pnl > 0)

  const pnlValues = orders.map(o => o.pnl || 0).filter(p => p !== 0)
  const bestTrade = pnlValues.length > 0 ? Math.max(...pnlValues) : 0
  const worstTrade = pnlValues.length > 0 ? Math.min(...pnlValues) : 0

  console.log('=== CORRECT STATS ===')
  console.log('Total trades:', orders.length)
  console.log('Total volume: $' + totalVolume.toLocaleString())
  console.log('Total PnL: $' + totalPnl.toFixed(2))
  console.log('')
  console.log('Trades with PnL:', tradesWithPnl.length)
  console.log('Winning trades:', winningTrades.length)
  console.log('Win rate:', tradesWithPnl.length > 0 ? ((winningTrades.length / tradesWithPnl.length) * 100).toFixed(1) + '%' : 'N/A')
  console.log('')
  console.log('Best trade: $' + bestTrade.toFixed(2))
  console.log('Worst trade: $' + worstTrade.toFixed(2))

  await prisma.$disconnect()
}
check().catch(console.error)
