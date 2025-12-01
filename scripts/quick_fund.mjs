import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';

const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));

try {
  const result = await aptos.faucet.fundAccount({
    accountAddress: "0x44bccd01a872341d7c74baf3497501ceb0b768a83a5ed9675799bfbac86e0ed3",
    amount: 100_000_000,
  });
  console.log("✅ Funded! Hash:", result);
} catch (error) {
  console.error("❌ Error:", error.message);
}
