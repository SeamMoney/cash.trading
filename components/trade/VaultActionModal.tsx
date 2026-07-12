"use client";

import { FormEvent, useMemo, useState } from "react";
import { Activity, CheckCircle2, Loader2, Send, WalletCards } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  className?: string;
};

type ActionState = "idle" | "building" | "signing" | "extracting" | "submitted" | "error";

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

  const copy = ACTION_COPY[mode];
  const requiresAmount = mode === "deposit";
  const requiresVault = mode === "deposit" || mode === "delegate" || mode === "status";
  const requiresSubaccount = mode === "create" || mode === "deposit";
  const disabledReason = useMemo(() => {
    if (requiresVault && !vaultAddress) return "Vault address is required.";
    if (requiresSubaccount && !subaccount) return "Subaccount is required.";
    if (requiresAmount && !amount.trim()) return "Amount is required.";
    return "";
  }, [amount, requiresAmount, requiresSubaccount, requiresVault, subaccount, vaultAddress]);

  const isWorking = state === "building" || state === "signing" || state === "extracting";
  const canSubmit = !isWorking && !disabledReason;

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
              vaultAddress,
              subaccount,
              amount: requiresAmount ? amount.trim() : undefined,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-md gap-0 border-zinc-800 bg-zinc-950 p-0 text-zinc-100", className)}>
        <DialogHeader className="border-b border-zinc-800 px-5 py-4 text-left">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className="text-balance text-base">{copy.title}</DialogTitle>
              <DialogDescription className="mt-1 text-pretty text-xs text-zinc-400">
                {copy.description}
              </DialogDescription>
            </div>
            <Badge variant="outline" className="border-zinc-700 text-zinc-300">
              {mode}
            </Badge>
          </div>
        </DialogHeader>

        <form onSubmit={submit}>
          <div className="space-y-4 px-5 py-4">
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

            {requiresAmount ? (
              <div className="space-y-2">
                <Label htmlFor="vault-action-amount" className="text-xs text-zinc-300">
                  Amount
                </Label>
                <Input
                  id="vault-action-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  className="border-zinc-800 bg-zinc-950 font-mono tabular-nums text-zinc-100"
                  aria-invalid={Boolean(error && requiresAmount)}
                />
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
          </div>

          <DialogFooter className="border-t border-zinc-800 px-5 py-4 sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isWorking}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} className="min-w-36">
              {state === "building" || state === "signing" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : state === "submitted" ? (
                <CheckCircle2 className="size-4" aria-hidden="true" />
              ) : mode === "deposit" ? (
                <WalletCards className="size-4" aria-hidden="true" />
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type { VaultActionModalProps };
