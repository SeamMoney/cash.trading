"use client";

import Image from "next/image";
import { ArrowLeft, Check, LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";

import { PRESSABLE_CONTROL } from "@/lib/surface";
import { cn } from "@/lib/utils";

export interface SpotSwapReviewAsset {
  iconSrc: string;
  symbol: string;
}

export interface SpotSwapReviewRow {
  label: string;
  tone?: "warning" | "positive";
  value: string;
}

export interface SpotSwapReviewNotice {
  action?: {
    label: string;
    onClick: () => void;
  };
  body: string;
  title: string;
}

interface SpotSwapReviewProps {
  acknowledgement?: {
    checked: boolean;
    label: string;
    onChange: (checked: boolean) => void;
  };
  busy: boolean;
  confirmDisabled: boolean;
  confirmLabel?: string;
  details: SpotSwapReviewRow[];
  fromAsset: SpotSwapReviewAsset;
  notice?: SpotSwapReviewNotice | null;
  onBack: () => void;
  onConfirm: () => void;
  payAmount: string;
  payLabel?: string;
  receiveAmount: string;
  receiveLabel?: string;
  safetyCopy: string;
  toAsset: SpotSwapReviewAsset;
}

function AssetAmount({
  amount,
  asset,
  label,
}: {
  amount: string;
  asset: SpotSwapReviewAsset;
  label: string;
}) {
  return (
    <div className="rounded-[var(--radius)] bg-background-tertiary p-4">
      <p className="text-[13px] leading-4 text-muted-foreground">{label}</p>
      <div className="mt-3 flex items-start justify-between gap-3">
        <p
          title={amount}
          className="min-w-0 flex-1 break-all font-mono text-2xl font-medium leading-tight tabular-nums text-foreground"
        >
          {amount}
        </p>
        <span className="flex h-11 shrink-0 items-center gap-2 rounded-full border border-card-border bg-background-secondary px-3 font-display text-base font-semibold text-foreground">
          <Image
            src={asset.iconSrc}
            alt=""
            width={28}
            height={28}
            className="size-7 rounded-full object-cover"
          />
          {asset.symbol}
        </span>
      </div>
    </div>
  );
}

export function SpotSwapReview({
  acknowledgement,
  busy,
  confirmDisabled,
  confirmLabel = "Confirm swap",
  details,
  fromAsset,
  notice,
  onBack,
  onConfirm,
  payAmount,
  payLabel = "You pay",
  receiveAmount,
  receiveLabel = "You receive",
  safetyCopy,
  toAsset,
}: SpotSwapReviewProps) {
  return (
    <div className="px-0 pb-1 pt-1">
      <h3 data-swap-screen-heading tabIndex={-1} className="sr-only outline-none">
        Review swap
      </h3>
      <button
        type="button"
        onClick={onBack}
        disabled={busy}
        className={cn(
          "mb-3 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] px-2 text-[13px] font-medium text-muted-foreground outline-none hover:bg-card-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          PRESSABLE_CONTROL,
        )}
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Edit swap
      </button>

      <div className="space-y-1">
        <AssetAmount label={payLabel} amount={payAmount} asset={fromAsset} />
        <AssetAmount label={receiveLabel} amount={receiveAmount} asset={toAsset} />
      </div>

      {notice ? (
        <div role="status" className="mt-3 flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-warning/30 bg-warning/[0.07] p-3 text-foreground">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="text-[13px] font-semibold leading-4">{notice.title}</p>
            <p className="mt-1 text-pretty text-[11px] leading-4 text-foreground-secondary">
              {notice.body}
            </p>
            {notice.action ? (
              <button
                type="button"
                onClick={notice.action.onClick}
                className={cn(
                  "mt-2 min-h-11 rounded-[var(--radius-sm)] border border-warning/40 bg-background-elevated px-3 text-[13px] font-semibold text-foreground outline-none hover:bg-card-hover focus-visible:ring-2 focus-visible:ring-ring",
                  PRESSABLE_CONTROL,
                )}
              >
                {notice.action.label}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <dl className="mt-3 space-y-2.5 rounded-[var(--radius-sm)] border border-card-border bg-card p-3">
        {details.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-4 text-[13px] leading-5">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className={cn(
              "text-right font-mono tabular-nums text-foreground-secondary",
              row.tone === "warning" && "text-warning",
              row.tone === "positive" && "text-accent",
            )}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {acknowledgement ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={acknowledgement.checked}
          onClick={() => acknowledgement.onChange(!acknowledgement.checked)}
          className={cn(
            "mt-3 flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-sm)] border border-card-border bg-background px-3 py-2 text-left text-[13px] leading-4 text-foreground-secondary outline-none hover:border-border-strong hover:bg-card-hover focus-visible:ring-2 focus-visible:ring-ring",
            PRESSABLE_CONTROL,
          )}
        >
          <span className={cn(
            "grid size-5 shrink-0 place-items-center rounded-[var(--radius-xs)] border",
            acknowledgement.checked
              ? "border-accent bg-accent text-accent-foreground"
              : "border-border-strong bg-background-elevated text-transparent",
          )}>
            <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
          </span>
          {acknowledgement.label}
        </button>
      ) : null}

      <div className="mt-3 flex items-start gap-2 px-1 text-[11px] leading-4 text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent" />
        <p>{safetyCopy}</p>
      </div>

      <button
        type="button"
        onClick={onConfirm}
        disabled={confirmDisabled || busy}
        aria-busy={busy}
        className={cn(
          "mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-accent px-4 font-display text-lg font-semibold text-accent-foreground outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-background-elevated disabled:text-muted-foreground",
          PRESSABLE_CONTROL,
        )}
      >
        {busy ? (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        ) : null}
        {confirmLabel}
      </button>
    </div>
  );
}
