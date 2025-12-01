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

  console.log(`Wallet: ${account.accountAddress.toString()}\n`);

  try {
    // Get APT balance
    const resources = await aptos.getAccountResources({
      accountAddress: account.accountAddress,
    });

    const coinResource = resources.find(
      (r) => r.type === '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
    );

    if (coinResource) {
      const balance = Number(coinResource.data.coin.value) / 100_000_000; // 8 decimals
      console.log(`💰 APT Balance: ${balance.toFixed(4)} APT`);

      if (balance < 0.01) {
        console.log('\n❌ Insufficient APT for gas fees!');
        console.log('\n🚰 Get testnet APT from the faucet:');
        console.log(`   https://aptos.dev/en/network/faucet`);
        console.log(`\n   Or use this direct link:`);
        console.log(`   https://faucet.testnet.aptoslabs.com/?address=${account.accountAddress.toString()}`);
        console.log('\n   You need at least 0.01 APT (~100 transactions worth)');
      } else {
        console.log('✅ Sufficient APT for gas fees');
      }
    } else {
      console.log('❌ No APT CoinStore found - account may not be initialized');
      console.log('\n🚰 Initialize account by getting testnet APT:');
      console.log(`   https://faucet.testnet.aptoslabs.com/?address=${account.accountAddress.toString()}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main().catch(console.error);
