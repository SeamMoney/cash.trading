"use client"
import { TrendingDown } from "lucide-react"
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from "recharts"

const balanceData = [
  { time: "Apr 23", value: 360000 },
  { time: "Apr 24", value: 359000 },
  { time: "Apr 25", value: 361000 },
  { time: "Apr 26", value: 364000 },
  { time: "Apr 27", value: 361000 },
  { time: "Apr 28", value: 358000 },
  { time: "Apr 29", value: 362000 },
  { time: "Apr 30", value: 357000 },
]

const exposureData = [
  { time: "Apr 23", value: 0 },
  { time: "Apr 24", value: 100000 },
  { time: "Apr 25", value: 200000 },
  { time: "Apr 26", value: 220000 },
  { time: "Apr 27", value: 210000 },
  { time: "Apr 28", value: 280000 },
  { time: "Apr 29", value: 250000 },
  { time: "Apr 30", value: 450000 },
]

const pnlData = [
  { time: "Apr 23", value: 0 },
  { time: "Apr 24", value: 1000 },
  { time: "Apr 25", value: -1000 },
  { time: "Apr 26", value: 2000 },
  { time: "Apr 27", value: 1500 },
  { time: "Apr 28", value: 3000 },
  { time: "Apr 29", value: 1500 },
  { time: "Apr 30", value: -3000 },
]

export function PortfolioView() {
  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-500">
      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative group hover:border-primary/50 transition-colors">
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white/20 group-hover:border-primary transition-colors" />
          <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-white/20 group-hover:border-primary transition-colors" />

          <div className="text-muted-foreground text-xs font-mono uppercase tracking-widest mb-2 flex items-center justify-between">
            <span>Total Balance</span>
            <div className="w-1 h-1 bg-primary rounded-full animate-pulse" />
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-4xl font-mono font-bold text-white tracking-tighter">359,170.9</span>
            <span className="text-zinc-600 text-sm font-mono">USDT</span>
          </div>
          <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-wider">
            <span className="text-red-500 flex items-center gap-1 bg-red-500/10 px-1.5 py-0.5">
              <TrendingDown className="w-3 h-3" />
              -1.04% 1D
            </span>
            <span className="text-red-500 flex items-center gap-1 bg-red-500/10 px-1.5 py-0.5">
              <TrendingDown className="w-3 h-3" />
              -0.15% 7D
            </span>
          </div>
        </div>

        <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative group hover:border-red-500/50 transition-colors">
          <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-white/20 group-hover:border-red-500 transition-colors" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-white/20 group-hover:border-red-500 transition-colors" />

          <div className="text-muted-foreground text-xs font-mono uppercase tracking-widest mb-2">Unrealized PnL</div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-4xl font-mono font-bold text-red-500 tracking-tighter">-512.36</span>
            <span className="text-zinc-600 text-sm font-mono">USDT</span>
          </div>
          <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-wider">
            <span className="text-red-500 flex items-center gap-1">ROI -0.12%</span>
          </div>
        </div>

        <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative group hover:border-green-500/50 transition-colors">
          <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-white/10 group-hover:border-green-500/50 transition-colors" />

          <div className="text-muted-foreground text-xs font-mono uppercase tracking-widest mb-2">Directional Bias</div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-4xl font-mono font-bold text-green-500 tracking-tighter">+437,754</span>
            <span className="text-zinc-600 text-sm font-mono">USDT</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
            <span className="text-green-500 font-bold">Long Bias</span>
            <span className="text-zinc-500">100% Adjusted L/S</span>
          </div>
        </div>
      </div>

      {/* Main Chart */}
      <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative shadow-[0_0_30px_-10px_rgba(0,0,0,0.5)]">
        <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-transparent via-white/10 to-transparent" />
        <div className="absolute top-6 left-6 z-10">
          <div className="text-muted-foreground text-xs font-mono uppercase tracking-widest mb-1">
            Total Balance History
          </div>
          <div className="text-white text-xl font-mono font-bold tracking-tight">$366.00k</div>
        </div>
        <div className="h-[300px] w-full mt-8">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={balanceData}>
              <defs>
                <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ffff00" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#ffff00" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                contentStyle={{
                  backgroundColor: "#000000cc",
                  borderColor: "#333",
                  backdropFilter: "blur(4px)",
                  fontFamily: "monospace",
                  fontSize: "12px",
                  textTransform: "uppercase",
                }}
                itemStyle={{ color: "#ffff00" }}
              />
              <XAxis
                dataKey="time"
                stroke="#52525b"
                tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}
                axisLine={false}
                tickLine={false}
              />
              <Area
                type="stepAfter"
                dataKey="value"
                stroke="#ffff00"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorBalance)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Secondary Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative">
          <div className="text-muted-foreground text-xs font-mono uppercase tracking-widest mb-6">
            Notional Exposure
          </div>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={exposureData}>
                <defs>
                  <linearGradient id="colorExposure" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="time"
                  stroke="#52525b"
                  tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Area type="stepAfter" dataKey="value" stroke="#10b981" strokeWidth={2} fill="url(#colorExposure)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative">
          <div className="text-muted-foreground text-xs font-mono uppercase tracking-widest mb-6">Unrealized PnL</div>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={pnlData}>
                <defs>
                  <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="time"
                  stroke="#52525b"
                  tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Area type="monotone" dataKey="value" stroke="#f43f5e" strokeWidth={2} fill="url(#colorPnl)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
