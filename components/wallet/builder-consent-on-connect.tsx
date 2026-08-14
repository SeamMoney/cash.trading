"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useDecibelSubaccounts } from "@/hooks/useDecibelSubaccounts";
import { useDecibelTransactionSubmitter } from "@/hooks/useDecibelTransactionSubmitter";
import { ensureBuilderApproval } from "@/lib/decibel-builder-approval";

/**
 * Fee-routing consent at CONNECT time, for accounts that already exist.
 *
 * New accounts get the consent chained onto their setup signatures. Accounts
 * created before that shipped would otherwise hit it on their first trade —
 * this asks once when the wallet connects instead, so the trade screen is a
 * single prompt for everyone.
 *
 * Decline etiquette: if the user rejects the prompt, they are not asked again
 * for a week (per account, in localStorage). The trade-flow fallback still
 * quietly attaches nothing in the meantime.
 */
const DECLINE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const declineKeyFor = (key: string) => `cash_builder_consent_declined:${key}`;

export function BuilderConsentOnConnect() {
  const { connected } = useWallet();
  const {
    decibelNetwork,
    hasDecibelAccount,
    isLoadingSubaccounts,
    lookupIncomplete,
    selectedSubaccount,
  } = useDecibelSubaccounts();
  const { signAndSubmitDecibelTransaction } = useDecibelTransactionSubmitter();
  const askedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!connected || !hasDecibelAccount || !selectedSubaccount) return;
    if (isLoadingSubaccounts || lookupIncomplete) return;
    const key = `${decibelNetwork}:${selectedSubaccount}`.toLowerCase();
    if (askedRef.current.has(key)) return;
    try {
      const declinedAt = Number(window.localStorage.getItem(declineKeyFor(key)));
      if (declinedAt && Date.now() - declinedAt < DECLINE_COOLDOWN_MS) return;
    } catch {
      // Storage unavailable — fall through and ask.
    }
    askedRef.current.add(key);

    // Grace delay so the prompt lands after the connect flow's own UI settles
    // rather than stacking on top of the wallet-selector modal.
    const timer = window.setTimeout(() => {
      void ensureBuilderApproval({
        subaccount: selectedSubaccount,
        network: decibelNetwork,
        signAndSubmit: signAndSubmitDecibelTransaction as never,
      }).then((outcome) => {
        if (outcome === "declined") {
          try {
            window.localStorage.setItem(declineKeyFor(key), String(Date.now()));
          } catch {
            // Best effort — worst case they are asked again next session.
          }
        }
      });
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [
    connected,
    decibelNetwork,
    hasDecibelAccount,
    isLoadingSubaccounts,
    lookupIncomplete,
    selectedSubaccount,
    signAndSubmitDecibelTransaction,
  ]);

  return null;
}
