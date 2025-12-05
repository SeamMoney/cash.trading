/**
 * Audit script to compare on-chain position vs database
 */

import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk'
import { prisma } from '../lib/prisma'

const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'

// BTC market config
const BTC_MARKET = '0xf09e4b0d4e6c67e14eb639641729fbf925481ad64c80db79448e82a105fc1c83'
const BTC_SIZE_DECIMALS = 8  // 1e8 = 1 BTC
const BTC_PX_DECIMALS = 9    // prices in 1e9

async function main() {
  const userWallet = process.argv[2]

  if (!userWallet) {
    console.log('Usage: npx tsx scripts/audit-position.ts <walletAddress>')
    process.exit(1)
  }

  console.log(`\n🔍 Auditing position for wallet: ${userWallet}\n`)

  // 1. Get database state
  const bot = await prisma.botInstance.findUnique({
    where: { userWalletAddress: userWallet }
  })

  if (!bot) {
    console.log('❌ No bot found in database for this wallet')
    process.exit(1)
  }

  console.log('📦 DATABASE STATE:')
  console.log(`   Subaccount: ${bot.userSubaccount}`)
  console.log(`   Market: ${bot.market}`)
  console.log(`   Strategy: ${bot.strategy}`)
  console.log(`   Position Size (raw): ${bot.activePositionSize}`)
  console.log(`   Position Size (BTC): ${bot.activePositionSize ? Number(bot.activePositionSize) / 1e8 : 0}`)
  console.log(`   Position Direction: ${bot.activePositionIsLong ? 'LONG' : 'SHORT'}`)
  console.log(`   Position Entry: $${bot.activePositionEntry}`)
  console.log(`   Cumulative Volume: $${bot.cumulativeVolume}`)

  // 2. Get on-chain position
  const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }))

  console.log('\n🔗 ON-CHAIN STATE:')

  try {
    const resources = await aptos.getAccountResources({
      accountAddress: bot.userSubaccount
    })

    const positionsResource = resources.find(r =>
      r.type.includes('perp_positions::UserPositions')
    )

    if (!positionsResource) {
      console.log('   No positions resource found')
    } else {
      const data = positionsResource.data as any
      const entries = data.positions?.root?.children?.entries || []

      console.log(`   Total markets with positions: ${entries.length}`)

      for (const entry of entries) {
        const marketAddr = entry.key.inner
        const pos = entry.value.value
        const size = parseInt(pos.size)
        const isLong = pos.is_long
        const entryPx = parseInt(pos.avg_acquire_entry_px)
        const leverage = pos.user_leverage

        // Determine market
        const isBTC = marketAddr.toLowerCase() === BTC_MARKET.toLowerCase()
        const sizeDecimals = isBTC ? 8 : 8
        const pxDecimals = isBTC ? 9 : 6

        const sizeFormatted = size / Math.pow(10, sizeDecimals)
        const entryFormatted = entryPx / Math.pow(10, pxDecimals)

        console.log(`\n   Market: ${marketAddr.slice(0, 10)}... ${isBTC ? '(BTC)' : ''}`)
        console.log(`   Size (raw): ${size}`)
        console.log(`   Size (formatted): ${sizeFormatted.toFixed(8)}`)
        console.log(`   Direction: ${isLong ? 'LONG' : 'SHORT'}`)
        console.log(`   Entry (raw): ${entryPx}`)
        console.log(`   Entry (formatted): $${entryFormatted.toFixed(2)}`)
        console.log(`   Leverage: ${leverage}x`)
      }
    }

    // 3. Get current price
    const priceRes = await fetch(
      `https://api.testnet.aptoslabs.com/v1/accounts/${bot.market}/resources`
    )
    const priceResources = await priceRes.json()
    const priceResource = priceResources.find((r: any) => r.type.includes('price_management::Price'))

    if (priceResource) {
      const oraclePx = parseInt(priceResource.data.oracle_px)
      // BTC uses 9 decimals for prices
      const pxDecimals = bot.market.toLowerCase() === BTC_MARKET.toLowerCase() ? 9 : 6
      const currentPrice = oraclePx / Math.pow(10, pxDecimals)
      console.log(`\n💰 CURRENT PRICE: $${currentPrice.toFixed(2)} (raw: ${oraclePx}, decimals: ${pxDecimals})`)
    }

  } catch (error) {
    console.error('Error fetching on-chain data:', error)
  }

  // 4. Get recent orders from database
  console.log('\n📜 RECENT ORDERS (last 10):')
  const orders = await prisma.orderHistory.findMany({
    where: { botId: bot.id },
    orderBy: { timestamp: 'desc' },
    take: 10
  })

  for (const order of orders) {
    console.log(`   ${order.timestamp.toISOString()} | ${order.direction.toUpperCase()} | Vol: $${order.volumeGenerated.toFixed(2)} | PnL: ${order.pnl?.toFixed(4) || 'n/a'} | TX: ${order.txHash?.slice(0, 12)}...`)
  }

  await prisma.$disconnect()
}

main().catch(console.error)
