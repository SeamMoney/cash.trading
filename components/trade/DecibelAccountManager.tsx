"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { explorerTxUrl } from "@/lib/constants";
import { buildAndSign, waitForTransactionConfirmation } from "@/lib/tx-utils";
import { cn } from "@/lib/utils";
import { emitDecibelPositionsRefresh } from "@/lib/decibel-selection";
import { NumberTicker } from "@/components/ui/number-ticker";
import {
  shortAddress,
  useDecibelSubaccounts,
} from "@/hooks/useDecibelSubaccounts";
import { TokenLogo } from "@/components/trade/StablecoinLogo";

interface AccountOverview {
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number | null;
  marginRatio: number;
  maintenanceMargin: number;
  leverage: number | null;
  totalMargin: number;
  totalNotional: number;
  collateral: number;
  crossWithdrawable: number;
  volume30d: number | null;
}

interface AccountStateResponse {
  overview?: AccountOverview | null;
  error?: string;
}

export function DecibelAccountManager({ className }: { className?: string }) {
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const [depositAmount, setDepositAmount] = useState("100");
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusHash, setStatusHash] = useState("");
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const {
    decibelNetwork,
    hasDecibelAccount,
    isLoadingSubaccounts,
    lookupIncomplete,
    refreshSubaccounts,
    selectSubaccount,
    selectedSubaccount,
    selectedSubaccountRecord,
    subaccounts,
    waitForSubaccounts,
  } = useDecibelSubaccounts();
  const isMainnet = decibelNetwork === "mainnet";

  const depositValue = Number(depositAmount);
  const hasDepositAmount = Number.isFinite(depositValue) && depositValue > 0;
  const canDeposit =
    connected &&
    account &&
    hasDecibelAccount &&
    hasDepositAmount &&
    status !== "submitting";

  const selectedSubaccountLabel = selectedSubaccountRecord
    ? selectedSubaccountRecord.name || shortAddress(selectedSubaccountRecord.address)
    : isLoadingSubaccounts
      ? "Checking trading account..."
      : lookupIncomplete
        ? "Lookup unavailable"
        : "No trading account";

  const accountStateLabel = !connected
    ? "Wallet disconnected"
    : isLoadingSubaccounts
      ? "Checking"
    : hasDecibelAccount
      ? "Ready"
      : lookupIncomplete
        ? "Verify needed"
      : "Setup required";

  const accountStateTone = hasDecibelAccount
    ? "bg-emerald-500/10 text-emerald-300"
    : isLoadingSubaccounts
      ? "bg-sky-500/10 text-sky-300"
      : lookupIncomplete
        ? "bg-yellow-500/10 text-yellow-300"
    : connected
      ? "bg-accent/10 text-accent"
      : "bg-white/[0.04] text-zinc-500";

  const accountHelpText = !connected
    ? "Connect a wallet to create a Decibel trading account."
    : isLoadingSubaccounts
      ? "Checking Decibel account state on-chain and through the Decibel API."
    : hasDecibelAccount
      ? "USDC collateral, orders, and positions route through this account."
    : lookupIncomplete
      ? "Could not verify this wallet's Decibel trading accounts. Refresh or reconnect the wallet."
      : isMainnet
        ? "Mainnet account creation requires a Decibel referrer or allowlist entry. Refresh if this wallet already has an account."
      : "Create one Decibel trading account before depositing collateral or placing orders.";

  const canCreateAccount =
    connected &&
    !hasDecibelAccount &&
    !isLoadingSubaccounts &&
    !lookupIncomplete &&
    status !== "submitting";

  const refreshAccountState = useCallback(async (signal?: AbortSignal) => {
    if (!selectedSubaccount || !hasDecibelAccount) {
      setOverview(null);
      setOverviewError("");
      setOverviewLoading(false);
      return;
    }

    setOverviewLoading(true);
    setOverviewError("");
    try {
      const params = new URLSearchParams({
        address: selectedSubaccount,
        openOrders: "false",
        network: decibelNetwork,
      });
      const res = await fetch(`/api/decibel/positions?${params.toString()}`, {
        cache: "no-store",
        signal,
      });
      const data = (await res.json()) as AccountStateResponse;
      if (!res.ok || data.error) {
        throw new Error(data.error || `Decibel account state failed (${res.status})`);
      }
      if (signal?.aborted) return;
      setOverview(data.overview ?? null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setOverview(null);
      setOverviewError(err instanceof Error ? err.message : "Decibel account state unavailable.");
    } finally {
      if (!signal?.aborted) setOverviewLoading(false);
    }
  }, [decibelNetwork, hasDecibelAccount, selectedSubaccount]);

  useEffect(() => {
    const controller = new AbortController();
    void refreshAccountState(controller.signal);
    return () => controller.abort();
  }, [refreshAccountState]);

  const handleRefreshAccount = useCallback(() => {
    void refreshSubaccounts();
    void refreshAccountState();
  }, [refreshAccountState, refreshSubaccounts]);

  const handleCreateSubaccount = useCallback(async () => {
    if (!connected || !account) return;
    setStatus("submitting");
    setStatusMessage("Create a Decibel trading account in your wallet...");
    setStatusHash("");
    try {
      const current = await refreshSubaccounts();
      if (current.length > 0) {
        setStatus("success");
        setStatusMessage("Decibel trading account already connected.");
        return;
      }
      const { hash } = await buildAndSign(
        "/api/decibel/create-subaccount",
        { owner: account.address.toString(), network: decibelNetwork },
        signAndSubmitTransaction
      );
      setStatusHash(hash);
      setStatusMessage("Account transaction submitted. Waiting for confirmation...");
      await waitForTransactionConfirmation(hash);
      setStatusMessage("Account confirmed. Refreshing Decibel account...");
      const next = await waitForSubaccounts();
      setStatus("success");
      setStatusMessage(
        next.length > 0
          ? "Decibel trading account ready."
          : "Account confirmed. Decibel indexer may take a moment to show it."
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Account creation failed";
      setStatusMessage(
        decibelNetwork === "mainnet" &&
          (message.includes("EACCOUNT_WITHOUT_REFERRER_OR_IN_ALLOW_LIST") ||
            message.includes("Move abort 0xe"))
          ? "Decibel mainnet rejected account creation because this wallet is not referred or allowlisted yet. Refresh if you already created an account on Decibel."
          : message
      );
      setStatus("error");
    }
  }, [
    account,
    connected,
    decibelNetwork,
    refreshSubaccounts,
    signAndSubmitTransaction,
    waitForSubaccounts,
  ]);

  const handleMintTestnetUsdc = useCallback(async () => {
    if (!connected || !account || isMainnet) return;
    setStatus("submitting");
    setStatusMessage("Mint Decibel testnet USDC in your wallet...");
    setStatusHash("");
    try {
      const { hash } = await buildAndSign(
        "/api/decibel/faucet",
        { network: decibelNetwork },
        signAndSubmitTransaction
      );
      setStatusHash(hash);
      setStatusMessage("USDC mint submitted. Waiting for confirmation...");
      await waitForTransactionConfirmation(hash);
      setStatusMessage("Decibel testnet USDC minted.");
      setStatus("success");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Decibel USDC mint failed");
      setStatus("error");
    }
  }, [account, connected, decibelNetwork, isMainnet, signAndSubmitTransaction]);

  const handleDeposit = useCallback(async () => {
    if (!connected || !account) {
      setStatusMessage("Connect wallet before depositing USDC collateral.");
      setStatus("error");
      return;
    }
    if (!selectedSubaccount || !subaccounts.some((s) => s.address === selectedSubaccount)) {
      setStatusMessage("Create a Decibel trading account before depositing USDC collateral.");
      setStatus("error");
      return;
    }
    if (!hasDepositAmount) {
      setStatusMessage("Enter a USDC amount before depositing collateral.");
      setStatus("error");
      return;
    }

    setStatus("submitting");
    setStatusMessage(`Deposit ${depositValue.toFixed(2)} USDC collateral to Decibel...`);
    setStatusHash("");
    try {
      const raw = String(Math.floor(depositValue * 1_000_000));
      const { hash } = await buildAndSign(
        "/api/decibel/deposit",
        { subaccount: selectedSubaccount, amount: raw, network: decibelNetwork },
        signAndSubmitTransaction
      );
      setStatusHash(hash);
      setStatusMessage("Deposit submitted. Waiting for confirmation...");
      await waitForTransactionConfirmation(hash);
      emitDecibelPositionsRefresh();
      void refreshAccountState();
      setStatusMessage("USDC collateral deposited to Decibel.");
      setStatus("success");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "USDC collateral deposit failed.");
      setStatus("error");
    }
  }, [
    account,
    connected,
    decibelNetwork,
    depositValue,
    hasDepositAmount,
    refreshAccountState,
    selectedSubaccount,
    signAndSubmitTransaction,
    subaccounts,
  ]);

  return (
    <section
      className={cn(
        "space-y-4",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-display font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Decibel Trading Account
          </p>
          <p className="mt-1 truncate text-[14px] font-medium text-white">
            {selectedSubaccountLabel}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-[10px] font-mono",
            accountStateTone
          )}
        >
          {accountStateLabel}
        </span>
      </div>

      <p className="text-[12px] leading-relaxed text-zinc-500 text-pretty">
        {accountHelpText}
      </p>

      {connected && hasDecibelAccount && (
        <div className="grid grid-cols-2 gap-x-5 gap-y-3 tabular-nums">
          {[
            { label: "Equity", value: overview?.equity, signed: false },
            { label: "Available USDC", value: overview?.crossWithdrawable, signed: false },
            { label: "Collateral", value: overview?.collateral, signed: false },
            {
              label: "Unrealized P&L",
              value: overview?.unrealizedPnl,
              signed: true,
              tone:
                overview?.unrealizedPnl == null
                  ? "text-white"
                  : overview.unrealizedPnl >= 0
                    ? "text-accent"
                    : "text-danger",
            },
          ].map((item) => (
            <div key={item.label} className="min-w-0">
              <p className="text-[10px] font-display font-semibold uppercase text-zinc-600">
                {item.label}
              </p>
              <p className={cn("mt-1 truncate text-[14px] font-semibold text-white", item.tone)}>
                {overviewLoading ? (
                  "..."
                ) : (
                  <NumberTicker
                    value={item.value}
                    fallback="--"
                    format={{
                      style: "currency",
                      currency: "USD",
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                      signDisplay: item.signed ? "always" : "auto",
                    }}
                  />
                )}
              </p>
            </div>
          ))}
          {overviewError && (
            <p className="col-span-2 text-[11px] text-yellow-300">
              Balance unavailable. Refresh account.
            </p>
          )}
        </div>
      )}

      {connected && hasDecibelAccount ? (
        <div className="space-y-1.5">
          <label className="text-[10px] font-display font-semibold uppercase tracking-[0.16em] text-zinc-600">
            Active account
          </label>
          <select
            value={selectedSubaccount}
            onChange={(e) => selectSubaccount(e.target.value)}
            className="w-full rounded-[10px] bg-white/[0.04] px-3 py-2 text-[12px] font-mono text-zinc-300 outline-none focus:bg-white/[0.07]"
          >
            {subaccounts.map((s) => (
              <option key={s.address} value={s.address}>
                {(s.name || shortAddress(s.address))}
                {s.isPrimary ? " (primary)" : ""}
              </option>
            ))}
          </select>
        </div>
      ) : canCreateAccount ? (
        <button
          type="button"
          onClick={handleCreateSubaccount}
          className="w-full rounded-[10px] bg-accent/15 px-3 py-2.5 text-[12px] font-display font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Create Trading Account
        </button>
      ) : null}

      <div className={cn("grid gap-2", isMainnet ? "grid-cols-1" : "grid-cols-2")}>
        <button
          type="button"
          onClick={handleRefreshAccount}
          disabled={!connected || status === "submitting" || isLoadingSubaccounts}
          className="rounded-md bg-white/[0.03] px-3 py-2 text-[11px] font-display font-semibold text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoadingSubaccounts ? "Checking..." : "Refresh account"}
        </button>
        {!isMainnet && (
          <button
            type="button"
            onClick={handleMintTestnetUsdc}
            disabled={!connected || status === "submitting"}
            className="rounded-md bg-white/[0.03] px-3 py-2 text-[11px] font-display font-semibold text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Mint testnet USDC
          </button>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label className="flex items-center gap-2 rounded-md bg-white/[0.03] px-3 py-2">
          <TokenLogo token="USDC" size={18} />
          <input
            type="text"
            inputMode="decimal"
            value={depositAmount}
            onChange={(e) => {
              const next = e.target.value.replace(/[^0-9.]/g, "");
              if (next.split(".").length <= 2) setDepositAmount(next);
            }}
            className="min-w-0 flex-1 bg-transparent text-[13px] font-mono font-semibold text-white outline-none placeholder:text-zinc-700"
            placeholder="0.00"
          />
          <span className="text-[11px] font-mono text-zinc-500">USDC</span>
        </label>
        <button
          type="button"
          onClick={handleDeposit}
          disabled={!canDeposit}
          className={cn(
            "rounded-md px-3 py-2 text-[11px] font-display font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            canDeposit
              ? "bg-white/[0.08] text-zinc-100 hover:bg-white/[0.12]"
              : "bg-white/[0.03] text-zinc-600"
          )}
        >
          Deposit
        </button>
      </div>

      {statusMessage && (
        <div
          className={cn(
            "rounded-[10px] px-3 py-2 text-[11px]",
            status === "error"
              ? "bg-red-500/10 text-red-300"
              : "bg-white/[0.04] text-zinc-400"
          )}
        >
          <p>{statusMessage}</p>
          {statusHash && (
            <a
              href={explorerTxUrl(statusHash)}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-accent underline"
            >
              View transaction
            </a>
          )}
        </div>
      )}
    </section>
  );
}
