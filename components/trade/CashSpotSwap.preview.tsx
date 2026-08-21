"use client";

import { CashSpotSwap, type CashSpotSwapPreviewState } from "./CashSpotSwap";

const STATES: CashSpotSwapPreviewState[] = [
  "default",
  "hover",
  "focus-visible",
  "active",
  "disabled",
  "loading",
  "error",
  "success",
];

export function CashSpotSwapStatePreview() {
  return (
    <div className="cash-trade-theme grid gap-8 bg-background p-4 sm:p-8 2xl:grid-cols-2">
      {STATES.map((state) => (
        <div key={state} className="mx-auto w-full max-w-[480px]">
          <p className="mb-3 font-mono text-xs text-muted-foreground">{state}</p>
          <CashSpotSwap previewState={state} />
        </div>
      ))}
    </div>
  );
}
