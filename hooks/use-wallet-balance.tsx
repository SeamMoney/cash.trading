"use client"

import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from "react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { DECIBEL_PACKAGE } from "@/lib/decibel-client"

export interface WalletBalanceState {
  balance: number | null
  aptBalance: number | null
  subaccount: string | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

// Create context with default values
const WalletBalanceContext = createContext<WalletBalanceState | null>(null)

// Provider component that holds the shared state
export function WalletBalanceProvider({ children }: { children: ReactNode }) {
  const { account, connected } = useWallet()
  const [balance, setBalance] = useState<number | null>(null)
  const [aptBalance, setAptBalance] = useState<number | null>(null)
  const [subaccount, setSubaccount] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchMarginForSubaccount = async (subaccountAddr: string, retries = 2): Promise<number | null> => {
    const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1"
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
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
          const errorText = await marginResponse.text()
          console.warn(`[Balance] Margin fetch failed (${marginResponse.status}):`, errorText.slice(0, 200))
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
            continue
          }
          return 0
        }

        const marginData = await marginResponse.json()
        const marginRaw = marginData[0] as string
        return Number(marginRaw) / 1_000_000
      } catch (e) {
        console.warn(`[Balance] Attempt ${attempt + 1} failed for ${subaccountAddr.slice(0, 10)}:`, e)
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
          continue
        }
        return null
      }
    }
    return null
  }

  const fetchBalance = useCallback(async () => {
    if (!connected || !account) {
      setBalance(null)
      setAptBalance(null)
      setSubaccount(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1"
      const walletAddress = account.address.toString()
      console.log("🔍 Fetching balance for wallet:", walletAddress)

      // Fetch APT balance
      const aptBalanceResponse = await fetch(`${APTOS_NODE}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          function: "0x1::coin::balance",
          type_arguments: ["0x1::aptos_coin::AptosCoin"],
          arguments: [walletAddress],
        }),
      })

      if (aptBalanceResponse.ok) {
        const aptBalanceData = await aptBalanceResponse.json()
        const aptRaw = aptBalanceData[0]
        if (aptRaw !== undefined) {
          const apt = Number(aptRaw) / 100_000_000
          console.log("⛽ APT balance:", `${apt.toFixed(4)} APT`)
          setAptBalance(apt)
        } else {
          setAptBalance(0)
        }
      } else {
        setAptBalance(null)
      }

      // Get primary subaccount - the function is in dex_accounts module
      console.log("🔍 Fetching primary subaccount for:", walletAddress)
      console.log("🔍 Using package:", DECIBEL_PACKAGE)

      const primaryResponse = await fetch(`${APTOS_NODE}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          function: `${DECIBEL_PACKAGE}::dex_accounts::primary_subaccount`,
          type_arguments: [],
          arguments: [walletAddress],
        }),
      })

      console.log("🔍 Primary subaccount response status:", primaryResponse.status)

      if (primaryResponse.ok) {
        const primaryData = await primaryResponse.json()
        console.log("🔍 Primary subaccount raw response:", primaryData)
        const primaryAddr = primaryData[0] as string
        if (primaryAddr) {
          setSubaccount(primaryAddr)
          const primaryBalance = await fetchMarginForSubaccount(primaryAddr)
          setBalance(primaryBalance)
          console.log("📦 Primary subaccount:", primaryAddr, `($${primaryBalance?.toFixed(2) || '0'})`)
        } else {
          console.log("⚠️ No primary subaccount found - user may not have one yet")
          setSubaccount(null)
          setBalance(null)
        }
      } else {
        const errorText = await primaryResponse.text()
        console.error("❌ Failed to fetch primary subaccount:", errorText)
        setSubaccount(null)
        setBalance(null)
      }

    } catch (err) {
      console.error("Failed to fetch wallet balance:", err)
      setError(err instanceof Error ? err.message : "Failed to fetch balance")
      setBalance(null)
      setSubaccount(null)
    } finally {
      setLoading(false)
    }
  }, [connected, account])

  // Fetch on mount and when account changes
  useEffect(() => {
    fetchBalance()
  }, [connected, account])

  const value: WalletBalanceState = {
    balance,
    aptBalance,
    subaccount,
    loading,
    error,
    refetch: fetchBalance,
  }

  return (
    <WalletBalanceContext.Provider value={value}>
      {children}
    </WalletBalanceContext.Provider>
  )
}

// Hook to consume the context
export function useWalletBalance(): WalletBalanceState {
  const context = useContext(WalletBalanceContext)
  if (!context) {
    throw new Error('useWalletBalance must be used within a WalletBalanceProvider')
  }
  return context
}
