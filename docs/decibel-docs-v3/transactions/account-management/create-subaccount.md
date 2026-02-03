---
title: "Create Subaccount"
url: "https://docs.decibel.trade/transactions/account-management/create-subaccount"
scraped: "2026-02-03T21:44:04.088Z"
---

# Create Subaccount

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Account Management
Create Subaccount
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'wide');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
Each user can have multiple subaccounts for different trading strategies. **Function:**
Copy
Ask AI
```
{package}::dex_accounts::create_new_subaccount
```
**ABI Object:**
Copy
Ask AI
```
const functionAbi: MoveFunction = {
name: "create_new_subaccount",
visibility: "public",
is_entry: true,
is_view: false,
generic_type_params: [],
params: ["&signer"],
return: [],
};
```
**Parameters:**
-   `signer` - The account signer (your account)
**Example:**
Typescript
Python
Copy
Ask AI
```
const transaction = await aptos.transaction.build.simple({
sender: account.accountAddress,
data: {
function: `${PACKAGE}::dex_accounts::create_new_subaccount`,
typeArguments: [],
functionArguments: [],
},
});
```
[Formatting Prices and Sizes for Orders](/transactions/overview/formatting-prices-sizes)[Delegate Trading To](/transactions/account-management/delegate-trading)
⌘I