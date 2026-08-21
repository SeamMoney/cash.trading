/**
 * Personal Strategy Runner — one catalog Pine strategy, one closed bar, one
 * user subaccount.
 *
 * This is the vault product with the vault removed. A connected owner picks a
 * `lib/sealed-catalog.ts` strategy, a market and a bar interval; the cron calls
 * `runPersonalStrategyTick` once a minute; the SAME evaluator a sealed vault
 * attests with (`createStrategyRunner`) produces the signal, and the engine
 * trades the USER's own Decibel subaccount through the operator key. No pooled
 * capital, no depositors, no on-chain commitment — so the guarantee is weaker
 * than a sealed vault's and this file must not pretend otherwise.
 *
 * What it still refuses to do, for the same reasons the attestor refuses:
 *
 *  - Evaluate a strategy the on-chain evaluator cannot run. `unsupported`
 *    non-empty means the signal was derived from values that were never
 *    computed; "neutral" would be a lie, so the tick fails instead.
 *  - Evaluate a forming candle. Bars come from `fetchClosedBars`, which drops
 *    the in-progress candle — a strategy scored mid-bar flips between sides
 *    several times inside one minute and trades every flip.
 *  - Evaluate on a short series. Fewer bars than the strategy's warmup and the
 *    evaluator returns "neutral" by construction, which is indistinguishable
 *    from a real neutral. That is refused with the bar count, not traded.
 *  - Size ABOVE what the user authorised. A self-sizing script's
 *    `default_qty_value` / `margin_long` only ever clamp the user's caps DOWN.
 *
 * Cadence is owned here, not by the cron: `lastBarTs` is advanced with a
 * compare-and-set, so two overlapping invocations cannot both act on one bar.
 * Claiming the bar happens BEFORE execution, which means a bar whose execution
 * fails is not retried — one closed bar produces at most one attempt, and the
 * next bar re-evaluates from scratch. Retrying a stale bar is how a runner
 * ends up entering a move that already reversed.
 *
 * `runPersonalStrategyTick` never throws: the cron logs its result and counts
 * failures from it, so every fault has to come back as `{ ok: false, stage }`.
 */
import { createHash } from 'node:crypto'

import type { BotInstance } from '@prisma/client'
import { Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk'

import { prisma } from '@/lib/prisma'
import { getActiveNetwork } from '@/lib/decibel-sdk'
import {
  VolumeBotEngine,
  type BotConfig,
  type SignalAction,
  type SignalExecutionResult,
} from '@/lib/bot-engine'
import {
  fetchClosedBars,
  isClosedBarInterval,
  latestClosedBarOpenMs,
  MAX_CLOSED_BARS,
  type ClosedBar,
  type ClosedBarInterval,
} from '@/lib/decibel-candles'
import { findCatalogStrategy } from '@/lib/sealed-catalog'
import { canonicalizePine } from '@/lib/sealed-presets'
import { transpileV3 } from '@/lib/launchpad/transpiler-v3'
import { createStrategyRunner } from '@/lib/strategy-equivalence'
import { requestedLeverageX100, requestedPctBps } from '@/lib/pine-declarations'

export type PersonalSignal = 'buy' | 'sell' | 'neutral'

/** Stages, in the order a tick passes through them. */
export type PersonalTickStage = 'bars' | 'evaluate' | 'cas' | 'execute' | 'persist'

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
  /**
   * Why the program cannot be trusted, if it cannot: unknown strategy id,
   * transpiler errors, or IR ops the evaluator cannot execute. Non-empty means
   * `signal` must not be traded — including when it is `"neutral"`.
   */
  unsupported: string[]
  requestedPctBps?: number
  requestedLeverageX100?: number
}

/**
 * Extra closed bars fetched beyond the strategy's warmup.
 *
 * Warmup is the minimum the evaluator needs before it stops returning
 * "neutral"; running with exactly that leaves EMA seeds and RSI averages at
 * their least settled, so the first live signals would differ from the same
 * strategy running continuously. 50 bars of margin costs one request.
 */
const WARMUP_MARGIN_BARS = 50

/** Leverage a pine bot gets when it stored none. Deliberately not the engine's 5x. */
const PINE_DEFAULT_LEVERAGE_X = 3

/** Ceiling on leverage for pine bots, mirroring the start route's env cap. */
function maxPineLeverageX(): number {
  const raw = Number(process.env.BOT_MAX_LEVERAGE_X)
  if (!Number.isFinite(raw) || raw < 1) return PINE_DEFAULT_LEVERAGE_X
  return Math.floor(raw)
}

interface CatalogProgram {
  runner: ReturnType<typeof createStrategyRunner>
  canonical: string
  warmupBars: number
  requestedPctBps: number | null
  requestedLeverageX100: number | null
}

/**
 * Resolve, canonicalise, transpile and build the evaluator for one catalog id.
 *
 * Shared by `evaluateCatalogSignal` and the tick so there is exactly ONE
 * definition of "what program does this strategy id mean". A second copy is
 * how a cron starts trading a program the status endpoint would have refused.
 *
 * The steps mirror `performTick` in lib/sealed-tick.ts (steps 2-3). There is no
 * on-chain commitment to reproduce — a personal runner commits to nothing —
 * but the tick still checks the pinned `scriptHash`, which is the same refusal
 * in the only form available without a chain.
 */
function buildCatalogProgram(
  strategyId: string,
  marketAddr: string,
): { program: CatalogProgram; unsupported: string[] } | { program: null; unsupported: string[] } {
  const entry = findCatalogStrategy(strategyId)
  if (!entry) {
    return { program: null, unsupported: [`unknown catalog strategy: ${strategyId}`] }
  }

  const canonical = canonicalizePine(entry.script)
  const t = transpileV3(canonical, undefined, { target: 'vault', marketAddr })
  if (t.errors?.length) {
    return { program: null, unsupported: t.errors.map((e) => `transpile: ${e}`) }
  }

  const runner = createStrategyRunner(t.ir)
  // Statically populated at construction (collectUnsupportedStrategyIR), so
  // this is truthful before a single bar is pushed — an unsupported op hidden
  // in a branch that has not fired yet still shows up here.
  if (runner.unsupported.size > 0) {
    return { program: null, unsupported: [...runner.unsupported] }
  }

  return {
    program: {
      runner,
      canonical,
      warmupBars: runner.warmupBars,
      requestedPctBps: requestedPctBps(canonical),
      requestedLeverageX100: requestedLeverageX100(canonical),
    },
    unsupported: [],
  }
}

/** The hash `/api/bot/start` pins into `BotInstance.scriptHash`. Must stay
 *  byte-identical to that route's computation or every bot refuses to run. */
export function pineScriptHash(canonicalPine: string): string {
  return createHash('sha256').update(canonicalPine, 'utf8').digest('hex')
}

/** Push a whole series and keep the last signal. The evaluator is stateful:
 *  every close must go through it in order or the indicators are wrong. */
function finalSignal(program: CatalogProgram, closes: number[]): PersonalSignal {
  let signal: PersonalSignal = 'neutral'
  for (const c of closes) signal = program.runner.pushBar(c)
  return signal
}

/**
 * The signal one catalog strategy produces over a closed-price series.
 *
 * Pure and network-free — the same call the tick makes internally, exposed so
 * tests and the status route can ask "what would this strategy say right now"
 * without signing anything.
 */
export function evaluateCatalogSignal(input: {
  strategyId: string
  closes: number[]
  marketAddr: string
}): CatalogSignalResult {
  const built = buildCatalogProgram(input.strategyId, input.marketAddr)
  if (!built.program) {
    return { signal: null, unsupported: built.unsupported }
  }
  const { program } = built

  const declared = {
    ...(program.requestedPctBps !== null ? { requestedPctBps: program.requestedPctBps } : {}),
    ...(program.requestedLeverageX100 !== null
      ? { requestedLeverageX100: program.requestedLeverageX100 }
      : {}),
  }

  const closes = input.closes.filter((c) => Number.isFinite(c) && c > 0)
  if (closes.length !== input.closes.length) {
    return {
      signal: null,
      unsupported: [
        `price series contains ${input.closes.length - closes.length} non-positive or non-finite close(s)`,
      ],
      ...declared,
    }
  }
  if (closes.length < program.warmupBars) {
    return {
      signal: null,
      unsupported: [`needs ${program.warmupBars} bars of warmup, got ${closes.length}`],
      ...declared,
    }
  }

  const signal = finalSignal(program, closes)
  // Cheap re-check: the set is static today, but if the evaluator ever
  // discovers an op at runtime again, a signal computed from missing values
  // must not be reported as a signal.
  if (program.runner.unsupported.size > 0) {
    return { signal: null, unsupported: [...program.runner.unsupported], ...declared }
  }
  return { signal, unsupported: [], ...declared }
}

/**
 * Actions that actually reached the matching engine.
 *
 * `executeSignal` returns a SENTINEL in `txHash` for the quiet outcomes
 * ('flat', 'same_side', 'protected'), because every path has to return an
 * `OrderResult`. Reporting one of those as a transaction hash would make the
 * cron count a bar on which nothing happened as an executed trade, and would
 * write an OrderHistory row pointing at a hash that does not exist.
 */
const TRADING_ACTIONS: ReadonlySet<SignalAction> = new Set<SignalAction>([
  'opened',
  'flipped',
  'closed',
])

/**
 * Record what the bar did.
 *
 * `executeSignal` deliberately does no bookkeeping — it does not create
 * OrderHistory rows and does not move `cumulativeVolume` / `currentCapitalUsed`
 * — so this is the only place a pine trade is written down. That matters
 * beyond reporting: the cron stops a bot at `currentCapitalUsed >= capitalUSDC`,
 * so a runner that skipped this would leave the user's stated loss budget
 * unenforced and the bot running until the collateral was gone.
 *
 * Counters move by atomic `increment` rather than read-modify-write, because
 * the row in hand was read before the trade and two bots sharing a subaccount
 * would otherwise clobber each other's volume.
 */
async function recordSignalOutcome(args: {
  bot: BotInstance
  signal: PersonalSignal
  result: SignalExecutionResult
  traded: boolean
  leverageX: number
}): Promise<void> {
  const { bot, signal, result, traded, leverageX } = args
  const signalFields = { lastSignal: signal, lastSignalAt: new Date() }

  if (!traded) {
    await prisma.botInstance.update({ where: { id: bot.id }, data: signalFields })
    return
  }

  const order = await prisma.orderHistory.create({
    data: {
      botId: bot.id,
      sessionId: bot.sessionId,
      txHash: result.txHash,
      direction: result.direction,
      strategy: 'pine',
      // Chain units, and an integer column: a fractional size here would throw
      // out of BigInt() and lose the whole record of a trade that happened.
      size: BigInt(Math.max(0, Math.round(result.size || 0))),
      volumeGenerated: result.volumeGenerated || 0,
      success: result.success,
      entryPrice: result.entryPrice,
      exitPrice: result.exitPrice,
      pnl: result.pnl ?? 0,
      positionHeldMs: Math.max(0, Math.round(result.positionHeldMs ?? 0)),
      market: bot.marketName,
      leverage: leverageX,
      userSubaccount: bot.userSubaccount,
    },
  })

  // Same eligibility path as every other bot trade. Omitting it would silently
  // pay pine users nothing for volume that earns everyone else a reward.
  const { recordCashRewardForTrade } = await import('@/lib/cash-rewards')
  recordCashRewardForTrade({
    orderHistoryId: order.id,
    sourceId: `order:${order.id}`,
    userWalletAddress: bot.userWalletAddress,
    userSubaccount: bot.userSubaccount,
    sourceTxHash: result.txHash,
    volumeGenerated: result.volumeGenerated || 0,
    market: bot.marketName,
    strategy: 'pine',
  }).catch((rewardError) => {
    console.error('⚠️  [pine] CASH reward eligibility check failed:', rewardError)
  })

  const realizedLoss = result.pnl != null && result.pnl < 0 ? Math.abs(result.pnl) : 0
  const updated = await prisma.botInstance.update({
    where: { id: bot.id },
    data: {
      ...signalFields,
      cumulativeVolume: { increment: result.volumeGenerated || 0 },
      ordersPlaced: { increment: 1 },
      currentCapitalUsed: { increment: realizedLoss },
      lastOrderTime: new Date(),
    },
  })

  // Decided on the totals the database actually holds after the increments,
  // never on the pre-trade snapshot.
  if (
    updated.cumulativeVolume >= updated.volumeTargetUSDC
    || updated.currentCapitalUsed >= updated.capitalUSDC
  ) {
    await prisma.botInstance.update({ where: { id: bot.id }, data: { isRunning: false } })
  }
}

/** Caps the user authorised, narrowed by whatever the script asks for itself. */
function resolveSizing(
  bot: BotInstance,
  program: CatalogProgram,
): { capitalUSDC: number; leverageX: number } {
  const leverageCap = maxPineLeverageX()
  const userLeverage = Math.max(1, Math.min(bot.leverageX ?? PINE_DEFAULT_LEVERAGE_X, leverageCap))
  // Self-sizing is a request, never a grant: `Math.min` in both directions is
  // the whole rule. A script asking for 10x on a 3x bot gets 3x.
  const askedLeverage =
    program.requestedLeverageX100 !== null
      ? Math.max(1, Math.floor(program.requestedLeverageX100 / 100))
      : userLeverage
  const leverageX = Math.min(userLeverage, askedLeverage)

  const askedCapital =
    program.requestedPctBps !== null
      ? (bot.capitalUSDC * program.requestedPctBps) / 10_000
      : bot.capitalUSDC
  const capitalUSDC = Math.max(0, Math.min(bot.capitalUSDC, askedCapital))

  return { capitalUSDC, leverageX }
}

const fail = (
  stage: PersonalTickStage,
  error: string,
  barTs: number | null = null,
  signal: PersonalSignal | null = null,
): PersonalTickResult => ({ ok: false, signal, barTs, stage, error })

const errText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : fallback

/**
 * One tick for one personal strategy bot.
 *
 * `bot.market` is the SDK-resolved market address (the cron re-resolves it
 * every invocation, so a testnet reset cannot strand the bot on a dead
 * address). `operatorKey` is BOT_OPERATOR_PRIVATE_KEY already stripped of its
 * prefix and newlines; the engine re-reads the same variable itself, so this
 * is parsed here purely to turn a malformed key into one clear error instead
 * of a throw from deep inside the engine constructor.
 */
export async function runPersonalStrategyTick(
  bot: BotInstance,
  operatorKey: string,
): Promise<PersonalTickResult> {
  try {
    // ── 1. The row has to describe a runnable program ────────────────────
    const interval: unknown = bot.barInterval
    if (!isClosedBarInterval(interval)) {
      return fail('bars', `bot has no usable bar interval (${String(bot.barInterval)})`)
    }
    const barInterval: ClosedBarInterval = interval
    if (!bot.strategyId) {
      return fail('evaluate', 'bot has no strategyId')
    }

    const built = buildCatalogProgram(bot.strategyId, bot.market)
    if (!built.program) {
      return fail('evaluate', `evaluator cannot run ${bot.strategyId}: ${built.unsupported.join(', ')}`)
    }
    const { program } = built

    // The catalog entry must still be the script the user started. `/api/bot/start`
    // pins the hash for exactly this check, which is the personal runner's
    // stand-in for the sealed vault's commitment comparison: a catalog edit
    // must stop a running bot, not silently change what it trades.
    if (bot.scriptHash) {
      const current = pineScriptHash(program.canonical)
      if (current !== bot.scriptHash.trim().toLowerCase().replace(/^0x/, '')) {
        return fail(
          'evaluate',
          `${bot.strategyId} no longer matches the script this bot was started with `
            + `(pinned ${bot.scriptHash.slice(0, 12)}…, catalog now ${current.slice(0, 12)}…)`,
        )
      }
    }

    // ── 2. Skip before spending a request when no bar has closed ─────────
    // At 5m/15m most invocations land inside a bar the runner has already
    // acted on. Checking the clock first keeps those ticks free.
    const expectedBarTs = latestClosedBarOpenMs(barInterval)
    if (bot.lastBarTs !== null && BigInt(expectedBarTs) <= bot.lastBarTs) {
      return { ok: true, signal: null, barTs: Number(bot.lastBarTs), stage: 'cas' }
    }

    // ── 3. Closed bars ───────────────────────────────────────────────────
    const wanted = Math.min(program.warmupBars + WARMUP_MARGIN_BARS, MAX_CLOSED_BARS)
    let bars: ClosedBar[]
    try {
      bars = await fetchClosedBars(bot.market, barInterval, wanted, getActiveNetwork(), {
        marketName: bot.marketName,
      })
    } catch (err) {
      return fail('bars', errText(err, 'closed candles unavailable'))
    }
    if (bars.length < program.warmupBars) {
      return fail(
        'bars',
        `only ${bars.length} closed ${barInterval} bars for ${bot.marketName}, need ${program.warmupBars} for ${bot.strategyId}`,
      )
    }

    const barTs = bars[bars.length - 1].t
    // The indexer, not our clock, is the authority on which bar is last.
    if (bot.lastBarTs !== null && BigInt(barTs) <= bot.lastBarTs) {
      return { ok: true, signal: null, barTs, stage: 'cas' }
    }

    // ── 4. Evaluate ──────────────────────────────────────────────────────
    let signal: PersonalSignal
    try {
      const closes = bars.map((b) => b.c)
      if (closes.some((c) => !Number.isFinite(c) || c <= 0)) {
        return fail('evaluate', 'closed bar series contains a non-positive close')
      }
      signal = finalSignal(program, closes)
      if (program.runner.unsupported.size > 0) {
        return fail(
          'evaluate',
          `evaluator hit unsupported ops: ${[...program.runner.unsupported].join(', ')}`,
          barTs,
        )
      }
    } catch (err) {
      return fail('evaluate', errText(err, 'strategy evaluation failed'), barTs)
    }

    // ── 5. Claim the bar ─────────────────────────────────────────────────
    // Compare-and-set, not read-then-write: two overlapping cron invocations
    // both see the same `lastBarTs` and would otherwise both trade this bar.
    // Whoever's UPDATE matches a row owns it; the loser does nothing.
    try {
      const claimed = await prisma.botInstance.updateMany({
        where: { id: bot.id, OR: [{ lastBarTs: null }, { lastBarTs: { lt: BigInt(barTs) } }] },
        data: { lastBarTs: BigInt(barTs) },
      })
      if (claimed.count === 0) {
        return { ok: true, signal, barTs, stage: 'cas' }
      }
    } catch (err) {
      return fail('cas', errText(err, 'claiming the bar failed'), barTs, signal)
    }

    // ── 6. Execute ───────────────────────────────────────────────────────
    // From here the bar is spent. A failure below is reported, not retried:
    // the next closed bar re-evaluates against the position that actually
    // exists on chain, which is safer than re-running a stale signal.
    let result: SignalExecutionResult
    let leverageX: number
    try {
      try {
        Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(operatorKey) })
      } catch (err) {
        return fail('execute', `operator key is unusable: ${errText(err, 'unparseable')}`, barTs, signal)
      }

      const sizing = resolveSizing(bot, program)
      leverageX = sizing.leverageX
      const config: BotConfig = {
        userWalletAddress: bot.userWalletAddress,
        userSubaccount: bot.userSubaccount,
        capitalUSDC: sizing.capitalUSDC,
        volumeTargetUSDC: bot.volumeTargetUSDC,
        bias: bot.bias as 'long' | 'short' | 'neutral',
        strategy: 'pine',
        market: bot.market,
        marketName: bot.marketName,
        leverageX: sizing.leverageX,
        // Passed through as the user stored them. The pine DEFAULTS — stop at
        // min(2%, 0.5/leverage), no take profit — live in the engine's
        // `getExitThresholds()`, which knows the market-clamped leverage the
        // position actually gets. Recomputing them here would be a second,
        // slightly wrong copy of the same rule.
        stopLossPct: bot.stopLossPct,
        takeProfitPct: bot.takeProfitPct,
      }

      // Constructed per tick, exactly as /api/bot/tick does. `lastTwapOrderTime`
      // is deliberately NOT restored: it gates the high-risk strategy's own
      // cadence, and importing that cooldown here would silently drop bars the
      // strategy asked to trade.
      const engine = new VolumeBotEngine(config)
      result = await engine.executeSignal(signal)
    } catch (err) {
      return fail('execute', errText(err, 'signal execution failed'), barTs, signal)
    }

    const traded = result.success && TRADING_ACTIONS.has(result.action) && Boolean(result.txHash)

    // ── 7. Record the signal, and the trade if there was one ─────────────
    // Separate from the claim in step 5 so the claim stays a single-column
    // compare-and-set. The trade has already happened by now; a failure here
    // is a bookkeeping fault, and it still reports the hash so the tx is not
    // lost to the operator just because the write failed.
    const txField = traded ? { txHash: result.txHash } : {}
    try {
      await recordSignalOutcome({ bot, signal, result, traded, leverageX })
    } catch (err) {
      return {
        ok: false,
        signal,
        barTs,
        stage: 'persist',
        error: errText(err, 'recording the tick failed'),
        ...txField,
      }
    }

    return {
      ok: result.success,
      signal,
      barTs,
      stage: 'execute',
      ...txField,
      ...(result.success
        ? {}
        : { error: result.error ?? `signal execution ${result.action}` }),
    }
  } catch (err) {
    // The cron counts failures from this result; an escaping throw would be
    // counted by the generic handler as an unattributed bot error instead.
    return fail('execute', errText(err, 'personal strategy tick failed'))
  }
}
