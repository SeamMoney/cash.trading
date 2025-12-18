"use client"

import { useState, useEffect, useCallback } from "react"
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
  setCompetitionSubaccount: (address: string) => void
  competitionChecked: boolean
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

const COMPETITION_SUBACCOUNT_KEY = 'decibrrr_competition_subaccount'

// Auto-detect competition subaccount by scanning transaction history
async function findCompetitionSubaccountFromHistory(walletAddress: string): Promise<string | null> {
  const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1"
  try {
    // Get recent transactions
    const response = await fetch(`${APTOS_NODE}/accounts/${walletAddress}/transactions?limit=50`)
    if (!response.ok) {
      console.warn('🔍 Failed to fetch tx history:', response.status)
      return null
    }

    const transactions = await response.json()
    console.log(`🔍 Scanning ${transactions.length} transactions for competition subaccount...`)

    // Look for SubaccountCreatedEvent with is_primary: false
    for (const tx of transactions) {
      if (!tx.events) continue

      for (const event of tx.events) {
        if (event.type?.includes('SubaccountCreatedEvent')) {
          const data = event.data
          console.log('🔍 Found SubaccountCreatedEvent:', {
            is_primary: data?.is_primary,
            is_primary_type: typeof data?.is_primary,
            subaccount: data?.subaccount?.slice(0, 20) + '...',
          })
          // Check if this is a non-primary subaccount (competition)
          // Handle both boolean and string representations from Aptos API
          const isPrimary = data?.is_primary === true || data?.is_primary === 'true'
          if (!isPrimary && data?.subaccount) {
            console.log('🔍 Auto-detected competition subaccount from tx history:', data.subaccount.slice(0, 20) + '...')
            return data.subaccount
          }
        }
      }
    }

    console.log('🔍 No competition subaccount found in transaction history')
    return null
  } catch (err) {
    console.warn('Failed to scan transaction history:', err)
    return null
  }
}

export function useWalletBalance(): WalletBalanceState {
  const { account, connected } = useWallet()
  const [balance, setBalance] = useState<number | null>(null)
  const [aptBalance, setAptBalance] = useState<number | null>(null)
  const [subaccount, setSubaccount] = useState<string | null>(null)
  const [allSubaccounts, setAllSubaccounts] = useState<SubaccountInfo[]>([])
  const [selectedSubaccountType, setSelectedSubaccountType] = useState<'primary' | 'competition'>('competition')
  const [competitionSubaccountAddr, setCompetitionSubaccountAddr] = useState<string | null>(null)
  const [competitionChecked, setCompetitionChecked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load competition subaccount from localStorage or auto-detect from tx history
  useEffect(() => {
    setCompetitionChecked(false) // Reset on account change

    async function loadCompetitionSubaccount() {
      if (typeof window === 'undefined' || !account) {
        setCompetitionChecked(true)
        return
      }

      const key = `${COMPETITION_SUBACCOUNT_KEY}_${account.address.toString()}`
      const saved = localStorage.getItem(key)

      if (saved) {
        setCompetitionSubaccountAddr(saved)
        setCompetitionChecked(true)
        console.log('📦 Loaded competition subaccount from localStorage:', saved.slice(0, 20) + '...')
        return
      }

      // Try to auto-detect from transaction history
      const detected = await findCompetitionSubaccountFromHistory(account.address.toString())
      if (detected) {
        localStorage.setItem(key, detected)
        setCompetitionSubaccountAddr(detected)
        console.log('✅ Auto-saved competition subaccount:', detected.slice(0, 20) + '...')
      }
      setCompetitionChecked(true)
    }

    loadCompetitionSubaccount()
  }, [account])

  // Function to set and persist competition subaccount
  const setCompetitionSubaccount = useCallback((address: string) => {
    if (typeof window !== 'undefined' && account) {
      const key = `${COMPETITION_SUBACCOUNT_KEY}_${account.address.toString()}`
      localStorage.setItem(key, address)
      setCompetitionSubaccountAddr(address)
      console.log('💾 Saved competition subaccount:', address.slice(0, 20) + '...')
    }
  }, [account])

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

      // Get competition subaccount from localStorage (if saved)
      if (competitionSubaccountAddr) {
        try {
          // Verify the competition subaccount exists on-chain
          const competitionBalance = await fetchMarginForSubaccount(competitionSubaccountAddr)
          if (competitionBalance !== null) {
            subaccounts.push({
              address: competitionSubaccountAddr,
              type: 'competition',
              balance: competitionBalance,
            })
            console.log("🏆 Competition subaccount:", competitionSubaccountAddr.slice(0, 20) + '...', `($${competitionBalance?.toFixed(2) || '0'})`)
          }
        } catch {
          console.log("⚠️ Competition subaccount not found on-chain")
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
  }, [connected, account, competitionSubaccountAddr])

  return {
    balance,
    aptBalance,
    subaccount,
    allSubaccounts,
    selectedSubaccountType,
    setSelectedSubaccountType,
    setCompetitionSubaccount,
    competitionChecked,
    loading,
    error,
    refetch: fetchBalance,
  }
}
