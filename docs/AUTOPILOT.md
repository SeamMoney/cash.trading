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

## 2026-07-10T07:45Z — Iteration 1: dither background legibility (judge findings #1+#2)

Sweep: tsc 0 · markets 60 w/ categories · positions 54 named + openOrders=rest
(warm) · 0 console errors on all 5 pages · per-category candles < 1s warm.
Fresh-eyes judge (full audit) returned 20 ranked findings; #1/#2 were one root
cause: the yellow Dithering shader bled through translucent cards on
/automation and /points, making the bot config form and leaderboard barely
readable. Fix: colorFront #ffff00→#5a5a00 + dim overlay 60%→80% in
components/dashboard/background.tsx. Verify: independent judge = PASS.

Judge backlog (worst first, remaining): (3) points page shows $0.00 zeros +
6s spinner instead of skeletons on load; (4) Portfolio header broken — dim
".trading" logo + duplicate gray Sign In button; (5) mobile home chart y-scale
clips flat at container top; (6) ~700px dead void below mobile order panel;
(7) strategy-vault cards: identical vault addr + "last price" on different
strategies, two dead purple chart rects, all "WIN RATE 100%"; (8) portfolio
PnL chart renders as disconnected dashes (looks broken) when logged out;
(9) chart mode toggle clips last x-axis label; (10) "YOU ARE LONGING" copy →
"You are long"; (11) inconsistent empty states (+$0.00 green vs —);
(12) launchpad list hard-clips mid-row, no scroll affordance; (13) Execution:
WAITING badge with no wallet; (14) automation sub-tabs reuse main-nav names,
High-Risk default; (15) "DECIBEL VAULTS [0]" dead header; (16) mobile
portfolio tab row clipped; (17) disabled Withdraw with no reason; (18) price
mid-flip glyph artifact; (19) duplicate connect-wallet copy; (20) Unlock
button with no context. Dev-overlay "1 Issue" pill flagged — read dev log.

## 2026-07-10T08:05Z — Iteration 2: points global stats skeletons (judge #3)

The four global tiles rendered "$0.00 / 0 / 0" hard zeros while the first
fetch was in flight (`globalStats?.x || 0`). Added a `globalStat` helper in
components/points/points-stats.tsx: pulsing skeleton while globalStats is
null, real value after. Loaded state verified live ($23.78M / 2,517,865 /
125); independent judge = PASS on both the code path and the screenshot.
Dev-overlay "1 Issue" pill: no errors in dev log or browser console now —
treating as transient. Next worst: #4 Portfolio header (dim ".trading" logo,
duplicate gray Sign In) or #5 mobile chart y-clip.

## 2026-07-10T08:20Z — Iteration 3: Portfolio header dead accent (judge #4)

Root cause: the neon accent vars live in `.cash-trade-theme`; PortfolioPage
Client's wrapper lacked the class, so the Header's `text-accent` logo half and
`bg-accent` Sign In fell back to :root's near-black accent — "broken gray
header" on that page only. Added the class to the wrapper. Verified on
desktop + mobile screenshots; independent judge = PASS. Note: portfolio PnL
chart (judge #8, disconnected dashes when logged out) confirmed still present
in the new screenshots — remains in backlog. Next worst: #5 mobile home chart
y-scale clip, #6 mobile dead void, #7 vault-card data bugs, #8 PnL chart.

## 2026-07-10T09:05Z — Iteration 4: full re-sweep + DECIBEL VAULTS self-wipe

Full bar sweep: tsc 0 · 60 markets · positions/openOrders/indexed green ·
audit4 (fresh judge, all pages, both viewports) found old items (a) mobile
chart y-clip, (b) mobile dead void, (d) PnL dashed segments now FIXED (side
effects of earlier chart/theme work). New worst: DECIBEL VAULTS section
loaded [6] then wiped to [0] on the 30s poll. Root cause (verified live):
upstream /vaults takes ~10s cold; route aborted at 8s → returned empty →
client setVaults(fetched) clobbered good data. Fix: route budget 8s→15s +
module-level last-good cache (stale:true on failure); client keeps prev
state on empty refresh. Verified: API 5/5 × 13 vaults; independent judge
watched live page across two poll cycles — count stayed [6], PASS.

Remaining backlog (worst first): (A) launchpad detail shows stale engine
prices ~7% off the live chart with no staleness cue (audit4 #3); (B) mobile
launchpad: tapping a strategy gives no visible response — detail renders
~1700px below fold, needs auto-scroll (audit4 #4); (C) portfolio PnL
zero-state renders as broken amber block (audit4 #5); (D) strategy-vault
cards: identical addr + stale identical $70k price on different strategies,
empty purple chart rects, all "WIN RATE 100%" (audit4 #2 / old #7);
(E) "YOU ARE LONGING/SHORT" copy + control ambiguity; (F) mobile 24h-volume
header clip; (G) launchpad list scroll affordance + wrapped-row status dot;
(H) minor: order-book empty rows, SMA tag overlap, stats tile wrap, double
ellipsis, leaderboard 13-20s spinner.
