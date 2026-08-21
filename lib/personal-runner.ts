/**
 * Personal Strategy Runner — STUB.
 *
 * E1 (data + cron) created this file only so the cron route type-checks while
 * E2 writes the real implementation. E2: replace this entire file; keep the
 * exported signatures below, which are the agreed interface.
 *
 * - `runPersonalStrategyTick(bot, operatorKey)` — `operatorKey` is the
 *   BOT_OPERATOR_PRIVATE_KEY already normalized by the cron (prefix and
 *   newlines stripped), ready for `new Ed25519PrivateKey(operatorKey)`.
 *   `bot.market` is the SDK-resolved market address.
 * - `evaluateCatalogSignal({ strategyId, closes, marketAddr })` — pure signal
 *   evaluation shared with tests and the status route.
 */
import type { BotInstance } from '@prisma/client'

export type PersonalSignal = 'buy' | 'sell' | 'neutral'

export interface PersonalTickResult {
  ok: boolean
  signal: PersonalSignal | null
  barTs: number | null
  txHash?: string
  stage?: string
  error?: string
}

export interface CatalogSignalResult {
  signal: PersonalSignal | null
  unsupported: string[]
  requestedPctBps?: number
  requestedLeverageX100?: number
}

export async function runPersonalStrategyTick(
  _bot: BotInstance,
  _operatorKey: string,
  _opts?: Record<string, unknown>,
): Promise<PersonalTickResult> {
  return { ok: false, signal: null, barTs: null, stage: 'stub', error: 'not implemented' }
}

export function evaluateCatalogSignal(_input: {
  strategyId: string
  closes: number[]
  marketAddr: string
}): CatalogSignalResult {
  return { signal: null, unsupported: ['stub: not implemented'] }
}
