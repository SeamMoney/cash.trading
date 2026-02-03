---
title: "Global Risk Controls"
url: "https://docs.decibel.trade/architecture/perps/global-risk-controls"
scraped: "2026-02-03T21:43:56.780Z"
---

# Global Risk Controls

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Decibel Perp Engine
Global Risk Controls
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
* * *
## 
[​
](#1-settlement-price-and-price-bands)
**1\. Settlement Price and Price Bands**
When the order\_book module finds two matching orders, it determines the execution price, which is then passed to the clearinghouse\_perp module as the **Settlement Price**. This price is critical for PnL calculations. To avoid settlements at extreme prices that deviate significantly from the consensus market price, the clearinghouse enforces a **Price Band** around the current mark price.
Guard
Summary
**Settlement Price Band**
Trades must settle within a governance‑set band around the mark price to prevent outliers.
**Circuit Breaker**
Pauses matching and withdrawals if the oracle price deviates beyond a threshold.
## 
[​
](#2-funding-&-mark-price)
2. Funding & Mark Price
`Mark Price = (Mid‑Book + Oracle) ÷ 2` `Funding Rate = Premium Index + Interest Rate` Funding accrues continuously and is exchanged when positions are closed or rebalanced.
## 
[​
](#3-exposure-limits)
3. Exposure Limits
Control
Effect
**Max Leverage**
Caps per‑account leverage; positions above a lowered cap become _reduce‑only_.
**Open‑Interest Cap**
Blocks new exposure once market notional reaches a threshold until OI falls again.
## 
[​
](#4-last‑resort-protection)
4. Last‑Resort Protection
**Auto‑Deleveraging (ADL):** If the insurance fund is exhausted, the system closes the highest‑ranked profitable positions on the opposing side until solvency is restored.
[Perpetuals – Smart Contract Overview](/architecture/perps/perps-contract-overview)[Position Management](/architecture/perps/position-management)
⌘I