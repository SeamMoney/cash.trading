/**
 * Reconcile Volume Script
 *
 * Compares on-chain TradeEvents with database records to find discrepancies.
 * This helps identify:
 * - Trades recorded on-chain but not in database
 * - Database records that don't match on-chain
 * - The true total volume from on-chain events
 *
 * Usage:
 *   BOT_OPERATOR=0x... SUBACCOUNT=0x... npx tsx scripts/reconcile-volume.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APTOS_NODE = 'https://api.testnet.aptoslabs.com/v1'

// Get addresses from environment variables
const BOT_OPERATOR = process.env.BOT_OPERATOR
const SUBACCOUNT = process.env.SUBACCOUNT

interface OnChainTrade {
  txHash: string
  timestamp: Date
  direction: 'long' | 'short'
  action: string
  sizeRaw: bigint
  sizeBTC: number
  price: number
  volumeUSD: number
  realizedPnl: number
  market: string
}

async function fetchAllBotTransactions(): Promise<any[]> {
  const allTxs: any[] = []
  let start = 0
  const limit = 100

  console.log('Fetching all bot operator transactions...')

  while (true) {
    const url = `${APTOS_NODE}/accounts/${BOT_OPERATOR}/transactions?start=${start}&limit=${limit}`
    const response = await fetch(url)

    if (!response.ok) {
      console.error('Failed to fetch:', response.status)
      break
    }

    const txs = await response.json()
    if (!txs || txs.length === 0) break

    allTxs.push(...txs)
    process.stdout.write(`\r  Fetched ${allTxs.length} transactions...`)

    if (txs.length < limit) break
    start += limit

    await new Promise(r => setTimeout(r, 50))
  }

  console.log('')
  return allTxs
}

function extractTradesForSubaccount(tx: any): OnChainTrade[] {
  const trades: OnChainTrade[] = []

  if (!tx.success) return trades

  const events = tx.events || []

  for (const event of events) {
    if (event.type?.includes('TradeEvent')) {
      const data = event.data || {}

      // Only count trades for our subaccount
      if (data.account?.toLowerCase() === SUBACCOUNT.toLowerCase()) {
        const sizeRaw = BigInt(data.size || '0')
        const sizeBTC = Number(sizeRaw) / 1e8
        const price = parseInt(data.price || '0') / 1e6
        const volumeUSD = sizeBTC * price
        const realizedPnl = parseInt(data.realized_pnl || '0') / 1e6

        // Determine direction from action
        const action = data.action?.__variant__ || data.action || ''
        let direction: 'long' | 'short' = 'short'
        if (action.toLowerCase().includes('long') || action.toLowerCase().includes('buy')) {
          direction = 'long'
        }

        const market = data.market?.inner || data.market || 'unknown'

        trades.push({
          txHash: tx.hash,
          timestamp: new Date(parseInt(tx.timestamp) / 1000),
          direction,
          action,
          sizeRaw,
          sizeBTC,
          price,
          volumeUSD,
          realizedPnl,
          market: market.slice(0, 10) + '...',
        })
      }
    }
  }

  return trades
}

async function main() {
  if (!BOT_OPERATOR || !SUBACCOUNT) {
    console.error('Error: BOT_OPERATOR and SUBACCOUNT environment variables are required')
    console.error('Usage: BOT_OPERATOR=0x... SUBACCOUNT=0x... npx tsx scripts/reconcile-volume.ts')
    process.exit(1)
  }

  console.log('='.repeat(70))
  console.log('VOLUME RECONCILIATION REPORT')
  console.log('='.repeat(70))
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log(`Subaccount: ${SUBACCOUNT.slice(0, 10)}...${SUBACCOUNT.slice(-6)}`)
  console.log('')

  // 1. Fetch all on-chain trades
  const txs = await fetchAllBotTransactions()
  console.log(`Total transactions: ${txs.length}`)

  // 2. Extract TradeEvents for our subaccount
  console.log('\nExtracting TradeEvents for subaccount...')
  const onChainTrades: OnChainTrade[] = []

  for (const tx of txs) {
    const trades = extractTradesForSubaccount(tx)
    onChainTrades.push(...trades)
  }

  console.log(`Found ${onChainTrades.length} TradeEvents on-chain`)

  // 3. Calculate on-chain totals
  let onChainTotalVolume = 0
  let onChainTotalPnl = 0
  const onChainByMonth: Record<string, { volume: number; count: number; pnl: number }> = {}

  for (const trade of onChainTrades) {
    onChainTotalVolume += trade.volumeUSD
    onChainTotalPnl += trade.realizedPnl

    const monthKey = `${trade.timestamp.getFullYear()}-${String(trade.timestamp.getMonth() + 1).padStart(2, '0')}`
    if (!onChainByMonth[monthKey]) {
      onChainByMonth[monthKey] = { volume: 0, count: 0, pnl: 0 }
    }
    onChainByMonth[monthKey].volume += trade.volumeUSD
    onChainByMonth[monthKey].count++
    onChainByMonth[monthKey].pnl += trade.realizedPnl
  }

  // 4. Get database totals
  console.log('\nFetching database records...')
  const dbOrders = await prisma.orderHistory.findMany({
    where: { volumeGenerated: { gt: 0 } }
  })

  let dbTotalVolume = 0
  let dbTotalPnl = 0
  const dbTxHashes = new Set<string>()

  for (const order of dbOrders) {
    dbTotalVolume += order.volumeGenerated
    dbTotalPnl += order.pnl || 0
    if (order.txHash && order.txHash !== 'cooldown') {
      dbTxHashes.add(order.txHash)
    }
  }

  console.log(`Database orders: ${dbOrders.length}`)

  // 5. Find discrepancies
  const onChainTxHashes = new Set(onChainTrades.map(t => t.txHash))
  const missingFromDb: OnChainTrade[] = []
  const inDbNotOnChain: string[] = []

  for (const trade of onChainTrades) {
    if (!dbTxHashes.has(trade.txHash)) {
      missingFromDb.push(trade)
    }
  }

  for (const hash of dbTxHashes) {
    if (!onChainTxHashes.has(hash)) {
      inDbNotOnChain.push(hash)
    }
  }

  // 6. Print report
  console.log('\n' + '='.repeat(70))
  console.log('SUMMARY')
  console.log('='.repeat(70))

  console.log('\n📊 ON-CHAIN DATA (TradeEvents)')
  console.log(`   Total Volume:     $${onChainTotalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
  console.log(`   Total Trades:     ${onChainTrades.length}`)
  console.log(`   Total PnL:        $${onChainTotalPnl.toFixed(2)}`)
  console.log(`   Avg Trade Size:   $${(onChainTotalVolume / onChainTrades.length || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`)

  console.log('\n📦 DATABASE DATA')
  console.log(`   Total Volume:     $${dbTotalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
  console.log(`   Total Trades:     ${dbOrders.length}`)
  console.log(`   Total PnL:        $${dbTotalPnl.toFixed(2)}`)

  const volumeDiff = onChainTotalVolume - dbTotalVolume
  const volumeDiffPct = (volumeDiff / onChainTotalVolume) * 100

  console.log('\n⚠️  DISCREPANCY')
  console.log(`   Volume Difference: $${volumeDiff.toLocaleString(undefined, { maximumFractionDigits: 2 })} (${volumeDiffPct.toFixed(1)}%)`)
  console.log(`   Trades on-chain but not in DB: ${missingFromDb.length}`)
  console.log(`   Trades in DB but not on-chain: ${inDbNotOnChain.length}`)

  console.log('\n📅 ON-CHAIN VOLUME BY MONTH')
  for (const [month, data] of Object.entries(onChainByMonth).sort()) {
    console.log(`   ${month}: $${data.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${data.count} trades, PnL: $${data.pnl.toFixed(2)})`)
  }

  if (missingFromDb.length > 0) {
    console.log('\n🔍 MISSING FROM DATABASE (first 20)')
    const sorted = missingFromDb.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    for (const trade of sorted.slice(0, 20)) {
      console.log(`   ${trade.timestamp.toLocaleString()} | ${trade.direction.toUpperCase().padEnd(5)} | $${trade.volumeUSD.toFixed(0).padStart(8)} | ${trade.txHash.slice(0, 16)}...`)
    }

    const missingVolume = missingFromDb.reduce((sum, t) => sum + t.volumeUSD, 0)
    console.log(`\n   Total missing volume: $${missingVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
  }

  console.log('\n' + '='.repeat(70))
  console.log('NOTE: Decibel portfolio shows $10.04M volume.')
  console.log('The difference might include:')
  console.log('  - TWAP order slices (each slice is a separate fill)')
  console.log('  - Manual trades from Decibel UI')
  console.log('  - Trades before bot database tracking started')
  console.log('='.repeat(70))

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
