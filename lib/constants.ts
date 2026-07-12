export const MERCHANT_ADDRESS =
  process.env.NEXT_PUBLIC_MERCHANT_ADDRESS ?? "0x1";

export type AptosNetworkName = "mainnet" | "testnet";

const configuredNetwork =
  process.env.NEXT_PUBLIC_DECIBEL_NETWORK ??
  process.env.NEXT_PUBLIC_APTOS_NETWORK ??
  process.env.DECIBEL_NETWORK;

export const APTOS_NETWORK: AptosNetworkName =
  configuredNetwork === "mainnet" ? "mainnet" : "testnet";

export const X402_CONTRACT =
  process.env.X402_CONTRACT_ADDRESS ??
  "0x966eb1d2d3ed1e199f7d92335b5bb40f7a79dbbfb142ed951035bf78ba1b9744";

export const FACILITATOR_URL =
  process.env.FACILITATOR_URL ?? "http://localhost:3000";

export const EXPLORER_URL = "https://explorer.aptoslabs.com";

export function explorerTxUrl(
  txHash: string,
  network: AptosNetworkName = APTOS_NETWORK,
): string {
  const net = network === "mainnet" ? "" : "?network=testnet";
  return `${EXPLORER_URL}/txn/${txHash}${net}`;
}

export function explorerAccountUrl(
  address: string,
  network: AptosNetworkName = APTOS_NETWORK,
): string {
  const net = network === "mainnet" ? "" : "?network=testnet";
  return `${EXPLORER_URL}/account/${address}${net}`;
}

// ─── Echelon Protocol ──────────────────────────────────────────
export const ECHELON_CONTRACT =
  process.env.ECHELON_CONTRACT ??
  "0xc6bc659f1649553c1a3fa05d9727433dc03843baac29473c817d06d39e7621ba";

export const ECHELON_EMODE_ID = 2; // Stablecoin E-Mode group
export const ECHELON_EMODE_LTV = 0.93; // 93% LTV in E-Mode
export const ECHELON_EMODE_LIQUIDATION_THRESHOLD = 1.05; // 105% (from on-chain)
export const ECHELON_DEFAULT_LOOPS = 5;
export const ECHELON_SAFETY_MARGIN = 0.95; // Use 95% of max borrowable per iteration

// Known Echelon mainnet market addresses (E-Mode 2 stablecoins)
export const ECHELON_MARKETS = {
  USDT: "0xac00e90cdadec06d81e0d5ce7a3e93d63d563e982dea0ca15bad2b067f42d2be",
  USDC: "0x2c4e0bb55272f9c120ffd5a414c10244005caf9c1b14527cea3df7074c5bf623",
  sUSDe: "0x778362f04f7904ba0b76913ec7c0c5cc04e469b0b96929c6998b34910690a740",
  USD1: "0xbb8f38636896c629ff9ef0bf916791a992e12ab4f1c6e26279ee9c6979646963",
  APT: "0x761a97787fa8b3ae0cef91ebc2d96e56cc539df5bc88dadabee98ae00363a831",
} as const;

// Demo deposit amounts in APT (octas = APT * 1e8)
export const DEPOSIT_PRESETS = [
  { label: "0.01 APT", octas: "1000000" },
  { label: "0.05 APT", octas: "5000000" },
  { label: "0.1 APT", octas: "10000000" },
];
