"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface VaultPosition {
  market: string;
  size: number;
  isLong: boolean;
  leverage: number;
  entryPrice: number;
  markPrice: number | null;
  value: number | null;
  estimatedPnl: number | null;
  estimatedPnlPct: number | null;
}

interface VaultPositionsResponse {
  positions?: VaultPosition[];
  fetchedAt?: number;
  error?: string;
}

function marketSymbol(market: string): string {
  return market.replace(/\/USD$/i, "");
}

function formatAmount(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(absolute);
  }
  if (absolute >= 1_000) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(absolute);
  }
  if (absolute >= 1) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(absolute);
  }
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 }).format(absolute);
}

function formatUsd(value: number | null, signed = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = signed && value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
  }).format(Math.abs(value))}`;
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function VaultPositionsSkeleton() {
  return (
    <div className="space-y-px" aria-label="Loading vault positions">
      {Array.from({ length: 9 }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-[1.35fr_0.8fr_1fr] items-center gap-2 border-b border-white/[0.04] px-3 py-3"
        >
          <div className="h-3 w-24 animate-pulse rounded bg-white/[0.06]" />
          <div className="ml-auto h-3 w-14 animate-pulse rounded bg-white/[0.05]" />
          <div className="ml-auto h-3 w-16 animate-pulse rounded bg-white/[0.05]" />
        </div>
      ))}
    </div>
  );
}

export function VaultPositionsTable({
  vaultAddress,
  vaultName,
}: {
  vaultAddress: string;
  vaultName: string;
}) {
  const [positions, setPositions] = useState<VaultPosition[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const positionsRef = useRef<VaultPosition[]>([]);

  const updateScrollEdges = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const epsilon = 2;
    setCanScrollUp(viewport.scrollTop > epsilon);
    setCanScrollDown(
      viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - epsilon,
    );
  }, []);

  const loadPositions = useCallback(async (initial = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (initial) setStatus("loading");

    try {
      const response = await fetch(
        `/api/decibel/vault-positions?vault=${encodeURIComponent(vaultAddress)}`,
        { cache: "no-store", signal: controller.signal },
      );
      const data = (await response.json().catch(() => null)) as VaultPositionsResponse | null;
      if (!response.ok || !data || !Array.isArray(data.positions)) {
        throw new Error(data?.error ?? "Vault positions unavailable");
      }
      positionsRef.current = data.positions;
      setPositions(data.positions);
      setUpdatedAt(data.fetchedAt ?? Date.now());
      setStatus("ready");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (positionsRef.current.length === 0) setStatus("error");
    }
  }, [vaultAddress]);

  useEffect(() => {
    void loadPositions(true);
    const interval = window.setInterval(() => void loadPositions(false), 15_000);
    return () => {
      window.clearInterval(interval);
      requestRef.current?.abort();
    };
  }, [loadPositions]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const frame = window.requestAnimationFrame(updateScrollEdges);
    const observer = new ResizeObserver(updateScrollEdges);
    observer.observe(viewport);
    if (viewport.firstElementChild instanceof HTMLElement) {
      observer.observe(viewport.firstElementChild);
    }
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [positions, status, updateScrollEdges]);

  return (
    <section className="relative h-[510px] overflow-hidden rounded-lg border border-white/[0.06] bg-[#111]">
      <header className="flex h-[52px] items-center justify-between border-b border-white/[0.06] px-3">
        <div className="min-w-0">
          <div className="truncate font-sans text-[12px] font-semibold text-zinc-200">
            Open positions
          </div>
          <div className="text-[9px] text-zinc-600">
            {status === "loading" ? "Loading Decibel portfolio" : `${positions.length} markets`}
          </div>
        </div>
        {updatedAt != null && (
          <span className="shrink-0 text-[9px] tabular-nums text-zinc-600">
            {new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </header>

      {status === "error" ? (
        <div className="flex h-[456px] flex-col items-center justify-center gap-3 px-6 text-center">
          <div>
            <div className="text-[12px] font-semibold text-zinc-300">Positions unavailable</div>
            <p className="mt-1 text-pretty text-[10px] leading-4 text-zinc-600">
              Decibel did not return this vault&apos;s live portfolio.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadPositions(true)}
            className="rounded-[8px] border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] font-semibold text-zinc-300 transition-[transform,background-color] duration-150 hover:bg-white/[0.08] active:scale-[0.97]"
          >
            Retry
          </button>
        </div>
      ) : status === "loading" ? (
        <VaultPositionsSkeleton />
      ) : positions.length === 0 ? (
        <div className="flex h-[456px] flex-col items-center justify-center gap-3 px-6 text-center">
          <div>
            <div className="text-[12px] font-semibold text-zinc-300">No open positions</div>
            <p className="mt-1 text-pretty text-[10px] leading-4 text-zinc-600">
              This vault has performance history but no position is open right now.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadPositions(true)}
            className="rounded-[8px] border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] font-semibold text-zinc-300 transition-[transform,background-color] duration-150 hover:bg-white/[0.08] active:scale-[0.97]"
          >
            Refresh
          </button>
        </div>
      ) : (
        <>
          <ScrollArea
            className="h-[456px] touch-pan-y overscroll-contain"
            viewportRef={viewportRef}
            viewportProps={{
              tabIndex: 0,
              "aria-label": `${vaultName} open positions`,
              onScroll: updateScrollEdges,
            }}
          >
            <table className="w-full table-fixed text-left text-[10px] tabular-nums">
              <thead className="sticky top-0 z-10 bg-[#171717] text-[9px] font-medium uppercase text-zinc-600">
                <tr>
                  <th className="w-[45%] px-3 py-2 font-medium">Market</th>
                  <th className="w-[23%] px-2 py-2 text-right font-medium">Value</th>
                  <th className="w-[32%] px-3 py-2 text-right font-medium">Est. PnL</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position, index) => {
                  const pnl = position.estimatedPnl;
                  const pnlPositive = pnl != null && pnl >= 0;
                  return (
                    <tr
                      key={`${position.market}-${position.isLong ? "long" : "short"}-${index}`}
                      className="border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.025]"
                    >
                      <td className="min-w-0 px-3 py-2.5 align-top">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-sans text-[11px] font-semibold text-zinc-200">
                            {marketSymbol(position.market)}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 rounded px-1 py-0.5 text-[8px] font-bold",
                              position.isLong
                                ? "bg-accent/15 text-accent"
                                : "bg-[#ff5b2e]/15 text-[#ff744d]",
                            )}
                          >
                            {position.isLong ? "LONG" : "SHORT"} {position.leverage}x
                          </span>
                        </div>
                        <div className="mt-1 truncate text-[9px] text-zinc-600">
                          {formatAmount(position.size)} {marketSymbol(position.market)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right align-top text-zinc-400">
                        {formatUsd(position.value)}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-2.5 text-right align-top",
                          pnl == null
                            ? "text-zinc-600"
                            : pnlPositive
                              ? "text-accent"
                              : "text-[#ff744d]",
                        )}
                      >
                        <div>{formatUsd(pnl, true)}</div>
                        <div className="mt-1 text-[9px] opacity-70">
                          {formatPercent(position.estimatedPnlPct)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>

          {canScrollUp && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-[52px] z-20 flex h-5 items-center justify-center border-b border-white/[0.04] bg-[#111]/95 text-[9px] text-zinc-600"
            >
              ↑
            </div>
          )}
          {canScrollDown && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex h-7 items-center justify-center border-t border-white/[0.05] bg-[#111]/95 text-[8px] font-semibold uppercase text-zinc-600"
            >
              More ↓
            </div>
          )}
        </>
      )}
    </section>
  );
}
