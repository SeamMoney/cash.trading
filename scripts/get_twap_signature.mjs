#!/usr/bin/env node

import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';

const DECIBEL_PACKAGE = "0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75";

async function main() {
  const config = new AptosConfig({ network: Network.TESTNET });
  const aptos = new Aptos(config);

  const module = await aptos.getAccountModule({
    accountAddress: DECIBEL_PACKAGE,
    moduleName: 'dex_accounts',
  });

  const twapFunc = module.abi.exposed_functions.find((f) =>
    f.name === 'place_twap_order_to_subaccount'
  );

  console.log('📌 place_twap_order_to_subaccount');
  console.log(JSON.stringify(twapFunc, null, 2));
}

main().catch(console.error);
