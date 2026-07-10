"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { TAKER_FEE, MAKER_REBATE } from "@/lib/decibel";
import { buildAndSign, waitForTransactionConfirmation } from "@/lib/tx-utils";
import {
  emitDecibelPositionsRefresh,
  pickDecibelSubaccount,
  storeDecibelSubaccount,
} from "@/lib/decibel-selection";
import { explorerTxUrl } from "@/lib/constants";

interface TradeFormProps {
  marketName: string;
  currentPrice: number | null;
  maxLeverage?: number;
}

interface Subaccount {
  address: string;
  name: string | null;
  isPrimary: boolean;
}

interface SubaccountResponse {
  error?: string;
  hasSubaccount?: boolean;
  subaccounts?: Subaccount[];
  subaccountAddr?: string | null;
  createUrl?: string;
}

interface FaucetResponse {
  error?: string;
  enabled?: boolean;
  remaining?: number;
  resetAt?: string | null;
}

const DEFAULT_DECIBEL_URL = "https://testnet.decibel.trade";

function normalizeSubaccounts(data: SubaccountResponse): Subaccount[] {
  if (Array.isArray(data.subaccounts)) {
    return data.subaccounts.filter(
      (subaccount): subaccount is Subaccount =>
        typeof subaccount?.address === "string" &&
        subaccount.address.length > 0
    );
  }

  if (typeof data.subaccountAddr === "string" && data.subaccountAddr.length > 0) {
    return [
      {
        address: data.subaccountAddr,
        name: null,
        isPrimary: true,
      },
    ];
  }

  return [];
}

function pickSubaccount(
  subaccounts: Subaccount[],
  owner: string,
  current: string | null
): string | null {
  return pickDecibelSubaccount(subaccounts, owner, current);
}

function shortAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-4)}`;
}

function formatFaucetReset(resetAt: string | null | undefined) {
  if (!resetAt) return null;

  const resetTime = new Date(resetAt);
  if (Number.isNaN(resetTime.getTime())) return null;

  return resetTime.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function TradeForm({
  marketName,
  currentPrice,
  maxLeverage = 10,
}: TradeFormProps) {
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [price, setPrice] = useState("");
  const [size, setSize] = useState("");
  const [subaccounts, setSubaccounts] = useState<Subaccount[]>([]);
  const [selectedSubaccount, setSelectedSubaccount] = useState<string | null>(
    null
  );
  const [createUrl, setCreateUrl] = useState(DEFAULT_DECIBEL_URL);
  const [isLoadingSubaccounts, setIsLoadingSubaccounts] = useState(false);
  const [subaccountError, setSubaccountError] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [faucetStatus, setFaucetStatus] = useState<{
    enabled: boolean;
    remaining: number | null;
    resetAt: string | null;
  } | null>(null);
  const [isLoadingFaucet, setIsLoadingFaucet] = useState(false);
  const [status, setStatus] = useState<{
    type: "idle" | "pending" | "success" | "error";
    message?: string;
    hash?: string;
  }>({ type: "idle" });

  const refreshSubaccounts = useCallback(
    async (walletAddress: string, preferredSubaccount?: string | null) => {
      setIsLoadingSubaccounts(true);
      setSubaccountError(null);

      try {
        const res = await fetch(
          `/api/decibel/subaccount?address=${walletAddress}`
        );
        const data = (await res.json()) as SubaccountResponse;

        if (!res.ok || data.error) {
          throw new Error(data.error || `Subaccount lookup failed (${res.status})`);
        }

        const nextSubaccounts = normalizeSubaccounts(data);
        setSubaccounts(nextSubaccounts);
        setCreateUrl(data.createUrl || DEFAULT_DECIBEL_URL);
        setSelectedSubaccount((current) => {
          const picked = pickSubaccount(
            nextSubaccounts,
            walletAddress,
            preferredSubaccount ?? current
          );
          storeDecibelSubaccount(picked, walletAddress);
          return picked;
        });

        return nextSubaccounts;
      } catch (err) {
        setSubaccounts([]);
        setSelectedSubaccount(null);
        setSubaccountError(
          err instanceof Error
            ? err.message
            : "Could not check Decibel subaccounts"
        );
        return [];
      } finally {
        setIsLoadingSubaccounts(false);
      }
    },
    []
  );

  const waitForSubaccounts = useCallback(
    async (walletAddress: string) => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const nextSubaccounts = await refreshSubaccounts(walletAddress);
        if (nextSubaccounts.length > 0) return nextSubaccounts;
        await sleep(1250);
      }
      return [];
    },
    [refreshSubaccounts]
  );

  const refreshFaucetStatus = useCallback(async () => {
    setIsLoadingFaucet(true);

    try {
      const res = await fetch("/api/decibel/faucet");
      const data = (await res.json()) as FaucetResponse;

      if (!res.ok || data.error) {
        throw new Error(data.error || `Faucet lookup failed (${res.status})`);
      }

      setFaucetStatus({
        enabled: Boolean(data.enabled),
        remaining: typeof data.remaining === "number" ? data.remaining : null,
        resetAt: data.resetAt ?? null,
      });
    } catch {
      setFaucetStatus(null);
    } finally {
      setIsLoadingFaucet(false);
    }
  }, []);

  // Detect subaccounts when wallet connects
  useEffect(() => {
    if (!connected || !account) {
      setSubaccounts([]);
      setSelectedSubaccount(null);
      setSubaccountError(null);
      setFaucetStatus(null);
      return;
    }

    refreshSubaccounts(account.address.toString());
    refreshFaucetStatus();
  }, [connected, account, refreshSubaccounts, refreshFaucetStatus]);

  const handleSubmit = async () => {
    if (!connected || !account) {
      setStatus({ type: "error", message: "Connect a wallet before trading." });
      return;
    }

    if (
      !selectedSubaccount ||
      !subaccounts.some((subaccount) => subaccount.address === selectedSubaccount)
    ) {
      setStatus({
        type: "error",
        message: "Create or select a Decibel subaccount before placing orders.",
      });
      return;
    }

    const orderSize = Number(size);
    if (!Number.isFinite(orderSize) || orderSize <= 0) {
      setStatus({ type: "error", message: "Enter a valid order size." });
      return;
    }

    const limitPrice = Number(price);
    if (
      orderType === "limit" &&
      (!Number.isFinite(limitPrice) || limitPrice <= 0)
    ) {
      setStatus({ type: "error", message: "Enter a valid limit price." });
      return;
    }

    setStatus({ type: "pending", message: "Preparing Decibel order payload..." });

    try {
      const res = await fetch("/api/decibel/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketName,
          price: orderType === "limit" ? limitPrice : currentPrice ?? undefined,
          size: orderSize,
          isBuy: side === "buy",
          orderType,
          subaccount: selectedSubaccount,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Order failed");
      if (!data.payload) throw new Error("Order API did not return a payload");

      setStatus({ type: "pending", message: "Confirm order in your wallet..." });

      const result = await signAndSubmitTransaction({
        data: data.payload,
      });

      setStatus({
        type: "pending",
        message: "Order submitted. Waiting for on-chain confirmation...",
        hash: result.hash,
      });
      emitDecibelPositionsRefresh();
      await waitForTransactionConfirmation(result.hash);
      emitDecibelPositionsRefresh();

      setStatus({
        type: "success",
        message: `${side.toUpperCase()} ${orderType} confirmed with USDC collateral`,
        hash: result.hash,
      });
      setSize("");
      setPrice("");
    } catch (err) {
      setStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Order failed",
      });
    }
  };

  const handleCreateSubaccount = async () => {
    if (!connected || !account) return;
    setStatus({ type: "pending", message: "Creating Decibel subaccount..." });

    try {
      const { hash } = await buildAndSign(
        "/api/decibel/create-subaccount",
        { owner: account.address.toString() },
        signAndSubmitTransaction
      );
      setStatus({
        type: "pending",
        message: "Subaccount submitted. Waiting for confirmation...",
        hash,
      });
      await waitForTransactionConfirmation(hash);
      const nextSubaccounts = await waitForSubaccounts(account.address.toString());
      setStatus({
        type: "success",
        message:
          nextSubaccounts.length > 0
            ? "Decibel subaccount ready"
            : "Subaccount transaction submitted. It may take a moment to appear.",
        hash,
      });
    } catch (err) {
      setStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Subaccount creation failed",
      });
    }
  };

  const handleDeposit = async () => {
    if (!connected || !account) {
      setStatus({
        type: "error",
        message: "Connect a wallet before depositing USDC collateral.",
      });
      return;
    }

    if (
      !selectedSubaccount ||
      !subaccounts.some((subaccount) => subaccount.address === selectedSubaccount)
    ) {
      setStatus({
        type: "error",
        message: "Create or select a Decibel subaccount before depositing USDC.",
      });
      return;
    }

    const depositValue = Number(depositAmount);
    const amountRawNumber = Math.floor(depositValue * 1_000_000);
    if (!Number.isFinite(depositValue) || amountRawNumber <= 0) {
      setStatus({
        type: "error",
        message: "Enter at least 0.000001 USDC to deposit.",
      });
      return;
    }

    setStatus({ type: "pending", message: "Preparing USDC collateral deposit..." });

    try {
      const amountRaw = String(amountRawNumber);
	      const { hash } = await buildAndSign(
	        "/api/decibel/deposit",
	        { subaccount: selectedSubaccount, amount: amountRaw },
	        signAndSubmitTransaction
	      );
	      setStatus({
	        type: "pending",
	        message: "Deposit submitted. Waiting for confirmation...",
	        hash,
	      });
	      await waitForTransactionConfirmation(hash);
	      emitDecibelPositionsRefresh();

	      setStatus({
	        type: "success",
        message: `Deposited ${depositAmount} USDC as collateral`,
        hash,
      });
      setDepositAmount("");
    } catch (err) {
      setStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Deposit failed",
      });
    }
  };

  const handleMintTestnetUsdc = async () => {
    if (!connected || !account) {
      setStatus({
        type: "error",
        message: "Connect a wallet before minting Decibel testnet USDC.",
      });
      return;
    }

    if (!faucetStatus?.enabled) {
      setStatus({
        type: "error",
        message: "Decibel testnet USDC faucet is not enabled.",
      });
      return;
    }

    if (faucetStatus.remaining === 0) {
      const resetLabel = formatFaucetReset(faucetStatus.resetAt);
      setStatus({
        type: "error",
        message: resetLabel
          ? `Decibel faucet limit reached. Try again after ${resetLabel}.`
          : "Decibel faucet limit reached. Try again later.",
      });
      return;
    }

    setStatus({
      type: "pending",
      message: "Preparing Decibel testnet USDC mint...",
    });

    try {
	      const { hash } = await buildAndSign(
	        "/api/decibel/faucet",
	        {},
	        signAndSubmitTransaction
	      );
	      setStatus({
	        type: "pending",
	        message: "Mint submitted. Waiting for confirmation...",
	        hash,
	      });
	      await waitForTransactionConfirmation(hash);
	      setStatus({
        type: "success",
        message: "Minted Decibel testnet USDC. Deposit it as collateral.",
        hash,
      });
      refreshFaucetStatus();
    } catch (err) {
      setStatus({
        type: "error",
        message: err instanceof Error ? err.message : "USDC mint failed",
      });
    }
  };

  // Set price from orderbook click
  const setLimitPrice = (p: number) => {
    setPrice(p.toFixed(2));
    setOrderType("limit");
  };

  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).__setTradePrice =
      setLimitPrice;
  }

  const effectivePrice =
    orderType === "limit" && price ? parseFloat(price) : currentPrice || 0;
  const notional = size ? parseFloat(size) * effectivePrice : 0;
  const fee =
    orderType === "market"
      ? notional * TAKER_FEE
      : notional * -MAKER_REBATE;
  const isPending = status.type === "pending";
  const hasSelectedSubaccount = Boolean(
    selectedSubaccount &&
      subaccounts.some((subaccount) => subaccount.address === selectedSubaccount)
  );
  const hasValidSize = Number.isFinite(Number(size)) && Number(size) > 0;
  const hasValidLimitPrice =
    orderType !== "limit" ||
    (Number.isFinite(Number(price)) && Number(price) > 0);
  const depositAmountRaw = Math.floor(Number(depositAmount) * 1_000_000);
  const hasValidDepositAmount =
    Number.isFinite(Number(depositAmount)) && depositAmountRaw > 0;
  const canSubmit =
    connected &&
    hasSelectedSubaccount &&
    hasValidSize &&
    hasValidLimitPrice &&
    !isPending &&
    !isLoadingSubaccounts;
  const canDeposit =
    connected &&
    hasSelectedSubaccount &&
    hasValidDepositAmount &&
    !isPending &&
    !isLoadingSubaccounts;
  const canMintTestnetUsdc =
    connected &&
    Boolean(faucetStatus?.enabled) &&
    faucetStatus?.remaining !== 0 &&
    !isPending &&
    !isLoadingFaucet;
  const faucetResetLabel = formatFaucetReset(faucetStatus?.resetAt);

  return (
    <div className="surface-1 rounded-[16px] p-5">
      <h3 className="text-[13px] font-display font-semibold mb-4">{marketName}</h3>

      {connected && isLoadingSubaccounts && (
        <div className="bg-accent/10 border border-accent/20 rounded-[10px] p-3 mb-4 text-[12px] text-accent">
          Checking Decibel subaccounts...
        </div>
      )}

      {connected && subaccountError && !isLoadingSubaccounts && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-[10px] p-3 mb-4 text-[12px] text-danger">
          {subaccountError}
        </div>
      )}

      {/* Subaccount Warning */}
      {connected && !isLoadingSubaccounts && subaccounts.length === 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-[10px] p-3 mb-4 text-[12px]">
          <p className="text-warning font-medium mb-1">
            No Decibel subaccount found
          </p>
          <p className="text-zinc-500 mb-2">
            Create a subaccount before depositing USDC collateral or trading Decibel perps.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleCreateSubaccount}
              disabled={isPending}
              className="btn-cash px-4 py-2 rounded-[10px] text-[12px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isPending ? "Creating..." : "Create Subaccount"}
            </button>
            <a
              href={createUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-[10px] text-[12px] font-medium border border-white/10 text-zinc-400 hover:text-foreground"
            >
              Open Decibel
            </a>
          </div>
        </div>
      )}

      {/* Subaccount Selector */}
      {subaccounts.length > 0 && (
        <div className="mb-4">
          <label className="text-[11px] text-zinc-500 mb-1 block">
            Decibel Subaccount
          </label>
          {subaccounts.length > 1 ? (
	            <select
	              value={selectedSubaccount || ""}
	              onChange={(e) => {
	                const next = e.target.value;
	                setSelectedSubaccount(next);
	                storeDecibelSubaccount(next, account?.address?.toString());
	              }}
	              className="w-full input-cash text-[12px] font-mono"
	            >
              {subaccounts.map((s) => (
                <option key={s.address} value={s.address}>
                  {s.name || shortAddress(s.address)}
                  {s.isPrimary ? " (primary)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <div className="w-full input-cash text-[12px] font-mono text-zinc-300">
              {subaccounts[0].name || shortAddress(subaccounts[0].address)}
              {subaccounts[0].isPrimary ? " (primary)" : ""}
            </div>
          )}
        </div>
      )}

      {/* Collateral Deposit */}
      {connected && hasSelectedSubaccount && (
        <div className="mb-4 bg-background/50 rounded-[12px] p-3">
          <label className="text-[11px] text-zinc-500 mb-1 block">
            Decibel USDC Collateral
          </label>
          <p className="text-[11px] text-zinc-600 mb-2">
            Deposit USDC to the selected Decibel subaccount before opening perps positions.
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="0.00 USDC"
              min="0"
              step="0.000001"
              className="flex-1 input-cash text-[12px] font-mono"
            />
            <button
              onClick={handleDeposit}
              disabled={!canDeposit}
              className="px-3 py-2 bg-accent/10 text-accent rounded-[10px] text-[12px] font-medium hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isPending ? "Processing..." : "Deposit USDC"}
            </button>
          </div>
          {faucetStatus?.enabled && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-600">
              <span>
                Need testnet collateral?
                {typeof faucetStatus.remaining === "number"
                  ? ` ${faucetStatus.remaining} faucet mints remaining.`
                  : " Faucet mint available."}
                {faucetStatus.remaining === 0 && faucetResetLabel
                  ? ` Resets at ${faucetResetLabel}.`
                  : ""}
              </span>
              <button
                onClick={handleMintTestnetUsdc}
                disabled={!canMintTestnetUsdc}
                className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isLoadingFaucet ? "Checking..." : "Mint Testnet USDC"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Buy/Sell Toggle */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => setSide("buy")}
          className={`py-2.5 rounded-[10px] text-[13px] font-medium transition-all duration-200 ease-out ${
            side === "buy"
              ? "bg-green-500 text-accent-foreground"
              : "surface-1 text-zinc-500 hover:text-foreground"
          }`}
        >
          Buy / Long
        </button>
        <button
          onClick={() => setSide("sell")}
          className={`py-2.5 rounded-[10px] text-[13px] font-medium transition-all duration-200 ease-out ${
            side === "sell"
              ? "bg-red-500 text-accent-foreground"
              : "surface-1 text-zinc-500 hover:text-foreground"
          }`}
        >
          Sell / Short
        </button>
      </div>

      {/* Order Type */}
      <div className="flex gap-2 mb-4">
        {(["market", "limit"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setOrderType(type)}
            className={`px-3 py-1.5 rounded-[8px] text-[12px] font-medium transition-all duration-200 ease-out ${
              orderType === type
                ? "bg-accent/10 text-accent"
                : "text-zinc-500 hover:text-foreground"
            }`}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Price (limit only) */}
      {orderType === "limit" && (
        <div className="mb-3">
          <label className="text-[11px] text-zinc-500 mb-1 block">Price (USD)</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={currentPrice?.toFixed(2) || "0.00"}
            step="0.01"
            className="w-full input-cash text-[13px] font-mono"
          />
        </div>
      )}

      {/* Size */}
      <div className="mb-4">
        <label className="text-[11px] text-zinc-500 mb-1 block">
          Size ({marketName.split("/")[0]})
        </label>
        <input
          type="number"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          placeholder="0.00"
          step="0.0001"
          className="w-full input-cash text-[13px] font-mono"
        />
      </div>

      {/* Order Summary */}
      {size && (
        <div className="bg-background/50 rounded-[12px] p-3 mb-4 text-[12px] space-y-1">
          <div className="flex justify-between">
            <span className="text-zinc-500">Notional</span>
            <span className="font-mono tabular-nums">${notional.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">
              {orderType === "market" ? "Taker Fee" : "Maker Rebate"}
            </span>
            <span
              className={`font-mono tabular-nums ${
                orderType === "limit" ? "text-success" : ""
              }`}
            >
              {orderType === "market"
                ? `$${fee.toFixed(4)}`
                : `-$${Math.abs(fee).toFixed(4)}`}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Max Leverage</span>
            <span className="tabular-nums">{maxLeverage}x</span>
          </div>
        </div>
      )}

      {/* Submit — when logged out this is the primary CTA: keep it clickable
          and route it to the wallet selector instead of a dead disabled state. */}
      <button
        onClick={
          !connected
            ? () => window.dispatchEvent(new CustomEvent("cash:open-wallet-selector"))
            : handleSubmit
        }
        disabled={connected && !canSubmit}
        className={`w-full py-3 rounded-[12px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          !connected
            ? "bg-accent text-black hover:brightness-110"
            : side === "buy"
            ? "bg-green-500 text-accent-foreground hover:bg-green-600"
            : "bg-red-500 text-accent-foreground hover:bg-red-600"
        }`}
      >
        {!connected
          ? "Connect Wallet"
          : isLoadingSubaccounts
          ? "Checking Subaccount..."
          : !hasSelectedSubaccount
          ? "Create Subaccount First"
          : !hasValidSize
          ? "Enter Size"
          : !hasValidLimitPrice
          ? "Enter Limit Price"
          : isPending
          ? "Processing..."
          : `${side === "buy" ? "Buy" : "Sell"} ${marketName}`}
      </button>

      {/* Status */}
      {status.type !== "idle" && (
        <div
          className={`mt-3 p-3 rounded-[10px] text-[12px] ${
            status.type === "success"
              ? "bg-green-500/10 text-success"
              : status.type === "pending"
              ? "bg-accent/10 text-accent"
              : "bg-red-500/10 text-danger"
          }`}
        >
          {status.message}
          {status.hash && (
            <a
              href={explorerTxUrl(status.hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="block mt-1 underline"
            >
              View on Explorer
            </a>
          )}
        </div>
      )}
    </div>
  );
}
