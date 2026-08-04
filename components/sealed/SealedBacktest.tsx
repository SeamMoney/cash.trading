"use client";

import { useCallback, useState } from "react";

import { EquityCurveChart } from "@/components/launchpad/EquityCurveChart";
import { SURFACE_CARD_SOLID, SURFACE_CONTROL } from "@/lib/surface";
import { cn } from "@/lib/utils";

const WINDOWS = [
  { key: "1h", label: "90d · 1h" },
  { key: "4h", label: "240d · 4h" },
  { key: "1d", label: "1y · 1d" },
] as const;

interface Stats {
  barsSimulated: number;
  warmupBars: number;
  finalEquity: number;
  returnPct: number;
  holdReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  trades: number;
  winRatePct: number;
  feesPaid: number;
  fundingPaid: number;
  timeInMarketPct: number;
  longFills: number;
  shortFills: number;
}

interface Response {
  ok: boolean;
  error?: string;
  detail?: string[];
  equityCurve?: Array<{ t: number; v: number }>;
  stats?: Stats;
  assumptions?: string[];
  builderFeeBps?: number;
}

interface Props {
  pineScript: string;
  asset: string;
  pctBps: number;
  maxLeverageX100: number;
  slippageBps: number;
  initialCapital: number;
}

export function SealedBacktest(props: Props) {
  const { pineScript, asset, pctBps, maxLeverageX100, slippageBps, initialCapital } = props;
  const [windowKey, setWindowKey] = useState<(typeof WINDOWS)[number]["key"]>("1h");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Response | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/sealed/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pineScript,
          asset,
          window: windowKey,
          pctBps,
          maxLeverageX100,
          slippageBps,
          initialCapital,
        }),
      });
      setResult((await res.json()) as Response);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "Backtest failed" });
    } finally {
      setLoading(false);
    }
  }, [asset, initialCapital, maxLeverageX100, pctBps, pineScript, slippageBps, windowKey]);

  const s = result?.stats;
  // Beating buy-and-hold is the only comparison that matters for a directional
  // strategy on one asset. A +12% return in a +40% market is a losing product,
  // and showing the return alone would let it read as a win.
  const beatsHold = s ? s.returnPct > s.holdReturnPct : false;

  return (
    <div className={cn(SURFACE_CARD_SOLID, "overflow-hidden")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
        <div>
          <h3 className="font-display text-[14px] font-semibold text-white">Backtest</h3>
          <p className="text-[11px] leading-snug text-zinc-500">
            Your script, under the fees and sizing this vault will trade with.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={cn(SURFACE_CONTROL, "flex overflow-hidden p-0.5")}>
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => setWindowKey(w.key)}
                className={cn(
                  "rounded-[7px] px-2 py-1 font-mono text-[10px] transition-colors",
                  windowKey === w.key ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading || pineScript.trim().length === 0}
            className={cn(
              "rounded-[10px] px-3 py-1.5 text-[12px] font-semibold transition-colors",
              loading || pineScript.trim().length === 0
                ? "cursor-not-allowed bg-white/[0.04] text-zinc-600"
                : "bg-[#39ff14] text-black hover:bg-[#4dff33]",
            )}
          >
            {loading ? "Running…" : "Run"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {result && !result.ok && (
          <div className="rounded-[10px] border border-red-500/20 bg-red-500/10 px-3 py-2">
            <p className="text-[12px] text-red-300">{result.error}</p>
            {result.detail?.slice(0, 4).map((d) => (
              <p key={d} className="mt-0.5 font-mono text-[10px] text-red-400/80">• {d}</p>
            ))}
          </div>
        )}

        {s && result?.equityCurve && (
          <>
            <EquityCurveChart data={result.equityCurve} initialCapital={initialCapital} />

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Return"
                value={`${s.returnPct >= 0 ? "+" : ""}${s.returnPct}%`}
                tone={s.returnPct >= 0 ? "up" : "down"}
              />
              <Stat
                label="Buy & hold"
                value={`${s.holdReturnPct >= 0 ? "+" : ""}${s.holdReturnPct}%`}
                tone={beatsHold ? "muted" : "down"}
                note={beatsHold ? "beaten" : "not beaten"}
              />
              <Stat label="Max drawdown" value={`-${s.maxDrawdownPct}%`} tone="down" />
              <Stat label="Sharpe" value={s.sharpe.toFixed(2)} tone={s.sharpe >= 1 ? "up" : "muted"} />
              <Stat label="Round trips" value={String(s.trades)} tone="muted" />
              <Stat label="Win rate" value={`${s.winRatePct}%`} tone="muted" />
              <Stat label="Fees paid" value={`$${s.feesPaid.toLocaleString()}`} tone="down" />
              <Stat
                label="Funding"
                value={`${s.fundingPaid >= 0 ? "-" : "+"}$${Math.abs(s.fundingPaid).toLocaleString()}`}
                tone={s.fundingPaid > 0 ? "down" : "up"}
              />
            </div>

            <div className="grid gap-1 rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-[10px] text-zinc-500">
              <span>
                {s.barsSimulated.toLocaleString()} bars simulated · {s.warmupBars} bar warmup skipped ·
                {" "}{s.timeInMarketPct}% of bars in a position
              </span>
              <span>
                {s.longFills} long entries · {s.shortFills} short entries · ended flat
              </span>
              {/* Costs are the usual reason a backtest that looks good is not a
                  product. Show them against the gross so the ratio is visible. */}
              <span>
                Costs {`$${(s.feesPaid + Math.max(0, s.fundingPaid)).toLocaleString()}`} against a{" "}
                {`$${initialCapital.toLocaleString()}`} book
              </span>
            </div>

            {result.assumptions && (
              <details className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <summary className="cursor-pointer text-[11px] text-zinc-400">
                  What this number assumes — and cannot tell you
                </summary>
                <ul className="mt-1.5 space-y-1">
                  {result.assumptions.map((a) => (
                    <li key={a} className="text-[11px] leading-relaxed text-zinc-500">• {a}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        {!result && !loading && (
          <p className="py-3 text-center text-[12px] text-zinc-600">
            Run a backtest to see how this strategy would have traded, after fees and funding.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone: "up" | "down" | "muted";
  note?: string;
}) {
  return (
    <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <p className="text-[10px] text-zinc-500">{label}</p>
      <p
        className={cn(
          "font-mono text-[15px] font-semibold",
          tone === "up" ? "text-[#39ff14]" : tone === "down" ? "text-red-400" : "text-zinc-200",
        )}
      >
        {value}
      </p>
      {note && <p className="text-[9px] text-zinc-600">{note}</p>}
    </div>
  );
}
