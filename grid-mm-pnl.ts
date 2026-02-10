/**
 * Grid MM PnL Tracker - Compares our grid MM bot vs DLP vault performance
 *
 * Fetches account overviews for both accounts, takes snapshots,
 * prints comparison tables, and persists data to JSON.
 */

import * as fs from 'fs'
import * as path from 'path'
import { getDecibelAccountOverview, type DecibelAccountOverview } from './lib/decibel-api'

const VAULT_SUBACCOUNT = '0x1aa8a40a749aacc063fd541f17ab13bd1e87f3eca8de54d73b6552263571e3d9'

interface PositionInfo {
  size: number
  entryPrice: number
  unrealizedPnl: number
}

export interface PnLSnapshot {
  timestamp: number
  bot: {
    equity: number
    unrealizedPnl: number
    realizedPnl: number
    totalMargin: number
    leverage: number
    orderCount: number
  }
  vault: {
    equity: number
    unrealizedPnl: number
    realizedPnl: number
    totalMargin: number
    leverage: number
  }
}

interface PnLDataStore {
  startTime: number
  botSubaccount: string
  vaultSubaccount: string
  snapshots: PnLSnapshot[]
}

export class PnLTracker {
  private botSubaccount: string
  private dataFile: string
  private store: PnLDataStore
  private startEquityBot: number | null = null
  private startEquityVault: number | null = null

  constructor(botSubaccount: string, dataFile: string = './grid-mm-pnl-data.json') {
    this.botSubaccount = botSubaccount
    this.dataFile = dataFile
    this.store = {
      startTime: Date.now(),
      botSubaccount,
      vaultSubaccount: VAULT_SUBACCOUNT,
      snapshots: [],
    }
  }

  async takeSnapshot(orderCount: number = 0): Promise<PnLSnapshot | null> {
    try {
      const [botOverview, vaultOverview] = await Promise.all([
        getDecibelAccountOverview(this.botSubaccount),
        getDecibelAccountOverview(VAULT_SUBACCOUNT),
      ])

      if (!botOverview || !vaultOverview) {
        console.error('Failed to fetch account overviews')
        return null
      }

      const snapshot: PnLSnapshot = {
        timestamp: Date.now(),
        bot: {
          equity: botOverview.perp_equity_balance,
          unrealizedPnl: botOverview.unrealized_pnl,
          realizedPnl: botOverview.realized_pnl,
          totalMargin: botOverview.total_margin,
          leverage: botOverview.cross_account_leverage_ratio,
          orderCount,
        },
        vault: {
          equity: vaultOverview.perp_equity_balance,
          unrealizedPnl: vaultOverview.unrealized_pnl,
          realizedPnl: vaultOverview.realized_pnl,
          totalMargin: vaultOverview.total_margin,
          leverage: vaultOverview.cross_account_leverage_ratio,
        },
      }

      if (this.startEquityBot === null) this.startEquityBot = snapshot.bot.equity
      if (this.startEquityVault === null) this.startEquityVault = snapshot.vault.equity

      this.store.snapshots.push(snapshot)
      return snapshot
    } catch (error) {
      console.error('PnL snapshot failed:', error)
      return null
    }
  }

  printComparison(snapshot: PnLSnapshot): void {
    const elapsed = snapshot.timestamp - this.store.startTime
    const hours = Math.floor(elapsed / 3600000)
    const mins = Math.floor((elapsed % 3600000) / 60000)

    const botPnlSinceStart = this.startEquityBot
      ? snapshot.bot.equity - this.startEquityBot
      : 0
    const vaultPnlSinceStart = this.startEquityVault
      ? snapshot.vault.equity - this.startEquityVault
      : 0
    const botPctReturn = this.startEquityBot
      ? (botPnlSinceStart / this.startEquityBot) * 100
      : 0
    const vaultPctReturn = this.startEquityVault
      ? (vaultPnlSinceStart / this.startEquityVault) * 100
      : 0

    const fmt = (n: number) => {
      const sign = n >= 0 ? '+' : ''
      return `${sign}$${n.toFixed(2)}`
    }

    console.log(`\n${'='.repeat(64)}`)
    console.log(`  PnL Comparison @ ${new Date(snapshot.timestamp).toISOString()} (${hours}h ${mins}m)`)
    console.log('='.repeat(64))
    console.log(`${''.padEnd(24)} ${'Our Bot'.padStart(16)} ${'DLP Vault'.padStart(16)}`)
    console.log('-'.repeat(64))
    console.log(`${'Equity:'.padEnd(24)} ${'$' + snapshot.bot.equity.toFixed(2).padStart(15)} ${'$' + snapshot.vault.equity.toFixed(2).padStart(15)}`)
    console.log(`${'Unrealized PnL:'.padEnd(24)} ${fmt(snapshot.bot.unrealizedPnl).padStart(16)} ${fmt(snapshot.vault.unrealizedPnl).padStart(16)}`)
    console.log(`${'Realized PnL:'.padEnd(24)} ${fmt(snapshot.bot.realizedPnl).padStart(16)} ${fmt(snapshot.vault.realizedPnl).padStart(16)}`)
    console.log(`${'Leverage:'.padEnd(24)} ${snapshot.bot.leverage.toFixed(2).padStart(15)}x ${snapshot.vault.leverage.toFixed(2).padStart(14)}x`)
    console.log(`${'Open Orders:'.padEnd(24)} ${String(snapshot.bot.orderCount).padStart(16)} ${'N/A'.padStart(16)}`)
    console.log('-'.repeat(64))
    console.log(`${'PnL since start:'.padEnd(24)} ${(fmt(botPnlSinceStart) + ` (${botPctReturn.toFixed(2)}%)`).padStart(16)} ${(fmt(vaultPnlSinceStart) + ` (${vaultPctReturn.toFixed(2)}%)`).padStart(16)}`)
    console.log('='.repeat(64))
  }

  async takeAndPrint(orderCount: number = 0): Promise<PnLSnapshot | null> {
    const snapshot = await this.takeSnapshot(orderCount)
    if (snapshot) {
      this.printComparison(snapshot)
      this.saveToFile()
    }
    return snapshot
  }

  saveToFile(): void {
    try {
      const tmpFile = this.dataFile + '.tmp'
      fs.writeFileSync(tmpFile, JSON.stringify(this.store, null, 2))
      fs.renameSync(tmpFile, this.dataFile)
    } catch (error) {
      console.error('Failed to save PnL data:', error)
    }
  }

  loadFromFile(): boolean {
    try {
      if (fs.existsSync(this.dataFile)) {
        const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf-8'))
        if (data.snapshots && data.snapshots.length > 0) {
          this.store = data
          const first = data.snapshots[0]
          this.startEquityBot = first.bot.equity
          this.startEquityVault = first.vault.equity
          console.log(`Loaded ${data.snapshots.length} existing PnL snapshots from ${this.dataFile}`)
          return true
        }
      }
    } catch (error) {
      console.warn('Could not load existing PnL data:', error)
    }
    return false
  }

  getSnapshotCount(): number {
    return this.store.snapshots.length
  }
}
