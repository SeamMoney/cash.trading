"use client"

import { useState, useEffect } from "react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { DECIBEL_PACKAGE } from "@/lib/decibel-client"

export interface WalletBalanceState {
  balance: number | null
  subaccount: string | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useWalletBalance(): WalletBalanceState {
  const { account, connected } = useWallet()
  const [balance, setBalance] = useState<number | null>(null)
  const [subaccount, setSubaccount] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchBalance = async () => {
    if (!connected || !account) {
      setBalance(null)
      setSubaccount(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1"

      // Debug: Log wallet address
      const walletAddress = account.address.toString()
      console.log("🔍 Fetching balance for wallet:", walletAddress)

      // Get primary subaccount using direct fetch (browser-compatible)
      const subaccountResponse = await fetch(`${APTOS_NODE}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          function: `${DECIBEL_PACKAGE}::dex_accounts::primary_subaccount`,
          type_arguments: [],
          arguments: [walletAddress],
        }),
      })

      if (!subaccountResponse.ok) {
        const errorText = await subaccountResponse.text()
        console.error("Subaccount fetch error:", errorText)
        throw new Error(`Failed to fetch subaccount: ${subaccountResponse.status}`)
      }

      const subaccountData = await subaccountResponse.json()
      const subaccountAddr = subaccountData[0] as string
      console.log("📦 Subaccount:", subaccountAddr)
      setSubaccount(subaccountAddr)

      // Get available margin using direct fetch (browser-compatible)
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
        console.error("Margin fetch error:", errorText)
        console.error("Subaccount used:", subaccountAddr)
        throw new Error(`Failed to fetch margin: ${marginResponse.status}`)
      }

      const marginData = await marginResponse.json()
      const marginRaw = marginData[0] as string
      const marginUSDC = Number(marginRaw) / 1_000_000 // Convert from 6 decimals (using Number for precision)
      console.log("💰 Available margin:", `$${marginUSDC.toFixed(2)} USDC`)
      setBalance(marginUSDC)
    } catch (err) {
      console.error("Failed to fetch wallet balance:", err)
      setError(err instanceof Error ? err.message : "Failed to fetch balance")
      setBalance(null)
      setSubaccount(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBalance()
  }, [connected, account])

  return {
    balance,
    subaccount,
    loading,
    error,
    refetch: fetchBalance,
  }
}
