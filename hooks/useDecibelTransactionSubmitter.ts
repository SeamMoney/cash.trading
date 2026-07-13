"use client";

import { useCallback } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import type { InputGenerateTransactionPayloadData } from "@aptos-labs/ts-sdk";
import { useDecibelWalletIdentity } from "@/hooks/useDecibelWalletIdentity";
import {
  DECIBEL_APP_DERIVED_DOMAIN,
  DECIBEL_APP_DERIVED_URI,
  needsSponsoredGas,
  submitEvmDerivedAptosPayload,
} from "@/lib/evm-derived-aptos";

export type DecibelTransactionInput = {
  data: InputGenerateTransactionPayloadData;
};

/**
 * Submit a Decibel transaction from the identity that actually owns the
 * selected Decibel account. Native Aptos wallets keep using the wallet
 * adapter; EVM wallets sign the app.decibel.trade-derived Aptos sender and
 * use the gas sponsor when that derived account has no APT.
 */
export function useDecibelTransactionSubmitter() {
  const { account, connected, signAndSubmitTransaction, wallet } = useWallet();
  const identity = useDecibelWalletIdentity();

  const signAndSubmitDecibelTransaction = useCallback(
    async ({ data }: DecibelTransactionInput): Promise<{ hash: string }> => {
      if (!connected || !account) {
        throw new Error("Connect a wallet before signing the Decibel transaction.");
      }

      if (!identity.usesDecibelDomainIdentity) {
        if (!signAndSubmitTransaction) {
          throw new Error("Wallet transaction signing is not available.");
        }
        return signAndSubmitTransaction({ data });
      }

      const sponsored = await needsSponsoredGas(identity.ownerAddress);
      return submitEvmDerivedAptosPayload({
        domain: DECIBEL_APP_DERIVED_DOMAIN,
        expectedSenderAddress: identity.ownerAddress,
        payload: data,
        preferredWalletName: wallet?.name,
        sponsored,
        uri: DECIBEL_APP_DERIVED_URI,
      });
    },
    [
      account,
      connected,
      identity.ownerAddress,
      identity.usesDecibelDomainIdentity,
      signAndSubmitTransaction,
      wallet?.name,
    ],
  );

  return {
    ...identity,
    signAndSubmitDecibelTransaction,
  };
}
