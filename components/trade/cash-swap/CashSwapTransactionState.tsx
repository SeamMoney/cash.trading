"use client";

import Image from "next/image";
import { Check, CircleAlert, ExternalLink, LoaderCircle, RotateCcw } from "lucide-react";

import { PRESSABLE_CONTROL } from "@/lib/surface";
import { cn } from "@/lib/utils";

type SubmitStage = "idle" | "wallet" | "chain";

export interface SwapTransactionReceipt {
  fromSymbol: string;
  paid: number | string;
  quoted?: boolean;
  received: number | string;
  toSymbol: string;
}

interface CashSwapTransactionStateProps {
  confirmationDelayed: boolean;
  onCheck: () => void;
  onNewSwap: () => void;
  pendingIconSrc?: string;
  pendingHash: string;
  receipt: SwapTransactionReceipt | null;
  stage: SubmitStage;
  successBody?: string;
  successHash: string;
  successTitle?: string;
  verificationIssue: string;
}

function formatAmount(value: number | string, symbol: string) {
  if (typeof value === "string") return value;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: symbol === "CASH" ? 0 : 6,
  }).format(value);
}

function TransactionLink({ hash, label = "View on Aptos" }: { hash: string; label?: string }) {
  if (!hash || hash === "0xpreview") return null;
  return (
    <a
      href={`https://explorer.aptoslabs.com/txn/${hash}?network=mainnet`}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-card-border bg-background-elevated px-4 text-[12px] font-semibold text-foreground outline-none hover:bg-card-hover focus-visible:ring-2 focus-visible:ring-ring",
        PRESSABLE_CONTROL,
      )}
    >
      {label}
      <ExternalLink aria-hidden="true" className="size-3.5" />
    </a>
  );
}

export function CashSwapTransactionState({
  confirmationDelayed,
  onCheck,
  onNewSwap,
  pendingIconSrc = "/tokens/cash.png",
  pendingHash,
  receipt,
  stage,
  successBody = "Your trade settled directly to your Aptos wallet.",
  successHash,
  successTitle = "Swap complete",
  verificationIssue,
}: CashSwapTransactionStateProps) {
  if (successHash && receipt) {
    return (
      <div className="flex min-h-[430px] flex-col items-center justify-center px-4 py-8 text-center">
        <div className="flex w-full flex-col items-center" role="status" aria-live="polite">
          <span className="grid size-16 place-items-center rounded-full bg-accent text-black shadow-[0_0_40px_rgba(0,213,75,0.18)]">
            <Check aria-hidden="true" className="size-7" strokeWidth={2.5} />
          </span>
          <h3 data-swap-screen-heading tabIndex={-1} className="mt-5 font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground outline-none">{successTitle}</h3>
          <p className="mt-2 max-w-[320px] text-[12px] leading-5 text-foreground-secondary">
            {successBody}
          </p>

          <div className="mt-6 w-full rounded-[var(--radius)] border border-card-border bg-card p-4 text-left">
            <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{receipt.quoted ? "Quoted execution" : "Executed"}</p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-mono text-[20px] font-medium leading-7 tabular-nums text-foreground">
                  {formatAmount(receipt.paid, receipt.fromSymbol)} {receipt.fromSymbol}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">Paid</p>
              </div>
              <span aria-hidden="true" className="text-muted-foreground">→</span>
              <div className="min-w-0 text-right">
                <p className="break-words font-mono text-[20px] font-medium leading-7 tabular-nums text-foreground">
                  {formatAmount(receipt.received, receipt.toSymbol)} {receipt.toSymbol}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">Received</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex w-full flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onNewSwap}
            className={cn(
              "min-h-12 flex-1 rounded-[var(--radius-sm)] bg-accent px-4 text-[14px] font-semibold text-accent-foreground outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring",
              PRESSABLE_CONTROL,
            )}
          >
            Make another swap
          </button>
          <TransactionLink hash={successHash} />
        </div>
      </div>
    );
  }

  if (pendingHash && verificationIssue) {
    return (
      <div className="flex min-h-[430px] flex-col items-center justify-center px-4 py-8 text-center">
        <div className="flex w-full flex-col items-center" role="alert">
          <span className="grid size-16 place-items-center rounded-full border border-warning/35 bg-warning/[0.08] text-foreground">
            <CircleAlert aria-hidden="true" className="size-7" strokeWidth={2.5} />
          </span>
          <h3
            data-swap-screen-heading
            tabIndex={-1}
            className="mt-5 font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground outline-none"
          >
            Execution needs review
          </h3>
          <p className="mt-2 max-w-[340px] text-pretty text-[12px] leading-5 text-foreground-secondary">
            {verificationIssue} The form is locked so this swap cannot be submitted twice.
          </p>
        </div>
        <div className="mt-6">
          <TransactionLink hash={pendingHash} label="Review transaction" />
        </div>
      </div>
    );
  }

  const waitingForWallet = stage === "wallet" && !pendingHash;
  const title = waitingForWallet
    ? "Confirm in your wallet"
    : confirmationDelayed
      ? "Still confirming"
      : "Confirming on Aptos";
  const body = waitingForWallet
    ? "Review the protected amounts in your wallet, then approve the transaction."
    : confirmationDelayed
      ? "Aptos has not returned a final result yet. Do not submit the swap again."
      : "Your transaction was submitted. Keep this page open while Aptos finalizes it.";

  return (
    <div className="flex min-h-[430px] flex-col items-center justify-center px-4 py-8 text-center">
      <div className="flex flex-col items-center" role="status" aria-live="polite">
        <span className="relative grid size-16 place-items-center rounded-full border border-accent/25 bg-accent/[0.08] text-accent">
          {waitingForWallet ? (
            <Image src={pendingIconSrc} alt="" width={34} height={34} className="size-[34px] rounded-full" />
          ) : (
            <LoaderCircle aria-hidden="true" className="size-7 animate-spin motion-reduce:animate-none" />
          )}
        </span>
        <h3 data-swap-screen-heading tabIndex={-1} className="mt-5 font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground outline-none">{title}</h3>
        <p className="mt-2 max-w-[330px] text-pretty text-[12px] leading-5 text-foreground-secondary">{body}</p>
      </div>

      {pendingHash && (
        <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          {confirmationDelayed && (
            <button
              type="button"
              onClick={onCheck}
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-accent px-4 text-[12px] font-semibold text-accent-foreground outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring",
                PRESSABLE_CONTROL,
              )}
            >
              <RotateCcw aria-hidden="true" className="size-4" strokeWidth={2.5} />
              Check again
            </button>
          )}
          <TransactionLink hash={pendingHash} />
        </div>
      )}
    </div>
  );
}
