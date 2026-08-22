"use client";

import {
  SpotSwapReview,
  type SpotSwapReviewNotice,
  type SpotSwapReviewRow,
} from "@/components/trade/swap/SpotSwapReview";

type AssetSymbol = "CASH" | "USDC";

interface CashSwapReviewProps {
  busy: boolean;
  confirmDisabled: boolean;
  effectivePrice: number;
  fromSymbol: AssetSymbol;
  highRiskAcknowledged: boolean;
  maximumSpend?: number;
  minimumReceived: number;
  oneSided: boolean;
  onAcceptQuote: () => void;
  onBack: () => void;
  onConfirm: () => void;
  onHighRiskAcknowledgedChange: (checked: boolean) => void;
  payAmount: number;
  previousReceiveAmount?: number;
  priceChanged: boolean;
  priceImpact: number;
  receiveAmount: number;
  spread: number;
  toSymbol: AssetSymbol;
}

function amountDigits(symbol: AssetSymbol) {
  return symbol === "CASH" ? 0 : 6;
}

function formatAmount(value: number, symbol: AssetSymbol) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: amountDigits(symbol),
  }).format(value);
}

function formatPrice(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 8,
    maximumFractionDigits: 12,
  });
}

function iconFor(symbol: AssetSymbol) {
  return symbol === "CASH" ? "/tokens/cash.png" : "/tokens/usdc.png";
}

export function CashSwapReview({
  busy,
  confirmDisabled,
  effectivePrice,
  fromSymbol,
  highRiskAcknowledged,
  maximumSpend,
  minimumReceived,
  oneSided,
  onAcceptQuote,
  onBack,
  onConfirm,
  onHighRiskAcknowledgedChange,
  payAmount,
  previousReceiveAmount,
  priceChanged,
  priceImpact,
  receiveAmount,
  spread,
  toSymbol,
}: CashSwapReviewProps) {
  const details: SpotSwapReviewRow[] = [
    { label: "Rate", value: `1 CASH = ${formatPrice(effectivePrice)} USDC` },
    {
      label: "Price impact",
      value: oneSided ? "No midpoint" : `${priceImpact.toFixed(3)}%`,
      tone: oneSided || priceImpact > 1 ? "warning" : undefined,
    },
    {
      label: "Bid / ask spread",
      value: oneSided ? "One-sided book" : `${spread.toFixed(3)}%`,
      tone: oneSided || spread > 2 ? "warning" : undefined,
    },
    {
      label: "Minimum received",
      value: `${formatAmount(minimumReceived, toSymbol)} ${toSymbol}`,
    },
    ...(maximumSpend === undefined
      ? []
      : [{
          label: "Maximum spend",
          value: `${formatAmount(maximumSpend, fromSymbol)} ${fromSymbol}`,
        }]),
    { label: "Max price movement", value: "0.5%" },
    { label: "Venue", value: "CASH orderbook", tone: "positive" as const },
  ];

  let notice: SpotSwapReviewNotice | null = null;
  if (priceChanged) {
    notice = {
      title: "Price updated",
      body: `Expected output changed from ${formatAmount(previousReceiveAmount ?? 0, toSymbol)} to ${formatAmount(receiveAmount, toSymbol)} ${toSymbol}.`,
    };
  } else if (oneSided || priceImpact > 1) {
    notice = {
      title: oneSided ? "No two-sided price reference" : `${priceImpact.toFixed(2)}% price impact`,
      body: oneSided
        ? "The orderbook only has one side. Check the execution price carefully."
        : "This swap crosses multiple price levels. Your worst-case amount is still protected.",
    };
  }

  return (
    <SpotSwapReview
      acknowledgement={!priceChanged && (oneSided || priceImpact > 1) ? {
        checked: highRiskAcknowledged,
        label: oneSided
          ? "I reviewed the execution price without a two-sided market reference."
          : "I reviewed this price impact and the protected worst-case amount.",
        onChange: onHighRiskAcknowledgedChange,
      } : undefined}
      busy={busy}
      confirmDisabled={priceChanged ? busy : confirmDisabled || ((oneSided || priceImpact > 1) && !highRiskAcknowledged)}
      confirmLabel={priceChanged ? "Use updated quote" : busy ? "Open wallet to confirm" : "Confirm swap"}
      details={details}
      fromAsset={{ symbol: fromSymbol, iconSrc: iconFor(fromSymbol) }}
      notice={notice}
      onBack={onBack}
      onConfirm={priceChanged ? onAcceptQuote : onConfirm}
      payAmount={formatAmount(payAmount, fromSymbol)}
      receiveAmount={formatAmount(receiveAmount, toSymbol)}
      safetyCopy="Output protection is enforced by the Aptos transaction. Your wallet shows the network fee before signing."
      toAsset={{ symbol: toSymbol, iconSrc: iconFor(toSymbol) }}
    />
  );
}
