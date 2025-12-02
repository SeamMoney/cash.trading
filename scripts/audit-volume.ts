/**
 * Volume Audit Script
 *
 * Audits trading volume by fetching on-chain transactions and comparing
 * with database records. Helps identify discrepancies in volume tracking.
 *
 * Usage:
 *   npx tsx scripts/audit-volume.ts <subaccount_address>
 *
 * Example:
 *   npx tsx scripts/audit-volume.ts 0xabc123...
 *
 * Requirements:
 *   - DATABASE_URL environment variable must be set
 *   - Subaccount address from your bot configuration
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APTOS_NODE = 'https://api.testnet.aptoslabs.com/v1'
const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'

// Market configurations - price decimals verified from on-chain
const MARKETS: Record<string, { name: string; pxDecimals: number; szDecimals: number }> = {
  '0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e': { name: 'BTC/USD', pxDecimals: 6, szDecimals: 8 },
  '0x5d4a373896cc46ce5bd27f795587c1d682e7f57a3de6149d19cc3f3cb6c6800d': { name: 'ETH/USD', pxDecimals: 6, szDecimals: 7 },
  '0xef5eee5ae8ba5726efcd8af6ee89dffe2ca08d20631fff3bafe98d89137a58c4': { name: 'SOL/USD', pxDecimals: 6, szDecimals: 6 },
  '0xfaade75b8302ef13835f40c66ee812c3c0c8218549c42c0aebe24d79c27498d2': { name: 'APT/USD', pxDecimals: 6, szDecimals: 4 },
  '0x25d0f38fb7a4210def4e62d41aa8e616172ea37692605961df63a1c773661c2': { name: 'WLFI/USD', pxDecimals: 6, szDecimals: 3 },
}

interface TradeEvent {
  txHash: string
  timestamp: Date
  type: 'twap' | 'market' | 'limit' | 'unknown'
  source: 'bot' | 'manual'
  market: string
  isLong: boolean
  size: number
  sizeUSD: number
  price: number
  function: string
}

async function fetchAllTransactions(address: string): Promise<any[]> {
  const allTxs: any[] = []
  let start = 0
  const limit = 100

  console.log(`\nFetching transactions for ${address}...`)

  while (true) {
    const url = `${APTOS_NODE}/accounts/${address}/transactions?start=${start}&limit=${limit}`
    const response = await fetch(url)

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`Account not found or no transactions`)
        break
      }
      throw new Error(`API error: ${response.status}`)
    }

    const txs = await response.json()
    if (txs.length === 0) break

    allTxs.push(...txs)
    console.log(`  Fetched ${allTxs.length} transactions...`)

    if (txs.length < limit) break
    start += limit

    // Rate limiting
    await new Promise(r => setTimeout(r, 100))
  }

  return allTxs
}

function parseTradeFromTx(tx: any): TradeEvent | null {
  if (!tx.success) return null

  const func = tx.payload?.function || ''

  if (!func.includes(DECIBEL_PACKAGE)) return null

  let type: TradeEvent['type'] = 'unknown'
  let source: TradeEvent['source'] = 'manual'

  if (func.includes('place_twap_order')) {
    type = 'twap'
  } else if (func.includes('place_market_order')) {
    type = 'market'
  } else if (func.includes('place_order')) {
    type = 'limit'
  } else {
    return null
  }

  const sender = tx.sender
  const args = tx.payload?.arguments || []

  if (func.includes('_to_subaccount')) {
    const subaccount = args[0]
    if (sender !== subaccount) {
      source = 'bot'
    }
  }

  let marketAddress = args[1]
  if (typeof marketAddress === 'object' && marketAddress?.inner) {
    marketAddress = marketAddress.inner
  }

  const marketInfo = MARKETS[marketAddress?.toLowerCase?.()] || MARKETS[marketAddress] || { name: 'Unknown', pxDecimals: 6, szDecimals: 8 }

  const sizeRaw = parseInt(args[2] || '0')
  const size = sizeRaw / Math.pow(10, marketInfo.szDecimals)
  const isLong = args[3] === true || args[3] === 'true'

  let price = 0
  let sizeUSD = 0

  const events = tx.events || []
  for (const event of events) {
    if (event.type?.includes('OrderFill') || event.type?.includes('PositionUpdate')) {
      const data = event.data || {}
      if (data.fill_price || data.price || data.avg_fill_px) {
        const priceRaw = parseInt(data.fill_price || data.price || data.avg_fill_px || '0')
        price = priceRaw / Math.pow(10, marketInfo.pxDecimals)
      }
      if (data.notional || data.fill_notional) {
        sizeUSD = parseInt(data.notional || data.fill_notional || '0') / 1e6
      }
    }
  }

  return {
    txHash: tx.hash,
    timestamp: new Date(parseInt(tx.timestamp) / 1000),
    type,
    source,
    market: marketInfo.name,
    isLong,
    size,
    sizeUSD,
    price,
    function: func.split('::').pop() || func,
  }
}

async function fetchCurrentPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {}

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
      console.error(`Failed to fetch price for ${info.name}`)
    }
  }

  return prices
}

async function auditVolume(subaccountAddress: string) {
  console.log('='.repeat(60))
  console.log('VOLUME AUDIT REPORT')
  console.log('='.repeat(60))
  console.log(`Subaccount: ${subaccountAddress}`)
  console.log(`Timestamp: ${new Date().toISOString()}`)

  // Fetch all transactions
  const transactions = await fetchAllTransactions(subaccountAddress)
  console.log(`\nTotal transactions found: ${transactions.length}`)

  // Fetch current prices for estimation
  console.log('\nFetching current market prices...')
  const currentPrices = await fetchCurrentPrices()
  console.log('Current prices:', currentPrices)

  // Parse trades
  const trades: TradeEvent[] = []
  let skippedNonTrade = 0
  let skippedFailed = 0

  for (const tx of transactions) {
    if (!tx.success) {
      skippedFailed++
      continue
    }

    const trade = parseTradeFromTx(tx)
    if (trade) {
      if (trade.sizeUSD === 0 && trade.size > 0) {
        const estimatedPrice = currentPrices[trade.market] || 0
        trade.sizeUSD = trade.size * estimatedPrice
        trade.price = estimatedPrice
      }
      trades.push(trade)
    } else if (tx.payload?.function?.includes(DECIBEL_PACKAGE)) {
      skippedNonTrade++
    }
  }

  console.log(`\nParsed ${trades.length} trades`)
  console.log(`Skipped ${skippedFailed} failed transactions`)
  console.log(`Skipped ${skippedNonTrade} non-trade Decibel transactions`)

  // Calculate summaries
  let totalVolumeUSD = 0
  const byType: Record<string, { count: number; volumeUSD: number }> = {}
  const byMarket: Record<string, { count: number; volumeUSD: number }> = {}
  const bySource: Record<string, { count: number; volumeUSD: number }> = {}

  for (const trade of trades) {
    totalVolumeUSD += trade.sizeUSD

    if (!byType[trade.type]) byType[trade.type] = { count: 0, volumeUSD: 0 }
    byType[trade.type].count++
    byType[trade.type].volumeUSD += trade.sizeUSD

    if (!byMarket[trade.market]) byMarket[trade.market] = { count: 0, volumeUSD: 0 }
    byMarket[trade.market].count++
    byMarket[trade.market].volumeUSD += trade.sizeUSD

    if (!bySource[trade.source]) bySource[trade.source] = { count: 0, volumeUSD: 0 }
    bySource[trade.source].count++
    bySource[trade.source].volumeUSD += trade.sizeUSD
  }

  // Print report
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))

  console.log(`\nTotal Volume: $${totalVolumeUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`)
  console.log(`Total Trades: ${trades.length}`)
  console.log(`Average Trade Size: $${(totalVolumeUSD / trades.length || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

  console.log('\n--- By Order Type ---')
  for (const [type, data] of Object.entries(byType)) {
    const pct = (data.volumeUSD / totalVolumeUSD * 100).toFixed(1)
    console.log(`  ${type.toUpperCase().padEnd(10)} ${data.count.toString().padStart(5)} trades | $${data.volumeUSD.toLocaleString(undefined, { minimumFractionDigits: 2 }).padStart(15)} (${pct}%)`)
  }

  console.log('\n--- By Market ---')
  for (const [market, data] of Object.entries(byMarket)) {
    const pct = (data.volumeUSD / totalVolumeUSD * 100).toFixed(1)
    console.log(`  ${market.padEnd(10)} ${data.count.toString().padStart(5)} trades | $${data.volumeUSD.toLocaleString(undefined, { minimumFractionDigits: 2 }).padStart(15)} (${pct}%)`)
  }

  console.log('\n--- By Source ---')
  for (const [source, data] of Object.entries(bySource)) {
    const pct = (data.volumeUSD / totalVolumeUSD * 100).toFixed(1)
    console.log(`  ${source.toUpperCase().padEnd(10)} ${data.count.toString().padStart(5)} trades | $${data.volumeUSD.toLocaleString(undefined, { minimumFractionDigits: 2 }).padStart(15)} (${pct}%)`)
  }

  console.log('\n--- Recent Trades (last 10) ---')
  const recentTrades = trades.slice(-10).reverse()
  for (const trade of recentTrades) {
    const dir = trade.isLong ? 'LONG ' : 'SHORT'
    const date = trade.timestamp.toLocaleString()
    console.log(`  ${date} | ${trade.market.padEnd(8)} | ${dir} | ${trade.type.padEnd(6)} | $${trade.sizeUSD.toFixed(2).padStart(10)} | ${trade.source}`)
  }

  console.log('\n' + '='.repeat(60))
  console.log('NOTE: Volume is calculated using current market prices for')
  console.log('trades where fill price was not available in events.')
  console.log('='.repeat(60))

  return { totalVolumeUSD, trades: trades.length, byType, byMarket, bySource }
}

async function checkDatabaseVolume() {
  try {
    const orders = await prisma.orderHistory.findMany({
      orderBy: { timestamp: 'desc' }
    })

    const totalDbVolume = orders.reduce((sum, o) => sum + o.volumeGenerated, 0)

    console.log('\n' + '='.repeat(60))
    console.log('DATABASE COMPARISON')
    console.log('='.repeat(60))
    console.log(`Orders in database: ${orders.length}`)
    console.log(`Total volume in database: $${totalDbVolume.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)

    const byStrategy: Record<string, number> = {}
    for (const order of orders) {
      const strat = order.strategy || 'unknown'
      byStrategy[strat] = (byStrategy[strat] || 0) + order.volumeGenerated
    }

    console.log('\n--- Database Volume by Strategy ---')
    for (const [strat, vol] of Object.entries(byStrategy)) {
      console.log(`  ${strat.padEnd(15)} $${vol.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
    }

    const largeOrders = orders.filter(o => o.volumeGenerated > 10000)
    if (largeOrders.length > 0) {
      console.log('\n--- Large Orders (>$10k) ---')
      for (const order of largeOrders.slice(0, 10)) {
        const hash = order.txHash ? order.txHash.slice(0, 20) + '...' : 'N/A'
        console.log(`  ${order.timestamp.toLocaleString()} | ${order.strategy} | $${order.volumeGenerated.toFixed(2)} | ${hash}`)
      }
    }

    await prisma.$disconnect()
  } catch (e) {
    console.log('\nCould not check database (DATABASE_URL may not be configured)')
  }
}

// Main
const subaccount = process.argv[2]
if (!subaccount) {
  console.log('Volume Audit Script for Decibel Trading Bot')
  console.log('')
  console.log('Usage: npx tsx scripts/audit-volume.ts <subaccount_address>')
  console.log('')
  console.log('To find your subaccount address:')
  console.log('  1. Check your bot configuration in the database')
  console.log('  2. Or look at the userSubaccount field in BotInstance')
  console.log('')
  console.log('Example:')
  console.log('  npx tsx scripts/audit-volume.ts 0xabc123def456...')
  process.exit(1)
}

auditVolume(subaccount)
  .then(() => checkDatabaseVolume())
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err)
    process.exit(1)
  })
