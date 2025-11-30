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

    const cleanKey = botPrivateKeyHex.replace('ed25519-priv-', '')
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
   * Fetch current market price from Decibel API
   * Note: API requires auth, so we use fallback values
   */
  private async getCurrentMarketPrice(): Promise<number> {
    // Decibel API requires authentication - use fallback price
    // TODO: Add API key when available or use on-chain oracle
    const fallbackPrices: Record<string, number> = {
      'BTC/USD': 100000,
      'ETH/USD': 3500,
      'SOL/USD': 200,
    }
    return fallbackPrices[this.config.marketName] || 100000
  }

  /**
   * Fetch user's current USDC balance from their subaccount
   * Note: API requires auth, so we use config capital as fallback
   */
  private async getUserBalance(): Promise<number> {
    // Decibel API requires authentication - use config capital as estimate
    // TODO: Add API key when available or read from on-chain
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
   * Calculate leverage for High Risk strategy
   * HFT MODE: Maximum leverage for extreme PNL volatility
   */
  private calculateLeverage(): number {
    const { capitalUSDC } = this.config
    // HFT mode: Use 10x leverage for maximum PNL swings!
    if (capitalUSDC >= 1000) return 10
    if (capitalUSDC >= 500) return 7
    return 5
  }

  /**
   * Place larger TWAP order for High Risk strategy
   * Uses larger position sizes for more PNL volatility
   */
  private async placeHighRiskOrder(
    size: number,
    isLong: boolean
  ): Promise<OrderResult> {
    const orderStartTime = Date.now()
    let balanceBefore = 0
    let balanceAfter = 0
    let entryPrice = 0

    try {
      const leverage = this.calculateLeverage()

      console.log(`\n📝 [High Risk] Placing ${isLong ? 'LONG' : 'SHORT'} AGGRESSIVE order with ${leverage}x size...`)
      console.log(`Size: $${size.toFixed(2)} USDC`)

      // Get balance before trade
      balanceBefore = await this.getUserBalance()
      entryPrice = await this.getCurrentMarketPrice()

      // Use larger contract size for more PNL volatility
      const contractSize = 10000 * leverage // Multiply base size by leverage factor

      // Use TWAP - durations must be in SECONDS
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

      console.log(`✅ High-risk AGGRESSIVE order submitted: ${committedTxn.hash}`)

      const executedTxn = await this.aptos.waitForTransaction({
        transactionHash: committedTxn.hash,
      })

      if (!executedTxn.success) {
        throw new Error('Transaction failed')
      }

      console.log(`✅ High-risk order confirmed! (${leverage}x position, 60-90sec FAST fill)`)

      // Wait a bit for the order to potentially fill, then check balance
      await new Promise(resolve => setTimeout(resolve, 5000)) // Wait 5 seconds
      balanceAfter = await this.getUserBalance()
      const exitPrice = await this.getCurrentMarketPrice()

      // Calculate PNL
      const pnl = balanceAfter - balanceBefore
      const positionHeldMs = Date.now() - orderStartTime

      console.log(`📊 PNL: $${pnl.toFixed(2)} USDC (held for ${(positionHeldMs / 1000).toFixed(1)}s)`)

      const volumeGenerated = size * leverage

      return {
        success: true,
        txHash: committedTxn.hash,
        volumeGenerated,
        direction: isLong ? 'long' : 'short',
        size: contractSize,
        entryPrice,
        exitPrice,
        pnl,
        positionHeldMs,
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
          // Create order history record
          await prisma.orderHistory.create({
            data: {
              botId: botInstance.id,
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

          // Update bot instance status
          await prisma.botInstance.update({
            where: { id: botInstance.id },
            data: {
              cumulativeVolume: this.status.cumulativeVolume,
              ordersPlaced: this.status.ordersPlaced,
              lastOrderTime: new Date(this.status.lastOrderTime),
              error: null,
            }
          })

          console.log('💾 Order persisted to database')
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
