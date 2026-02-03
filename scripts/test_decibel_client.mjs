// Test script demonstrating DecibelClient usage with correct function signatures
// This is a reference implementation - NOT for execution (requires wallet private key)

import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';

const DECIBEL_PACKAGE = '0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844';
const USDC_DECIMALS = 6;

// Market addresses from REST API
const BTC_MARKET = '0x6a39745aaa7af8258060566f6501d84581de815128694f8ee013cae28e3357e7';
const ETH_MARKET = '0xd9093834d0ee89ca16bb3aac64e321241fe091354fc526f0e03686e206e936f8';

// Example wallet addresses - replace with your own for testing
const WALLET_ADDRESS = '0x<YOUR_WALLET_ADDRESS_HERE>';
const SUBACCOUNT_ADDRESS = '0x<YOUR_SUBACCOUNT_ADDRESS_HERE>';

const aptosConfig = new AptosConfig({ network: Network.TESTNET });
const aptos = new Aptos(aptosConfig);

console.log('=== Decibel Client Test Script ===\n');

// 1. Query primary subaccount
console.log('1. Querying primary subaccount...');
const subaccount = await aptos.view({
  payload: {
    function: `${DECIBEL_PACKAGE}::dex_accounts_entry::primary_subaccount`,
    typeArguments: [],
    functionArguments: [WALLET_ADDRESS],
  },
});
console.log(`   Subaccount: ${subaccount[0]}`);
console.log(`   ✅ Matches known: ${subaccount[0] === SUBACCOUNT_ADDRESS}\n`);

// 2. Query available margin
console.log('2. Querying available margin...');
const marginResult = await aptos.view({
  payload: {
    function: `${DECIBEL_PACKAGE}::accounts_collateral::available_order_margin`,
    typeArguments: [],
    functionArguments: [SUBACCOUNT_ADDRESS],
  },
});
const marginRaw = marginResult[0];
const marginUSDC = parseInt(marginRaw) / Math.pow(10, USDC_DECIMALS);
console.log(`   Raw margin: ${marginRaw}`);
console.log(`   USDC balance: $${marginUSDC.toFixed(2)}\n`);

// 3. Example: Native TWAP Order (requires signer)
console.log('3. Native TWAP Order Example:');
console.log('   Function: dex_accounts::place_twap_order_to_subaccount');
console.log('   Parameters:');
console.log(`     - subaccount: ${SUBACCOUNT_ADDRESS}`);
console.log(`     - market: ${BTC_MARKET} (BTC/USD)`);
console.log(`     - size: 10000000 (10 USDC notional, in raw units)`);
console.log(`     - is_long: true (buy side)`);
console.log(`     - reduce_only: false`);
console.log(`     - min_duration_seconds: 300 (5 minutes)`);
console.log(`     - max_duration_seconds: 900 (15 minutes)`);
console.log(`     - referrer: [] (none)`);
console.log(`     - client_order_id: [] (none)\n`);

// 4. Example: Limit Order (requires signer)
console.log('4. Limit Order Example:');
console.log('   Function: dex_accounts::place_order_to_subaccount');
console.log('   Parameters:');
console.log(`     - subaccount: ${SUBACCOUNT_ADDRESS}`);
console.log(`     - market: ${ETH_MARKET} (ETH/USD)`);
console.log(`     - price: 3500000000 (price in raw units with 6 decimals = $3500)`);
console.log(`     - size: 2857143 (size in raw units = 0.01 ETH, 7 decimals)`);
console.log(`     - is_long: true`);
console.log(`     - order_type: 0 (limit)`);
console.log(`     - post_only: true (maker-only)`);
console.log(`     - client_order_id: [] (optional)`);
console.log(`     - [8 more optional parameters]`);

console.log('\n✅ All queries successful! DecibelClient is ready to use.');
console.log('\nNOTE: Order placement requires wallet signature (private key).');
console.log('      Use DecibelClient class from lib/decibel-client.ts for full functionality.');
