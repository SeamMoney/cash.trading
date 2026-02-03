---
title: "Position Management"
url: "https://docs.decibel.trade/architecture/perps/position-management"
scraped: "2026-02-03T21:43:57.630Z"
---

# Position Management

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Decibel Perp Engine
Position Management
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
* * *
## 
[​
](#1-key-formulas)
1. Key Formulas
Let `Size` = signed position quantity `Mark` = mark price `IM_frac` = initial‑margin fraction `MM_frac` = maintenance‑margin fraction
Metric
Formula
Equity
`Collateral + Unrealised PnL`
Notional
`abs(Size) × Mark`
Initial Margin
`Notional × IM_frac`
Maintenance Margin
`Notional × MM_frac`
Withdrawable Collateral
`max(0, Equity – Initial Margin)`
## 
[​
](#2-margin-modes)
2. Margin Modes
-   **Cross‑Margin:** Collateral is shared across all positions; liquidation triggers when `Equity < Σ Maintenance Margin`.
-   **Isolated Margin:** Collateral is locked per position; liquidation is local.
## 
[​
](#3-liquidation-flow-high-level)
3. Liquidation Flow (High Level)
1.  **Market Close:** Engine submits protected orders to reduce exposure until `Equity ≥ Σ Maintenance Margin`.
2.  **Backstop Transfer:** If a deficit remains, positions and collateral move atomically to a capitalised backstop liquidator that assumes the shortfall.
## 
[​
](#4-example-cross‑margin-workflow)
4. Example (Cross‑Margin Workflow)
_User opens a 5× long on BTC‑PERP_
1.  User selects leverage = 5 → `IM_frac = 0.20`.
2.  Pre‑trade check verifies `Equity ≥ Initial Margin`.
3.  Funding accrues continuously; mark price updates.
4.  If the price declines so that `Equity = Σ Maintenance Margin`, liquidation step 1 engages and, if needed, step 2 protects solvency.
[Global Risk Controls](/architecture/perps/global-risk-controls)[Orderbook & Onchain Matching](/architecture/orderbook/orderbook)
⌘I