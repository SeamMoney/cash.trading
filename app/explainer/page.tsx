"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { motion, useInView } from "framer-motion"

// ─── Constants ────────────────────────────────────────────────────────────────

const YELLOW = "#39ff14"

const MARKETS = [
  { name: "BTC/USD",  color: "#f7931a", leverage: "40x" },
  { name: "ETH/USD",  color: "#627eea", leverage: "20x" },
  { name: "SOL/USD",  color: "#9945ff", leverage: "10x" },
  { name: "APT/USD",  color: "#00d4ff", leverage: "10x" },
  { name: "XRP/USD",  color: "#00aae4", leverage: "10x" },
  { name: "HYPE/USD", color: "#ff6b35", leverage: "5x"  },
  { name: "AAVE/USD", color: "#b6509e", leverage: "5x"  },
  { name: "ADA/USD",  color: "#0057ff", leverage: "5x"  },
  { name: "BNB/USD",  color: "#f3ba2f", leverage: "5x"  },
  { name: "DOGE/USD", color: "#c2a633", leverage: "5x"  },
  { name: "LINK/USD", color: "#2a5ada", leverage: "5x"  },
  { name: "NEAR/USD", color: "#00c08b", leverage: "5x"  },
  { name: "SUI/USD",  color: "#4da2ff", leverage: "5x"  },
  { name: "ZEC/USD",  color: "#ecb244", leverage: "5x"  },
  { name: "WLFI/USD", color: "#ff4d4d", leverage: "3x"  },
]

const SIM_ORDERS = [
  { id: 0, market: "BTC/USD",  side: "LONG",  size: "$10,000", color: "#f7931a" },
  { id: 1, market: "ETH/USD",  side: "SHORT", size: "$5,000",  color: "#627eea" },
  { id: 2, market: "SOL/USD",  side: "LONG",  size: "$2,500",  color: "#9945ff" },
  { id: 3, market: "APT/USD",  side: "LONG",  size: "$1,000",  color: "#00d4ff" },
  { id: 4, market: "XRP/USD",  side: "SHORT", size: "$3,000",  color: "#00aae4" },
]

const PROCESS_MS  = 600
const SERIAL_GAP  = 60

// ─── Animated counter ─────────────────────────────────────────────────────────

function Counter({
  target,
  prefix = "",
  suffix = "",
  decimals = 0,
}: {
  target: number
  prefix?: string
  suffix?: string
  decimals?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: "-50px" })
  const [v, setV] = useState(0)

  useEffect(() => {
    if (!inView) return
    const t0 = performance.now()
    const dur = 1400
    function tick(now: number) {
      const p = Math.min((now - t0) / dur, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setV(eased * target)
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [inView, target])

  const display = decimals > 0
    ? v.toFixed(decimals)
    : Math.round(v).toLocaleString()

  return <span ref={ref}>{prefix}{display}{suffix}</span>
}

// ─── Section fade-in wrapper ──────────────────────────────────────────────────

function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: "-80px" })
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 22 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ─── Execution simulation ─────────────────────────────────────────────────────

type Phase = "idle" | "processing" | "done"

function Simulation() {
  const [mode, setMode]   = useState<"parallel" | "serial">("parallel")
  const [phases, setPhases] = useState<Phase[]>(Array(5).fill("idle"))
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }

  const reset = useCallback(() => {
    clearTimers()
    setPhases(Array(5).fill("idle"))
    setRunning(false)
    setElapsed(null)
  }, [])

  useEffect(() => () => clearTimers(), [])

  const run = () => {
    clearTimers()
    setPhases(Array(5).fill("idle"))
    setElapsed(null)
    setRunning(true)
    const t0 = Date.now()

    if (mode === "parallel") {
      const a = setTimeout(() => setPhases(Array(5).fill("processing")), 60)
      const b = setTimeout(() => {
        setPhases(Array(5).fill("done"))
        setElapsed(Date.now() - t0)
        setRunning(false)
      }, 60 + PROCESS_MS)
      timers.current = [a, b]
    } else {
      const all: ReturnType<typeof setTimeout>[] = []
      for (let i = 0; i < 5; i++) {
        const start = i * (PROCESS_MS + SERIAL_GAP)
        const t1 = setTimeout(() => {
          setPhases(prev => { const n = [...prev]; n[i] = "processing"; return n })
        }, 60 + start)
        const t2 = setTimeout(() => {
          setPhases(prev => { const n = [...prev]; n[i] = "done"; return n })
        }, 60 + start + PROCESS_MS)
        all.push(t1, t2)
      }
      const total = 5 * (PROCESS_MS + SERIAL_GAP)
      const t3 = setTimeout(() => {
        setElapsed(Date.now() - t0)
        setRunning(false)
      }, 60 + total)
      all.push(t3)
      timers.current = all
    }
  }

  const parallelMs = PROCESS_MS + 60
  const serialMs   = 5 * (PROCESS_MS + SERIAL_GAP) + 60

  return (
    <div className="bg-white/[0.025] border border-white/10 rounded-2xl p-6 space-y-6">
      {/* Mode tabs + run button */}
      <div className="flex flex-wrap gap-2 items-center">
        {(["parallel", "serial"] as const).map(m => (
          <button
            key={m}
            onClick={() => { setMode(m); reset() }}
            className="px-4 py-2 text-xs font-mono rounded-lg border transition-all"
            style={{
              borderColor: mode === m
                ? m === "parallel" ? YELLOW : "#ef4444"
                : "rgba(255,255,255,0.12)",
              color: mode === m
                ? m === "parallel" ? YELLOW : "#ef4444"
                : "rgba(255,255,255,0.35)",
              backgroundColor: mode === m
                ? m === "parallel" ? "rgba(255,246,0,0.07)" : "rgba(239,68,68,0.07)"
                : "transparent",
            }}
          >
            {m === "parallel" ? "Decibel on Aptos (parallel)" : "Traditional DEX (serial)"}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-3">
          {elapsed !== null && !running && (
            <motion.span
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-xs font-mono"
              style={{ color: mode === "parallel" ? YELLOW : "#ef4444" }}
            >
              {elapsed}ms total
              {mode === "parallel" && (
                <span className="text-white/30 ml-2">({Math.round(serialMs / elapsed)}× faster)</span>
              )}
            </motion.span>
          )}
          <button
            onClick={running ? undefined : run}
            disabled={running}
            className="px-4 py-2 text-xs font-mono rounded-lg border border-white/20 text-white/60
                       hover:border-white/40 hover:text-white transition-all
                       disabled:opacity-25 disabled:cursor-not-allowed"
          >
            {running ? "running…" : "▶ run"}
          </button>
        </div>
      </div>

      {/* Order rows */}
      <div className="space-y-2.5">
        {SIM_ORDERS.map((order, i) => {
          const phase = phases[i]
          return (
            <div key={order.id} className="flex items-center gap-4">
              {/* Market */}
              <div className="w-20 shrink-0 text-right">
                <span className="text-xs font-mono" style={{ color: order.color + "bb" }}>
                  {order.market}
                </span>
              </div>

              {/* Track */}
              <div className="flex-1 h-10 bg-white/[0.035] rounded-lg relative overflow-hidden">
                {/* Fill bar — CSS transition does the animation */}
                <div
                  className="absolute inset-y-0 left-0 rounded-lg"
                  style={{
                    width: phase === "idle" ? "0%" : "100%",
                    backgroundColor: phase === "done"
                      ? order.color + "35"
                      : order.color + "1a",
                    borderRight: phase !== "idle"
                      ? `2px solid ${order.color}${phase === "done" ? "cc" : "66"}`
                      : "none",
                    transition: `width ${PROCESS_MS}ms linear`,
                  }}
                />

                {/* Text overlay */}
                <div className="absolute inset-0 flex items-center px-3">
                  <span
                    className="text-xs font-mono select-none"
                    style={{
                      color: phase === "idle"
                        ? "rgba(255,255,255,0.18)"
                        : phase === "processing"
                        ? "rgba(255,255,255,0.55)"
                        : order.color,
                    }}
                  >
                    {phase === "idle"       && "waiting"}
                    {phase === "processing" && `${order.side} ${order.size} — matching…`}
                    {phase === "done"       && `${order.side} ${order.size} — filled ✓`}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Explanation banner */}
      <motion.div
        key={mode}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="px-4 py-3 rounded-lg border text-xs font-mono"
        style={{
          borderColor: mode === "parallel" ? YELLOW + "30" : "#ef444430",
          backgroundColor: mode === "parallel" ? "rgba(255,246,0,0.04)" : "rgba(239,68,68,0.04)",
          color: mode === "parallel" ? YELLOW + "80" : "#ef4444aa",
        }}
      >
        {mode === "parallel"
          ? `Block-STM detects zero conflicts across isolated markets — all 5 orders execute simultaneously. Latency: ~${parallelMs}ms regardless of order volume.`
          : `Each order writes to the global order index, blocking subsequent orders. 5 orders × ${PROCESS_MS}ms = ~${Math.round(serialMs / 1000 * 10) / 10}s minimum latency.`
        }
      </motion.div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ExplainerPage() {
  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-yellow-400/20">

      {/* ── Nav ── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/[0.06] bg-black/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-sm tracking-tight" style={{ color: YELLOW }}>
              DECIBEL
            </span>
            <span className="text-white/20 text-xs font-mono">/ explainer</span>
          </div>
          <a
            href="/"
            className="px-4 py-1.5 text-xs font-mono rounded-lg border transition-all hover:opacity-80"
            style={{ borderColor: YELLOW + "80", color: YELLOW }}
          >
            Launch App →
          </a>
        </div>
      </nav>

      {/* ── Content ── */}
      <div className="max-w-3xl mx-auto px-6 pt-32 pb-28 space-y-24">

        {/* ── Hero ── */}
        <Reveal>
          <div className="space-y-7">
            {/* Live badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03]">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs font-mono text-white/50">Live on Aptos Mainnet · v11</span>
            </div>

            {/* Headline */}
            <h1 className="text-4xl sm:text-[52px] font-bold font-mono leading-[1.1] tracking-tight">
              A real order book.<br />
              <span style={{ color: YELLOW }}>Fully on-chain.</span>
            </h1>

            <p className="text-white/50 text-lg leading-relaxed max-w-lg">
              Decibel runs a fully on-chain perpetual futures exchange on Aptos — with limit orders,
              stop-losses, and deep liquidity — without sacrificing speed or decentralization.
            </p>

            {/* Stats bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/[0.08] rounded-2xl overflow-hidden border border-white/10">
              {[
                { label: "All-time volume", target: 986,  prefix: "$", suffix: "M" },
                { label: "Vault TVL",       target: 39.5, prefix: "$", suffix: "M", decimals: 1 },
                { label: "Live markets",    target: 15 },
                { label: "Order latency",   target: 600,  suffix: "ms" },
              ].map(stat => (
                <div key={stat.label} className="bg-black px-5 py-5">
                  <div className="text-2xl sm:text-3xl font-mono font-bold tabular-nums" style={{ color: YELLOW }}>
                    <Counter {...stat} />
                  </div>
                  <div className="text-xs font-mono text-white/30 mt-1.5">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        <Divider />

        {/* ── Problem ── */}
        <Reveal>
          <div className="space-y-7">
            <SectionLabel>The problem</SectionLabel>
            <h2 className="text-2xl sm:text-3xl font-mono font-bold">
              Why on-chain order books<br />don't exist
            </h2>

            <p className="text-white/50 leading-relaxed">
              Real order books require concurrent order matching. Every order writes to shared
              state — the order book data structure. On most blockchains, transactions touching
              the same state are forced to run serially, one after another. The result: either
              you sacrifice order book functionality (AMMs), or you move matching off-chain and
              reintroduce custody risk (CEXs).
            </p>

            <div className="grid sm:grid-cols-2 gap-4">
              <CompareCard
                title="AMM DEX"
                color="#ef4444"
                items={[
                  { text: "No order book — price via formula", ok: false },
                  { text: "Swap-only, no limit orders",        ok: false },
                  { text: "High slippage on large size",       ok: false },
                  { text: "Execution stays on-chain",          ok: true  },
                  { text: "Non-custodial",                     ok: true  },
                ]}
              />
              <CompareCard
                title="CEX"
                color="rgba(255,255,255,0.25)"
                items={[
                  { text: "Full order book, limit & stop orders", ok: true  },
                  { text: "Tight spreads, deep liquidity",        ok: true  },
                  { text: "Sub-100ms execution",                  ok: true  },
                  { text: "Off-chain matching engine",            ok: false },
                  { text: "Custodial — not your keys",           ok: false },
                ]}
              />
            </div>

            <p className="text-white/50 leading-relaxed">
              There was no third option. Building a real order book on-chain meant accepting serial
              execution — too slow for production use. Until Aptos.
            </p>
          </div>
        </Reveal>

        <Divider />

        {/* ── Block-STM ── */}
        <Reveal>
          <div className="space-y-7">
            <SectionLabel>The solution</SectionLabel>
            <h2 className="text-2xl sm:text-3xl font-mono font-bold">
              Block-STM: parallel execution{" "}
              <span style={{ color: YELLOW }}>without conflicts</span>
            </h2>

            <p className="text-white/50 leading-relaxed">
              Aptos uses Block-STM (Software Transactional Memory) — the same concurrency
              technique used in high-performance databases. Transactions execute speculatively
              in parallel. The runtime detects conflicts automatically. If two transactions
              write to the same state, one re-executes. If they don't conflict, both complete
              simultaneously at full throughput.
            </p>

            {/* STM diagram */}
            <div className="bg-white/[0.025] border border-white/10 rounded-2xl p-5 space-y-2">
              <p className="text-xs font-mono text-white/25 uppercase tracking-widest mb-5">
                Block-STM execution trace — one block
              </p>
              {[
                { tx: "Open position: LONG BTC/USD",  reads: ["btc_market", "vault"],       ok: true },
                { tx: "Open position: SHORT ETH/USD", reads: ["eth_market", "vault"],       ok: true },
                { tx: "Open position: LONG SOL/USD",  reads: ["sol_market", "vault"],       ok: true },
                { tx: "Oracle update: BTC price",     reads: ["btc_market"],                ok: true },
                { tx: "Oracle update: ETH price",     reads: ["eth_market"],                ok: true },
                { tx: "Liquidate: BTC position",      reads: ["btc_market", "vault"],       ok: true },
              ].map((row, i) => (
                <div key={i} className="flex items-start gap-3 py-2 border-b border-white/[0.04] last:border-0">
                  <div
                    className="mt-0.5 shrink-0 w-4 h-4 rounded-full border flex items-center justify-center"
                    style={{ borderColor: row.ok ? YELLOW + "80" : "#ef4444" }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: row.ok ? YELLOW : "#ef4444" }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-mono text-white/60">{row.tx}</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {row.reads.map(r => (
                        <span
                          key={r}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-white/10 text-white/30"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0 mt-0.5">
                    <span
                      className="text-xs font-mono"
                      style={{ color: row.ok ? YELLOW + "cc" : "#ef4444" }}
                    >
                      {row.ok ? "parallel ✓" : "conflict → retry"}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-white/50 leading-relaxed">
              Decibel's contract is architected around Block-STM. Each of the 15 markets is a
              fully independent on-chain state object. Orders in BTC/USD never touch ETH/USD
              state — so they always execute in parallel. The vault is the only shared state,
              and it's designed as a single counterparty to minimize contention.
            </p>
          </div>
        </Reveal>

        <Divider />

        {/* ── Simulation ── */}
        <Reveal>
          <div className="space-y-6">
            <SectionLabel>Interactive</SectionLabel>
            <h2 className="text-2xl sm:text-3xl font-mono font-bold">See it in action</h2>
            <p className="text-white/50">
              Toggle between execution modes and run the simulation to see how 5 orders across
              different markets settle.
            </p>
            <Simulation />
          </div>
        </Reveal>

        <Divider />

        {/* ── Architecture ── */}
        <Reveal>
          <div className="space-y-7">
            <SectionLabel>Architecture</SectionLabel>
            <h2 className="text-2xl sm:text-3xl font-mono font-bold">
              15 isolated markets,<br />one unified vault
            </h2>

            <p className="text-white/50 leading-relaxed">
              Each market is an independent on-chain state object — price feed, order book,
              positions, and funding rate are all isolated. The USDC vault acts as the unified
              counterparty for every trade across all markets, eliminating the per-user state
              conflicts that plague other designs.
            </p>

            {/* Markets grid */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {MARKETS.map(market => (
                <div
                  key={market.name}
                  className="p-3 rounded-xl border text-center"
                  style={{
                    borderColor: market.color + "28",
                    backgroundColor: market.color + "0a",
                  }}
                >
                  <div className="text-xs font-mono font-bold" style={{ color: market.color }}>
                    {market.name.split("/")[0]}
                  </div>
                  <div className="text-[10px] font-mono text-white/25 mt-0.5">{market.leverage}</div>
                </div>
              ))}
            </div>

            {/* Vault */}
            <div className="flex items-center gap-4 p-5 rounded-2xl border border-white/10 bg-white/[0.025]">
              <div
                className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-xl"
                style={{ backgroundColor: YELLOW + "12", border: `1px solid ${YELLOW}30` }}
              >
                ◈
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono font-bold text-white">USDC Vault</div>
                <div className="text-xs font-mono text-white/40 mt-0.5">
                  <Counter target={39.5} prefix="$" decimals={1} suffix="M TVL" /> ·{" "}
                  unified counterparty for all 15 markets
                </div>
              </div>
              <div className="shrink-0 text-xs font-mono text-white/25 text-right hidden sm:block">
                no per-user<br />state conflict
              </div>
            </div>

            {/* Isolated margin callout */}
            <div
              className="px-4 py-3.5 rounded-xl border text-xs font-mono"
              style={{ borderColor: YELLOW + "25", backgroundColor: YELLOW + "06", color: YELLOW + "80" }}
            >
              <span className="font-bold" style={{ color: YELLOW }}>New in v11</span>
              {" "}— Isolated margin lets you cap risk per position, independent of other open trades.
              Each position holds its own margin with no cross-contamination.
            </div>
          </div>
        </Reveal>

        <Divider />

        {/* ── Comparison table ── */}
        <Reveal>
          <div className="space-y-7">
            <SectionLabel>Comparison</SectionLabel>
            <h2 className="text-2xl sm:text-3xl font-mono font-bold">
              Best of both worlds
            </h2>

            <div className="rounded-2xl border border-white/10 overflow-hidden">
              <table className="w-full text-sm font-mono">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <th className="text-left px-5 py-3.5 text-white/25 font-normal text-xs uppercase tracking-wider w-36">
                      Feature
                    </th>
                    <th className="px-4 py-3.5 text-white/25 font-normal text-xs uppercase tracking-wider">
                      AMM DEX
                    </th>
                    <th className="px-4 py-3.5 text-white/25 font-normal text-xs uppercase tracking-wider">
                      CEX
                    </th>
                    <th
                      className="px-4 py-3.5 font-normal text-xs uppercase tracking-wider"
                      style={{ color: YELLOW + "cc" }}
                    >
                      Decibel
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      feature: "Order types",
                      amm: "swap only",
                      cex: "limit, market, stop",
                      decibel: "limit, market, stop",
                      decibelGood: true,
                    },
                    {
                      feature: "Execution",
                      amm: "on-chain",
                      cex: "off-chain",
                      decibel: "on-chain",
                      decibelGood: true,
                    },
                    {
                      feature: "Custody",
                      amm: "non-custodial",
                      cex: "custodial",
                      decibel: "non-custodial",
                      decibelGood: true,
                    },
                    {
                      feature: "Finality",
                      amm: "1–3s",
                      cex: "<100ms",
                      decibel: "~600ms",
                      decibelGood: true,
                    },
                    {
                      feature: "Parallelism",
                      amm: "serial",
                      cex: "off-chain",
                      decibel: "Block-STM",
                      decibelGood: true,
                    },
                    {
                      feature: "Liquidation",
                      amm: "N/A",
                      cex: "off-chain",
                      decibel: "on-chain",
                      decibelGood: true,
                    },
                    {
                      feature: "Isolated margin",
                      amm: "✗",
                      cex: "✓",
                      decibel: "✓",
                      decibelGood: true,
                    },
                    {
                      feature: "Markets",
                      amm: "unlimited",
                      cex: "unlimited",
                      decibel: "60",
                      decibelGood: true,
                    },
                  ].map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-white/[0.04] last:border-0"
                      style={{ backgroundColor: i % 2 === 1 ? "rgba(255,255,255,0.01)" : "transparent" }}
                    >
                      <td className="px-5 py-3.5 text-white/35 text-xs">{row.feature}</td>
                      <td className="px-4 py-3.5 text-center text-white/30 text-xs">{row.amm}</td>
                      <td className="px-4 py-3.5 text-center text-white/30 text-xs">{row.cex}</td>
                      <td
                        className="px-4 py-3.5 text-center text-xs font-semibold"
                        style={{ color: row.decibelGood ? YELLOW : "rgba(255,255,255,0.4)" }}
                      >
                        {row.decibel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>

        <Divider />

        {/* ── CTA ── */}
        <Reveal>
          <div
            className="p-8 sm:p-12 rounded-2xl border text-center space-y-5"
            style={{ borderColor: YELLOW + "28", backgroundColor: YELLOW + "05" }}
          >
            <h2 className="text-2xl sm:text-3xl font-mono font-bold">Trade on Decibel</h2>
            <p className="text-white/40 text-sm max-w-sm mx-auto leading-relaxed">
              Perpetual futures with CEX-level order types, fully on-chain on Aptos.
              60 live markets. Up to 40× leverage. Non-custodial.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <a
                href="/"
                className="px-7 py-3 rounded-xl font-mono text-sm font-bold transition-all hover:opacity-85"
                style={{ backgroundColor: YELLOW, color: "#000" }}
              >
                Launch App
              </a>
              <a
                href="https://docs.decibel.trade"
                target="_blank"
                rel="noopener noreferrer"
                className="px-7 py-3 rounded-xl font-mono text-sm border border-white/20 text-white/55
                           hover:border-white/40 hover:text-white transition-all"
              >
                Documentation
              </a>
            </div>
          </div>
        </Reveal>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between pt-8 border-t border-white/[0.06]">
          <span className="text-xs font-mono text-white/20">Decibel Protocol · Aptos Mainnet</span>
          <span className="text-xs font-mono text-white/20">upgrade #11 · 78 modules · 162 entry fns</span>
        </div>
      </div>
    </div>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function Divider() {
  return (
    <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-mono text-white/25 uppercase tracking-[0.2em]">{children}</p>
  )
}

function CompareCard({
  title,
  color,
  items,
}: {
  title: string
  color: string
  items: { text: string; ok: boolean }[]
}) {
  return (
    <div
      className="p-5 rounded-2xl border"
      style={{ borderColor: color + "30", backgroundColor: color + "08" }}
    >
      <div
        className="text-xs font-mono uppercase tracking-wider mb-4"
        style={{ color: color + "cc" }}
      >
        {title}
      </div>
      <div className="space-y-2.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <span
              className="text-xs font-mono shrink-0 mt-0.5"
              style={{ color: item.ok ? "#4ade80" : "#ef4444" }}
            >
              {item.ok ? "+" : "−"}
            </span>
            <span className="text-xs font-mono text-white/50">{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
