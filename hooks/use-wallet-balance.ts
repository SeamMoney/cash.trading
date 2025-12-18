"use client"

import { useState, useEffect } from "react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { DECIBEL_PACKAGE } from "@/lib/decibel-client"

export interface SubaccountInfo {
  address: string
  type: 'primary' | 'competition' | 'other'
  balance: number | null
}

export interface WalletBalanceState {
  balance: number | null
  aptBalance: number | null
  subaccount: string | null
  allSubaccounts: SubaccountInfo[]
  selectedSubaccountType: 'primary' | 'competition'
  setSelectedSubaccountType: (type: 'primary' | 'competition') => void
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useWalletBalance(): WalletBalanceState {
  const { account, connected } = useWallet()
  const [balance, setBalance] = useState<number | null>(null)
  const [aptBalance, setAptBalance] = useState<number | null>(null)
  const [subaccount, setSubaccount] = useState<string | null>(null)
  const [allSubaccounts, setAllSubaccounts] = useState<SubaccountInfo[]>([])
  const [selectedSubaccountType, setSelectedSubaccountType] = useState<'primary' | 'competition'>('competition')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchMarginForSubaccount = async (subaccountAddr: string): Promise<number | null> => {
    const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1"
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
        return 0
      }

      const marginData = await marginResponse.json()
      const marginRaw = marginData[0] as string
      return Number(marginRaw) / 1_000_000
    } catch {
      return null
    }
  }

  const fetchBalance = async () => {
    if (!connected || !account) {
      setBalance(null)
      setAptBalance(null)
      setSubaccount(null)
      setAllSubaccounts([])
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

      const subaccounts: SubaccountInfo[] = []

      // Get primary subaccount
      const primaryResponse = await fetch(`${APTOS_NODE}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          function: `${DECIBEL_PACKAGE}::dex_accounts::primary_subaccount`,
          type_arguments: [],
          arguments: [walletAddress],
        }),
      })

      if (primaryResponse.ok) {
        const primaryData = await primaryResponse.json()
        const primaryAddr = primaryData[0] as string
        const primaryBalance = await fetchMarginForSubaccount(primaryAddr)
        subaccounts.push({
          address: primaryAddr,
          type: 'primary',
          balance: primaryBalance,
        })
        console.log("📦 Primary subaccount:", primaryAddr, `($${primaryBalance?.toFixed(2) || '0'})`)
      }

      // Get competition subaccount (uses seed "trading_competition")
      const competitionResponse = await fetch(`${APTOS_NODE}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          function: `${DECIBEL_PACKAGE}::dex_accounts::subaccount_with_seed`,
          type_arguments: [],
          arguments: [walletAddress, "trading_competition"],
        }),
      })

      if (competitionResponse.ok) {
        const competitionData = await competitionResponse.json()
        const competitionAddr = competitionData[0] as string
        // Check if competition subaccount exists (not zero address)
        if (competitionAddr && competitionAddr !== "0x0" && !competitionAddr.startsWith("0x00000000")) {
          const competitionBalance = await fetchMarginForSubaccount(competitionAddr)
          subaccounts.push({
            address: competitionAddr,
            type: 'competition',
            balance: competitionBalance,
          })
          console.log("🏆 Competition subaccount:", competitionAddr, `($${competitionBalance?.toFixed(2) || '0'})`)
        }
      }

      setAllSubaccounts(subaccounts)

      // Select the appropriate subaccount based on selectedSubaccountType
      const selectedSub = subaccounts.find(s => s.type === selectedSubaccountType) || subaccounts[0]
      if (selectedSub) {
        setSubaccount(selectedSub.address)
        setBalance(selectedSub.balance)
        console.log(`✅ Using ${selectedSub.type} subaccount:`, selectedSub.address)
      } else {
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
  }

  // Re-fetch when subaccount type changes
  useEffect(() => {
    if (allSubaccounts.length > 0) {
      const selectedSub = allSubaccounts.find(s => s.type === selectedSubaccountType)
      if (selectedSub) {
        setSubaccount(selectedSub.address)
        setBalance(selectedSub.balance)
        console.log(`🔄 Switched to ${selectedSub.type} subaccount:`, selectedSub.address)
      }
    }
  }, [selectedSubaccountType, allSubaccounts])

  useEffect(() => {
    fetchBalance()
  }, [connected, account])

  return {
    balance,
    aptBalance,
    subaccount,
    allSubaccounts,
    selectedSubaccountType,
    setSelectedSubaccountType,
    loading,
    error,
    refetch: fetchBalance,
  }
}
