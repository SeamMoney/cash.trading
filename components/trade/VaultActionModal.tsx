"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, ExternalLink, Loader2, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MobileModalSheet } from "@/components/ui/mobile-modal-sheet";
import { useIsMobile } from "@/components/ui/use-mobile";
import { TokenLogo } from "@/components/trade/StablecoinLogo";
import { cn } from "@/lib/utils";

import type {
  SignAndSubmitTransaction,
  VaultActionMode,
  VaultActionResult,
  VaultIndicatorInfo,
} from "./VaultActionTypes";

type VaultActionModalProps = {
  open: boolean;
  mode: VaultActionMode;
  indicator: VaultIndicatorInfo;
  signAndSubmitTransaction: SignAndSubmitTransaction;
  onOpenChange: (open: boolean) => void;
  onComplete?: (result: VaultActionResult) => void;
  onError?: (error: Error) => void;
  vaultAddress?: string | null;
  subaccount?: string | null;
  ownerWallet?: string | null;
  marketName?: string | null;
  strategyVaultId?: string | null;
  allocationPct?: number;
  defaultAmount?: string;
  maxAmount?: number | null;
  className?: string;
};

type ActionState = "idle" | "building" | "signing" | "extracting" | "submitted" | "error";

const AVAILABLE_BALANCE_CACHE_MS = 15_000;
const availableBalanceCache = new Map<string, { fetchedAt: number; value: number }>();

const ACTION_COPY: Record<
  VaultActionMode,
  { title: string; description: string; submit: string; endpoint: string }
> = {
  create: {
    title: "Create vault",
    description: "Deploy a Decibel vault for this indicator.",
    submit: "Create vault",
    endpoint: "/api/decibel/vaults/create",
  },
  deposit: {
    title: "Deposit",
    description: "Add capital to the selected Decibel vault.",
    submit: "Deposit",
    endpoint: "/api/decibel/vaults/deposit",
  },
  withdraw: {
    title: "Manage vault",
    description: "Redeem Decibel vault shares back into your trading subaccount.",
    submit: "Withdraw",
    endpoint: "/api/decibel/vaults/withdraw",
  },
  delegate: {
    title: "Delegate",
    description: "Delegate vault trading to the bot operator.",
    submit: "Delegate",
    endpoint: "/api/decibel/vaults/delegate",
  },
  status: {
    title: "Vault status",
    description: "Fetch the latest vault status from Decibel.",
    submit: "Refresh status",
    endpoint: "/api/decibel/vaults/status",
  },
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Vault action failed";
}

function getPayload(json: Record<string, unknown>) {
  return json.payload ?? json.transactionPayload ?? json.data ?? json;
}

function shortAddress(address?: string | null) {
  if (!address) return "Not set";
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatInputAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

export function VaultActionModal({
  open,
  mode,
  indicator,
  vaultAddress,
  subaccount,
  ownerWallet,
  marketName,
  strategyVaultId,
  allocationPct = 5,
  defaultAmount = "",
  maxAmount = null,
  signAndSubmitTransaction,
  onOpenChange,
  onComplete,
  onError,
  className,
}: VaultActionModalProps) {
  const [amount, setAmount] = useState(defaultAmount);
  const [state, setState] = useState<ActionState>("idle");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [extractedVaultAddress, setExtractedVaultAddress] = useState("");
  const [statusResponse, setStatusResponse] = useState<unknown>(null);
  const [availableAmount, setAvailableAmount] = useState<number | null>(maxAmount);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const isMobile = useIsMobile();

  const copy = ACTION_COPY[mode];
  const isContributionMode = mode === "deposit" || mode === "withdraw";
  const requiresAmount = mode === "deposit" || mode === "withdraw";
  const requiresVault = mode === "deposit" || mode === "withdraw" || mode === "delegate" || mode === "status";
  const requiresSubaccount = mode === "create" || mode === "deposit" || mode === "withdraw";
  const disabledReason = useMemo(() => {
    if (requiresVault && !vaultAddress) return "Vault address is required.";
    if (requiresSubaccount && !subaccount && !ownerWallet) {
      return "Connect a Decibel trading account.";
    }
    if (requiresAmount && !amount.trim()) return "Amount is required.";
    if (requiresAmount && (!Number.isFinite(Number(amount)) || Number(amount) <= 0)) {
      return "Enter a valid amount.";
    }
    if (requiresAmount && availableAmount != null && Number(amount) > availableAmount) {
      return `Amount exceeds available ${mode === "withdraw" ? "shares" : "USDC"}.`;
    }
    return "";
  }, [
    amount,
    availableAmount,
    mode,
    ownerWallet,
    requiresAmount,
    requiresSubaccount,
    requiresVault,
    subaccount,
    vaultAddress,
  ]);

  const isWorking = state === "building" || state === "signing" || state === "extracting";
  const canSubmit = !isWorking && !disabledReason;

  useEffect(() => {
    if (!open) return;
    setAmount(defaultAmount);
  }, [defaultAmount, open, mode, vaultAddress]);

  useEffect(() => {
    if (!open || !requiresAmount) return;
    if (mode === "withdraw") {
      setBalanceLoading(false);
      setAvailableAmount(maxAmount);
      return;
    }
    if (!subaccount) {
      setBalanceLoading(false);
      setAvailableAmount(null);
      return;
    }

    const network = indicator.network ?? "mainnet";
    const cacheKey = `${network}:${subaccount.toLowerCase()}`;
    const cached = availableBalanceCache.get(cacheKey);
    const cachedIsFresh = Boolean(
      cached && Date.now() - cached.fetchedAt < AVAILABLE_BALANCE_CACHE_MS,
    );
    const providedAmount =
      maxAmount != null && Number.isFinite(maxAmount) ? Math.max(0, maxAmount) : null;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    let cancelled = false;
    setAvailableAmount(cachedIsFresh ? cached!.value : providedAmount);
    setBalanceLoading(true);
    fetch(
      `/api/decibel/positions?address=${encodeURIComponent(subaccount)}&chainOnly=true&overviewOnly=true&network=${network}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const data = await response.json().catch(() => null) as {
          overview?: { crossWithdrawable?: number };
        } | null;
        const value = Number(data?.overview?.crossWithdrawable);
        if (!cancelled && response.ok) {
          const nextValue = Number.isFinite(value) ? Math.max(0, value) : null;
          setAvailableAmount(nextValue);
          if (nextValue != null) {
            availableBalanceCache.set(cacheKey, {
              fetchedAt: Date.now(),
              value: nextValue,
            });
          }
        }
      })
      .catch(() => {
        if (!cancelled && !cachedIsFresh && providedAmount == null) {
          setAvailableAmount(null);
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!cancelled) setBalanceLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [indicator.network, maxAmount, mode, open, requiresAmount, subaccount]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setTxHash("");
    setExtractedVaultAddress("");
    setStatusResponse(null);
    setState("building");

    try {
      const body =
        mode === "create"
          ? {
              owner: ownerWallet,
              subaccount,
              vaultName: `${indicator.name} Vault`,
              vaultShareSymbol: (indicator.symbol || indicator.name)
                .replace(/[^a-z0-9]/gi, "")
                .slice(0, 10)
                .toUpperCase(),
              vaultDescription: indicator.description || "",
              acceptsContributions: true,
              feeBps: 0,
              feeIntervalS: 0,
              contributionLockupDurationS: 0,
              initialFunding: "0",
              network: indicator.network,
            }
          : {
              owner: ownerWallet,
              vaultAddress,
              subaccount,
              amount: mode === "deposit" ? amount.trim() : undefined,
              shares: mode === "withdraw" ? amount.trim() : undefined,
              network: indicator.network,
            };

      const response = await fetch(copy.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok || json.error) {
        throw new Error(String(json.error || `Vault API returned ${response.status}`));
      }

      if (mode === "status") {
        setStatusResponse(json);
        setState("submitted");
        onComplete?.({ mode, response: json });
        return;
      }

      const payload = getPayload(json);
      if (!payload) throw new Error("Vault API did not return a transaction payload.");

      setState("signing");
      const result = await signAndSubmitTransaction(payload);
      const hash = typeof result.hash === "string" ? result.hash : "";

      let extractResponse: Record<string, unknown> | undefined;
      let nextVaultAddress: string | undefined;
      if (mode === "create" && hash) {
        setState("extracting");
        const extractRes = await fetch("/api/decibel/vaults/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txHash: hash,
            strategyVaultId: strategyVaultId || undefined,
            indicatorAddr: indicator.id ? String(indicator.id) : undefined,
            ownerWallet: ownerWallet || undefined,
            marketName: marketName || indicator.assets?.[0],
            allocationPct,
            network: indicator.network,
          }),
        });
        extractResponse = (await extractRes.json().catch(() => ({}))) as Record<string, unknown>;
        if (!extractRes.ok || extractResponse.error) {
          throw new Error(String(extractResponse.error || `Vault extraction returned ${extractRes.status}`));
        }
        nextVaultAddress =
          typeof extractResponse.vaultAddress === "string" ? extractResponse.vaultAddress : undefined;
        if (nextVaultAddress) setExtractedVaultAddress(nextVaultAddress);
      }

      setTxHash(hash);
      setState("submitted");
      onComplete?.({
        mode,
        hash,
        vaultAddress: nextVaultAddress,
        payload,
        response: json,
        extractResponse,
      });
    } catch (err) {
      const message = getErrorMessage(err);
      const nextError = new Error(message);
      setError(message);
      setState("error");
      onError?.(nextError);
    }
  }

  const vaultExplorerHref = vaultAddress
    ? `https://explorer.aptoslabs.com/account/${vaultAddress}?network=${indicator.network === "testnet" ? "testnet" : "mainnet"}`
    : null;

  const formFields = (
    <>
            {isContributionMode ? (
              vaultExplorerHref ? (
                <a
                  href={vaultExplorerHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={vaultAddress ?? undefined}
                  className="flex min-w-0 items-center justify-between gap-3 border-b border-white/[0.06] pb-3 font-mono text-xs tabular-nums text-zinc-400 transition-colors hover:text-white"
                >
                  <span className="truncate">Vault {shortAddress(vaultAddress)}</span>
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                </a>
              ) : null
            ) : (
              <>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-primary" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{indicator.name}</div>
                  {indicator.symbol ? (
                    <div className="text-xs tabular-nums text-zinc-500">{indicator.symbol}</div>
                  ) : null}
                </div>
              </div>
              {indicator.description ? (
                <p className="mt-3 line-clamp-2 text-pretty text-xs text-zinc-400">{indicator.description}</p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="min-w-0 rounded-md border border-zinc-800 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-zinc-500">Vault</div>
                  {indicator.network === "testnet" ? (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-400">
                      Testnet
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 truncate font-mono tabular-nums text-zinc-200">{shortAddress(vaultAddress)}</div>
              </div>
              <div className="min-w-0 rounded-md border border-zinc-800 p-3">
                <div className="text-zinc-500">Subaccount</div>
                <div className="mt-1 truncate font-mono tabular-nums text-zinc-200">{shortAddress(subaccount)}</div>
              </div>
            </div>
              </>
            )}

            {requiresAmount ? (
              <div className="overflow-hidden rounded-[14px] border border-white/[0.06] bg-[#0e0e0e]">
                <div className="flex items-center justify-between px-4 pt-3 font-mono text-[10px] tabular-nums text-zinc-500">
                  <label htmlFor="vault-action-amount">
                    {mode === "withdraw" ? "Vault shares" : "USDC amount"}
                  </label>
                  <span className="flex items-center gap-2">
                    Available {availableAmount == null
                        ? "—"
                        : availableAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    <button
                      type="button"
                      onClick={() => setAmount(formatInputAmount(availableAmount ?? 0))}
                      disabled={availableAmount == null || availableAmount <= 0}
                      className="rounded px-2 py-1 text-[10px] font-semibold text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:text-zinc-700"
                    >
                      MAX
                    </button>
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-[14px] bg-[#141414] px-4 py-3">
                  <input
                    id="vault-action-amount"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    enterKeyHint="done"
                    data-mobile-sheet-no-drag="true"
                    value={amount}
                    onChange={(event) => {
                      const value = event.target.value.replace(/[^0-9.]/g, "");
                      if (value.split(".").length <= 2) setAmount(value);
                    }}
                    placeholder="0.00"
                    className="min-w-0 flex-1 bg-transparent font-mono text-[28px] font-bold tabular-nums text-white outline-none placeholder:text-zinc-600"
                    style={{ WebkitUserSelect: "text", userSelect: "text" }}
                    aria-invalid={Boolean(error && requiresAmount)}
                    aria-busy={balanceLoading}
                  />
                  <div className="ml-4 flex shrink-0 items-center gap-2 rounded-md bg-white/[0.05] px-3 py-2">
                    {mode === "deposit" ? <TokenLogo token="USDC" size={22} /> : null}
                    <span className="text-sm font-semibold text-white">
                      {mode === "withdraw" ? "Shares" : "USDC"}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}

            {disabledReason ? <p className="text-pretty text-xs text-amber-400">{disabledReason}</p> : null}
            {error ? <p className="text-pretty text-xs text-red-400">{error}</p> : null}
            {txHash ? (
              <p className="truncate font-mono text-xs tabular-nums text-green-400">Submitted {shortAddress(txHash)}</p>
            ) : null}
            {extractedVaultAddress ? (
              <p className="truncate font-mono text-xs tabular-nums text-green-400">
                Vault {shortAddress(extractedVaultAddress)}
              </p>
            ) : null}
            {statusResponse ? (
              <pre className="max-h-32 overflow-auto rounded-md border border-zinc-800 bg-black p-3 text-xs text-zinc-300">
                {JSON.stringify(statusResponse, null, 2)}
              </pre>
            ) : null}
    </>
  );

  const formActions = isContributionMode ? (
    <button
      type="submit"
      disabled={!canSubmit}
      className="flex w-full items-center justify-center gap-2 rounded-[8px] bg-accent px-3 py-2 text-[12px] font-bold text-black transition-[transform,filter] duration-150 hover:brightness-95 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:brightness-100 disabled:active:scale-100"
    >
      {state === "building" || state === "signing" || state === "extracting" ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : state === "submitted" ? (
        <CheckCircle2 className="size-4" aria-hidden="true" />
      ) : null}
      {state === "building"
        ? "Building"
        : state === "signing"
          ? "Sign in wallet"
          : state === "extracting"
            ? "Saving vault"
            : copy.submit}
    </button>
  ) : (
    <>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isWorking}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} className="min-w-36">
              {state === "building" || state === "signing" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : state === "submitted" ? (
                <CheckCircle2 className="size-4" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              {state === "building"
                ? "Building"
                : state === "signing"
                  ? "Sign in wallet"
                  : state === "extracting"
                    ? "Saving vault"
                    : copy.submit}
            </Button>
    </>
  );

  if (isMobile) {
    return (
      <MobileModalSheet
        open={open}
        onClose={() => onOpenChange(false)}
        initialSnap={isContributionMode ? "compact" : "mid"}
        title={copy.title}
        description={isContributionMode ? undefined : copy.description}
        titleId="vault-action-title"
      >
        <form onSubmit={submit} className="pt-3">
          <div className="space-y-4 px-2 pb-4">{formFields}</div>
          <div className="sticky bottom-0 flex items-center gap-3 border-t border-zinc-800 bg-[#101010] px-2 py-4">
            {formActions}
          </div>
        </form>
      </MobileModalSheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-md gap-0 border-zinc-800 bg-zinc-950 p-0 text-zinc-100", className)}>
        <DialogHeader className="border-b border-zinc-800 px-5 py-4 text-left">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className="text-balance text-base">{copy.title}</DialogTitle>
              {isContributionMode ? (
                <DialogDescription className="sr-only">
                  {mode === "deposit" ? "Deposit USDC into" : "Withdraw shares from"} {indicator.name}.
                </DialogDescription>
              ) : (
                <DialogDescription className="mt-1 text-pretty text-xs text-zinc-400">
                  {copy.description}
                </DialogDescription>
              )}
            </div>
            {!isContributionMode ? (
              <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                {mode}
              </Badge>
            ) : null}
          </div>
        </DialogHeader>

        <form onSubmit={submit}>
          <div className="space-y-4 px-5 py-4">{formFields}</div>
          <DialogFooter className="border-t border-zinc-800 px-5 py-4 sm:justify-between">
            {formActions}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type { VaultActionModalProps };
