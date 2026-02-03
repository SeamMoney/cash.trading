---
title: "Formatting Prices and Sizes for Orders"
url: "https://docs.decibel.trade/transactions/overview/formatting-prices-sizes"
scraped: "2026-02-03T21:44:10.690Z"
---

# Formatting Prices and Sizes for Orders

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Overview
Formatting Prices and Sizes for Orders
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'wide');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
## 
[​
](#formatting-prices-and-sizes-for-orders)
Formatting Prices and Sizes for Orders
When placing orders on Decibel, you need to convert decimal prices and sizes to chain units that match the market’s precision requirements. This guide explains how to use market configuration data from the `v1/markets` endpoint to properly format your order parameters.
## 
[​
](#market-configuration)
Market Configuration
Each market returned from the `v1/markets` endpoint includes precision configuration:
Copy
Ask AI
```
{
"lot_size": 1,
"market_addr": "<string>",
"market_name": "<string>",
"max_leverage": 1,
"max_open_interest": 123,
"min_size": 1,
"px_decimals": 1,
"sz_decimals": 1,
"tick_size": 1
}
```
### 
[​
](#market-configuration-fields)
Market Configuration Fields
-   **`px_decimals`** - The number of decimal places used for price precision. Prices are stored as integers with this many implied decimal places. For example, if `px_decimals = 9`, a price of `5.67` is stored as `5670000000` (5.67 × 10^9).
-   **`sz_decimals`** - The number of decimal places used for size precision. Order sizes are stored as integers with this many implied decimal places. For example, if `sz_decimals = 9`, a size of `1.5` is stored as `1500000000` (1.5 × 10^9).
-   **`tick_size`** - The minimum price increment in chain units. Prices must be multiples of this value. For example, if `tick_size = 1000000` and `px_decimals = 9`, the minimum price increment is `0.001` (1000000 / 10^9).
-   **`lot_size`** - The minimum size increment in chain units. Order sizes must be multiples of this value. For example, if `lot_size = 100000000` and `sz_decimals = 9`, the minimum size increment is `0.1` (100000000 / 10^9).
-   **`min_size`** - The minimum order size in chain units. Orders smaller than this will be rejected. For example, if `min_size = 1000000000` and `sz_decimals = 9`, the minimum order size is `1.0` (1000000000 / 10^9).
## 
[​
](#conversion-functions)
Conversion Functions
### 
[​
](#convert-decimal-amount-to-chain-units)
Convert Decimal Amount to Chain Units
Typescript
Python
Copy
Ask AI
```
/**
* Converts a decimal amount to chain units (e.g., USDC).
* For USDC, this means multiplying by 10^6.
* @param amount - The decimal amount to convert
* @param decimal - The number of decimal places for the token (default is 6 for USDC).
* @returns The amount in chain units
*/
export function amountToChainUnits(amount: number, decimal = 6): number {
return Math.floor(amount * 10 ** decimal);
}
```
### 
[​
](#convert-chain-units-to-decimal-amount)
Convert Chain Units to Decimal Amount
Typescript
Python
Copy
Ask AI
```
/**
* Converts chain units to decimal amount (e.g., USDC).
* For USDC, this means dividing by 10^6.
* @param chainUnits - The amount in chain units
* @param decimal - The number of decimal places for the token (default is 6 for USDC).
* @returns The decimal amount
*/
export function chainUnitsToAmount(chainUnits: number, decimal = 6): number {
return chainUnits / 10 ** decimal;
}
```
## 
[​
](#price-formatting)
Price Formatting
### 
[​
](#round-price-to-valid-tick-size)
Round Price to Valid Tick Size
Prices must be rounded to the nearest valid tick size. Use this function to ensure your price is valid:
Typescript
Python
Copy
Ask AI
```
/**
* Rounds a price to the nearest valid tick size
* @param price - The decimal price to round
* @param market - The market configuration object
* @returns The rounded price
*/
export function roundToValidPrice(price: number, market: PerpMarket): number {
if (price === 0) {
return 0;
}
// Convert to chain units
const denormalizedPrice = price \* 10 \*\* market.px_decimals;
// Round to nearest multiple of tickSize
const roundedPrice =
Math.round(denormalizedPrice / market.tick_size) \* market.tick_size;
// Convert back to decimal
const normalizedPrice = Math.round(roundedPrice) / 10 \*\* market.px_decimals;
return normalizedPrice;
}
```
## 
[​
](#size-formatting)
Size Formatting
### 
[​
](#round-size-to-valid-lot-size)
Round Size to Valid Lot Size
Order sizes must be rounded to the nearest valid lot size and meet the minimum size requirement:
Typescript
Python
Copy
Ask AI
```
/**
* Rounds an order size to the nearest valid lot size
* @param orderSize - The decimal order size to round
* @param market - The market configuration object
* @returns The rounded order size
*/
export function roundToValidOrderSize(
orderSize: number,
market: PerpMarket
): number {
if (orderSize === 0) {
return 0;
}
const normalizedMinSize = market.min_size / 10 \*\* market.sz_decimals;
// Ensure size meets minimum requirement
if (orderSize < normalizedMinSize) {
return normalizedMinSize;
}
// Convert to chain units
const denormalizedOrderSize = orderSize \* 10 \*\* market.sz_decimals;
// Round to nearest multiple of lotSize
const roundedOrderSize =
Math.round(denormalizedOrderSize / market.lot_size) \* market.lot_size;
// Convert back to decimal
const normalizedOrderSize =
Math.round(roundedOrderSize) / 10 \*\* market.sz_decimals;
return normalizedOrderSize;
}
```
## 
[​
](#complete-example)
Complete Example
Here’s a complete example of formatting prices and sizes for placing an order:
Typescript
Python
Copy
Ask AI
```
// Fetch market data from v1/markets endpoint
const market = {
market_addr: "0x456...def",
market_name: "APT-USD",
px_decimals: 9,
sz_decimals: 9,
tick_size: 1000000, // 0.001 in decimal (1000000 / 10^9)
lot_size: 100000000, // 0.1 in decimal (100000000 / 10^9)
min_size: 1000000000, // 1.0 in decimal (1000000000 / 10^9)
};
// User wants to place an order at $5.6789 with size 1.234
const userPrice = 5.6789;
const userSize = 1.234;
// Step 1: Round price to valid tick size
const roundedPrice = roundToValidPrice(userPrice, market);
// Result: 5.679 (rounded to nearest 0.001)
// Step 2: Round size to valid lot size and check minimum
const roundedSize = roundToValidOrderSize(userSize, market);
// Result: 1.2 (rounded to nearest 0.1, meets minimum of 1.0)
// Step 3: Convert to chain units for the transaction
const chainPrice = amountToChainUnits(roundedPrice, market.px_decimals);
// Result: 5679000000 (5.679 × 10^9)
const chainSize = amountToChainUnits(roundedSize, market.sz_decimals);
// Result: 1200000000 (1.2 × 10^9)
// Step 4: Build and submit transaction
const transaction = await aptos.transaction.build.simple({
sender: account.accountAddress,
data: {
function: `${PACKAGE}::dex_accounts::place_order_to_subaccount`,
typeArguments: [],
functionArguments: [
"0x123...abc", // subaccountAddr
market.market_addr, // marketAddr
chainPrice, // price in chain units
chainSize, // size in chain units
true, // isBuy
0, // timeInForce
false, // isReduceOnly
null, // clientOrderId
null, // stopPrice
null, // tpTriggerPrice
null, // tpLimitPrice
null, // slTriggerPrice
null, // slLimitPrice
null, // builderAddr
null, // builderFee
],
},
});
```
## 
[​
](#understanding-the-values)
Understanding the Values
### 
[​
](#example-market-configuration)
Example Market Configuration
Let’s say a market has the following configuration:
Copy
Ask AI
```
{
"px_decimals": 9,
"sz_decimals": 9,
"tick_size": 1000000,
"lot_size": 100000000,
"min_size": 1000000000
}
```
**What this means:**
-   **Price Precision**: Prices can have up to 9 decimal places. A price of `5.67` is stored as `5670000000` chain units.
-   **Size Precision**: Sizes can have up to 9 decimal places. A size of `1.5` is stored as `1500000000` chain units.
-   **Tick Size**: The minimum price increment is `0.001` (1000000 / 10^9). Valid prices are: `5.000`, `5.001`, `5.002`, etc. Invalid: `5.0005`.
-   **Lot Size**: The minimum size increment is `0.1` (100000000 / 10^9). Valid sizes are: `1.0`, `1.1`, `1.2`, etc. Invalid: `1.05`.
-   **Min Size**: The minimum order size is `1.0` (1000000000 / 10^9). Orders smaller than 1.0 will be rejected.
## 
[​
](#common-pitfalls)
Common Pitfalls
1.  **Not rounding prices**: Prices must be multiples of `tick_size`. Always use `roundToValidPrice()` before converting to chain units.
2.  **Not rounding sizes**: Sizes must be multiples of `lot_size`. Always use `roundToValidOrderSize()` before converting to chain units.
3.  **Forgetting minimum size**: Orders below `min_size` will be rejected. The rounding function handles this automatically.
4.  **Using wrong decimals**: Always use `px_decimals` for prices and `sz_decimals` for sizes when calling `amountToChainUnits()`.
[Optimized Transaction Building](/transactions/overview/optimized-building)[Create Subaccount](/transactions/account-management/create-subaccount)
⌘I