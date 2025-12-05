/**
 * Restore Trades From On-Chain
 *
 * Fetches all trades for the subaccount from Decibel and restores them to the database.
 * This is the source of truth.
 *
 * Usage:
 *   npx tsx scripts/restore-trades-from-chain.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APTOS_NODE = 'https://api.testnet.aptoslabs.com/v1'
const BOT_OPERATOR = '0x501f5aab249607751b53dcb84ed68c95ede4990208bd861c3374a9b8ac1426da'
const SUBACCOUNT = '0xfd59a5bbaa2d534533385511c79adace521eb67e3ac824c9ad0b8e0eaad4f14d'

interface Trade {
  txHash: string
  timestamp: Date
  direction: 'long' | 'short'
  size: bigint
  price: number
  volume: number
  pnl: number
}

async function fetchBotTransactions(): Promise<any[]> {
  const allTxs: any[] = []
  let start = 0
  const limit = 100

  while (true) {
    const url = `${APTOS_NODE}/accounts/${BOT_OPERATOR}/transactions?start=${start}&limit=${limit}`
    console.log(`Fetching transactions from ${start}...`)

    const response = await fetch(url)
    if (!response.ok) {
      console.error('Failed to fetch:', response.status)
      break
    }

    const txs = await response.json()
    if (!txs || txs.length === 0) break

    allTxs.push(...txs)

    if (txs.length < limit) break
    start += limit

    await new Promise(r => setTimeout(r, 100))
  }

  return allTxs
}

function extractTradesFromTx(tx: any): Trade[] {
  const trades: Trade[] = []

  if (!tx.success) return trades

  const events = tx.events || []

  for (const event of events) {
    // Look for TradeEvents for our subaccount
    if (event.type?.includes('TradeEvent')) {
      const data = event.data || {}

      // Check if this is for our subaccount
      if (data.account === SUBACCOUNT) {
        const size = BigInt(data.size || '0')
        const price = parseInt(data.price || '0') / 1e6
        const volume = (Number(size) / 1e8) * price
        const realizedPnl = parseInt(data.realized_pnl || '0') / 1e6

        // Determine direction from action
        const action = data.action?.__variant__ || ''
        let direction: 'long' | 'short'
        if (action.includes('Long')) {
          direction = 'long'
        } else {
          direction = 'short'
        }

        trades.push({
          txHash: tx.hash,
          timestamp: new Date(parseInt(tx.timestamp) / 1000),
          direction,
          size,
          price,
          volume,
          pnl: realizedPnl
        })
      }
    }
  }

  return trades
}

async function main() {
  console.log('='.repeat(60))
  console.log('RESTORE TRADES FROM ON-CHAIN')
  console.log('='.repeat(60))
  console.log('')

  // Get existing bot instance
  let bot = await prisma.botInstance.findFirst()
  if (!bot) {
    console.error('No bot instance found!')
    await prisma.$disconnect()
    return
  }

  // Clear existing order history
  console.log('Clearing existing order history...')
  await prisma.orderHistory.deleteMany({ where: { botId: bot.id } })

  // Fetch all transactions
  console.log('Fetching transactions from chain...')
  const txs = await fetchBotTransactions()
  console.log(`Found ${txs.length} transactions`)

  // Extract trades
  console.log('Extracting trades...')
  let totalVolume = 0
  let totalPnl = 0
  let tradesInserted = 0

  for (const tx of txs) {
    const trades = extractTradesFromTx(tx)

    for (const trade of trades) {
      try {
        await prisma.orderHistory.create({
          data: {
            botId: bot.id,
            txHash: trade.txHash,
            timestamp: trade.timestamp,
            direction: trade.direction,
            size: trade.size,
            entryPrice: trade.price,
            volumeGenerated: trade.volume,
            pnl: trade.pnl,
          }
        })

        totalVolume += trade.volume
        totalPnl += trade.pnl
        tradesInserted++

        if (tradesInserted % 50 === 0) {
          console.log(`  Inserted ${tradesInserted} trades, volume: $${totalVolume.toLocaleString()}`)
        }
      } catch (e) {
        // Might be duplicate txHash
        console.log(`  Skip duplicate: ${trade.txHash.slice(0, 20)}...`)
      }
    }
  }

  // Update bot stats
  await prisma.botInstance.update({
    where: { id: bot.id },
    data: { cumulativeVolume: totalVolume }
  })

  console.log('')
  console.log('=== SUMMARY ===')
  console.log(`Trades inserted: ${tradesInserted}`)
  console.log(`Total volume: $${totalVolume.toLocaleString()}`)
  console.log(`Total PnL: $${totalPnl.toFixed(2)}`)

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
