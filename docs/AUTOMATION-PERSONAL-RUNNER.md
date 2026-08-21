# Personal Strategy Runner

Trade a Pine strategy on your own Decibel subaccount, with no vault.

A user picks ONE strategy from the catalog (`lib/sealed-catalog.ts`), one market, a bar
interval (1m/5m/15m), a leverage and a capital cap, and signs ONE delegation to the operator
key. Once a minute the cron evaluates that strategy on the latest CLOSED candle and, when the
signal changes, places the order on the user's own subaccount through the operator — carrying
our builder code, so the volume earns builder fees and Decibel points. Nothing is pooled: no
depositors, no NAV, no on-chain commitment.

That last point is the honest difference from the sealed vaults. A sealed vault commits its
program on chain and the Move contract enforces its bounds; this runner commits to nothing.
Its guarantees are app-side, and the sections below say exactly which.

**v1 is owner-only and cron-only.** Every route is behind `BOT_OWNER_ADDRESSES`, and the
in-process timer loop is disabled for `pine` (`lib/bot-engine.ts:runLoop`) so cadence has
exactly one owner. UI: `/automation` (`components/automation/StrategyRunner.tsx`).

## Tick lifecycle

`vercel.json` runs `/api/cron/bot-tick` every minute; the `pine` branch calls
`runPersonalStrategyTick(bot, operatorKey)` once per bot (`TRADES_PER_CRON.pine = 1`). The
stages, in order, are the values of `PersonalTickStage` in `lib/personal-runner.ts`:

| Stage | What happens | Refuses when |
|---|---|---|
| — | Cron re-resolves the market address from the SDK, so a testnet reset cannot strand the bot | — |
| `bars` | `fetchClosedBars` pulls `warmup + 50` closed candles (`lib/decibel-candles.ts`) | interval unusable, feed down, fewer bars than warmup |
| `evaluate` | Catalog script → `canonicalizePine` → `transpileV3` → `createStrategyRunner`, every close pushed in order | unknown id, unsupported IR op, pinned `scriptHash` no longer matches, non-positive/non-finite close |
| `cas` | **Claim the bar** (below) | another invocation already claimed it — returns `ok: true`, does nothing |
| `execute` | `VolumeBotEngine.executeSignal(signal)` opens / flips / closes with a stop attached | operator key unparseable, order rejected |
| `persist` | `OrderHistory` row, `cumulativeVolume` / `ordersPlaced` / `currentCapitalUsed` increments, CASH reward eligibility | DB write failed (the tx still happened; the hash is returned) |

**The compare-and-set bar claim.** Serverless invocations overlap: two crons can be in flight
on the same bot, both having read the same `lastBarTs`, and both would trade the same bar.
So the runner does not read-then-write. It issues

```ts
prisma.botInstance.updateMany({
  where: { id: bot.id, OR: [{ lastBarTs: null }, { lastBarTs: { lt: BigInt(barTs) } }] },
  data:  { lastBarTs: BigInt(barTs) },
})
```

and only the invocation whose UPDATE matched a row (`claimed.count === 1`) proceeds. The claim
happens **before** execution, which means a bar whose execution fails is *not* retried: one
closed bar produces at most one attempt, and the next bar re-evaluates against the position
that actually exists on chain. Re-running a stale signal is how a runner enters a move that
already reversed.

## Safety gates

| Gate | Where | What it does |
|---|---|---|
| Owner allowlist | `lib/bot-owner-guard.ts:denyUnlessBotOwner` | Wallet must be in `BOT_OWNER_ADDRESSES`. Unset ⇒ the whole bot API returns 503. |
| Subaccount ownership | `lib/decibel-account-verification.ts:verifyDecibelSubaccountOwnership` (via the same guard) | On-chain proof the subaccount belongs to that wallet. **Fail-closed**: a failed lookup is 503, not permission. |
| Leverage cap | `app/api/bot/start/route.ts:maxLeverageFor` + `lib/personal-runner.ts:maxPineLeverageX` | `BOT_MAX_LEVERAGE_X`, defaulting to **3x for pine** even when unset. Enforced at start and re-read every tick. |
| Self-sizing clamp | `lib/personal-runner.ts:resolveSizing` | A script's `default_qty_value` / `margin_long` only ever narrow the user's caps. 10x asked under a 3x cap ⇒ 3x; 1x asked ⇒ 1x. |
| Capital cap | `app/api/bot/start/route.ts` (`BOT_MAX_CAPITAL_USDC`) + `lib/personal-runner.ts:recordSignalOutcome` | Ceiling at start; realized losses accrue into `currentCapitalUsed` and flip `isRunning` off at the limit. |
| Mandatory stop | `lib/bot-engine.ts:getExitThresholds` | Pine default: stop at `min(2%, 0.5 / leverage)` — never more than half the margin on one bar — and **no** take profit (the strategy's next signal is the exit). Overrides must be a fraction in `(0, 0.5]`. |
| Script hash pin | `app/api/bot/start/route.ts` pins `sha256(canonicalizePine(script))`; `lib/personal-runner.ts:pineScriptHash` re-checks it every tick | A catalog edit **stops** a running bot instead of silently changing what it trades. |
| Closed bars only | `lib/decibel-candles.ts:toClosedBars`, `latestClosedBarOpenMs` | The in-progress candle is dropped, so a strategy cannot flip sides several times inside one bar. |
| Builder approval | `lib/bot-engine.ts:builderArgs` → `readApprovedBuilderFee` | Builder args are attached only when the subaccount has approved the fee; otherwise they are omitted, because the chain aborts an order citing an unapproved builder. |
| Delegation expiry | `app/api/bot/delegate/route.ts:DELEGATION_TTL_SECONDS` | 30 days, not forever. Check state with `/api/bot/check-delegation`. |
| Cron auth | `app/api/cron/bot-tick/route.ts` | `Authorization: Bearer $CRON_SECRET`, compared in constant time. 5 consecutive failed ticks and the bot stops being picked up. |

## Environment

| Variable | Meaning |
|---|---|
| `BOT_OWNER_ADDRESSES` | Comma-separated wallet allowlist. **Unset disables the bot API entirely.** |
| `BOT_MAX_LEVERAGE_X` | Server ceiling on leverage. Unset ⇒ 3x for pine (other strategies keep their historical no-ceiling behaviour). |
| `BOT_MAX_CAPITAL_USDC` | Server ceiling on `capitalUSDC` at start. Unset ⇒ no ceiling (local dev only). |
| `BOT_OPERATOR_PRIVATE_KEY` | The operator key that signs every delegated order. Read by `lib/bot-engine.ts` and the cron. |
| `CRON_SECRET` | Bearer token Vercel Cron sends to `/api/cron/bot-tick`. |

## Supervised testnet trial

1. `DECIBEL_NETWORK=testnet`, set `BOT_OWNER_ADDRESSES` to your wallet, `BOT_MAX_LEVERAGE_X=2`,
   `BOT_MAX_CAPITAL_USDC=25`. Fund the subaccount with test USDC.
2. `pnpm test:personal-runner && pnpm test:catalog` — proves the evaluator and the pinned
   hashes before anything signs.
3. `pnpm dev`, open `/automation`, connect the allowlisted wallet, sign the delegation, and
   confirm `/api/bot/check-delegation` reports `hasDelegation: true` with an expiry ~30 days out.
4. Start one bot: a **15m** interval and a low-turnover strategy for the first run, so you can
   watch each decision. `GET /api/bot/status` returns `lastSignal`, `lastSignalAt`, `lastBarTs`,
   `strategyId` and `barInterval`.
5. Drive ticks by hand rather than waiting on the cron:
   `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/bot-tick`. Every tick
   logs `signal=… bar=… stage=… ok=…`; a quiet tick (`stage=cas`, no new bar) is normal.
6. Watch on chain that the position matches the signal, that a stop order exists, and that the
   size is what the caps imply — not what the script asked for.

## Stopping and revoking

- **Stop**: `POST /api/bot/stop`. For `pine` it flattens the position, calls
  `VolumeBotEngine.cancelResidualTpSl()` to clear the leftover trigger orders, and sets
  `isRunning = false`. Stopping does not revoke anything.
- **Revoke**: the delegation is the real permission, and the app ships **no revoke route** —
  `app/api/bot/` only mints the grant. Until the 30-day TTL lapses, the operator key can still
  trade that subaccount whether or not the bot is stopped. To revoke sooner, call the
  revoke/undelegate entry function on `dex_accounts_entry` directly; check the deployed ABI
  first, and do not promise a user that path until you have executed it on testnet.
- **Kill switch for everyone**: clear `BOT_OWNER_ADDRESSES` (API returns 503) and remove the
  `/api/cron/bot-tick` entry from `vercel.json` (routes stop, delegations do not).

## Known risks

- **Fee drag can make a marginal strategy negative-EV.** Every flip pays taker fees plus the
  builder fee. On 1m bars the high-turnover catalog entries flip constantly; a strategy with a
  thin edge in a backtest that ignores fees loses money live. Treat points as the expected
  return and PnL as the risk, prefer 15m, and prefer low-turnover strategies.
- **The operator key is a single shared hot key with no on-chain spend bound.** One
  `BOT_OPERATOR_PRIVATE_KEY` trades every delegated subaccount. The sealed vaults have Move
  code enforcing `get_bounds` on size and leverage; this product has nothing equivalent. The
  leverage, capital and stop rules above are *application* code — a bug in them, or a
  compromise of the key, can trade the subaccount up to its full collateral until the
  delegation is revoked or expires. Delegate only what you can afford to lose.
- **There is no cron-side re-check of subaccount ownership.** `denyUnlessBotOwner` runs at
  start/stop/delegate; after that the cron trusts the stored row. Removing a wallet from
  `BOT_OWNER_ADDRESSES` does not stop bots it already started — stop them explicitly.
- **A bar whose execution fails is skipped, not retried** (see the CAS above). That is
  deliberate, but it means a transient RPC failure can drop an entry the strategy wanted.
- **Bar feed**: the Pyth fallback in `lib/decibel-candles.ts` covers only the benchmark
  assets; for any other market a Decibel indexer outage means the tick fails and the bar is
  skipped.
- **Not a vault, not attested.** Nothing here is verifiable by a third party after the fact.
  The pinned `scriptHash` proves only that the app was still running the script you started.
