"use client";

import { useEffect, useState } from "react";

import {
  getEvmProvider,
  getEvmSourceChainFromChainId,
  storeEvmSourceChain,
  type Eip1193Provider,
  type EvmCctpSourceChain,
} from "@/lib/evm-cctp";

export function useEvmSourceChain({
  enabled,
  preferredWalletName,
}: {
  enabled: boolean;
  preferredWalletName?: string;
}) {
  const [sourceChain, setSourceChain] = useState<EvmCctpSourceChain | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSourceChain(null);
      return;
    }

    let active = true;
    let provider: Eip1193Provider | null = null;

    const applyChainId = (chainId: unknown) => {
      const detected = getEvmSourceChainFromChainId(chainId);
      if (!active || !detected) return;
      setSourceChain(detected);
      storeEvmSourceChain(detected);
    };

    const refresh = async () => {
      const nextProvider = provider ?? await getEvmProvider(preferredWalletName);
      if (!active || !nextProvider) return;
      provider = nextProvider;
      applyChainId(await nextProvider.request({ method: "eth_chainId" }));
    };

    const handleChainChanged = (chainId: unknown) => applyChainId(chainId);
    const handleFocus = () => { void refresh(); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    void refresh().then(() => {
      if (active) provider?.on?.("chainChanged", handleChainChanged);
    }).catch(() => {
      // A missing or locked EVM provider leaves the label as EVM instead of lying about Ethereum.
    });
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      provider?.removeListener?.("chainChanged", handleChainChanged);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, preferredWalletName]);

  return sourceChain;
}
