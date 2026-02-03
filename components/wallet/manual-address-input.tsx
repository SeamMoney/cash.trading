"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Info, ExternalLink, AlertTriangle } from "lucide-react"
import { DECIBEL_PACKAGE } from "@/lib/decibel-client"

export function ManualAddressInput() {
  const [address, setAddress] = useState("")
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<{
    balance: number
    subaccount: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isValidAptosAddress = (addr: string) => {
    // Check if it's a valid hex address (starts with 0x, followed by hex chars)
    return /^0x[a-fA-F0-9]{1,64}$/.test(addr)
  }

  const checkBalance = async () => {
    if (!address) {
      setError("Please enter an address")
      return
    }

    if (!isValidAptosAddress(address)) {
      setError("Invalid Aptos address format")
      return
    }

    setChecking(true)
    setError(null)
    setResult(null)

    try {
      const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1"
      let subaccountAddr = address

      // Try to get primary subaccount using direct fetch
      try {
        const subaccountResponse = await fetch(`${APTOS_NODE}/view`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            function: `${DECIBEL_PACKAGE}::dex_accounts_entry::primary_subaccount`,
            type_arguments: [],
            arguments: [address],
          }),
        })

        if (subaccountResponse.ok) {
          const subaccountData = await subaccountResponse.json()
          subaccountAddr = subaccountData[0] as string
        }
      } catch (e) {
        // If it fails, assume the input address is already the subaccount
        console.log("Address might be a subaccount directly")
      }

      // Get available margin using direct fetch
      const marginResponse = await fetch(`${APTOS_NODE}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          function: `${DECIBEL_PACKAGE}::accounts_collateral::available_order_margin`,
          type_arguments: [],
          arguments: [subaccountAddr],
        }),
      })

      if (!marginResponse.ok) {
        throw new Error("Failed to fetch margin")
      }

      const marginData = await marginResponse.json()
      const marginRaw = marginData[0] as string
      const marginUSDC = parseInt(marginRaw) / 1_000_000

      setResult({
        balance: marginUSDC,
        subaccount: subaccountAddr,
      })
    } catch (err) {
      console.error("Failed to check balance:", err)
      setError("Could not find balance for this address. Make sure you've minted USDC on Decibel.")
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-4">
      <Alert className="bg-blue-500/10 border-blue-500/20">
        <Info className="h-4 w-4 text-blue-500" />
        <AlertTitle className="text-blue-400">Used Ethereum or Solana wallet on Decibel?</AlertTitle>
        <AlertDescription className="text-blue-300/80">
          Enter your Aptos address or subaccount address to check your balance.
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <label htmlFor="manual-address" className="text-sm font-medium text-zinc-300">
          Aptos Address or Subaccount
        </label>
        <Input
          id="manual-address"
          placeholder="0x1234567890abcdef..."
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="bg-black/40 border-white/10 text-white font-mono text-sm"
        />
        <p className="text-xs text-zinc-500">
          Find your address on{" "}
          <a
            href="https://app.decibel.trade"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            app.decibel.trade
          </a>
        </p>
      </div>

      <Button
        onClick={checkBalance}
        disabled={checking || !address}
        className="w-full bg-primary hover:bg-primary/90 text-black font-bold"
      >
        {checking ? "Checking..." : "Check Balance"}
      </Button>

      {error && (
        <Alert className="bg-red-500/10 border-red-500/20">
          <AlertTriangle className="h-4 w-4 text-red-500" />
          <AlertTitle className="text-red-400">Error</AlertTitle>
          <AlertDescription className="text-red-300/80">{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <div className="space-y-4">
          <Alert className="bg-primary/10 border-primary/20">
            <Info className="h-4 w-4 text-primary" />
            <AlertTitle className="text-primary">Balance Found!</AlertTitle>
            <AlertDescription className="text-zinc-300">
              <div className="mt-2 space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-primary">${result.balance.toFixed(2)}</span>
                  <span className="text-sm text-zinc-400">USDC available</span>
                </div>
                <div className="text-xs text-zinc-500 font-mono break-all">
                  Subaccount: {result.subaccount}
                </div>
              </div>
            </AlertDescription>
          </Alert>

          <Alert className="bg-yellow-500/10 border-yellow-500/20">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <AlertTitle className="text-yellow-400">Read-Only Mode</AlertTitle>
            <AlertDescription className="text-yellow-300/80 space-y-3">
              <p>You can view your balance, but cannot trade without an Aptos wallet.</p>
              <p className="text-sm">
                <strong>To enable bot trading:</strong>
              </p>
              <ol className="list-decimal list-inside space-y-1 text-sm">
                <li>Install Petra or Martian wallet</li>
                <li>Transfer USDC from Decibel to your new wallet</li>
                <li>Connect your Aptos wallet to trade</li>
              </ol>
              <div className="flex gap-2 mt-3">
                <a
                  href="https://petra.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Get Petra <ExternalLink className="w-3 h-3" />
                </a>
                <span className="text-zinc-600">|</span>
                <a
                  href="https://martianwallet.xyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Get Martian <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  )
}
