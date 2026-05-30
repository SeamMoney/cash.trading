"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_INDICATOR = {
  address: "0x84e97e617cd275107a9eeced20342c99aae15cffada83d004cac23fb72b8f320",
  name: "EMA Ribbon",
  symbol: "EMARIB",
  algoHash: "0x84e97e617cd275107a9eeced20342c99aae15cffada83d004cac23fb72b8f320",
  commitTs: Date.now() - 7 * 86_400_000,
  creatorFeeBps: 200,
  creatorFeeModel: "profit_share" as const,
  creatorEarningsUsdt: 12.48,
  subscribers: 23,
  totalVolumeUsdt: 4_218_400,
  totalPayouts: 47,
  asset: "ETH/USD",
  strategy: "EMA Ribbon · Trend Reversal · Profit Share",
};

// 90 days of daily earnings — organic: trend + volatility clusters + weekend dips + quiet stretches
const DAILY_DATA_90 = Array.from({ length: 90 }, (_, i) => {
  const date = new Date(2024, 0, 1);
  date.setDate(date.getDate() + i);
  const dow = date.getDay(); // 0=Sun, 6=Sat
  const isWeekend = dow === 0 || dow === 6;

  // Slow upward trend
  const trend = i * 0.55;
  // Two overlapping sine cycles for realistic "quiet/volatile" stretches
  const wave1 = Math.sin(i / 11.3) * 22;
  const wave2 = Math.sin(i / 3.7 + 1.2) * 9;
  // Deterministic "pseudo-random" noise via prime arithmetic
  const noise = ((i * 17 + 31) % 43) - 21 + ((i * 7 + 11) % 19) - 9;
  // Occasional spike days (every ~3 weeks)
  const spike = (i % 22 === 0 || i % 22 === 1) ? 28 : 0;
  // Weekend penalty
  const wkMult = isWeekend ? 0.28 : 1.0;

  const raw = (18 + trend + wave1 + wave2 + noise + spike) * wkMult;
  return {
    day: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    value: Math.max(0, Math.round(raw)),
  };
});

const RECENT_PAYOUTS = [
  { id: "0x1a2f", bot: "0x1a2f4e8d…c6b2", amount: 12.40, asset: "BTC", pnl: 124.0, time: "2m ago" },
  { id: "0x3f8a", bot: "0x3f8a1c9b…e4d7", amount:  8.20, asset: "BTC", pnl:  82.0, time: "41m ago" },
  { id: "0x9d2c", bot: "0x9d2c7f4a…b3e0", amount: 15.80, asset: "BTC", pnl: 158.0, time: "1h 12m ago" },
  { id: "0x5b1e", bot: "0x5b1e3a8d…f5c8", amount:  6.50, asset: "BTC", pnl:  65.0, time: "3h 8m ago" },
  { id: "0x2c7f", bot: "0x2c7f9b4e…a7d3", amount: 19.20, asset: "BTC", pnl: 192.0, time: "5h 44m ago" },
  { id: "0x8e4a", bot: "0x8e4a2d1c…0c7a", amount:  9.85, asset: "BTC", pnl:  98.5, time: "9h 21m ago" },
];

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function EarningsTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/[0.08] bg-[#141414] px-3 py-2 text-[10px] font-mono shadow-xl">
      <div className="text-zinc-500 mb-0.5">{label}</div>
      <div className="text-emerald-400 font-bold">${payload[0].value.toFixed(2)}</div>
    </div>
  );
}

// ─── Stat tile ────────────────────────────────────────────────────────────────

function StatTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">{label}</div>
      <div className={cn("text-[18px] font-bold font-mono tabular-nums leading-none", accent ? "text-emerald-400" : "text-white")}>{value}</div>
      {sub && <div className="text-[9px] font-mono text-zinc-600">{sub}</div>}
    </div>
  );
}

// ─── Creator Dashboard ────────────────────────────────────────────────────────

interface Props { creatorAddr?: string }

export function CreatorDashboard({ creatorAddr }: Props) {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");
  const [pendingEarnings, setPendingEarnings] = useState(MOCK_INDICATOR.creatorEarningsUsdt);
  const [withdrawState, setWithdrawState] = useState<{
    status: "idle" | "submitting" | "paid" | "pending" | "failed";
    message?: string;
    txHash?: string;
    explorerUrl?: string;
    payoutId?: string;
  }>({ status: "idle" });

  const chartData = period === "7d" ? DAILY_DATA_90.slice(-7) : period === "30d" ? DAILY_DATA_90.slice(-30) : DAILY_DATA_90;
  const weekTotal = DAILY_DATA_90.slice(-7).reduce((s, v) => s + v.value, 0);
  const prevWeekTotal = DAILY_DATA_90.slice(-14, -7).reduce((s, v) => s + v.value, 0);
  const weekPct = ((weekTotal - prevWeekTotal) / prevWeekTotal * 100).toFixed(1);

  const ind = MOCK_INDICATOR;
  const shortHash = `${ind.algoHash.slice(0, 8)}…${ind.algoHash.slice(-6)}`;
  const daysSince = Math.floor((Date.now() - ind.commitTs) / 86_400_000);
  const canWithdraw = pendingEarnings > 0 && withdrawState.status !== "submitting";

  async function handleWithdraw() {
    if (!creatorAddr || !canWithdraw) return;

    setWithdrawState({ status: "submitting", message: "Verifying payout path..." });
    try {
      const res = await fetch("/api/launchpad/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          indicatorAddr: ind.address,
          creatorAddr,
        }),
      });
      const data = await res.json() as {
        success?: boolean;
        status?: string;
        error?: string;
        pendingEarningsUsdt?: number;
        txHash?: string;
        explorerUrl?: string;
        payoutId?: string;
      };

      if (data.success && data.txHash && data.payoutId) {
        setPendingEarnings(0);
        setWithdrawState({
          status: "paid",
          message: "Withdrawn",
          txHash: data.txHash,
          explorerUrl: data.explorerUrl,
          payoutId: data.payoutId,
        });
        return;
      }

      setPendingEarnings(data.pendingEarningsUsdt ?? pendingEarnings);
      setWithdrawState({
        status: res.status === 202 || data.status?.startsWith("pending") ? "pending" : "failed",
        message: data.error || "Withdrawal is not complete.",
      });
    } catch (err) {
      setWithdrawState({
        status: "failed",
        message: err instanceof Error ? err.message : "Withdrawal failed",
      });
    }
  }

  if (!creatorAddr) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-[#0f0f0f] p-10 text-center">
        <div className="w-10 h-10 rounded-xl bg-[#39ff14]/10 flex items-center justify-center mx-auto mb-3">
          <svg className="w-5 h-5 text-[#39ff14]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <p className="text-sm text-zinc-300 font-medium mb-1">Connect wallet to view creator earnings</p>
        <p className="text-xs text-zinc-600">Your proprietary indicators and pending USDT will appear here</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">

        {/* ── Header row ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">Creator Dashboard</span>
              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold font-mono bg-[#39ff14]/10 text-[#39ff14] border border-[#39ff14]/20 uppercase tracking-wide">Pro</span>
            </div>
            <p className="text-[11px] text-zinc-500 font-mono">{creatorAddr.slice(0, 10)}…{creatorAddr.slice(-8)}</p>
          </div>
          <div className="text-right">
            <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mb-0.5">Pending</div>
            <div className="text-[22px] font-bold font-mono text-emerald-400 tabular-nums leading-none">
              ${pendingEarnings.toFixed(2)}
            </div>
            <div className="text-[9px] font-mono text-zinc-600 mt-0.5">USDT pending</div>
          </div>
        </div>

        {/* ── Indicator card ── */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0f0f0f] overflow-hidden">

          {/* Indicator header */}
          <div className="px-5 py-4 border-b border-white/[0.04]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[13px] font-bold text-white font-mono">{ind.symbol}</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold font-mono border border-amber-500/30 bg-amber-500/8 text-amber-400 uppercase tracking-wide">
                    <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 1a4 4 0 0 0-4 4v1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm-2 5V5a2 2 0 1 1 4 0v1H6z"/>
                    </svg>
                    Proprietary
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 mb-2">{ind.name}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] font-mono text-zinc-600">
                  <span className="text-zinc-500">{ind.strategy}</span>
                  <span>·</span>
                  <span>{ind.asset}</span>
                  <span>·</span>
                  <span className="text-amber-400/70">{(ind.creatorFeeBps / 100).toFixed(0)}% profit share</span>
                  <span>·</span>
                  <span>SHA-256: {shortHash}</span>
                  <span>·</span>
                  <span>committed {daysSince}d ago</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleWithdraw}
                disabled={!canWithdraw}
                aria-disabled={!canWithdraw}
                className={cn(
                  "shrink-0 px-4 py-2 rounded-xl text-[12px] font-semibold font-mono transition-all duration-200",
                  canWithdraw
                    ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/15"
                    : "bg-zinc-900 text-zinc-500 border border-white/[0.06] cursor-not-allowed"
                )}
              >
                {withdrawState.status === "submitting"
                  ? "Verifying..."
                  : withdrawState.status === "paid"
                    ? "Withdrawn"
                    : "Withdraw"}
              </button>
            </div>
            {withdrawState.status !== "idle" && (
              <div
                className={cn(
                  "mt-3 rounded-lg border px-3 py-2 text-[10px] font-mono",
                  withdrawState.status === "paid"
                    ? "border-emerald-500/20 bg-emerald-500/8 text-emerald-300"
                    : withdrawState.status === "pending"
                      ? "border-amber-500/20 bg-amber-500/8 text-amber-300"
                      : withdrawState.status === "failed"
                        ? "border-red-500/20 bg-red-500/8 text-red-300"
                        : "border-white/[0.06] bg-white/[0.03] text-zinc-400",
                )}
              >
                <span>{withdrawState.message}</span>
                {withdrawState.payoutId && <span className="ml-2 text-zinc-500">{withdrawState.payoutId}</span>}
                {withdrawState.explorerUrl && (
                  <a
                    href={withdrawState.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 text-emerald-200 underline decoration-emerald-400/40 underline-offset-2"
                  >
                    View tx
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 divide-x divide-white/[0.04] border-b border-white/[0.04]">
            <div className="px-5 py-3.5">
              <StatTile label="Total earned" value={`$${(pendingEarnings + 2562.75).toFixed(2)}`} sub="all time" accent />
            </div>
            <div className="px-5 py-3.5">
              <StatTile label="This week" value={`$${weekTotal.toFixed(2)}`} sub={`+${weekPct}% vs last wk`} />
            </div>
            <div className="px-5 py-3.5">
              <StatTile label="Active bots" value={`${ind.subscribers}`} sub="using this algo" />
            </div>
            <div className="px-5 py-3.5">
              <StatTile label="Vol. processed" value="$4.2M" sub="USDT notional" />
            </div>
          </div>

          {/* Earnings chart */}
          <div className="px-5 pt-4 pb-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">Daily earnings (USDT)</span>
              <div className="flex gap-1">
                {(["7d", "30d", "90d"] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={cn(
                      "px-2 py-0.5 rounded text-[9px] font-mono transition-colors",
                      period === p ? "bg-white/8 text-zinc-300" : "text-zinc-600 hover:text-zinc-400"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" aspect={4}>
              <BarChart data={chartData} barGap={1} barCategoryGap={chartData.length > 30 ? "8%" : "18%"}>
                <defs>
                  <linearGradient id="barGradActive" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#39ff14" stopOpacity="1" />
                    <stop offset="100%" stopColor="#39ff14" stopOpacity="0.55" />
                  </linearGradient>
                  <linearGradient id="barGradDim" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#39ff14" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#39ff14" stopOpacity="0.12" />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.035)" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 8, fontFamily: "monospace", fill: "#3f3f46" }}
                  axisLine={false}
                  tickLine={false}
                  interval={Math.ceil(chartData.length / 8) - 1}
                />
                <Tooltip content={<EarningsTooltip />} cursor={{ fill: "rgba(255,255,255,0.025)", radius: 3 }} />
                <Bar dataKey="value" radius={[3, 3, 1, 1]} maxBarSize={chartData.length > 30 ? 14 : 22}>
                  {chartData.map((entry, index) => {
                    const isRecent = index >= chartData.length - 7;
                    const intensity = entry.value / Math.max(...chartData.map(d => d.value));
                    return (
                      <Cell
                        key={index}
                        fill={isRecent ? "url(#barGradActive)" : "url(#barGradDim)"}
                        fillOpacity={isRecent ? 0.85 + intensity * 0.15 : 0.5 + intensity * 0.4}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Recent payouts ── */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#0f0f0f] overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.04] flex items-center justify-between">
            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">Recent payouts</span>
            <span className="text-[9px] font-mono text-zinc-600">{ind.totalPayouts} total</span>
          </div>
          <div className="divide-y divide-white/[0.03]">
            {RECENT_PAYOUTS.map((tx) => (
              <div key={tx.id} className="px-5 py-2.5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono text-zinc-400 truncate">
                      Profit share · bot {tx.bot}
                    </div>
                    <div className="text-[9px] font-mono text-zinc-700">{tx.time}</div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[11px] font-bold font-mono text-emerald-400 tabular-nums">+${tx.amount.toFixed(2)}</div>
                  <div className="text-[9px] font-mono text-zinc-700 tabular-nums">on ${tx.pnl.toFixed(0)} pnl</div>
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-white/[0.04]">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono text-zinc-600">
                <span className="text-zinc-400 font-bold">1</span> proprietary indicator · <span className="text-zinc-400 font-bold">{ind.subscribers}</span> active bots
              </span>
              <span className="text-[9px] font-mono text-zinc-700">On-chain · Aptos mainnet</span>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
