#!/usr/bin/env node

/**
 * TEST: Can our bot place orders on behalf of delegated users?
 *
 * This is THE critical test for our autonomous bot architecture.
 *
 * Prerequisites:
 * 1. Run test_bot_delegation.mjs first (user must delegate to our bot)
 * 2. Bot wallet must have testnet APT for gas
 * 3. User must have testnet USDC on Decibel
 *
 * Test Flow:
 * 1. Bot wallet loads its private key
 * 2. Bot attempts to place TWAP order on USER's subaccount
 * 3. Transaction signed by BOT, but trades USER's funds
 *
 * Expected Result: Order placed successfully
 * If FAILS: Delegation might not grant order placement permissions
 */

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

const DECIBEL_PACKAGE = "0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844";

const MARKETS = {
  'BTC/USD': '0xdb8c5e968efa1b4dcbb4aaa7e4389358768d9b26bd126d5fe1a33e0aa076c380',
  'ETH/USD': '0xfaade75b8302ef13835f40c66ee812c3c0c8218549c42c0aebe24d79c27498d2',
};

async function main() {
  console.log('🧪 Testing Delegated Order Placement\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Get BOT's private key
  let botPrivateKeyHex = process.env.BOT_OPERATOR_PRIVATE_KEY;
  if (!botPrivateKeyHex) {
    console.error('❌ Error: BOT_OPERATOR_PRIVATE_KEY not set in .env');
    console.log('\nAdd to .env:');
    console.log('BOT_OPERATOR_PRIVATE_KEY=ed25519-priv-0x...');
    process.exit(1);
  }

  // Get USER's wallet address (who delegated to us)
  const userWalletAddress = process.env.USER_WALLET_ADDRESS;
  if (!userWalletAddress) {
    console.error('❌ Error: USER_WALLET_ADDRESS not set');
    console.log('\nUsage:');
    console.log('  export USER_WALLET_ADDRESS="0x..." (the wallet that delegated to bot)');
    console.log('  export BOT_OPERATOR_PRIVATE_KEY="ed25519-priv-0x..."');
    console.log('  node scripts/test_delegated_order.mjs');
    process.exit(1);
  }

  // Strip prefix
  if (botPrivateKeyHex.startsWith('ed25519-priv-')) {
    botPrivateKeyHex = botPrivateKeyHex.replace('ed25519-priv-', '');
  }

  const config = new AptosConfig({ network: Network.TESTNET });
  const aptos = new Aptos(config);

  const botPrivateKey = new Ed25519PrivateKey(botPrivateKeyHex);
  const botAccount = Account.fromPrivateKey({ privateKey: botPrivateKey });

  console.log(`Bot Wallet: ${botAccount.accountAddress.toString()}`);
  console.log(`User Wallet: ${userWalletAddress}\n`);

  // Step 1: Get user's subaccount
  console.log('📍 Step 1: Getting user subaccount...');
  const subaccountResult = await aptos.view({
    payload: {
      function: `${DECIBEL_PACKAGE}::dex_accounts::primary_subaccount`,
      typeArguments: [],
      functionArguments: [userWalletAddress],
    },
  });

  const userSubaccount = subaccountResult[0];
  console.log(`✅ User Subaccount: ${userSubaccount}\n`);

  // Step 2: Check user's available margin
  console.log('💰 Step 2: Checking user available margin...');
  const marginResult = await aptos.view({
    payload: {
      function: `${DECIBEL_PACKAGE}::accounts_collateral::available_order_margin`,
      typeArguments: [],
      functionArguments: [userSubaccount],
    },
  });

  const marginRaw = marginResult[0];
  const marginUSDC = Number(marginRaw) / 1_000_000;
  console.log(`✅ User has: $${marginUSDC.toFixed(2)} USDC\n`);

  if (marginUSDC < 10) {
    console.error('❌ Insufficient margin! User needs at least $10 USDC');
    console.log('User should mint USDC at: https://app.decibel.trade');
    process.exit(1);
  }

  // Step 3: Check bot's APT balance (for gas)
  console.log('⛽ Step 3: Checking bot APT balance...');
  try {
    const botAPTRaw = await aptos.getAccountAPTAmount({
      accountAddress: botAccount.accountAddress,
    });

    const botAPT = Number(botAPTRaw) / 100_000_000;
    console.log(`✅ Bot has: ${botAPT.toFixed(4)} APT for gas\n`);

    if (botAPT < 0.01) {
      console.error('⚠️  Warning: Bot APT is low! Should have at least 0.1 APT');
      console.log('Fund bot at: https://faucet.testnet.aptoslabs.com/?address=' + botAccount.accountAddress.toString());
      console.log('\nContinuing anyway...\n');
    }
  } catch (error) {
    console.error('❌ Could not check bot balance:', error.message);
    console.error('Bot wallet may not be initialized - fund it first!');
    process.exit(1);
  }

  // Step 4: Build TWAP order (BOT signs, USER's subaccount)
  console.log('📝 Step 4: Building TWAP order...');
  console.log('CRITICAL TEST: Bot signing for user subaccount');
  console.log('Parameters:');
  console.log(`  - Signer: BOT (${botAccount.accountAddress.toString().slice(0, 10)}...)`);
  console.log(`  - Subaccount: USER (${userSubaccount.slice(0, 10)}...)`);
  console.log(`  - Market: BTC/USD`);
  console.log(`  - Size: 0.0001 BTC (~$10 notional)`);
  console.log(`  - Duration: 5-10 minutes\n`);

  const transaction = await aptos.transaction.build.simple({
    sender: botAccount.accountAddress,  // BOT signs this!
    data: {
      function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
      typeArguments: [],
      functionArguments: [
        userSubaccount,              // USER's subaccount
        MARKETS['BTC/USD'],
        10_000,                      // 0.0001 BTC (very small test)
        true,                        // is_long
        false,                       // reduce_only
        300,                         // 5 min
        600,                         // 10 min
        undefined,                   // builder_address
        undefined,                   // max_builder_fee
      ],
    },
  });

  console.log('🔍 Step 5: Simulating transaction...');
  try {
    const [simulationResult] = await aptos.transaction.simulate.simple({
      signerPublicKey: botAccount.publicKey,
      transaction,
    });

    console.log(`Simulation: ${simulationResult.success ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Gas estimate: ${simulationResult.gas_used}\n`);

    if (!simulationResult.success) {
      console.error('⚠️  Simulation failed!');
      console.error('VM Status:', simulationResult.vm_status);
      console.error('\nPossible reasons:');
      console.error('- User has not delegated to bot yet (run test_bot_delegation.mjs)');
      console.error('- Delegation does not grant order placement permissions');
      console.error('- Order parameters invalid');
      console.log('\nAttempting to submit anyway...\n');
    }
  } catch (error) {
    console.log(`⚠️  Simulation error: ${error.message}`);
    console.log('Continuing...\n');
  }

  // Step 6: Submit transaction
  console.log('🚀 Step 6: Submitting order (BOT signs)...');

  const committedTxn = await aptos.signAndSubmitTransaction({
    signer: botAccount,  // BOT wallet signs and pays gas
    transaction,
  });

  console.log(`✅ Transaction submitted: ${committedTxn.hash}`);

  const executedTxn = await aptos.waitForTransaction({
    transactionHash: committedTxn.hash,
  });

  console.log(`✅ Transaction confirmed: ${executedTxn.success}\n`);

  // Step 7: Results
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉 SUCCESS! Delegated order placement works!\n');

  console.log('What this proves:');
  console.log('✅ Bot can place orders on behalf of delegated users');
  console.log('✅ Bot pays gas (APT), user provides margin (USDC)');
  console.log('✅ Autonomous trading is POSSIBLE!\n');

  console.log('Architecture Confirmed:');
  console.log('┌─────────────────┐      ┌─────────────────┐');
  console.log('│  User Wallet    │      │  Bot Wallet     │');
  console.log('│  - Has USDC     │──────│  - Has APT      │');
  console.log('│  - Delegates 1x │      │  - Signs orders │');
  console.log('│  - Keeps funds  │      │  - Pays gas     │');
  console.log('└─────────────────┘      └─────────────────┘\n');

  console.log('Next: Build the autonomous loop!');
  console.log(`View tx: https://explorer.aptoslabs.com/txn/${committedTxn.hash}?network=testnet`);
}

main().catch((error) => {
  console.error('\n❌ Test Failed:', error.message);
  console.error('\nDiagnosis:');

  if (error.message.includes('INSUFFICIENT_BALANCE')) {
    console.error('- Bot wallet needs more APT for gas');
  } else if (error.message.includes('SEQUENCE_NUMBER')) {
    console.error('- Transaction sequencing issue (retry)');
  } else if (error.message.includes('MOVE_ABORT')) {
    console.error('- Move contract rejected transaction');
    console.error('- Most likely: User has NOT delegated to bot yet');
    console.error('- Run: node scripts/test_bot_delegation.mjs first');
  } else {
    console.error('- Unknown error, see stack trace below');
  }

  console.error('\nStack:', error);
  process.exit(1);
});
