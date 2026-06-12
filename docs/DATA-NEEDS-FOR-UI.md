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
