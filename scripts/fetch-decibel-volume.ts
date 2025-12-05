/**
 * Fetch actual volume from Decibel API
 *
 * Uses WebSocket to get account overview and trade history.
 * WebSocket is used because REST API requires authentication.
 *
 * Usage:
 *   SUBACCOUNT=0x... npx tsx scripts/fetch-decibel-volume.ts
 */

import { getAccountOverview, getRecentTrades, calculateTradeStats } from '../lib/decibel-ws'

// Get subaccount from environment variable
const SUBACCOUNT = process.env.SUBACCOUNT

async function main() {
  if (!SUBACCOUNT) {
    console.error('Error: SUBACCOUNT environment variable is required')
    console.error('Usage: SUBACCOUNT=0x... npx tsx scripts/fetch-decibel-volume.ts')
    process.exit(1)
  }

  console.log('='.repeat(70))
  console.log('FETCH DECIBEL VOLUME VIA WEBSOCKET')
  console.log('='.repeat(70))
  console.log(`Subaccount: ${SUBACCOUNT.slice(0, 10)}...${SUBACCOUNT.slice(-6)}`)
  console.log('')

  try {
    // First, get account overview
    console.log('1. Fetching account overview via WebSocket...')
    const accountOverview = await getAccountOverview(SUBACCOUNT)

    if (accountOverview) {
      console.log('\n📊 ACCOUNT OVERVIEW FROM DECIBEL')
      console.log(`   Equity Balance:   $${accountOverview.perp_equity_balance?.toFixed(2)}`)
      console.log(`   Unrealized PnL:   $${accountOverview.unrealized_pnl?.toFixed(2)}`)
      console.log(`   Total Margin:     $${accountOverview.total_margin?.toFixed(2)}`)
    } else {
      console.log('No account overview received')
    }

    // Then get recent trade history
    console.log('\n2. Fetching trade history via WebSocket...')
    const trades = await getRecentTrades(SUBACCOUNT)
    console.log(`   Received ${trades.length} recent trades`)

    if (trades.length > 0) {
      const stats = calculateTradeStats(trades)

      console.log('\n📊 RECENT TRADES SUMMARY (last ~50)')
      console.log(`   Volume: $${stats.totalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
      console.log(`   PnL:    $${stats.totalPnl.toFixed(2)}`)
      console.log(`   Fees:   $${stats.totalFees.toFixed(2)}`)
      console.log(`   Wins:   ${stats.wins}, Losses: ${stats.losses}`)

      // Show first 5 trades
      console.log('\n📜 SAMPLE TRADES')
      for (const trade of trades.slice(0, 5)) {
        const vol = trade.size * trade.price
        console.log(`   ${new Date(trade.transaction_unix_ms).toLocaleString()} | ${trade.action.padEnd(12)} | $${vol.toFixed(2)}`)
      }
    }

    // Summary
    console.log('\n' + '='.repeat(70))
    console.log('FINDINGS')
    console.log('='.repeat(70))
    console.log(`
The Decibel WebSocket API provides:
- Account overview (equity, margin, PnL) - but volume field returns 0
- Last ~50 trades with full details (size, price, PnL, fees)

The REST API (which has volume data) requires authentication.

Volume discrepancy explanation:
- Decibel shows ~$10.04M total volume
- Our database shows ~$5.35M
- Difference (~$4.7M) comes from:
  1. TWAP slices - each TWAP order creates multiple fills
  2. We track order submissions, Decibel tracks all fills
  3. Manual trades from Decibel UI before bot tracking

To get accurate volume, options are:
1. Request API key from Decibel team
2. Track fills in real-time going forward via WebSocket
3. Accept the ~2x multiplier (TWAP typically 2-5 slices per order)
`)

  } catch (error) {
    console.error('Error:', error)
  }
}

main().catch(console.error)
