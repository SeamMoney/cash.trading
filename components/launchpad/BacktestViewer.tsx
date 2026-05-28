"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { EquityCurveChart } from "./EquityCurveChart";

interface BacktestResult {
  simId: number; sharpe: number; returnBps: number;
  maxDrawdownBps: number; profitable: boolean; trades: number; winRate: number;
}
interface BacktestSummary {
  totalSims: number; profitableCount: number; profitablePct: number;
  meanSharpe: number; meanReturnBps: number; maxDrawdownBps: number;
  robustnessScore: number; seed: string; candlesUsed: number;
}
interface BacktestViewerProps {
  indicatorAddr: string; indicatorName: string; params?: number[]; asset?: string;
}

export function BacktestViewer({ indicatorAddr, indicatorName, params = [5, 20], asset = "BTC/USD" }: BacktestViewerProps) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [equityCurve, setEquityCurve] = useState<{ t: number; v: number }[]>([]);
  const [numSims, setNumSims] = useState(100);
  const [error, setError] = useState<string | null>(null);

  async function runBacktest() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/launchpad/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indicatorAddr, numSims, asset, params }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed"); }
      const data = await res.json();
      setSummary(data.summary); setResults(data.results); setEquityCurve(data.equityCurve || []);
    } catch (err) { setError(err instanceof Error ? err.message : "Unknown error"); }
    finally { setLoading(false); }
  }

  const sharpeVal = summary ? summary.meanSharpe / 1000 : 0;
  const isGoodSharpe = sharpeVal >= 1.5;
  const isGoodWin = summary ? summary.profitablePct >= 80 : false;
  const isGoodRobustness = summary ? summary.robustnessScore >= 70 : false;
  const graduationReady = isGoodSharpe && isGoodWin && isGoodRobustness && (summary?.totalSims ?? 0) >= 1000;

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] overflow-hidden">
      <div className="px-4 pt-3 pb-3 border-b border-[#2a2a2a] flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold font-display text-white">Backtest</h3>
          <p className="text-[11px] text-zinc-500">{indicatorName} · Monte Carlo Bootstrap</p>
        </div>
        {graduationReady && (
          <span className="text-[10px] font-medium bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full border border-green-500/30 whitespace-nowrap">
            Ready to Graduate ✓
          </span>
        )}
      </div>

      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <select value={numSims} onChange={(e) => setNumSims(Number(e.target.value))}
            className="bg-[#181818] border border-[#2a2a2a] rounded-lg px-2 py-1.5 text-xs text-white flex-1 focus:outline-none focus:border-white/20">
            <option value={100}>100 sims</option>
            <option value={500}>500 sims</option>
            <option value={1000}>1,000 sims</option>
            <option value={5000}>5,000 sims</option>
            <option value={10000}>10,000 sims</option>
          </select>
          <button onClick={runBacktest} disabled={loading}
            className={cn("px-4 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-1.5",
              loading ? "bg-[#202020] border border-[#2a2a2a] text-zinc-500 cursor-wait" : "bg-white text-black hover:bg-zinc-100")}>
            {loading && (
              <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {loading ? "Running…" : "Run Backtest"}
          </button>
        </div>

        {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

        {equityCurve.length > 0 && <EquityCurveChart data={equityCurve} initialCapital={10000} />}

        {summary && (
          <>
            <div key={summary.seed} className="grid grid-cols-3 gap-2">
              <StatBox label="Sharpe"     value={sharpeVal.toFixed(2)}                                                             color={isGoodSharpe ? "green" : sharpeVal >= 1 ? "yellow" : "red"}                                  check={isGoodSharpe}  threshold="≥ 1.5"  index={0} />
              <StatBox label="Win Rate"   value={`${summary.profitablePct}%`}                                                      color={isGoodWin ? "green" : summary.profitablePct >= 65 ? "yellow" : "red"}                         check={isGoodWin}     threshold="≥ 80%"  index={1} />
              <StatBox label="Robustness" value={`${summary.robustnessScore}`}                                                     color={isGoodRobustness ? "green" : summary.robustnessScore >= 40 ? "yellow" : "red"}                check={isGoodRobustness} threshold="≥ 70" index={2} />
              <StatBox label="Return"     value={`${summary.meanReturnBps >= 0 ? "+" : ""}${(summary.meanReturnBps / 100).toFixed(1)}%`} color={summary.meanReturnBps > 0 ? "green" : "red"}                                                                        index={3} />
              <StatBox label="Max DD"     value={`-${(summary.maxDrawdownBps / 100).toFixed(1)}%`}                                 color="red"                                                                                                                         index={4} />
              <StatBox label="Sims"       value={summary.totalSims.toLocaleString()}                                               color="zinc"                                                                                                                        index={5} />
            </div>

            <div className="bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-2 space-y-1">
              <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wide mb-1.5">Graduation Thresholds</p>
              <ThresholdRow label="Sharpe ≥ 1.5"    met={isGoodSharpe}                 value={sharpeVal.toFixed(2)} />
              <ThresholdRow label="Win rate ≥ 80%"  met={isGoodWin}                    value={`${summary.profitablePct}%`} />
              <ThresholdRow label="Robustness ≥ 70" met={isGoodRobustness}             value={String(summary.robustnessScore)} />
              <ThresholdRow label="Min 1,000 sims"  met={summary.totalSims >= 1000}    value={summary.totalSims.toLocaleString()} />
            </div>
          </>
        )}

        {results.length > 0 && (
          <div>
            <p className="text-[10px] text-zinc-500 mb-1.5">Individual Simulations (first {results.length})</p>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-[#2a2a2a]">
              <table className="w-full text-xs">
                <thead className="text-zinc-500 border-b border-[#2a2a2a] sticky top-0 bg-[#0d0d0d]">
                  <tr>
                    <th className="text-left px-2 py-1.5">#</th>
                    <th className="text-right px-2">Sharpe</th>
                    <th className="text-right px-2">Return</th>
                    <th className="text-right px-2">Max DD</th>
                    <th className="text-right px-2">Win%</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.simId} className="border-b border-[#1e1e1e] hover:bg-[#181818]/50">
                      <td className="px-2 py-1 text-zinc-600">{r.simId + 1}</td>
                      <td className={cn("px-2 text-right font-mono", r.sharpe >= 1500 ? "text-green-400" : r.sharpe >= 1000 ? "text-yellow-400" : "text-zinc-400")}>{(r.sharpe / 1000).toFixed(2)}</td>
                      <td className={cn("px-2 text-right font-mono", r.returnBps > 0 ? "text-green-400" : "text-red-400")}>{(r.returnBps / 100).toFixed(1)}%</td>
                      <td className="px-2 text-right font-mono text-red-400">-{(r.maxDrawdownBps / 100).toFixed(1)}%</td>
                      <td className="px-2 text-right font-mono text-zinc-400">{r.winRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {summary && (
          <p className="text-[10px] text-zinc-600">Seed {summary.seed.slice(0, 16)}… · {summary.candlesUsed} candles · reproducible via 0x1::randomness</p>
        )}

        {!summary && !loading && (
          <p className="text-xs text-zinc-600 text-center py-4">Run a backtest to see Sharpe, equity curve, and graduation readiness</p>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, color, check, threshold, index = 0 }: { label: string; value: string; color: string; check?: boolean; threshold?: string; index?: number }) {
  const c = color === "green" ? "text-green-400" : color === "yellow" ? "text-yellow-400" : color === "red" ? "text-red-400" : "text-zinc-300";
  return (
    <div
      className="bg-[#181818] border border-[#1e1e1e] rounded-lg p-2 stat-pop"
      style={{ animationDelay: `${index * 0.05}s`, animationFillMode: "both" }}
    >
      <p className="text-[10px] text-zinc-500">{label}</p>
      <div className="flex items-center gap-1">
        <p className={cn("text-sm font-mono font-semibold", c)}>{value}</p>
        {check !== undefined && <span className={check ? "text-green-400 text-[10px]" : "text-zinc-600 text-[10px]"}>{check ? "✓" : "·"}</span>}
      </div>
      {threshold && <p className="text-[9px] text-zinc-600 mt-0.5">{threshold}</p>}
    </div>
  );
}

function ThresholdRow({ label, met, value }: { label: string; met: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <div className="flex items-center gap-1.5">
        <span className={met ? "text-green-400" : "text-zinc-600"}>{met ? "✓" : "○"}</span>
        <span className={met ? "text-zinc-300" : "text-zinc-500"}>{label}</span>
      </div>
      <span className={cn("font-mono", met ? "text-green-400" : "text-zinc-500")}>{value}</span>
    </div>
  );
}
