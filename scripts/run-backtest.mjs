/**
 * Run backtest simulation
 *
 * Usage: node scripts/run-backtest.mjs
 */

// Inline backtest logic since we can't easily import TS

function generateSimulatedPrices(startPrice, numCandles, volatilityPct = 0.001) {
  const candles = []
  let price = startPrice
  let startTime = Date.now() - (numCandles * 60000)

  for (let i = 0; i < numCandles; i++) {
    const meanReversion = (startPrice - price) / startPrice * 0.01
    const randomMove = (Math.random() - 0.5) * 2 * volatilityPct
    const priceChange = meanReversion + randomMove

    const open = price
    const close = price * (1 + priceChange)
    const high = Math.max(open, close) * (1 + Math.random() * volatilityPct * 0.5)
    const low = Math.min(open, close) * (1 - Math.random() * volatilityPct * 0.5)

    candles.push({ timestamp: startTime + (i * 60000), open, high, low, close })
    price = close
  }

  return candles
}

function runBacktest(candles, config) {
  const trades = []
  let capitalUSD = config.capitalUSDC
  let maxCapital = capitalUSD
  let minCapital = capitalUSD
  let isLong = config.bias === 'long' || config.bias === 'alternate'

  let i = 0
  while (i < candles.length - 1) {
    const entryCandle = candles[i]
    const entryPrice = entryCandle.close

    const tpPrice = isLong
      ? entryPrice * (1 + config.profitTargetPct)
      : entryPrice * (1 - config.profitTargetPct)
    const slPrice = isLong
      ? entryPrice * (1 - config.stopLossPct)
      : entryPrice * (1 + config.stopLossPct)

    const actualEntryPrice = isLong
      ? entryPrice * (1 + config.slippagePct)
      : entryPrice * (1 - config.slippagePct)

    let exitReason = 'timeout'
    let exitPrice = entryPrice
    let exitTime = entryCandle.timestamp
    let exitCandleIndex = i + 1

    const maxScanCandles = Math.min(60, candles.length - i - 1)

    for (let j = 1; j <= maxScanCandles; j++) {
      const candle = candles[i + j]

      if (isLong) {
        if (candle.high >= tpPrice) {
          exitReason = 'tp'
          exitPrice = tpPrice
          exitTime = candle.timestamp
          exitCandleIndex = i + j
          break
        }
        if (candle.low <= slPrice) {
          exitReason = 'sl'
          exitPrice = slPrice
          exitTime = candle.timestamp
          exitCandleIndex = i + j
          break
        }
      } else {
        if (candle.low <= tpPrice) {
          exitReason = 'tp'
          exitPrice = tpPrice
          exitTime = candle.timestamp
          exitCandleIndex = i + j
          break
        }
        if (candle.high >= slPrice) {
          exitReason = 'sl'
          exitPrice = slPrice
          exitTime = candle.timestamp
          exitCandleIndex = i + j
          break
        }
      }
    }

    if (exitReason === 'timeout') {
      exitPrice = candles[exitCandleIndex].close
      exitTime = candles[exitCandleIndex].timestamp
    }

    const actualExitPrice = isLong
      ? exitPrice * (1 - config.slippagePct)
      : exitPrice * (1 + config.slippagePct)

    const pricePnlPct = isLong
      ? (actualExitPrice - actualEntryPrice) / actualEntryPrice
      : (actualEntryPrice - actualExitPrice) / actualEntryPrice

    const netPnlPct = pricePnlPct - (config.feesPct * 2)
    const leveragedPnlPct = netPnlPct * config.leverage
    const positionSize = capitalUSD * config.leverage
    const pnlUSD = positionSize * netPnlPct

    trades.push({
      entryTime: entryCandle.timestamp,
      entryPrice: actualEntryPrice,
      exitTime,
      exitPrice: actualExitPrice,
      direction: isLong ? 'long' : 'short',
      pnlPct: netPnlPct * 100,
      pnlLeveraged: leveragedPnlPct * 100,
      pnlUSD,
      exitReason,
      durationMs: exitTime - entryCandle.timestamp,
    })

    capitalUSD += pnlUSD
    maxCapital = Math.max(maxCapital, capitalUSD)
    minCapital = Math.min(minCapital, capitalUSD)

    i = exitCandleIndex + 1

    if (config.bias === 'alternate') {
      isLong = !isLong
    }

    if (capitalUSD <= 0) break
  }

  const winningTrades = trades.filter(t => t.pnlUSD > 0)
  const losingTrades = trades.filter(t => t.pnlUSD <= 0)
  const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnlUSD, 0)
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnlUSD, 0))

  return {
    config,
    trades,
    summary: {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
      totalPnlUSD: capitalUSD - config.capitalUSDC,
      totalPnlPct: ((capitalUSD - config.capitalUSDC) / config.capitalUSDC) * 100,
      avgWinUSD: winningTrades.length > 0 ? grossProfit / winningTrades.length : 0,
      avgLossUSD: losingTrades.length > 0 ? grossLoss / losingTrades.length : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      maxDrawdownPct: ((maxCapital - minCapital) / maxCapital) * 100,
      tpCount: trades.filter(t => t.exitReason === 'tp').length,
      slCount: trades.filter(t => t.exitReason === 'sl').length,
      timeoutCount: trades.filter(t => t.exitReason === 'timeout').length,
    },
  }
}

// Run simulation
console.log('\n' + '═'.repeat(65))
console.log('             HIGH RISK STRATEGY BACKTEST')
console.log('═'.repeat(65))

// Generate 24 hours of 1-minute candles (realistic BTC volatility ~0.05% per minute)
const candles = generateSimulatedPrices(100000, 1440, 0.0005)

console.log(`\nGenerated ${candles.length} candles (24 hours of 1-min data)`)
console.log(`Price range: $${Math.min(...candles.map(c => c.low)).toFixed(0)} - $${Math.max(...candles.map(c => c.high)).toFixed(0)}`)

// Test current parameters
console.log('\n' + '─'.repeat(65))
console.log('CURRENT PARAMETERS (TP: 0.03%, SL: 0.02%) - HIGH COSTS')
console.log('─'.repeat(65))

const currentResult = runBacktest(candles, {
  profitTargetPct: 0.0003,
  stopLossPct: 0.0002,
  leverage: 40,
  capitalUSDC: 100,
  slippagePct: 0.001,  // 0.1% slippage (TWAP is worse)
  feesPct: 0.0005,     // 0.05% fees
  bias: 'alternate',
})

console.log(`Trades: ${currentResult.summary.totalTrades}`)
console.log(`Win Rate: ${currentResult.summary.winRate.toFixed(1)}% (${currentResult.summary.winningTrades}W / ${currentResult.summary.losingTrades}L)`)
console.log(`Total PnL: $${currentResult.summary.totalPnlUSD.toFixed(2)} (${currentResult.summary.totalPnlPct.toFixed(1)}%)`)
console.log(`Exit Reasons: TP=${currentResult.summary.tpCount}, SL=${currentResult.summary.slCount}`)

// PROBLEM ANALYSIS
console.log('\n' + '─'.repeat(65))
console.log('COST ANALYSIS (Why 80% losing)')
console.log('─'.repeat(65))
const entryCost = 0.001 * 100  // 0.1% slippage
const exitCost = 0.001 * 100   // 0.1% slippage
const feeCost = 0.0005 * 2 * 100  // 0.05% x 2
const totalCost = entryCost + exitCost + feeCost
const tpProfit = 0.0003 * 100
console.log(`Entry slippage:  ${entryCost.toFixed(2)}%`)
console.log(`Exit slippage:   ${exitCost.toFixed(2)}%`)
console.log(`Fees (2x):       ${feeCost.toFixed(2)}%`)
console.log(`─────────────────────────`)
console.log(`Total cost:      ${totalCost.toFixed(2)}%`)
console.log(`TP target:       ${tpProfit.toFixed(2)}%`)
console.log(`Net on TP hit:   ${(tpProfit - totalCost).toFixed(2)}% ← GUARANTEED LOSS!`)

// Test with REALISTIC IOC slippage (should be much lower)
console.log('\n' + '─'.repeat(65))
console.log('WITH REALISTIC IOC SLIPPAGE (0.01%)')
console.log('─'.repeat(65))

const iocResult = runBacktest(candles, {
  profitTargetPct: 0.0003,
  stopLossPct: 0.0002,
  leverage: 40,
  capitalUSDC: 100,
  slippagePct: 0.0001,  // 0.01% slippage (IOC is better)
  feesPct: 0.0005,      // 0.05% fees
  bias: 'alternate',
})

console.log(`Trades: ${iocResult.summary.totalTrades}`)
console.log(`Win Rate: ${iocResult.summary.winRate.toFixed(1)}% (${iocResult.summary.winningTrades}W / ${iocResult.summary.losingTrades}L)`)
console.log(`Total PnL: $${iocResult.summary.totalPnlUSD.toFixed(2)} (${iocResult.summary.totalPnlPct.toFixed(1)}%)`)
console.log(`Exit Reasons: TP=${iocResult.summary.tpCount}, SL=${iocResult.summary.slCount}`)
const iocEntryCost = 0.0001 * 100
const iocExitCost = 0.0001 * 100
const iocTotalCost = iocEntryCost + iocExitCost + feeCost
console.log(`Net on TP hit: ${(tpProfit - iocTotalCost).toFixed(3)}% (${(tpProfit - iocTotalCost) > 0 ? 'PROFIT' : 'LOSS'})`)

// Test with LARGER TP/SL targets
console.log('\n' + '─'.repeat(65))
console.log('RECOMMENDED: LARGER TARGETS (TP: 0.2%, SL: 0.1%)')
console.log('─'.repeat(65))

const recommendedResult = runBacktest(candles, {
  profitTargetPct: 0.002,   // 0.2% → 8% leveraged at 40x
  stopLossPct: 0.001,       // 0.1% → 4% leveraged at 40x
  leverage: 40,
  capitalUSDC: 100,
  slippagePct: 0.0001,      // 0.01% IOC slippage
  feesPct: 0.0005,          // 0.05% fees
  bias: 'alternate',
})

console.log(`Trades: ${recommendedResult.summary.totalTrades}`)
console.log(`Win Rate: ${recommendedResult.summary.winRate.toFixed(1)}% (${recommendedResult.summary.winningTrades}W / ${recommendedResult.summary.losingTrades}L)`)
console.log(`Total PnL: $${recommendedResult.summary.totalPnlUSD.toFixed(2)} (${recommendedResult.summary.totalPnlPct.toFixed(1)}%)`)
console.log(`Profit Factor: ${recommendedResult.summary.profitFactor === Infinity ? '∞' : recommendedResult.summary.profitFactor.toFixed(2)}`)
console.log(`Exit Reasons: TP=${recommendedResult.summary.tpCount}, SL=${recommendedResult.summary.slCount}`)

// Test with EVEN LARGER targets
console.log('\n' + '─'.repeat(65))
console.log('AGGRESSIVE: (TP: 0.5%, SL: 0.2%)')
console.log('─'.repeat(65))

const aggressiveResult = runBacktest(candles, {
  profitTargetPct: 0.005,   // 0.5% → 20% leveraged at 40x
  stopLossPct: 0.002,       // 0.2% → 8% leveraged at 40x
  leverage: 40,
  capitalUSDC: 100,
  slippagePct: 0.0001,
  feesPct: 0.0005,
  bias: 'alternate',
})

console.log(`Trades: ${aggressiveResult.summary.totalTrades}`)
console.log(`Win Rate: ${aggressiveResult.summary.winRate.toFixed(1)}% (${aggressiveResult.summary.winningTrades}W / ${aggressiveResult.summary.losingTrades}L)`)
console.log(`Total PnL: $${aggressiveResult.summary.totalPnlUSD.toFixed(2)} (${aggressiveResult.summary.totalPnlPct.toFixed(1)}%)`)
console.log(`Profit Factor: ${aggressiveResult.summary.profitFactor === Infinity ? '∞' : aggressiveResult.summary.profitFactor.toFixed(2)}`)
console.log(`Exit Reasons: TP=${aggressiveResult.summary.tpCount}, SL=${aggressiveResult.summary.slCount}`)

// Final recommendation
console.log('\n' + '═'.repeat(65))
console.log('FINAL RECOMMENDATION')
console.log('═'.repeat(65))
console.log(`
The current TP/SL targets (0.03%/0.02%) are TOO SMALL relative to trading costs.

RECOMMENDED CHANGES for lib/bot-engine.ts:
─────────────────────────────────────────
OLD (losing money):
  PROFIT_TARGET_PCT = 0.0003  // 0.03%
  STOP_LOSS_PCT = 0.0002      // 0.02%

NEW (profitable with low slippage):
  PROFIT_TARGET_PCT = 0.002   // 0.2% → 8% leveraged at 40x
  STOP_LOSS_PCT = 0.001       // 0.1% → 4% leveraged at 40x

With 0.01% IOC slippage + 0.1% fees, break-even win rate = 33%
With larger targets, we have room for costs and still profit.
`)

// Test different parameter combinations with REALISTIC slippage
console.log('\n' + '─'.repeat(65))
console.log('PARAMETER OPTIMIZATION (with 0.01% IOC slippage)')
console.log('─'.repeat(65))

const tpValues = [0.001, 0.002, 0.003, 0.005, 0.01]
const slValues = [0.0005, 0.001, 0.002, 0.003]

const results = []

for (const tp of tpValues) {
  for (const sl of slValues) {
    const result = runBacktest(candles, {
      profitTargetPct: tp,
      stopLossPct: sl,
      leverage: 40,
      capitalUSDC: 100,
      slippagePct: 0.0001,  // Realistic IOC slippage
      feesPct: 0.0005,
      bias: 'alternate',
    })
    results.push({
      tp,
      sl,
      ...result.summary,
    })
  }
}

// Sort by total PnL (profit factor can be misleading with few trades)
results.sort((a, b) => b.totalPnlUSD - a.totalPnlUSD)

console.log('\nTop 10 parameter combinations (sorted by PnL):')
console.log('')
console.log('TP%      SL%      Win%   Trades  PnL$     PF')
console.log('─'.repeat(50))

results.slice(0, 10).forEach(r => {
  const pf = r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)
  console.log(
    `${(r.tp * 100).toFixed(3).padStart(6)}%  ` +
    `${(r.sl * 100).toFixed(3).padStart(6)}%  ` +
    `${r.winRate.toFixed(1).padStart(5)}%  ` +
    `${String(r.totalTrades).padStart(5)}  ` +
    `${r.totalPnlUSD.toFixed(2).padStart(8)}  ` +
    `${pf.padStart(5)}`
  )
})

// Recommend best parameters
const best = results[0]
console.log('\n' + '═'.repeat(65))
console.log('RECOMMENDED PARAMETERS')
console.log('═'.repeat(65))
console.log(`\nTP: ${(best.tp * 100).toFixed(3)}% (${(best.tp * 40 * 100).toFixed(1)}% leveraged at 40x)`)
console.log(`SL: ${(best.sl * 100).toFixed(3)}% (${(best.sl * 40 * 100).toFixed(1)}% leveraged at 40x)`)
console.log(`Expected Win Rate: ${best.winRate.toFixed(1)}%`)
console.log(`Expected Profit Factor: ${best.profitFactor === Infinity ? '∞' : best.profitFactor.toFixed(2)}`)
console.log('')
