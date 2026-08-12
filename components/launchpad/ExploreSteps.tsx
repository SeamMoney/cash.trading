"use client";

import { cn } from "@/lib/utils";
import { PRODUCT_PRESSABLE_CLASS } from "@/components/ui/product-surface";
import type { Indicator } from "./LaunchpadPage";

/**
 * Explore reads as three separate jobs — read a strategy's backtest, weigh it
 * against others, then take one live — but nothing on the page said so, and
 * the deploy entry was an 11px text link. This rail names the three steps and
 * makes each one reachable.
 */
export type ExploreStep = 1 | 2 | 3;

export const COMPARE_LIMIT = 3;

const STEPS: Array<{ n: ExploreStep; label: string }> = [
  { n: 1, label: "Backtest" },
  { n: 2, label: "Compare" },
  { n: 3, label: "Deploy" },
];

function stepHint(step: ExploreStep, hasSelection: boolean, compareCount: number) {
  if (step === 1) {
    return hasSelection
      ? "Run this strategy's backtest to see how it would have performed."
      : "Pick a strategy on the left to see its backtest.";
  }
  if (step === 2) {
    if (compareCount === 0) return `Tick up to ${COMPARE_LIMIT} strategies on the left to compare them.`;
    if (compareCount === 1) return "Tick one more to see them side by side.";
    return `Comparing ${compareCount}. Best value in each row is highlighted.`;
  }
  return "Author a new strategy from Pine Script, or take one live as a sealed vault.";
}

export function ExploreStepRail({
  step,
  onStep,
  hasSelection,
  compareCount,
  className,
}: {
  step: ExploreStep;
  onStep: (step: ExploreStep) => void;
  hasSelection: boolean;
  compareCount: number;
  className?: string;
}) {
  const done = (n: ExploreStep) => (n === 1 ? hasSelection : n === 2 ? compareCount >= 2 : false);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--radius)] border border-card-border bg-[#141414]",
        className,
      )}
    >
      <div className="flex items-stretch">
        {STEPS.map(({ n, label }, index) => {
          const active = step === n;
          const complete = done(n) && !active;
          return (
            <div key={n} className="flex min-w-0 flex-1 items-center">
              {index > 0 && (
                <span aria-hidden className="h-px w-3 shrink-0 bg-white/[0.10] sm:w-6" />
              )}
              <button
                type="button"
                onClick={() => onStep(n)}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "group flex min-w-0 flex-1 items-center gap-2 px-2 py-3 text-left sm:px-3",
                  PRODUCT_PRESSABLE_CLASS,
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] tabular-nums transition-colors",
                    active
                      ? "border-accent bg-accent text-black"
                      : complete
                        ? "border-accent/40 text-accent"
                        : "border-white/[0.14] text-[#8a8a8a] group-hover:border-white/[0.28]",
                  )}
                >
                  {complete ? "✓" : n}
                </span>
                <span
                  className={cn(
                    "truncate font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                    active ? "text-zinc-100" : "text-[#8a8a8a] group-hover:text-zinc-300",
                  )}
                >
                  {label}
                </span>
                {n === 2 && compareCount > 0 && (
                  <span className="shrink-0 rounded-full bg-accent/12 px-1.5 font-mono text-[9px] tabular-nums text-accent">
                    {compareCount}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
      <p className="border-t border-white/[0.06] px-3 py-2 text-[11px] leading-relaxed text-[#a1a1a1] sm:px-4">
        {stepHint(step, hasSelection, compareCount)}
      </p>
    </div>
  );
}

type MetricRow = {
  label: string;
  /** Rendered cell text. */
  format: (ind: Indicator) => string;
  /** Sort key for "which column wins this row". Omit for rows with no winner. */
  score?: (ind: Indicator) => number;
  /** Lower is better (drawdown). */
  lowerWins?: boolean;
  sub?: string;
};

const ROWS: MetricRow[] = [
  {
    label: "Robustness",
    sub: "of parameter variations profitable",
    format: (i) => `${i.profitablePct}%`,
    score: (i) => i.profitablePct,
  },
  {
    label: "Return / risk",
    sub: "mean Sharpe",
    format: (i) => (i.meanSharpe / 1000).toFixed(2),
    score: (i) => i.meanSharpe,
  },
  {
    label: "Max drawdown",
    sub: "peak-to-trough",
    format: (i) => `-${(i.maxDrawdownBps / 100).toFixed(1)}%`,
    score: (i) => i.maxDrawdownBps,
    lowerWins: true,
  },
  {
    label: "Sims",
    sub: "sample size behind the numbers",
    format: (i) => (i.totalSims >= 1000 ? `${(i.totalSims / 1000).toFixed(1)}k` : String(i.totalSims)),
    score: (i) => i.totalSims,
  },
  {
    label: "Markets",
    format: (i) => (i.assets.length ? i.assets.join(", ") : "—"),
  },
  {
    label: "Status",
    format: (i) => (i.isGraduated ? "Live" : "Testing"),
  },
];

export function CompareTable({
  items,
  onRemove,
  onOpen,
  onDeploy,
}: {
  items: Indicator[];
  onRemove: (address: string) => void;
  onOpen: (ind: Indicator) => void;
  onDeploy: () => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
        <p className="font-display text-[15px] font-semibold text-zinc-200">Nothing to compare yet</p>
        <p className="mt-1.5 max-w-sm text-[12px] leading-relaxed text-[#8a8a8a]">
          Tick up to {COMPARE_LIMIT} strategies in the list on the left and their numbers will line
          up here, side by side.
        </p>
      </div>
    );
  }

  // A single strategy has nothing to be measured against, so no cell can win.
  const contested = items.length > 1;

  return (
    <div className="min-h-[420px] px-4 py-4 sm:px-5">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-left">
          <thead>
            <tr>
              <th className="w-[150px] pb-3 pr-3 align-bottom font-mono text-[9px] uppercase tracking-[0.16em] text-[#8a8a8a]">
                Metric
              </th>
              {items.map((ind) => (
                <th key={ind.address} className="pb-3 pl-3 align-bottom">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onOpen(ind)}
                      className={cn(
                        "min-w-0 text-left font-display text-[13px] font-semibold text-zinc-100 hover:text-accent",
                        PRODUCT_PRESSABLE_CLASS,
                      )}
                    >
                      <span className="line-clamp-2">{ind.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(ind.address)}
                      aria-label={`Remove ${ind.name} from the comparison`}
                      className={cn(
                        "shrink-0 rounded-[var(--radius-xs)] px-1 font-mono text-[12px] leading-none text-[#666] hover:text-zinc-200",
                        PRODUCT_PRESSABLE_CLASS,
                      )}
                    >
                      ×
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              // Recomputed per row: the winner of Sharpe is rarely the winner
              // of drawdown, which is the entire point of comparing.
              let best: number | null = null;
              if (contested && row.score) {
                const scores = items.map(row.score);
                const candidate = row.lowerWins ? Math.min(...scores) : Math.max(...scores);
                // An all-round tie has no winner. Highlighting every cell green
                // reads as "they all win", which is noise, not information.
                if (scores.some((s) => s !== candidate)) best = candidate;
              }
              return (
                <tr key={row.label} className="border-t border-white/[0.06]">
                  <th className="py-2.5 pr-3 align-top font-normal">
                    <span className="block font-display text-[12px] text-zinc-300">{row.label}</span>
                    {row.sub && (
                      <span className="mt-0.5 block text-[10px] leading-snug text-[#666]">{row.sub}</span>
                    )}
                  </th>
                  {items.map((ind) => {
                    const wins =
                      best != null && row.score != null && row.score(ind) === best;
                    return (
                      <td key={ind.address} className="py-2.5 pl-3 align-top">
                        <span
                          className={cn(
                            "font-mono text-[13px] tabular-nums",
                            wins ? "font-semibold text-accent" : "text-zinc-300",
                          )}
                        >
                          {row.format(ind)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
        <button
          type="button"
          onClick={onDeploy}
          className={cn(
            "rounded-[var(--radius-sm)] bg-accent px-3.5 py-2 font-display text-[12px] font-semibold text-black transition-all duration-200 hover:brightness-[1.03]",
            PRODUCT_PRESSABLE_CLASS,
          )}
        >
          Deploy a strategy →
        </button>
        <span className="text-[11px] text-[#8a8a8a]">
          Backtests describe the past. None of these numbers is a forecast.
        </span>
      </div>
    </div>
  );
}
