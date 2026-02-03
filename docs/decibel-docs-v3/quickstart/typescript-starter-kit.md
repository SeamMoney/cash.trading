---
title: "TypeScript Starter Kit"
url: "https://docs.decibel.trade/quickstart/typescript-starter-kit"
scraped: "2026-02-03T21:44:02.781Z"
---

# TypeScript Starter Kit

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Getting Started
TypeScript Starter Kit
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
A streamlined quick-start for the Decibel TypeScript starter kit: set up fast, then customize.
[
## Part 1: Get Your First Trade under 5 min
Follow the exact steps to install, configure, and place your first order.
](#part-1)[
## Part 2: Mental Model & Architecture
Understand Decibel’s three-tier account model, execution queue, and funding.
](#part-2)[
## Part 3: Make It Yours
Customize markets, order logic, and subaccounts for your own strategy.
](#part-3)
## 
[​
](#part-1-get-your-first-trade-under-5-min)
Part 1: Get Your First Trade under 5 min
Follow these steps exactly to get your first trade running.
### 
[​
](#1-prerequisites)
1\. Prerequisites
-   [Node.js](https://nodejs.org/) 18+
-   [Petra Wallet](https://petra.app/) browser extension (recommended, optional thanks to Aptos Connect)
-   [Git](https://git-scm.com/downloads)
-   [Aptos CLI](https://aptos.dev/build/cli#-install-the-aptos-cli) (recommended)
### 
[​
](#2-get-your-credentials)
2\. Get Your Credentials
You need two things: an **API Wallet** (for signing transactions) and an **API Key** (for authenticated API requests).
#### 
[​
](#create-api-wallet)
Create API Wallet
1.  Go to [app.decibel.trade/api](https://app.decibel.trade/api)
2.  Connect your Petra Wallet or “Continue with Google”
3.  Click **“Create API Wallet”**
![Create API Wallet Example](https://mintcdn.com/aptoslabs/Dzk3tLl4GZATvw6n/images/tssk/create-api-wallet.png?fit=max&auto=format&n=Dzk3tLl4GZATvw6n&q=85&s=42ffd13821db1e00570a8e7d0cbde2c5)
4.  **Copy the Private Key** immediately (you only see it once)
5.  Also save the **Wallet Address** shown on the same screen
Store your private key securely! Anyone with this key can access your funds.
#### 
[​
](#create-api-key-bearer-token)
Create API Key (Bearer Token)
The API Key is used for authenticated requests to the Decibel REST API. You’ll get this from Geomi (Aptos Build).
1.  **Sign up or log in** at [geomi.dev](https://geomi.dev)
-   Click “Continue with Google” or enter your email
2.  **Create or select a project**
-   If you’re new, you’ll see “No resources yet” — that’s fine!
-   Your project dashboard will show available resources
3.  **Add an API Key resource** ![Geomi Dashboard](https://mintcdn.com/aptoslabs/Dzk3tLl4GZATvw6n/images/tssk/geomi-dashboard.png?fit=max&auto=format&n=Dzk3tLl4GZATvw6n&q=85&s=68de455967bb95b1a2f8492d81798ea7)
-   Click the **“API Key”** card (find it under “Add more resources to your project”)
4.  **Fill out the API Key form:** ![Create API Key Form](https://mintcdn.com/aptoslabs/Dzk3tLl4GZATvw6n/images/tssk/create-api-key.png?fit=max&auto=format&n=Dzk3tLl4GZATvw6n&q=85&s=1e89cdb7a5b20707bc445fb6a9d49c63)
-   **API Key Name:** Choose a name (e.g., `decibel` or `my-trading-bot`)
-   **Network:** Select **“Decibel Devnet”** from the dropdown (important!)
-   **Description:** Optional — add a note about what this key is for (150 chars max)
-   **Client usage:** Leave this **OFF** (unless you’re building a web/mobile app)
-   Click **“Create New API Key”**
5.  **Copy your Bearer Token** ![Get Bearer Token](https://mintcdn.com/aptoslabs/Dzk3tLl4GZATvw6n/images/tssk/get-bearer-token.png?fit=max&auto=format&n=Dzk3tLl4GZATvw6n&q=85&s=b2e9ce3111062f215f7655f52db6837f)
-   After creation, you’ll see your API key in the “API Keys” table
-   Find the **“Key secret”** column — this is your Bearer token
-   Click the copy icon next to the masked key (shows as `*****...*****`)
This “Key secret” is your `API_BEARER_TOKEN`. It’s the full Bearer token, not just the key name.
### 
[​
](#3-configure-the-project)
3\. Configure the Project
Clone and Install
Copy
Ask AI
```
# Clone the repo
git clone https://github.com/tippi-fifestarr/testetna.git
cd testetna
# Install dependencies
npm install
# Create env file
cp .env.example .env
```
Open `.env` and paste your credentials:
.env
Copy
Ask AI
```
API_WALLET_PRIVATE_KEY=0xYOUR_COPIED_KEY_HERE
API_WALLET_ADDRESS=0xYOUR_WALLET_ADDRESS_HERE
API_BEARER_TOKEN=YOUR_BEARER_TOKEN_HERE
```
**Quick checklist:**
-   `API_WALLET_PRIVATE_KEY` — From Decibel App (Create API Wallet)
-   `API_WALLET_ADDRESS` — From Decibel App (Create API Wallet)
-   `API_BEARER_TOKEN` — From Geomi (Create API Key, “Key secret” column)
### 
[​
](#4-run-the-“quick-win”)
4\. Run the “Quick Win”
This script handles everything: funding (via private faucet), account creation, minting USDC, depositing, and placing a trade.
Copy
Ask AI
```
npm run quick-win
```
**If you see ”🎉 Order Placement Complete!”, congratulations. The code works.**
* * *
## 
[​
](#part-2-mental-model-&-architecture-)
Part 2: Mental Model & Architecture 🏗️
Trading on Decibel has specific mechanics that differ from CEXs and many DEXs. Here are 5 key concepts for API traders.
**Jump to [Part 3](#part-3) if you’re ready to start customizing your code.** You can always come back here later.
### 
[​
](#1-the-three-tier-account-model)
1\. The Three-Tier Account Model
Decibel uses a three-tier account structure for programmatic trading:
Tier
Description
**Primary Wallet**
Your login account. Used to access Decibel App and create API Wallets.
**API Wallet**
A separate wallet for API trading. Holds APT for gas fees and signs all trading transactions. This is your `API_WALLET_ADDRESS`.
**Trading Subaccount**
Created from your API Wallet. Holds USDC for trading collateral. Address is extracted from transaction events and written to `.env` as `SUBACCOUNT_ADDRESS`.
**Flow:** Primary Wallet → Create API Wallet → Create Trading Subaccount → Deposit USDC → Trade. ![Three-tier account model](https://mintcdn.com/aptoslabs/canlJUnLiLpjMoUM/images/tssk/three-account.png?fit=max&auto=format&n=canlJUnLiLpjMoUM&q=85&s=bf69c920ffcf0782cea59f72f9d45dfa)
For API traders, you primarily interact with the API Wallet (not the Primary Wallet). Most users will have a single trading subaccount, though you can create multiple for different strategies.
### 
[​
](#2-async-execution-the-queue)
2\. Async Execution (The Queue)
Decibel is an on-chain CLOB (Central Limit Order Book).
Platform
Behavior
**CEX**
`response = placeOrder()` → Returns “Filled”
**Decibel**
`response = placeOrder()` → Returns “Transaction Hash” (Ticket to the Queue)
**Implication:** Execution is asynchronous. The REST response confirms _submission_, not _fill_. Use the [WebSocket stream](/api-reference/websockets/orderupdate) for deterministic execution updates.
### 
[​
](#3-“lazy”-continuous-funding)
3\. “Lazy” Continuous Funding
-   **Traditional:** Pay funding every 8 hours
-   **Decibel:** Funding ticks every second (continuous accrual)
**The Mechanic:** You only “pay” (settle) when you modify or close the position.
Your `Unrealized PnL` includes accrued funding debt. Watch it closely to avoid liquidation.
See [Position Management](/architecture/perps/position-management) for more details.
### 
[​
](#4-reduce-only-logic)
4\. Reduce-Only Logic
Decibel implements strict “Close First” logic. **The Mechanic:** A Reduce-Only order will never flip your position (e.g., Long 1 → Short 1). It caps execution at your current size. **Benefit:** Prevents accidental exposure when closing positions aggressively. See [Order Management](/transactions/overview) for implementation details.
### 
[​
](#5-bulk-orders-unique-optimization)
5\. Bulk Orders (Unique Optimization)
For Market Makers and HFTs: **The Mechanic:** You can update multiple orders in a single transaction. **Benefit:** Massive gas savings and atomic updates for spread management. See [Place Bulk Order](/transactions/order-management/place-bulk-order) for implementation details.
* * *
## 
[​
](#part-3-make-it-yours)
Part 3: Make It Yours
Now that you have a working baseline, here’s how to adapt this code for your actual strategy.
### 
[​
](#how-to-trade-a-different-market)
How to Trade a Different Market
Open `src/5-place-order.ts`. Find the “Configuration” section. **Change this:**
Copy
Ask AI
```
const marketName = config.MARKET_NAME || 'BTC/USD';
```
**To this:**
Copy
Ask AI
```
const marketName = 'ETH/USD'; // or SOL/USD, APT/USD, etc.
```
Run `npm run setup` to see a list of all available market names. Market names use the format `SYMBOL/USD` (not `SYMBOL-PERP`).
### 
[​
](#how-to-change-your-order-logic)
How to Change Your Order Logic
Open `src/5-place-order.ts`. Find the “Order Parameters” section. **Change this:**
Copy
Ask AI
```
const userPrice = 50000;
const userSize = 0.001;
const isBuy = true;
```
**To your own logic:**
Copy
Ask AI
```
// Example: A simple moving average bot might look like this
const userPrice = calculatedMovingAverage;
const userSize = riskManagementSize;
const isBuy = signal === 'BULLISH';
```
### 
[​
](#focus-on-order-management)
Focus on Order Management
After running `quick-win`, you have a funded trading subaccount ready to use. You can now focus on:
-   `src/5-place-order.ts` — Customize your trading strategy
-   `src/6-query-order.ts` — Check order status
You don’t need to create a new trading subaccount for every trade. Once you have USDC deposited (from `quick-win`), you can run `5-place-order` and `6-query` repeatedly using the same subaccount.
### 
[​
](#how-to-use-a-different-trading-subaccount)
How to Use a Different Trading Subaccount
If you want to use a specific trading subaccount (e.g., for a different strategy):
1.  Create a new one: `npm run create-subaccount`
2.  The script automatically updates your `.env` file with the new `SUBACCOUNT_ADDRESS`
3.  Run `npm run deposit-usdc` to fund it
**How the trading subaccount script works:**
-   Calls `create_new_subaccount`, which creates a non-primary trading subaccount (random address)
-   Extracts the subaccount address from the `SubaccountCreatedEvent` in the transaction events
-   Verifies the address via the API (with up to 5 retries for indexer lag)
-   Writes the address to your `.env` file
**To manually select a different trading subaccount:**
-   After running `create-subaccount`, check the list of trading subaccounts it prints
-   Manually edit `.env` and set `SUBACCOUNT_ADDRESS` to the address you want
-   Or modify `src/2-create-subaccount.ts` to change the selection logic
* * *
## 
[​
](#part-4-what’s-next-)
Part 4: What’s Next? 🚀
1
[
](#)
Monitor Risk
Build a script to track `Unrealized PnL` + `Accrued Funding` to avoid liquidation.
2
[
](#)
Market Making
Use `src/7-websocket-updates.ts` to listen to the orderbook and place Maker orders.
3
[
](#)
Explore Order Types
Look into `Post-Only` and `Reduce-Only` params in the API docs for advanced control.
### 
[​
](#resources)
Resources
[
## Full Documentation
Complete Decibel documentation
](/quickstart/overview)[
## Placing Your First Order
Alternative guide with Netna and Testnet examples
](/quickstart/placing-your-first-order)[
## Discord Community
Get help from the community
](https://discord.com/invite/decibel)[
## Netna Faucet
Staging network faucet
](https://netna-faucet.decibel.trade)
### 
[​
](#network-support)
Network Support
This starter kit is tested and configured for **Netna staging network** only.
**Explorer Links:** The `getExplorerLink()` function in `utils/client.ts` generates explorer URLs for Netna transactions. For other networks, users must manually select the network from the explorer dropdown.
[Core Concepts](/quickstart/concepts)[Client API Key Setup](/quickstart/node-api-key)
⌘I