---
title: "Authenticated Requests"
url: "https://docs.decibel.trade/quickstart/authenticated-requests"
scraped: "2026-02-03T21:43:59.027Z"
---

# Authenticated Requests

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Getting Started
Authenticated Requests
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
## 
[​
](#sending-authenticated-requests)
Sending Authenticated Requests
To place orders and perform trading operations, you need to sign transactions with your private key and broadcast them on-chain. Decibel uses on-chain transactions that are signed with your private key and submitted to the Aptos blockchain.
### 
[​
](#generate-an-api-key)
Generate an API Key
First, generate an API key from the Decibel platform:
1.  Visit [https://app.decibel.trade/api](https://app.decibel.trade/api)
2.  Connect your wallet
3.  Click “Create API Wallet” to generate a new API key
4.  Copy and securely store your API key
**API Key Security:** Your API key is used to authenticate requests to Decibel’s services. Keep it secure and never share it publicly. The API key is used alongside your private key to sign and submit transactions.
### 
[​
](#how-authenticated-requests-work)
How Authenticated Requests Work
Authenticated requests in Decibel follow this general workflow:
1.  **Transaction Building**: Build an Aptos transaction calling the appropriate Move function with your parameters
2.  **Signing**: Your private key signs the transaction, creating a cryptographic signature
3.  **Submission**: The signed transaction is submitted directly to the Aptos blockchain
4.  **Confirmation**: Wait for the transaction to be confirmed on-chain and extract relevant information from transaction events
**Gas Fees:** You’ll need to have APT in your account to pay for transaction gas fees. The transaction will fail if you don’t have sufficient balance to cover the gas costs.
**Private Key Security:** Never expose your private key in client-side code or commit it to version control. Use environment variables or secure key management systems. Your private key has full control over your account and funds.
### 
[​
](#transaction-documentation)
Transaction Documentation
For detailed information on how to build and submit specific transactions, see the following documentation:
#### 
[​
](#account-management)
Account Management
-   [Create Subaccount](/transactions/account-management/create-subaccount) - Create a new trading subaccount
-   [Deposit](/transactions/account-management/deposit) - Deposit funds to a subaccount
-   [Withdraw](/transactions/account-management/withdraw) - Withdraw funds from a subaccount
-   [Configure Settings](/transactions/account-management/configure-settings) - Configure market-specific settings
-   [Delegate Trading](/transactions/account-management/delegate-trading) - Delegate trading permissions
-   [Revoke Delegation](/transactions/account-management/revoke-delegation) - Revoke trading delegation
#### 
[​
](#order-management)
Order Management
-   [Place Order](/transactions/order-management/place-order) - Place a new order
-   [Cancel Order](/transactions/order-management/cancel-order) - Cancel an order by order ID
-   [Cancel Client Order](/transactions/order-management/cancel-client-order) - Cancel an order by client order ID
-   [Place TWAP Order](/transactions/order-management/place-twap-order) - Place a time-weighted average price order
-   [Cancel TWAP Order](/transactions/order-management/cancel-twap-order) - Cancel a TWAP order
#### 
[​
](#position-management)
Position Management
-   [Place TP/SL Order](/transactions/position-management/place-tp-sl-order) - Place take profit and stop loss orders
-   [Update TP Order](/transactions/position-management/update-tp-order) - Update take profit order
-   [Update SL Order](/transactions/position-management/update-sl-order) - Update stop loss order
-   [Cancel TP/SL Order](/transactions/position-management/cancel-tp-sl-order) - Cancel take profit or stop loss order
#### 
[​
](#vault-operations)
Vault Operations
-   [Create and Fund Vault](/transactions/vault/create-and-fund) - Create a new vault and fund it
-   [Activate Vault](/transactions/vault/activate) - Activate a vault
-   [Contribute](/transactions/vault/contribute) - Contribute funds to a vault
-   [Redeem](/transactions/vault/redeem) - Redeem vault shares
-   [Delegate DEX Actions](/transactions/vault/delegate-dex-actions) - Delegate vault trading permissions
#### 
[​
](#builder-fee)
Builder Fee
-   [Approve Max Builder Fee](/transactions/builder-fee/approve-max-builder-fee) - Approve maximum builder fee
-   [Revoke Max Builder Fee](/transactions/builder-fee/revoke-max-builder-fee) - Revoke builder fee approval
### 
[​
](#advanced-topics)
Advanced Topics
For more advanced transaction building techniques, see:
-   [Optimized Transaction Building](/transactions/overview/optimized-building) - Learn how to build transactions synchronously using ABI data and replay protection nonces for better performance
-   [Formatting Prices and Sizes](/transactions/overview/formatting-prices-sizes) - Learn how to format prices and sizes for order-based transactions using market configuration parameters
[Market Data](/quickstart/market-data)[API Reference](/quickstart/api-reference)
⌘I