"use client"

import { useCloudStatus } from "@/hooks/use-cloud-status"
import { Cloud, CloudOff, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface CloudStatusIndicatorProps {
  compact?: boolean
}

export function CloudStatusIndicator({ compact = false }: CloudStatusIndicatorProps) {
  const { status, loading, error } = useCloudStatus()

  if (loading) {
    return (
      <div className={cn(
        "flex items-center gap-2",
        compact ? "text-xs" : "text-sm"
      )}>
        <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
        {!compact && <span className="text-zinc-500 font-mono">Checking...</span>}
      </div>
    )
  }

  if (error || !status) {
    return (
      <div className={cn(
        "flex items-center gap-2",
        compact ? "text-xs" : "text-sm"
      )}>
        <CloudOff className="w-4 h-4 text-zinc-500" />
        {!compact && <span className="text-zinc-500 font-mono">Status unknown</span>}
      </div>
    )
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        {status.cloudModeEnabled ? (
          <>
            <Cloud className="w-4 h-4 text-green-400" />
            <span className="text-[10px] text-green-400 font-mono uppercase tracking-wider">Cloud</span>
          </>
        ) : (
          <>
            <CloudOff className="w-4 h-4 text-yellow-400" />
            <span className="text-[10px] text-yellow-400 font-mono uppercase tracking-wider">Local</span>
          </>
        )}
      </div>
    )
  }

  return (
    <div className={cn(
      "p-3 border relative",
      status.cloudModeEnabled
        ? "bg-green-500/5 border-green-500/30"
        : "bg-yellow-500/5 border-yellow-500/30"
    )}>
      <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-current opacity-50" />

      <div className="flex items-center gap-2">
        {status.cloudModeEnabled ? (
          <Cloud className="w-5 h-5 text-green-400" />
        ) : (
          <CloudOff className="w-5 h-5 text-yellow-400" />
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={cn(
              "font-mono text-xs uppercase tracking-widest font-bold",
              status.cloudModeEnabled ? "text-green-400" : "text-yellow-400"
            )}>
              {status.cloudModeEnabled ? "Cloud Mode Active" : "Browser Mode Only"}
            </span>
            {status.cloudModeEnabled && (
              <span className="text-[10px] text-zinc-500 font-mono">
                ({status.cronInterval})
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {status.cloudModeEnabled
              ? "Bot runs automatically every minute, even when browser is closed"
              : "Bot only runs while this tab is open"}
          </p>
        </div>
      </div>

      {!status.cloudModeEnabled && (
        <div className="mt-2 pt-2 border-t border-yellow-500/20">
          <p className="text-[10px] text-zinc-500 font-mono">
            For 24/7 operation, configure cloud mode in Vercel environment variables
          </p>
        </div>
      )}
    </div>
  )
}
