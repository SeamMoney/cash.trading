/**
 * Backtest API Endpoint
 *
 * Run backtests on historical or simulated price data
 * to validate and optimize the high_risk strategy.
 *
 * GET /api/backtest - Run backtest with default or query params
 * POST /api/backtest - Run backtest with custom config
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  runBacktest,
  optimizeParameters,
  generateSimulatedPrices,
  formatBacktestResults,
  BacktestConfig,
  PriceCandle,
} from '@/lib/backtest'

export const runtime = 'nodejs'
export const maxDuration = 60

// Default configuration matching current high_risk strategy
const DEFAULT_CONFIG: BacktestConfig = {
  profitTargetPct: 0.0003,  // 0.03%
  stopLossPct: 0.0002,      // 0.02%
  leverage: 40,
  capitalUSDC: 100,
  slippagePct: 0.001,       // 0.1% slippage
  feesPct: 0.0005,          // 0.05% fees
  bias: 'alternate',
}

/**
 * GET - Run quick backtest with default or query params
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Parse query params
    const config: BacktestConfig = {
      profitTargetPct: parseFloat(searchParams.get('tp') || '') || DEFAULT_CONFIG.profitTargetPct,
      stopLossPct: parseFloat(searchParams.get('sl') || '') || DEFAULT_CONFIG.stopLossPct,
      leverage: parseInt(searchParams.get('leverage') || '') || DEFAULT_CONFIG.leverage,
      capitalUSDC: parseFloat(searchParams.get('capital') || '') || DEFAULT_CONFIG.capitalUSDC,
      slippagePct: parseFloat(searchParams.get('slippage') || '') || DEFAULT_CONFIG.slippagePct,
      feesPct: parseFloat(searchParams.get('fees') || '') || DEFAULT_CONFIG.feesPct,
      bias: (searchParams.get('bias') as 'long' | 'short' | 'alternate') || DEFAULT_CONFIG.bias,
    }

    const numCandles = parseInt(searchParams.get('candles') || '') || 1440 // 24 hours of 1-min candles
    const startPrice = parseFloat(searchParams.get('startPrice') || '') || 100000 // BTC price
    const volatility = parseFloat(searchParams.get('volatility') || '') || 0.0005 // 0.05% per candle
    const optimize = searchParams.get('optimize') === 'true'

    console.log(`📊 Running backtest with ${numCandles} candles...`)

    // Generate simulated price data
    const candles = generateSimulatedPrices(startPrice, numCandles, volatility)

    if (optimize) {
      // Run parameter optimization
      console.log('🔍 Running parameter optimization...')
      const { bestConfig, results } = optimizeParameters(candles, {
        leverage: config.leverage,
        capitalUSDC: config.capitalUSDC,
        slippagePct: config.slippagePct,
        feesPct: config.feesPct,
        bias: config.bias,
      })

      // Get top 5 results
      const topResults = results.slice(0, 5).map(r => ({
        tp: (r.config.profitTargetPct * 100).toFixed(3) + '%',
        sl: (r.config.stopLossPct * 100).toFixed(3) + '%',
        winRate: r.summary.winRate.toFixed(1) + '%',
        pnlUSD: '$' + r.summary.totalPnlUSD.toFixed(2),
        profitFactor: r.summary.profitFactor === Infinity ? '∞' : r.summary.profitFactor.toFixed(2),
        trades: r.summary.totalTrades,
      }))

      return NextResponse.json({
        success: true,
        mode: 'optimization',
        bestConfig: {
          profitTargetPct: bestConfig.profitTargetPct,
          stopLossPct: bestConfig.stopLossPct,
        },
        topResults,
        recommendation: `Best params: TP=${(bestConfig.profitTargetPct * 100).toFixed(3)}%, SL=${(bestConfig.stopLossPct * 100).toFixed(3)}%`,
      })
    }

    // Run single backtest
    const result = runBacktest(candles, config)

    // Format for console
    console.log(formatBacktestResults(result))

    return NextResponse.json({
      success: true,
      mode: 'backtest',
      config: {
        tp: (config.profitTargetPct * 100).toFixed(3) + '%',
        sl: (config.stopLossPct * 100).toFixed(3) + '%',
        leverage: config.leverage + 'x',
        capital: '$' + config.capitalUSDC,
        slippage: (config.slippagePct * 100).toFixed(2) + '%',
        fees: (config.feesPct * 100).toFixed(3) + '%',
      },
      summary: {
        totalTrades: result.summary.totalTrades,
        winRate: result.summary.winRate.toFixed(1) + '%',
        winningTrades: result.summary.winningTrades,
        losingTrades: result.summary.losingTrades,
        totalPnlUSD: '$' + result.summary.totalPnlUSD.toFixed(2),
        totalPnlPct: result.summary.totalPnlPct.toFixed(1) + '%',
        avgWinUSD: '$' + result.summary.avgWinUSD.toFixed(2),
        avgLossUSD: '$' + result.summary.avgLossUSD.toFixed(2),
        profitFactor: result.summary.profitFactor === Infinity ? '∞' : result.summary.profitFactor.toFixed(2),
        maxDrawdown: result.summary.maxDrawdownPct.toFixed(1) + '%',
        avgTradeDurationSec: (result.summary.avgTradeDurationMs / 1000).toFixed(0) + 's',
        tradesPerHour: result.summary.tradesPerHour.toFixed(1),
      },
      exitReasons: {
        takeProfit: result.trades.filter(t => t.exitReason === 'tp').length,
        stopLoss: result.trades.filter(t => t.exitReason === 'sl').length,
        timeout: result.trades.filter(t => t.exitReason === 'timeout').length,
      },
      // Include last 10 trades for inspection
      recentTrades: result.trades.slice(-10).map(t => ({
        direction: t.direction,
        entryPrice: t.entryPrice.toFixed(2),
        exitPrice: t.exitPrice.toFixed(2),
        pnlPct: t.pnlPct.toFixed(4) + '%',
        pnlUSD: '$' + t.pnlUSD.toFixed(2),
        exitReason: t.exitReason,
        durationSec: (t.durationMs / 1000).toFixed(0) + 's',
      })),
    })
  } catch (error) {
    console.error('Backtest error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Backtest failed' },
      { status: 500 }
    )
  }
}

/**
 * POST - Run backtest with custom config and/or real price data
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      config: userConfig,
      candles: userCandles,
      numCandles = 1440,
      startPrice = 100000,
      volatility = 0.0005,
    } = body

    const config: BacktestConfig = {
      ...DEFAULT_CONFIG,
      ...userConfig,
    }

    // Use provided candles or generate simulated ones
    const candles: PriceCandle[] = userCandles && userCandles.length > 0
      ? userCandles
      : generateSimulatedPrices(startPrice, numCandles, volatility)

    console.log(`📊 Running backtest with ${candles.length} candles...`)

    const result = runBacktest(candles, config)

    console.log(formatBacktestResults(result))

    return NextResponse.json({
      success: true,
      summary: result.summary,
      trades: result.trades,
    })
  } catch (error) {
    console.error('Backtest error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Backtest failed' },
      { status: 500 }
    )
  }
}
