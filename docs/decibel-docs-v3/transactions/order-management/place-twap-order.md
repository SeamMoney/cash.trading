---
title: "Place TWAP Order"
url: "https://docs.decibel.trade/transactions/order-management/place-twap-order"
scraped: "2026-02-03T21:44:10.092Z"
---

# Place TWAP Order

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Order Management
Place TWAP Order
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'wide');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
**Function:**
Copy
Ask AI
```
{package}::dex_accounts::place_twap_order_to_subaccount
```
**ABI Object:**
Copy
Ask AI
```
const functionAbi: MoveFunction = {
name: "place_twap_order_to_subaccount",
visibility: "private",
is_entry: true,
is_view: false,
generic_type_params: [],
params: [
"&signer",
"0x1::object::Object<{package}::dex_accounts::Subaccount>",
"0x1::object::Object<{package}::perp_market::PerpMarket>",
"u64",
"bool",
"bool",
"u64",
"u64",
"0x1::option::Option<address>",
"0x1::option::Option<u64>",
],
return: [],
};
```
**Parameters:**
-   `signer` - The account signer
-   `subaccount` - The subaccount object
-   `market` - The PerpMarket object
-   `size` - Total size to execute (u64)
-   `is_buy` - True for buy, false for sell
-   `is_reduce_only` - Whether order can only reduce position
-   `twap_frequency_seconds` - How often to execute sub-orders (u64)
-   `twap_duration_seconds` - Total duration for TWAP order (u64)
-   `builder_addr` - Optional builder address ``<Option<address>>``
-   `builder_fee` - Optional builder fee ``<Option<u64>>``
**Example:**
Typescript
Python
Copy
Ask AI
```
const transaction = await aptos.transaction.build.simple({
sender: account.accountAddress,
data: {
function: `${PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
typeArguments: [],
functionArguments: [
"0x123...abc", // subaccountAddr
"0x456...def", // marketAddr (PerpMarket object address)
10000000000, // size (10.0 with 9 decimals)
true, // isBuy (true for buy, false for sell)
false, // isReduceOnly
60, // twapFrequencySeconds (execute every 60 seconds)
3600, // twapDurationSeconds (total duration: 1 hour)
null, // builderAddr (optional)
null, // builderFee (optional)
],
},
});
```
[Cancel Client Order](/transactions/order-management/cancel-client-order)[Cancel TWAP Order](/transactions/order-management/cancel-twap-order)
⌘I