import { notFound } from "next/navigation";

import {
  CashSpotSwap,
  type CashSpotSwapPreviewState,
} from "@/components/trade/CashSpotSwap";

const PREVIEW_STATES = new Set<CashSpotSwapPreviewState>([
  "default",
  "hover",
  "focus-visible",
  "active",
  "disabled",
  "loading",
  "error",
  "success",
]);

export default async function CashSwapDevelopmentPreview({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const requestedState = (await searchParams).state;
  const previewState = PREVIEW_STATES.has(requestedState as CashSpotSwapPreviewState)
    ? requestedState as CashSpotSwapPreviewState
    : "default";

  return (
    <main className="cash-trade-theme min-h-screen bg-background px-3 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-[1160px]">
        <CashSpotSwap marketLayout previewState={previewState} />
      </div>
    </main>
  );
}
