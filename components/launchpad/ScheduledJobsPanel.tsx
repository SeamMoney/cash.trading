"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { explorerAccountUrl } from "@/lib/constants";
import type { ScheduledJob as ScheduledJobBase } from "@/lib/launchpad/types";

// The API may return extra fields; extend to cover both shapes
type ScheduledJob = ScheduledJobBase & {
  indicatorName?: string;
  market?: string;
  size?: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function timeUntil(ts: number): string {
  if (!ts) return "";
  const diff = ts - Date.now();
  if (diff <= 0) return "now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `in ${s}s`;
  if (s < 3600) return `in ${Math.floor(s / 60)}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h`;
  return `in ${Math.floor(s / 86400)}d`;
}

function parseActionData(job: ScheduledJob): { market: string; allocationPct: number } {
  try {
    if (job.actionData) return JSON.parse(job.actionData);
  } catch { /* ignore */ }
  return { market: job.market ?? "BTC/USD", allocationPct: Math.round((job.actionAmount ?? 0) * 100) };
}

function jobDescription(job: ScheduledJob, nameMap?: Record<string, string>): string {
  const sig = job.expectedSignal === 1 ? "BUY" : job.expectedSignal === 2 ? "SELL" : "all signals";
  const { market, allocationPct } = parseActionData(job);
  const asset = market.split("/")[0];
  const name = job.indicatorName ?? nameMap?.[job.indicatorAddr] ?? job.indicatorAddr?.slice(0, 10) ?? "Bot";

  if (job.triggerType === "signal") {
    return `${name} · ${sig} → Trade ${allocationPct}% ${asset}`;
  }
  if (job.triggerType === "time") {
    const d = job.scheduledTimeMs
      ? new Date(job.scheduledTimeMs).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "?";
    return `Time: ${d} → Trade ${allocationPct}% ${asset}`;
  }
  const dir = job.isPriceAbove ? "above" : "below";
  const thresh = job.priceThreshold != null ? `$${job.priceThreshold.toLocaleString()}` : "$?";
  return `Price ${dir} ${thresh} → Trade ${allocationPct}% ${asset}`;
}

function jobSubline(job: ScheduledJob, nameMap?: Record<string, string>): string {
  const name = job.indicatorName ?? nameMap?.[job.indicatorAddr] ?? job.indicatorAddr?.slice(0, 10) ?? "indicator";

  if (job.status === "executed" && job.executedAt) {
    return `Executed ${timeAgo(job.executedAt)}${job.recurring ? " · will repeat" : ""}`;
  }
  if (job.status === "cancelled") {
    return `Cancelled ${timeAgo(job.createdAt)}`;
  }
  if (job.triggerType === "signal") {
    return `Watching ${name} for signals${job.recurring ? " · recurring" : ""}`;
  }
  if (job.triggerType === "time" && job.scheduledTimeMs) {
    return `Fires ${timeUntil(job.scheduledTimeMs)}`;
  }
  if (job.triggerType === "price") {
    const dir = job.isPriceAbove ? "rises above" : "drops below";
    const thresh = job.priceThreshold != null ? `$${job.priceThreshold.toLocaleString()}` : "$?";
    return `Watching for price to ${dir} ${thresh}`;
  }
  return "";
}

// ─── ScheduledJobsPanel ────────────────────────────────────────────────────────

interface Props {
  extraJobs?: ScheduledJob[]; // jobs added via onScheduled before next poll
}

export function ScheduledJobsPanel({ extraJobs = [] }: Props) {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [indicatorNames, setIndicatorNames] = useState<Record<string, string>>({});

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/launchpad/scheduled");
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs ?? []);
    } catch {
      // silently ignore network errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const t = setInterval(fetchJobs, 10_000);
    return () => clearInterval(t);
  }, [fetchJobs]);

  useEffect(() => {
    async function loadNames() {
      try {
        const res = await fetch("/api/launchpad/indicators");
        if (!res.ok) return;
        const data = await res.json();
        const map: Record<string, string> = {};
        for (const ind of data.indicators ?? []) map[ind.address] = ind.name;
        setIndicatorNames(map);
      } catch { /* ignore */ }
    }
    loadNames();
  }, []);

  // Merge optimistic extraJobs that aren't yet in the polled list
  const merged: ScheduledJob[] = [...jobs];
  for (const ej of extraJobs) {
    if (!merged.find((j) => j.jobId === ej.jobId)) {
      merged.unshift(ej);
    }
  }

  async function cancelJob(jobId: number) {
    setCancellingId(jobId);
    try {
      const res = await fetch(`/api/launchpad/scheduled?jobId=${jobId}`, { method: "DELETE" });
      if (res.ok) {
        setJobs((prev) => prev.map((j) => j.jobId === jobId ? { ...j, status: "cancelled" as const } : j));
      }
    } catch {
      // silently ignore
    } finally {
      setCancellingId(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-4 space-y-2">
        <div className="h-4 w-32 bg-zinc-800 rounded animate-pulse" />
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-14 bg-zinc-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (merged.length === 0) return null;

  const pending = merged.filter((j) => j.status === "pending").length;
  const executed = merged.filter((j) => j.status === "executed").length;

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold font-mono text-zinc-300 tracking-widest uppercase">
            Active Bots
          </span>
          <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-md bg-zinc-800 text-zinc-400">
            {merged.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {pending > 0 && (
            <span className="flex items-center gap-1.5 text-[10px] font-mono text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {pending} PENDING
            </span>
          )}
          {executed > 0 && (
            <span className="text-[10px] font-mono text-emerald-400">
              {executed} EXECUTED
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px] font-mono text-zinc-600">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            LIVE
          </span>
        </div>
      </div>

      {/* Job list */}
      <div className="divide-y divide-[#2a2a2a]">
        {merged.map((job) => {
          const isPending = job.status === "pending";
          const isExecuted = job.status === "executed";
          const isCancelled = job.status === "cancelled";

          return (
            <div
              key={job.jobId}
              className={cn(
                "px-4 py-3 flex items-start gap-3 transition-colors",
                isPending ? "hover:bg-zinc-900/40" : "opacity-60",
              )}
            >
              {/* Status icon */}
              <div className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold font-mono",
                isExecuted ? "bg-emerald-500/20 text-emerald-400" :
                  isCancelled ? "bg-zinc-800 text-zinc-600" :
                    "bg-amber-500/15 text-amber-400",
              )}>
                {isExecuted ? "+" : isCancelled ? "x" : "#"}
              </div>

              <div className="flex-1 min-w-0">
                {/* Description */}
                <p className={cn(
                  "text-xs font-mono font-medium leading-snug",
                  isExecuted ? "text-zinc-300" : isCancelled ? "text-zinc-600 line-through" : "text-white",
                )}>
                  {jobDescription(job, indicatorNames)}
                </p>

                {/* Subline */}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-zinc-600">
                    Created {timeAgo(job.createdAt)}
                  </span>
                  <span className="text-zinc-800">·</span>
                  <span className={cn(
                    "text-[10px] font-mono",
                    isExecuted ? "text-emerald-500" : isCancelled ? "text-zinc-600" : "text-amber-400",
                  )}>
                    {jobSubline(job, indicatorNames)}
                  </span>
                </div>

                {/* Status badge */}
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={cn(
                    "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border",
                    isExecuted ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" :
                      isCancelled ? "border-zinc-800 bg-zinc-900 text-zinc-600" :
                        "border-amber-500/30 bg-amber-500/10 text-amber-400",
                  )}>
                    {isExecuted ? "EXECUTED" : isCancelled ? "CANCELLED" : "PENDING"}
                  </span>
                  <span className="text-[9px] text-zinc-700 font-mono">{job.gasDeposit} APT gas</span>
                  {job.indicatorAddr && (
                    <a
                      href={explorerAccountUrl(job.indicatorAddr)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[9px] font-mono text-purple-400/60 hover:text-purple-300 underline underline-offset-2 decoration-purple-400/20 transition-colors"
                    >
                      view on explorer
                    </a>
                  )}
                </div>
              </div>

              {/* Cancel button */}
              {isPending && (
                <button
                  onClick={() => cancelJob(job.jobId)}
                  disabled={cancellingId === job.jobId}
                  className={cn(
                    "shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-mono font-semibold border transition-colors",
                    cancellingId === job.jobId
                      ? "border-zinc-800 text-zinc-600 cursor-wait"
                      : "border-zinc-800 text-zinc-500 hover:border-red-500/30 hover:text-red-400 hover:bg-red-500/5",
                  )}
                >
                  {cancellingId === job.jobId ? "…" : "Cancel"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
