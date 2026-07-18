import type {
  AdapterWallet,
  AdapterNotDetectedWallet,
} from "@aptos-labs/wallet-adapter-core";

export type ChainOrigin = "aptos" | "ethereum" | "solana";

type AnyWallet = AdapterWallet | AdapterNotDetectedWallet;

const ETH_KEYWORDS = [
  "ethereum",
  "metamask",
  "rainbow",
  "coinbase wallet",
  "rabby",
  "zerion",
  "trust",
  "okx",
];

const SOL_KEYWORDS = [
  "solana",
  "phantom",
  "solflare",
  "backpack",
];

/** Determine which chain a wallet originates from based on its name. */
export function getChainFromWallet(
  wallet: Pick<AnyWallet, "name">
): ChainOrigin {
  const name = wallet.name.toLowerCase();
  if (ETH_KEYWORDS.some((kw) => name.includes(kw))) return "ethereum";
  if (SOL_KEYWORDS.some((kw) => name.includes(kw))) return "solana";
  return "aptos";
}

export function baseWalletName(name: string) {
  return name.replace(/\s*\((?:Solana|Ethereum|EVM|Arbitrum|Base)\)\s*$/i, "").trim();
}

export function isRainbowWallet(name: string) {
  return /^rainbow(?:\s|$)/i.test(baseWalletName(name));
}

/** Keep Rainbow's supplied brand asset consistent across adapter implementations. */
export function getPreferredWalletIcon(name: string, adapterIcon?: string | null) {
  return isRainbowWallet(name) ? "/wallet-logos/rainbow-logo.png" : adapterIcon;
}

/** Format EVM-derived Aptos wallets using the provider's real active EIP-155 chain. */
export function formatWalletConnectionName(
  name: string,
  activeEvmChain?: "Ethereum" | "Arbitrum" | "Base" | null,
) {
  if (getChainFromWallet({ name }) !== "ethereum") return name;
  return `${baseWalletName(name)} (${activeEvmChain ?? "EVM"})`;
}

/** Split wallets into chain-specific groups for the tab UI. */
export function groupWalletsByChain(wallets: ReadonlyArray<AnyWallet>) {
  const aptos: AnyWallet[] = [];
  const ethereum: AnyWallet[] = [];
  const solana: AnyWallet[] = [];

  for (const w of wallets) {
    const chain = getChainFromWallet(w);
    if (chain === "ethereum") ethereum.push(w);
    else if (chain === "solana") solana.push(w);
    else aptos.push(w);
  }

  return { aptos, ethereum, solana };
}
