/**
 * Test the stats API logic
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== STATS API TEST ===\n')

  // Get all valid orders (exclude cooldown, include only those with volume)
  const orders = await prisma.orderHistory.findMany({
    where: {
      volumeGenerated: { gt: 0 },
      NOT: { txHash: 'cooldown' },
    },
    select: {
      volumeGenerated: true,
      pnl: true,
      timestamp: true,
      direction: true,
      botId: true,
    }
  })

  console.log(`Total valid orders: ${orders.length}`)

  // Volume stats
  const totalVolume = orders.reduce((sum, o) => sum + o.volumeGenerated, 0)
  const avgTradeSize = orders.length > 0 ? totalVolume / orders.length : 0

  console.log(`\n📊 VOLUME STATS`)
  console.log(`  Total: $${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
  console.log(`  Avg per trade: $${avgTradeSize.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)

  // Direction breakdown
  const longTrades = orders.filter(o => o.direction === 'long')
  const shortTrades = orders.filter(o => o.direction === 'short')
  const longVolume = longTrades.reduce((sum, o) => sum + o.volumeGenerated, 0)
  const shortVolume = shortTrades.reduce((sum, o) => sum + o.volumeGenerated, 0)

  console.log(`  Long volume: $${longVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${longTrades.length} trades)`)
  console.log(`  Short volume: $${shortVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${shortTrades.length} trades)`)

  // PnL stats
  const totalPnl = orders.reduce((sum, o) => sum + (o.pnl || 0), 0)
  const tradesWithPnl = orders.filter(o => o.pnl !== null && o.pnl !== 0)
  const winningTrades = tradesWithPnl.filter(o => (o.pnl || 0) > 0)
  const losingTrades = tradesWithPnl.filter(o => (o.pnl || 0) < 0)
  const winRate = tradesWithPnl.length > 0 ? (winningTrades.length / tradesWithPnl.length) * 100 : 0

  const pnlValues = orders.map(o => o.pnl || 0).filter(p => p !== 0)
  const bestTrade = pnlValues.length > 0 ? Math.max(...pnlValues) : 0
  const worstTrade = pnlValues.length > 0 ? Math.min(...pnlValues) : 0

  console.log(`\n💰 PNL STATS`)
  console.log(`  Total PnL: $${totalPnl.toFixed(2)}`)
  console.log(`  Trades with PnL: ${tradesWithPnl.length}`)
  console.log(`  Wins: ${winningTrades.length}, Losses: ${losingTrades.length}`)
  console.log(`  Win Rate: ${winRate.toFixed(1)}%`)
  console.log(`  Best trade: $${bestTrade.toFixed(2)}`)
  console.log(`  Worst trade: $${worstTrade.toFixed(2)}`)

  // User stats
  const uniqueBotIds = new Set(orders.map(o => o.botId))
  const totalUsers = await prisma.botInstance.count()

  console.log(`\n👥 USER STATS`)
  console.log(`  Total registered: ${totalUsers}`)
  console.log(`  Active (with trades): ${uniqueBotIds.size}`)

  // Leaderboard
  console.log(`\n🏆 LEADERBOARD (by volume)`)

  const bots = await prisma.botInstance.findMany({
    select: {
      id: true,
      userWalletAddress: true,
      strategy: true,
      orders: {
        where: {
          volumeGenerated: { gt: 0 },
          NOT: { txHash: 'cooldown' },
        },
        select: {
          volumeGenerated: true,
          pnl: true,
        }
      }
    }
  })

  const userStats = bots.map(bot => {
    const volume = bot.orders.reduce((sum, o) => sum + o.volumeGenerated, 0)
    const pnl = bot.orders.reduce((sum, o) => sum + (o.pnl || 0), 0)
    const trades = bot.orders.length
    return {
      wallet: bot.userWalletAddress.slice(0, 6) + '...' + bot.userWalletAddress.slice(-4),
      strategy: bot.strategy,
      volume,
      pnl,
      trades,
    }
  }).filter(u => u.volume > 0).sort((a, b) => b.volume - a.volume)

  for (let i = 0; i < userStats.length; i++) {
    const u = userStats[i]
    console.log(`  ${i + 1}. ${u.wallet} - $${u.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${u.trades} trades, PnL: $${u.pnl.toFixed(2)})`)
  }

  await prisma.$disconnect()
}

main().catch(console.error)
