#!/usr/bin/env node

/**
 * Test Script: Place a Small TWAP Order on Decibel
 *
 * Purpose: Verify we can actually place TWAP orders before building UI
 *
 * Prerequisites:
 * 1. Wallet with testnet USDC minted on Decibel
 * 2. Private key in environment or hardcoded (testnet only!)
 *
 * What this tests:
 * - Can we call place_twap_order_to_subaccount?
 * - What are the exact parameter types?
 * - Does the transaction succeed?
 * - How does Decibel split the order?
 */

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

// Configuration
const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1";
const DECIBEL_PACKAGE = "0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844";

// Market addresses (from actual working transactions)
const MARKETS = {
  'BTC/USD': '0xdb8c5e968efa1b4dcbb4aaa7e4389358768d9b26bd126d5fe1a33e0aa076c380',
  'ETH/USD': '0xfaade75b8302ef13835f40c66ee812c3c0c8218549c42c0aebe24d79c27498d2',
};

// Test configuration
const TEST_CONFIG = {
  market: MARKETS['BTC/USD'],
  size: 100_000, // 0.001 BTC (8 decimals) - TINY for testing (~$100 notional)
  isLong: true,
  reduceOnly: false, // Not closing an existing position
  minDurationSeconds: 300, // 5 minutes
  maxDurationSeconds: 600, // 10 minutes
  builderAddress: undefined, // Optional builder address (use undefined for None)
  maxBuilderFee: undefined, // Optional max builder fee (use undefined for None)
};

async function main() {
  console.log('🧪 Decibel TWAP Order Test Script\n');

  // Initialize Aptos client
  const config = new AptosConfig({ network: Network.TESTNET });
  const aptos = new Aptos(config);

  // Get wallet private key (TESTNET ONLY - NEVER DO THIS ON MAINNET)
  let privateKeyHex = process.env.APTOS_PRIVATE_KEY;

  if (!privateKeyHex) {
    console.error('❌ Error: APTOS_PRIVATE_KEY environment variable not set');
    console.log('\nUsage:');
    console.log('  export APTOS_PRIVATE_KEY="0x..."');
    console.log('  node test_twap_order.mjs');
    console.log('\n⚠️  TESTNET ONLY - Never use real private keys in scripts!');
    process.exit(1);
  }

  // Strip ed25519-priv- prefix if present
  if (privateKeyHex.startsWith('ed25519-priv-')) {
    privateKeyHex = privateKeyHex.replace('ed25519-priv-', '');
  }

  let account;
  try {
    const privateKey = new Ed25519PrivateKey(privateKeyHex);
    account = Account.fromPrivateKey({ privateKey });
    console.log(`✅ Loaded wallet: ${account.accountAddress.toString()}`);
  } catch (error) {
    console.error('❌ Invalid private key format:', error.message);
    process.exit(1);
  }

  // Step 1: Get primary subaccount
  console.log('\n📍 Step 1: Getting primary subaccount...');
  try {
    const subaccountResult = await aptos.view({
      payload: {
        function: `${DECIBEL_PACKAGE}::dex_accounts_entry::primary_subaccount`,
        typeArguments: [],
        functionArguments: [account.accountAddress.toString()],
      },
    });

    const subaccountAddr = subaccountResult[0];
    console.log(`✅ Subaccount: ${subaccountAddr}`);

    // Step 2: Check available margin
    console.log('\n💰 Step 2: Checking available margin...');
    const marginResult = await aptos.view({
      payload: {
        function: `${DECIBEL_PACKAGE}::accounts_collateral::available_order_margin`,
        typeArguments: [],
        functionArguments: [subaccountAddr],
      },
    });

    const marginRaw = marginResult[0];
    const marginUSDC = Number(marginRaw) / 1_000_000;
    console.log(`✅ Available margin: $${marginUSDC.toFixed(2)} USDC`);

    if (marginUSDC < 10) {
      console.error('\n❌ Insufficient margin! Need at least $10 USDC');
      console.log('Go to https://app.decibel.trade and mint testnet USDC');
      process.exit(1);
    }

    // Step 3: Build TWAP order transaction
    console.log('\n📝 Step 3: Building TWAP order transaction...');
    console.log('Parameters:');
    console.log(`  - Market: BTC/USD`);
    console.log(`  - Size: ${(TEST_CONFIG.size / 100_000_000).toFixed(4)} BTC (~$${(TEST_CONFIG.size / 100_000_000 * 100000).toFixed(0)} notional)`);
    console.log(`  - Direction: ${TEST_CONFIG.isLong ? 'LONG' : 'SHORT'}`);
    console.log(`  - Reduce Only: ${TEST_CONFIG.reduceOnly}`);
    console.log(`  - Duration: ${TEST_CONFIG.minDurationSeconds}-${TEST_CONFIG.maxDurationSeconds}s`);

    // Function signature from on-chain ABI:
    // place_twap_order_to_subaccount(
    //   &signer,
    //   subaccount: Object<Subaccount>,
    //   market: Object<PerpMarket>,
    //   size: u64,
    //   is_long: bool,
    //   reduce_only: bool,
    //   min_duration_seconds: u64,
    //   max_duration_seconds: u64,
    //   builder_address: Option<address>,
    //   max_builder_fee: Option<u64>
    // )

    const transaction = await aptos.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function: `${DECIBEL_PACKAGE}::dex_accounts_entry::place_twap_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          subaccountAddr,                  // subaccount: Object<Subaccount> - SDK handles Object wrapper
          TEST_CONFIG.market,              // market: Object<PerpMarket> - SDK handles Object wrapper
          TEST_CONFIG.size,                // size: u64
          TEST_CONFIG.isLong,              // is_long: bool
          TEST_CONFIG.reduceOnly,          // reduce_only: bool
          TEST_CONFIG.minDurationSeconds,  // min_duration_seconds: u64
          TEST_CONFIG.maxDurationSeconds,  // max_duration_seconds: u64
          TEST_CONFIG.builderAddress,      // builder_address: Option<address>
          TEST_CONFIG.maxBuilderFee,       // max_builder_fee: Option<u64>
        ],
      },
    });

    console.log('✅ Transaction built successfully');

    // Step 4: Simulate transaction (safety check)
    console.log('\n🔍 Step 4: Simulating transaction...');
    try {
      const [simulationResult] = await aptos.transaction.simulate.simple({
        signerPublicKey: account.publicKey,
        transaction,
      });

      console.log(`Simulation success: ${simulationResult.success}`);
      console.log(`Gas used: ${simulationResult.gas_used}`);

      if (!simulationResult.success) {
        console.log(`⚠️  Simulation failed: ${simulationResult.vm_status}`);
        console.log('Attempting to submit anyway (simulation can be flaky)...');
      } else {
        console.log('✅ Simulation passed!');
      }
    } catch (error) {
      console.log(`⚠️  Simulation error: ${error.message}`);
      console.log('Attempting to submit anyway...');
    }

    // Step 5: Sign and submit transaction
    console.log('\n🚀 Step 5: Submitting transaction...');

    const committedTxn = await aptos.signAndSubmitTransaction({
      signer: account,
      transaction,
    });

    console.log(`✅ Transaction submitted: ${committedTxn.hash}`);

    // Step 6: Wait for confirmation
    console.log('\n⏳ Step 6: Waiting for confirmation...');
    const executedTxn = await aptos.waitForTransaction({
      transactionHash: committedTxn.hash,
    });

    console.log(`✅ Transaction confirmed: ${executedTxn.success}`);
    console.log(`   Version: ${executedTxn.version}`);
    console.log(`   Gas: ${executedTxn.gas_used}`);

    // Step 7: Display results
    console.log('\n🎉 SUCCESS! TWAP Order Placed');
    console.log('\nNext steps:');
    console.log(`1. View transaction: https://explorer.aptoslabs.com/txn/${committedTxn.hash}?network=testnet`);
    console.log(`2. Check Decibel UI: https://app.decibel.trade`);
    console.log(`3. Monitor order fills over the next ${TEST_CONFIG.maxDurationSeconds / 60} minutes`);
    console.log('\n✨ If this worked, we can build the bot UI with confidence!');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.data) {
      console.error('Details:', JSON.stringify(error.data, null, 2));
    }
    process.exit(1);
  }
}

main().catch(console.error);
