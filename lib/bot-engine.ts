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
  strategy: 'twap' | 'market_maker' | 'delta_neutral' | 'high_risk' // Trading strategy
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

const DECIBEL_PACKAGE = process.env.NEXT_PUBLIC_DECIBEL_PACKAGE ||
  '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'

const MARKETS = {
  'BTC/USD': '0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e',
  'ETH/USD': '0xfaade75b8302ef13835f40c66ee812c3c0c8218549c42c0aebe24d79c27498d2',
}

// Market configuration from on-chain PerpMarketConfig
// ticker_size: minimum price increment (prices must be multiples of this)
// lot_size: minimum size increment (sizes must be multiples of this)
// min_size: minimum order size
const MARKET_CONFIG: Record<string, { tickerSize: bigint; lotSize: bigint; minSize: bigint; pxDecimals: number }> = {
  'BTC/USD': { tickerSize: 100000n, lotSize: 10n, minSize: 100000n, pxDecimals: 9 },
  'ETH/USD': { tickerSize: 100000n, lotSize: 10n, minSize: 100000n, pxDecimals: 9 },
  'SOL/USD': { tickerSize: 10000n, lotSize: 10n, minSize: 10000n, pxDecimals: 9 },
  'APT/USD': { tickerSize: 10000n, lotSize: 10n, minSize: 10000n, pxDecimals: 9 },
}

export class VolumeBotEngine {
  private config: BotConfig
  private status: BotStatus
  private aptos: Aptos
  private botAccount: Account
  private isActive: boolean = false
  private loopInterval: NodeJS.Timeout | null = null

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

    // Initialize Aptos SDK
    const aptosConfig = new AptosConfig({ network: Network.TESTNET })
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
    try {
      // Get price from market's Price resource
      const resources = await this.aptos.getAccountResources({
        accountAddress: this.config.market
      })

      const priceResource = resources.find(r =>
        r.type.includes('price_management::Price')
      )

      if (priceResource && priceResource.data) {
        const data = priceResource.data as { price?: string; last_price?: string }
        const priceRaw = data.price || data.last_price
        if (priceRaw) {
          // Price is stored with 6 decimals
          return parseInt(priceRaw) / 1_000_000
        }
      }
    } catch (error) {
      console.log('⚠️ Could not fetch on-chain price, using fallback')
    }

    // Fallback prices
    const fallbackPrices: Record<string, number> = {
      'BTC/USD': 97000,
      'ETH/USD': 3500,
      'SOL/USD': 240,
      'APT/USD': 12,
    }
    return fallbackPrices[this.config.marketName] || 100000
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
      return {
        hasPosition: true,
        isLong: pos.is_long,
        size: parseInt(pos.size),
        entryPrice: parseInt(pos.avg_acquire_entry_px) / 1_000_000,
        leverage: pos.user_leverage
      }
    } catch (error) {
      console.error('Error fetching position:', error)
      return { hasPosition: false, isLong: true, size: 0, entryPrice: 0, leverage: 1 }
    }
  }

  /**
   * Close the current position with a reduce-only TWAP order
   * Using TWAP instead of market order to avoid EPRICE_NOT_RESPECTING_TICKER_SIZE errors
   */
  private async closePosition(
    size: number,
    isLong: boolean
  ): Promise<OrderResult> {
    try {
      // To close a long, place a short reduce-only order (and vice versa)
      const closeDirection = !isLong

      console.log(`\n📝 [CLOSE] Placing ${closeDirection ? 'SHORT' : 'LONG'} reduce-only TWAP order to close position...`)
      console.log(`Size: ${size}`)

      // Use TWAP with reduce_only=true to close position
      // Minimum TWAP duration on Decibel is 5 minutes (300s)
      const transaction = await this.aptos.transaction.build.simple({
        sender: this.botAccount.accountAddress,
        data: {
          function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
          typeArguments: [],
          functionArguments: [
            this.config.userSubaccount,  // subaccount
            this.config.market,          // market
            size,                        // size (close full position)
            closeDirection,              // is_long (opposite of position)
            true,                        // reduce_only = TRUE to close
            300,                         // min duration: 5 minutes (minimum allowed)
            600,                         // max duration: 10 minutes
            undefined,                   // builder_address
            undefined,                   // max_builder_fee
          ],
        },
      })

      const committedTxn = await this.aptos.signAndSubmitTransaction({
        signer: this.botAccount,
        transaction,
      })

      console.log(`✅ Close TWAP order submitted: ${committedTxn.hash}`)

      const executedTxn = await this.aptos.waitForTransaction({
        transactionHash: committedTxn.hash,
      })

      if (!executedTxn.success) {
        throw new Error('Close position transaction failed')
      }

      console.log(`✅ Position close order placed! (TWAP will execute over 5-10 min)`)

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

      // For volume calculation: opening a position generates volume
      // When we close it (in next order cycle), it generates more volume
      const volumeGenerated = size

      return {
        success: true,
        txHash: committedTxn.hash,
        volumeGenerated,
        direction: isLong ? 'long' : 'short',
        size: contractSize,
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

      const volumeGenerated = size

      return {
        success: true,
        txHash: committedTxn.hash,
        volumeGenerated,
        direction: isLong ? 'long' : 'short',
        size: contractSize,
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

      const volumeGenerated = size

      return {
        success: true,
        txHash: committedTxn.hash,
        volumeGenerated,
        direction: isLong ? 'long' : 'short',
        size: contractSize,
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
            contractSize,
            priceInContractFormat,
            isLong,
            0,         // time_in_force: GTC (Good Till Cancel)
            true,      // post_only: true for better fees
            undefined, // client_order_id
            undefined, // limit_price
            undefined, // take_profit_price
            undefined, // stop_loss_price
            undefined, // trigger_price
            undefined, // max_leverage
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

      return {
        success: true,
        txHash: committedTxn.hash,
        volumeGenerated: size,
        direction: isLong ? 'long' : 'short',
        size: contractSize,
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
   * HIGH RISK AGGRESSIVE PNL STRATEGY
   *
   * This strategy aims to generate actual PnL by:
   * 1. Opening leveraged positions with TWAP orders (5-10 min fill)
   * 2. Monitoring price for profit target (+0.3%) or stop-loss (-0.2%)
   * 3. Closing position when target reached with reduce-only TWAP
   * 4. Generating volume from both open and close trades
   *
   * NOTE: Market orders fail on Decibel testnet with EPRICE_NOT_RESPECTING_TICKER_SIZE
   * when positions have entry prices not aligned to ticker_size (a testnet bug).
   * Minimum TWAP duration on Decibel is 5 minutes (300 seconds).
   *
   * Risk parameters:
   * - Uses up to 20x leverage (capped for safety)
   * - 5% of capital per trade
   * - Tight profit target (+0.3% = +6% with 20x leverage)
   * - Tight stop-loss (-0.2% = -4% with 20x leverage)
   */
  private async placeHighRiskOrder(
    size: number,
    isLong: boolean
  ): Promise<OrderResult> {
    const orderStartTime = Date.now()

    try {
      // First, check if we have an existing position
      const currentPosition = await this.getCurrentPosition()

      // If we have a position, check if we should close it
      if (currentPosition.hasPosition && currentPosition.size > 0) {
        console.log(`\n📊 [High Risk] Existing ${currentPosition.isLong ? 'LONG' : 'SHORT'} position detected`)
        console.log(`   Size: ${currentPosition.size}, Entry: $${currentPosition.entryPrice.toFixed(2)}`)

        const currentPrice = await this.getCurrentMarketPrice()
        const priceChange = currentPosition.isLong
          ? (currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice
          : (currentPosition.entryPrice - currentPrice) / currentPosition.entryPrice

        const priceChangePercent = priceChange * 100
        console.log(`   Current price: $${currentPrice.toFixed(2)}, PnL: ${priceChangePercent.toFixed(3)}%`)

        // Profit target: +0.3% (with leverage this is significant)
        // Stop loss: -0.2%
        const PROFIT_TARGET = 0.003  // 0.3%
        const STOP_LOSS = -0.002     // -0.2%

        if (priceChange >= PROFIT_TARGET) {
          console.log(`🎯 PROFIT TARGET HIT! Closing position for +${priceChangePercent.toFixed(3)}% gain`)

          const closeResult = await this.closePosition(currentPosition.size, currentPosition.isLong)

          if (closeResult.success) {
            // Calculate realized PnL
            const leveragedPnlPercent = priceChangePercent * currentPosition.leverage
            const positionValueUSD = (currentPosition.size / 100_000_000) * currentPosition.entryPrice
            const realizedPnl = positionValueUSD * (leveragedPnlPercent / 100)

            console.log(`💰 Realized PnL: $${realizedPnl.toFixed(2)} (${leveragedPnlPercent.toFixed(2)}% with ${currentPosition.leverage}x leverage)`)

            return {
              success: true,
              txHash: closeResult.txHash,
              volumeGenerated: positionValueUSD * 2, // Open + close volume
              direction: closeResult.direction,
              size: currentPosition.size,
              entryPrice: currentPosition.entryPrice,
              exitPrice: currentPrice,
              pnl: realizedPnl,
              positionHeldMs: Date.now() - orderStartTime,
            }
          }
          return closeResult
        } else if (priceChange <= STOP_LOSS) {
          console.log(`🛑 STOP LOSS HIT! Closing position for ${priceChangePercent.toFixed(3)}% loss`)

          const closeResult = await this.closePosition(currentPosition.size, currentPosition.isLong)

          if (closeResult.success) {
            const leveragedPnlPercent = priceChangePercent * currentPosition.leverage
            const positionValueUSD = (currentPosition.size / 100_000_000) * currentPosition.entryPrice
            const realizedPnl = positionValueUSD * (leveragedPnlPercent / 100)

            console.log(`💸 Realized Loss: $${realizedPnl.toFixed(2)} (${leveragedPnlPercent.toFixed(2)}% with ${currentPosition.leverage}x leverage)`)

            return {
              success: true,
              txHash: closeResult.txHash,
              volumeGenerated: positionValueUSD * 2,
              direction: closeResult.direction,
              size: currentPosition.size,
              entryPrice: currentPosition.entryPrice,
              exitPrice: currentPrice,
              pnl: realizedPnl,
              positionHeldMs: Date.now() - orderStartTime,
            }
          }
          return closeResult
        } else {
          console.log(`⏳ Position still open, waiting for target (need ${((PROFIT_TARGET - priceChange) * 100).toFixed(3)}% more)`)
          // Don't open another position, just report waiting
          return {
            success: true,
            txHash: 'waiting',
            volumeGenerated: 0,
            direction: currentPosition.isLong ? 'long' : 'short',
            size: currentPosition.size,
            entryPrice: currentPosition.entryPrice,
            pnl: 0,
          }
        }
      }

      // No existing position - open a new one
      console.log(`\n📝 [High Risk] Opening new ${isLong ? 'LONG' : 'SHORT'} position...`)

      const entryPrice = await this.getCurrentMarketPrice()
      console.log(`   Market: ${this.config.marketName}, Price: $${entryPrice.toFixed(2)}`)

      // Calculate position size: 5% of capital with leverage consideration
      // For BTC: size is in satoshis (8 decimals)
      // Position value = (size / 10^8) * price
      // We want position_value = capital * 0.05 * leverage
      // So size = (capital * 0.05 * leverage * 10^8) / price

      const capitalToUse = this.config.capitalUSDC * 0.05 // 5% of capital
      const maxLeverage = this.getMarketMaxLeverage()
      const leverageToUse = Math.min(maxLeverage, 20) // Cap at 20x for safety

      // Size in contract units (satoshis for BTC)
      // Must be rounded to lot_size to avoid ESIZE_NOT_RESPECTING_LOT_SIZE error
      const sizeDecimals = this.getMarketSizeDecimals()
      const rawSize = Math.floor((capitalToUse * leverageToUse * Math.pow(10, sizeDecimals)) / entryPrice)
      const contractSize = this.roundSizeToLotSize(rawSize)

      console.log(`   Capital: $${capitalToUse.toFixed(2)}, Leverage: ${leverageToUse}x`)
      console.log(`   Contract size: ${contractSize} (${(Number(contractSize) / Math.pow(10, sizeDecimals)).toFixed(6)} ${this.config.marketName.split('/')[0]})`)

      // Place TWAP order for position entry
      // Minimum TWAP duration on Decibel is 5 minutes (300s)
      // Using TWAP because market orders fail with EPRICE_NOT_RESPECTING_TICKER_SIZE on testnet
      const transaction = await this.aptos.transaction.build.simple({
        sender: this.botAccount.accountAddress,
        data: {
          function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
          typeArguments: [],
          functionArguments: [
            this.config.userSubaccount,
            this.config.market,
            contractSize.toString(),  // bigint to string for transaction
            isLong,
            false,     // reduce_only = false (opening position)
            300,       // min duration: 5 minutes (minimum allowed)
            600,       // max duration: 10 minutes
            undefined, // builder_address
            undefined, // max_builder_fee
          ],
        },
      })

      const committedTxn = await this.aptos.signAndSubmitTransaction({
        signer: this.botAccount,
        transaction,
      })

      console.log(`✅ TWAP order submitted: ${committedTxn.hash}`)

      const executedTxn = await this.aptos.waitForTransaction({
        transactionHash: committedTxn.hash,
      })

      if (!executedTxn.success) {
        throw new Error('Transaction failed')
      }

      console.log(`✅ Position opening! (TWAP filling over 5-10 min, then monitoring for profit target...)`)

      // Calculate volume generated from opening
      const volumeGenerated = capitalToUse * leverageToUse

      return {
        success: true,
        txHash: committedTxn.hash,
        volumeGenerated,
        direction: isLong ? 'long' : 'short',
        size: Number(contractSize),
        entryPrice,
        pnl: 0, // No PnL yet, position just opened
        positionHeldMs: 0,
      }
    } catch (error) {
      console.error('❌ High-risk order failed:', error)
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
   */
  private getMarketSizeDecimals(): number {
    const decimalsMap: Record<string, number> = {
      'BTC/USD': 8,
      'ETH/USD': 7,
      'SOL/USD': 6,
      'APT/USD': 6,
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

    // Check if we've reached volume target
    if (this.status.cumulativeVolume >= this.config.volumeTargetUSDC) {
      console.log('🎉 Volume target reached! Stopping bot.')
      await this.stop()
      // Remove from botManager
      const { botManager } = await import('./bot-manager')
      botManager.deleteBot(this.config.userWalletAddress)
      console.log('🗑️  Removed bot from active bots')
      return
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
        result = await this.placeHighRiskOrder(orderSize, isLong)
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

        // Find bot instance
        const botInstance = await prisma.botInstance.findUnique({
          where: { userWalletAddress: this.config.userWalletAddress }
        })

        if (botInstance) {
          // Create order history record with session ID
          await prisma.orderHistory.create({
            data: {
              botId: botInstance.id,
              sessionId: botInstance.sessionId,  // Track which session this order belongs to
              txHash: result.txHash,
              direction: result.direction,
              strategy: this.config.strategy || 'twap',
              size: result.size,
              volumeGenerated: result.volumeGenerated,
              success: result.success,
              entryPrice: result.entryPrice,
              exitPrice: result.exitPrice,
              pnl: result.pnl || 0,
              positionHeldMs: result.positionHeldMs || 0,
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
        // Don't fail the bot if database write fails
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
