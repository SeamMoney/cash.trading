/**
 * Simplified TWAP Bot - Leveraging Decibel's Native TWAP
 *
 * This demonstrates how simple our bot becomes when using native TWAP support.
 * Compare this to the original TWAPBot (280 lines with manual splitting).
 *
 * This version: ~60 lines of actual logic.
 */

import { DecibelClient, MARKETS, MarketName } from './lib/decibel-client';
import { Network } from '@aptos-labs/ts-sdk';

export interface SimplifiedTWAPConfig {
  // User inputs
  budget: number; // Total USDC to spend on fees
  marketName: MarketName; // e.g., 'BTC/USD'
  executionMode: 'aggressive' | 'normal' | 'passive';
  directionalBias: number; // -1 to +1 (-1 = short, 0 = neutral, +1 = long)

  // Blockchain
  subaccountAddress: string;
  walletPrivateKey: string;
}

// Fee constants
const BUILDER_FEE = 0.0002; // 0.02%
const MAKER_REBATE = 0.00015; // -0.015%
const EFFECTIVE_FEE = BUILDER_FEE - MAKER_REBATE; // 0.00035 (0.035%)

// Duration mapping for execution modes (in seconds)
const EXECUTION_DURATIONS = {
  aggressive: { min: 300, max: 600 },      // 5-10 min
  normal: { min: 900, max: 1800 },         // 15-30 min
  passive: { min: 1800, max: 3600 },       // 30-60 min
} as const;

export class SimplifiedTWAPBot {
  private client: DecibelClient;
  private config: SimplifiedTWAPConfig;

  constructor(config: SimplifiedTWAPConfig) {
    this.config = config;
    this.client = new DecibelClient({
      network: Network.TESTNET,
      privateKey: config.walletPrivateKey,
    });
  }

  /**
   * Calculate total volume from budget
   * Volume = Budget / Effective Fee
   */
  private calculateVolume(): number {
    return this.config.budget / EFFECTIVE_FEE;
  }

  /**
   * Calculate volume split based on directional bias
   * Bias = -1 (100% short), 0 (50/50), +1 (100% long)
   */
  private calculateVolumeSplit(): { longVolume: number; shortVolume: number } {
    const totalVolume = this.calculateVolume();
    const longRatio = (this.config.directionalBias + 1) / 2; // Convert -1..+1 to 0..1

    return {
      longVolume: totalVolume * longRatio,
      shortVolume: totalVolume * (1 - longRatio),
    };
  }

  /**
   * Execute the TWAP strategy using native Decibel TWAP orders
   * This replaces the entire manual execution loop!
   */
  async execute(): Promise<{ longOrderHash: string; shortOrderHash: string }> {
    const market = MARKETS[this.config.marketName];
    const duration = EXECUTION_DURATIONS[this.config.executionMode];
    const { longVolume, shortVolume } = this.calculateVolumeSplit();

    console.log(`🚀 Starting TWAP Market Maker Bot`);
    console.log(`   Market: ${this.config.marketName}`);
    console.log(`   Budget: $${this.config.budget.toFixed(2)}`);
    console.log(`   Total Volume: $${this.calculateVolume().toFixed(2)}`);
    console.log(`   Long Volume: $${longVolume.toFixed(2)}`);
    console.log(`   Short Volume: $${shortVolume.toFixed(2)}`);
    console.log(`   Duration: ${duration.min}-${duration.max}s`);

    // Place long-side TWAP order (if any)
    let longOrderHash = '';
    if (longVolume > 0) {
      console.log(`\n📈 Placing LONG TWAP order...`);
      longOrderHash = await this.client.placeTWAPOrder({
        marketAddress: market.address,
        subaccountAddress: this.config.subaccountAddress,
        isLong: true,
        size: longVolume,
        minDurationSeconds: duration.min,
        maxDurationSeconds: duration.max,
      });
      console.log(`   ✅ Long order placed: ${longOrderHash}`);
    }

    // Place short-side TWAP order (if any)
    let shortOrderHash = '';
    if (shortVolume > 0) {
      console.log(`\n📉 Placing SHORT TWAP order...`);
      shortOrderHash = await this.client.placeTWAPOrder({
        marketAddress: market.address,
        subaccountAddress: this.config.subaccountAddress,
        isLong: false,
        size: shortVolume,
        minDurationSeconds: duration.min,
        maxDurationSeconds: duration.max,
      });
      console.log(`   ✅ Short order placed: ${shortOrderHash}`);
    }

    console.log(`\n🎉 Bot initialized! Decibel will handle execution automatically.`);
    console.log(`   Monitor progress: https://testnet.decibel.finance/trade`);

    return { longOrderHash, shortOrderHash };
  }

  /**
   * Calculate required margin for the strategy
   */
  calculateRequiredMargin(leverage: number = 1): number {
    const totalVolume = this.calculateVolume();
    return totalVolume / leverage;
  }

  /**
   * Cancel active TWAP orders
   */
  async cancel(orderIds: string[]): Promise<void> {
    const market = MARKETS[this.config.marketName];

    for (const orderId of orderIds) {
      console.log(`🛑 Canceling order ${orderId}...`);
      await this.client.cancelOrder({
        subaccountAddress: this.config.subaccountAddress,
        marketAddress: market.address,
        orderId,
      });
      console.log(`   ✅ Order canceled`);
    }
  }
}

/**
 * Example usage:
 *
 * const bot = new SimplifiedTWAPBot({
 *   budget: 100,                      // Spend $100 on fees
 *   marketName: 'BTC/USD',            // Trade BTC perpetual
 *   executionMode: 'normal',          // 15-30 minute execution
 *   directionalBias: 0.2,             // Slightly bullish (60% long, 40% short)
 *   subaccountAddress: '0x...',       // User's Decibel subaccount
 *   walletPrivateKey: '0x...',        // User's private key
 * });
 *
 * // Calculate volume
 * console.log(`Volume: $${bot.calculateVolume()}`); // ~$285,714
 *
 * // Execute strategy (places 2 TWAP orders, done!)
 * await bot.execute();
 *
 * // Decibel handles everything else automatically!
 */
