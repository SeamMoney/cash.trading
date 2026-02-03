---
title: "Update SL Order for Position"
url: "https://docs.decibel.trade/transactions/position-management/update-sl-order"
scraped: "2026-02-03T21:44:13.294Z"
---

# Update SL Order for Position

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Position Management
Update SL Order for Position
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'wide');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
**Function:**
Copy
Ask AI
```
{package}::dex_accounts::update_sl_order_for_position
```
**ABI Object:**
Copy
Ask AI
```
const functionAbi: MoveFunction = {
name: "update_sl_order_for_position",
visibility: "private",
is_entry: true,
is_view: false,
generic_type_params: [],
params: [
"&signer",
"0x1::object::Object<{package}::dex_accounts::Subaccount>",
"u128",
"0x1::object::Object<{package}::perp_market::PerpMarket>",
"0x1::option::Option<u64>",
"0x1::option::Option<u64>",
"0x1::option::Option<u64>",
],
return: [],
};
```
**Parameters:**
-   `signer` - The account signer
-   `subaccount` - The subaccount object
-   `prev_order_id` - Previous SL order ID (u128)
-   `market` - The PerpMarket object
-   `sl_trigger_price` - Optional new stop-loss trigger price ``<Option<u64>>``
-   `sl_limit_price` - Optional new stop-loss limit price ``<Option<u64>>``
-   `sl_size` - Optional new stop-loss size ``<Option<u64>>``
**Example:**
Typescript
Python
Copy
Ask AI
```
const transaction = await aptos.transaction.build.simple({
sender: account.accountAddress,
data: {
function: `${PACKAGE}::dex_accounts::update_sl_order_for_position`,
typeArguments: [],
functionArguments: [
"0x123...abc", // subaccountAddr
12345678901234567890, // prevOrderId (u128)
"0x456...def", // marketAddr (PerpMarket object address)
5400000000, // slTriggerPrice (optional, 5.4 with 9 decimals)
5350000000, // slLimitPrice (optional, 5.35 with 9 decimals)
750000000, // slSize (optional, 0.75 with 9 decimals)
],
},
});
```
[Update TP Order for Position](/transactions/position-management/update-tp-order)[Cancel TP/SL Order for Position](/transactions/position-management/cancel-tp-sl-order)
⌘I