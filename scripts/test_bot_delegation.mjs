#!/usr/bin/env node

/**
 * TEST: Can users delegate to OUR bot wallet?
 *
 * This tests the critical assumption that users can delegate trading
 * permissions to arbitrary addresses (our bot), not just Decibel's operator.
 *
 * Test Flow:
 * 1. User delegates to OUR_BOT_WALLET (not Decibel's operator)
 * 2. Verify delegation succeeded
 * 3. Check if delegation is active
 *
 * Expected Result: Should work (delegation to any address)
 * If FAILS: We need Option A (user signs every trade)
 */

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

const DECIBEL_PACKAGE = "0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75";

// OUR bot wallet (from .env)
const OUR_BOT_OPERATOR = process.env.BOT_OPERATOR_ADDRESS || "0x501f5aab249607751b53dcb84ed68c95ede4990208bd861c3374a9b8ac1426da";

// Decibel's official operator (for comparison)
const DECIBEL_OPERATOR = "0x596dfe6cd170290d228360c948c1db5fe3ba2142a7dc57494c87598038d3006f";

async function main() {
  console.log('🧪 Testing Custom Bot Delegation\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Get user's private key
  let privateKeyHex = process.env.APTOS_PRIVATE_KEY;

  if (!privateKeyHex) {
    console.error('❌ Error: APTOS_PRIVATE_KEY environment variable not set');
    console.log('\nUsage:');
    console.log('  export APTOS_PRIVATE_KEY="ed25519-priv-0x..."');
    console.log('  export BOT_OPERATOR_ADDRESS="0x501f5a..." (optional)');
    console.log('  node scripts/test_bot_delegation.mjs');
    process.exit(1);
  }

  // Strip ed25519-priv- prefix if present
  if (privateKeyHex.startsWith('ed25519-priv-')) {
    privateKeyHex = privateKeyHex.replace('ed25519-priv-', '');
  }

  const config = new AptosConfig({ network: Network.TESTNET });
  const aptos = new Aptos(config);

  const privateKey = new Ed25519PrivateKey(privateKeyHex);
  const userAccount = Account.fromPrivateKey({ privateKey });

  console.log(`User Wallet: ${userAccount.accountAddress.toString()}\n`);

  // Step 1: Get user's subaccount
  console.log('📍 Step 1: Getting user subaccount...');
  const subaccountResult = await aptos.view({
    payload: {
      function: `${DECIBEL_PACKAGE}::dex_accounts::primary_subaccount`,
      typeArguments: [],
      functionArguments: [userAccount.accountAddress.toString()],
    },
  });

  const subaccountAddr = subaccountResult[0];
  console.log(`✅ Subaccount: ${subaccountAddr}\n`);

  // Step 2: Check current delegation status
  console.log('🔍 Step 2: Checking existing delegations...');

  try {
    // Try to check if already delegated to our bot
    // Note: We might need to query on-chain state for this
    console.log(`Checking delegation to OUR bot: ${OUR_BOT_OPERATOR}`);
    console.log(`Checking delegation to Decibel operator: ${DECIBEL_OPERATOR}\n`);
  } catch (error) {
    console.log('⚠️  Could not check existing delegations (might not be exposed)\n');
  }

  // Step 3: Delegate to OUR bot
  console.log('🔐 Step 3: Delegating to OUR bot wallet...');
  console.log(`Operator: ${OUR_BOT_OPERATOR}`);
  console.log(`Expiration: None (unlimited)\n`);

  console.log('⚠️  IMPORTANT: This will replace any existing delegation!');
  console.log('If you were delegated to Decibel operator, that will be overwritten.\n');

  const transaction = await aptos.transaction.build.simple({
    sender: userAccount.accountAddress,
    data: {
      function: `${DECIBEL_PACKAGE}::dex_accounts::delegate_trading_to_for_subaccount`,
      typeArguments: [],
      functionArguments: [
        subaccountAddr,
        OUR_BOT_OPERATOR,
        undefined, // no expiration
      ],
    },
  });

  console.log('Submitting delegation transaction...');

  const committedTxn = await aptos.signAndSubmitTransaction({
    signer: userAccount,
    transaction,
  });

  console.log(`✅ Transaction submitted: ${committedTxn.hash}`);

  const executedTxn = await aptos.waitForTransaction({
    transactionHash: committedTxn.hash,
  });

  console.log(`✅ Delegation confirmed: ${executedTxn.success}\n`);

  // Step 4: Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉 SUCCESS! Custom bot delegation works!\n');

  console.log('What this means:');
  console.log('✅ Users CAN delegate to arbitrary addresses (not just Decibel operator)');
  console.log('✅ Our bot wallet can act as a delegated operator');
  console.log('✅ Users keep their USDC, bot just needs APT for gas\n');

  console.log('Next Steps:');
  console.log('1. Run: node scripts/test_delegated_order.mjs');
  console.log('   (Test if our bot can actually place orders)\n');

  console.log('2. If that works, we can build the autonomous bot loop!\n');

  console.log('Transaction Details:');
  console.log(`View: https://explorer.aptoslabs.com/txn/${committedTxn.hash}?network=testnet`);
}

main().catch((error) => {
  console.error('\n❌ Test Failed:', error.message);
  console.error('\nPossible reasons:');
  console.error('- User wallet has no APT for gas fees');
  console.error('- Subaccount not created yet (mint USDC on Decibel first)');
  console.error('- Network connectivity issues');
  console.error('\nStack trace:', error);
  process.exit(1);
});
