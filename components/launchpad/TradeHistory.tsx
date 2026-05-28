"use client";

import { useEffect, useState } from "react";

interface TradeEntry {
  tradeId: number;
  signal: number;
  price: number;
  gainBps: number;
  lossBps: number;
  timestamp: number;
  type: "BUY" | "SELL";
  pnlBps: number;
}

interface TradePair {
  entryTrade: TradeEntry;
  exitTrade: TradeEntry | null;
  pnlBps: number;
  pnlPct: number;
}

interface TradeStats {
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  totalGainBps: number;
  totalLossBps: number;
  winRate: number;
  avgGainBps: number;
  avgLossBps: number;
  netPnlBps: number;
}

interface TradeData {
  stats: TradeStats;
  trades: TradeEntry[];
  pairs: TradePair[];
}

interface Props {
  indicatorAddr: string;
}

function fmt(price: number) {
  return price.toLocaleString("en-US", { maximumFractionDigits: 0, style: "currency", currency: "USD" });
}

function fmtBps(bps: number) {
  const pct = bps / 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function fmtTime(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function TradeHistory({ indicatorAddr }: Props) {
  const [data, setData] = useState<TradeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/launchpad/trades?addr=${indicatorAddr}`);
        const json = await res.json();
        if (json.error) { setError(json.error); return; }
        setData(json);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [indicatorAddr]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500 py-4">
        <span className="w-3 h-3 rounded-full bg-zinc-700 animate-pulse" />
        Loading trade history…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-sm text-zinc-500 py-2">
        No attribution data — trades recorded after v2 upgrade only.
      </div>
    );
  }

  const { stats, trades, pairs } = data;

  if (stats.totalTrades === 0) {
    return (
      <div className="text-sm text-zinc-500 py-2">
        No trades recorded yet. Attribution starts on next signal crossover.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3">
        <StatCell label="Trades" value={String(stats.totalTrades)} />
        <StatCell
          label="Win rate"
          value={`${stats.winRate}%`}
          color={stats.winRate >= 50 ? "text-emerald-400" : "text-red-400"}
        />
        <StatCell
          label="Net P&L"
          value={fmtBps(stats.netPnlBps)}
          color={stats.netPnlBps >= 0 ? "text-emerald-400" : "text-red-400"}
        />
        <StatCell
          label="Avg gain"
          value={stats.avgGainBps > 0 ? `+${(stats.avgGainBps / 100).toFixed(1)}%` : "—"}
          color="text-emerald-400"
        />
      </div>

      {/* Trade pairs table */}
      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/60">
              <th className="text-left px-3 py-2 text-zinc-500 font-normal">#</th>
              <th className="text-left px-3 py-2 text-zinc-500 font-normal">Entry</th>
              <th className="text-left px-3 py-2 text-zinc-500 font-normal">Exit</th>
              <th className="text-right px-3 py-2 text-zinc-500 font-normal">P&L</th>
              <th className="text-right px-3 py-2 text-zinc-500 font-normal">Date</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((pair, i) => (
              <tr key={i} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-900/40 transition-colors">
                <td className="px-3 py-2.5 text-zinc-600">{i + 1}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span className="text-zinc-300 font-mono">{fmt(pair.entryTrade.price)}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {pair.exitTrade ? (
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      <span className="text-zinc-300 font-mono">{fmt(pair.exitTrade.price)}</span>
                    </div>
                  ) : (
                    <span className="text-zinc-600">open…</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {pair.exitTrade ? (
                    <span className={pair.pnlBps >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {fmtBps(pair.pnlBps)}
                    </span>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right text-zinc-500">
                  {fmtTime(pair.entryTrade.timestamp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Raw signal feed */}
      {trades.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-zinc-600 uppercase tracking-wide mb-2">Raw signals</div>
          {[...trades].reverse().map((t) => (
            <div key={t.tradeId} className="flex items-center justify-between text-xs py-1 border-b border-zinc-800/30 last:border-0">
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  t.type === "BUY" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                }`}>
                  {t.type}
                </span>
                <span className="font-mono text-zinc-300">{fmt(t.price)}</span>
              </div>
              <div className="flex items-center gap-3">
                {t.type === "SELL" && (t.gainBps > 0 || t.lossBps > 0) && (
                  <span className={t.gainBps > 0 ? "text-emerald-400" : "text-red-400"}>
                    {t.gainBps > 0 ? fmtBps(t.gainBps) : fmtBps(-t.lossBps)}
                  </span>
                )}
                <span className="text-zinc-600">{fmtTime(t.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  color = "text-zinc-100",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-zinc-900/50 rounded-lg p-3 border border-zinc-800">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}
