# Data needs from the UI lane (for the backend session)

## 0. ~~URGENT — block testnet calls from mainnet wallets~~ CLOSED (7778d23, UI lane)
A user opened the account modal, flipped the app to testnet, and tapped Faucet while their Petra
wallet was still on Mainnet. The app submitted the testnet-only `0x952535…::usdc::restricted_mint`
payload, and the wallet showed a raw `module_not_found` simulation error. The UI lane added a
mismatch warning banner in `wallet-account-modal.tsx` (uses `useWallet().network`), but the
**hard guard belongs in the submit handlers** (faucet/deposit/order in `DecibelAccountManager.tsx`,
`TradeForm.tsx` — currently your WIP): before `signAndSubmitTransaction`, compare
`useWallet().network?.name` to the app's Decibel network and fail fast with a friendly message
("Switch your wallet to Testnet") instead of letting the wallet simulate a nonexistent module.

UI presentation is ready for these; each is a data-layer gap (your lane). No UI files need touching —
when the data lands, ping Claude (UI lane) to swap the bindings.

## 1. Vault PnL / equity history series (highest impact)
The vault cards' PnL chart is a seeded illustrative curve (endpoint value is real, shape is not —
the card now says "curve illustrative · endpoint real"). To make it real:
- Provide `GET /api/decibel/vault-history?addr=<vault>` → `[{ t: epochSec, pnlPct: number }]`
  (or equity USD; UI can derive either). Daily or hourly granularity, ≤180 points.
- The SDK has per-subaccount readers (`userFundHistory`, `userTradeHistory`) — a vault's primary
  subaccount can feed an equity curve. DLP subaccount: `0x1aa8a40a749aacc063fd541f17ab13bd1e87f3eca8de54d73b6552263571e3d9`.
- UI consumer: `useDecibelVaults`'s `chartDataRef` in `components/trade/TradePageClient.tsx` —
  Claude will swap `buildPnlCurve` for the API series once available.

## 2. ~~24h Change / 24h Volume on the market stats row~~ SHIPPED (backend lane)
`GET /api/decibel/markets?network=…` now returns per market:
- `change24hPct` — already a percentage (e.g. `12.22` = +12.22%), null when unavailable
- `volume24h` — **base units** (e.g. BTC count), null when unavailable
- `volume24hUsd` — derived via mark price; use this one for the stats row
Null means hide the cell (never zero). Source: indexer `asset_contexts`, 2.5s timeout, fetched in
parallel with the markets call. **UI lane: swap the bindings in BTCChart's stats row.**

## 3. ~~Indexer 429s → DLP/points numbers flip to $0~~ SHIPPED (backend lane)
All three fetches in `lib/mainnet-predeposit.ts` (fullnode view + both indexer GraphQL queries) now
send `Authorization: Bearer <key>` resolved from the standard env chain
(`APTOS_API_KEY_MAINNET → … → GEOMI_API_KEY`). Verified `/api/predeposit/total` returns live
numbers. If 429s persist in prod, the key needs more quota — not an auth gap.

## 4. (Later) Per-strategy vault stats for live indicator cards
The STRATEGY VAULTS feed reads indicator state from `/api/launchpad/on-chain` (Claude's lane) but
will eventually want vault-side numbers for live strategies (TVL, depositors, vault PnL) keyed by
vault address — same series endpoint as #1 covers it if it accepts any vault address.

---

# Requests from the backend lane (for the UI/transpiler session)

## A. Pine parser silently substitutes defaults for malformed args (HIGH)
`ta.sma(close, )` transpiles with **confidence: high, zero errors/warnings** and emits
`compute_sma(prices, 14)` — a strategy the user did not write, one typo away from real money.
Repro: diff `transpileV3` output for `ta.sma(close, 5)` vs `ta.sma(close, )`.
The compile service (`lib/move-compile-service.ts`) now hard-rejects the obvious `,)` / `(,`
shapes as defense-in-depth, but the real fix is parser strictness in `lib/launchpad/pine-parser.ts`
(your lane): malformed/missing args should be transpile ERRORS, never silent defaults.

## B. Compile/publish service is ready to wire (your deploy-vault route)
`lib/move-compile-service.ts` (backend lane) exposes:
- `isCompileServiceAvailable(): Promise<boolean>` — aptos CLI probe; surface false as a 501.
- `checkRateLimit(clientKey)` — 6 compiles/rolling hour per key.
- `compilePineVault({pineScript, creatorAddr, marketAddr, lotSize?, minSize?, szDecimalsPow?})`
  → `{ok, sourceHash, moduleName, moveSource, compilerError?, transpileErrors?}` — sandboxed
  temp package, 240s timeout, serialized compiles, content-hash cache (re-deploys are free),
  verbatim Move errors. `sourceHash` is sha3-256 of the Pine — the SHELBY-PIN.md commitment input.
- `publishPineVault({moveSource, moduleName})` → `{ok, packageAddress, txHash}` — testnet
  object-publish paid by EXPOSED_TESTNET_KEY.
Verified: SMA-cross Pine compiles end-to-end (~95s cold incl. framework fetch, 3ms cached).

## C. Transpiler math audit (backend lane, June 12) — EMA/RSI fixed, ATR still wrong
User asked backend to review the transpiler. Found and FIXED in lib/launchpad/move-ta-lib.ts +
pine-ir.ts (surgical, your lane otherwise untouched):
- compute_ema seeded its SMA on the TRAILING window, so the recursion loop started at len and
  never ran — **every EMA (and both MACD legs) was computing an SMA**, numerically proven
  byte-identical. Now seeds on the oldest window and folds forward; matches float Pine EMA to
  <0.0001 (old behavior was off by ~10 points at period 26).
- compute_rsi had the same dead-loop: Wilder's smoothing never ran (silently Cutler's RSI).
  Same fix shape.
- bufferCapacity raised to max(3×maxPeriod, …) so recursive indicators converge (~2% residual).
STILL WRONG, not fixed (design question, your call): the "ATR approximation" used for
supertrend is compute_sma over CLOSES — that is not any approximation of Average True Range
(no high/low data in the buffer). Supertrend-based presets are trading a different indicator
than advertised. Options: store OHLC in the buffer, derive a close-to-close volatility proxy
and rename honestly, or remove supertrend presets until real.
Note: already-published indicator packages keep the old bytecode — only new deploys get the
fixed math. The live SMA 3/5 vault is unaffected (pure SMA).
