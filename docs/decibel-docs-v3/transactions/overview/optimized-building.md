---
title: "Optimized Transaction Building"
url: "https://docs.decibel.trade/transactions/overview/optimized-building"
scraped: "2026-02-03T21:44:11.872Z"
---

# Optimized Transaction Building

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Overview
Optimized Transaction Building
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'wide');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
## 
[​
](#overview)
Overview
The optimized approach uses:
-   **ABI (Application Binary Interface)**: Pre-loaded function signatures and parameter types.
-   **Replay Protection Nonce**: A random 64-bit value embedded in the transaction payload to enable orderless transactions.
-   **Chain ID**: The network identifier to prevent cross-chain replay attacks.
## 
[​
](#orderless-transactions)
Orderless Transactions
These transactions are **orderless**, meaning they can be submitted in any order without requiring sequential sequence numbers. The `replayProtectionNonce` is embedded directly in the transaction payload to provide replay protection, eliminating the need to fetch the account’s current sequence number from the network. **Benefits of orderless transactions:**
-   **No sequence number fetch**: Avoids network round-trip to get account sequence number
-   **Parallel execution**: Multiple transactions can be built and submitted simultaneously
-   **Better performance**: Faster transaction construction without waiting for network responses
-   **Improved UX**: Transactions can be prepared offline and submitted later
**Traditional (non-orderless) transactions:**
-   Require fetching the account’s current sequence number from the network
-   Must be submitted sequentially (each transaction increments the sequence number)
-   Cannot be built in parallel without coordination
-   Require network calls during transaction construction
* * *
## 
[​
](#generate-replay-protection-nonce)
Generate Replay Protection Nonce
The replay protection nonce is a random 64-bit value that enables orderless transactions. Instead of using the account’s sequence number (which requires a network fetch), the nonce is embedded in the transaction payload to prevent replay attacks. **Generate a random 64-bit nonce for replay protection:**
Typescript
Python
Copy
Ask AI
```
function generateRandomReplayProtectionNonce(): bigint | null {
const buf = new Uint32Array(2);
crypto.getRandomValues(buf);
const valueAtIndex0 = buf[0];
const valueAtIndex1 = buf[1];
if (!valueAtIndex0 || !valueAtIndex1) return null;
// Combine two 32-bit parts into a single 64-bit bigint
return (BigInt(valueAtIndex0) << BigInt(32)) | BigInt(valueAtIndex1);
}
```
* * *
## 
[​
](#parse-abi-to-entryfunctionabi)
Parse ABI to EntryFunctionABI
Before building a transaction, parse the `MoveFunction` ABI to the `EntryFunctionABI` format required for transaction payload construction.
Typescript
Python
Copy
Ask AI
```
const parseMoveFnAbiToEntryFnABI = (
functionAbi: MoveFunction
): EntryFunctionABI => {
// Remove the signer arguments
const numSigners = findFirstNonSignerArg(functionAbi);
const params: TypeTag[] = [];
for (let i = numSigners; i < functionAbi.params.length; i += 1) {
const param = functionAbi.params[i];
if (!param) continue;
params.push(parseTypeTag(param, { allowGenerics: true }));
}
return {
signers: numSigners,
typeParameters: functionAbi.generic_type_params,
parameters: params,
};
};
```
* * *
## 
[​
](#generate-expiration-timestamp)
Generate Expiration Timestamp
A convenience function to compute the expiration timestamp for the transaction.
Typescript Typescript
Python
Copy
Ask AI
```
const generateExpireTimestamp = (aptosConfig: AptosConfig) =>
Math.floor(Date.now() / 1000) + aptosConfig.getDefaultTxnExpirySecFromNow();
```
* * *
## 
[​
](#build-transaction-synchronously)
Build Transaction Synchronously
This function builds a transaction payload and constructs a `RawTransaction` synchronously using all pre-known parameters.
Typescript
Python
Copy
Ask AI
```
import {
AccountAddress,
AccountAddressInput,
AptosConfig,
ChainId,
convertPayloadToInnerPayload,
EntryFunctionABI,
findFirstNonSignerArg,
generateTransactionPayloadWithABI,
InputEntryFunctionData,
InputEntryFunctionDataWithABI,
MoveFunction,
parseTypeTag,
RawTransaction,
SimpleTransaction,
TypeTag,
} from "@aptos-labs/ts-sdk";
function buildSimpleTransactionSync(args: {
aptosConfig: AptosConfig;
sender: AccountAddressInput;
data: InputEntryFunctionData;
chainId: number;
gasUnitPrice: number;
abi: MoveFunction;
withFeePayer: boolean;
replayProtectionNonce: bigint;
}): SimpleTransaction {
const txnPayload = generateTransactionPayloadWithABI({
aptosConfig: args.aptosConfig,
function: args.data.function,
functionArguments: args.data.functionArguments,
typeArguments: args.data.typeArguments,
abi: parseMoveFnAbiToEntryFnABI(args.abi),
} as InputEntryFunctionDataWithABI);
const expireTimestamp = generateExpireTimestamp(args.aptosConfig);
const rawTxn = new RawTransaction(
AccountAddress.from(args.sender),
BigInt("0xdeadbeef"), // Default Sequence Number as it is unused when replay nonce is provided
convertPayloadToInnerPayload(txnPayload, args.replayProtectionNonce), // Convert payload and embed replay protection nonce
BigInt(args.aptosConfig.getDefaultMaxGasAmount()),
BigInt(args.gasUnitPrice),
BigInt(expireTimestamp),
new ChainId(args.chainId)
);
return new SimpleTransaction(
rawTxn,
args.withFeePayer ? AccountAddress.ZERO : undefined
);
}
```
* * *
## 
[​
](#complete-example-building-a-transaction)
Complete Example: Building a Transaction
Below is a complete example of building and submitting a transaction using the optimized (orderless, synchronous) approach.
Typescript
Python
Copy
Ask AI
```
// Example: Build and submit a transaction synchronously using ABI and replay nonce.
import {
Aptos,
AptosConfig,
AccountAddress,
SimpleTransaction,
MoveFunction,
} from "@aptos-labs/ts-sdk";
const subaccountAddr = "0x..."; // Your subaccount address
const accountToDelegateTo = "0x..."; // Address to delegate trading to
const expirationTimestamp = undefined; // Optional: expiration timestamp in seconds
// Initialize Aptos config
const aptosConfig = new AptosConfig({
network: "mainnet",
fullnode: "https://fullnode.mainnet.aptoslabs.com",
});
const aptos = new Aptos(aptosConfig);
// ABI for delegate_trading_to function
const functionAbi: MoveFunction = {
name: "delegate_trading_to_for_subaccount",
visibility: "friend",
is_entry: true,
is_view: false,
generic_type_params: [],
params: ["&signer", "address", "address", "0x1::option::Option<u64>"],
return: [],
};
const replayProtectionNonce = generateRandomReplayProtectionNonce();
// Get gas price (from cache or network)
const gasUnitPrice = await aptos
.getGasPriceEstimation()
.then((r) => r.gas_estimate);
// Build transaction synchronously
const transaction = buildSimpleTransactionSync({
aptosConfig: aptos.config,
sender: account.accountAddress,
data: {
function: `${PACKAGE}::dex_accounts::delegate_trading_to`,
typeArguments: [],
functionArguments: [
subaccountAddr, // Subaccount address
accountToDelegateTo, // Address to delegate trading to
expirationTimestamp, // Optional expiration timestamp (can be undefined)
],
},
chainId: 1, // Mainnet chain ID
gasUnitPrice,
abi: functionAbi,
withFeePayer: false,
replayProtectionNonce,
});
// Sign and submit the transaction
const senderAuthenticator = aptos.transaction.sign({
signer: account,
transaction,
});
const pendingTransaction = await aptos.transaction.submit.simple({
transaction,
senderAuthenticator,
});
// Wait for transaction confirmation
const committedTransaction = await aptos.waitForTransaction({
transactionHash: pendingTransaction.hash,
});
console.log("Transaction confirmed:", committedTransaction.hash);
```
* * *
## 
[​
](#benefits)
Benefits
-   **Performance**: No network calls during transaction construction
-   **Reliability**: Deterministic transaction building with pre-loaded ABI
-   **Security**: Replay protection nonce prevents transaction replay attacks
-   **Efficiency**: Can build multiple transactions in parallel without blocking
* * *
## 
[​
](#when-to-use)
When to Use
Use the optimized synchronous approach when:
-   You have ABI data available locally
-   You know the chain ID
-   You want to build transactions without network latency
-   You’re building multiple transactions in batch
* * *
## 
[​
](#fallback-to-async-building)
Fallback to Async Building
If ABI or chain ID is not available, the SDK falls back to async transaction building, which may require a network fetch to get the account’s sequence number for replay protection.
Typescript
Python
Copy
Ask AI
```
// Fallback: Build a transaction asynchronously when ABI or chainId are missing
// This will fetch the account's sequence number from the network.
const transaction = await aptos.transaction.build.simple({
sender,
data: payload,
withFeePayer,
options: {
replayProtectionNonce, // Still uses nonce if provided, but may also fetch sequence number
},
});
```
**What happens without orderless transactions:**
-   The SDK makes a network request to fetch the account’s current sequence number when you call `aptos.transaction.build.simple()`
-   The sequence number is used for replay protection instead of (or in addition to) the nonce
-   Transactions must be submitted sequentially
-   Each transaction increments the sequence number, preventing parallel submission
[Overview](/transactions/overview)[Formatting Prices and Sizes for Orders](/transactions/overview/formatting-prices-sizes)
⌘I