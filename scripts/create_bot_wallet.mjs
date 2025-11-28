#!/usr/bin/env node

/**
 * Create Bot Operator Wallet
 *
 * This creates a new wallet that your backend will use to execute
 * trades on behalf of users who have delegated permissions.
 *
 * Run once, save the private key securely, then DELETE this script!
 */

import { Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

console.log('🤖 Creating Bot Operator Wallet\n');

// Generate new random keypair
const account = Account.generate();

console.log('✅ Wallet Created!\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('📋 SAVE THESE DETAILS SECURELY:\n');
console.log(`Address: ${account.accountAddress.toString()}`);
console.log(`Private Key: ${account.privateKey.toString()}\n`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('🔐 IMPORTANT NEXT STEPS:\n');
console.log('1. Add to .env.local:');
console.log(`   BOT_OPERATOR_ADDRESS=${account.accountAddress.toString()}`);
console.log(`   BOT_OPERATOR_PRIVATE_KEY=${account.privateKey.toString()}\n`);

console.log('2. Fund this wallet with testnet APT (for gas):');
console.log(`   https://faucet.testnet.aptoslabs.com/?address=${account.accountAddress.toString()}\n`);

console.log('3. Add this address to your frontend config (lib/decibel-client.ts):');
console.log(`   export const BOT_OPERATOR = "${account.accountAddress.toString()}"\n`);

console.log('4. DELETE THIS SCRIPT after saving the details!\n');
console.log('⚠️  Never commit private keys to git!');
