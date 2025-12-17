/**
 * Backtesting Engine for High Risk Strategy
 *
 * Simulates the high_risk strategy against historical price data
 * to validate win rate, PnL, and optimal parameters.
 */

export interface BacktestConfig {
  // Strategy parameters
  profitTargetPct: number      // e.g., 0.0003 = 0.03%
  stopLossPct: number          // e.g., 0.0002 = 0.02%
  leverage: number             // e.g., 40
  capitalUSDC: number          // e.g., 100

  // Simulation parameters
  slippagePct: number          // e.g., 0.001 = 0.1%
  feesPct: number              // e.g., 0.0005 = 0.05% (taker fee)

  // Direction bias
  bias: 'long' | 'short' | 'alternate'
}

export interface Trade {
  entryTime: number
  entryPrice: number
  exitTime: number
  exitPrice: number
  direction: 'long' | 'short'
  pnlPct: number               // Price change %
  pnlLeveraged: number         // Leveraged PnL %
  pnlUSD: number               // USD PnL
  exitReason: 'tp' | 'sl' | 'timeout'
  durationMs: number
}

export interface BacktestResult {
  config: BacktestConfig
  trades: Trade[]
  summary: {
    totalTrades: number
    winningTrades: number
    losingTrades: number
    winRate: number
    totalPnlUSD: number
    totalPnlPct: number
    avgWinUSD: number
    avgLossUSD: number
    profitFactor: number        // gross profit / gross loss
    maxDrawdownPct: number
    avgTradeDurationMs: number
    tradesPerHour: number
  }
}

export interface PriceCandle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
}

/**
 * Run backtest on historical price data
 */
export function runBacktest(
  candles: PriceCandle[],
  config: BacktestConfig
): BacktestResult {
  const trades: Trade[] = []
  let capitalUSD = config.capitalUSDC
  let maxCapital = capitalUSD
  let minCapital = capitalUSD
  let isLong = config.bias === 'long' || config.bias === 'alternate'

  let i = 0
  while (i < candles.length - 1) {
    const entryCandle = candles[i]
    const entryPrice = entryCandle.close

    // Calculate TP/SL prices
    const tpPrice = isLong
      ? entryPrice * (1 + config.profitTargetPct)
      : entryPrice * (1 - config.profitTargetPct)
    const slPrice = isLong
      ? entryPrice * (1 - config.stopLossPct)
      : entryPrice * (1 + config.stopLossPct)

    // Apply entry slippage
    const actualEntryPrice = isLong
      ? entryPrice * (1 + config.slippagePct)
      : entryPrice * (1 - config.slippagePct)

    // Simulate trade - scan forward candles for TP/SL hit
    let exitReason: 'tp' | 'sl' | 'timeout' = 'timeout'
    let exitPrice = entryPrice
    let exitTime = entryCandle.timestamp
    let exitCandleIndex = i + 1

    // Scan up to 60 candles forward (for 1-min candles = 1 hour max)
    const maxScanCandles = Math.min(60, candles.length - i - 1)

    for (let j = 1; j <= maxScanCandles; j++) {
      const candle = candles[i + j]

      // Check if TP or SL hit during this candle
      if (isLong) {
        // For long: check if high >= TP or low <= SL
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
        // For short: check if low <= TP or high >= SL
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

    // If timeout, exit at last scanned candle's close
    if (exitReason === 'timeout') {
      exitPrice = candles[exitCandleIndex].close
      exitTime = candles[exitCandleIndex].timestamp
    }

    // Apply exit slippage (worse price when exiting)
    const actualExitPrice = isLong
      ? exitPrice * (1 - config.slippagePct)
      : exitPrice * (1 + config.slippagePct)

    // Calculate PnL
    const pricePnlPct = isLong
      ? (actualExitPrice - actualEntryPrice) / actualEntryPrice
      : (actualEntryPrice - actualExitPrice) / actualEntryPrice

    // Subtract fees (entry + exit)
    const netPnlPct = pricePnlPct - (config.feesPct * 2)

    // Apply leverage
    const leveragedPnlPct = netPnlPct * config.leverage

    // Calculate USD PnL
    const positionSize = capitalUSD * config.leverage
    const pnlUSD = positionSize * netPnlPct

    // Record trade
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

    // Update capital
    capitalUSD += pnlUSD
    maxCapital = Math.max(maxCapital, capitalUSD)
    minCapital = Math.min(minCapital, capitalUSD)

    // Move to next entry point (after this trade exits)
    i = exitCandleIndex + 1

    // Alternate direction if bias is 'alternate'
    if (config.bias === 'alternate') {
      isLong = !isLong
    }

    // Stop if capital depleted
    if (capitalUSD <= 0) break
  }

  // Calculate summary statistics
  const winningTrades = trades.filter(t => t.pnlUSD > 0)
  const losingTrades = trades.filter(t => t.pnlUSD <= 0)
  const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnlUSD, 0)
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnlUSD, 0))

  const totalDuration = trades.length > 0
    ? trades[trades.length - 1].exitTime - trades[0].entryTime
    : 0

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
      avgTradeDurationMs: trades.length > 0
        ? trades.reduce((sum, t) => sum + t.durationMs, 0) / trades.length
        : 0,
      tradesPerHour: totalDuration > 0
        ? (trades.length / totalDuration) * 3600000
        : 0,
    },
  }
}

/**
 * Run parameter optimization to find best TP/SL values
 */
export function optimizeParameters(
  candles: PriceCandle[],
  baseConfig: Omit<BacktestConfig, 'profitTargetPct' | 'stopLossPct'>
): { bestConfig: BacktestConfig; results: BacktestResult[] } {
  const results: BacktestResult[] = []

  // Test different TP/SL combinations
  const tpValues = [0.0001, 0.0002, 0.0003, 0.0005, 0.001, 0.002, 0.003]
  const slValues = [0.0001, 0.0002, 0.0003, 0.0005, 0.001, 0.002]

  for (const tp of tpValues) {
    for (const sl of slValues) {
      const config: BacktestConfig = {
        ...baseConfig,
        profitTargetPct: tp,
        stopLossPct: sl,
      }
      const result = runBacktest(candles, config)
      results.push(result)
    }
  }

  // Find best by profit factor (or total PnL if all negative)
  results.sort((a, b) => {
    if (a.summary.profitFactor === Infinity && b.summary.profitFactor === Infinity) {
      return b.summary.totalPnlUSD - a.summary.totalPnlUSD
    }
    if (a.summary.profitFactor === Infinity) return -1
    if (b.summary.profitFactor === Infinity) return 1
    return b.summary.profitFactor - a.summary.profitFactor
  })

  return {
    bestConfig: results[0].config,
    results,
  }
}

/**
 * Generate simulated price data for testing
 * Uses random walk with mean reversion
 */
export function generateSimulatedPrices(
  startPrice: number,
  numCandles: number,
  volatilityPct: number = 0.001,  // Per candle volatility
  candleIntervalMs: number = 60000  // 1 minute candles
): PriceCandle[] {
  const candles: PriceCandle[] = []
  let price = startPrice
  let startTime = Date.now() - (numCandles * candleIntervalMs)

  for (let i = 0; i < numCandles; i++) {
    // Random walk with slight mean reversion
    const meanReversion = (startPrice - price) / startPrice * 0.01
    const randomMove = (Math.random() - 0.5) * 2 * volatilityPct
    const priceChange = meanReversion + randomMove

    const open = price
    const close = price * (1 + priceChange)
    const high = Math.max(open, close) * (1 + Math.random() * volatilityPct * 0.5)
    const low = Math.min(open, close) * (1 - Math.random() * volatilityPct * 0.5)

    candles.push({
      timestamp: startTime + (i * candleIntervalMs),
      open,
      high,
      low,
      close,
    })

    price = close
  }

  return candles
}

/**
 * Format backtest results for display
 */
export function formatBacktestResults(result: BacktestResult): string {
  const s = result.summary
  const c = result.config

  return `
═══════════════════════════════════════════════════════════════
                    BACKTEST RESULTS
═══════════════════════════════════════════════════════════════

Configuration:
  TP Target:     ${(c.profitTargetPct * 100).toFixed(3)}% (${(c.profitTargetPct * c.leverage * 100).toFixed(1)}% leveraged)
  SL Target:     ${(c.stopLossPct * 100).toFixed(3)}% (${(c.stopLossPct * c.leverage * 100).toFixed(1)}% leveraged)
  Leverage:      ${c.leverage}x
  Capital:       $${c.capitalUSDC}
  Slippage:      ${(c.slippagePct * 100).toFixed(2)}%
  Fees:          ${(c.feesPct * 100).toFixed(3)}%

Results:
  Total Trades:  ${s.totalTrades}
  Winning:       ${s.winningTrades} (${s.winRate.toFixed(1)}%)
  Losing:        ${s.losingTrades} (${(100 - s.winRate).toFixed(1)}%)

  Total PnL:     $${s.totalPnlUSD.toFixed(2)} (${s.totalPnlPct.toFixed(1)}%)
  Avg Win:       $${s.avgWinUSD.toFixed(2)}
  Avg Loss:      $${s.avgLossUSD.toFixed(2)}
  Profit Factor: ${s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)}
  Max Drawdown:  ${s.maxDrawdownPct.toFixed(1)}%

  Avg Duration:  ${(s.avgTradeDurationMs / 1000).toFixed(0)}s
  Trades/Hour:   ${s.tradesPerHour.toFixed(1)}

Exit Reasons:
  Take Profit:   ${result.trades.filter(t => t.exitReason === 'tp').length}
  Stop Loss:     ${result.trades.filter(t => t.exitReason === 'sl').length}
  Timeout:       ${result.trades.filter(t => t.exitReason === 'timeout').length}

═══════════════════════════════════════════════════════════════
`
}
