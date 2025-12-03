/**
 * Backfill Missing Trades Script
 *
 * Fetches all on-chain trades from the bot operator and inserts any
 * that are missing from the database. This recovers trades that were
 * executed but not recorded due to database errors.
 *
 * Usage:
 *   npx tsx scripts/backfill-trades.ts [--dry-run]
 *
 * Options:
 *   --dry-run    Show what would be inserted without actually inserting
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APTOS_NODE = 'https://api.testnet.aptoslabs.com/v1'
const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'

// Bot operator address - the account that sends transactions
const BOT_OPERATOR = '0x501f5aab249607751b53dcb84ed68c95ede4990208bd861c3374a9b8ac1426da'

// Market configurations
const MARKETS: Record<string, { name: string; pxDecimals: number; szDecimals: number; maxLeverage: number }> = {
  '0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e': { name: 'BTC/USD', pxDecimals: 6, szDecimals: 8, maxLeverage: 40 },
  '0x5d4a373896cc46ce5bd27f795587c1d682e7f57a3de6149d19cc3f3cb6c6800d': { name: 'ETH/USD', pxDecimals: 6, szDecimals: 7, maxLeverage: 20 },
  '0xef5eee5ae8ba5726efcd8af6ee89dffe2ca08d20631fff3bafe98d89137a58c4': { name: 'SOL/USD', pxDecimals: 6, szDecimals: 6, maxLeverage: 20 },
  '0xfaade75b8302ef13835f40c66ee812c3c0c8218549c42c0aebe24d79c27498d2': { name: 'APT/USD', pxDecimals: 6, szDecimals: 4, maxLeverage: 10 },
  '0x25d0f38fb7a4210def4e62d41aa8e616172ea37692605961df63a1c773661c2': { name: 'WLFI/USD', pxDecimals: 6, szDecimals: 3, maxLeverage: 10 },
}

interface ParsedTrade {
  txHash: string
  timestamp: Date
  market: string
  marketAddress: string
  direction: 'long' | 'short'
  strategy: string
  size: bigint
  entryPrice: number
  volumeGenerated: number
  leverage: number
  success: boolean
}

async function fetchAllTransactions(): Promise<any[]> {
  const allTxs: any[] = []
  let start = 0
  const limit = 100

  console.log(`\nFetching transactions from bot operator: ${BOT_OPERATOR}`)

  while (true) {
    const url = `${APTOS_NODE}/accounts/${BOT_OPERATOR}/transactions?start=${start}&limit=${limit}`
    const response = await fetch(url)

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`Account not found`)
        break
      }
      throw new Error(`API error: ${response.status}`)
    }

    const txs = await response.json()
    if (txs.length === 0) break

    allTxs.push(...txs)
    process.stdout.write(`\r  Fetched ${allTxs.length} transactions...`)

    if (txs.length < limit) break
    start += limit

    // Rate limiting
    await new Promise(r => setTimeout(r, 50))
  }

  console.log(`\n  Total: ${allTxs.length} transactions`)
  return allTxs
}

function parseTradeFromTx(tx: any): ParsedTrade | null {
  if (!tx.success) return null

  const func = tx.payload?.function || ''
  if (!func.includes(DECIBEL_PACKAGE)) return null

  // Determine order type
  let strategy = 'unknown'
  if (func.includes('place_twap_order')) {
    strategy = 'twap'
  } else if (func.includes('place_market_order')) {
    strategy = 'market'
  } else if (func.includes('place_order')) {
    strategy = 'limit'
  } else {
    return null // Not a trade transaction
  }

  const args = tx.payload?.arguments || []

  // Get market address (argument index 1)
  let marketAddress = args[1]
  if (typeof marketAddress === 'object' && marketAddress?.inner) {
    marketAddress = marketAddress.inner
  }

  // Normalize market address
  const normalizedMarket = marketAddress?.toLowerCase?.() || marketAddress
  const marketInfo = MARKETS[normalizedMarket] || MARKETS[marketAddress]

  if (!marketInfo) {
    console.warn(`  Unknown market: ${marketAddress}`)
    return null
  }

  // Get size (argument index 2)
  const sizeRaw = BigInt(args[2] || '0')
  const sizeInBaseAsset = Number(sizeRaw) / Math.pow(10, marketInfo.szDecimals)

  // Get direction (argument index 3)
  const isLong = args[3] === true || args[3] === 'true'

  // Try to get price from events
  let entryPrice = 0
  const events = tx.events || []
  for (const event of events) {
    if (event.type?.includes('OrderFill') || event.type?.includes('PositionUpdate') || event.type?.includes('TwapOrder')) {
      const data = event.data || {}
      const priceRaw = data.fill_price || data.price || data.avg_fill_px || data.oracle_px
      if (priceRaw) {
        entryPrice = parseInt(priceRaw) / Math.pow(10, marketInfo.pxDecimals)
        break
      }
    }
  }

  // Calculate volume
  let volumeGenerated = sizeInBaseAsset * entryPrice

  // Sanity check: cap volume at reasonable levels
  // Most trades are $10-500 (tx_spammer), up to $200k (high_risk with 40x leverage)
  // Anything over $500k for a single trade is suspicious
  const MAX_REASONABLE_VOLUME = 500_000
  if (volumeGenerated > MAX_REASONABLE_VOLUME) {
    // This might be a legitimate high_risk trade or a bug
    // If size is reasonable (< 10 BTC, < 50 ETH, < 100k APT) and price is sane, keep it
    // Otherwise set to 0 for fallback
    const isReasonableSize = (
      (marketInfo.name === 'BTC/USD' && sizeInBaseAsset < 10) ||
      (marketInfo.name === 'ETH/USD' && sizeInBaseAsset < 50) ||
      (marketInfo.name === 'APT/USD' && sizeInBaseAsset < 100000) ||
      (marketInfo.name === 'SOL/USD' && sizeInBaseAsset < 1000)
    )

    if (!isReasonableSize) {
      // Size is too large, probably a decimal error
      console.warn(`  ⚠️ Unreasonable size for ${marketInfo.name}: ${sizeInBaseAsset.toFixed(4)} (vol: $${volumeGenerated.toFixed(2)}) - ${tx.hash.slice(0, 20)}`)
      volumeGenerated = 0
      entryPrice = 0
    }
  }

  return {
    txHash: tx.hash,
    timestamp: new Date(parseInt(tx.timestamp) / 1000),
    market: marketInfo.name,
    marketAddress: normalizedMarket,
    direction: isLong ? 'long' : 'short',
    strategy,
    size: sizeRaw,
    entryPrice,
    volumeGenerated,
    leverage: marketInfo.maxLeverage,
    success: true,
  }
}

async function fetchCurrentPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {}

  console.log('\nFetching current market prices for trades without fill prices...')

  for (const [address, info] of Object.entries(MARKETS)) {
    try {
      const response = await fetch(`${APTOS_NODE}/accounts/${address}/resources`)
      if (response.ok) {
        const resources = await response.json()
        const priceResource = resources.find((r: any) => r.type?.includes('price_management::Price'))
        if (priceResource?.data?.oracle_px) {
          prices[info.name] = parseInt(priceResource.data.oracle_px) / Math.pow(10, info.pxDecimals)
        }
      }
    } catch (e) {
      console.error(`  Failed to fetch price for ${info.name}`)
    }
  }

  return prices
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run')

  console.log('='.repeat(60))
  console.log('BACKFILL MISSING TRADES')
  console.log('='.repeat(60))
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE (will insert records)'}`)
  console.log(`Timestamp: ${new Date().toISOString()}`)

  // Get existing txHashes from database
  console.log('\nFetching existing orders from database...')
  const existingOrders = await prisma.orderHistory.findMany({
    select: { txHash: true }
  })
  const existingHashes = new Set(existingOrders.map(o => o.txHash))
  console.log(`  Found ${existingHashes.size} existing orders in database`)

  // Get bot instance (needed for botId)
  const botInstance = await prisma.botInstance.findFirst()
  if (!botInstance) {
    console.error('ERROR: No bot instance found in database')
    process.exit(1)
  }
  console.log(`  Bot instance: ${botInstance.id}`)

  // Fetch all on-chain transactions
  const transactions = await fetchAllTransactions()

  // Fetch current prices for fallback
  const currentPrices = await fetchCurrentPrices()
  console.log('  Current prices:', currentPrices)

  // Parse trades and find missing ones
  console.log('\nParsing transactions...')
  const allTrades: ParsedTrade[] = []
  const missingTrades: ParsedTrade[] = []
  let skippedFailed = 0
  let skippedNonTrade = 0

  for (const tx of transactions) {
    if (!tx.success) {
      skippedFailed++
      continue
    }

    const trade = parseTradeFromTx(tx)
    if (trade) {
      // Use current price if no fill price was found
      if (trade.entryPrice === 0 && trade.volumeGenerated === 0) {
        const fallbackPrice = currentPrices[trade.market] || 0
        if (fallbackPrice > 0) {
          const marketInfo = MARKETS[trade.marketAddress]
          const sizeInBaseAsset = Number(trade.size) / Math.pow(10, marketInfo?.szDecimals || 8)
          trade.entryPrice = fallbackPrice
          trade.volumeGenerated = sizeInBaseAsset * fallbackPrice

          // Cap fallback volumes - check if size is reasonable
          const MAX_REASONABLE_VOLUME = 500_000
          if (trade.volumeGenerated > MAX_REASONABLE_VOLUME) {
            const isReasonableSize = (
              (trade.market === 'BTC/USD' && sizeInBaseAsset < 10) ||
              (trade.market === 'ETH/USD' && sizeInBaseAsset < 50) ||
              (trade.market === 'APT/USD' && sizeInBaseAsset < 100000) ||
              (trade.market === 'SOL/USD' && sizeInBaseAsset < 1000)
            )

            if (!isReasonableSize) {
              console.warn(`  ⚠️ Unreasonable fallback size for ${trade.market}: ${sizeInBaseAsset.toFixed(4)} (vol: $${trade.volumeGenerated.toFixed(2)})`)
              trade.volumeGenerated = 0
              trade.entryPrice = 0
            }
          }
        }
      }

      allTrades.push(trade)

      if (!existingHashes.has(trade.txHash)) {
        missingTrades.push(trade)
      }
    } else if (tx.payload?.function?.includes(DECIBEL_PACKAGE)) {
      skippedNonTrade++
    }
  }

  console.log(`  Total trades on-chain: ${allTrades.length}`)
  console.log(`  Already in database: ${allTrades.length - missingTrades.length}`)
  console.log(`  Missing from database: ${missingTrades.length}`)
  console.log(`  Skipped failed txs: ${skippedFailed}`)
  console.log(`  Skipped non-trade txs: ${skippedNonTrade}`)

  if (missingTrades.length === 0) {
    console.log('\n✅ No missing trades to backfill!')
    await prisma.$disconnect()
    return
  }

  // Show summary by date
  console.log('\n--- Missing Trades by Date ---')
  const byDate: Record<string, { count: number; volume: number }> = {}
  for (const trade of missingTrades) {
    const date = trade.timestamp.toISOString().split('T')[0]
    if (!byDate[date]) byDate[date] = { count: 0, volume: 0 }
    byDate[date].count++
    byDate[date].volume += trade.volumeGenerated
  }
  for (const [date, data] of Object.entries(byDate).sort()) {
    console.log(`  ${date}: ${data.count} trades, $${data.volume.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
  }

  // Show summary by market
  console.log('\n--- Missing Trades by Market ---')
  const byMarket: Record<string, { count: number; volume: number }> = {}
  for (const trade of missingTrades) {
    if (!byMarket[trade.market]) byMarket[trade.market] = { count: 0, volume: 0 }
    byMarket[trade.market].count++
    byMarket[trade.market].volume += trade.volumeGenerated
  }
  for (const [market, data] of Object.entries(byMarket)) {
    console.log(`  ${market}: ${data.count} trades, $${data.volume.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
  }

  // Calculate total volume to add
  const totalVolumeToAdd = missingTrades.reduce((sum, t) => sum + t.volumeGenerated, 0)
  console.log(`\n  Total volume to recover: $${totalVolumeToAdd.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)

  if (isDryRun) {
    console.log('\n🔍 DRY RUN - No changes made')
    console.log('Run without --dry-run to insert missing trades')
    await prisma.$disconnect()
    return
  }

  // Insert missing trades
  console.log('\n--- Inserting Missing Trades ---')
  let inserted = 0
  let errors = 0

  for (const trade of missingTrades) {
    try {
      await prisma.orderHistory.create({
        data: {
          botId: botInstance.id,
          txHash: trade.txHash,
          timestamp: trade.timestamp,
          direction: trade.direction,
          strategy: trade.strategy,
          size: trade.size,
          volumeGenerated: trade.volumeGenerated,
          success: true,
          entryPrice: trade.entryPrice,
          exitPrice: null,
          pnl: 0,
          positionHeldMs: 0,
          market: trade.market,
          leverage: trade.leverage,
          sessionId: 'backfill',
        }
      })
      inserted++
      if (inserted % 50 === 0) {
        console.log(`  Inserted ${inserted}/${missingTrades.length}...`)
      }
    } catch (error) {
      errors++
      console.error(`  Error inserting ${trade.txHash}:`, error)
    }
  }

  console.log(`\n  Inserted: ${inserted}`)
  console.log(`  Errors: ${errors}`)

  // Update bot cumulative volume
  console.log('\n--- Updating Bot Cumulative Volume ---')
  const allOrders = await prisma.orderHistory.findMany({
    where: { botId: botInstance.id }
  })
  const newTotalVolume = allOrders.reduce((sum, o) => sum + o.volumeGenerated, 0)

  await prisma.botInstance.update({
    where: { id: botInstance.id },
    data: { cumulativeVolume: newTotalVolume }
  })

  console.log(`  Previous volume: $${botInstance.cumulativeVolume.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
  console.log(`  New total volume: $${newTotalVolume.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
  console.log(`  Volume recovered: $${(newTotalVolume - botInstance.cumulativeVolume).toLocaleString(undefined, { minimumFractionDigits: 2 })}`)

  console.log('\n' + '='.repeat(60))
  console.log('✅ BACKFILL COMPLETE')
  console.log('='.repeat(60))

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
