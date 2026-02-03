#!/usr/bin/env node

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

const DECIBEL_PACKAGE = "0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844";

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
      function: `${DECIBEL_PACKAGE}::dex_accounts_entry::primary_subaccount_object`,
      typeArguments: [],
      functionArguments: [account.accountAddress.toString()],
    },
  });

  console.log('Result:', JSON.stringify(result, null, 2));
}

main().catch(console.error);
