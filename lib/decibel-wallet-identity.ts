import { deriveEvmAptosAddress, DECIBEL_APP_DERIVED_DOMAIN } from "@/lib/evm-derived-aptos";
import type { ChainOrigin } from "@/lib/wallet-utils";

export interface DecibelWalletIdentity {
  adapterAddress: string;
  chainOrigin: ChainOrigin | null;
  originAddress: string;
  ownerAddress: string;
  usesDecibelDomainIdentity: boolean;
}

function getEvmAddress(publicKey: unknown) {
  if (!publicKey || typeof publicKey !== "object" || !("ethereumAddress" in publicKey)) {
    return "";
  }

  const ethereumAddress = (publicKey as { ethereumAddress?: unknown }).ethereumAddress;
  return typeof ethereumAddress === "string" && /^0x[0-9a-fA-F]{40}$/.test(ethereumAddress)
    ? ethereumAddress
    : "";
}

/**
 * EVM-derived Aptos accounts are scoped to the dapp domain. The wallet adapter
 * therefore exposes a different Aptos address on cash.trading than the same
 * Rainbow/MetaMask account exposes on app.decibel.trade. Decibel balances and
 * subaccounts belong to the Decibel-domain address, so resolve that identity
 * explicitly while leaving the connected adapter account untouched.
 */
export function resolveDecibelWalletIdentity(args: {
  adapterAddress?: string | null;
  chainOrigin?: ChainOrigin | null;
  publicKey?: unknown;
}): DecibelWalletIdentity {
  const adapterAddress = args.adapterAddress ?? "";
  const chainOrigin = args.chainOrigin ?? null;
  const originAddress = chainOrigin === "ethereum" ? getEvmAddress(args.publicKey) : "";

  if (!adapterAddress || chainOrigin !== "ethereum" || !originAddress) {
    return {
      adapterAddress,
      chainOrigin,
      originAddress,
      ownerAddress: adapterAddress,
      usesDecibelDomainIdentity: false,
    };
  }

  try {
    return {
      adapterAddress,
      chainOrigin,
      originAddress,
      ownerAddress: deriveEvmAptosAddress({
        domain: DECIBEL_APP_DERIVED_DOMAIN,
        evmAddress: originAddress,
      }),
      usesDecibelDomainIdentity: true,
    };
  } catch {
    return {
      adapterAddress,
      chainOrigin,
      originAddress,
      ownerAddress: adapterAddress,
      usesDecibelDomainIdentity: false,
    };
  }
}
