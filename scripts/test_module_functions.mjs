#!/usr/bin/env node

/**
 * Test Script: Query Decibel Module Functions
 *
 * Purpose: Verify function signatures before attempting to call them
 */

import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';

const DECIBEL_PACKAGE = "0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75";

async function main() {
  console.log('🔍 Querying Decibel Module Functions\n');

  const config = new AptosConfig({ network: Network.TESTNET });
  const aptos = new Aptos(config);

  // Query dex_accounts module
  console.log('📦 Module: dex_accounts');
  try {
    const module = await aptos.getAccountModule({
      accountAddress: DECIBEL_PACKAGE,
      moduleName: 'dex_accounts',
    });

    const entryFunctions = module.abi.exposed_functions.filter(
      (f) => f.is_entry
    );

    console.log(`\nFound ${entryFunctions.length} entry functions:\n`);

    entryFunctions.forEach((func) => {
      console.log(`📌 ${func.name}`);
      console.log(`   Parameters: ${func.params.join(', ')}`);
      console.log(`   Generic type params: ${func.generic_type_params.length}`);
      console.log('');
    });

    // Look for TWAP function specifically
    const twapFunc = entryFunctions.find((f) =>
      f.name.includes('twap')
    );

    if (twapFunc) {
      console.log('✅ Found TWAP function!');
      console.log(JSON.stringify(twapFunc, null, 2));
    }

  } catch (error) {
    console.error('❌ Error querying module:', error.message);
  }
}

main().catch(console.error);
