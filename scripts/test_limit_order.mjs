#!/usr/bin/env node

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1";
const DECIBEL_PACKAGE = "0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844";

const MARKETS = {
  'BTC/USD': '0xdb8c5e968efa1b4dcbb4aaa7e4389358768d9b26bd126d5fe1a33e0aa076c380',
};

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

  console.log('🧪 Testing Regular Limit Order\n');
  console.log(`Wallet: ${account.accountAddress.toString()}\n`);

  // Get subaccount
  const subaccountResult = await aptos.view({
    payload: {
      function: `${DECIBEL_PACKAGE}::dex_accounts_entry::primary_subaccount`,
      typeArguments: [],
      functionArguments: [account.accountAddress.toString()],
    },
  });

  const subaccountAddr = subaccountResult[0];
  console.log(`Subaccount: ${subaccountAddr}\n`);

  // Build limit order transaction
  // Function signature:
  // place_order_to_subaccount(
  //   &signer,
  //   subaccount: Object<Subaccount>,
  //   market: Object<PerpMarket>,
  //   px: u64,
  //   sz: u64,
  //   is_long: bool,
  //   order_type: u8,
  //   post_only: bool,
  //   client_order_id: Option<String>,
  //   conditional_order: Option<u64>,
  //   trigger_price: Option<u64>,
  //   take_profit_px: Option<u64>,
  //   stop_loss_px: Option<u64>,
  //   reduce_only: Option<u64>,
  //   builder_address: Option<address>,
  //   max_builder_fee: Option<u64>
  // )

  console.log('Building limit order transaction...');
  console.log('- Market: BTC/USD');
  console.log('- Price: $99,000');
  console.log('- Size: 0.001 BTC');
  console.log('- Side: LONG\n');

  const transaction = await aptos.transaction.build.simple({
    sender: account.accountAddress,
    data: {
      function: `${DECIBEL_PACKAGE}::dex_accounts_entry::place_order_to_subaccount`,
      typeArguments: [],
      functionArguments: [
        subaccountAddr,                  // subaccount - SDK handles Object wrapper
        MARKETS['BTC/USD'],              // market - SDK handles Object wrapper
        99_000_000_000,                  // px (99k with 6 decimals)
        100_000,                         // sz (0.001 BTC with 8 decimals = 100,000)
        true,                            // is_long
        0,                               // order_type (0 = limit)
        true,                            // post_only
        undefined,                       // client_order_id
        undefined,                       // conditional_order
        undefined,                       // trigger_price
        undefined,                       // take_profit_px
        undefined,                       // stop_loss_px
        undefined,                       // reduce_only
        undefined,                       // builder_address
        undefined,                       // max_builder_fee
      ],
    },
  });

  console.log('Submitting...\n');

  const committedTxn = await aptos.signAndSubmitTransaction({
    signer: account,
    transaction,
  });

  console.log(`✅ Transaction submitted: ${committedTxn.hash}`);

  const executedTxn = await aptos.waitForTransaction({
    transactionHash: committedTxn.hash,
  });

  console.log(`✅ Transaction confirmed: ${executedTxn.success}`);
  console.log(`\nView: https://explorer.aptoslabs.com/txn/${committedTxn.hash}?network=testnet`);
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
