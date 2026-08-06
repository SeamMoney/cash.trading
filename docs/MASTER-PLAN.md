# MASTER PLAN — Curator Vaults on Decibel

> **Vision:** anyone pastes any PineScript and gets a live, investable vault on
> Decibel whose curator is *physically unable* to trade anything but the
> published strategy — restrictions enforced by Move, prices from Decibel's
> oracle, source verifiable by depositors. Aptos/Decibel only until engagement
> proves it; then port the pattern to Hyperliquid (HyperEVM vault protocol —
> their native vaults cost 10k USDC and are officially "legacy").

## Why this wins (proven, not aspirational)
- The full pipeline ran end-to-end on testnet: Pine → Move vault module →
  compile → publish → oracle-priced `tick_oracle` flips with NAV sizing
  (txs 0x5144f6…, 0x1c1163…), and the UI rail now does paste→LIVE.
- The curator-trust model is categorical: Decibel vault delegates dex actions
  to the strategy MODULE object — no human ever holds the keys.
- Same-transaction read→decide→trade (impossible on HyperEVM's async CoreWriter).

## Workstreams

### WS1 — Transpiler completeness (owner: UI session)
Goal: 9/9 Deploy presets transpile + pass the equivalence gate.
1. Dynamic history indexing (`series[i]`) — sole blocker for 4/9 presets.
2. OHLCV buffer + keeper pushes candles (source `/api/decibel/candlesticks`) —
   makes ATR/stoch/supertrend/VWAP honest; kills the close-only aliasing of
   high/low/open.
3. Running-state EMA/RSI in IndicatorState (exact Pine parity; equivalence
   data: recompute-from-buffer leaves 2/437 and 5/437 divergent bars).
4. Per-series history buffers (fixes pivot source-arg mis-binding).

### WS2 — Deploy pipeline: paste → LIVE vault, fully automated (owner: UI session, libs: backend)
Status: transpile→compile→publish DONE in the rail. Remaining:
1. **Equivalence gate as a hard pre-publish step** in deploy-vault
   (`lib/strategy-equivalence.ts#checkEquivalence`, candles from our API;
   reject + render divergences).
2. Wallet steps in the rail: `create_and_fund_vault` → `create_strategy_vault`
   (indicator addr = `createResourceAddress(pkg, moduleName)`) →
   `delegate_dex_actions_to`.
3. Registry write (Prisma StrategyVault) + show in STRATEGY VAULTS feed.
4. Auto-crank: keeper sweep must `tick_oracle` EVERY active registered vault,
   not just the default (app/api/launchpad/crank).

### WS3 — Verifiability chain (owner: backend session + agents)
Goal: a depositor can verify a vault's bytecode ⇄ published PineScript.
1. StrategyArtifact registry (Prisma): sourceHash, pine, moveSource,
   transpilerVersion, marketAddr, packageAddress, equivalence report.
2. On-chain commitment: write sourceHash into the indicator's proprietary
   config slot at deploy time.
3. Full verify implementation behind `/api/launchpad/verify`: hash recompute +
   pinned-transpiler re-emission diff (+ later bytecode recompile compare).
4. "Verified source" badge data on vault cards.
(Shelby/decentralized pinning = later upgrade of artifact storage; DB first.)

### WS4 — Curator rules layer (owner: UI session/contracts; spec: agent)
Enforced TODAY: market bound at creation; module-only trading via delegation;
pct-of-NAV cap ≤100%; creator-only pause; oracle-priced ticks.
TO SPEC then implement: per-vault max leverage; drawdown auto-pause;
profit-share/fee config; deposit caps; curator identity binding.
Deliverable first: docs/CURATOR-RULES.md enforcement matrix (agent-drafted).

### WS5 — Operations
1. ~~Multi-vault crank cadence (post-WS2.4); move to VPS for reliability.~~
   **DONE** — fly.io app `cash-trading-jdma7a` (sjc), `infra/fly/`.
2. ~~**VPS decision (USER)**: one box runs prod compile service + crank loop +
   depth capture. Blocks prod deploy-from-UI (Vercel has no aptos CLI).~~
   **CLOSED 2026-08-06.** The box exists and runs the crank loop and depth
   capture. The compile service was **dropped, not deferred**: the sealed rail
   never compiles Move at runtime. The transpiler emits Move source only to
   HASH it into the program commitment, and `sealed_vault` / `portfolio_vault`
   are published once by us rather than per vault — so "Vercel has no aptos
   CLI" stopped being a blocker when the sealed design replaced the
   per-vault-package rail. The Aptos CLI has been removed from the Fly image.
3. ~~Depth-capture worker~~ **DONE** — running, 15s cadence, 39 markets. This is
   now the main reason the Fly box exists: depth cannot be backfilled.
4. Monitoring: crank failures, sponsor balance. **NOT BUILT.** (Compile queue
   dropped with the compile service.)
5. **Attestor placement — decided 2026-08-06: Vercel Cron.**
   `app/api/cron/sealed-tick` loops every vault in one invocation, reads each
   one's encrypted source from the registry, and routes single-market vs
   portfolio vaults to the right Move module. The Fly `attestor` process took a
   single `--vault` with its Pine from a flag — one machine per vault, and no
   knowledge of `portfolio_vault`. It has been removed from `fly.toml`.
   `scripts/sealed-attestor-runner.ts` stays as a local dev/simulate tool; it is
   no longer a deployment target. Vercel Cron's 1/minute floor equals the
   contract's `min_bar_interval_s` floor, so the cadence is not a compromise.

### WS6 — Later (explicitly deferred)
- Aptos mainnet deploys (sponsor/payer policy, real-money gates).
- Hyperliquid port: same modules conceptually, executor via HyperEVM
  CoreWriter; revisit when engagement justifies it.
- Decibel data API as a product (llms.txt + rate limits shipped; OpenAPI later).

## Definition of done — "v1 curator launch" (testnet)
A stranger can: paste Pine → see equivalence report → sign 3 wallet txs →
their vault appears in the feed with live oracle cranks → a depositor can
invest and independently verify the source. Zero manual steps by us.
