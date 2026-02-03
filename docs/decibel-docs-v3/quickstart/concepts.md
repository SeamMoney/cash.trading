---
title: "Core Concepts"
url: "https://docs.decibel.trade/quickstart/concepts"
scraped: "2026-02-03T21:44:00.126Z"
---

# Core Concepts

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Getting Started
Core Concepts
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
### 
[​
](#what-decibel-is)
What Decibel Is
Decibel is a **fully on‑chain perpetuals exchange on Aptos**:
-   **On‑chain CLOB**: Every order is placed, matched, and settled by Move contracts on Aptos, not by an off‑chain matcher.
-   **Perp clearinghouse**: A dedicated `clearinghouse_perp` module tracks positions, margin, PnL, and liquidations.
-   **Composable DeFi primitives**: Orders, positions, vaults, and collateral are all on‑chain resources that other apps can build on.
If you’ve used a centralized exchange (CEX), think of Decibel as:
-   A CEX‑grade orderbook and matching engine
-   But running as **smart contracts on Aptos**, where you keep keys and every fill is verifiable on‑chain.
* * *
### 
[​
](#accounts-api-wallets-and-subaccounts)
Accounts, API Wallets, and Subaccounts
Decibel separates **who logs in**, **who signs trades**, and **where collateral lives**:
-   **Primary wallet**
-   Your “normal” Aptos account (e.g. Petra).
-   Used to log into the web app and create an API wallet.
-   **API wallet**
-   A dedicated keypair used for programmatic trading.
-   Holds APT for gas and **signs all on‑chain transactions** your bots send.
-   You get this from `app.decibel.trade/api` (“Create API Wallet”).
-   **Trading subaccounts**
-   On‑chain objects managed by `dex_accounts`.
-   Hold **USDC collateral** per strategy.
-   All orders, PnL, and margin checks route through a subaccount.
Typical flow:
1.  Use primary wallet → **create API wallet**.
2.  From the API wallet, **create a trading subaccount**.
3.  **Deposit USDC** into that subaccount.
4.  Place orders from that subaccount using the SDK or raw transactions.
* * *
### 
[​
](#the-on‑chain-orderbook-and-matching)
The On‑Chain Orderbook and Matching
Decibel uses a **central‑limit order book (CLOB)** implemented in Move:
-   Core order‑book entry functions live in `aptos_experimental::order_book` style modules.
-   The **Trading VM** wraps those primitives to:
-   Check margin and risk.
-   Route between maker/taker, TWAP, and bulk orders.
-   Execute via **Block‑STM**, so matching + settlement happen in one Aptos transaction.
Key properties:
-   **Price–time priority**: Bids/asks are sorted by `(price, unique_idx)` so the best‑priced, earliest order matches first.
-   **Deterministic fairness**: No off‑chain relay can “jump the queue” – matching logic is part of the chain.
-   **Atomic settlement**: Matching and PnL/collateral updates commit (or abort) in the same transaction.
For a deeper dive, see **Architecture → Orderbook & On‑Chain Matching**.
* * *
### 
[​
](#perpetuals-margin-and-risk-controls)
Perpetuals, Margin, and Risk Controls
Perp contracts live in `clearinghouse_perp.move` and related modules:
-   **Positions**: Signed sizes (positive = long, negative = short) per market and subaccount.
-   **Mark price**: Blend of oracle + mid‑book (`(oracle + mid) / 2`) used for PnL and margin checks.
-   **Continuous funding**: Funding accrues every second and is realized when positions change or close.
-   **Margin modes**:
-   **Cross**: One collateral pool backs all positions.
-   **Isolated**: Collateral is locked per‑position.
Global risk controls:
-   **Price bands**: Settlement must stay within a governance‑set band around the mark price.
-   **Circuit breakers**: Can pause matching/withdrawals on extreme oracle deviations.
-   **ADL (auto‑deleveraging)**: Last‑resort mechanism to protect solvency if insurance funds are exhausted.
See **Architecture → Perps – Smart Contract Overview** and **Global Risk Controls** for full details.
* * *
### 
[​
](#vaults-on‑chain-strategy-accounts)
Vaults: On‑Chain Strategy Accounts
Vaults let you run **on‑chain strategies that others can deposit into**:
-   A vault is a Move resource that:
-   Holds collateral (e.g. USDC).
-   Mints fungible **vault shares** (claim on assets).
-   Charges configurable **performance fees** in shares.
-   Depositors contribute USDC → receive shares at the current share price.
-   Managers trade via delegated permissions; fees are crystallized periodically as additional shares.
Two families of vaults:
-   **Protocol vaults**: Managed by Decibel, may have **lock‑ups** (e.g., 3‑day unlock) and stricter risk settings.
-   **User vaults**: Created and managed by any user; by default, deposits are withdrawable without protocol lock‑ups.
Vaults are just another on‑chain primitive – you can:
-   Trade vault shares as tokens.
-   Compose them in other DeFi protocols on Aptos.
See **Transactions → Vault** for the underlying Move entry functions.
* * *
### 
[​
](#api-keys-and-node-access)
API Keys and Node Access
You’ll see **three different “keys”** in the docs:
-   **Client API key (Geomi)**
-   Used for **GET** endpoints on `api.decibel.trade` and related hosts.
-   Sent as `Authorization: Bearer <CLIENT_API_KEY>`.
-   **Node API key (Geomi / Aptos Build)**
-   Used by the SDK to talk to Aptos fullnodes (`fullnodeUrl`).
-   Passed into `DecibelReadDex` / `DecibelWriteDex` as `nodeApiKey`.
-   **API wallet private key**
-   Your actual secret key that signs on‑chain transactions.
-   Never commit it to Git; store in `.env` or a secrets manager.
Rough rule of thumb:
-   **Reading data** → Client API key + Node API key.
-   **Sending transactions** → Node API key + API wallet private key.
* * *
### 
[​
](#sdk-vs-raw-transactions-vs-rest)
SDK vs. Raw Transactions vs. REST
You can integrate with Decibel at three layers:
-   **TypeScript SDK (`@decibeltrade/sdk`)**
-   High‑level helpers (`placeOrder`, `placeTwapOrder`, `depositToVault`, `getUserPositions`, …).
-   Handles ABI, replay protection, gas price, and JSON decoding for you.
-   **REST & WebSocket APIs**
-   REST: `GET /api/v1/markets`, `/orders`, `/positions`, etc.
-   WebSocket: streaming prices, depth, trades, orders, positions.
-   Great for dashboards and low‑latency streaming.
-   **Raw Aptos transactions**
-   Call Move entry functions (e.g. `dex_accounts::place_order_to_subaccount`) directly.
-   Full control over payloads, ABI parsing, and signing.
Most users start with the **SDK + REST**, then drop down to raw transactions for latency‑critical or highly‑custom flows.
* * *
### 
[​
](#where-to-go-next)
Where to Go Next
-   **New to Decibel?** Start with **Quick Start → Welcome to Decibel**.
-   **Building a bot?** Use the **TypeScript Starter Kit** and **TypeScript SDK Overview**.
-   **Designing strategies?** Read the **Architecture** section on orderbook, perps, and risk controls.
-   **Integrating transactions?** Use the **Transactions** tab for exact Move entry function signatures and examples.
[Welcome to Decibel](/quickstart/overview)[TypeScript Starter Kit](/quickstart/typescript-starter-kit)
⌘I