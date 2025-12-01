#!/usr/bin/env node

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

async function main() {
  const privateKeyHex = process.env.APTOS_PRIVATE_KEY;

  if (!privateKeyHex) {
    console.error('❌ APTOS_PRIVATE_KEY not set');
    process.exit(1);
  }

  const config = new AptosConfig({ network: Network.TESTNET });
  const aptos = new Aptos(config);

  const privateKey = new Ed25519PrivateKey(privateKeyHex);
  const account = Account.fromPrivateKey({ privateKey });

  console.log(`🚰 Funding wallet with testnet APT...\n`);
  console.log(`Wallet: ${account.accountAddress.toString()}\n`);

  try {
    // Fund the account with testnet APT
    await aptos.fundAccount({
      accountAddress: account.accountAddress,
      amount: 100_000_000, // 1 APT
    });

    console.log('✅ Funded with 1 APT for gas fees!\n');

    // Check new balance
    const resources = await aptos.getAccountResources({
      accountAddress: account.accountAddress,
    });

    const coinResource = resources.find(
      (r) => r.type === '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
    );

    if (coinResource) {
      const balance = Number(coinResource.data.coin.value) / 100_000_000;
      console.log(`💰 New APT Balance: ${balance.toFixed(4)} APT`);
      console.log('\n🎉 Ready to place orders!');
      console.log('\nRun: node test_twap_order.mjs');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main().catch(console.error);
