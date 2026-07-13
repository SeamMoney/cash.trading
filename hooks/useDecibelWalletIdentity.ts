"use client";

import { useMemo } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { resolveDecibelWalletIdentity } from "@/lib/decibel-wallet-identity";
import { getChainFromWallet } from "@/lib/wallet-utils";

export function useDecibelWalletIdentity() {
  const { account, wallet } = useWallet();
  const adapterAddress = account?.address?.toString() ?? "";
  const publicKey = account?.publicKey;
  const chainOrigin = wallet ? getChainFromWallet(wallet) : null;

  return useMemo(
    () =>
      resolveDecibelWalletIdentity({
        adapterAddress,
        chainOrigin,
        publicKey,
      }),
    [adapterAddress, chainOrigin, publicKey],
  );
}
