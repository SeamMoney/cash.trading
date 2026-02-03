---
title: "Place Order"
url: "https://docs.decibel.trade/transactions/order-management/place-order"
scraped: "2026-02-03T21:44:09.648Z"
---

# Place Order

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Order Management
Place Order
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'wide');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
**Function:**
Copy
Ask AI
```
{package}::dex_accounts::place_order_to_subaccount
```
**ABI Object:**
Copy
Ask AI
```
const functionAbi: MoveFunction = {
name: "place_order_to_subaccount",
visibility: "private",
is_entry: true,
is_view: false,
generic_type_params: [],
params: [
"&signer",
"0x1::object::Object<{package}::dex_accounts::Subaccount>",
"0x1::object::Object<{package}::perp_market::PerpMarket>",
"u64",
"u64",
"bool",
"u8",
"bool",
"0x1::option::Option<0x1::string::String>",
"0x1::option::Option<u64>",
"0x1::option::Option<u64>",
"0x1::option::Option<u64>",
"0x1::option::Option<u64>",
"0x1::option::Option<u64>",
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
-   `price` - Order price ``<u64>``
-   `size` - Order size ``<u64>``
-   `is_buy` - True for buy order, false for sell order
-   `time_in_force` - Time in force ``<u8>``: 0 = GoodTillCanceled, 1 = PostOnly, 2 = ImmediateOrCancel
-   `is_reduce_only` - Whether order can only reduce position size
-   `client_order_id` - Optional client-assigned order ID ``<Option<String>>``
-   `stop_price` - Optional stop price ``<Option<u64>>``
-   `tp_trigger_price` - Optional take-profit trigger price ``<Option<u64>>``
-   `tp_limit_price` - Optional take-profit limit price ``<Option<u64>>``
-   `sl_trigger_price` - Optional stop-loss trigger price ``<Option<u64>>``
-   `sl_limit_price` - Optional stop-loss limit price ``<Option<u64>>``
-   `builder_addr` - Optional builder/referrer address ``<Option<address>>``
-   `builder_fee` - Optional builder fee in basis points ``<Option<u64>>``
## 
[​
](#time-in-force-options)
Time in Force Options
When placing orders, you can specify different execution types using the `time_in_force` parameter:
-   **`0` (GoodTillCanceled)** - Order stays active until it is filled or manually canceled
-   **`1` (PostOnly)** - Order only adds liquidity to the order book (becomes a maker order). If the order would execute immediately, it is canceled
-   **`2` (ImmediateOrCancel)** - Order executes immediately at the best available price. Any unfilled portion is canceled
**Example:**
Typescript
Python
Copy
Ask AI
```
const transaction = await aptos.transaction.build.simple({
sender: account.accountAddress,
data: {
function: `${PACKAGE}::dex_accounts::place_order_to_subaccount`,
typeArguments: [],
functionArguments: [
"0x123...abc", // subaccountAddr
"0x456...def", // marketAddr (PerpMarket object address)
5670000000, // price (5.67 with 9 decimals)
1000000000, // size (1.0 with 9 decimals)
true, // isBuy (true for buy, false for sell)
0, // timeInForce (0 = GoodTillCanceled, 1 = PostOnly, 2 = ImmediateOrCancel)
false, // isReduceOnly
"my-order-123", // clientOrderId (optional)
null, // stopPrice (optional)
null, // tpTriggerPrice (optional)
null, // tpLimitPrice (optional)
null, // slTriggerPrice (optional)
null, // slLimitPrice (optional)
null, // builderAddr (optional)
null, // builderFee (optional)
],
},
});
```
[Configure User Settings for Market](/transactions/account-management/configure-settings)[Cancel Order](/transactions/order-management/cancel-order)
⌘I