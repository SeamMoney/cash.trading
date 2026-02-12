/**
 * Grid Market Maker Bot - Replicates DLP Vault's Symmetric Grid MM Strategy
 *
 * Reverse-engineered from the vault's on-chain order patterns:
 * - Symmetric bid/ask grid with NO inventory skew
 * - 2-3 price levels per side with increasing sizes
 * - Cancel-replace cycle every ~10 seconds
 * - Post-only GTC limit orders (maker fees)
 *
 * Run: npx tsx grid-mm-bot.ts
 */

import 'dotenv/config'
import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk'
import { MARKETS, DECIBEL_PACKAGE, type MarketName } from './lib/decibel-client'
import { getReadDex, createAuthenticatedAptos } from './lib/decibel-sdk'
import { PnLTracker } from './grid-mm-pnl'

// ============================================================================
// Configuration
// ============================================================================

interface MarketGridConfig {
  baseSpreadPct: number       // Level 0 half-spread (e.g., 0.0025 = 0.25%)
  levels: number              // 2 or 3 price levels per side
  baseSizeUSD: number         // Notional size at level 0 in USD
  enabled: boolean
}

const GRID_CONFIG: Record<string, MarketGridConfig> = {
  'BTC/USD':  { baseSpreadPct: 0.0025, levels: 3, baseSizeUSD: 500, enabled: true },
  'ETH/USD':  { baseSpreadPct: 0.03,   levels: 3, baseSizeUSD: 300, enabled: true },
  'SOL/USD':  { baseSpreadPct: 0.05,   levels: 3, baseSizeUSD: 200, enabled: true },
  'BNB/USD':  { baseSpreadPct: 0.02,   levels: 3, baseSizeUSD: 200, enabled: true },
  'APT/USD':  { baseSpreadPct: 0.04,   levels: 2, baseSizeUSD: 200, enabled: true },
  'XRP/USD':  { baseSpreadPct: 0.04,   levels: 2, baseSizeUSD: 200, enabled: true },
  'AAVE/USD': { baseSpreadPct: 0.12,   levels: 2, baseSizeUSD: 150, enabled: false },
  'DOGE/USD': { baseSpreadPct: 0.05,   levels: 2, baseSizeUSD: 150, enabled: false },
  'SUI/USD':  { baseSpreadPct: 0.06,   levels: 2, baseSizeUSD: 150, enabled: false },
  'HYPE/USD': { baseSpreadPct: 0.08,   levels: 2, baseSizeUSD: 100, enabled: false },
  'WLFI/USD': { baseSpreadPct: 0.15,   levels: 2, baseSizeUSD: 100, enabled: false },
  'ZEC/USD':  { baseSpreadPct: 0.10,   levels: 2, baseSizeUSD: 100, enabled: false },
}

// Level spread multipliers (vault pattern: 1x, 2x, ~4.8x)
const SPREAD_MULTIPLIERS = [1.0, 2.0, 4.8]
// Size multipliers per level (deeper levels = bigger size)
const SIZE_MULTIPLIERS = [1.0, 1.789, 2.474]

// Timing
const REFRESH_INTERVAL_MS = 10_000  // Cancel-replace cycle
const PNL_INTERVAL_MS = 300_000     // PnL snapshot every 5 minutes
const CANCEL_SETTLE_MS = 500        // Wait for cancels to settle before placing

// Chain constants (shared across all markets)
const LOT_SIZE = 10n
const MIN_SIZE = 100000n            // Minimum size in chain units
const PX_DECIMALS = 6               // Price always uses 6 decimals

// Per-market config helper (ticker_size and sz_decimals now vary)
function getMarketChainConfig(marketName: string) {
  const m = MARKETS[marketName as MarketName]
  return {
    tickerSize: BigInt(m?.tickerSize ?? 100000),
    szDecimals: m?.sizeDecimals ?? 8,
  }
}

// Client order ID prefix for our grid orders
const ORDER_PREFIX = 'GM:'

// Reverse map: market address → market name
const addrToName = new Map<string, string>()
for (const [name, info] of Object.entries(MARKETS)) {
  addrToName.set(info.address, name)
}

// ============================================================================
// Grid Order Calculation
// ============================================================================

interface GridOrder {
  marketName: string
  marketAddr: string
  level: number
  side: 'bid' | 'ask'
  price: number
  priceChain: bigint
  sizeChain: bigint
  isLong: boolean
  clientOrderId: string
}

function alignPriceDown(priceUSD: number, tickerSize: bigint): bigint {
  const raw = BigInt(Math.floor(priceUSD * 10 ** PX_DECIMALS))
  return (raw / tickerSize) * tickerSize
}

function alignPriceUp(priceUSD: number, tickerSize: bigint): bigint {
  const raw = BigInt(Math.ceil(priceUSD * 10 ** PX_DECIMALS))
  return ((raw + tickerSize - 1n) / tickerSize) * tickerSize
}

function calculateSize(baseSizeUSD: number, multiplier: number, markPrice: number, szDecimals: number): bigint {
  const sizeInBase = (baseSizeUSD * multiplier) / markPrice
  let sizeChain = BigInt(Math.floor(sizeInBase * 10 ** szDecimals))
  // Align to lot size
  sizeChain = (sizeChain / LOT_SIZE) * LOT_SIZE
  // Enforce minimum
  if (sizeChain < MIN_SIZE) sizeChain = MIN_SIZE
  return sizeChain
}

export function calculateGridOrders(marketName: string, markPrice: number): GridOrder[] {
  const config = GRID_CONFIG[marketName]
  if (!config || !config.enabled) return []

  const marketAddr = MARKETS[marketName as MarketName]?.address
  if (!marketAddr) return []

  const { tickerSize, szDecimals } = getMarketChainConfig(marketName)
  const orders: GridOrder[] = []
  const epoch = Math.floor(Date.now() / 1000)

  for (let level = 0; level < config.levels; level++) {
    const spreadMult = SPREAD_MULTIPLIERS[level] || SPREAD_MULTIPLIERS[SPREAD_MULTIPLIERS.length - 1]
    const sizeMult = SIZE_MULTIPLIERS[level] || SIZE_MULTIPLIERS[SIZE_MULTIPLIERS.length - 1]

    const spread = markPrice * config.baseSpreadPct * spreadMult
    const bidPrice = markPrice - spread
    const askPrice = markPrice + spread

    const bidPriceChain = alignPriceDown(bidPrice, tickerSize)
    const askPriceChain = alignPriceUp(askPrice, tickerSize)
    const sizeChain = calculateSize(config.baseSizeUSD, sizeMult, markPrice, szDecimals)

    // Sanity: skip if price is <= 0 or too close to mark
    if (bidPriceChain <= 0n || askPriceChain <= 0n) continue

    const seq = level * 2
    orders.push({
      marketName,
      marketAddr,
      level,
      side: 'bid',
      price: bidPrice,
      priceChain: bidPriceChain,
      sizeChain,
      isLong: true,   // Bid = buy = long
      clientOrderId: `${ORDER_PREFIX}${epoch}${String(seq).padStart(6, '0')}`,
    })
    orders.push({
      marketName,
      marketAddr,
      level,
      side: 'ask',
      price: askPrice,
      priceChain: askPriceChain,
      sizeChain,
      isLong: false,  // Ask = sell = short
      clientOrderId: `${ORDER_PREFIX}${epoch}${String(seq + 1).padStart(6, '0')}`,
    })
  }

  return orders
}

// ============================================================================
// Grid Market Maker
// ============================================================================

export class GridMarketMaker {
  private aptos: Aptos
  private botAccount: Account
  private subaccount: string
  private pnlTracker: PnLTracker
  private cycleTimer: ReturnType<typeof setInterval> | null = null
  private pnlTimer: ReturnType<typeof setInterval> | null = null
  private isRunning = false
  private cycleCount = 0
  private lastOrderCount = 0

  constructor() {
    const privateKeyHex = process.env.BOT_OPERATOR_PRIVATE_KEY
    const subaccount = process.env.GRID_MM_SUBACCOUNT
    if (!privateKeyHex) throw new Error('BOT_OPERATOR_PRIVATE_KEY not set')
    if (!subaccount) throw new Error('GRID_MM_SUBACCOUNT not set')

    this.subaccount = subaccount
    this.aptos = createAuthenticatedAptos()

    const cleanKey = privateKeyHex
      .replace('ed25519-priv-', '')
      .replace(/\\n/g, '')
      .replace(/\n/g, '')
      .trim()
    const privateKey = new Ed25519PrivateKey(cleanKey)
    this.botAccount = Account.fromPrivateKey({ privateKey })
    this.pnlTracker = new PnLTracker(subaccount)

    console.log(`Bot operator: ${this.botAccount.accountAddress.toString()}`)
    console.log(`Subaccount:   ${subaccount}`)
  }

  async start(): Promise<void> {
    console.log('\n=== Grid Market Maker Bot ===')

    // Show enabled markets
    const enabledMarkets = Object.entries(GRID_CONFIG)
      .filter(([, c]) => c.enabled)
      .map(([name, c]) => `${name}(${(c.baseSpreadPct * 100).toFixed(2)}%, ${c.levels}L)`)
    console.log(`Markets: ${enabledMarkets.join(', ')}`)
    console.log(`Refresh: ${REFRESH_INTERVAL_MS / 1000}s | PnL: ${PNL_INTERVAL_MS / 60000}min`)

    // Load existing PnL data
    this.pnlTracker.loadFromFile()

    // Cancel stale orders from previous runs
    console.log('\nCancelling stale orders...')
    await this.cancelAllGridOrders()

    // Initial PnL snapshot
    console.log('\nTaking initial PnL snapshot...')
    await this.pnlTracker.takeAndPrint(0)

    // Start loops
    this.isRunning = true

    // First cycle immediately
    await this.runCycle()

    this.cycleTimer = setInterval(async () => {
      if (!this.isRunning) return
      try {
        await this.runCycle()
      } catch (error) {
        console.error('Cycle error:', error)
      }
    }, REFRESH_INTERVAL_MS)

    this.pnlTimer = setInterval(async () => {
      if (!this.isRunning) return
      try {
        await this.pnlTracker.takeAndPrint(this.lastOrderCount)
      } catch (error) {
        console.error('PnL snapshot error:', error)
      }
    }, PNL_INTERVAL_MS)

    console.log('\nBot running. Press Ctrl+C to stop.\n')
  }

  async runCycle(): Promise<void> {
    const cycleStart = Date.now()
    this.cycleCount++

    try {
      // Step 1: Fetch all mark prices
      const readDex = getReadDex()
      const allPrices = await readDex.marketPrices.getAll()
      const priceMap = new Map<string, number>()
      for (const p of allPrices) {
        if (p.mark_px) {
          // Map address back to market name
          const name = addrToName.get(p.market)
          if (name) priceMap.set(name, p.mark_px)
        }
      }

      // Step 2: Fetch open orders
      const openOrdersResp = await readDex.userOpenOrders.getByAddr({
        subAddr: this.subaccount,
      })
      const allOpenOrders = Array.isArray(openOrdersResp)
        ? openOrdersResp
        : (openOrdersResp as any)?.items || []

      // Filter to our grid orders only (prefix GM:)
      const gridOrders = allOpenOrders.filter(
        (o: any) => o.client_order_id?.startsWith(ORDER_PREFIX)
      )
      this.lastOrderCount = gridOrders.length

      // Step 3: Cancel existing grid orders
      if (gridOrders.length > 0) {
        await this.cancelOrders(gridOrders)
        // Brief wait for cancels to settle on-chain
        await sleep(CANCEL_SETTLE_MS)
      }

      // Step 4: Calculate and place new grid
      const enabledMarkets = Object.entries(GRID_CONFIG).filter(([, c]) => c.enabled)
      const allNewOrders: GridOrder[] = []

      for (const [marketName] of enabledMarkets) {
        const markPrice = priceMap.get(marketName)
        if (!markPrice) {
          console.warn(`  No price for ${marketName}, skipping`)
          continue
        }
        const orders = calculateGridOrders(marketName, markPrice)
        allNewOrders.push(...orders)
      }

      // Build and submit placement TXs
      if (allNewOrders.length > 0) {
        await this.placeOrders(allNewOrders)
      }

      const cycleTime = Date.now() - cycleStart
      const priceStr = enabledMarkets
        .map(([name]) => {
          const px = priceMap.get(name)
          return px ? `${name.split('/')[0]}=$${px.toFixed(2)}` : null
        })
        .filter(Boolean)
        .join(' ')

      console.log(
        `[Cycle ${this.cycleCount}] ${cycleTime}ms | ` +
        `cancelled=${gridOrders.length} placed=${allNewOrders.length} | ${priceStr}`
      )
    } catch (error: any) {
      console.error(`[Cycle ${this.cycleCount}] Error: ${error.message}`)
    }
  }

  private async cancelOrders(orders: any[]): Promise<void> {
    // Build cancel TXs sequentially (ensures correct sequence numbers)
    const builtTxs: any[] = []
    for (const order of orders) {
      try {
        const tx = await this.aptos.transaction.build.simple({
          sender: this.botAccount.accountAddress,
          data: {
            function: `${DECIBEL_PACKAGE}::dex_accounts_entry::cancel_order_to_subaccount`,
            typeArguments: [],
            functionArguments: [
              this.subaccount,
              order.order_id,  // u128 order ID
              order.market,    // market address
            ],
          },
        })
        builtTxs.push(tx)
      } catch (error: any) {
        console.warn(`  Cancel build failed for ${order.order_id}: ${error.message}`)
      }
    }

    // Submit all in parallel (fire-and-forget, don't wait for on-chain confirmation)
    const results = await Promise.allSettled(
      builtTxs.map(tx =>
        this.aptos.signAndSubmitTransaction({ signer: this.botAccount, transaction: tx })
      )
    )

    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) {
      console.warn(`  ${failed}/${builtTxs.length} cancel submissions failed`)
    }
  }

  private async placeOrders(orders: GridOrder[]): Promise<void> {
    // Build placement TXs sequentially (ensures correct sequence numbers)
    const builtTxs: { tx: any; order: GridOrder }[] = []
    for (const order of orders) {
      try {
        const tx = await this.aptos.transaction.build.simple({
          sender: this.botAccount.accountAddress,
          data: {
            function: `${DECIBEL_PACKAGE}::dex_accounts_entry::place_order_to_subaccount`,
            typeArguments: [],
            functionArguments: [
              this.subaccount,                 // subaccount
              order.marketAddr,                // market
              order.priceChain.toString(),     // price (u64)
              order.sizeChain.toString(),      // size (u64)
              order.isLong,                    // is_long
              0,                               // time_in_force: GTC
              true,                            // post_only
              order.clientOrderId,             // client_order_id
              undefined,                       // conditional_order
              undefined,                       // trigger_price
              undefined,                       // take_profit_px
              undefined,                       // stop_loss_px
              undefined,                       // reduce_only
              undefined,                       // builder_address
              undefined,                       // max_builder_fee
            ],
          },
        })
        builtTxs.push({ tx, order })
      } catch (error: any) {
        console.warn(`  Place build failed ${order.marketName} ${order.side} L${order.level}: ${error.message}`)
      }
    }

    // Submit all in parallel
    const results = await Promise.allSettled(
      builtTxs.map(({ tx }) =>
        this.aptos.signAndSubmitTransaction({ signer: this.botAccount, transaction: tx })
      )
    )

    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) {
      console.warn(`  ${failed}/${builtTxs.length} place submissions failed`)
    }
  }

  private async cancelAllGridOrders(): Promise<void> {
    try {
      const readDex = getReadDex()
      const openOrdersResp2 = await readDex.userOpenOrders.getByAddr({
        subAddr: this.subaccount,
      })
      const allOpenOrders2 = Array.isArray(openOrdersResp2)
        ? openOrdersResp2
        : (openOrdersResp2 as any)?.items || []

      const gridOrders = allOpenOrders2.filter(
        (o: any) => o.client_order_id?.startsWith(ORDER_PREFIX)
      )

      if (gridOrders.length === 0) {
        console.log('  No stale grid orders found')
        return
      }

      console.log(`  Cancelling ${gridOrders.length} stale grid orders...`)
      await this.cancelOrders(gridOrders)
    } catch (error: any) {
      console.warn(`  Cancel all failed: ${error.message}`)
    }
  }

  async gracefulShutdown(): Promise<void> {
    console.log('\nShutting down...')
    this.isRunning = false

    if (this.cycleTimer) clearInterval(this.cycleTimer)
    if (this.pnlTimer) clearInterval(this.pnlTimer)

    console.log('Cancelling all grid orders...')
    await this.cancelAllGridOrders()
    await sleep(1000) // Let cancels settle

    console.log('Taking final PnL snapshot...')
    await this.pnlTracker.takeAndPrint(0)

    console.log('Saving PnL data...')
    this.pnlTracker.saveToFile()

    console.log('Shutdown complete.')
  }
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const bot = new GridMarketMaker()

  const shutdown = async () => {
    await bot.gracefulShutdown()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await bot.start()
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
