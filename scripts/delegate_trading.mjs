#!/usr/bin/env node

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

const DECIBEL_PACKAGE = "0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75";
// Decibel's operator address (from your transaction)
const DECIBEL_OPERATOR = "0x596dfe6cd170290d228360c948c1db5fe3ba2142a7dc57494c87598038d3006f";

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

  console.log('🔐 Delegating Trading Permissions to Decibel\n');
  console.log(`Wallet: ${account.accountAddress.toString()}\n`);

  // Get subaccount
  const subaccountResult = await aptos.view({
    payload: {
      function: `${DECIBEL_PACKAGE}::dex_accounts::primary_subaccount`,
      typeArguments: [],
      functionArguments: [account.accountAddress.toString()],
    },
  });

  const subaccountAddr = subaccountResult[0];
  console.log(`Subaccount: ${subaccountAddr}\n`);

  // Delegate trading permissions
  console.log('Delegating permissions...');
  console.log(`Operator: ${DECIBEL_OPERATOR}\n`);

  const transaction = await aptos.transaction.build.simple({
    sender: account.accountAddress,
    data: {
      function: `${DECIBEL_PACKAGE}::dex_accounts::delegate_trading_to_for_subaccount`,
      typeArguments: [],
      functionArguments: [
        subaccountAddr,
        DECIBEL_OPERATOR,
        undefined, // expiration (none = unlimited)
      ],
    },
  });

  const committedTxn = await aptos.signAndSubmitTransaction({
    signer: account,
    transaction,
  });

  console.log(`✅ Transaction submitted: ${committedTxn.hash}`);

  const executedTxn = await aptos.waitForTransaction({
    transactionHash: committedTxn.hash,
  });

  console.log(`✅ Delegation confirmed: ${executedTxn.success}`);
  console.log(`\n🎉 You can now place orders via the SDK!`);
  console.log(`\nNext: Run test_limit_order.mjs or test_twap_order.mjs`);
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
