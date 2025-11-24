"use client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ArrowUp, ArrowDown, X, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"

export function HistoryTable() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2">
        <div className="flex items-center gap-8">
          <div className="relative group cursor-pointer">
            <h2 className="text-lg font-bold font-mono text-primary uppercase tracking-widest pb-2">Positions</h2>
            <div className="absolute bottom-[-9px] left-0 w-full h-0.5 bg-primary shadow-[0_0_10px_rgba(255,246,0,0.8)]" />
          </div>
          <div className="relative group cursor-pointer">
            <h2 className="text-lg font-bold font-mono text-zinc-600 hover:text-white transition-colors uppercase tracking-widest pb-2">
              History
            </h2>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex justify-end mb-4">
        <div className="flex items-center gap-2 bg-black/40 px-3 py-1 border border-white/5 backdrop-blur-sm">
          <Checkbox
            id="active-bots"
            className="border-zinc-700 data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-black rounded-none w-4 h-4"
          />
          <label
            htmlFor="active-bots"
            className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 cursor-pointer select-none"
          >
            Show only active positions
          </label>
        </div>
      </div>

      {/* Table - Desktop */}
      <div className="hidden md:block border-y border-white/10 bg-black/40 backdrop-blur-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-white/5 border-none">
            <TableRow className="border-none hover:bg-transparent">
              {["Long", "Short", "Total Exposure", "Net Exposure", "Funding Rate", "Status", "Orders", "Actions"].map(
                (head, i) => (
                  <TableHead
                    key={head}
                    className={cn(
                      "text-zinc-500 font-mono font-bold text-[10px] uppercase tracking-widest h-10",
                      i === 0 && "pl-6",
                      i === 7 && "text-right pr-6",
                      (i === 5 || i === 6) && "text-center",
                    )}
                  >
                    {head}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="border-b border-white/5 hover:bg-white/5 transition-colors group">
              <TableCell className="pl-6 font-mono">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    <Avatar className="w-8 h-8 border border-black rounded-none">
                      <AvatarImage src="/placeholder.svg" className="bg-[#3773f5] p-1.5" />
                      <AvatarFallback className="rounded-none">S</AvatarFallback>
                    </Avatar>
                    <Avatar className="w-8 h-8 border border-black rounded-none">
                      <AvatarImage src="/placeholder.svg" />
                      <AvatarFallback className="bg-zinc-800 text-[10px] rounded-none">BYBIT</AvatarFallback>
                    </Avatar>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-green-500 font-bold text-xs tracking-tight">SUI:PERP-USD</span>
                    <span className="text-zinc-600 text-[10px] uppercase">Ching-bybit</span>
                  </div>
                </div>
              </TableCell>
              <TableCell className="font-mono">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    <Avatar className="w-8 h-8 border border-black rounded-none">
                      <AvatarImage src="/placeholder.svg" className="bg-[#2a5ada] p-1.5" />
                      <AvatarFallback className="rounded-none">L</AvatarFallback>
                    </Avatar>
                    <Avatar className="w-8 h-8 border border-black rounded-none">
                      <AvatarImage src="/placeholder.svg" />
                      <AvatarFallback className="bg-zinc-800 text-[10px] rounded-none">BYBIT</AvatarFallback>
                    </Avatar>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-red-500 font-bold text-xs tracking-tight">LINK:PERP-USD</span>
                    <span className="text-zinc-600 text-[10px] uppercase">Ching-bybit</span>
                  </div>
                </div>
              </TableCell>
              <TableCell className="font-mono text-zinc-300 text-xs">$0.00</TableCell>
              <TableCell className="font-mono text-zinc-400 text-xs">0.00%</TableCell>
              <TableCell className="font-mono text-green-500 text-xs">0.9707%</TableCell>
              <TableCell className="text-center">
                <div className="inline-flex items-center justify-center w-5 h-5 bg-green-500/10 text-green-500 border border-green-500/20">
                  <CheckCircle2 className="w-3 h-3" />
                </div>
              </TableCell>
              <TableCell className="text-center">
                <ArrowUp className="w-3 h-3 text-green-500 mx-auto" />
              </TableCell>
              <TableCell className="text-right pr-6">
                <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="p-1.5 hover:bg-red-500/20 hover:text-red-500 transition-colors text-zinc-600 border border-transparent hover:border-red-500/50">
                    <X className="w-3 h-3" />
                  </button>
                  <button className="p-1.5 hover:bg-primary/20 hover:text-primary transition-colors text-zinc-600 border border-transparent hover:border-primary/50">
                    <ArrowDown className="w-3 h-3" />
                  </button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-4">
        {[1, 2].map((_, i) => (
          <div key={i} className="bg-black/40 backdrop-blur-sm border border-white/10 p-4 space-y-4 relative">
            <div className="absolute top-0 left-0 w-1 h-full bg-white/5" />

            {/* Header Row */}
            <div className="flex items-center justify-between border-b border-white/5 pb-3 pl-3">
              <div className="flex items-center gap-2 font-mono">
                <span className="text-xs font-bold text-green-500">SUI:PERP</span>
                <span className="text-zinc-600">/</span>
                <span className="text-xs font-bold text-red-500">LINK:PERP</span>
              </div>
              <div className="inline-flex items-center justify-center w-4 h-4 bg-green-500/10 text-green-500 border border-green-500/20">
                <CheckCircle2 className="w-3 h-3" />
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-4 pl-3">
              <div className="space-y-1">
                <div className="text-[10px] uppercase text-zinc-600 font-mono tracking-wider">Total Exposure</div>
                <div className="font-mono text-zinc-300 text-sm">$0.00</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase text-zinc-600 font-mono tracking-wider">Net Exposure</div>
                <div className="font-mono text-zinc-400 text-sm">0.00%</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase text-zinc-600 font-mono tracking-wider">Funding Rate</div>
                <div className="font-mono text-green-500 text-sm">0.9707%</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-white/5 pl-3">
              <button className="flex-1 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono uppercase tracking-wider text-zinc-300 transition-colors">
                Close Position
              </button>
              <button className="flex-1 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono uppercase tracking-wider text-zinc-300 transition-colors">
                Edit Orders
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
