"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { explorerTxUrl } from "@/lib/constants";
import { buildAndSign, waitForTransactionConfirmation } from "@/lib/tx-utils";
import { cn } from "@/lib/utils";
import { emitDecibelPositionsRefresh } from "@/lib/decibel-selection";
import { getChainFromWallet } from "@/lib/wallet-utils";
import { buildAptosCctpClaimPayload } from "@/lib/decibel-cctp";
import {
  fetchEvmUsdcBalance,
  startEvmCctpDeposit,
  type EvmCctpSourceChain,
} from "@/lib/evm-cctp";
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

interface WalletBalanceResponse {
  balance?: number;
  error?: string;
}

type BridgeSourceChain = EvmCctpSourceChain;

interface CctpStatusResponse {
  amount?: number;
  attestation?: string | null;
  destinationChain?: string;
  destinationIsAptos?: boolean;
  error?: string;
  explorerUrl?: string | null;
  mintRecipient?: string;
  nonce?: string;
  messageBytes?: string;
  sourceChain?: string;
  status?: "pending" | "claimable" | "completed";
  txHash?: string;
}

const BRIDGE_SOURCE_CHAINS: BridgeSourceChain[] = ["Arbitrum", "Base", "Ethereum"];

function formatDepositInputAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function normalizeAptosAddress(address?: string | null) {
  if (!address) return "";
  const hex = address.startsWith("0x") ? address.slice(2) : address;
  return `0x${hex.toLowerCase().padStart(64, "0")}`;
}

export function DecibelAccountManager({ className }: { className?: string }) {
  const { account, connected, signAndSubmitTransaction, wallet } = useWallet();
  const [depositAmount, setDepositAmount] = useState("100");
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusHash, setStatusHash] = useState("");
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [walletUsdcBalance, setWalletUsdcBalance] = useState<number | null>(null);
  const [walletUsdcLoading, setWalletUsdcLoading] = useState(false);
  const [walletUsdcError, setWalletUsdcError] = useState("");
  const [bridgeSourceChain, setBridgeSourceChain] =
    useState<BridgeSourceChain>("Arbitrum");
  const [bridgeTxHash, setBridgeTxHash] = useState("");
  const [bridgeTransfer, setBridgeTransfer] =
    useState<CctpStatusResponse | null>(null);
  const [bridgeLookupStatus, setBridgeLookupStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [bridgeMessage, setBridgeMessage] = useState("");
  const [evmSourceBalance, setEvmSourceBalance] = useState<number | null>(null);
  const [evmSourceAddress, setEvmSourceAddress] = useState("");
  const [evmSourceLoading, setEvmSourceLoading] = useState(false);
  const [evmSourceError, setEvmSourceError] = useState("");
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
  const walletOrigin = wallet ? getChainFromWallet(wallet) : "aptos";
  const isEvmWallet = walletOrigin === "ethereum";
  const connectedAptosAddress = normalizeAptosAddress(account?.address.toString());
  const bridgeMintRecipient = normalizeAptosAddress(bridgeTransfer?.mintRecipient);
  const bridgeMintRecipientMismatch =
    !!bridgeMintRecipient &&
    !!connectedAptosAddress &&
    bridgeMintRecipient !== connectedAptosAddress;
  const bridgeStorageKey =
    connected && account
      ? `cash:decibel:cctp-deposit:${decibelNetwork}:${account.address.toString()}`
      : "";

  const depositValue = Number(depositAmount);
  const hasDepositAmount = Number.isFinite(depositValue) && depositValue > 0;
  const depositExceedsWallet =
    walletUsdcBalance !== null && depositValue > walletUsdcBalance + 0.000001;
  const depositExceedsEvmSource =
    evmSourceBalance !== null && depositValue > evmSourceBalance + 0.000001;
  const canDeposit =
    connected &&
    account &&
    hasDecibelAccount &&
    hasDepositAmount &&
    !depositExceedsWallet &&
    status !== "submitting";
  const canStartEvmBridge =
    connected &&
    account &&
    hasDecibelAccount &&
    isEvmWallet &&
    hasDepositAmount &&
    !depositExceedsEvmSource &&
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

  useEffect(() => {
    if (!bridgeStorageKey) return;
    try {
      const saved = window.localStorage.getItem(bridgeStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as {
        sourceChain?: BridgeSourceChain;
        txHash?: string;
        transfer?: CctpStatusResponse;
      };
      if (parsed.sourceChain && BRIDGE_SOURCE_CHAINS.includes(parsed.sourceChain)) {
        setBridgeSourceChain(parsed.sourceChain);
      }
      if (parsed.txHash) setBridgeTxHash(parsed.txHash);
      if (parsed.transfer) {
        setBridgeTransfer(parsed.transfer);
        setBridgeLookupStatus("success");
      }
    } catch {
      window.localStorage.removeItem(bridgeStorageKey);
    }
  }, [bridgeStorageKey]);

  useEffect(() => {
    if (!bridgeStorageKey || !bridgeTxHash) return;
    window.localStorage.setItem(
      bridgeStorageKey,
      JSON.stringify({
        sourceChain: bridgeSourceChain,
        txHash: bridgeTxHash,
        transfer: bridgeTransfer,
      })
    );
  }, [bridgeSourceChain, bridgeStorageKey, bridgeTransfer, bridgeTxHash]);

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

  const refreshWalletUsdcBalance = useCallback(async (signal?: AbortSignal) => {
    if (!connected || !account) {
      setWalletUsdcBalance(null);
      setWalletUsdcError("");
      setWalletUsdcLoading(false);
      return;
    }

    setWalletUsdcLoading(true);
    setWalletUsdcError("");
    try {
      const params = new URLSearchParams({
        address: account.address.toString(),
        network: decibelNetwork,
      });
      const res = await fetch(`/api/decibel/wallet-balance?${params.toString()}`, {
        cache: "no-store",
        signal,
      });
      const data = (await res.json()) as WalletBalanceResponse;
      if (!res.ok || data.error) {
        throw new Error(data.error || `USDC balance lookup failed (${res.status})`);
      }
      if (signal?.aborted) return;
      setWalletUsdcBalance(typeof data.balance === "number" ? data.balance : null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setWalletUsdcBalance(null);
      setWalletUsdcError(err instanceof Error ? err.message : "USDC balance unavailable.");
    } finally {
      if (!signal?.aborted) setWalletUsdcLoading(false);
    }
  }, [account, connected, decibelNetwork]);

  useEffect(() => {
    const controller = new AbortController();
    void refreshAccountState(controller.signal);
    return () => controller.abort();
  }, [refreshAccountState]);

  useEffect(() => {
    const controller = new AbortController();
    void refreshWalletUsdcBalance(controller.signal);
    return () => controller.abort();
  }, [refreshWalletUsdcBalance]);

  useEffect(() => {
    let active = true;
    if (!connected || !account || !hasDecibelAccount || !isEvmWallet) {
      setEvmSourceBalance(null);
      setEvmSourceAddress("");
      setEvmSourceError("");
      setEvmSourceLoading(false);
      return;
    }

    setEvmSourceLoading(true);
    setEvmSourceError("");
    fetchEvmUsdcBalance({
      network: decibelNetwork,
      preferredWalletName: wallet?.name,
      sourceChain: bridgeSourceChain,
    })
      .then((result) => {
        if (!active) return;
        setEvmSourceBalance(result?.balance ?? null);
        setEvmSourceAddress(result?.address ?? "");
      })
      .catch((err) => {
        if (!active) return;
        setEvmSourceBalance(null);
        setEvmSourceAddress("");
        setEvmSourceError(
          err instanceof Error ? err.message : "EVM USDC balance unavailable."
        );
      })
      .finally(() => {
        if (active) setEvmSourceLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    account,
    bridgeSourceChain,
    connected,
    decibelNetwork,
    hasDecibelAccount,
    isEvmWallet,
    wallet?.name,
  ]);

  const handleRefreshAccount = useCallback(() => {
    void refreshSubaccounts();
    void refreshAccountState();
    void refreshWalletUsdcBalance();
  }, [refreshAccountState, refreshSubaccounts, refreshWalletUsdcBalance]);

  const lookupBridgeTransfer = useCallback(
    async (options?: {
      silent?: boolean;
      sourceChain?: BridgeSourceChain;
      txHash?: string;
    }) => {
      const txHash = (options?.txHash ?? bridgeTxHash).trim();
      const sourceChain = options?.sourceChain ?? bridgeSourceChain;
      if (!txHash) {
        setBridgeMessage("Paste the source-chain transfer transaction hash.");
        setBridgeLookupStatus("error");
        return;
      }

      if (!options?.silent) {
        setBridgeLookupStatus("loading");
        setBridgeMessage("Looking up Circle CCTP transfer...");
      }

      try {
        const params = new URLSearchParams({
          sourceChain,
          txHash,
          network: decibelNetwork,
        });
        const res = await fetch(`/api/decibel/cctp/status?${params.toString()}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as CctpStatusResponse;
        if (!res.ok || data.error) {
          throw new Error(data.error || `Transfer lookup failed (${res.status})`);
        }
        setBridgeTransfer(data);
        setBridgeLookupStatus("success");
        setBridgeMessage(
          data.status === "claimable"
            ? "Transfer is attested and ready to claim on Aptos, then deposit to Decibel."
            : "Transfer found. Waiting for Circle attestation before claim."
        );
      } catch (err) {
        if (options?.silent) return;
        setBridgeLookupStatus("error");
        setBridgeMessage(
          err instanceof Error ? err.message : "Could not look up the bridge transfer."
        );
      }
    },
    [bridgeSourceChain, bridgeTxHash, decibelNetwork]
  );

  useEffect(() => {
    if (bridgeTransfer?.status !== "pending" || !bridgeTxHash) return;
    const timer = window.setInterval(() => {
      void lookupBridgeTransfer({ silent: true });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [bridgeTransfer?.status, bridgeTxHash, lookupBridgeTransfer]);

  const handleClaimBridgeTransfer = useCallback(async () => {
    if (!connected || !account) {
      setBridgeLookupStatus("error");
      setBridgeMessage("Connect wallet before claiming the bridge transfer.");
      return;
    }
    if (!selectedSubaccount || !subaccounts.some((s) => s.address === selectedSubaccount)) {
      setBridgeLookupStatus("error");
      setBridgeMessage("Select a Decibel trading account before claim and deposit.");
      return;
    }
    if (
      !bridgeTransfer?.messageBytes ||
      !bridgeTransfer.attestation ||
      bridgeTransfer.status !== "claimable"
    ) {
      setBridgeLookupStatus("error");
      setBridgeMessage("Circle attestation is not ready yet.");
      return;
    }
    if (typeof bridgeTransfer.amount !== "number" || bridgeTransfer.amount <= 0) {
      setBridgeLookupStatus("error");
      setBridgeMessage("Transfer amount is unavailable.");
      return;
    }
    if (bridgeMintRecipientMismatch) {
      setBridgeLookupStatus("error");
      setBridgeMessage(
        `This bridge mints to ${shortAddress(bridgeTransfer.mintRecipient ?? "")}, but this wallet is ${shortAddress(account.address.toString())}. Connect the matching derived Aptos account before claiming.`
      );
      return;
    }

    setStatus("submitting");
    setStatusHash("");
    setBridgeLookupStatus("loading");
    setBridgeMessage("Claim USDC on Aptos in your wallet...");
    try {
      let skipClaim = false;
      try {
        const claimPayload = buildAptosCctpClaimPayload({
          attestation: bridgeTransfer.attestation,
          messageBytes: bridgeTransfer.messageBytes,
          network: decibelNetwork,
        });
        const claimResult = await signAndSubmitTransaction({ data: claimPayload });
        setStatusHash(claimResult.hash);
        setBridgeMessage("Claim submitted. Waiting for Aptos confirmation...");
        await waitForTransactionConfirmation(claimResult.hash);
      } catch (claimErr) {
        const claimMessage =
          claimErr instanceof Error ? claimErr.message : String(claimErr);
        if (
          claimMessage.toLowerCase().includes("nonce") ||
          claimMessage.toLowerCase().includes("already")
        ) {
          skipClaim = true;
          setBridgeMessage("Transfer appears already claimed. Depositing available USDC...");
        } else {
          throw claimErr;
        }
      }

      if (!skipClaim) {
        setBridgeMessage("Claim confirmed. Depositing USDC to Decibel...");
      }

      const raw = String(Math.floor(bridgeTransfer.amount * 1_000_000));
      const { hash } = await buildAndSign(
        "/api/decibel/deposit",
        { subaccount: selectedSubaccount, amount: raw, network: decibelNetwork },
        signAndSubmitTransaction
      );
      setStatusHash(hash);
      setBridgeMessage("Deposit submitted. Waiting for Decibel confirmation...");
      await waitForTransactionConfirmation(hash);
      emitDecibelPositionsRefresh();
      void refreshAccountState();
      void refreshWalletUsdcBalance();
      setBridgeTransfer((current) =>
        current ? { ...current, status: "completed" } : current
      );
      setBridgeLookupStatus("success");
      setBridgeMessage("USDC claimed on Aptos and deposited to Decibel.");
      setStatus("success");
      setStatusMessage("USDC claimed and deposited to Decibel.");
    } catch (err) {
      setStatus("error");
      setBridgeLookupStatus("error");
      setBridgeMessage(
        err instanceof Error ? err.message : "Claim and deposit failed."
      );
    }
  }, [
    account,
    bridgeTransfer,
    bridgeMintRecipientMismatch,
    connected,
    decibelNetwork,
    refreshAccountState,
    refreshWalletUsdcBalance,
    selectedSubaccount,
    signAndSubmitTransaction,
    subaccounts,
  ]);

  const handleStartEvmBridge = useCallback(async () => {
    if (!connected || !account) {
      setBridgeLookupStatus("error");
      setBridgeMessage("Connect Rainbow, MetaMask, or Coinbase Wallet before bridging.");
      return;
    }
    if (!hasDecibelAccount) {
      setBridgeLookupStatus("error");
      setBridgeMessage("Create or select a Decibel trading account before bridging.");
      return;
    }
    if (!isEvmWallet) {
      setBridgeLookupStatus("error");
      setBridgeMessage("Connect an EVM wallet like Rainbow or MetaMask to start an EVM bridge here.");
      return;
    }
    if (!hasDepositAmount) {
      setBridgeLookupStatus("error");
      setBridgeMessage("Enter a USDC amount before bridging.");
      return;
    }
    if (depositExceedsEvmSource) {
      setBridgeLookupStatus("error");
      setBridgeMessage(`${bridgeSourceChain} USDC balance is too low for this bridge.`);
      return;
    }

    setStatus("submitting");
    setStatusHash("");
    setBridgeLookupStatus("loading");
    setBridgeMessage(`Start ${bridgeSourceChain} USDC bridge in your wallet...`);
    try {
      const result = await startEvmCctpDeposit({
        amount: depositValue,
        aptosRecipientAddress: account.address.toString(),
        network: decibelNetwork,
        preferredWalletName: wallet?.name,
        sourceChain: bridgeSourceChain,
        onStep: setBridgeMessage,
      });

      setBridgeTxHash(result.txHash);
      setBridgeTransfer({
        amount: depositValue,
        destinationChain: "Aptos",
        destinationIsAptos: true,
        explorerUrl: result.explorerUrl,
        sourceChain: result.sourceChain,
        status: "pending",
        txHash: result.txHash,
      });
      setBridgeLookupStatus("success");
      setBridgeMessage("Source transfer confirmed. Waiting for Circle attestation...");
      setStatus("success");
      setStatusMessage("CCTP bridge started. Claim and deposit when Circle attests.");
      void lookupBridgeTransfer({
        silent: true,
        sourceChain: result.sourceChain,
        txHash: result.txHash,
      });
    } catch (err) {
      setStatus("error");
      setBridgeLookupStatus("error");
      setBridgeMessage(
        err instanceof Error ? err.message : "Could not start the EVM bridge transfer."
      );
    }
  }, [
    account,
    bridgeSourceChain,
    connected,
    decibelNetwork,
    depositExceedsEvmSource,
    depositValue,
    hasDecibelAccount,
    hasDepositAmount,
    isEvmWallet,
    lookupBridgeTransfer,
    wallet?.name,
  ]);

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
      void refreshWalletUsdcBalance();
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
    if (depositExceedsWallet) {
      setStatusMessage("Deposit amount exceeds wallet USDC balance.");
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
      void refreshWalletUsdcBalance();
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
    depositExceedsWallet,
    hasDepositAmount,
    refreshAccountState,
    refreshWalletUsdcBalance,
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

      <div className="space-y-1.5">
        <div className="flex min-h-4 items-center justify-between gap-3 px-1 font-mono text-[10px] tabular-nums text-zinc-600">
          <span className={walletUsdcError ? "text-yellow-300/80" : ""}>
            Wallet{" "}
            {walletUsdcLoading
              ? "..."
              : walletUsdcBalance !== null
                ? `${walletUsdcBalance.toLocaleString("en-US", {
                    maximumFractionDigits: 6,
                  })} USDC`
                : "-- USDC"}
          </span>
          <button
            type="button"
            onClick={() => {
              if (walletUsdcBalance !== null) {
                setDepositAmount(formatDepositInputAmount(walletUsdcBalance));
              }
            }}
            disabled={walletUsdcBalance === null || walletUsdcBalance <= 0 || status === "submitting"}
            className="text-accent/80 transition-colors hover:text-accent disabled:cursor-not-allowed disabled:text-zinc-700"
          >
            Max
          </button>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <label className="flex min-w-0 items-center gap-2 rounded-md bg-white/[0.03] px-3 py-2">
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
      </div>

      {connected && hasDecibelAccount && (
        <div className="border-t border-white/[0.06] pt-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-display font-semibold uppercase tracking-[0.16em] text-zinc-600">
                Cross-chain USDC
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 text-pretty">
                Bridge native USDC from EVM with Circle CCTP, or paste an existing
                transfer hash to claim and deposit.
              </p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-md px-2 py-1 text-[10px] font-mono",
                isEvmWallet
                  ? "bg-accent/10 text-accent"
                  : "bg-white/[0.04] text-zinc-500"
              )}
            >
              {isEvmWallet ? `${wallet?.name ?? "EVM"} detected` : "Optional"}
            </span>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1 rounded-md bg-white/[0.03] p-1">
            {BRIDGE_SOURCE_CHAINS.map((chain) => (
              <button
                key={chain}
                type="button"
                onClick={() => setBridgeSourceChain(chain)}
                className={cn(
                  "rounded px-2 py-1.5 text-[10px] font-display font-semibold transition-colors",
                  bridgeSourceChain === chain
                    ? "bg-white/[0.08] text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {chain}
              </button>
            ))}
          </div>

          <div className="mt-2 flex min-h-4 items-center justify-between gap-3 px-1 font-mono text-[10px] tabular-nums text-zinc-600">
            <span className={evmSourceError ? "text-yellow-300/80" : ""}>
              {bridgeSourceChain}{" "}
              {evmSourceLoading
                ? "..."
                : evmSourceBalance !== null
                  ? `${evmSourceBalance.toLocaleString("en-US", {
                      maximumFractionDigits: 6,
                    })} USDC`
                  : "-- USDC"}
            </span>
            {evmSourceAddress && (
              <span className="truncate text-zinc-700">
                {evmSourceAddress.slice(0, 6)}...{evmSourceAddress.slice(-4)}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleStartEvmBridge()}
            disabled={!canStartEvmBridge}
            className={cn(
              "mt-2 w-full rounded-md px-3 py-2 text-[11px] font-display font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              canStartEvmBridge
                ? "bg-accent/15 text-accent hover:bg-accent/20"
                : "bg-white/[0.03] text-zinc-600"
            )}
          >
            {status === "submitting"
              ? "Bridge pending..."
              : isEvmWallet
                ? `Bridge from ${bridgeSourceChain}`
                : "Connect EVM wallet to bridge"}
          </button>

          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <input
              type="text"
              value={bridgeTxHash}
              onChange={(e) => {
                setBridgeTxHash(e.target.value.trim());
                setBridgeTransfer(null);
                setBridgeLookupStatus("idle");
                setBridgeMessage("");
              }}
              className="min-w-0 rounded-md bg-white/[0.03] px-3 py-2 text-[11px] font-mono text-zinc-200 outline-none placeholder:text-zinc-700 focus:bg-white/[0.06]"
              placeholder="0x... transfer hash"
            />
            <button
              type="button"
              onClick={() => void lookupBridgeTransfer()}
              disabled={bridgeLookupStatus === "loading"}
              className="rounded-md bg-white/[0.06] px-3 py-2 text-[11px] font-display font-semibold text-zinc-200 transition-colors hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {bridgeLookupStatus === "loading" ? "Checking" : "Resume"}
            </button>
          </div>

          {bridgeTransfer && (
            <div className="mt-2 space-y-2 rounded-[10px] bg-white/[0.03] px-3 py-2 text-[11px] text-zinc-400">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-zinc-500">
                  {bridgeTransfer.status === "claimable"
                    ? "Ready to claim"
                    : bridgeTransfer.status === "completed"
                      ? "Completed"
                    : "Bridging funds"}
                </span>
                <span className="font-mono tabular-nums text-zinc-100">
                  {typeof bridgeTransfer.amount === "number"
                    ? `${bridgeTransfer.amount.toLocaleString("en-US", {
                        maximumFractionDigits: 6,
                      })} USDC`
                    : "-- USDC"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>{bridgeTransfer.sourceChain ?? bridgeSourceChain} to Aptos</span>
                {bridgeTransfer.explorerUrl && (
                  <a
                    href={bridgeTransfer.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline"
                  >
                    Source tx
                  </a>
                )}
              </div>
              {!bridgeTransfer.destinationIsAptos && (
                <p className="text-yellow-300">
                  This CCTP transfer does not appear to target Aptos.
                </p>
              )}
              {bridgeMintRecipientMismatch && (
                <p className="text-yellow-300">
                  Mint recipient is {shortAddress(bridgeTransfer.mintRecipient ?? "")};
                  this wallet is {shortAddress(account?.address.toString() ?? "")}.
                </p>
              )}
              {bridgeTransfer.status === "claimable" && (
                <button
                  type="button"
                  onClick={() => void handleClaimBridgeTransfer()}
                  disabled={status === "submitting" || bridgeMintRecipientMismatch}
                  className="w-full rounded-md bg-accent/15 px-3 py-2 text-[11px] font-display font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {status === "submitting" ? "Working..." : "Claim & Deposit"}
                </button>
              )}
            </div>
          )}

          {bridgeMessage && (
            <p
              className={cn(
                "mt-2 text-[11px] leading-relaxed text-pretty",
                bridgeLookupStatus === "error" ? "text-red-300" : "text-zinc-500"
              )}
            >
              {bridgeMessage}
            </p>
          )}
        </div>
      )}

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
