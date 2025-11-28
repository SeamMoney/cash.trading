"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Shield, ShieldCheck, Loader2, ShieldOff } from "lucide-react"
import { useDelegation } from "@/hooks/use-delegation"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { cn } from "@/lib/utils"

interface DelegationButtonProps {
  className?: string
  variant?: "default" | "outline" | "ghost"
}

export function DelegationButton({ className, variant = "default" }: DelegationButtonProps) {
  const { connected } = useWallet()
  const { isDelegated, isChecking, isSubmitting, delegateTrading, revokeDelegation, checkDelegation } = useDelegation()

  // Check delegation status when wallet connects
  useEffect(() => {
    if (connected) {
      checkDelegation()
    }
  }, [connected])

  if (!connected) {
    return null
  }

  const handleClick = async () => {
    if (isDelegated) {
      await revokeDelegation()
    } else {
      await delegateTrading()
    }
    await checkDelegation() // Recheck status
  }

  if (isChecking) {
    return (
      <Button disabled variant={variant} className={cn("font-mono", className)}>
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        Checking...
      </Button>
    )
  }

  if (isDelegated) {
    return (
      <Button
        onClick={handleClick}
        disabled={isSubmitting}
        variant="outline"
        className={cn(
          "font-mono border-green-500/30 text-green-500 hover:bg-green-500/10 hover:border-green-500/50",
          className
        )}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Revoking...
          </>
        ) : (
          <>
            <ShieldCheck className="w-4 h-4 mr-2" />
            Bot Authorized
            <ShieldOff className="w-3 h-3 ml-2 opacity-50" />
          </>
        )}
      </Button>
    )
  }

  return (
    <Button
      onClick={handleClick}
      disabled={isSubmitting}
      variant={variant}
      className={cn(
        "font-mono bg-primary/90 hover:bg-primary text-black font-bold shadow-[0_0_20px_rgba(255,246,0,0.3)]",
        className
      )}
    >
      {isSubmitting ? (
        <>
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Authorizing...
        </>
      ) : (
        <>
          <Shield className="w-4 h-4 mr-2" />
          Authorize Bot
        </>
      )}
    </Button>
  )
}
