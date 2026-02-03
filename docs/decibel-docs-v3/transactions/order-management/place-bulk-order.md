---
title: "Place Bulk Order"
url: "https://docs.decibel.trade/transactions/order-management/place-bulk-order"
scraped: "2026-02-03T21:44:09.197Z"
---

# Place Bulk Order

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Order Management
Place Bulk Order
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'wide');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
The **Bulk Order API** allows a client to submit and manage multiple limit orders (both bids and asks) in a single atomic transaction. Eac account can have at most one Bulk Order per market. This API **cancels all existing resting liquidity** for the market provided and **replaces it with the new bulk set of orders** (bids and asks). Partial failures (e.g., an order that cannot be posted due to a `PostOnly` violation) do **not revert the transaction** — that particular order will simply be skipped or partially placed. Cancelled price levels and sizes will be returned explicitly in the update event. \*\* NOTE \*\*
-   Bulk Order Placements with a non-increasing `sequence_number` will be rejected.
-   Order updates that reduce size will maintain its position in the matching queue, order updates that increase size will be moved to the end of the matching queue.
**Function:**
Copy
Ask AI
```
{package}::dex_accounts::place_bulk_orders_to_subaccount
```
**ABI Object:**
Copy
Ask AI
```
const functionAbi: MoveFunction = {
name: "place_bulk_orders_to_subaccount",
visibility: "private",
is_entry: true,
is_view: false,
generic_type_params: [],
params: [
"&signer",
"0x1::object::Object<{package}::dex_accounts::Subaccount>",
"0x1::object::Object<{package}::perp_market::PerpMarket>",
"u64",
"vector<u64>",
"vector<u64>",
"vector<u64>",
"vector<u64>",
],
return: [],
};
```
**Parameters:**
-   `signer` - The account signer
-   `subaccount` - The subaccount object
-   `market` - The PerpMarket object
-   `sequence_number` - The monotonically increasing number associated with this order
-   `bid_prices` - ``vector<u64>`` - Array of bid prices in chain units
-   `bid_sizes` - ``vector<u64>`` - Array of bid sizes in chain units
-   `ask_prices` - ``vector<u64>`` - Array of ask prices in chain units
-   `ask_sizes` - ``vector<u64>`` - Array of ask sizes in chain units
## 
[​
](#time-in-force)
Time in Force
**Bulk Orders are Post-Only limit orders**. **Example:**
Typescript
Python
Copy
Ask AI
```
const transaction = await aptos.transaction.build.simple({
sender: account.accountAddress,
data: {
function: `${PACKAGE}::dex_accounts::place_bulk_orders_to_subaccount`,
typeArguments: [],
functionArguments: [
"0x123...abc", // subaccountAddr
"0x456...def", // marketAddr (PerpMarket object address)
1, // sequenceNumber (must be monotonically increasing)
[5670000000, 5680000000, 5690000000], // bidPrices (in chain units)
[1000000000, 2000000000, 3000000000], // bidSizes (in chain units)
[5710000000, 5720000000, 5730000000], // askPrices (in chain units)
[1000000000, 2000000000, 3000000000], // askSizes (in chain units)
],
},
});
```
[Cancel TWAP Order](/transactions/order-management/cancel-twap-order)[Cancel Bulk Order](/transactions/order-management/cancel-bulk-order)
⌘I