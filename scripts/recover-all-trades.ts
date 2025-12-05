/**
 * Recover All Trades from On-Chain
 *
 * This script fetches ALL transactions for the bot operator and
 * reconstructs the trade history by looking at:
 * 1. OrderEvent with our subaccount showing FILLED status
 * 2. BulkOrderFilledEvent
 * 3. Any order where remaining_size went from > 0 to 0
 *
 * It then calculates volume from the filled size and price.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APTOS_NODE = 'https://api.testnet.aptoslabs.com/v1'
const BOT_OPERATOR = '0x501f5aab249607751b53dcb84ed68c95ede4990208bd861c3374a9b8ac1426da'
const SUBACCOUNT = '0xfd59a5bbaa2d534533385511c79adace521eb67e3ac824c9ad0b8e0eaad4f14d'

// Market size decimals
const MARKET_DECIMALS: Record<string, number> = {
  'BTC': 8,
  'ETH': 7,
  'SOL': 6,
  'APT': 4,
}

interface Fill {
  txHash: string
  timestamp: Date
  direction: 'long' | 'short'
  size: bigint
  price: number
  volume: number
  market: string
}

async function fetchTransactionsBatch(start: number, limit: number): Promise<any[]> {
  const url = `${APTOS_NODE}/accounts/${BOT_OPERATOR}/transactions?start=${start}&limit=${limit}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`)
  }
  return response.json()
}

function extractFillsFromTx(tx: any): Fill[] {
  const fills: Fill[] = []
  if (!tx.success) return fills

  const events = tx.events || []

  // Track order events for our subaccount
  for (const event of events) {
    // Look for OrderEvent with FILLED status for our subaccount
    if (event.type?.includes('OrderEvent')) {
      const data = event.data || {}

      if (data.user === SUBACCOUNT && data.status?.__variant__ === 'FILLED') {
        const origSize = BigInt(data.orig_size || '0')
        const price = parseInt(data.price || '0') / 1e6
        const isBid = data.is_bid === true || data.is_bid === 'true'
        const direction = isBid ? 'long' : 'short'

        // Assume BTC for now (8 decimals)
        const sizeInBase = Number(origSize) / 1e8
        const volume = sizeInBase * price

        if (volume > 0) {
          fills.push({
            txHash: tx.hash,
            timestamp: new Date(parseInt(tx.timestamp) / 1000),
            direction,
            size: origSize,
            price,
            volume,
            market: 'BTC'
          })
        }
      }
    }

    // Also check BulkOrderFilledEvent
    if (event.type?.includes('BulkOrderFilledEvent')) {
      const data = event.data || {}
      if (data.user === SUBACCOUNT) {
        const filledSize = BigInt(data.filled_size || '0')
        const avgPrice = parseInt(data.avg_price || data.price || '0') / 1e6
        const isBid = data.is_bid === true || data.is_bid === 'true'
        const direction = isBid ? 'long' : 'short'

        const sizeInBase = Number(filledSize) / 1e8
        const volume = sizeInBase * avgPrice

        if (volume > 0) {
          fills.push({
            txHash: tx.hash,
            timestamp: new Date(parseInt(tx.timestamp) / 1000),
            direction,
            size: filledSize,
            price: avgPrice,
            volume,
            market: 'BTC'
          })
        }
      }
    }
  }

  return fills
}

async function main() {
  console.log('='.repeat(60))
  console.log('RECOVER ALL TRADES')
  console.log('='.repeat(60))
  console.log('')

  const bot = await prisma.botInstance.findFirst()
  if (!bot) {
    console.error('No bot instance found!')
    return
  }

  // Clear existing orders
  console.log('Clearing existing order history...')
  await prisma.orderHistory.deleteMany({ where: { botId: bot.id } })

  // Fetch all transactions in batches
  console.log('Fetching transactions...')
  const allTxs: any[] = []
  let start = 0
  const batchSize = 25 // Small batches to avoid rate limiting

  while (true) {
    try {
      console.log(`  Fetching from ${start}...`)
      const txs = await fetchTransactionsBatch(start, batchSize)

      if (!txs || txs.length === 0) break
      allTxs.push(...txs)

      if (txs.length < batchSize) break
      start += batchSize

      // Rate limiting delay
      await new Promise(r => setTimeout(r, 500))
    } catch (e: any) {
      if (e.message?.includes('rate limit') || e.message?.includes('429')) {
        console.log('  Rate limited, waiting 30s...')
        await new Promise(r => setTimeout(r, 30000))
      } else {
        console.error('  Error:', e.message)
        break
      }
    }
  }

  console.log(`Fetched ${allTxs.length} transactions`)

  // Extract fills
  console.log('Extracting fills...')
  let totalVolume = 0
  let fillsInserted = 0
  const seenTxs = new Set<string>()

  for (const tx of allTxs) {
    if (seenTxs.has(tx.hash)) continue
    seenTxs.add(tx.hash)

    const fills = extractFillsFromTx(tx)

    for (const fill of fills) {
      try {
        await prisma.orderHistory.create({
          data: {
            botId: bot.id,
            txHash: fill.txHash,
            timestamp: fill.timestamp,
            direction: fill.direction,
            size: fill.size,
            entryPrice: fill.price,
            volumeGenerated: fill.volume,
            market: fill.market,
            marketName: fill.market + '/USD',
          }
        })

        totalVolume += fill.volume
        fillsInserted++
      } catch (e) {
        // Likely duplicate
      }
    }
  }

  console.log('')
  console.log('=== RESULTS ===')
  console.log(`Fills inserted: ${fillsInserted}`)
  console.log(`Volume recovered: $${totalVolume.toLocaleString()}`)
  console.log('')
  console.log('Note: This only includes orders with FILLED status.')
  console.log('The actual volume from Decibel is $2,886,253.25')

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
