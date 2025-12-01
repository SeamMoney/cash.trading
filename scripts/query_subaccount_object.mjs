#!/usr/bin/env node

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

const DECIBEL_PACKAGE = "0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75";

async function main() {
  let privateKeyHex = process.env.APTOS_PRIVATE_KEY;

  // Strip ed25519-priv- prefix if present
  if (privateKeyHex.startsWith('ed25519-priv-')) {
    privateKeyHex = privateKeyHex.replace('ed25519-priv-', '');
  }

  const config = new AptosConfig({ network: Network.TESTNET });
  const aptos = new Aptos(config);

  const privateKey = new Ed25519PrivateKey(privateKeyHex);
  const account = Account.fromPrivateKey({ privateKey });

  console.log('Querying subaccount object...\n');

  // Try using primary_subaccount_object instead
  const result = await aptos.view({
    payload: {
      function: `${DECIBEL_PACKAGE}::dex_accounts::primary_subaccount_object`,
      typeArguments: [],
      functionArguments: [account.accountAddress.toString()],
    },
  });

  console.log('Result:', JSON.stringify(result, null, 2));
}

main().catch(console.error);
