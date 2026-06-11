import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

// Honor the Decibel network vars too — env files have drifted between
// NEXT_PUBLIC_APTOS_NETWORK and (NEXT_PUBLIC_)DECIBEL_NETWORK, and a split
// (Decibel layer on mainnet, this client on testnet) makes every submission
// die with BAD_CHAIN_ID.
const network =
  process.env.NEXT_PUBLIC_APTOS_NETWORK === "mainnet" ||
  process.env.NEXT_PUBLIC_DECIBEL_NETWORK === "mainnet" ||
  process.env.DECIBEL_NETWORK === "mainnet"
    ? Network.MAINNET
    : Network.TESTNET;

export const aptosConfig = new AptosConfig({ network });
export const aptos = new Aptos(aptosConfig);
export { Network };
