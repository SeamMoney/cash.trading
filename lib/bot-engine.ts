/**
 * Autonomous Volume Market Maker Bot Engine
 *
 * Generates cumulative trading volume by placing alternating TWAP orders
 * while optimizing capital efficiency.
 */

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk'

export interface BotConfig {
  userWalletAddress: string
  userSubaccount: string
  capitalUSDC: number // Amount of USDC to use for volume generation
  volumeTargetUSDC: number // Target cumulative volume to generate
  bias: 'long' | 'short' | 'neutral' // Directional bias
  market: string // Market address (BTC/USD, ETH/USD, etc.)
  marketName: string // Display name
  strategy: 'twap' | 'market_maker' | 'delta_neutral' | 'high_risk' | 'tx_spammer' // Trading strategy
  aggressiveness?: number // 1-10 scale for order frequency (optional, defaults to 5)
}

export interface OrderHistory {
  timestamp: number
  txHash: string
  direction: 'long' | 'short'
  size: number
  volumeGenerated: number
  success: boolean
  entryPrice?: number
  exitPrice?: number
  pnl?: number
  positionHeldMs?: number
}

export interface BotStatus {
  isRunning: boolean
  cumulativeVolume: number // Total volume generated so far
  ordersPlaced: number
  currentCapitalUsed: number
  lastOrderTime: number | null
  error: string | null
  orderHistory: OrderHistory[]
}

export interface OrderResult {
  success: boolean
  txHash: string
  volumeGenerated: number
  direction: 'long' | 'short'
  size: number
  error?: string
  entryPrice?: number
  exitPrice?: number
  pnl?: number
  positionHeldMs?: number
}

// Package address - prefer SDK config, fallback to env var, then hardcoded
// After testnet reset, update SDK package to get new addresses automatically
import { TESTNET_CONFIG, TimeInForce } from './decibel-sdk'
const DECIBEL_PACKAGE = TESTNET_CONFIG.deployment.package ||
  process.env.NEXT_PUBLIC_DECIBEL_PACKAGE ||
  '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'

/**
 * Parse actual fill information from transaction events
 * Returns the actual filled size and price from BulkOrderFilledEvent or TradeEvent
 */
interface FillInfo {
  filled: boolean
  filledSize: number
  fillPrice: number
  realizedPnl: number
}

async function parseTransactionFill(
  aptos: Aptos,
  txHash: string,
  subaccount: string,
  sizeDecimals: number,
  priceDecimals: number
): Promise<FillInfo> {
  try {
    const tx = await aptos.getTransactionByHash({ transactionHash: txHash })

    if (!tx || !(tx as any).success) {
      return { filled: false, filledSize: 0, fillPrice: 0, realizedPnl: 0 }
    }

    const events = (tx as any).events || []
    let filledSize = 0
    let fillPrice = 0
    let realizedPnl = 0

    for (const event of events) {
      // Check BulkOrderFilledEvent - contains actual fill info for our order
      if (event.type?.includes('BulkOrderFilledEvent')) {
        const data = event.data || {}
        // BulkOrderFilledEvent has user field
        if (data.user === subaccount) {
          filledSize = parseInt(data.filled_size || data.size || '0')
          fillPrice = parseInt(data.avg_price || data.price || '0')
          console.log(`📊 BulkOrderFilledEvent: size=${filledSize}, price=${fillPrice}`)
        }
      }

      // Also check OrderEvent for FILLED status
      if (event.type?.includes('OrderEvent')) {
        const data = event.data || {}
        if (data.user === subaccount && data.status?.__variant__ === 'FILLED') {
          // Order was filled - get size from orig_size minus remaining_size
          const origSize = parseInt(data.orig_size || '0')
          const remaining = parseInt(data.remaining_size || '0')
          filledSize = origSize - remaining
          fillPrice = parseInt(data.price || '0')
          console.log(`📊 OrderEvent FILLED: size=${filledSize}, price=${fillPrice}`)
        }
      }

      // Check PositionUpdateEvent for our account - this tracks actual position changes
      if (event.type?.includes('PositionUpdateEvent')) {
        const data = event.data || {}
        // This event uses 'user' field which is the position account, not subaccount
        // We can use this to verify fills happened
      }

      // Check TradeEvent for realized PnL
      if (event.type?.includes('TradeEvent')) {
        const data = event.data || {}
        // TradeEvent account field is the position account, not subaccount
        // But we can still extract PnL from it
        if (data.realized_pnl) {
          const pnl = parseInt(data.realized_pnl) / Math.pow(10, 6) // USDC decimals
          if (pnl !== 0) {
            realizedPnl += pnl
            console.log(`📊 TradeEvent PnL: $${pnl.toFixed(2)}`)
          }
        }
      }
    }

    // Convert to human-readable units
    const filledSizeDecimal = filledSize / Math.pow(10, sizeDecimals)
    const fillPriceDecimal = fillPrice / Math.pow(10, priceDecimals)

    return {
      filled: filledSize > 0,
      filledSize,
      fillPrice: fillPriceDecimal,
      realizedPnl,
    }
  } catch (error) {
    console.error('Error parsing transaction fill:', error)
    return { filled: false, filledSize: 0, fillPrice: 0, realizedPnl: 0 }
  }
}

// Market addresses (from SDK - TESTNET - updated Dec 16, 2025 after reset)
const MARKETS: Record<string, string> = {
  'BTC/USD': '0xdb8c5e968efa1b4dcbb4aaa7e4389358768d9b26bd126d5fe1a33e0aa076c380',
  'ETH/USD': '0xd17355e1ac776bc91aa454c18c5dde81054a6ba6a4278d5296ec11f1cba4a274',
  'SOL/USD': '0xc0a85e3b28244046399e74b934cc41f1eea8b315f412e985b1b26e3d6f617e97',
  'APT/USD': '0x51657ded71c9b4edc74b2877f0fc3aa0c99f28ed12f6a18ecf9e1aeadb0f0463',
  'XRP/USD': '0xd9973a5e626f529a4dde41ba20e76843ac508446195603184278df69702dfa28',
  'LINK/USD': '0xbe7bace32193a55b357ed6a778813cb97879443aab7eee74f7a8924e42c15f01',
  'AAVE/USD': '0x499a1b99be437b42a3e65838075dc0c3319b4bf4146fd8bbc5f1b441623c1a8d',
  'ENA/USD': '0x65d5a08b4682197dd445681feb74b1c4b920d9623729089a7592ccc918b72c86',
  'HYPE/USD': '0x7257fa2a4046358792b2cd07c386c62598806f2975ec4e02af9c0818fc66164c',
  'WLFI/USD': '0xd7746e5f976b3e585ff382e42c9fa1dc1822b9c2b16e41e768fb30f3b1f542e4',
}

// Market configuration from SDK (TESTNET - updated Dec 16, 2025 after reset)
// tickerSize: minimum price increment (from SDK tick_size)
// lotSize: minimum size increment
// minSize: minimum order size
// pxDecimals: price decimals (all markets use 6)
// szDecimals: size decimals (from SDK sz_decimals)
const MARKET_CONFIG: Record<string, { tickerSize: bigint; lotSize: bigint; minSize: bigint; pxDecimals: number; szDecimals: number }> = {
  'BTC/USD': { tickerSize: 100000n, lotSize: 10n, minSize: 100000n, pxDecimals: 6, szDecimals: 8 },
  'ETH/USD': { tickerSize: 10000n, lotSize: 10n, minSize: 10000n, pxDecimals: 6, szDecimals: 7 },
  'SOL/USD': { tickerSize: 1000n, lotSize: 10n, minSize: 10000n, pxDecimals: 6, szDecimals: 6 },
  'APT/USD': { tickerSize: 10n, lotSize: 10n, minSize: 100000n, pxDecimals: 6, szDecimals: 4 },
  'XRP/USD': { tickerSize: 10n, lotSize: 10n, minSize: 100000n, pxDecimals: 6, szDecimals: 4 },
  'LINK/USD': { tickerSize: 100n, lotSize: 10n, minSize: 10000n, pxDecimals: 6, szDecimals: 5 },
  'AAVE/USD': { tickerSize: 1000n, lotSize: 10n, minSize: 10000n, pxDecimals: 6, szDecimals: 6 },
  'ENA/USD': { tickerSize: 1n, lotSize: 10n, minSize: 100000n, pxDecimals: 6, szDecimals: 3 },
  'HYPE/USD': { tickerSize: 100n, lotSize: 10n, minSize: 10000n, pxDecimals: 6, szDecimals: 5 },
  'WLFI/USD': { tickerSize: 1n, lotSize: 10n, minSize: 100000n, pxDecimals: 6, szDecimals: 3 },
}

// Price history for momentum detection
interface PricePoint {
  price: number
  timestamp: number
}

export class VolumeBotEngine {
  private config: BotConfig
  private status: BotStatus
  private aptos: Aptos
  private botAccount: Account
  private isActive: boolean = false
  private loopInterval: NodeJS.Timeout | null = null
  private pendingTwapOrderTime: number | null = null // Track when we placed a TWAP that's still filling
  private priceHistory: PricePoint[] = [] // Track recent prices for momentum
  private static readonly MOMENTUM_WINDOW_MS = 30000 // 30 second window for momentum calc
  private static readonly MOMENTUM_MIN_SAMPLES = 2 // Minimum samples needed

  constructor(config: BotConfig) {
    this.config = config
    this.status = {
      isRunning: false,
      cumulativeVolume: 0,
      ordersPlaced: 0,
      currentCapitalUsed: 0,
      lastOrderTime: null,
      error: null,
      orderHistory: [],
    }

    // Initialize Aptos SDK with API key to avoid 429 rate limits
    // Use same key logic as decibel-sdk.ts
    const nodeApiKey = (process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY || '')
      .replace(/\\n/g, '')
      .replace(/\n/g, '')
      .trim()

    const aptosConfig = new AptosConfig({
      network: Network.TESTNET,
      clientConfig: nodeApiKey ? {
        HEADERS: { Authorization: `Bearer ${nodeApiKey}` }
      } : undefined
    })
    this.aptos = new Aptos(aptosConfig)

    // Load bot operator wallet from environment
    const botPrivateKeyHex = process.env.BOT_OPERATOR_PRIVATE_KEY
    if (!botPrivateKeyHex) {
      throw new Error('BOT_OPERATOR_PRIVATE_KEY not set in environment')
    }

    // Clean the key: remove prefix, trim whitespace/newlines
    const cleanKey = botPrivateKeyHex
      .replace('ed25519-priv-', '')
      .replace(/\\n/g, '')  // Remove escaped newlines
      .replace(/\n/g, '')   // Remove actual newlines
      .trim()
    const botPrivateKey = new Ed25519PrivateKey(cleanKey)
    this.botAccount = Account.fromPrivateKey({ privateKey: botPrivateKey })

    console.log('🤖 Volume Bot Engine initialized')
    console.log('Bot Wallet:', this.botAccount.accountAddress.toString())
    console.log('User Wallet:', config.userWalletAddress)
    console.log('Capital:', `$${config.capitalUSDC} USDC`)
    console.log('Volume Target:', `$${config.volumeTargetUSDC} USDC`)
    console.log('Bias:', config.bias)
  }

  /**
   * Set the last TWAP order time (loaded from database for high_risk strategy)
   */
  setLastTwapOrderTime(time: Date): void {
    this.pendingTwapOrderTime = time.getTime()
    console.log(`⏱️ Loaded lastTwapOrderTime from DB: ${time.toISOString()}`)
  }

  /**
   * Get the last TWAP order time (to persist to database)
   */
  getLastTwapOrderTime(): Date | null {
    return this.pendingTwapOrderTime ? new Date(this.pendingTwapOrderTime) : null
  }

  /**
   * Track current price for momentum calculation
   */
  private trackPrice(price: number): void {
    const now = Date.now()
    this.priceHistory.push({ price, timestamp: now })

    // Remove prices older than momentum window
    const cutoff = now - VolumeBotEngine.MOMENTUM_WINDOW_MS
    this.priceHistory = this.priceHistory.filter(p => p.timestamp >= cutoff)
  }

  /**
   * Calculate momentum signal from recent price history
   * Returns: 'bullish' | 'bearish' | 'neutral'
   *
   * Momentum is calculated as:
   * - Price change % over the window period
   * - If change > threshold: bullish
   * - If change < -threshold: bearish
   * - Otherwise: neutral
   */
  private getMomentumSignal(currentPrice: number): {
    signal: 'bullish' | 'bearish' | 'neutral'
    changePercent: number
    confidence: number
  } {
    // Track current price
    this.trackPrice(currentPrice)

    // Need minimum samples for momentum calculation
    if (this.priceHistory.length < VolumeBotEngine.MOMENTUM_MIN_SAMPLES) {
      return { signal: 'neutral', changePercent: 0, confidence: 0 }
    }

    // Get oldest price in window
    const oldestPrice = this.priceHistory[0].price
    const changePercent = (currentPrice - oldestPrice) / oldestPrice * 100

    // Momentum thresholds (in %)
    const BULLISH_THRESHOLD = 0.02  // +0.02% in 30s = bullish
    const BEARISH_THRESHOLD = -0.02 // -0.02% in 30s = bearish

    // Confidence based on number of samples and consistency
    const sampleRatio = Math.min(this.priceHistory.length / 10, 1) // Up to 10 samples
    const confidence = sampleRatio * Math.min(Math.abs(changePercent) / 0.1, 1) // Scale by change magnitude

    if (changePercent >= BULLISH_THRESHOLD) {
      return { signal: 'bullish', changePercent, confidence }
    } else if (changePercent <= BEARISH_THRESHOLD) {
      return { signal: 'bearish', changePercent, confidence }
    }

    return { signal: 'neutral', changePercent, confidence }
  }

  /**
   * Determine if we should enter a trade based on momentum
   * Returns true if momentum supports the trade direction
   */
  private shouldEnterBasedOnMomentum(
    wantedDirection: 'long' | 'short',
    momentum: { signal: 'bullish' | 'bearish' | 'neutral'; changePercent: number; confidence: number }
  ): { shouldEnter: boolean; reason: string } {
    // For scalping, we want to enter WITH momentum
    // Long positions: enter on bullish momentum
    // Short positions: enter on bearish momentum

    // Always allow neutral bias trades if momentum is neutral (market ranging)
    if (this.config.bias === 'neutral' && momentum.signal === 'neutral') {
      return { shouldEnter: true, reason: 'Neutral market, neutral bias - ok to scalp' }
    }

    // Check if momentum aligns with our desired direction
    if (wantedDirection === 'long') {
      if (momentum.signal === 'bullish') {
        return { shouldEnter: true, reason: `Bullish momentum (${momentum.changePercent.toFixed(4)}%) supports long entry` }
      } else if (momentum.signal === 'bearish') {
        return { shouldEnter: false, reason: `Bearish momentum (${momentum.changePercent.toFixed(4)}%) - skip long entry` }
      }
      // Neutral momentum - ok for scalps but lower confidence
      return { shouldEnter: true, reason: 'Neutral momentum - cautious long entry' }
    } else {
      if (momentum.signal === 'bearish') {
        return { shouldEnter: true, reason: `Bearish momentum (${momentum.changePercent.toFixed(4)}%) supports short entry` }
      } else if (momentum.signal === 'bullish') {
        return { shouldEnter: false, reason: `Bullish momentum (${momentum.changePercent.toFixed(4)}%) - skip short entry` }
      }
      // Neutral momentum - ok for scalps but lower confidence
      return { shouldEnter: true, reason: 'Neutral momentum - cautious short entry' }
    }
  }

  /**
   * Calculate optimal order size to maximize volume while minimizing capital usage
   */
  private calculateOrderSize(): number {
    const { capitalUSDC, volumeTargetUSDC, bias } = this.config
    const { cumulativeVolume } = this.status

    // Remaining volume to generate
    const remainingVolume = volumeTargetUSDC - cumulativeVolume

    if (remainingVolume <= 0) {
      console.log('✅ Volume target reached!')
      return 0
    }

    // For neutral bias, we alternate long/short with same size
    // This means each order generates 2x volume (open + close)
    // So we can use smaller position sizes

    // Strategy: Use 2-5% of capital per order for maximum efficiency
    const baseOrderSize = capitalUSDC * 0.03 // 3% of capital

    // Don't exceed remaining volume target
    const maxOrderSize = remainingVolume / 2 // Divide by 2 since we'll close it

    return Math.min(baseOrderSize, maxOrderSize)
  }

  /**
   * Determine next order direction based on bias and previous orders
   */
  private getNextDirection(): 'long' | 'short' {
    const { bias } = this.config
    const { ordersPlaced } = this.status

    if (bias === 'long') return 'long'
    if (bias === 'short') return 'short'

    // Neutral: alternate
    return ordersPlaced % 2 === 0 ? 'long' : 'short'
  }

  /**
   * Fetch current market price from on-chain oracle
   */
  private async getCurrentMarketPrice(): Promise<number> {
    // Try SDK first (faster, more reliable)
    try {
      const { getReadDex } = await import('./decibel-sdk')
      const readDex = getReadDex()
      const prices = await readDex.marketPrices.getAll()
      const marketPrice = prices.find((p: any) => p.market_name === this.config.marketName)
      if (marketPrice?.mark_px) {
        console.log(`📊 [SDK] Price: $${marketPrice.mark_px.toFixed(2)}`)
        return marketPrice.mark_px
      }
    } catch (error) {
      console.log('⚠️ [SDK] Price fetch failed, trying on-chain...')
    }

    // Fallback: Get price from market's Price resource on-chain
    try {
      const resources = await this.aptos.getAccountResources({
        accountAddress: this.config.market
      })

      const priceResource = resources.find(r =>
        r.type.includes('price_management::Price')
      )

      if (priceResource && priceResource.data) {
        const data = priceResource.data as {
          oracle_px?: string
          mark_px?: string
          price?: string
          last_price?: string
        }
        // Price decimals vary by market (BTC=9, APT=6, WLFI=6)
        const pxDecimals = this.getMarketConfig().pxDecimals
        const priceRaw = data.oracle_px || data.mark_px || data.price || data.last_price
        if (priceRaw) {
          const price = parseInt(priceRaw) / Math.pow(10, pxDecimals)
          console.log(`📊 [On-chain] Price: $${price.toFixed(2)}`)
          return price
        }
      }
    } catch (error) {
      console.log('⚠️ Could not fetch on-chain price, using fallback')
    }

    // Last resort: Fallback prices - ONLY for order sizing, never for PNL calculation
    // These are approximate and should be updated periodically
    console.warn('⚠️ Using fallback price - PNL calculation may be inaccurate')
    const fallbackPrices: Record<string, number> = {
      'BTC/USD': 96000,
      'ETH/USD': 3600,
      'SOL/USD': 230,
      'APT/USD': 12,
      'WLFI/USD': 0.000018,
    }
    return fallbackPrices[this.config.marketName] || 50000
  }

  /**
   * Fetch user's current position for this market
   */
  private async getCurrentPosition(): Promise<{
    hasPosition: boolean
    isLong: boolean
    size: number
    entryPrice: number
    leverage: number
    error?: boolean // Indicates if we couldn't check (API error, rate limit, etc.)
  }> {
    try {
      const resources = await this.aptos.getAccountResources({
        accountAddress: this.config.userSubaccount
      })

      const positionsResource = resources.find(r =>
        r.type.includes('perp_positions::UserPositions')
      )

      if (!positionsResource) {
        return { hasPosition: false, isLong: true, size: 0, entryPrice: 0, leverage: 1 }
      }

      // Parse positions map to find this market
      const data = positionsResource.data as {
        positions?: {
          root?: {
            children?: {
              entries?: Array<{
                key: { inner: string }
                value: {
                  value: {
                    size: string
                    is_long: boolean
                    avg_acquire_entry_px: string
                    user_leverage: number
                  }
                }
              }>
            }
          }
        }
      }

      const entries = data.positions?.root?.children?.entries || []
      const marketPosition = entries.find(e =>
        e.key.inner.toLowerCase() === this.config.market.toLowerCase()
      )

      if (!marketPosition || parseInt(marketPosition.value.value.size) === 0) {
        return { hasPosition: false, isLong: true, size: 0, entryPrice: 0, leverage: 1 }
      }

      const pos = marketPosition.value.value
      // Price decimals vary by market (BTC=9, APT=6, WLFI=6)
      const pxDecimals = this.getMarketConfig().pxDecimals
      return {
        hasPosition: true,
        isLong: pos.is_long,
        size: parseInt(pos.size),
        entryPrice: parseInt(pos.avg_acquire_entry_px) / Math.pow(10, pxDecimals),
        leverage: pos.user_leverage
      }
    } catch (error) {
      console.error('Error fetching position:', error)
      // CRITICAL: Return error flag so we DON'T open a new position when API fails
      return { hasPosition: false, isLong: true, size: 0, entryPrice: 0, leverage: 1, error: true }
    }
  }

  /**
   * Get on-chain position (alias for getCurrentPosition for clarity)
   * Returns null if no position, or { error: true } if API failed
   */
  private async getOnChainPosition(): Promise<{
    size: number
    isLong: boolean
    entryPrice: number
    error?: boolean
  } | null> {
    const pos = await this.getCurrentPosition()

    // If API error, return error flag so caller knows not to open new position
    if (pos.error) {
      return { size: 0, isLong: true, entryPrice: 0, error: true }
    }

    if (!pos.hasPosition || pos.size === 0) {
      return null
    }
    return {
      size: pos.size,
      isLong: pos.isLong,
      entryPrice: pos.entryPrice,
    }
  }

  /**
   * Close the current position with TWAP order
   * TWAP is used because IOC has no liquidity on testnet
   */
  private async closePosition(
    size: number,
    isLong: boolean
  ): Promise<OrderResult> {
    try {
      // To close a long, place a short order (and vice versa)
      const closeDirection = !isLong

      console.log(`\n📝 [CLOSE] Closing ${isLong ? 'LONG' : 'SHORT'} position with TWAP...`)
      console.log(`   Size: ${size}`)

      const currentPrice = await this.getCurrentMarketPrice()
      console.log(`   Current Price: $${currentPrice.toFixed(2)}`)
      console.log(`   TWAP will fill over 1-2 minutes (IOC has no liquidity on testnet)`)

      // Use TWAP order for guaranteed close
      const transaction = await this.aptos.transaction.build.simple({
        sender: this.botAccount.accountAddress,
        data: {
          function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
          typeArguments: [],
          functionArguments: [
            this.config.userSubaccount,
            this.config.market,
            size.toString(),               // size
            closeDirection,                // is_long (opposite to close)
            true,                          // reduce_only: TRUE for closing
            60,                            // min duration: 1 minute
            120,                           // max duration: 2 minutes
            undefined,                     // builder_address
            undefined,                     // max_builder_fee
          ],
        },
      })

      const committedTxn = await this.aptos.signAndSubmitTransaction({
        signer: this.botAccount,
        transaction,
      })

      console.log(`   TX: ${committedTxn.hash.slice(0, 20)}...`)

      const executedTxn = await this.aptos.waitForTransaction({
        transactionHash: committedTxn.hash,
      })

      if (!executedTxn.success) {
        throw new Error(`Close TWAP order failed: ${executedTxn.vm_status}`)
      }

      console.log(`✅ Close TWAP submitted! Position will close over 1-2 minutes.`)

      return {
        success: true,
        txHash: committedTxn.hash,
        volumeGenerated: 0, // Will be calculated from actual close
        direction: closeDirection ? 'short' : 'long',
        size: size,
      }
    } catch (error) {
      console.error('❌ Close position failed:', error)
      return {
        success: false,
        txHash: '',
        volumeGenerated: 0,
        direction: 'long',
        size: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Fetch user's current USDC balance from their subaccount
   */
  private async getUserBalance(): Promise<number> {
    try {
      const resources = await this.aptos.getAccountResources({
        accountAddress: this.config.userSubaccount
      })

      // Look for AccountInfo which has equity
      const accountInfo = resources.find(r =>
        r.type.includes('perp_positions::AccountInfo')
      )

      if (accountInfo && accountInfo.data) {
        const data = accountInfo.data as { equity?: string; total_collateral_value?: string }
        if (data.equity) {
          return parseInt(data.equity) / 1_000_000 // USDC has 6 decimals
        }
        if (data.total_collateral_value) {
          return parseInt(data.total_collateral_value) / 1_000_000
        }
      }
    } catch (error) {
      console.log('⚠️ Could not fetch on-chain balance')
    }

    return this.config.capitalUSDC
  }

  /**
   * Calculate contract size from USDC amount
   */
  private calculateContractSize(sizeUSDC: number): number {
    // For now, use a fixed small size
    // TODO: Calculate based on market price and leverage
    return 10000 // 0.0001 BTC
  }

  /**
   * Get market configuration for price/size rounding
   */
  private getMarketConfig() {
    return MARKET_CONFIG[this.config.marketName] || MARKET_CONFIG['BTC/USD']
  }

  /**
   * Round price to nearest ticker_size increment (required for market orders)
   * Prices must be multiples of ticker_size to avoid EPRICE_NOT_RESPECTING_TICKER_SIZE error
   */
  private roundPriceToTickerSize(priceUSD: number): bigint {
    const config = this.getMarketConfig()
    // Convert price to chain units (price * 10^pxDecimals)
    const priceInChainUnits = BigInt(Math.floor(priceUSD * Math.pow(10, config.pxDecimals)))
    // Round to nearest ticker_size
    const rounded = (priceInChainUnits / config.tickerSize) * config.tickerSize
    console.log(`   Price rounding: $${priceUSD} → ${priceInChainUnits} → ${rounded} (ticker_size: ${config.tickerSize})`)
    return rounded
  }

  /**
   * Round size to nearest lot_size increment
   * Sizes must be multiples of lot_size
   */
  private roundSizeToLotSize(size: number): bigint {
    const config = this.getMarketConfig()
    const sizeBigInt = BigInt(Math.floor(size))
    // Round to nearest lot_size
    const rounded = (sizeBigInt / config.lotSize) * config.lotSize
    // Ensure minimum size
    if (rounded < config.minSize) {
      console.log(`   Size ${rounded} below minimum ${config.minSize}, using minimum`)
      return config.minSize
    }
    return rounded
  }

  /**
   * Place a TWAP order on behalf of the delegated user
   */
  private async placeOrder(
    size: number,
    isLong: boolean
  ): Promise<OrderResult> {
    try {
      console.log(`\n📝 Placing ${isLong ? 'LONG' : 'SHORT'} TWAP order...`)
      console.log(`Size: $${size.toFixed(2)} USDC`)

      // Convert USDC to contract size format
      // For BTC: size is in BTC with 8 decimals (satoshis)
      // For ETH: size is in ETH with 8 decimals (wei)
      // We need to calculate how much BTC/ETH this USDC amount represents

      // TODO: Get current market price and calculate size
      // For now, use a small fixed size for testing
      const contractSize = 10000 // 0.0001 BTC

      const transaction = await this.aptos.transaction.build.simple({
        sender: this.botAccount.accountAddress,
        data: {
          function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
          typeArguments: [],
          functionArguments: [
            this.config.userSubaccount,
            this.config.market,
            contractSize,
            isLong,
            false,     // reduce_only
            300,       // min duration: 5 minutes in SECONDS
            600,       // max duration: 10 minutes in SECONDS
            undefined, // builder_address (optional)
            undefined, // max_builder_fee (optional)
          ],
        },
      })

      const committedTxn = await this.aptos.signAndSubmitTransaction({
        signer: this.botAccount,
        transaction,
      })

      console.log(`✅ Order submitted: ${committedTxn.hash}`)

      const executedTxn = await this.aptos.waitForTransaction({
        transactionHash: committedTxn.hash,
      })

      if (!executedTxn.success) {
        throw new Error('Transaction failed')
      }

      console.log(`✅ Order confirmed!`)

      // Calculate actual volume: contractSize in base units * price (convert bigint to number)
      const currentPrice = await this.getCurrentMarketPrice()
      const sizeDecimals = this.getMarketSizeDecimals()
      const contractSizeNum = Number(contractSize)
      const volumeGenerated = (contractSizeNum / Math.pow(10, sizeDecimals)) * currentPrice

      return {
        success: true,
        txHash: committedTxn.hash,
        volumeGenerated,
        direction: isLong ? 'long' : 'short',
        size: contractSizeNum,
      }
    } catch (error) {
      console.error('❌ Order placement failed:', error)
      return {
        success: false,
        txHash: '',
        volumeGenerated: 0,
        direction: isLong ? 'long' : 'short',
        size: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Place a MARKET order for immediate execution
   * This will execute at current market price instantly
   */
  private async placeMarketOrder(
    size: number,
    isLong: boolean
  ): Promise<OrderResult> {
    try {
      console.log(`\n📝 [MARKET] Placing ${isLong ? 'LONG' : 'SHORT'} market order...`)
      console.log(`Size: $${size.toFixed(2)} USDC`)

      const contractSize = this.calculateContractSize(size)

      const transaction = await this.aptos.transaction.build.simple({
        sender: this.botAccount.accountAddress,
        data: {
          function: `${DECIBEL_PACKAGE}::dex_accounts::place_market_order_to_subaccount`,
          typeArguments: [],
          functionArguments: [
            this.config.userSubaccount,  // subaccount
            this.config.market,          // market
            contractSize,                // size (u64)
            isLong,                      // is_long (bool)
            false,                       // reduce_only (bool)
            undefined,                   // client_order_id (Option<String>)
            undefined,                   // stop_price (Option<u64>)
            undefined,                   // tp_trigger_price (Option<u64>)
            undefined,                   // tp_limit_price (Option<u64>)
            undefined,                   // sl_trigger_price (Option<u64>)
            undefined,                   // sl_limit_price (Option<u64>)
            undefined,                   // builder_address (Option<address>)
            undefined,                   // max_builder_fee (Option<u64>)
          ],
        },
      })

      const committedTxn = await this.aptos.signAndSubmitTransaction({
        signer: this.botAccount,
        transaction,
      })

      console.log(`✅ Market order submitted: ${committedTxn.hash}`)

      const executedTxn = await this.aptos.waitForTransaction({
        transactionHash: committedTxn.hash,
      })

      if (!executedTxn.success) {
        throw new Error('Market order transaction failed')
      }

      console.log(`✅ Market order filled!`)

      // Calculate actual volume: contractSize in base units * price (convert bigint to number)
      const currentPrice = await this.getCurrentMarketPrice()
      const sizeDecimals = this.getMarketSizeDecimals()
      const contractSizeNum = Number(contractSize)
      const volumeGenerated = (contractSizeNum / Math.pow(10, sizeDecimals)) * currentPrice

      return {
        success: true,
        txHash: committedTxn.hash,
        volumeGenerated,
        direction: isLong ? 'long' : 'short',
        size: contractSizeNum,
      }
    } catch (error) {
      console.error('❌ Market order failed:', error)
      return {
        success: false,
        txHash: '',
        volumeGenerated: 0,
        direction: isLong ? 'long' : 'short',
        size: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Place a faster TWAP order for Market Maker strategy
   * Uses very short duration for near-instant execution
   */
  private async placeMarketMakerOrder(
    size: number,
    isLong: boolean
  ): Promise<OrderResult> {
    try {
      console.log(`\n📝 [Market Maker] Placing ${isLong ? 'LONG' : 'SHORT'} fast TWAP order...`)
      console.log(`Size: $${size.toFixed(2)} USDC`)

      // Use same contract size as regular TWAP
      const contractSize = 10000 // 0.0001 BTC

      const transaction = await this.aptos.transaction.build.simple({
        sender: this.botAccount.accountAddress,
        data: {
          function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
          typeArguments: [],
          functionArguments: [
            this.config.userSubaccount,
            this.config.market,
            contractSize,
            isLong,
            false,     // reduce_only
            300,       // min duration: 5 minutes in SECONDS
            600,       // max duration: 10 minutes in SECONDS
            undefined, // builder_address (optional)
            undefined, // max_builder_fee (optional)
          ],
        },
      })

      const committedTxn = await this.aptos.signAndSubmitTransaction({
        signer: this.botAccount,
        transaction,
      })

      console.log(`✅ Fast TWAP order submitted: ${committedTxn.hash}`)

      const executedTxn = await this.aptos.waitForTransaction({
        transactionHash: committedTxn.hash,
      })

      if (!executedTxn.success) {
        throw new Error('Transaction failed')
      }

      console.log(`✅ Fast TWAP order confirmed!`)

      // Calculate actual volume: contractSize in base units * price (convert bigint to number)
      const currentPrice = await this.getCurrentMarketPrice()
      const sizeDecimals = this.getMarketSizeDecimals()
      const contractSizeNum = Number(contractSize)
      const volumeGenerated = (contractSizeNum / Math.pow(10, sizeDecimals)) * currentPrice

      return {
        success: true,
        txHash: committedTxn.hash,
        volumeGenerated,
        direction: isLong ? 'long' : 'short',
        size: contractSizeNum,
      }
    } catch (error) {
      console.error('❌ Fast TWAP order failed:', error)
      return {
        success: false,
        txHash: '',
        volumeGenerated: 0,
        direction: isLong ? 'long' : 'short',
        size: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Place limit order for Delta Neutral strategy
   */
  private async placeLimitOrder(
    size: number,
    isLong: boolean,
    price: number
  ): Promise<OrderResult> {
    try {
      console.log(`\n📝 [Delta Neutral] Placing ${isLong ? 'LONG' : 'SHORT'} limit order at $${price.toFixed(2)}...`)

      const contractSize = 10000 // Small size for delta neutral

      // Convert price to contract format (price * 10^6 for 6 decimals)
      const priceInContractFormat = Math.floor(price * 1_000_000)

      const transaction = await this.aptos.transaction.build.simple({
        sender: this.botAccount.accountAddress,
        data: {
          function: `${DECIBEL_PACKAGE}::dex_accounts::place_order_to_subaccount`,
          typeArguments: [],
          functionArguments: [
            this.config.userSubaccount,
            this.config.market,
            priceInContractFormat,     // px FIRST
            contractSize,              // sz SECOND
            isLong,
            0,         // time_in_force: GTC (Good Till Cancel)
            true,      // post_only: true for better fees
            undefined, // client_order_id
            undefined, // conditional_order
            undefined, // trigger_price
            undefined, // take_profit_px
            undefined, // stop_loss_px
            undefined, // reduce_only
            undefined, // builder_address
            undefined, // max_builder_fee
          ],
        },
      })

      const committedTxn = await this.aptos.signAndSubmitTransaction({
        signer: this.botAccount,
        transaction,
      })

      console.log(`✅ Limit order submitted: ${committedTxn.hash}`)

      const executedTxn = await this.aptos.waitForTransaction({
        transactionHash: committedTxn.hash,
      })

      if (!executedTxn.success) {
        throw new Error('Transaction failed')
      }

      console.log(`✅ Limit order confirmed!`)

      // Calculate actual volume: contractSize in base units * price (convert bigint to number)
      const sizeDecimals = this.getMarketSizeDecimals()
      const contractSizeNum = Number(contractSize)
      const volumeGenerated = (contractSizeNum / Math.pow(10, sizeDecimals)) * price

      return {
        success: true,
        txHash: committedTxn.hash,
        volumeGenerated,
        direction: isLong ? 'long' : 'short',
        size: contractSizeNum,
      }
    } catch (error) {
      console.error('❌ Limit order failed:', error)
      return {
        success: false,
        txHash: '',
        volumeGenerated: 0,
        direction: isLong ? 'long' : 'short',
        size: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Place paired long/short orders for Delta Neutral strategy
   */
  private async placeDeltaNeutralOrders(size: number): Promise<OrderResult[]> {
    try {
      console.log(`\n📝 [Delta Neutral] Placing hedged long/short orders...`)

      // Get current market price
      const marketPrice = await this.getCurrentMarketPrice()

      // Place long limit order slightly above market
      const longOrder = await this.placeLimitOrder(size / 2, true, marketPrice * 1.0001)

      // Place short limit order slightly below market
      const shortOrder = await this.placeLimitOrder(size / 2, false, marketPrice * 0.9999)

      return [longOrder, shortOrder]
    } catch (error) {
      console.error('❌ Delta neutral orders failed:', error)
      return [{
        success: false,
        txHash: '',
        volumeGenerated: 0,
        direction: 'long',
        size: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }]
    }
  }

  /**
   * Place TP/SL orders for a position using SDK
   *
   * GOTCHA from dev chat:
   * - Max 10 TP/SL per market! Error: EMAX_FIXED_SIZED_PENDING_REQS_HIT(0x10008)
   * - Must cancel old TP/SL before placing new ones
   * - Use cancelTpSlOrderForPosition for reduce-only orders (NOT regular cancelOrder)
   */
  private async placeTpSlForPosition(
    entryPrice: number,
    size: number,
    isLong: boolean
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const { getWriteDex } = await import('./decibel-sdk')
      const writeDex = getWriteDex()

      // MOMENTUM SCALPING - Risk parameters matching placeHighRiskOrderWithIOC
      // Wider targets to actually cover trading costs and be profitable
      // At 40x leverage: TP = 20% gain, SL = 12% loss
      const PROFIT_TARGET_PCT = 0.005    // 0.5% price move = +20% leveraged profit at 40x
      const STOP_LOSS_PCT = 0.003        // 0.3% price move = -12% leveraged loss at 40x

      const tpPrice = isLong
        ? entryPrice * (1 + PROFIT_TARGET_PCT)
        : entryPrice * (1 - PROFIT_TARGET_PCT)

      const slPrice = isLong
        ? entryPrice * (1 - STOP_LOSS_PCT)
        : entryPrice * (1 + STOP_LOSS_PCT)

      // SDK requires prices in CHAIN UNITS (not human-readable!)
      // See: docs/OFFICIAL_SDK_REFERENCE.md - "All prices and sizes must be in chain units (u64)"
      const pxDecimals = this.getMarketConfig().pxDecimals

      // Limit prices should allow for slippage to ensure fills:
      // - For LONG TP: we're selling, limit should be slightly below trigger
      // - For LONG SL: we're selling, limit should be slightly below trigger
      // - For SHORT TP: we're buying, limit should be slightly above trigger
      // - For SHORT SL: we're buying, limit should be slightly above trigger
      const LIMIT_SLIPPAGE = 0.002 // 0.2% slippage allowance for guaranteed fills
      const tpLimitPrice = isLong
        ? tpPrice * (1 - LIMIT_SLIPPAGE)  // Long: sell at or above this
        : tpPrice * (1 + LIMIT_SLIPPAGE)  // Short: buy at or below this
      const slLimitPrice = isLong
        ? slPrice * (1 - LIMIT_SLIPPAGE)  // Long: sell at or above this
        : slPrice * (1 + LIMIT_SLIPPAGE)  // Short: buy at or below this

      const tpTriggerChain = Math.floor(tpPrice * Math.pow(10, pxDecimals))
      const tpLimitChain = Math.floor(tpLimitPrice * Math.pow(10, pxDecimals))
      const slTriggerChain = Math.floor(slPrice * Math.pow(10, pxDecimals))
      const slLimitChain = Math.floor(slLimitPrice * Math.pow(10, pxDecimals))

      console.log(`📊 [SDK] Placing TP/SL orders...`)
      console.log(`   Entry: $${entryPrice.toFixed(2)}, Position: ${isLong ? 'LONG' : 'SHORT'}`)
      console.log(`   TP: trigger $${tpPrice.toFixed(2)} → limit $${tpLimitPrice.toFixed(2)} (+${(PROFIT_TARGET_PCT * 100).toFixed(3)}%)`)
      console.log(`   SL: trigger $${slPrice.toFixed(2)} → limit $${slLimitPrice.toFixed(2)} (-${(STOP_LOSS_PCT * 100).toFixed(3)}%)`)
      console.log(`   Size: ${size}, Market: ${this.config.market.slice(0, 20)}...`)

      const result = await writeDex.placeTpSlOrderForPosition({
        marketAddr: this.config.market,
        tpTriggerPrice: tpTriggerChain,
        tpLimitPrice: tpLimitChain,
        tpSize: size,
        slTriggerPrice: slTriggerChain,
        slLimitPrice: slLimitChain,
        slSize: size,
        subaccountAddr: this.config.userSubaccount,
      })

      console.log(`✅ [SDK] TP/SL placed successfully!`)
      console.log(`   Result:`, JSON.stringify(result).slice(0, 300))
      return {
        success: true,
        txHash: result?.hash || result?.transactionHash || 'unknown'
      }
    } catch (error) {
      // Log FULL error for debugging - TP/SL is critical for risk management!
      console.error('❌ [SDK] TP/SL placement FAILED!')
      console.error('   Error:', error)
      if (error instanceof Error) {
        console.error('   Message:', error.message)
        if (error.stack) console.error('   Stack:', error.stack.slice(0, 500))
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Cancel existing TP/SL orders for a position using SDK
   */
  private async cancelTpSlForPosition(): Promise<boolean> {
    try {
      const { getWriteDex, getReadDex } = await import('./decibel-sdk')
      const readDex = getReadDex()
      const writeDex = getWriteDex()

      // Get open orders to find TP/SL orders
      const openOrders = await readDex.userOpenOrders.getByAddr({
        subAddr: this.config.userSubaccount
      })

      if (!openOrders || openOrders.length === 0) {
        console.log('   No TP/SL orders to cancel')
        return true
      }

      // Find TP/SL orders (reduce_only orders with stop_market or take_profit type)
      const tpSlOrders = openOrders.filter((order: any) => {
        const orderType = order.order_type?.toLowerCase() || ''
        return (orderType.includes('stop_market') || orderType.includes('take_profit')) &&
               order.is_reduce_only
      })

      if (tpSlOrders.length === 0) {
        console.log('   No TP/SL orders found')
        return true
      }

      console.log(`📊 [SDK] Cancelling ${tpSlOrders.length} TP/SL orders...`)

      for (const order of tpSlOrders) {
        try {
          await writeDex.cancelTpSlOrderForPosition({
            marketAddr: this.config.market,
            orderId: order.order_id,
            subaccountAddr: this.config.userSubaccount,
          })
          console.log(`   Cancelled order ${order.order_id}`)
        } catch (e) {
          console.warn(`   Failed to cancel order ${order.order_id}:`, e)
        }
      }

      return true
    } catch (error) {
      console.error('⚠️ [SDK] Failed to cancel TP/SL orders:', error)
      return false
    }
  }

  /**
   * Cancel a specific TWAP order by ID using SDK
   * More precise than "cancel all" approach
   */
  private async cancelTwapOrderSDK(orderId: string): Promise<boolean> {
    try {
      const { getWriteDex } = await import('./decibel-sdk')
      const writeDex = getWriteDex()

      await writeDex.cancelTwapOrder({
        orderId,
        marketAddr: this.config.market,
        subaccountAddr: this.config.userSubaccount,
      })

      console.log(`📊 [SDK] Cancelled TWAP order ${orderId}`)
      return true
    } catch (error) {
      console.warn(`⚠️ [SDK] Failed to cancel TWAP order ${orderId}:`, error)
      return false
    }
  }

  /**
   * Get all active TWAP orders using SDK
   */
  private async getActiveTwapsSDK(): Promise<Array<{
    orderId: string
    market: string
    isBuy: boolean
    origSize: number
    remainingSize: number
    status: string
  }>> {
    try {
      const { getReadDex } = await import('./decibel-sdk')
      const readDex = getReadDex()

      const twaps = await readDex.userActiveTwaps.getByAddr({
        subAddr: this.config.userSubaccount
      })

      if (!twaps || twaps.length === 0) {
        return []
      }

      return twaps.map((twap: any) => ({
        orderId: twap.order_id,
        market: twap.market,
        isBuy: twap.is_buy,
        origSize: twap.orig_size,
        remainingSize: twap.remaining_size,
        status: twap.status,
      }))
    } catch (error) {
      console.warn('⚠️ [SDK] Failed to get active TWAPs:', error)
      return []
    }
  }

  /**
   * Cancel all active TWAP orders using SDK
   * Useful for cleaning up before placing new orders
   */
  private async cancelAllActiveTwapsSDK(): Promise<number> {
    try {
      const activeTwaps = await this.getActiveTwapsSDK()

      if (activeTwaps.length === 0) {
        console.log('   No active TWAPs to cancel')
        return 0
      }

      console.log(`📊 [SDK] Cancelling ${activeTwaps.length} active TWAPs...`)

      let cancelled = 0
      for (const twap of activeTwaps) {
        if (await this.cancelTwapOrderSDK(twap.orderId)) {
          cancelled++
        }
      }

      console.log(`   Cancelled ${cancelled}/${activeTwaps.length} TWAPs`)
      return cancelled
    } catch (error) {
      console.error('⚠️ [SDK] Failed to cancel all TWAPs:', error)
      return 0
    }
  }

  /**
   * Get market address dynamically from SDK
   * Falls back to hardcoded address if SDK fails
   * This survives testnet resets!
   */
  private async getMarketAddressSDK(marketName: string): Promise<string | null> {
    try {
      const { getReadDex } = await import('./decibel-sdk')
      const readDex = getReadDex()
      const markets = await readDex.markets.getAll()
      const market = markets.find((m: any) => m.market_name === marketName)

      if (market?.market_addr) {
        console.log(`📊 [SDK] Market ${marketName} address: ${market.market_addr.slice(0, 10)}...`)
        return market.market_addr
      }
      return null
    } catch (error) {
      console.warn(`⚠️ [SDK] Failed to get market address for ${marketName}:`, error)
      return null
    }
  }

  /**
   * HIGH RISK STRATEGY - SDK IOC VERSION
   *
   * Uses SDK's placeOrder with ImmediateOrCancel for INSTANT execution.
   * Attaches TP/SL directly to the order for automatic exits.
   *
   * Flow:
   * 1. Check for existing position
   * 2. If no position: Place IOC order with attached TP/SL
   * 3. If IOC doesn't fill: Fallback to TWAP
   * 4. If position exists: Monitor for TP/SL trigger or force close
   *
   * Risk parameters (configurable):
   * - IOC_SLIPPAGE_PCT: 2% for aggressive fills
   * - PROFIT_TARGET_PCT: 0.03% price move (+1.2% at 40x)
   * - STOP_LOSS_PCT: 0.02% price move (-0.8% at 40x)
   */
  private async placeHighRiskOrderWithIOC(
    isLong: boolean
  ): Promise<OrderResult> {
    // ═══════════════════════════════════════════════════════════════════
    // MOMENTUM SCALPING STRATEGY
    //
    // Goals:
    // - Actually try to be PROFITABLE, not just generate volume
    // - Use momentum to improve entry timing
    // - Wider TP/SL to cover trading costs
    // - Risk management: limit losses, let winners run
    //
    // Trading costs (round trip):
    // - Entry slippage: ~0.05% (market/IOC)
    // - Exit slippage: ~0.05% (TP/SL trigger)
    // - Fees: 0.034% taker x 2 = ~0.07%
    // - Total: ~0.17%
    //
    // Strategy parameters:
    // - TP: 0.5% price move → 20% at 40x (net ~0.33% after costs)
    // - SL: 0.3% price move → 12% at 40x (net ~0.47% loss)
    // - Risk/Reward: 1.4:1 (need ~60% win rate to profit)
    // - Momentum entry should push win rate above 55%
    // ═══════════════════════════════════════════════════════════════════
    const IOC_SLIPPAGE_PCT = 0.05      // 5% slippage for guaranteed IOC fills on testnet
    const PROFIT_TARGET_PCT = 0.005    // 0.5% price move → 20% at 40x leverage
    const STOP_LOSS_PCT = 0.003        // 0.3% price move → 12% at 40x leverage
    const CAPITAL_USAGE_PCT = 0.25     // Use 25% of capital (conservative)
    const USE_TWAP_FALLBACK = false    // NO TWAP fallback - we want instant execution only

    try {
      const { prisma } = await import('./prisma')
      const { getWriteDex, getReadDex } = await import('./decibel-sdk')

      // Get bot instance from DB
      const botInstance = await prisma.botInstance.findUnique({
        where: { userWalletAddress: this.config.userWalletAddress }
      })
      if (!botInstance) {
        throw new Error('Bot instance not found in database')
      }

      // Check on-chain position first
      const onChainPosition = await this.getOnChainPosition()

      // ═══════════════════════════════════════════════════════════════════
      // SAFETY CHECK: If API failed, DO NOT open new position
      // Use DB state as backup to prevent duplicate positions
      // ═══════════════════════════════════════════════════════════════════
      if (onChainPosition?.error) {
        console.log(`⚠️ [IOC] API error - cannot verify position state. Checking DB...`)

        // If DB says we have a position, assume it exists
        if (botInstance.activePositionSize && botInstance.activePositionSize > 0) {
          console.log(`   DB shows position: ${botInstance.activePositionSize} - will monitor, not open new`)
          return {
            success: true,
            txHash: 'api_error_monitoring',
            volumeGenerated: 0,
            direction: botInstance.activePositionIsLong ? 'long' : 'short',
            size: botInstance.activePositionSize,
          }
        }

        // If we placed an order in the last 60 seconds, assume position might exist
        if (botInstance.lastOrderTime) {
          const timeSinceLastOrder = Date.now() - new Date(botInstance.lastOrderTime).getTime()
          if (timeSinceLastOrder < 60000) {
            console.log(`   Last order was ${(timeSinceLastOrder / 1000).toFixed(0)}s ago - waiting for API...`)
            return {
              success: true,
              txHash: 'waiting_for_api',
              volumeGenerated: 0,
              direction: isLong ? 'long' : 'short',
              size: 0,
            }
          }
        }

        console.log(`   DB shows no position and no recent orders - safe to open`)
      }

      // ═══════════════════════════════════════════════════════════════════
      // SCENARIO: Position exists - monitor for TP/SL or force close
      // ═══════════════════════════════════════════════════════════════════
      if (onChainPosition && onChainPosition.size > 0) {
        console.log(`\n📊 [IOC] Position exists: ${onChainPosition.size} (${onChainPosition.isLong ? 'LONG' : 'SHORT'})`)

        // Sync DB if needed
        if (!botInstance.activePositionSize || botInstance.activePositionSize === 0) {
          console.log(`⚠️ [IOC] Syncing position to DB...`)
          await prisma.botInstance.update({
            where: { id: botInstance.id },
            data: {
              activePositionSize: onChainPosition.size,
              activePositionIsLong: onChainPosition.isLong,
              activePositionEntry: onChainPosition.entryPrice,
            }
          })
        }

        // ALWAYS check and place TP/SL if position exists
        // (TWAP fallback doesn't set TP/SL, so we need to do it here)
        try {
          console.log(`📊 [IOC] Ensuring TP/SL orders exist for position...`)
          await this.cancelTpSlForPosition() // Cancel any stale TP/SL first
          await this.placeTpSlForPosition(
            onChainPosition.entryPrice,
            onChainPosition.size,
            onChainPosition.isLong
          )
          console.log(`✅ [IOC] TP/SL orders placed/updated`)
        } catch (tpslError) {
          console.warn(`⚠️ [IOC] Failed to place TP/SL:`, tpslError)
          // Continue monitoring - we'll try again next tick
        }

        // Check if volume target reached - force close
        if (botInstance.cumulativeVolume >= botInstance.volumeTargetUSDC) {
          console.log(`🎯 [IOC] Volume target reached! Force closing position...`)
          return await this.forceClosePositionWithIOC(onChainPosition)
        }

        // Check PnL to see if TP/SL should have triggered
        const currentPrice = await this.getCurrentMarketPrice()
        const pnlPct = onChainPosition.isLong
          ? (currentPrice - onChainPosition.entryPrice) / onChainPosition.entryPrice
          : (onChainPosition.entryPrice - currentPrice) / onChainPosition.entryPrice

        console.log(`   Entry: $${onChainPosition.entryPrice.toFixed(2)}, Current: $${currentPrice.toFixed(2)}`)
        console.log(`   PnL: ${(pnlPct * 100).toFixed(4)}% (TP: +${(PROFIT_TARGET_PCT * 100).toFixed(3)}%, SL: -${(STOP_LOSS_PCT * 100).toFixed(3)}%)`)

        // ═══════════════════════════════════════════════════════════════════
        // MANUAL TP/SL CHECK - Don't rely on on-chain TP/SL (it's unreliable!)
        // Close immediately when thresholds are hit
        // ═══════════════════════════════════════════════════════════════════

        // Take profit at target
        if (pnlPct >= PROFIT_TARGET_PCT) {
          console.log(`🎯 [IOC] TAKE PROFIT! PnL ${(pnlPct * 100).toFixed(3)}% >= target ${(PROFIT_TARGET_PCT * 100).toFixed(3)}%`)
          console.log(`   Force closing position NOW...`)
          return await this.forceClosePositionWithIOC(onChainPosition)
        }

        // Emergency stop loss - close at 80% of target to account for execution lag
        const EMERGENCY_SL_PCT = STOP_LOSS_PCT * 0.8 // 0.24% instead of 0.3%
        if (pnlPct <= -EMERGENCY_SL_PCT) {
          console.log(`🛑 [IOC] STOP LOSS! PnL ${(pnlPct * 100).toFixed(3)}% <= emergency SL -${(EMERGENCY_SL_PCT * 100).toFixed(3)}%`)
          console.log(`   Force closing position NOW to limit damage...`)
          return await this.forceClosePositionWithIOC(onChainPosition)
        }

        // Position still within range, TP/SL active - just monitoring
        return {
          success: true,
          txHash: 'monitoring',
          volumeGenerated: 0,
          direction: onChainPosition.isLong ? 'long' : 'short',
          size: onChainPosition.size,
          entryPrice: onChainPosition.entryPrice,
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // CHECK: Did a position just get closed by on-chain TP/SL?
      // ═══════════════════════════════════════════════════════════════════
      if (botInstance.activePositionSize && botInstance.activePositionSize > 0) {
        // DB says we have a position, but on-chain says we don't
        // This means TP/SL triggered and closed the position!
        console.log(`\n🎯 [IOC] Position was closed by on-chain TP/SL!`)
        console.log(`   DB had: ${botInstance.activePositionSize} (${botInstance.activePositionIsLong ? 'LONG' : 'SHORT'})`)
        console.log(`   Entry: $${botInstance.activePositionEntry?.toFixed(2)}`)

        // Try to get the closing price from the market
        const exitPrice = await this.getCurrentMarketPrice()
        const entryPrice = botInstance.activePositionEntry || exitPrice
        const posSize = botInstance.activePositionSize

        // Calculate PNL
        const pnlPct = botInstance.activePositionIsLong
          ? (exitPrice - entryPrice) / entryPrice
          : (entryPrice - exitPrice) / entryPrice
        const notionalValue = posSize * entryPrice / Math.pow(10, this.getMarketSizeDecimals())
        const pnlUsd = pnlPct * notionalValue

        console.log(`   Exit: $${exitPrice.toFixed(2)}`)
        console.log(`   PNL: ${(pnlPct * 100).toFixed(4)}% ($${pnlUsd.toFixed(2)})`)

        // Record the close trade
        const volumeGenerated = notionalValue * 2 // Round trip volume

        // Clear the position from DB (don't update cumulativeVolume/ordersPlaced here - executeSingleTrade does that)
        await prisma.botInstance.update({
          where: { id: botInstance.id },
          data: {
            activePositionSize: null,
            activePositionIsLong: null,
            activePositionEntry: null,
            activePositionTxHash: null,
          }
        })

        // Return the close result - record this trade!
        return {
          success: true,
          txHash: botInstance.activePositionTxHash || 'tp_sl_close',
          volumeGenerated,
          direction: botInstance.activePositionIsLong ? 'long' : 'short',
          size: posSize,
          entryPrice,
          exitPrice,
          pnl: pnlUsd,
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // CHECK: Did we recently place an order? (Prevents rapid order spam)
      // CRITICAL: This prevents multiple IOC orders being placed before
      // the first one fills and is detected by getOnChainPosition()
      // ═══════════════════════════════════════════════════════════════════
      const ORDER_COOLDOWN_MS = 10 * 1000 // 10 seconds between orders
      if (botInstance.lastOrderTime) {
        const timeSinceOrder = Date.now() - new Date(botInstance.lastOrderTime).getTime()
        if (timeSinceOrder < ORDER_COOLDOWN_MS) {
          const waitSecs = Math.ceil((ORDER_COOLDOWN_MS - timeSinceOrder) / 1000)
          console.log(`⏳ [IOC] Order cooldown: waiting ${waitSecs}s for previous order to settle...`)
          return {
            success: true,
            txHash: 'cooldown',
            volumeGenerated: 0,
            direction: isLong ? 'long' : 'short',
            size: 0,
          }
        }
      }

      // Also check TWAP cooldown (legacy, for pending TWAPs)
      const TWAP_COOLDOWN_MS = 30 * 1000 // 30 seconds
      if (botInstance.lastTwapOrderTime) {
        const timeSinceTwap = Date.now() - new Date(botInstance.lastTwapOrderTime).getTime()
        if (timeSinceTwap < TWAP_COOLDOWN_MS) {
          const waitSecs = Math.ceil((TWAP_COOLDOWN_MS - timeSinceTwap) / 1000)
          console.log(`⏳ [IOC] TWAP cooldown: waiting ${waitSecs}s...`)
          return {
            success: true,
            txHash: 'cooldown',
            volumeGenerated: 0,
            direction: isLong ? 'long' : 'short',
            size: 0,
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // SCENARIO: No position - open new position with IOC + TP/SL
      // ═══════════════════════════════════════════════════════════════════

      const entryPrice = await this.getCurrentMarketPrice()

      // ═══════════════════════════════════════════════════════════════════
      // MOMENTUM CHECK: Log momentum but DON'T block entries
      // We want to trade actively, momentum is just informational
      // ═══════════════════════════════════════════════════════════════════
      const momentum = this.getMomentumSignal(entryPrice)
      const wantedDirection = isLong ? 'long' : 'short'

      console.log(`\n📊 [Momentum] Signal: ${momentum.signal} (${momentum.changePercent.toFixed(4)}% change)`)
      console.log(`   Direction: ${wantedDirection.toUpperCase()}`)

      // NOTE: Momentum check disabled - we want active trading, not sitting on sidelines
      // If you want conservative entries, re-enable the shouldEnter check below
      // const { shouldEnter, reason } = this.shouldEnterBasedOnMomentum(wantedDirection, momentum)
      // if (!shouldEnter) { return { success: true, txHash: 'momentum_skip', ... } }

      console.log(`\n🎰 [IOC] Opening ${isLong ? 'LONG' : 'SHORT'} position with IOC...`)
      const maxLeverage = this.getMarketMaxLeverage()
      const pxDecimals = this.getMarketConfig().pxDecimals
      const sizeDecimals = this.getMarketSizeDecimals()

      // Calculate position size
      const capitalToUse = this.config.capitalUSDC * CAPITAL_USAGE_PCT
      const notionalUSD = capitalToUse * maxLeverage
      const sizeInBaseAsset = notionalUSD / entryPrice
      const rawSize = Math.floor(sizeInBaseAsset * Math.pow(10, sizeDecimals))
      const positionSize = Number(this.roundSizeToLotSize(rawSize))

      // Calculate aggressive IOC price (to ensure fill)
      const iocPrice = isLong
        ? entryPrice * (1 + IOC_SLIPPAGE_PCT)
        : entryPrice * (1 - IOC_SLIPPAGE_PCT)

      // Calculate TP/SL prices
      const tpPrice = isLong
        ? entryPrice * (1 + PROFIT_TARGET_PCT)
        : entryPrice * (1 - PROFIT_TARGET_PCT)
      const slPrice = isLong
        ? entryPrice * (1 - STOP_LOSS_PCT)
        : entryPrice * (1 + STOP_LOSS_PCT)

      // Convert all prices to chain units
      const iocPriceChain = Math.floor(iocPrice * Math.pow(10, pxDecimals))
      const tpPriceChain = Math.floor(tpPrice * Math.pow(10, pxDecimals))
      const slPriceChain = Math.floor(slPrice * Math.pow(10, pxDecimals))

      console.log(`   Market: ${this.config.marketName}, Leverage: ${maxLeverage}x`)
      console.log(`   Capital: $${capitalToUse.toFixed(2)}, Notional: $${notionalUSD.toFixed(2)}`)
      console.log(`   Size: ${positionSize} (${sizeInBaseAsset.toFixed(6)} ${this.config.marketName.split('/')[0]})`)
      console.log(`   IOC Price: $${iocPrice.toFixed(2)} (${IOC_SLIPPAGE_PCT * 100}% slippage)`)
      console.log(`   TP: $${tpPrice.toFixed(2)} (+${(PROFIT_TARGET_PCT * 100).toFixed(3)}%)`)
      console.log(`   SL: $${slPrice.toFixed(2)} (-${(STOP_LOSS_PCT * 100).toFixed(3)}%)`)

      // Place IOC order with attached TP/SL using SDK
      const writeDex = getWriteDex()

      // CRITICAL: Update lastOrderTime BEFORE placing order to prevent race conditions
      // This ensures any concurrent tick will see we just placed an order
      await prisma.botInstance.update({
        where: { id: botInstance.id },
        data: { lastOrderTime: new Date() }
      })

      try {
        const result = await writeDex.placeOrder({
          marketName: this.config.marketName,
          price: iocPriceChain,
          size: positionSize,
          isBuy: isLong,
          timeInForce: TimeInForce.ImmediateOrCancel,
          isReduceOnly: false,
          // Attach TP/SL directly to the order!
          tpTriggerPrice: tpPriceChain,
          tpLimitPrice: tpPriceChain,
          slTriggerPrice: slPriceChain,
          slLimitPrice: slPriceChain,
          subaccountAddr: this.config.userSubaccount,
        })

        if (result.success) {
          console.log(`✅ [IOC] Order placed! TX: ${result.transactionHash.slice(0, 20)}...`)
          console.log(`   Order ID: ${result.orderId || 'pending'}`)

          // Wait a moment then check if order filled
          await new Promise(r => setTimeout(r, 2000))

          // Check on-chain position to verify fill
          const newPosition = await this.getOnChainPosition()

          if (newPosition && newPosition.size > 0) {
            // IOC FILLED! Update DB
            console.log(`🎯 [IOC] FILLED! Position opened at ~$${newPosition.entryPrice.toFixed(2)}`)

            await prisma.botInstance.update({
              where: { id: botInstance.id },
              data: {
                activePositionSize: newPosition.size,
                activePositionIsLong: isLong,
                activePositionEntry: newPosition.entryPrice,
                activePositionTxHash: result.transactionHash,
              }
            })

            // Position opened - don't count volume yet (count on close)
            return {
              success: true,
              txHash: result.transactionHash,
              volumeGenerated: 0, // Count on close only
              direction: isLong ? 'long' : 'short',
              size: newPosition.size,
              entryPrice: newPosition.entryPrice,
            }
          } else {
            // IOC didn't fill - no position created
            console.log(`⚠️ [IOC] No fill - order likely cancelled (no liquidity)`)

            if (USE_TWAP_FALLBACK) {
              console.log(`📊 [IOC] Falling back to TWAP...`)
              return await this.placeHighRiskTwapFallback(isLong, positionSize, entryPrice)
            }

            return {
              success: false,
              txHash: result.transactionHash,
              volumeGenerated: 0,
              direction: isLong ? 'long' : 'short',
              size: 0,
              error: 'IOC order not filled - no liquidity',
            }
          }
        } else {
          // SDK returned error
          console.error(`❌ [IOC] Order failed:`, result.error)

          if (USE_TWAP_FALLBACK) {
            console.log(`📊 [IOC] Falling back to TWAP...`)
            return await this.placeHighRiskTwapFallback(isLong, positionSize, entryPrice)
          }

          return {
            success: false,
            txHash: '',
            volumeGenerated: 0,
            direction: isLong ? 'long' : 'short',
            size: 0,
            error: result.error,
          }
        }
      } catch (sdkError) {
        console.error(`❌ [IOC] SDK error:`, sdkError)

        if (USE_TWAP_FALLBACK) {
          console.log(`📊 [IOC] Falling back to TWAP after error...`)
          return await this.placeHighRiskTwapFallback(isLong, positionSize, entryPrice)
        }

        throw sdkError
      }
    } catch (error) {
      console.error('❌ [IOC] High risk order failed:', error)
      return {
        success: false,
        txHash: '',
        volumeGenerated: 0,
        direction: isLong ? 'long' : 'short',
        size: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Force close position with IOC order
   * Used when volume target reached or TP/SL should have triggered
   */
  private async forceClosePositionWithIOC(
    position: { size: number; isLong: boolean; entryPrice: number }
  ): Promise<OrderResult> {
    const IOC_SLIPPAGE_PCT = 0.03 // 3% slippage for force close

    try {
      const { getWriteDex } = await import('./decibel-sdk')
      const { prisma } = await import('./prisma')

      const currentPrice = await this.getCurrentMarketPrice()
      const pxDecimals = this.getMarketConfig().pxDecimals
      const sizeDecimals = this.getMarketSizeDecimals()

      // Close direction is opposite of position
      const closeIsLong = !position.isLong

      // Aggressive price to ensure fill
      const closePrice = closeIsLong
        ? currentPrice * (1 + IOC_SLIPPAGE_PCT)
        : currentPrice * (1 - IOC_SLIPPAGE_PCT)
      const closePriceChain = Math.floor(closePrice * Math.pow(10, pxDecimals))

      console.log(`\n📝 [IOC] Force closing ${position.isLong ? 'LONG' : 'SHORT'} position...`)
      console.log(`   Size: ${position.size}, Close price: $${closePrice.toFixed(2)}`)

      const writeDex = getWriteDex()

      // Cancel existing TP/SL first
      await this.cancelTpSlForPosition()

      // Place IOC close order
      const result = await writeDex.placeOrder({
        marketName: this.config.marketName,
        price: closePriceChain,
        size: position.size,
        isBuy: closeIsLong,
        timeInForce: TimeInForce.ImmediateOrCancel,
        isReduceOnly: true, // Important: reduce only for closing
        subaccountAddr: this.config.userSubaccount,
      })

      if (result.success) {
        console.log(`✅ [IOC] Close order placed! TX: ${result.transactionHash.slice(0, 20)}...`)

        // Wait and check if closed
        await new Promise(r => setTimeout(r, 2000))
        const newPosition = await this.getOnChainPosition()

        if (!newPosition || newPosition.size === 0) {
          // Position closed!
          console.log(`🎯 [IOC] Position CLOSED!`)

          // Calculate PnL and volume
          const positionValueUSD = (position.size / Math.pow(10, sizeDecimals)) * currentPrice
          const pnlPct = position.isLong
            ? (currentPrice - position.entryPrice) / position.entryPrice
            : (position.entryPrice - currentPrice) / position.entryPrice
          const pnlUSD = positionValueUSD * pnlPct

          console.log(`   Volume: $${positionValueUSD.toFixed(2)}`)
          console.log(`   PnL: $${pnlUSD.toFixed(2)} (${(pnlPct * 100).toFixed(3)}%)`)

          // Clear DB position
          const botInstance = await prisma.botInstance.findUnique({
            where: { userWalletAddress: this.config.userWalletAddress }
          })
          if (botInstance) {
            await prisma.botInstance.update({
              where: { id: botInstance.id },
              data: {
                activePositionSize: null,
                activePositionIsLong: null,
                activePositionEntry: null,
                activePositionTxHash: null,
              }
            })
          }

          return {
            success: true,
            txHash: result.transactionHash,
            volumeGenerated: positionValueUSD,
            direction: closeIsLong ? 'long' : 'short',
            size: position.size,
            entryPrice: position.entryPrice,
            exitPrice: currentPrice,
            pnl: pnlUSD,
          }
        } else {
          // IOC close didn't fill - try TWAP
          console.log(`⚠️ [IOC] Close didn't fill, falling back to TWAP close...`)
          return await this.closePositionWithTwap(position)
        }
      } else {
        console.error(`❌ [IOC] Close failed:`, result.error)
        return await this.closePositionWithTwap(position)
      }
    } catch (error) {
      console.error('❌ [IOC] Force close failed:', error)
      return await this.closePositionWithTwap(position)
    }
  }

  /**
   * Close position with TWAP (fallback when IOC doesn't work)
   */
  private async closePositionWithTwap(
    position: { size: number; isLong: boolean; entryPrice: number }
  ): Promise<OrderResult> {
    console.log(`\n📝 [TWAP] Closing position with TWAP fallback...`)

    const closeDirection = !position.isLong
    const currentPrice = await this.getCurrentMarketPrice()
    const sizeDecimals = this.getMarketSizeDecimals()

    const transaction = await this.aptos.transaction.build.simple({
      sender: this.botAccount.accountAddress,
      data: {
        function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          this.config.userSubaccount,
          this.config.market,
          position.size.toString(),
          closeDirection,
          true,  // reduce_only
          60,    // min duration
          120,   // max duration
          undefined,
          undefined,
        ],
      },
    })

    const committedTxn = await this.aptos.signAndSubmitTransaction({
      signer: this.botAccount,
      transaction,
    })

    await this.aptos.waitForTransaction({ transactionHash: committedTxn.hash })

    console.log(`✅ [TWAP] Close order submitted: ${committedTxn.hash.slice(0, 20)}...`)

    // Track TWAP time for cooldown
    const { prisma } = await import('./prisma')
    const botInstance = await prisma.botInstance.findUnique({
      where: { userWalletAddress: this.config.userWalletAddress }
    })
    if (botInstance) {
      await prisma.botInstance.update({
        where: { id: botInstance.id },
        data: { lastTwapOrderTime: new Date() }
      })
    }

    // Volume will be counted when TWAP fills
    const positionValueUSD = (position.size / Math.pow(10, sizeDecimals)) * currentPrice

    return {
      success: true,
      txHash: committedTxn.hash,
      volumeGenerated: positionValueUSD,
      direction: closeDirection ? 'short' : 'long',
      size: position.size,
      entryPrice: position.entryPrice,
    }
  }

  /**
   * TWAP fallback for opening position when IOC doesn't fill
   */
  private async placeHighRiskTwapFallback(
    isLong: boolean,
    size: number,
    entryPrice: number
  ): Promise<OrderResult> {
    console.log(`\n📝 [TWAP] Opening position with TWAP fallback...`)

    const transaction = await this.aptos.transaction.build.simple({
      sender: this.botAccount.accountAddress,
      data: {
        function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          this.config.userSubaccount,
          this.config.market,
          size.toString(),
          isLong,
          false, // reduce_only
          60,    // min duration
          120,   // max duration
          undefined,
          undefined,
        ],
      },
    })

    const committedTxn = await this.aptos.signAndSubmitTransaction({
      signer: this.botAccount,
      transaction,
    })

    await this.aptos.waitForTransaction({ transactionHash: committedTxn.hash })

    console.log(`✅ [TWAP] Order submitted: ${committedTxn.hash.slice(0, 20)}...`)

    // Update DB with TWAP tracking
    const { prisma } = await import('./prisma')
    const botInstance = await prisma.botInstance.findUnique({
      where: { userWalletAddress: this.config.userWalletAddress }
    })
    if (botInstance) {
      await prisma.botInstance.update({
        where: { id: botInstance.id },
        data: {
          activePositionSize: size,
          activePositionIsLong: isLong,
          activePositionEntry: entryPrice,
          activePositionTxHash: committedTxn.hash,
          lastTwapOrderTime: new Date(),
        }
      })
    }

    return {
      success: true,
      txHash: committedTxn.hash,
      volumeGenerated: 0, // Count on close
      direction: isLong ? 'long' : 'short',
      size: size,
      entryPrice: entryPrice,
    }
  }

  /**
   * HIGH RISK HFT STRATEGY (LEGACY - TWAP based)
   *
   * Uses IOC (Immediate Or Cancel) limit orders for INSTANT execution:
   * 1. Opens position with IOC order (fills in ~1 second)
   * 2. Monitors BOT'S OWN position for profit target or stop-loss
   * 3. Closes with IOC order when target hit (instant)
   *
   * IMPORTANT: Tracks bot's own positions in database so it doesn't interfere
   * with user's manual trades!
   *
   * Risk parameters:
   * - Uses MAX leverage for the market
   * - Uses significant portion of capital (configurable)
   * - Profit target: +0.15% price move
   * - Stop loss: -0.1% price move
   * - 2% slippage tolerance for guaranteed fills
   */
  private async placeHighRiskOrder(
    size: number,
    isLong: boolean
  ): Promise<OrderResult> {
    const orderStartTime = Date.now()
    // 10% slippage for testnet - liquidity is extremely thin
    // This is essentially a market order - we just want to get filled
    const SLIPPAGE_PCT = 0.10

    try {
      // Check if BOT has an active position (from database, NOT on-chain)
      // This ensures we don't interfere with user's manual trades
      const { prisma } = await import('./prisma')
      const botInstance = await prisma.botInstance.findUnique({
        where: { userWalletAddress: this.config.userWalletAddress }
      })

      if (!botInstance) {
        throw new Error('Bot instance not found in database')
      }

      // CRITICAL: FIRST check on-chain position BEFORE cooldown check
      // This prevents opening new positions when one already exists
      const onChainPosition = await this.getOnChainPosition()

      // If there's an on-chain position, we should ONLY monitor it, never open more
      if (onChainPosition && onChainPosition.size > 0) {
        console.log(`📊 On-chain position exists: ${onChainPosition.size} (${onChainPosition.isLong ? 'LONG' : 'SHORT'})`)
        // Continue to monitoring logic below - don't check cooldown
      } else {
        // No position - check if we recently sent a TWAP order - wait for it to fill (3 min max)
        const TWAP_COOLDOWN_MS = 3 * 60 * 1000 // 3 minutes (increased from 2)
        if (botInstance.lastTwapOrderTime) {
          const timeSinceTwap = Date.now() - new Date(botInstance.lastTwapOrderTime).getTime()
          if (timeSinceTwap < TWAP_COOLDOWN_MS) {
            const waitSecs = Math.ceil((TWAP_COOLDOWN_MS - timeSinceTwap) / 1000)
            console.log(`⏳ TWAP cooldown: waiting ${waitSecs}s for previous TWAP to fill...`)
            return {
              success: true,
              txHash: 'cooldown',
              volumeGenerated: 0,
              direction: isLong ? 'long' : 'short',
              size: 0,
            }
          }
        }
      }

      // If on-chain has a position but database doesn't, sync it
      if (onChainPosition && onChainPosition.size > 0) {
        if (botInstance.activePositionSize === null || botInstance.activePositionSize === 0) {
          console.log(`⚠️ Position sync: Found on-chain position not in DB, syncing...`)
          await prisma.botInstance.update({
            where: { id: botInstance.id },
            data: {
              activePositionSize: onChainPosition.size,
              activePositionIsLong: onChainPosition.isLong,
              activePositionEntry: onChainPosition.entryPrice,
            }
          })

          // NEW: Place TP/SL orders for the position using SDK
          // This provides automatic on-chain exit triggers
          console.log(`📊 [SDK] Attempting to place TP/SL for new position...`)
          await this.cancelTpSlForPosition()  // Cancel any existing TP/SL first (max 10 limit)
          await this.placeTpSlForPosition(
            onChainPosition.entryPrice,
            onChainPosition.size,
            onChainPosition.isLong
          )
        }
      }

      console.log(`\n🎰 [HFT] Position check:`)
      console.log(`   DB position: ${botInstance.activePositionSize || 0}`)
      console.log(`   On-chain position: ${onChainPosition?.size || 0}`)
      console.log(`   Direction: ${onChainPosition?.isLong ? 'LONG' : 'SHORT'}`)
      console.log(`   Entry: $${onChainPosition?.entryPrice?.toFixed(2) || 'N/A'}`)

      // Use on-chain position as source of truth
      const hasPosition = onChainPosition && onChainPosition.size > 0
      if (hasPosition) {
        const positionSize = onChainPosition.size
        const positionIsLong = onChainPosition.isLong
        const positionEntry = onChainPosition.entryPrice

        // Check if position matches desired bias - if not, FORCE CLOSE it
        const biasMismatch = this.config.bias !== 'neutral' && positionIsLong !== (this.config.bias === 'long')
        if (biasMismatch) {
          console.log(`⚠️ Position direction (${positionIsLong ? 'LONG' : 'SHORT'}) doesn't match bias (${this.config.bias.toUpperCase()})`)
          console.log(`   FORCE CLOSING with TWAP to open correct direction...`)

          // Force close regardless of PnL using TWAP (IOC has no liquidity on testnet)
          const currentPrice = await this.getCurrentMarketPrice()
          const closeDirection = !positionIsLong
          const sizeDecimals = this.getMarketSizeDecimals()

          console.log(`   Closing with TWAP: size=${positionSize}, direction=${closeDirection ? 'SHORT' : 'LONG'}`)

          const closeTransaction = await this.aptos.transaction.build.simple({
            sender: this.botAccount.accountAddress,
            data: {
              function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
              typeArguments: [],
              functionArguments: [
                this.config.userSubaccount,
                this.config.market,
                positionSize.toString(),  // size
                closeDirection,           // is_long
                true,                     // reduce_only: TRUE for closing
                60,                       // min duration: 1 minute
                120,                      // max duration: 2 minutes
                undefined,                // builder_address
                undefined,                // max_builder_fee
              ],
            },
          })

          const closeCommittedTxn = await this.aptos.signAndSubmitTransaction({
            signer: this.botAccount,
            transaction: closeTransaction,
          })

          await this.aptos.waitForTransaction({ transactionHash: closeCommittedTxn.hash })

          // Clear DB and track TWAP time - next tick will check if position closed
          await prisma.botInstance.update({
            where: { id: botInstance.id },
            data: {
              activePositionSize: null,
              activePositionIsLong: null,
              activePositionEntry: null,
              activePositionTxHash: null,
              lastTwapOrderTime: new Date(),
            }
          })

          const positionValueUSD = (positionSize / Math.pow(10, sizeDecimals)) * currentPrice
          const priceChange = positionIsLong
            ? (currentPrice - positionEntry) / positionEntry
            : (positionEntry - currentPrice) / positionEntry
          const pnl = positionValueUSD * priceChange

          console.log(`   ✅ TWAP close submitted for wrong-direction position. Expected PnL: $${pnl.toFixed(2)}`)
          console.log(`   ⏳ TWAP will fill over 1-2 minutes. Next tick will open ${this.config.bias.toUpperCase()} position.`)

          return {
            success: true,
            txHash: closeCommittedTxn.hash,
            volumeGenerated: positionValueUSD,
            direction: closeDirection ? 'short' : 'long',
            size: positionSize,
            entryPrice: positionEntry,
            exitPrice: currentPrice,
            pnl,
            positionHeldMs: 0,
          }
        }

        console.log(`\n📊 [HFT] Bot's ${positionIsLong ? 'LONG' : 'SHORT'} position`)
        console.log(`   Size: ${positionSize}, Entry: $${positionEntry.toFixed(2)}`)

        const currentPrice = await this.getCurrentMarketPrice()
        const priceChange = positionIsLong
          ? (currentPrice - positionEntry) / positionEntry
          : (positionEntry - currentPrice) / positionEntry

        const priceChangePercent = priceChange * 100
        console.log(`   Current: $${currentPrice.toFixed(2)}, PnL: ${priceChangePercent.toFixed(3)}%`)

        // Check if volume target reached - if so, FORCE CLOSE regardless of PNL
        const volumeTargetReached = botInstance.cumulativeVolume >= botInstance.volumeTargetUSDC
        if (volumeTargetReached) {
          console.log(`🎯 VOLUME TARGET REACHED! Force closing position...`)
          console.log(`   Volume: $${botInstance.cumulativeVolume.toFixed(2)} / $${botInstance.volumeTargetUSDC}`)
        }

        // Scalping strategy: take small profits consistently, cut losses before they grow
        // With 40x leverage, small price moves = big PnL swings
        // We use PRICE CHANGE targets, not leveraged PnL:
        //   +0.03% price × 40x = +1.2% leveraged profit
        //   -0.02% price × 40x = -0.8% leveraged loss (tighter stop to protect capital!)
        const PROFIT_TARGET = 0.0003  // 0.03% price move = +1.2% leveraged profit
        const STOP_LOSS = -0.0002    // -0.02% price move = -0.8% leveraged loss (MUCH TIGHTER!)

        // Close if: profit target, stop loss, OR volume target reached (force close)
        if (priceChange >= PROFIT_TARGET || priceChange <= STOP_LOSS || volumeTargetReached) {
          const isProfit = priceChange >= PROFIT_TARGET
          if (volumeTargetReached && priceChange < PROFIT_TARGET && priceChange > STOP_LOSS) {
            console.log(`🎯 FORCE CLOSE (volume target)! Closing at ${priceChangePercent.toFixed(3)}%`)
          } else {
            console.log(isProfit
              ? `🎯 PROFIT TARGET! Closing for +${priceChangePercent.toFixed(3)}%`
              : `🛑 STOP LOSS! Closing for ${priceChangePercent.toFixed(3)}%`)
          }

          // Close with TWAP - IOC has NO LIQUIDITY on testnet!
          // TWAP will fill over 1-2 minutes, which is much better than IOC that doesn't fill at all
          const closeDirection = !positionIsLong // Opposite direction to close
          const sizeDecimals = this.getMarketSizeDecimals()

          console.log(`   Closing with TWAP: size=${positionSize}, direction=${closeDirection ? 'SHORT' : 'LONG'}`)
          console.log(`   TWAP will fill over 1-2 minutes (IOC has no liquidity on testnet)`)

          // Use TWAP order for guaranteed close - IOC simply doesn't work on testnet
          const closeTransaction = await this.aptos.transaction.build.simple({
            sender: this.botAccount.accountAddress,
            data: {
              function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
              typeArguments: [],
              functionArguments: [
                this.config.userSubaccount,
                this.config.market,
                positionSize.toString(),       // size
                closeDirection,                // is_long (opposite to close)
                true,                          // reduce_only: TRUE for closing positions
                60,                            // min duration: 1 minute
                120,                           // max duration: 2 minutes
                undefined,                     // builder_address
                undefined,                     // max_builder_fee
              ],
            },
          })

          const closeCommittedTxn = await this.aptos.signAndSubmitTransaction({
            signer: this.botAccount,
            transaction: closeTransaction,
          })

          console.log(`   TX: ${closeCommittedTxn.hash.slice(0, 20)}...`)

          const closeExecutedTxn = await this.aptos.waitForTransaction({
            transactionHash: closeCommittedTxn.hash,
          })

          if (!closeExecutedTxn.success) {
            throw new Error(`Close TWAP order failed: ${closeExecutedTxn.vm_status}`)
          }

          console.log(`✅ CLOSE TWAP SUBMITTED! Waiting for it to fill...`)

          // Calculate volume and PnL
          const positionValueUSD = (positionSize / Math.pow(10, sizeDecimals)) * currentPrice
          const estimatedPnl = positionValueUSD * priceChange
          const maxLeverage = this.getMarketMaxLeverage()
          const leveragedPnlPercent = priceChangePercent * maxLeverage

          console.log(`   Expected PnL: $${estimatedPnl.toFixed(2)} (${leveragedPnlPercent.toFixed(2)}% with ${maxLeverage}x)`)

          // CRITICAL: Wait for the TWAP to fully fill before returning
          // Poll on-chain position until it's closed (max 3 minutes)
          const closeStartTime = Date.now()
          const MAX_WAIT_MS = 3 * 60 * 1000 // 3 minutes
          let positionClosed = false

          while (Date.now() - closeStartTime < MAX_WAIT_MS) {
            await new Promise(r => setTimeout(r, 10000)) // Wait 10 seconds between checks

            const currentPos = await this.getOnChainPosition()
            if (!currentPos || currentPos.size === 0) {
              console.log(`✅ Position fully closed!`)
              positionClosed = true
              break
            }

            const remainingSize = currentPos.size
            const remainingPct = (remainingSize / positionSize) * 100
            console.log(`   TWAP filling... ${remainingPct.toFixed(1)}% remaining (${remainingSize} units)`)
          }

          if (!positionClosed) {
            console.log(`⚠️ Close TWAP still filling after 3 min. Will check again next tick.`)
            // Don't clear DB - position still exists
            await prisma.botInstance.update({
              where: { id: botInstance.id },
              data: {
                lastTwapOrderTime: new Date(),  // Track close time for cooldown
              }
            })
            return {
              success: true,
              txHash: closeCommittedTxn.hash,
              volumeGenerated: 0,  // Don't count volume until fully closed
              direction: closeDirection ? 'short' : 'long',
              size: positionSize,
              entryPrice: positionEntry,
              pnl: 0,
            }
          }

          // Position fully closed - clear DB and return success
          await prisma.botInstance.update({
            where: { id: botInstance.id },
            data: {
              activePositionSize: null,
              activePositionIsLong: null,
              activePositionEntry: null,
              activePositionTxHash: null,
              lastTwapOrderTime: new Date(),
            }
          })

          return {
            success: true,
            txHash: closeCommittedTxn.hash,
            volumeGenerated: positionValueUSD,
            direction: closeDirection ? 'short' : 'long',
            size: positionSize,
            entryPrice: positionEntry,
            exitPrice: currentPrice,
            pnl: estimatedPnl,
            positionHeldMs: Date.now() - orderStartTime,
          }
        } else {
          // Still waiting for target
          const needMore = ((PROFIT_TARGET - priceChange) * 100).toFixed(3)
          console.log(`⏳ Waiting... need ${needMore}% more for profit target`)
          return {
            success: true,
            txHash: 'waiting',
            volumeGenerated: 0,
            direction: positionIsLong ? 'long' : 'short',
            size: positionSize,
            entryPrice: positionEntry,
            pnl: 0,
          }
        }
      }

      // No BOT position - OPEN NEW POSITION with TWAP (testnet has no IOC liquidity)
      console.log(`\n🎰 [HFT] Opening ${isLong ? 'LONG' : 'SHORT'} position with TWAP...`)

      const entryPrice = await this.getCurrentMarketPrice()
      const maxLeverage = this.getMarketMaxLeverage()

      // Use 80% of capital for YOLO
      const capitalToUse = this.config.capitalUSDC * 0.8

      // Calculate size properly
      const sizeDecimals = this.getMarketSizeDecimals()
      const notionalUSD = capitalToUse * maxLeverage
      const sizeInBaseAsset = notionalUSD / entryPrice
      const rawSize = Math.floor(sizeInBaseAsset * Math.pow(10, sizeDecimals))
      const contractSize = this.roundSizeToLotSize(rawSize)

      console.log(`   Market: ${this.config.marketName}, Price: $${entryPrice.toFixed(2)}`)
      console.log(`   Capital: $${capitalToUse.toFixed(2)}, Leverage: ${maxLeverage}x`)
      console.log(`   Notional: $${notionalUSD.toFixed(2)} → ${sizeInBaseAsset.toFixed(6)} ${this.config.marketName.split('/')[0]}`)
      console.log(`   Size: ${contractSize}`)
      console.log(`   Order type: TWAP (1-2 min fill)`)

      // Use TWAP order - testnet has no IOC liquidity
      const transaction = await this.aptos.transaction.build.simple({
        sender: this.botAccount.accountAddress,
        data: {
          function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
          typeArguments: [],
          functionArguments: [
            this.config.userSubaccount,
            this.config.market,
            contractSize.toString(),      // size
            isLong,                        // is_long
            false,                         // reduce_only: false for opening
            60,                            // min duration: 1 minute
            120,                           // max duration: 2 minutes
            undefined,                     // builder_address
            undefined,                     // max_builder_fee
          ],
        },
      })

      const committedTxn = await this.aptos.signAndSubmitTransaction({
        signer: this.botAccount,
        transaction,
      })

      console.log(`   TX: ${committedTxn.hash.slice(0, 20)}...`)

      const executedTxn = await this.aptos.waitForTransaction({
        transactionHash: committedTxn.hash,
      })

      if (!executedTxn.success) {
        throw new Error(`TWAP order failed: ${executedTxn.vm_status}`)
      }

      console.log(`✅ TWAP OPEN SUBMITTED! Will fill over 1-2 minutes.`)

      // Save bot's expected position to database (TWAP will fill it)
      const contractSizeNum = Number(contractSize)
      await prisma.botInstance.update({
        where: { id: botInstance.id },
        data: {
          activePositionSize: contractSizeNum,
          activePositionIsLong: isLong,
          activePositionEntry: entryPrice,
          activePositionTxHash: committedTxn.hash,
          lastTwapOrderTime: new Date(),  // Track TWAP time for cooldown
        }
      })

      // DON'T count volume on OPEN - only count when position CLOSES
      // This ensures we don't prematurely hit volume target
      // The close will count the full round-trip volume
      console.log(`   Position value: ~$${((contractSizeNum / Math.pow(10, sizeDecimals)) * entryPrice).toFixed(0)} (counted on close)`)

      return {
        success: true,
        txHash: committedTxn.hash,
        volumeGenerated: 0,  // Don't count volume on open
        direction: isLong ? 'long' : 'short',
        size: contractSizeNum,
        entryPrice: entryPrice,
        pnl: 0,
        positionHeldMs: 0,
      }
    } catch (error) {
      console.error('❌ HFT order failed:', error)
      return {
        success: false,
        txHash: '',
        volumeGenerated: 0,
        direction: isLong ? 'long' : 'short',
        size: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * TX Spammer strategy - spam TWAP orders as fast as possible
   * Uses ~$500 notional per order for faster volume generation
   * Goal: Maximum transaction count AND reasonable volume per tx
   */
  private async placeTxSpammerOrder(isLong: boolean): Promise<OrderResult> {
    try {
      console.log(`\n⚡ [TX SPAMMER] Placing fast TWAP order...`)

      const currentPrice = await this.getCurrentMarketPrice()
      const sizeDecimals = this.getMarketSizeDecimals()
      const marketConfig = this.getMarketConfig()

      // Target ~$500 notional per order for faster volume
      // This balances speed with volume generation
      const targetNotionalUSD = 500
      const rawSizeInBaseAsset = targetNotionalUSD / currentPrice
      const rawContractSize = Math.floor(rawSizeInBaseAsset * Math.pow(10, sizeDecimals))

      // Round to lot size and ensure minimum
      const contractSize = Math.max(
        Number(this.roundSizeToLotSize(rawContractSize)),
        Number(marketConfig.minSize)
      )

      // Calculate actual notional value for logging
      const sizeInBaseAsset = contractSize / Math.pow(10, sizeDecimals)
      const notionalUSD = sizeInBaseAsset * currentPrice

      console.log(`   Size: ${contractSize} (${sizeInBaseAsset.toFixed(6)} ${this.config.marketName.split('/')[0]})`)
      console.log(`   Notional: ~$${notionalUSD.toFixed(2)}`)
      console.log(`   Direction: ${isLong ? 'LONG' : 'SHORT'}`)

      // Use shortest possible TWAP (60-120 seconds)
      const transaction = await this.aptos.transaction.build.simple({
        sender: this.botAccount.accountAddress,
        data: {
          function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
          typeArguments: [],
          functionArguments: [
            this.config.userSubaccount,
            this.config.market,
            contractSize.toString(),
            isLong,
            false,     // reduce_only
            60,        // min duration: 1 minute (minimum)
            120,       // max duration: 2 minutes
            undefined, // builder_address
            undefined, // max_builder_fee
          ],
        },
      })

      const committedTxn = await this.aptos.signAndSubmitTransaction({
        signer: this.botAccount,
        transaction,
      })

      console.log(`✅ TX SPAM order submitted: ${committedTxn.hash}`)

      const executedTxn = await this.aptos.waitForTransaction({
        transactionHash: committedTxn.hash,
      })

      if (!executedTxn.success) {
        throw new Error(`TX spam order failed: ${executedTxn.vm_status}`)
      }

      console.log(`⚡ TX SPAMMED! Notional: $${notionalUSD.toFixed(2)}`)

      return {
        success: true,
        txHash: committedTxn.hash,
        volumeGenerated: notionalUSD,
        direction: isLong ? 'long' : 'short',
        size: contractSize,
        entryPrice: currentPrice,
        pnl: 0,
        positionHeldMs: 0,
      }
    } catch (error) {
      console.error('❌ TX spam order failed:', error)
      return {
        success: false,
        txHash: '',
        volumeGenerated: 0,
        direction: isLong ? 'long' : 'short',
        size: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Close position with TWAP order (IOC has no liquidity on testnet)
   */
  private async closePositionWithMarketOrder(
    size: number,
    isLong: boolean
  ): Promise<OrderResult> {
    try {
      // To close a long, place a short order (and vice versa)
      const closeDirection = !isLong

      console.log(`\n📝 [CLOSE] Closing ${isLong ? 'LONG' : 'SHORT'} position with TWAP...`)
      console.log(`   Size: ${size}, Direction: ${closeDirection ? 'SHORT' : 'LONG'} (to close)`)

      const currentPrice = await this.getCurrentMarketPrice()
      console.log(`   Current: $${currentPrice.toFixed(4)}`)
      console.log(`   Order type: TWAP (1-2 min fill - IOC has no liquidity on testnet)`)

      // Use TWAP order for guaranteed close
      const transaction = await this.aptos.transaction.build.simple({
        sender: this.botAccount.accountAddress,
        data: {
          function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
          typeArguments: [],
          functionArguments: [
            this.config.userSubaccount,
            this.config.market,
            size.toString(),           // size
            closeDirection,            // is_long (opposite to close)
            true,                      // reduce_only: TRUE for closing
            60,                        // min duration: 1 minute
            120,                       // max duration: 2 minutes
            undefined,                 // builder_address
            undefined,                 // max_builder_fee
          ],
        },
      })

      const committedTxn = await this.aptos.signAndSubmitTransaction({
        signer: this.botAccount,
        transaction,
      })

      console.log(`✅ Close TWAP submitted: ${committedTxn.hash}`)

      const executedTxn = await this.aptos.waitForTransaction({
        transactionHash: committedTxn.hash,
      })

      if (!executedTxn.success) {
        throw new Error(`Close TWAP order failed: ${executedTxn.vm_status}`)
      }

      console.log(`✅ Position will close over 1-2 minutes!`)

      return {
        success: true,
        txHash: committedTxn.hash,
        volumeGenerated: 0,
        direction: closeDirection ? 'short' : 'long',
        size: size,
      }
    } catch (error) {
      console.error('❌ Close order failed:', error)
      return {
        success: false,
        txHash: '',
        volumeGenerated: 0,
        direction: 'long',
        size: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get max leverage for current market
   */
  private getMarketMaxLeverage(): number {
    const leverageMap: Record<string, number> = {
      'BTC/USD': 40,
      'ETH/USD': 20,
      'SOL/USD': 20,
      'APT/USD': 10,
      'XRP/USD': 3,
      'LINK/USD': 3,
      'AAVE/USD': 3,
      'ENA/USD': 3,
      'HYPE/USD': 3,
    }
    return leverageMap[this.config.marketName] || 10
  }

  /**
   * Get size decimals for current market
   * Uses the szDecimals from MARKET_CONFIG which is based on on-chain sz_precision.decimals
   */
  private getMarketSizeDecimals(): number {
    const config = MARKET_CONFIG[this.config.marketName]
    if (config) {
      return config.szDecimals
    }
    // Fallback for unknown markets
    const decimalsMap: Record<string, number> = {
      'BTC/USD': 8,
      'ETH/USD': 7,
      'SOL/USD': 6,
      'APT/USD': 4,  // Corrected based on on-chain data
      'XRP/USD': 4,
      'LINK/USD': 6,
      'AAVE/USD': 6,
      'ENA/USD': 3,
      'HYPE/USD': 6,
    }
    return decimalsMap[this.config.marketName] || 6
  }

  /**
   * Combine results from delta neutral strategy (2 orders)
   */
  private combineResults(results: OrderResult[]): OrderResult {
    const successfulOrders = results.filter(r => r.success)

    if (successfulOrders.length === 0) {
      return results[0] // Return first error
    }

    // Combine volume from both orders
    const totalVolume = results.reduce((sum, r) => sum + r.volumeGenerated, 0)
    const txHashes = results.map(r => r.txHash).filter(h => h).join(', ')

    return {
      success: true,
      txHash: txHashes,
      volumeGenerated: totalVolume,
      direction: 'neutral' as 'long', // Delta neutral = both directions
      size: results[0].size,
    }
  }

  /**
   * Main bot loop - runs continuously until stopped
   */
  private async runLoop() {
    console.log('\n🔄 Bot loop iteration...')

    // For high_risk strategy, check if we have an open position that needs closing
    // We must close positions before stopping, even if volume target is reached
    if (this.config.strategy === 'high_risk') {
      const { prisma } = await import('./prisma')
      const botInstance = await prisma.botInstance.findUnique({
        where: { userWalletAddress: this.config.userWalletAddress }
      })

      if (botInstance?.activePositionSize && botInstance.activePositionSize > 0) {
        console.log('📊 High risk: Have open position, must monitor/close before stopping')
        // Don't check volume target - proceed to placeHighRiskOrder which will monitor/close
      } else {
        // No open position - safe to check volume target
        if (this.status.cumulativeVolume >= this.config.volumeTargetUSDC) {
          console.log('🎉 Volume target reached! Stopping bot.')
          await this.stop()
          const { botManager } = await import('./bot-manager')
          botManager.deleteBot(this.config.userWalletAddress)
          console.log('🗑️  Removed bot from active bots')
          return
        }
      }
    } else {
      // Non high_risk strategies: normal volume target check
      if (this.status.cumulativeVolume >= this.config.volumeTargetUSDC) {
        console.log('🎉 Volume target reached! Stopping bot.')
        await this.stop()
        const { botManager } = await import('./bot-manager')
        botManager.deleteBot(this.config.userWalletAddress)
        console.log('🗑️  Removed bot from active bots')
        return
      }
    }

    // Calculate next order
    const orderSize = this.calculateOrderSize()
    if (orderSize === 0) {
      console.log('⏸️  No more orders needed')
      await this.stop()
      // Remove from botManager
      const { botManager } = await import('./bot-manager')
      botManager.deleteBot(this.config.userWalletAddress)
      console.log('🗑️  Removed bot from active bots')
      return
    }

    const direction = this.getNextDirection()
    const isLong = direction === 'long'

    // Route to appropriate strategy
    let result: OrderResult
    const { strategy } = this.config

    console.log(`📊 Using strategy: ${strategy.toUpperCase()}`)

    switch (strategy) {
      case 'market_maker':
        result = await this.placeMarketMakerOrder(orderSize, isLong)
        break

      case 'delta_neutral':
        const results = await this.placeDeltaNeutralOrders(orderSize)
        result = this.combineResults(results)
        break

      case 'high_risk':
        // Use new SDK IOC-based strategy for fast entry/exit
        result = await this.placeHighRiskOrderWithIOC(isLong)
        break

      case 'tx_spammer':
        result = await this.placeTxSpammerOrder(isLong)
        break

      case 'twap':
      default:
        result = await this.placeOrder(orderSize, isLong)
        break
    }

    // Add to order history
    const orderRecord: OrderHistory = {
      timestamp: Date.now(),
      txHash: result.txHash,
      direction: result.direction,
      size: result.size,
      volumeGenerated: result.volumeGenerated,
      success: result.success,
      entryPrice: result.entryPrice,
      exitPrice: result.exitPrice,
      pnl: result.pnl,
      positionHeldMs: result.positionHeldMs,
    }
    // Skip recording non-trade results (monitoring/cooldown states)
    // These are status checks, not actual trades
    if (result.txHash === 'waiting' || result.txHash === 'cooldown' || result.txHash === 'monitoring') {
      console.log(`⏳ ${result.txHash === 'monitoring' ? 'Monitoring position (TP/SL active)' : result.txHash === 'waiting' ? 'Waiting for target' : 'TWAP cooldown'}, not recording as trade`)
      return
    }

    // Skip if no volume generated (failed or skipped trades)
    if (!result.volumeGenerated || result.volumeGenerated === 0) {
      console.log('⏭️ No volume generated, skipping trade record')
      return
    }

    console.log(`📝 Recording trade: txHash=${result.txHash?.slice(0, 20)}..., volume=${result.volumeGenerated}, success=${result.success}`)

    this.status.orderHistory.push(orderRecord)

    if (result.success) {
      // Update status
      this.status.cumulativeVolume += result.volumeGenerated
      this.status.ordersPlaced += 1
      this.status.lastOrderTime = Date.now()
      this.status.error = null

      // Persist to database
      try {
        const { prisma } = await import('./prisma')
        console.log(`💾 Looking up bot instance for: ${this.config.userWalletAddress}`)

        // Find bot instance
        const botInstance = await prisma.botInstance.findUnique({
          where: { userWalletAddress: this.config.userWalletAddress }
        })

        console.log(`💾 Bot instance found: ${botInstance ? 'yes' : 'no'}, id: ${botInstance?.id}`)

        if (botInstance) {
          console.log(`💾 Creating order history record...`)
          // Create order history record with session ID
          await prisma.orderHistory.create({
            data: {
              botId: botInstance.id,
              sessionId: botInstance.sessionId,  // Track which session this order belongs to
              txHash: result.txHash,
              direction: result.direction,
              strategy: this.config.strategy || 'twap',
              size: BigInt(result.size || 0),  // Convert to BigInt for Prisma (default 0 if undefined)
              volumeGenerated: result.volumeGenerated,
              success: result.success,
              entryPrice: result.entryPrice,
              exitPrice: result.exitPrice,
              pnl: result.pnl || 0,
              positionHeldMs: result.positionHeldMs || 0,
              market: this.config.marketName,  // Save market name
              leverage: this.getMarketMaxLeverage(),  // Save leverage used
            }
          })

          // Update bot instance status - INCREMENT the database values
          const newCumulativeVolume = botInstance.cumulativeVolume + result.volumeGenerated
          const newOrdersPlaced = botInstance.ordersPlaced + 1

          const updatedBot = await prisma.botInstance.update({
            where: { id: botInstance.id },
            data: {
              cumulativeVolume: newCumulativeVolume,
              ordersPlaced: newOrdersPlaced,
              lastOrderTime: new Date(),
              error: null,
              // Auto-stop if target reached
              isRunning: newCumulativeVolume < botInstance.volumeTargetUSDC,
            }
          })

          // Update local status to match DB
          this.status.cumulativeVolume = newCumulativeVolume
          this.status.ordersPlaced = newOrdersPlaced

          console.log('💾 Order persisted to database')

          // Log if bot was auto-stopped
          if (!updatedBot.isRunning) {
            console.log('🎯 Volume target reached! Bot auto-stopped.')
          }
        }
      } catch (dbError) {
        console.error('⚠️  Failed to persist to database:', dbError)
        console.error('⚠️  Error details:', JSON.stringify(dbError, Object.getOwnPropertyNames(dbError)))

        // CRITICAL: Retry once after a short delay - we don't want to lose trade records!
        console.log('🔄 Retrying database write...')
        try {
          await new Promise(r => setTimeout(r, 1000)) // Wait 1 second
          const { prisma } = await import('./prisma')

          const botInstance = await prisma.botInstance.findUnique({
            where: { userWalletAddress: this.config.userWalletAddress }
          })

          if (botInstance) {
            await prisma.orderHistory.create({
              data: {
                botId: botInstance.id,
                sessionId: botInstance.sessionId,
                txHash: result.txHash,
                direction: result.direction,
                strategy: this.config.strategy || 'twap',
                size: BigInt(result.size || 0),
                volumeGenerated: result.volumeGenerated,
                success: result.success,
                entryPrice: result.entryPrice,
                exitPrice: result.exitPrice,
                pnl: result.pnl || 0,
                positionHeldMs: result.positionHeldMs || 0,
                market: this.config.marketName,
                leverage: this.getMarketMaxLeverage(),
              }
            })

            const newCumulativeVolume = botInstance.cumulativeVolume + result.volumeGenerated
            await prisma.botInstance.update({
              where: { id: botInstance.id },
              data: {
                cumulativeVolume: newCumulativeVolume,
                ordersPlaced: botInstance.ordersPlaced + 1,
                lastOrderTime: new Date(),
              }
            })

            console.log('✅ Retry successful - order persisted to database')
          }
        } catch (retryError) {
          console.error('❌ CRITICAL: Database write failed after retry!')
          console.error('❌ Trade may be lost:', result.txHash)
          console.error('❌ Run backfill script to recover: npx tsx scripts/backfill-trades.ts')
          // Still don't crash the bot, but log prominently
        }
      }

      console.log(`\n📊 Bot Status:`)
      console.log(`Orders placed: ${this.status.ordersPlaced}`)
      console.log(`Cumulative volume: $${this.status.cumulativeVolume.toFixed(2)} / $${this.config.volumeTargetUSDC}`)
      console.log(`Progress: ${((this.status.cumulativeVolume / this.config.volumeTargetUSDC) * 100).toFixed(1)}%`)
    } else {
      this.status.error = result.error || 'Order placement failed'

      // Persist error to database
      try {
        const { prisma } = await import('./prisma')
        await prisma.botInstance.update({
          where: { userWalletAddress: this.config.userWalletAddress },
          data: { error: this.status.error }
        })
      } catch (dbError) {
        console.error('⚠️  Failed to persist error to database:', dbError)
      }

      console.error('⚠️  Order failed, will retry in next cycle')
    }
  }

  /**
   * Get execution interval based on aggressiveness level
   * Aggressiveness scale: 1 (slow) to 10 (ultra fast)
   */
  private getStrategyInterval(): number {
    const aggressiveness = this.config.aggressiveness || 5 // Default to moderate

    // Calculate interval based on aggressiveness
    // Level 1-3: 60-120 seconds (conservative)
    // Level 4-7: 20-60 seconds (moderate)
    // Level 8-10: 10-20 seconds (aggressive HFT)

    if (aggressiveness <= 3) {
      return 120_000 - (aggressiveness * 20_000) // 120s -> 60s
    } else if (aggressiveness <= 7) {
      return 60_000 - ((aggressiveness - 3) * 10_000) // 60s -> 20s
    } else {
      return 20_000 - ((aggressiveness - 7) * 3_333) // 20s -> 10s
    }
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.isActive) {
      console.log('⚠️  Bot already running')
      return
    }

    const intervalMs = this.getStrategyInterval()
    const intervalMins = intervalMs / 60_000

    console.log('\n🚀 Starting Volume Bot...')
    console.log(`Strategy: ${this.config.strategy.toUpperCase()}`)
    console.log(`Interval: ${intervalMins} minute(s)`)
    this.isActive = true
    this.status.isRunning = true

    // Run first iteration immediately
    await this.runLoop()

    // Schedule subsequent iterations based on strategy
    this.loopInterval = setInterval(() => {
      if (this.isActive) {
        this.runLoop()
      }
    }, intervalMs)

    console.log(`✅ Bot started! Will place orders every ${intervalMins} minute(s).`)
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (!this.isActive) {
      console.log('⚠️  Bot already stopped')
      return
    }

    console.log('\n⏹️  Stopping Volume Bot...')
    this.isActive = false
    this.status.isRunning = false

    if (this.loopInterval) {
      clearInterval(this.loopInterval)
      this.loopInterval = null
    }

    // Cancel all active TWAPs and TP/SL orders via SDK
    try {
      console.log('🧹 [SDK] Cleaning up active orders...')
      await this.cancelAllActiveTwapsSDK()
      await this.cancelTpSlForPosition()
      console.log('✅ [SDK] Order cleanup complete')
    } catch (error) {
      console.warn('⚠️ [SDK] Order cleanup failed (non-critical):', error)
    }

    // Update database to mark bot as stopped
    try {
      const { prisma } = await import('./prisma')
      await prisma.botInstance.update({
        where: { userWalletAddress: this.config.userWalletAddress },
        data: { isRunning: false }
      })
      console.log('💾 Database updated: bot marked as stopped')
    } catch (error) {
      console.error('⚠️  Failed to update database:', error)
    }

    console.log('✅ Bot stopped')
  }

  /**
   * Execute a single trade cycle (for cron-based execution)
   * This method can be called by Vercel Cron jobs to place one trade
   */
  async executeSingleTrade(): Promise<boolean> {
    try {
      await this.runLoop()
      return true
    } catch (error) {
      console.error('Error in single trade execution:', error)
      return false
    }
  }

  /**
   * Get current bot status
   */
  getStatus(): BotStatus {
    return { ...this.status }
  }

  /**
   * Get bot configuration
   */
  getConfig(): BotConfig {
    return { ...this.config }
  }
}
