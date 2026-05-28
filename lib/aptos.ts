import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

const network =
  process.env.NEXT_PUBLIC_APTOS_NETWORK === "mainnet"
    ? Network.MAINNET
    : Network.TESTNET;

export const aptosConfig = new AptosConfig({ network });
export const aptos = new Aptos(aptosConfig);
export { Network };
