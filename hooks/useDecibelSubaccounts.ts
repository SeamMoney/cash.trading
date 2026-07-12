"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import {
  getStoredDecibelSubaccount,
  onDecibelSubaccountChange,
  pickDecibelSubaccount,
  storeDecibelSubaccount,
} from "@/lib/decibel-selection";
import {
  getDecibelPublicNetwork,
  onDecibelPublicNetworkChange,
  type DecibelPublicNetwork,
} from "@/lib/decibel-public";

export interface DecibelSubaccount {
  address: string;
  name: string | null;
  isPrimary: boolean;
  isActive?: boolean;
  hasAssetsOrPositions?: boolean;
}

interface DecibelSubaccountResponse {
  subaccounts?: DecibelSubaccount[];
  lookupError?: string | null;
  lookupIncomplete?: boolean;
  source?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shortAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-5)}`;
}

export function useDecibelSubaccounts() {
  const { account, connected } = useWallet();
  const owner = account?.address?.toString() ?? "";
  const [subaccounts, setSubaccounts] = useState<DecibelSubaccount[]>([]);
  const [selectedSubaccount, setSelectedSubaccount] = useState("");
  const [isLoadingSubaccounts, setIsLoadingSubaccounts] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupIncomplete, setLookupIncomplete] = useState(false);
  const [lookupSource, setLookupSource] = useState("");
  const [decibelNetwork, setDecibelNetwork] = useState<DecibelPublicNetwork>(() => getDecibelPublicNetwork());

  const selectSubaccount = useCallback(
    (next: string | null) => {
      setSelectedSubaccount(next ?? "");
      storeDecibelSubaccount(next, owner, decibelNetwork);
    },
    [decibelNetwork, owner]
  );

  const refreshSubaccounts = useCallback(async () => {
    if (!connected || !owner) {
      setSubaccounts([]);
      setSelectedSubaccount("");
      setIsLoadingSubaccounts(false);
      setLookupError(null);
      setLookupIncomplete(false);
      setLookupSource("");
      return [];
    }

    setIsLoadingSubaccounts(true);
    setLookupError(null);
    setLookupIncomplete(false);

    try {
      const res = await fetch(`/api/decibel/subaccount?address=${owner}&network=${decibelNetwork}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as DecibelSubaccountResponse;
      if (!res.ok) {
        throw new Error(data.lookupError || `Decibel account lookup failed (${res.status})`);
      }

      const next = (data.subaccounts ?? []) as DecibelSubaccount[];
      const stored = getStoredDecibelSubaccount(owner, decibelNetwork);
      setSubaccounts(next);
      setLookupError(data.lookupError ?? null);
      setLookupIncomplete(Boolean(data.lookupIncomplete));
      setLookupSource(data.source ?? "");
      setSelectedSubaccount((current) => {
        if (next.length === 0) {
          if (!data.lookupIncomplete) {
            storeDecibelSubaccount(null, owner, decibelNetwork);
            return "";
          }
          return stored ?? "";
        }
        const picked = pickDecibelSubaccount(next, owner, current, decibelNetwork);
        storeDecibelSubaccount(picked, owner, decibelNetwork);
        return picked ?? "";
      });
      return next;
    } catch (error) {
      const stored = getStoredDecibelSubaccount(owner, decibelNetwork);
      setSubaccounts([]);
      setSelectedSubaccount(stored ?? "");
      setLookupError(error instanceof Error ? error.message : "Decibel account lookup failed.");
      setLookupIncomplete(true);
      setLookupSource("");
      return [];
    } finally {
      setIsLoadingSubaccounts(false);
    }
  }, [connected, decibelNetwork, owner]);

  const waitForSubaccounts = useCallback(async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const next = await refreshSubaccounts();
      if (next.length > 0) return next;
      await sleep(1250);
    }
    return [];
  }, [refreshSubaccounts]);

  useEffect(() => {
    refreshSubaccounts().catch(() => {
      const stored = getStoredDecibelSubaccount(owner, decibelNetwork);
      setSubaccounts([]);
      setSelectedSubaccount(stored ?? "");
    });
  }, [decibelNetwork, owner, refreshSubaccounts]);

  useEffect(() => {
    if (!connected || !owner) return;
    const stored = getStoredDecibelSubaccount(owner, decibelNetwork);
    setSelectedSubaccount(stored ?? "");
  }, [connected, decibelNetwork, owner]);

  useEffect(() => onDecibelPublicNetworkChange(setDecibelNetwork), []);

  useEffect(() => {
    return onDecibelSubaccountChange(() => {
      const stored = getStoredDecibelSubaccount(owner, decibelNetwork);
      setSelectedSubaccount(stored ?? "");
    });
  }, [decibelNetwork, owner]);

  const selectedSubaccountRecord = useMemo(
    () =>
      selectedSubaccount
        ? subaccounts.find((s) => s.address === selectedSubaccount)
        : undefined,
    [selectedSubaccount, subaccounts]
  );
  const hasDecibelAccount = Boolean(
    selectedSubaccountRecord && selectedSubaccountRecord.isActive !== false
  );

  return {
    hasDecibelAccount,
    isLoadingSubaccounts,
    lookupError,
    lookupIncomplete,
    lookupSource,
    decibelNetwork,
    owner,
    refreshSubaccounts,
    selectSubaccount,
    selectedSubaccount,
    selectedSubaccountRecord,
    subaccounts,
    waitForSubaccounts,
  };
}
