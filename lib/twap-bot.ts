import { DecibelClient, MAKER_REBATE, BUILDER_FEE } from './decibel-client';

export type ExecutionMode = 'aggressive' | 'normal' | 'passive';

export interface ExecutionModeConfig {
  participationRate: number;
  minDuration: number;
  safetyBuffer: number;
}

export const EXECUTION_MODES: Record<ExecutionMode, ExecutionModeConfig> = {
  aggressive: {
    participationRate: 0.05, // 5% of market volume
    minDuration: 300, // 5 minutes
    safetyBuffer: 2.0, // 2x margin buffer
  },
  normal: {
    participationRate: 0.01, // 1% of market volume
    minDuration: 900, // 15 minutes
    safetyBuffer: 1.0, // 1x margin buffer
  },
  passive: {
    participationRate: 0.005, // 0.5% of market volume
    minDuration: 1800, // 30 minutes
    safetyBuffer: 0.5, // 0.5x margin buffer
  },
};

export interface TWAPBotConfig {
  marketId: string;
  subaccountAddress: string;
  budget: number; // USDC budget
  directionalBias: number; // -1 to +1
  executionMode: ExecutionMode;
  leverage: number;
}

export interface TWAPBotState {
  totalVolume: number;
  executedVolume: number;
  buyVolume: number;
  sellVolume: number;
  currentExposure: number;
  activeOrders: string[];
  isRunning: boolean;
  startTime: number;
  lastSliceTime: number;
}

export class TWAPBot {
  private client: DecibelClient;
  private config: TWAPBotConfig;
  private state: TWAPBotState;
  private intervalId?: NodeJS.Timeout;

  constructor(client: DecibelClient, config: TWAPBotConfig) {
    this.client = client;
    this.config = config;
    this.state = {
      totalVolume: 0,
      executedVolume: 0,
      buyVolume: 0,
      sellVolume: 0,
      currentExposure: 0,
      activeOrders: [],
      isRunning: false,
      startTime: 0,
      lastSliceTime: 0,
    };
  }

  /**
   * Calculate total volume from budget
   */
  private calculateVolume(): number {
    const effectiveFee = BUILDER_FEE - MAKER_REBATE;
    return this.config.budget / effectiveFee;
  }

  /**
   * Calculate alpha tilt from directional bias
   */
  private calculateAlphaTilt(): number {
    return this.config.directionalBias * 0.2;
  }

  /**
   * Calculate TWAP weight for a given progress through execution
   * alphaTilt: -0.2 to +0.2
   * - Positive = front-loaded (more volume early)
   * - Negative = back-loaded (more volume late)
   */
  private calculateTWAPWeight(progress: number, alphaTilt: number): number {
    // Base TWAP is linear: weight = 1 / numSlices
    // With tilt: adjust based on progress
    const baseWeight = 1.0;
    const tiltAdjustment = alphaTilt * (2 * progress - 1);
    return baseWeight * (1 + tiltAdjustment);
  }

  /**
   * Calculate required margin with directional bias adjustment
   */
  private calculateRequiredMargin(notional: number): number {
    const modeConfig = EXECUTION_MODES[this.config.executionMode];
    const baseMargin = (notional / this.config.leverage) * modeConfig.safetyBuffer;

    // Directional bias increases margin requirement
    const biasAdjustment = 1 + Math.abs(this.config.directionalBias) * 0.2;
    return baseMargin * biasAdjustment;
  }

  /**
   * Check if current exposure is within tolerance (6-8%)
   */
  private isExposureWithinTolerance(): boolean {
    const exposurePct = Math.abs(this.state.currentExposure) / this.state.totalVolume;
    return exposurePct <= 0.08;
  }

  /**
   * Start the TWAP bot
   */
  async start(): Promise<void> {
    if (this.state.isRunning) {
      throw new Error('Bot is already running');
    }

    // Calculate total volume from budget
    this.state.totalVolume = this.calculateVolume();
    this.state.isRunning = true;
    this.state.startTime = Date.now();

    const modeConfig = EXECUTION_MODES[this.config.executionMode];
    const alphaTilt = this.calculateAlphaTilt();

    // Calculate number of slices based on participation rate
    const market = await this.client.getMarket(this.config.marketId);
    const dailyVolume = parseFloat(market.volume_24h || '1000000'); // fallback to 1M
    const targetDuration = Math.max(
      modeConfig.minDuration,
      this.state.totalVolume / (dailyVolume * modeConfig.participationRate / 86400)
    );

    const numSlices = Math.ceil(targetDuration / 30); // 30 second intervals
    const sliceInterval = targetDuration / numSlices;

    console.log(`Starting TWAP bot:`);
    console.log(`- Total volume: $${this.state.totalVolume.toFixed(2)}`);
    console.log(`- Budget: $${this.config.budget.toFixed(2)}`);
    console.log(`- Duration: ${(targetDuration / 60).toFixed(1)} minutes`);
    console.log(`- Slices: ${numSlices}`);
    console.log(`- Interval: ${sliceInterval.toFixed(1)}s`);
    console.log(`- Alpha tilt: ${alphaTilt.toFixed(3)}`);

    // Execute slices
    let sliceIndex = 0;

    const executeSlice = async () => {
      if (!this.state.isRunning || sliceIndex >= numSlices) {
        this.stop();
        return;
      }

      const progress = sliceIndex / numSlices;
      const twapWeight = this.calculateTWAPWeight(progress, alphaTilt);
      const sliceVolume = (this.state.totalVolume / numSlices) * twapWeight;

      // Check exposure tolerance before placing orders
      if (!this.isExposureWithinTolerance()) {
        console.log(`Exposure limit reached (${(Math.abs(this.state.currentExposure) / this.state.totalVolume * 100).toFixed(2)}%), pausing...`);
        return;
      }

      try {
        await this.executeSlice(sliceVolume);
        this.state.lastSliceTime = Date.now();
        sliceIndex++;
      } catch (error) {
        console.error('Error executing slice:', error);
      }
    };

    // Execute first slice immediately, then set interval
    await executeSlice();
    this.intervalId = setInterval(executeSlice, sliceInterval * 1000);
  }

  /**
   * Execute a single TWAP slice
   */
  private async executeSlice(sliceVolume: number): Promise<void> {
    const orderbook = await this.client.getOrderbook(this.config.marketId);

    if (orderbook.bids.length === 0 || orderbook.asks.length === 0) {
      console.log('Empty orderbook, skipping slice');
      return;
    }

    const midPrice = (orderbook.bids[0].price + orderbook.asks[0].price) / 2;
    const spread = orderbook.asks[0].price - orderbook.bids[0].price;

    // Check margin availability
    const availableMargin = await this.client.getAvailableMargin(this.config.subaccountAddress);
    const requiredMargin = this.calculateRequiredMargin(sliceVolume);

    if (availableMargin < requiredMargin) {
      console.log(`Insufficient margin: ${availableMargin.toFixed(2)} < ${requiredMargin.toFixed(2)}`);
      this.stop();
      return;
    }

    // Split volume 50/50 buy/sell (market making)
    const buyVolume = sliceVolume / 2;
    const sellVolume = sliceVolume / 2;

    // Place orders inside spread for maker rebate
    const buyPrice = orderbook.bids[0].price + spread * 0.1; // 10% inside spread
    const sellPrice = orderbook.asks[0].price - spread * 0.1;

    try {
      // Place buy order
      const buyTxHash = await this.client.placeLimitOrder({
        marketAddress: this.config.marketId,
        subaccountAddress: this.config.subaccountAddress,
        isLong: true,
        price: buyPrice,
        size: buyVolume / buyPrice,
        postOnly: true,
      });

      this.state.activeOrders.push(buyTxHash);
      this.state.buyVolume += buyVolume;

      console.log(`Buy order placed: $${buyVolume.toFixed(2)} @ $${buyPrice.toFixed(4)}`);

      // Place sell order
      const sellTxHash = await this.client.placeLimitOrder({
        marketAddress: this.config.marketId,
        subaccountAddress: this.config.subaccountAddress,
        isLong: false,
        price: sellPrice,
        size: sellVolume / sellPrice,
        postOnly: true,
      });

      this.state.activeOrders.push(sellTxHash);
      this.state.sellVolume += sellVolume;

      console.log(`Sell order placed: $${sellVolume.toFixed(2)} @ $${sellPrice.toFixed(4)}`);

      this.state.executedVolume += sliceVolume;
      this.state.currentExposure = this.state.buyVolume - this.state.sellVolume;

      console.log(`Progress: ${(this.state.executedVolume / this.state.totalVolume * 100).toFixed(1)}% | Exposure: $${this.state.currentExposure.toFixed(2)}`);
    } catch (error) {
      console.error('Error placing orders:', error);
    }
  }

  /**
   * Stop the bot
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.state.isRunning = false;
    console.log('Bot stopped');
  }

  /**
   * Get current bot state
   */
  getState(): TWAPBotState {
    return { ...this.state };
  }
}
