"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { explorerTxUrl } from "@/lib/constants";
import {
  buildAndSign,
  buildAndSignSponsored,
  signAndSubmitSponsored,
  waitForTransactionConfirmation,
} from "@/lib/tx-utils";
import { cn } from "@/lib/utils";
import { PRESSABLE_CONTROL } from "@/lib/surface";
import { PRODUCT_CONTROL_CLASS, ProductSegmented } from "@/components/ui/product-surface";
import { emitDecibelPositionsRefresh } from "@/lib/decibel-selection";
import { getChainFromWallet } from "@/lib/wallet-utils";
import { walletNetworkMismatchMessage } from "@/lib/wallet-network";
import {
  EVM_SOURCE_CHAIN_STORAGE_KEY,
  fetchEvmUsdcBalance,
  startEvmCctpDeposit,
  storeEvmSourceChain,
  type EvmCctpSourceChain,
} from "@/lib/evm-cctp";
import {
  DECIBEL_APP_DERIVED_DOMAIN,
  DECIBEL_APP_DERIVED_URI,
  deriveEvmAptosAddress,
  needsSponsoredGas,
  submitEvmDerivedAptosPayload,
} from "@/lib/evm-derived-aptos";
import { NumberTicker } from "@/components/ui/number-ticker";
import {
  shortAddress,
  useDecibelSubaccounts,
} from "@/hooks/useDecibelSubaccounts";
import { useDecibelTransactionSubmitter } from "@/hooks/useDecibelTransactionSubmitter";
import { TokenLogo } from "@/components/trade/StablecoinLogo";
import { useEvmSourceChain } from "@/hooks/useEvmSourceChain";
import { fetchSolanaUsdcBalance, getSolanaAddressFromPublicKey } from "@/lib/solana-usdc";
import { ensureBuilderApproval } from "@/lib/decibel-builder-approval";
import {
  buildDepositForBurnTransaction,
  fetchSolanaUsdcContext,
  getInjectedSolanaProvider,
  signAndSendWithProvider,
} from "@/lib/solana-cctp";

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

// Solana is claim-only: the burn happens in an external CCTP bridge signed by
// the Solana wallet, then the transfer hash is pasted here — the status and
// claim backends are already domain-generic (Solana is CCTP domain 5).
type BridgeSourceChain = EvmCctpSourceChain | "Solana";

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

const BRIDGE_SOURCE_CHAINS: BridgeSourceChain[] = ["Arbitrum", "Base", "Ethereum", "Solana"];

async function relayAptosCctpClaim(args: {
  attestation: string;
  messageBytes: string;
  network: "mainnet" | "testnet";
}): Promise<{ alreadyClaimed: boolean; hash?: string }> {
  const res = await fetch("/api/decibel/cctp/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = (await res.json().catch(() => null)) as
    | {
        alreadyClaimed?: boolean;
        error?: string;
        hash?: string;
        vmStatus?: string;
      }
    | null;
  if (data?.alreadyClaimed) return { alreadyClaimed: true };
  if (!res.ok || !data?.hash) {
    const reason = data?.error || `Circle claim relayer failed (${res.status}).`;
    throw new Error(data?.vmStatus ? `${reason}: ${data.vmStatus}` : reason);
  }
  return { alreadyClaimed: false, hash: data.hash };
}

function formatDepositInputAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function normalizeAptosAddress(address?: string | null) {
  if (!address) return "";
  const hex = address.startsWith("0x") ? address.slice(2) : address;
  return `0x${hex.toLowerCase().padStart(64, "0")}`;
}

function safeDeriveEvmAptosAddress(evmAddress: string, domain: string) {
  try {
    return normalizeAptosAddress(
      deriveEvmAptosAddress({ domain, evmAddress })
    );
  } catch {
    return "";
  }
}

const BRIDGE_STEPS = ["Burn", "Attest", "Claim", "Deposit"] as const;

// House recipes (docs/UX-GRADING.md § 4.6): one shape for every control in the
// sheet, three fills — primary accent, outline accent, neutral.
const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
const LABEL = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const META_ROW = "flex min-h-4 items-center justify-between gap-3 px-1 font-mono text-[11px] tabular-nums text-muted-foreground";
const BTN = cn(
  PRESSABLE_CONTROL,
  FOCUS_RING,
  "inline-flex min-h-10 items-center justify-center rounded-[var(--radius-sm)] px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50",
);
const BTN_NEUTRAL = cn(BTN, "border border-white/[0.08] bg-white/[0.06] text-foreground hover:bg-white/[0.1]");
const BTN_SECONDARY = cn(BTN, "border border-accent/30 text-accent hover:bg-accent/10");
const BTN_MUTED = "bg-white/[0.06] text-muted-foreground disabled:opacity-100";
const INPUT_SHELL = cn(PRODUCT_CONTROL_CLASS, "flex min-h-10 min-w-0 items-center gap-2 px-3 focus-within:border-border-strong");
const INPUT = "min-w-0 flex-1 bg-transparent font-mono font-semibold text-foreground outline-none placeholder:text-zinc-600";
const SEGMENT = cn(
  PRESSABLE_CONTROL,
  FOCUS_RING,
  "min-h-9 rounded-[var(--radius-xs)] px-2 text-[11px] font-semibold sm:min-h-7",
);
const SKELETON = "inline-block h-4 w-16 animate-pulse rounded-full bg-white/[0.08] align-middle motion-reduce:animate-none";

/**
 * Presentational 4-step CCTP progress rail (burn → attestation → claim → deposit),
 * derived entirely from existing bridge state — no flow logic here.
 *
 * Stage mapping: a looked-up transfer means the source burn happened (step 1 done);
 * `pending` = waiting on Circle attestation (step 2 active); `claimable` = claim ready
 * (step 3) and, while submitting, the deposit phase is detected from the status text;
 * `completed` = all done.
 */
function BridgeStepsRail({
  transferStatus,
  submitting,
  message,
  errored,
}: {
  transferStatus: "pending" | "claimable" | "completed";
  submitting: boolean;
  message: string;
  errored: boolean;
}) {
  const depositPhase = submitting && /deposit/i.test(message);
  const activeIndex =
    transferStatus === "completed" ? 4
    : transferStatus === "pending" ? 1
    : depositPhase ? 3
    : 2;

  return (
    <ol className="flex items-center gap-1.5 pb-1" aria-label="Bridge progress">
      {BRIDGE_STEPS.map((label, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <li
            key={label}
            className="flex min-w-0 flex-1 items-center gap-1.5"
            aria-current={active ? "step" : undefined}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold",
                done && "bg-accent/20 text-accent",
                active && !errored && "bg-accent text-accent-foreground",
                active && errored && "bg-danger text-white",
                !done && !active && "bg-white/[0.06] text-zinc-500",
              )}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={cn(
                "truncate font-mono text-[11px] uppercase tracking-wide",
                done && "text-accent/80",
                active && !errored && "text-foreground",
                active && errored && "text-danger",
                !done && !active && "text-zinc-500",
              )}
            >
              {label}
            </span>
            {i < BRIDGE_STEPS.length - 1 && (
              <span className={cn("h-px flex-1", i < activeIndex ? "bg-accent/30" : "bg-white/[0.07]")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function DecibelAccountManager({ className }: { className?: string }) {
  const { account, connected, network: walletNetwork, signAndSubmitTransaction, signTransaction, wallet } = useWallet();
  const { signAndSubmitDecibelTransaction } = useDecibelTransactionSubmitter();
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
  const [solanaSourceBalance, setSolanaSourceBalance] = useState<number | null>(null);
  const [solanaSourceLoading, setSolanaSourceLoading] = useState(false);
  const [solanaBridging, setSolanaBridging] = useState(false);
  const [solanaBalanceNonce, setSolanaBalanceNonce] = useState(0);
  const [solanaBridgeAmount, setSolanaBridgeAmount] = useState("");
  const [bridgeTransfer, setBridgeTransfer] =
    useState<CctpStatusResponse | null>(null);
  const [bridgeLookupStatus, setBridgeLookupStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [bridgeMessage, setBridgeMessage] = useState("");
  const [hydratedBridgeStorageKey, setHydratedBridgeStorageKey] = useState("");
  const [evmSourceBalance, setEvmSourceBalance] = useState<number | null>(null);
  const [evmSourceAddress, setEvmSourceAddress] = useState("");
  const [evmSourceLoading, setEvmSourceLoading] = useState(false);
  const [evmSourceError, setEvmSourceError] = useState("");
  const {
    decibelNetwork,
    hasDecibelAccount,
    isLoadingSubaccounts,
    lookupIncomplete,
    originAddress,
    owner,
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
  const activeEvmSourceChain = useEvmSourceChain({
    enabled: connected && isEvmWallet,
    preferredWalletName: wallet?.name,
  });
  const connectedAptosAddress = normalizeAptosAddress(account?.address.toString());
  const bridgeMintRecipient = normalizeAptosAddress(bridgeTransfer?.mintRecipient);
  const bridgeMintRecipientMismatch =
    !!bridgeMintRecipient &&
    !!connectedAptosAddress &&
    bridgeMintRecipient !== connectedAptosAddress;
  const decibelAppDerivedAddress = evmSourceAddress
    ? safeDeriveEvmAptosAddress(evmSourceAddress, DECIBEL_APP_DERIVED_DOMAIN)
    : "";
  const bridgeMatchesDecibelAppDerivedAccount =
    bridgeMintRecipientMismatch &&
    !!bridgeMintRecipient &&
    !!decibelAppDerivedAddress &&
    bridgeMintRecipient === decibelAppDerivedAddress;
  const bridgeStorageKey =
    connected && owner
      ? `cash:decibel:cctp-deposit:${decibelNetwork}:${owner}`
      : "";
  const activeActionTokenRef = useRef<symbol | null>(null);
  const accountActionContext = `${owner}:${decibelNetwork}:${wallet?.name ?? ""}`;
  const accountActionContextRef = useRef(accountActionContext);
  accountActionContextRef.current = accountActionContext;

  const beginAccountAction = () => {
    if (activeActionTokenRef.current) return null;
    const token = Symbol("decibel-account-action");
    activeActionTokenRef.current = token;
    return { token, context: accountActionContextRef.current };
  };
  const isCurrentAccountAction = (action: { token: symbol; context: string }) =>
    activeActionTokenRef.current === action.token
    && accountActionContextRef.current === action.context;
  const finishAccountAction = (action: { token: symbol }) => {
    if (activeActionTokenRef.current === action.token) {
      activeActionTokenRef.current = null;
    }
  };

  const selectBridgeSourceChain = useCallback((chain: BridgeSourceChain) => {
    setBridgeSourceChain(chain);
    // Solana is claim-only; the stored preference tracks the EVM burn source.
    if (chain !== "Solana") storeEvmSourceChain(chain);
  }, []);

  useEffect(() => {
    if (activeEvmSourceChain) selectBridgeSourceChain(activeEvmSourceChain);
  }, [activeEvmSourceChain, selectBridgeSourceChain]);

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

  useEffect(() => {
    activeActionTokenRef.current = null;
    setStatus("idle");
    setStatusMessage("");
    setStatusHash("");
  }, [accountActionContext]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(EVM_SOURCE_CHAIN_STORAGE_KEY) as BridgeSourceChain | null;
      if (saved && BRIDGE_SOURCE_CHAINS.includes(saved)) setBridgeSourceChain(saved);
    } catch {
      // Keep the default source chain when storage is unavailable.
    }
  }, []);
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
    ? "bg-success/10 text-success"
    : isLoadingSubaccounts
      ? "bg-white/[0.04] text-zinc-400"
      : lookupIncomplete
        ? "bg-warning/10 text-warning"
    : connected
      ? "bg-accent/10 text-accent"
      : "bg-white/[0.04] text-zinc-500";

  // Only when there is something to do: "Ready" and "Checking" are already
  // said by the badge, so a sentence under them was noise.
  const accountHelpText = !connected
    ? "Connect a wallet to create a Decibel trading account."
    : lookupIncomplete
      ? "Could not verify this wallet's Decibel trading accounts. Refresh or reconnect the wallet."
      : isMainnet
        ? "Mainnet account creation requires a Decibel referrer or allowlist entry. Refresh if this wallet already has an account."
      : "Create one Decibel trading account before depositing collateral or placing orders.";
  const showAccountHelp = !hasDecibelAccount && !isLoadingSubaccounts;

  const canCreateAccount =
    connected &&
    !hasDecibelAccount &&
    !isLoadingSubaccounts &&
    !lookupIncomplete &&
    status !== "submitting";

  useEffect(() => {
    setHydratedBridgeStorageKey("");
    setBridgeTxHash("");
    setBridgeTransfer(null);
    setBridgeLookupStatus("idle");
    setBridgeMessage("");
    if (!bridgeStorageKey) return;
    try {
      const saved = window.localStorage.getItem(bridgeStorageKey);
      if (saved) {
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
      }
    } catch {
      window.localStorage.removeItem(bridgeStorageKey);
    } finally {
      setHydratedBridgeStorageKey(bridgeStorageKey);
    }
  }, [bridgeStorageKey]);

  useEffect(() => {
    if (
      !bridgeStorageKey
      || hydratedBridgeStorageKey !== bridgeStorageKey
      || !bridgeTxHash
    ) return;
    window.localStorage.setItem(
      bridgeStorageKey,
      JSON.stringify({
        sourceChain: bridgeSourceChain,
        txHash: bridgeTxHash,
        transfer: bridgeTransfer,
      })
    );
  }, [bridgeSourceChain, bridgeStorageKey, bridgeTransfer, bridgeTxHash, hydratedBridgeStorageKey]);

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
        address: owner,
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
  }, [connected, decibelNetwork, owner]);

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

  // Solana-derived connection: read the Solana-side USDC so the UI can show
  // the money the user actually holds instead of a bare "Wallet 0 USDC".
  const solanaOriginAddress = getSolanaAddressFromPublicKey(account?.publicKey);
  const isSolanaWallet = Boolean(solanaOriginAddress);

  useEffect(() => {
    if (!connected || !solanaOriginAddress) {
      setSolanaSourceBalance(null);
      setSolanaSourceLoading(false);
      return;
    }
    const controller = new AbortController();
    setSolanaSourceLoading(true);
    fetchSolanaUsdcBalance(solanaOriginAddress, controller.signal)
      .then((balance) => {
        if (!controller.signal.aborted) setSolanaSourceBalance(balance);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSolanaSourceBalance(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSolanaSourceLoading(false);
      });
    return () => controller.abort();
  }, [connected, solanaOriginAddress, solanaBalanceNonce]);

  // A Solana wallet's only bridge path is the Solana tab — preselect it.
  useEffect(() => {
    if (isSolanaWallet) setBridgeSourceChain("Solana");
  }, [isSolanaWallet]);

  useEffect(() => {
    let active = true;
    if (!connected || !account || !isEvmWallet || bridgeSourceChain === "Solana") {
      setEvmSourceBalance(null);
      setEvmSourceAddress("");
      setEvmSourceError("");
      setEvmSourceLoading(false);
      return;
    }

    setEvmSourceAddress(originAddress);
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
        setEvmSourceAddress(result?.address ?? originAddress);
      })
      .catch((err) => {
        if (!active) return;
        setEvmSourceBalance(null);
        setEvmSourceAddress(originAddress);
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
    isEvmWallet,
    originAddress,
    wallet?.name,
  ]);

  const handleRefreshAccount = useCallback(() => {
    void refreshSubaccounts();
    void refreshAccountState();
    void refreshWalletUsdcBalance();
  }, [refreshAccountState, refreshSubaccounts, refreshWalletUsdcBalance]);

  // lookupBridgeTransfer is declared below; the burn handler fires it after
  // submission without creating a circular useCallback dependency.
  /**
   * Fee-routing consent, chained onto setup signatures (account creation and
   * deposits) where the user is already signing — so the trade flow itself
   * never grows an extra prompt. Quiet failure: the first trade still has the
   * ensureBuilderApproval fallback.
   */
  const approveBuilderDuringSetup = useCallback((subaccountOverride?: string) => {
    const target = subaccountOverride ?? selectedSubaccount;
    if (!target) return;
    void ensureBuilderApproval({
      subaccount: target,
      network: decibelNetwork,
      signAndSubmit: signAndSubmitDecibelTransaction as never,
      onStep: (message) => setStatusMessage(message),
    });
  }, [decibelNetwork, selectedSubaccount, signAndSubmitDecibelTransaction]);

  const lookupBridgeTransferRef = useRef<
    ((options?: { silent?: boolean; sourceChain?: BridgeSourceChain; txHash?: string }) => Promise<void>) | null
  >(null);

  /**
   * One-click Solana → Aptos: build Circle's deposit_for_burn ourselves, have
   * the injected Solana wallet sign it in place, then hand the signature to
   * the existing attestation → claim → deposit rail. Transaction construction
   * is mainnet-simulation-verified (see lib/solana-cctp.ts).
   */
  const handleStartSolanaBridge = useCallback(async () => {
    if (!solanaOriginAddress || solanaBridging) return;
    const provider = getInjectedSolanaProvider();
    if (!provider) {
      setBridgeLookupStatus("error");
      setBridgeMessage(
        "No Solana wallet found in this browser. Open cash.trading inside Backpack (or another Solana wallet app) to sign the bridge.",
      );
      return;
    }
    setSolanaBridging(true);
    setBridgeLookupStatus("idle");
    setBridgeMessage("Preparing the Solana bridge transaction...");
    try {
      const context = await fetchSolanaUsdcContext(solanaOriginAddress);
      if (!context.tokenAccount || context.balance <= 0) {
        throw new Error("No USDC found in this Solana wallet.");
      }
      if (!context.blockhash) throw new Error("Could not fetch a Solana blockhash.");
      const typed = Number(solanaBridgeAmount);
      const requested = Number.isFinite(typed) && typed > 0
        ? Math.min(typed, context.balance)
        : context.balance;
      const amountBaseUnits = BigInt(Math.round(requested * 1_000_000));
      if (amountBaseUnits <= 0n) throw new Error("Bridge amount is too small.");

      const { transaction } = await buildDepositForBurnTransaction({
        owner: solanaOriginAddress,
        tokenAccount: context.tokenAccount,
        amountBaseUnits,
        aptosRecipient: owner,
        blockhash: context.blockhash,
      });
      setBridgeMessage("Confirm the bridge in your wallet...");
      const signature = await signAndSendWithProvider(provider, transaction);

      // Hand off to the existing rail: persistence, polling, claim, deposit.
      setBridgeTxHash(signature);
      setBridgeTransfer(null);
      setBridgeMessage("Burn submitted on Solana. Waiting for Circle attestation...");
      setBridgeLookupStatus("loading");
      window.setTimeout(() => {
        void lookupBridgeTransferRef.current?.({ txHash: signature, sourceChain: "Solana" });
      }, 4_000);
    } catch (err) {
      setBridgeLookupStatus("error");
      setBridgeMessage(
        err instanceof Error ? err.message : "Solana bridge failed before submission.",
      );
    } finally {
      setSolanaBridging(false);
    }
  }, [owner, solanaBridgeAmount, solanaBridging, solanaOriginAddress]);

  const lookupBridgeTransfer = useCallback(
    async (options?: {
      silent?: boolean;
      sourceChain?: BridgeSourceChain;
      txHash?: string;
    }) => {
      const lookupContext = accountActionContextRef.current;
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
        if (accountActionContextRef.current !== lookupContext) return;
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
        if (accountActionContextRef.current !== lookupContext) return;
        if (options?.silent) return;
        setBridgeLookupStatus("error");
        setBridgeMessage(
          err instanceof Error ? err.message : "Could not look up the bridge transfer."
        );
      }
    },
    [bridgeSourceChain, bridgeTxHash, decibelNetwork]
  );
  lookupBridgeTransferRef.current = lookupBridgeTransfer;

  useEffect(() => {
    if (bridgeTransfer?.status !== "pending" || !bridgeTxHash) return;
    const timer = window.setInterval(() => {
      void lookupBridgeTransfer({ silent: true });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [bridgeTransfer?.status, bridgeTxHash, lookupBridgeTransfer]);

  // Auto-discover pending bridge transfers from the connected EVM wallet —
  // scans DepositForBurn events by depositor on the source chains, so the
  // user never has to paste a tx hash (parity with Decibel's own resume UX).
  // Best-effort: failures stay silent and the manual hash field still works.
  const autoDiscoverKeyRef = useRef("");
  useEffect(() => {
    const discoveryAddress = originAddress.toLowerCase();
    if (!isEvmWallet || !discoveryAddress) return;
    if (bridgeTransfer || bridgeTxHash.trim()) return;
    const scanKey = `${discoveryAddress}:${decibelNetwork}`;
    if (autoDiscoverKeyRef.current === scanKey) return;
    autoDiscoverKeyRef.current = scanKey;

    let active = true;
    (async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const params = new URLSearchParams({
            address: discoveryAddress,
            network: decibelNetwork,
          });
          const res = await fetch(`/api/decibel/cctp/discover?${params.toString()}`, {
            cache: "no-store",
          });
          const data = (await res.json()) as {
            burns?: Array<{ sourceChain: BridgeSourceChain; txHash: string }>;
            errors?: Record<string, string>;
          };
          if (!active) return;
          if (res.ok && data.burns?.length) {
            const latest = data.burns[0];
            setBridgeSourceChain(latest.sourceChain);
            setBridgeTxHash(latest.txHash);
            void lookupBridgeTransfer({
              silent: true,
              sourceChain: latest.sourceChain,
              txHash: latest.txHash,
            });
            return;
          }
          const scanWasIncomplete = Boolean(data.errors && Object.keys(data.errors).length > 0);
          if (!scanWasIncomplete || attempt === 1) return;
        } catch {
          if (attempt === 1) return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_250));
      }
    })();
    return () => {
      active = false;
    };
  }, [
    bridgeTransfer,
    bridgeTxHash,
    decibelNetwork,
    isEvmWallet,
    lookupBridgeTransfer,
    originAddress,
  ]);

  const handleClaimBridgeTransfer = useCallback(async () => {
    if (activeActionTokenRef.current) return;
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

    const action = beginAccountAction();
    if (!action) return;
    setStatus("submitting");
    setStatusHash("");
    setBridgeLookupStatus("loading");
    setBridgeMessage("Claim USDC on Aptos in your wallet...");
    try {
      // Freshly derived accounts that only ever received bridged USDC hold
      // zero APT, so claim/deposit gas must come from the server fee-payer.
      const senderAddress = account.address.toString();
      const sponsored = await needsSponsoredGas(senderAddress);
      if (!isCurrentAccountAction(action)) return;
      if (sponsored) {
        setBridgeMessage("Wallet has no APT for gas — using sponsored submission...");
      }
      setBridgeMessage("Relaying the Circle claim on Aptos...");
      const claimResult = await relayAptosCctpClaim({
        attestation: bridgeTransfer.attestation,
        messageBytes: bridgeTransfer.messageBytes,
        network: decibelNetwork,
      });
      if (!isCurrentAccountAction(action)) return;
      const skipClaim = claimResult.alreadyClaimed;
      if (claimResult.hash) {
        setStatusHash(claimResult.hash);
        setBridgeMessage("Claim submitted. Waiting for Aptos confirmation...");
        await waitForTransactionConfirmation(claimResult.hash);
        if (!isCurrentAccountAction(action)) return;
      } else {
        setBridgeMessage("Transfer is already claimed. Depositing available USDC...");
      }

      if (!skipClaim) {
        setBridgeMessage("Claim confirmed. Depositing USDC to Decibel...");
      }

      const raw = String(Math.floor(bridgeTransfer.amount * 1_000_000));
      const { hash } = sponsored
        ? await buildAndSignSponsored(
            "/api/decibel/deposit",
            { subaccount: selectedSubaccount, amount: raw, network: decibelNetwork },
            {
              senderAddress,
              signTransaction,
              shouldSign: () => isCurrentAccountAction(action),
            },
          )
        : await buildAndSign(
            "/api/decibel/deposit",
            { subaccount: selectedSubaccount, amount: raw, network: decibelNetwork },
            signAndSubmitTransaction,
            () => isCurrentAccountAction(action),
          );
      if (!isCurrentAccountAction(action)) return;
      setStatusHash(hash);
      setBridgeMessage("Deposit submitted. Waiting for Decibel confirmation...");
      await waitForTransactionConfirmation(hash);
      if (!isCurrentAccountAction(action)) return;
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
      approveBuilderDuringSetup();
    } catch (err) {
      if (!isCurrentAccountAction(action)) return;
      setStatus("error");
      setBridgeLookupStatus("error");
      setBridgeMessage(
        err instanceof Error ? err.message : "Claim and deposit failed."
      );
    } finally {
      finishAccountAction(action);
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
    signTransaction,
    subaccounts,
  ]);

  const handleClaimDecibelAppBridgeTransfer = useCallback(async () => {
    if (activeActionTokenRef.current) return;
    if (!connected) {
      setBridgeLookupStatus("error");
      setBridgeMessage("Connect the EVM wallet that started this Decibel bridge transfer.");
      return;
    }
    if (!selectedSubaccount || !subaccounts.some((s) => s.address === selectedSubaccount)) {
      setBridgeLookupStatus("error");
      setBridgeMessage("Select a cash.trading Decibel account to receive this deposit.");
      return;
    }
    if (!bridgeMatchesDecibelAppDerivedAccount || !bridgeTransfer?.mintRecipient) {
      setBridgeLookupStatus("error");
      setBridgeMessage("This transfer does not match the connected app.decibel.trade derived account.");
      return;
    }
    if (
      !bridgeTransfer.messageBytes ||
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

    const action = beginAccountAction();
    if (!action) return;
    setStatus("submitting");
    setStatusHash("");
    setBridgeLookupStatus("loading");
    setBridgeMessage("Relaying the Circle claim on Aptos...");
    try {
      // Circle messages with an empty destination caller are permissionless:
      // the relayer can execute the Move script while Circle still mints to
      // the recipient encoded in the signed message. This avoids asking an
      // EVM-derived Aptos account to sign an unsupported script payload.
      const claimResult = await relayAptosCctpClaim({
        attestation: bridgeTransfer.attestation,
        messageBytes: bridgeTransfer.messageBytes,
        network: decibelNetwork,
      });
      if (!isCurrentAccountAction(action)) return;
      const skipClaim = claimResult.alreadyClaimed;
      if (claimResult.hash) {
        setStatusHash(claimResult.hash);
        setBridgeMessage("Claim submitted. Waiting for Aptos confirmation...");
        await waitForTransactionConfirmation(claimResult.hash);
        if (!isCurrentAccountAction(action)) return;
      } else {
        setBridgeMessage("Transfer is already claimed. Preparing the Decibel deposit...");
      }

      if (!skipClaim) {
        setBridgeMessage("Claim confirmed. Depositing USDC to cash.trading Decibel account...");
      }

      // The deposit is an entry function, which the EVM-derived account can
      // authenticate. Sponsor only this wallet-signed Decibel action when the
      // derived account has no APT of its own.
      const sponsored = await needsSponsoredGas(bridgeTransfer.mintRecipient);
      if (!isCurrentAccountAction(action)) return;
      if (sponsored) {
        setBridgeMessage("USDC is claimed. Using sponsored gas for the Decibel deposit...");
      }

      const raw = String(Math.floor(bridgeTransfer.amount * 1_000_000));
      const depositRes = await fetch("/api/decibel/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: raw,
          network: decibelNetwork,
          subaccount: selectedSubaccount,
        }),
      });
      const depositJson = await depositRes.json();
      if (!isCurrentAccountAction(action)) return;
      if (!depositRes.ok || depositJson.error || !depositJson.payload) {
        throw new Error(depositJson.error || "Failed to build Decibel deposit transaction.");
      }

      const depositResult = await submitEvmDerivedAptosPayload({
        domain: DECIBEL_APP_DERIVED_DOMAIN,
        expectedSenderAddress: bridgeTransfer.mintRecipient,
        payload: depositJson.payload,
        preferredWalletName: wallet?.name,
        sponsored,
        uri: DECIBEL_APP_DERIVED_URI,
        onStep: (message) => {
          if (isCurrentAccountAction(action)) setBridgeMessage(message);
        },
      });
      if (!isCurrentAccountAction(action)) return;
      setStatusHash(depositResult.hash);
      setBridgeMessage("Deposit submitted. Waiting for Decibel confirmation...");
      await waitForTransactionConfirmation(depositResult.hash);
      if (!isCurrentAccountAction(action)) return;
      emitDecibelPositionsRefresh();
      void refreshAccountState();
      void refreshWalletUsdcBalance();
      setBridgeTransfer((current) =>
        current ? { ...current, status: "completed" } : current
      );
      setBridgeLookupStatus("success");
      setBridgeMessage("USDC claimed from the Decibel app transfer and deposited to cash.trading.");
      setStatus("success");
      setStatusMessage("Decibel app bridge claimed and deposited.");
    } catch (err) {
      if (!isCurrentAccountAction(action)) return;
      setStatus("error");
      setBridgeLookupStatus("error");
      setBridgeMessage(
        err instanceof Error
          ? err.message
          : "Could not claim and deposit the Decibel app transfer."
      );
    } finally {
      finishAccountAction(action);
    }
  }, [
    bridgeMatchesDecibelAppDerivedAccount,
    bridgeTransfer,
    connected,
    decibelNetwork,
    refreshAccountState,
    refreshWalletUsdcBalance,
    selectedSubaccount,
    subaccounts,
    wallet?.name,
  ]);

  const handleStartEvmBridge = useCallback(async () => {
    if (activeActionTokenRef.current) return;
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

    const action = beginAccountAction();
    if (!action) return;
    setStatus("submitting");
    setStatusHash("");
    setBridgeLookupStatus("loading");
    setBridgeMessage(`Start ${bridgeSourceChain} USDC bridge in your wallet...`);
    try {
      const result = await startEvmCctpDeposit({
        amount: depositValue,
        aptosRecipientAddress: owner,
        network: decibelNetwork,
        preferredWalletName: wallet?.name,
        // Unreachable with Solana selected — the burn button is not rendered
        // there — but the EVM burn call needs the narrowed type.
        sourceChain: bridgeSourceChain as EvmCctpSourceChain,
        onStep: (message) => {
          if (isCurrentAccountAction(action)) setBridgeMessage(message);
        },
      });
      if (!isCurrentAccountAction(action)) return;

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
      if (!isCurrentAccountAction(action)) return;
      setStatus("error");
      setBridgeLookupStatus("error");
      setBridgeMessage(
        err instanceof Error ? err.message : "Could not start the EVM bridge transfer."
      );
    } finally {
      finishAccountAction(action);
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
    owner,
    wallet?.name,
  ]);

  const handleCreateSubaccount = useCallback(async () => {
    if (activeActionTokenRef.current) return;
    if (!connected || !account) return;
    const action = beginAccountAction();
    if (!action) return;
    setStatus("submitting");
    setStatusMessage("Create a Decibel trading account in your wallet...");
    setStatusHash("");
    try {
      const current = await refreshSubaccounts();
      if (!isCurrentAccountAction(action)) return;
      if (current.length > 0) {
        setStatus("success");
        setStatusMessage("Decibel trading account already connected.");
        return;
      }
      const { hash } = await buildAndSign(
        "/api/decibel/create-subaccount",
        { owner, network: decibelNetwork },
        signAndSubmitDecibelTransaction,
        () => isCurrentAccountAction(action),
      );
      if (!isCurrentAccountAction(action)) return;
      setStatusHash(hash);
      setStatusMessage("Account transaction submitted. Waiting for confirmation...");
      await waitForTransactionConfirmation(hash);
      if (!isCurrentAccountAction(action)) return;
      setStatusMessage("Account confirmed. Refreshing Decibel account...");
      const next = await waitForSubaccounts();
      if (!isCurrentAccountAction(action)) return;
      setStatus("success");
      setStatusMessage(
        next.length > 0
          ? "Decibel trading account ready."
          : "Account confirmed. Decibel indexer may take a moment to show it."
      );
      if (next.length > 0) approveBuilderDuringSetup(next[0]?.address);
    } catch (err) {
      if (!isCurrentAccountAction(action)) return;
      const message = err instanceof Error ? err.message : "Account creation failed";
      setStatusMessage(
        decibelNetwork === "mainnet" &&
          (message.includes("EACCOUNT_WITHOUT_REFERRER_OR_IN_ALLOW_LIST") ||
            message.includes("Move abort 0xe"))
          ? "Decibel mainnet rejected account creation because this wallet is not referred or allowlisted yet. Refresh if you already created an account on Decibel."
          : message
      );
      setStatus("error");
    } finally {
      finishAccountAction(action);
    }
  }, [
    account,
    connected,
    decibelNetwork,
    owner,
    refreshSubaccounts,
    signAndSubmitDecibelTransaction,
    waitForSubaccounts,
  ]);

  const handleMintTestnetUsdc = useCallback(async () => {
    if (activeActionTokenRef.current) return;
    if (!connected || !account || isMainnet) return;
    // Hard guard: a mainnet-connected wallet cannot mint testnet USDC — the
    // module doesn't exist there and the wallet shows a raw simulation error.
    const mismatch = walletNetworkMismatchMessage(walletNetwork?.name, decibelNetwork);
    if (mismatch) {
      setStatusMessage(mismatch);
      setStatus("error");
      return;
    }
    const action = beginAccountAction();
    if (!action) return;
    setStatus("submitting");
    setStatusMessage("Mint Decibel testnet USDC in your wallet...");
    setStatusHash("");
    try {
      const { hash } = await buildAndSign(
        "/api/decibel/faucet",
        { network: decibelNetwork },
        signAndSubmitDecibelTransaction,
        () => isCurrentAccountAction(action),
      );
      if (!isCurrentAccountAction(action)) return;
      setStatusHash(hash);
      setStatusMessage("USDC mint submitted. Waiting for confirmation...");
      await waitForTransactionConfirmation(hash);
      if (!isCurrentAccountAction(action)) return;
      setStatusMessage("Decibel testnet USDC minted.");
      void refreshWalletUsdcBalance();
      setStatus("success");
    } catch (err) {
      if (!isCurrentAccountAction(action)) return;
      setStatusMessage(err instanceof Error ? err.message : "Decibel USDC mint failed");
      setStatus("error");
    } finally {
      finishAccountAction(action);
    }
  }, [account, connected, decibelNetwork, isMainnet, signAndSubmitDecibelTransaction, walletNetwork?.name]);

  const handleDeposit = useCallback(async () => {
    if (activeActionTokenRef.current) return;
    if (!connected || !account) {
      setStatusMessage("Connect wallet before depositing USDC collateral.");
      setStatus("error");
      return;
    }
    {
      // Hard guard: depositing through a wallet on the wrong network dies in
      // simulation with a raw module/account error — fail with a clear message.
      const mismatch = walletNetworkMismatchMessage(walletNetwork?.name, decibelNetwork);
      if (mismatch) {
        setStatusMessage(mismatch);
        setStatus("error");
        return;
      }
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

    const action = beginAccountAction();
    if (!action) return;
    setStatus("submitting");
    setStatusMessage(`Deposit ${depositValue.toFixed(2)} USDC collateral to Decibel...`);
    setStatusHash("");
    try {
      const raw = String(Math.floor(depositValue * 1_000_000));
      const { hash } = await buildAndSign(
        "/api/decibel/deposit",
        { subaccount: selectedSubaccount, amount: raw, network: decibelNetwork },
        signAndSubmitDecibelTransaction,
        () => isCurrentAccountAction(action),
      );
      if (!isCurrentAccountAction(action)) return;
      setStatusHash(hash);
      setStatusMessage("Deposit submitted. Waiting for confirmation...");
      await waitForTransactionConfirmation(hash);
      if (!isCurrentAccountAction(action)) return;
      emitDecibelPositionsRefresh();
      void refreshAccountState();
      void refreshWalletUsdcBalance();
      setStatusMessage("USDC collateral deposited to Decibel.");
      setStatus("success");
      approveBuilderDuringSetup();
    } catch (err) {
      if (!isCurrentAccountAction(action)) return;
      setStatusMessage(err instanceof Error ? err.message : "USDC collateral deposit failed.");
      setStatus("error");
    } finally {
      finishAccountAction(action);
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
    signAndSubmitDecibelTransaction,
    subaccounts,
    walletNetwork?.name,
  ]);

  const statsLoading = overviewLoading && !overview;
  const depositCtaLabel = hasDepositAmount
    ? `Deposit ${depositValue.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`
    : "Deposit USDC";

  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={LABEL}>Trading account</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
            {selectedSubaccountLabel}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-[var(--radius-xs)] px-2 py-1 font-mono text-[11px]",
            accountStateTone
          )}
        >
          {accountStateLabel}
        </span>
      </div>

      {showAccountHelp && (
        <p className="text-xs leading-4 text-muted-foreground text-pretty">
          {accountHelpText}
        </p>
      )}

      {connected && hasDecibelAccount && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {[
            { label: "Equity", value: overview?.equity, signed: false },
            { label: "Available USDC", value: overview?.crossWithdrawable, signed: false },
            { label: "Collateral", value: overview?.collateral, signed: false },
            {
              label: "Unrealized PnL",
              value: overview?.unrealizedPnl,
              signed: true,
              tone:
                overview?.unrealizedPnl == null
                  ? "text-foreground"
                  : overview.unrealizedPnl >= 0
                    ? "text-success"
                    : "text-danger",
            },
          ].map((item) => (
            <div key={item.label} className="min-w-0">
              <p className={LABEL}>{item.label}</p>
              <p className={cn("mt-0.5 truncate font-mono text-sm font-semibold tabular-nums text-foreground", item.tone)}>
                {statsLoading ? (
                  <span aria-hidden="true" className={SKELETON} />
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
            <p role="status" className="col-span-2 text-[11px] text-warning">
              Balance unavailable. Refresh account.
            </p>
          )}
        </div>
      )}

      {connected && hasDecibelAccount ? (
        <div className="space-y-1.5">
          <label htmlFor="decibel-active-account" className={LABEL}>
            Active account
          </label>
          <select
            id="decibel-active-account"
            value={selectedSubaccount}
            onChange={(e) => selectSubaccount(e.target.value)}
            disabled={status === "submitting"}
            className={cn(
              PRODUCT_CONTROL_CLASS,
              FOCUS_RING,
              "h-10 w-full px-3 font-mono text-xs text-foreground disabled:opacity-50",
            )}
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
        // Without an account nothing else here is actionable, so this is the
        // one filled button on screen.
        <button
          type="button"
          onClick={handleCreateSubaccount}
          className={cn(BTN, "h-11 w-full bg-accent text-sm text-accent-foreground hover:brightness-95")}
        >
          Create trading account
        </button>
      ) : null}

      <div className={cn("grid gap-2", isMainnet ? "grid-cols-1" : "grid-cols-2")}>
        <button
          type="button"
          onClick={handleRefreshAccount}
          disabled={!connected || status === "submitting" || isLoadingSubaccounts}
          className={BTN_NEUTRAL}
        >
          {isLoadingSubaccounts ? "Checking..." : "Refresh account"}
        </button>
        {!isMainnet && (
          <button
            type="button"
            onClick={handleMintTestnetUsdc}
            disabled={!connected || status === "submitting"}
            className={BTN_NEUTRAL}
          >
            Mint testnet USDC
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div className={META_ROW}>
          <span className={walletUsdcError ? "text-warning" : ""}>
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
            className={cn(
              PRESSABLE_CONTROL,
              FOCUS_RING,
              "-my-2 -mr-2 min-h-8 rounded-[var(--radius-xs)] px-2 font-semibold text-accent/80 hover:text-accent disabled:cursor-not-allowed disabled:text-zinc-600",
            )}
          >
            Max
          </button>
        </div>
        {/* Funding is the whole job of this sheet, so the deposit CTA is a
            full-width accent button under the amount rather than a small grey
            chip beside it. */}
        <label className={cn(INPUT_SHELL, "min-h-12")}>
          <TokenLogo token="USDC" size={20} />
          <input
            type="text"
            inputMode="decimal"
            aria-label="Deposit amount in USDC"
            value={depositAmount}
            onChange={(e) => {
              const next = e.target.value.replace(/[^0-9.]/g, "");
              if (next.split(".").length <= 2) setDepositAmount(next);
            }}
            className={cn(INPUT, "text-base")}
            placeholder="0.00"
          />
          <span className="font-mono text-xs text-muted-foreground">USDC</span>
        </label>
        <button
          type="button"
          onClick={handleDeposit}
          disabled={!canDeposit}
          className={cn(
            BTN,
            "h-11 w-full text-sm",
            canDeposit
              ? "bg-accent text-accent-foreground hover:brightness-95"
              : BTN_MUTED
          )}
        >
          {depositCtaLabel}
        </button>
        {/* A silently disabled button reads as broken. Say why: the usual case
            is a wallet whose funds live on another chain (Solana/EVM) while
            deposits move USDC that already sits on Aptos at this address. */}
        {hasDepositAmount && depositExceedsWallet && (
          <p className="px-1 text-[11px] leading-4 text-warning">
            {walletUsdcBalance === 0
              ? isSolanaWallet && solanaSourceBalance
                ? "Your USDC is on Solana — bridge it below first."
                : "No USDC on Aptos yet — send some to this address, or bridge below."
              : `Amount exceeds this wallet's Aptos USDC balance (${walletUsdcBalance?.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDC).`}
          </p>
        )}
      </div>

      {connected && hasDecibelAccount && (
        <div className="space-y-2 border-t border-card-border pt-4">
          <p className={LABEL}>Bridge USDC</p>
          {isSolanaWallet && (
            <p className="text-[11px] leading-4 text-muted-foreground">
              One signature. Claim and deposit run automatically, gas covered.
            </p>
          )}

          {!isSolanaWallet && (
            <ProductSegmented role="group" aria-label="Bridge source chain" className="grid grid-cols-4">
              {BRIDGE_SOURCE_CHAINS.map((chain) => (
                <button
                  key={chain}
                  type="button"
                  aria-pressed={bridgeSourceChain === chain}
                  onClick={() => selectBridgeSourceChain(chain)}
                  className={cn(
                    SEGMENT,
                    bridgeSourceChain === chain
                      ? "bg-card text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {chain}
                </button>
              ))}
            </ProductSegmented>
          )}

          {bridgeSourceChain === "Solana" ? (
            /* No in-app Solana burn yet — the wallet signs it in an external
               CCTP bridge. The claim half below is chain-agnostic. */
            <>
              <div className={META_ROW}>
                <span>
                  Solana{" "}
                  {solanaSourceLoading
                    ? "..."
                    : solanaSourceBalance !== null
                      ? `${solanaSourceBalance.toLocaleString("en-US", {
                          maximumFractionDigits: 6,
                        })} USDC`
                      : "-- USDC"}
                </span>
                {solanaOriginAddress && (
                  <span className="truncate text-zinc-500">
                    {solanaOriginAddress.slice(0, 4)}...{solanaOriginAddress.slice(-4)}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <label className={INPUT_SHELL}>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Amount of USDC to bridge from Solana"
                    value={solanaBridgeAmount}
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^0-9.]/g, "");
                      if (next.split(".").length <= 2) setSolanaBridgeAmount(next);
                    }}
                    placeholder={
                      solanaSourceBalance
                        ? solanaSourceBalance.toLocaleString("en-US", { maximumFractionDigits: 6 })
                        : "0.00"
                    }
                    className={cn(INPUT, "text-base md:text-sm")}
                  />
                  <span className="font-mono text-[11px] text-muted-foreground">USDC</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (solanaSourceBalance) {
                      setSolanaBridgeAmount(formatDepositInputAmount(solanaSourceBalance));
                    }
                  }}
                  disabled={!solanaSourceBalance}
                  className={BTN_NEUTRAL}
                >
                  Max
                </button>
              </div>
              <button
                type="button"
                onClick={() =>
                  solanaSourceBalance
                    ? void handleStartSolanaBridge()
                    // null = the lookup failed, not an empty wallet — retry it.
                    : setSolanaBalanceNonce((n) => n + 1)
                }
                disabled={
                  solanaBridging
                  || solanaSourceLoading
                  || solanaSourceBalance === 0
                  || (Boolean(solanaBridgeAmount)
                    && !(Number(solanaBridgeAmount) > 0
                      && Number(solanaBridgeAmount) <= (solanaSourceBalance ?? 0) + 0.000001))
                }
                className={cn(
                  BTN,
                  "w-full",
                  !solanaBridging && solanaSourceBalance
                    ? "border border-accent/30 text-accent hover:bg-accent/10"
                    : BTN_MUTED,
                )}
              >
                {solanaBridging
                  ? "Confirm in wallet..."
                  : solanaSourceLoading
                    ? "Checking balance..."
                    : solanaSourceBalance
                      ? "Bridge to Aptos"
                      : solanaSourceBalance === 0
                        ? "No Solana USDC found"
                        : "Balance check failed — tap to retry"}
              </button>
            </>
          ) : (
            <>
              <div className={META_ROW}>
                <span className={evmSourceError ? "text-warning" : ""}>
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
                  <span className="truncate text-zinc-500">
                    {evmSourceAddress.slice(0, 6)}...{evmSourceAddress.slice(-4)}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleStartEvmBridge()}
                disabled={!canStartEvmBridge}
                className={cn(
                  BTN,
                  "w-full",
                  canStartEvmBridge
                    ? "border border-accent/30 text-accent hover:bg-accent/10"
                    : BTN_MUTED
                )}
              >
                {status === "submitting"
                  ? "Bridge pending..."
                  : isEvmWallet
                    ? `Bridge from ${bridgeSourceChain}`
                    : "Connect EVM wallet to bridge"}
              </button>
            </>
          )}

          {/* Hidden for Solana wallets: the one-click burn sets the hash
              itself and an interrupted transfer auto-resumes from
              localStorage, so a paste box is pure noise there. EVM keeps it
              for transfers started in external apps. */}
          {!isSolanaWallet && (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <label className={INPUT_SHELL}>
                <input
                  type="text"
                  aria-label="Bridge transfer hash"
                  value={bridgeTxHash}
                  onChange={(e) => {
                    setBridgeTxHash(e.target.value.trim());
                    setBridgeTransfer(null);
                    setBridgeLookupStatus("idle");
                    setBridgeMessage("");
                  }}
                  className={cn(INPUT, "font-normal text-base md:text-xs")}
                  placeholder="Transfer hash or signature"
                />
              </label>
              <button
                type="button"
                onClick={() => void lookupBridgeTransfer()}
                disabled={bridgeLookupStatus === "loading"}
                className={BTN_NEUTRAL}
              >
                {bridgeLookupStatus === "loading" ? "Checking" : "Resume"}
              </button>
            </div>
          )}

          {bridgeTransfer && (
            <div className="space-y-2 rounded-[var(--radius-sm)] border border-card-border bg-card px-3 py-2 text-[11px] text-zinc-400">
              <BridgeStepsRail
                transferStatus={bridgeTransfer.status ?? "pending"}
                submitting={status === "submitting"}
                message={bridgeMessage}
                errored={bridgeLookupStatus === "error"}
              />
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-muted-foreground">
                  {bridgeTransfer.status === "claimable"
                    ? "Ready to claim"
                    : bridgeTransfer.status === "completed"
                      ? "Completed"
                    : "Bridging funds"}
                </span>
                <span className="font-mono tabular-nums text-foreground">
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
                    className={cn(FOCUS_RING, "rounded-[var(--radius-xs)] text-accent underline")}
                  >
                    Source tx
                  </a>
                )}
              </div>
              {!bridgeTransfer.destinationIsAptos && (
                <p className="text-warning">
                  This CCTP transfer does not appear to target Aptos.
                </p>
              )}
              {bridgeMintRecipientMismatch && (
                <div className="space-y-1 text-warning">
                  <p>
                    Mint recipient is {shortAddress(bridgeTransfer.mintRecipient ?? "")};
                    this wallet is {shortAddress(account?.address.toString() ?? "")}.
                  </p>
                  <p className="text-warning/80">
                    {bridgeMatchesDecibelAppDerivedAccount
                      ? "This looks like a transfer started on app.decibel.trade. Claim it with the same EVM wallet, then deposit it into the selected cash.trading account."
                      : "Connect the wallet/domain-derived Aptos account that started this bridge before claiming."}
                  </p>
                </div>
              )}
              {bridgeTransfer.status === "claimable" && !bridgeMintRecipientMismatch && (
                <button
                  type="button"
                  onClick={() => void handleClaimBridgeTransfer()}
                  disabled={status === "submitting"}
                  className={cn(BTN_SECONDARY, "w-full")}
                >
                  {status === "submitting" ? "Working..." : "Claim & Deposit"}
                </button>
              )}
              {bridgeTransfer.status === "claimable" &&
                bridgeMatchesDecibelAppDerivedAccount && (
                  <button
                    type="button"
                    onClick={() => void handleClaimDecibelAppBridgeTransfer()}
                    disabled={status === "submitting"}
                    className={cn(BTN_SECONDARY, "w-full")}
                  >
                    {status === "submitting"
                      ? "Working..."
                      : "Claim Decibel App Transfer"}
                  </button>
                )}
            </div>
          )}

          {bridgeMessage && (
            <p
              role={bridgeLookupStatus === "error" ? "alert" : "status"}
              className={cn(
                "text-[11px] leading-4 text-pretty",
                bridgeLookupStatus === "error" ? "text-danger" : "text-muted-foreground"
              )}
            >
              {bridgeMessage}
            </p>
          )}
        </div>
      )}

      {statusMessage && (
        <div
          role={status === "error" ? "alert" : "status"}
          className={cn(
            "rounded-[var(--radius-sm)] px-3 py-2 text-[11px] leading-4",
            status === "error"
              ? "bg-danger/10 text-danger"
              : status === "success"
                ? "bg-success/10 text-success"
                : "bg-card text-zinc-400"
          )}
        >
          <p>{statusMessage}</p>
          {statusHash && (
            <a
              href={explorerTxUrl(statusHash)}
              target="_blank"
              rel="noreferrer"
              className={cn(FOCUS_RING, "mt-1 inline-block rounded-[var(--radius-xs)] text-accent underline")}
            >
              View transaction
            </a>
          )}
        </div>
      )}
    </section>
  );
}
