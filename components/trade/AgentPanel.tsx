"use client";

import { useState, useEffect } from "react";
import { explorerTxUrl } from "@/lib/constants";

interface AgentTrade {
  timestamp: number;
  market: string;
  side: "buy" | "sell";
  size: number;
  txHash: string;
  type: string;
  error?: string;
}

export function AgentPanel() {
  const [running, setRunning] = useState(false);
  const [trades, setTrades] = useState<AgentTrade[]>([]);
  const [totalTrades, setTotalTrades] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/agent/status");
        const data = await res.json();
        setRunning(data.running);
        setTrades(data.trades || []);
        setTotalTrades(data.totalTrades || 0);
      } catch {
        // ignore
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  const toggle = async () => {
    setLoading(true);
    setError(null);
    try {
      if (running) {
        await fetch("/api/agent/stop", { method: "POST" });
        setRunning(false);
      } else {
        const res = await fetch("/api/agent/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            markets: ["BTC/USD", "ETH/USD"],
            intervalMs: 45000,
          }),
        });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setRunning(true);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-1 glow-accent rounded-[16px] p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/20">
            Agent Mode
          </span>
          <span
            className={`w-2 h-2 rounded-full ${
              running ? "bg-green-400 animate-pulse" : "bg-muted"
            }`}
          />
          <span className="text-[13px]">
            {running ? "Running" : "Stopped"}
            {totalTrades > 0 && (
              <span className="text-zinc-500 ml-2">
                ({totalTrades} trades)
              </span>
            )}
          </span>
        </div>
        <button
          onClick={toggle}
          disabled={loading}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-medium transition-all duration-200 ease-out disabled:opacity-40 ${
            running
              ? "bg-red-500/10 text-danger hover:bg-red-500/20"
              : "bg-green-500/10 text-success hover:bg-green-500/20"
          }`}
        >
          {loading ? "..." : running ? "Stop Agent" : "Start Agent"}
        </button>
      </div>

      {error && (
        <div className="text-[12px] text-danger bg-red-500/10 rounded-[10px] p-2 mb-3">
          {error}
        </div>
      )}

      <p className="text-[12px] text-zinc-500 mb-3">
        Autonomous TWAP orders on BTC/USD and ETH/USD every 45s. Demonstrates
        real on-chain trading volume via Decibel.
      </p>

      {trades.length > 0 && (
        <div className="max-h-48 overflow-y-auto no-scrollbar space-y-1 border-t border-white/5 pt-3">
          {trades
            .slice()
            .reverse()
            .slice(0, 20)
            .map((t, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-[11px]"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`font-medium ${
                      t.side === "buy" ? "text-success" : "text-danger"
                    }`}
                  >
                    {t.side.toUpperCase()}
                  </span>
                  <span className="font-mono tabular-nums">
                    {t.size > 0 ? t.size.toFixed(4) : "—"}
                  </span>
                  <span className="text-zinc-500">{t.market}</span>
                  {t.error && (
                    <span className="text-danger truncate max-w-32">
                      {t.error}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {t.txHash && (
                    <a
                      href={explorerTxUrl(t.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-accent hover:underline"
                    >
                      {t.txHash.slice(0, 8)}...
                    </a>
                  )}
                  <span className="text-zinc-500">
                    {new Date(t.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
