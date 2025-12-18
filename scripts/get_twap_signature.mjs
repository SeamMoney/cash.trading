#!/usr/bin/env node

import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';

const DECIBEL_PACKAGE = "0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844";

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
