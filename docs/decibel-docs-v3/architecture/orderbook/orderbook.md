---
title: "Orderbook & Onchain Matching"
url: "https://docs.decibel.trade/architecture/orderbook/orderbook"
scraped: "2026-02-03T21:43:56.360Z"
---

# Orderbook & Onchain Matching

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Decibel Orderbook
Orderbook & Onchain Matching
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
* * *
## 
[​
](#1-overview)
1\. Overview
Decibel’s trading stack relies on a **framework‑level central‑limit order‑book (CLOB)** to keep every step of trade execution—ordering, matching, and settlement—**fully on‑chain**. The CLOB is implemented in Move inside `aptos_experimental::order_book` and exposed through public entry‑functions such as:
Copy
Ask AI
```
// simplified signatures
place_maker_order         // add a limit order
is_taker_order            // pre-check for taker logic
get_single_match_for_taker // pull the best opposing quote & size
cancel_order              // authorised cancellation
```
These primitives are wrapped by the **Trading VM**, which adds risk checks and routing logic, and executes them through Block‑STM so that matching, balance transfers, and event emission all finalize inside a single Aptos transaction.
### 
[​
](#why-a-fully-on-chain-matcher-matters)
Why a fully on-chain matcher matters
-   **Deterministic fairness** — price-time priority is hard-coded; no off-chain relay can overrule a better quote.
-   **Composability** — orders, positions, and collateral are native Aptos resources that any dApp can safely compose with.
-   **Auditability & risk isolation** — every match is a ledger state-change protected by the same safety guarantees as the L1.
-   **Performance that rivals CEXs** — road-mapped upgrades (Raptr + Block-STM v2) target <20 ms blocks and >1M orders.
## 
[​
](#2-position-inside-decibel’s-architecture)
2\. Position inside Decibel’s architecture
A single Aptos transaction carries the full path — API → Trading VM → `order_book` → Clearing-house callbacks → state commit. The high-level flowchart embedded in the spec illustrates these hops. ![Decibel architecture flow diagram showing API Gateway, Trading VM, Order Book, and Clearinghouse callbacks](https://mintcdn.com/aptoslabs/K0xkguCaHw_pGgmC/images/orderbook/diagram1.png?fit=max&auto=format&n=K0xkguCaHw_pGgmC&q=85&s=ac6d273100a93a514feb1aeec80edcea)
-   **API Gateway** – rate‑limits, aggregates, and signs user intents.
-   **Trading VM** – converts intents to `order_book` calls and enforces account‑level risk/routing.
-   **Order Book** – canonical matching engine (details below).
-   **Clearinghouse callbacks** – asset‑specific settlement (spot, perps, etc.).
## 
[​
](#3-core-data-structures)
3\. Core data structures
Structure
Purpose
Backing type
`ActiveOrderBook`
Bid/ask queues ordered by `(price, unique_idx)` to ensure strict price-time priority
`BigOrderedMap<(price, unique_idx), size>`
`PendingOrderBookIndex`
Schedules trigger orders (price moves & time-based)
Three index maps keyed by trigger
`OrderBook`
Supervisory resource holding all orders and the two indices above
`struct OrderBook { orders; active_orders; pending_orders; … }`
## 
[​
](#4-order-lifecycle-maker-vs-taker)
4\. Order lifecycle (maker vs. taker)
![Order lifecycle diagram showing maker and taker paths](https://mintcdn.com/aptoslabs/K0xkguCaHw_pGgmC/images/orderbook/diagram2.png?fit=max&auto=format&n=K0xkguCaHw_pGgmC&q=85&s=40b51e85f57f1ca06d6f26bba1f59b65)
1.  **Maker path** — `place_maker_order` inserts a limit order into `ActiveOrderBook` and returns an order-id in the same transaction.
2.  **Taker path** — `is_taker_order` pre-checks market orders; the Trading VM then repeatedly calls `get_single_match_for_taker` until the requested size is filled or no liquidity remains.
3.  **Atomic settlement** — each best-match is handed to the clearing-house callback, which moves funds and updates positions before the block commits.
## 
[​
](#5-matching-algorithm)
5\. Matching algorithm
**Price–time priority** – `ActiveOrderBook` is ordered lexicographically by `price` then `unique_idx`, so the earliest quote at the best price matches first. **Single‑fill loop** – `get_single_match_for_taker` returns one best‑match per call; the Trading VM iterates until the requested size is filled or no liquidity remains. **Trigger orders** – orders with a `trigger_condition` live in `PendingOrderBookIndex` and are promoted to the active book by scheduled keeper transactions (oracle‑price tick or time tick). **Atomic settlement** – the clearing‑house receives maker & taker addresses plus `price / size`, moves funds, updates positions, and emits events; all changes commit in the same block.
## 
[​
](#6-security-&-correctness-guarantees)
6\. Security & correctness guarantees
-   **Move resource model** prevents double-spend and enforces asset conservation during settlement.
-   **Monotonic `unique_idx`** supplies total ordering without wall-clock timestamps, eliminating latency gaming.
-   **Abort codes** (`EORDER_ALREADY_EXISTS`, `EORDER_NOT_FOUND`) surface invalid states before storage changes, protecting both sides of a trade.
-   Matching and settlement share the same transaction—**either the trade fully lands or nothing changes**.
[Position Management](/architecture/perps/position-management)
⌘I