---
title: "Builder Codes"
url: "https://docs.decibel.trade/quickstart/builder-codes"
scraped: "2026-02-03T21:43:59.475Z"
---

# Builder Codes

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Builder Codes
Builder Codes
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
Builder codes allow you to earn fees when users execute transactions through your application. When placing orders or executing other transactions, you can specify a builder address and fee to receive a portion of the transaction fees.
**User Approval Required:** Users must approve the maximum builder fee **before** your application can collect fees. This is a security measure to prevent unauthorized fee collection.
### 
[​
](#step-1-approve-maximum-builder-fee)
Step 1: Approve Maximum Builder Fee
Before users can pay builder fees, they need to approve a maximum builder fee amount. This is a one-time approval that allows your application to collect fees up to the approved limit:
Copy
Ask AI
```
await dex.approveMaxBuilderFee({
builderAddr: builderAddress, // Builder's address (64 characters, padded with zeros)
maxFee: maxBuilderFeeBps, // Maximum fee in basis points (e.g., 10 = 0.1%)
});
```
**Parameters:**
-   **`builderAddr`**: The address of the builder that should receive the fee. Must be a 64-character hex string (pad with leading zeros after `0x`).
-   **`maxFee`**: The maximum fee in basis points (1 basis point = 0.01%). For example:
-   `10` = 0.1%
-   `100` = 1%
-   `1000` = 10%
### 
[​
](#step-2-place-order-with-builder-codes)
Step 2: Place Order with Builder Codes
Once the builder fee is approved, you can place orders with builder codes:
Copy
Ask AI
```
const orderResult = await dex.placeOrder({
marketName: "APT/USD",
price: 300000000,
size: 1000000000,
isBuy: true,
timeInForce: TimeInForce.ImmediateOrCancel,
isReduceOnly: false,
// Builder code parameters
builderAddr: builderAddress, // Same address from Step 1
builderFee: maxBuilderFeeBps, // Must be <= maxFee from Step 1
});
```
**Builder Code Parameters:**
-   **`builderAddr`** (optional): The address of the builder that should receive the fee. Must match the address approved in Step 1.
-   **`builderFee`** (optional): The fee amount in basis points. Must be less than or equal to the `maxFee` approved in Step 1.
### 
[​
](#important-notes)
Important Notes
-   **Approval is required first**: Users must approve the maximum builder fee (Step 1) before you can use builder codes in transactions (Step 2)
-   **Fee limits**: The `builderFee` in Step 2 cannot exceed the `maxFee` approved in Step 1
-   **Address format**: Builder addresses must be 64 characters (pad with leading zeros after `0x`)
-   **Fee calculation**: Builder fees are deducted from the user’s transaction fees
-   **Payment**: Builder fees are paid in the same token as the transaction fees
-   **Optional**: If no builder address is specified, no builder fee is collected
### 
[​
](#example-placing-an-order-with-builder-codes)
Example: Placing an Order with Builder Codes
Here’s the complete flow for using builder codes when placing an order using the TypeScript SDK: Your browser does not support the video tag.
Copy
Ask AI
```
import {
DecibelWriteDex,
DecibelReadDex,
NETNA_CONFIG,
TimeInForce,
} from "@decibeltrade/sdk";
import { Ed25519Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
// Setup account from private key
const privateKeyHex = process.env.PRIVATE_KEY;
const user = new Ed25519Account({
privateKey: new Ed25519PrivateKey(privateKeyHex!),
});
// Initialize DEX clients
const dex = new DecibelWriteDex(NETNA_CONFIG, user, {
skipSimulate: true,
});
const readDex = new DecibelReadDex(NETNA_CONFIG);
// Aptos addresses must be 64 characters (pad with leading zeros after 0x)
const builderAddress =
"0x0000000000000000000000008c967e73e7b15087c42a10d344cff4c96d877f1d";
const maxBuilderFeeBps = 10; // 10 basis points = 0.1%
// Step 1: Approve builder fee
await dex.approveMaxBuilderFee({
builderAddr: builderAddress,
maxFee: maxBuilderFeeBps,
});
console.log("\nBuilder fee approved...");
// Step 2: Place a market order with builder fee
console.log("\nPlacing order with builder fee...");
const orderResult = await dex.placeOrder({
marketName: "APT/USD",
price: 300000000, // 3 USD
size: 1000000000, // 1000 APT
isBuy: true,
timeInForce: TimeInForce.ImmediateOrCancel, // Market order
isReduceOnly: false,
builderAddr: builderAddress,
builderFee: maxBuilderFeeBps,
});
if (orderResult.success) {
console.log(`Order placed! Transaction: ${orderResult.transactionHash}`);
}
```
For more details on builder fees, see the [Builder Fee Transaction Guides](/transactions/builder-fee/approve-max-builder-fee).
## 
[​
](#resources)
Resources
-   [TypeScript SDK Documentation](/typescript-sdk/overview)
-   [REST API Reference](/api-reference)
-   [WebSocket API Reference](/asyncapi)
-   [Transaction Guides](/transactions/overview/index)
-   [Builder Fee Guides](/transactions/builder-fee/approve-max-builder-fee)
[Placing Your First Order](/quickstart/placing-your-first-order)
⌘I