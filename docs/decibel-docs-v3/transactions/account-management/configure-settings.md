---
title: "Configure User Settings for Market"
url: "https://docs.decibel.trade/transactions/account-management/configure-settings"
scraped: "2026-02-03T21:44:03.645Z"
---

# Configure User Settings for Market

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Account Management
Configure User Settings for Market
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'wide');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
**Function:**
Copy
Ask AI
```
{package}::dex_accounts::configure_user_settings_for_market
```
**ABI Object:**
Copy
Ask AI
```
const functionAbi: MoveFunction = {
name: "configure_user_settings_for_market",
visibility: "public",
is_entry: true,
is_view: false,
generic_type_params: [],
params: [
"&signer",
"address",
"0x1::object::Object<{package}::perp_market::PerpMarket>",
"bool",
"u8",
],
return: [],
};
```
**Parameters:**
-   `signer` - The account signer
-   `subaccount_address` - The subaccount address
-   `market` - The PerpMarket object
-   `is_cross` - Whether to use cross-margin (true) or isolated margin (false)
-   `user_leverage` - Leverage in basis points (e.g., 1000 = 10x)
**Example:**
Typescript
Python
Copy
Ask AI
```
const transaction = await aptos.transaction.build.simple({
sender: account.accountAddress,
data: {
function: `${PACKAGE}::dex_accounts::configure_user_settings_for_market`,
typeArguments: [],
functionArguments: [
"0x123...abc", // subaccountAddress
"0x456...def", // marketAddr (PerpMarket object address)
true, // isCross (true for cross-margin, false for isolated)
1000, // userLeverage (1000 = 10x leverage in basis points)
],
},
});
```
[Withdraw from Subaccount](/transactions/account-management/withdraw)[Place Order](/transactions/order-management/place-order)
⌘I