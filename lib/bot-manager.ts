/**
 * Shared bot manager singleton with database persistence
 *
 * Ensures that bot instances are shared across all API routes
 * and persisted to the database for recovery after server restarts
 */

import { VolumeBotEngine, BotConfig } from './bot-engine'

class BotManager {
  private static instance: BotManager
  private activeBots: Map<string, VolumeBotEngine>
  private initialized: boolean = false

  private constructor() {
    this.activeBots = new Map()
  }

  public static getInstance(): BotManager {
    if (!BotManager.instance) {
      BotManager.instance = new BotManager()
    }
    return BotManager.instance
  }

  /**
   * Initialize the bot manager by restoring active bots from database
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      const { prisma } = await import('./prisma')

      console.log('🔄 Restoring bots from database...')
      const runningBots = await prisma.botInstance.findMany({
        where: { isRunning: true }
      })

      for (const bot of runningBots) {
        const config: BotConfig = {
          userWalletAddress: bot.userWalletAddress,
          userSubaccount: bot.userSubaccount,
          capitalUSDC: bot.capitalUSDC,
          volumeTargetUSDC: bot.volumeTargetUSDC,
          bias: bot.bias as 'long' | 'short' | 'neutral',
          strategy: (bot.strategy || 'twap') as 'twap' | 'market_maker' | 'delta_neutral' | 'high_risk',
          market: bot.market,
          marketName: bot.marketName,
        }

        const botEngine = new VolumeBotEngine(config)
        this.activeBots.set(bot.userWalletAddress, botEngine)

        // Resume the bot loop
        botEngine.start().catch(err => {
          console.error(`Failed to restart bot for ${bot.userWalletAddress}:`, err)
        })

        console.log(`✅ Restored bot for ${bot.userWalletAddress}`)
      }

      this.initialized = true
      console.log(`✅ Restored ${runningBots.length} bot(s) from database`)
    } catch (error) {
      console.error('❌ Failed to restore bots from database:', error)
    }
  }

  public getBot(userWalletAddress: string): VolumeBotEngine | undefined {
    return this.activeBots.get(userWalletAddress)
  }

  public setBot(userWalletAddress: string, bot: VolumeBotEngine): void {
    this.activeBots.set(userWalletAddress, bot)
  }

  public deleteBot(userWalletAddress: string): boolean {
    return this.activeBots.delete(userWalletAddress)
  }

  public hasBot(userWalletAddress: string): boolean {
    return this.activeBots.has(userWalletAddress)
  }
}

export const botManager = BotManager.getInstance()
