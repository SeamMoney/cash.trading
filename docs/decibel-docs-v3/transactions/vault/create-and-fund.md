---
title: "Create and Fund Vault"
url: "https://docs.decibel.trade/transactions/vault/create-and-fund"
scraped: "2026-02-03T21:44:15.103Z"
---

# Create and Fund Vault

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Vault
Create and Fund Vault
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'wide');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
**Function:**
Copy
Ask AI
```
{package}::vault::create_and_fund_vault
```
**ABI Object:**
Copy
Ask AI
```
const functionAbi: MoveFunction = {
name: "create_and_fund_vault",
visibility: "public",
is_entry: true,
is_view: false,
generic_type_params: [],
params: [
"&signer",
"0x1::object::Object<0x1::fungible_asset::Metadata>",
"0x1::string::String",
"0x1::string::String",
"vector<0x1::string::String>",
"0x1::string::String",
"0x1::string::String",
"0x1::string::String",
"u64",
"u64",
"u64",
"bool",
"bool",
],
return: [],
};
```
**Parameters:**
-   `signer` - The account signer
-   `contribution_asset_type` - The fungible asset metadata for contributions
-   `vault_name` - Vault name (String)
-   `vault_description` - Vault description (String)
-   `vault_social_links` - Vault social links (vector of Strings). Array format: `[xUrl, discordUrl]` where each element is a string URL or empty string
-   `vault_share_symbol` - Vault share symbol (String)
-   `vault_share_icon_uri` - Vault share icon URI (String)
-   `vault_share_project_uri` - Vault share project URI (String)
-   `fee_bps` - Fee in basis points (u64). Maximum: 1000 (10%)
-   `fee_interval` - Fee interval in seconds (u64). Minimum: 2,592,000 (30 days). Maximum: 31,536,000 (365 days)
-   `initial_funding` - Initial funding amount (u64)
-   `accepts_contributions` - Whether vault accepts contributions (bool)
-   `delegate_to_creator` - Whether to delegate to creator (bool)
**Example:**
Typescript
Python
Copy
Ask AI
```
const transaction = await aptos.transaction.build.simple({
sender: account.accountAddress,
data: {
function: `${PACKAGE}::vault::create_and_fund_vault`,
typeArguments: [],
functionArguments: [
"0x456...def", // contributionAssetType (USDC metadata object address)
"My Trading Vault", // vaultName
"A managed vault for algorithmic trading strategies", // vaultDescription
["https://x.com/myvault", "https://discord.gg/myvault"], // vaultSocialLinks (vector: [xUrl, discordUrl])
"MTV", // vaultShareSymbol
"https://example.com/icon.png", // vaultShareIconUri
"https://example.com/vault", // vaultShareProjectUri
500, // feeBps (500 = 5%, max: 1000 = 10%)
2592000, // feeInterval (30 days in seconds, min: 2,592,000, max: 31,536,000)
100000000, // initialFunding (100 USDC with 6 decimals)
true, // acceptsContributions
true, // delegateToCreator
],
},
});
```
[Revoke Max Builder Fee](/transactions/builder-fee/revoke-max-builder-fee)[Activate Vault](/transactions/vault/activate)
⌘I