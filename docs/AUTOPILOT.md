# AUTOPILOT — 24h polish loop

> Loop started: **2026-07-10 ~12:00 PT** · Ends: **2026-07-11 ~12:00 PT** (24h)
> Mode: goals-over-steps. One iteration per wakeup: sweep → fix the biggest gap →
> verify → ship → log → reschedule.

## GOAL

A trader who has never seen cash.trading can, on desktop **and** phone:
connect a wallet, find any of the ~60 markets, read a live chart, place and
close a trade, and see their positions / balances / order history — each
within seconds, with zero broken UI, zero fake data, and zero dead ends.
Feature-parity reference: **app.decibel.trade** — when unsure what a surface
should do, check what Decibel's official app does.

## HOUSE RULES (non-negotiable)

1. **main is always green.** `npx tsc --noEmit` clean and `npx next build`
   passing before every push. Never push red.
2. **Never grade your own work.** Verify in the real running app via
   agent-browser, then hand screenshots/outputs to a **fresh subagent** that
   judges against the BAR below. The builder does not certify the build.
3. **Real data or honest emptiness.** No placeholder numbers, no fake
   fallbacks ("$29.3M"), no seeded curves presented as real. Unavailable
   data shows a dash or an honest empty state.
4. **Surgical diffs.** Match existing patterns and commit style (conventional
   commits, wired bodies explaining the why). No drive-by rewrites.
5. **One gap per iteration.** Fix the single worst thing, ship it, move on.
   Depth beats breadth; a shipped small fix beats an unshipped big one.
6. **Do not touch:** `.env`, secrets, on-chain contract state. Never place
   trades with real funds. Read-only against mainnet.
7. **Commit + push to main after each verified fix.**
8. **Respect usage limits.** If a rate/usage-limit message appears, schedule
   the next wakeup past the limit window instead of burning retries.

## THE BAR (checkable — sweep this every iteration)

- [ ] `npx tsc --noEmit` → 0 errors; `npx next build` → success
- [ ] `/`, `/portfolio`, `/launchpad`, `/automation`, `/points` each load at
      1440px AND 390px with **zero console errors** and no layout breakage
- [ ] `/api/decibel/markets?network=mainnet` → 60 markets, categories present
- [ ] Chart loads within ~3s for one random market from EACH category
      (crypto / stocks / commodities); timeframes switch; pan + LIVE→ work
- [ ] Positions route returns named positions + overview for a live account
      (leaderboard whale is fine); open orders source = `rest`
- [ ] Order form: market + limit payloads build for a NEW market (e.g. TSLA)
      with correct tick/lot alignment (read-only — do not submit)
- [ ] Fresh-eyes subagent shown screenshots of every core page reports: no
      overlap, no dead buttons, no spinner-forever, no placeholder data, no
      unreadable text
- [ ] Mobile: market modal, chart gestures, trade form, and bottom sheet all
      usable at 390px

## ITERATION PROTOCOL (one per wakeup)

1. Ensure dev server on :3000 (restart if dead). Read the PROGRESS LOG below.
2. Sweep the BAR. List failures + any new usability gaps noticed en route.
3. Pick the **single worst** item (user-visible breakage > data wrongness >
   friction > polish).
4. Fix it.
5. Verify: exercise the flow in agent-browser; spawn a fresh subagent to
   judge the evidence against the BAR. If it fails judgment, keep working —
   do not ship.
6. `tsc` + build + commit + push to main.
7. Append a PROGRESS LOG entry: `## <UTC timestamp> — <what> · <evidence> · <next-largest gap>`.
8. Schedule the next wakeup (60–270s while iterating; 1200s+ only if blocked
   externally). After 24h from loop start: write FINAL SUMMARY, report, stop.

## WHEN THE BAR IS GREEN (2 consecutive sweeps)

Work this backlog, same protocol, one item per iteration:

- Trade-flow latency: time from market switch → first candle painted; get it
  under 1.5s (cache bootstrap, parallelize, skeleton states)
- Order book & positions: resize/jank pass; virtualize if needed
- Portfolio page: PnL history chart quality to match the new trade chart
- Mobile gestures: pinch-zoom on chart, swipe between markets, sheet physics
- Empty/error states: every surface has a designed empty state, not a blank
- Wallet connect flow: every wallet in the modal actually connects or links
  to install; reconnect-on-refresh works
- Launchpad: deploy rail end-to-end sanity on testnet, feed cards honest
- Points page: real data or honest "season not started"
- Perf: Lighthouse mobile ≥ 85 on /; kill layout shift on chart load
- A11y quick pass: focus states, aria labels on icon buttons, contrast

## PROGRESS LOG

(append-only; newest last)
