---
title: "Placing Your First Order"
url: "https://docs.decibel.trade/quickstart/placing-your-first-order"
scraped: "2026-02-03T21:44:02.263Z"
---

# Placing Your First Order

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Getting Started
Placing Your First Order
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
## 
[​
](#placing-your-first-order)
Placing Your First Order
This guide shows you the minimum required code to build, sign, and submit a transaction to place an order on Decibel.
### 
[​
](#prerequisites)
Prerequisites
Before you begin, make sure you have:
1.  Generated an API key from [https://app.decibel.trade/api](https://app.decibel.trade/api)
2.  Your private key (keep this secure!)
3.  APT in your account for gas fees
### 
[​
](#configuration-variables)
Configuration Variables
Before placing an order, you’ll need to set these configuration variables:
Netna
Testnet
Copy
Ask AI
```
PACKAGE=0xb8a5788314451ce4d2fbbad32e1bad88d4184b73943b7fe5166eab93cf1a5a95
FULLNODE_URL=https://api.netna.aptoslabs.com/v1
```
### 
[​
](#minimum-required-code)
Minimum Required Code
Here’s the minimal code needed to place an order:
Netna
Testnet
Netna
Testnet
Copy
Ask AI
```
import {
Aptos,
AptosConfig,
Ed25519Account,
Ed25519PrivateKey,
Network,
} from "@aptos-labs/ts-sdk";
// Configuration
const PACKAGE = "0xb8a5788314451ce4d2fbbad32e1bad88d4184b73943b7fe5166eab93cf1a5a95";
const FULLNODE_URL = "https://api.netna.aptoslabs.com/v1";
// Your private key (keep this secure!)
const privateKey = "0x..."; // Your private key in hex format
// Create account from private key
const account = new Ed25519Account({
privateKey: new Ed25519PrivateKey(privateKey),
});
// Initialize Aptos client
const aptosConfig = new AptosConfig({
network: Network.CUSTOM,
fullnode: FULLNODE_URL,
});
const aptos = new Aptos(aptosConfig);
// Build the transaction
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
null, // clientOrderId (optional)
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
// Sign the transaction
const senderAuthenticator = aptos.transaction.sign({
signer: account,
transaction,
});
// Submit the transaction
const pendingTransaction = await aptos.transaction.submit.simple({
transaction,
senderAuthenticator,
});
// Wait for confirmation
const executedTx = await aptos.waitForTransaction({
transactionHash: pendingTransaction.hash,
});
console.log("Order placed successfully!");
console.log("Transaction Hash:", executedTx.hash);
```
### 
[​
](#what-this-code-does)
What This Code Does
1.  **Imports**: Imports the necessary classes from `@aptos-labs/ts-sdk` (TypeScript) or `aptos-sdk` (Python)
2.  **Account Setup**: Creates an account from your private key
3.  **Client Initialization**: Initializes the Aptos client with the network configuration
4.  **Transaction Building**: Builds a transaction calling `place_order_to_subaccount` with your order parameters
5.  **Signing**: Signs the transaction with your private key
6.  **Submission**: Submits the signed transaction to the blockchain
7.  **Confirmation**: Waits for the transaction to be confirmed
### 
[​
](#next-steps)
Next Steps
For more detailed information, see:
-   [Place Order Transaction](/transactions/order-management/place-order) - Complete documentation for placing orders
-   [Formatting Prices and Sizes](/transactions/overview/formatting-prices-sizes) - Learn how to format prices and sizes correctly
-   [Optimized Transaction Building](/transactions/overview/optimized-building) - Learn how to build transactions synchronously for better performance
-   [Authenticated Requests](/quickstart/authenticated-requests) - Overview of authenticated requests
**Note:** This example uses mock addresses for `subaccountAddr` and `marketAddr`. In a real application, you’ll need to: - Get your subaccount address (see [Create Subaccount](/transactions/account-management/create-subaccount)) - Get the market address from the `v1/markets` API endpoint - Format prices and sizes correctly using market configuration (see [Formatting Prices and Sizes](/transactions/overview/formatting-prices-sizes))
**Security:** Never expose your private key in client-side code or commit it to version control. Use environment variables or secure key management systems.
[API Reference](/quickstart/api-reference)[Builder Codes](/quickstart/builder-codes)
⌘I