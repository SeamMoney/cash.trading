"use client"

import { useState } from "react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { DECIBEL_PACKAGE, BOT_OPERATOR } from "@/lib/decibel-client"
import { useWalletBalance } from "./use-wallet-balance"

export interface DelegationState {
  isDelegated: boolean
  isChecking: boolean
  isSubmitting: boolean
  error: string | null
  checkDelegation: () => Promise<void>
  delegateTrading: () => Promise<boolean>
  revokeDelegation: () => Promise<boolean>
}

export function useDelegation(): DelegationState {
  const { account, connected, signAndSubmitTransaction } = useWallet()
  const { subaccount } = useWalletBalance()
  const [isDelegated, setIsDelegated] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkDelegation = async () => {
    if (!connected || !account || !subaccount) {
      setIsDelegated(false)
      return
    }

    setIsChecking(true)
    setError(null)

    try {
      const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1"

      // Check if bot operator is delegated for this subaccount
      const response = await fetch(`${APTOS_NODE}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          function: `${DECIBEL_PACKAGE}::dex_accounts::is_delegated_trader`,
          type_arguments: [],
          arguments: [subaccount, BOT_OPERATOR],
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to check delegation: ${response.status}`)
      }

      const data = await response.json()
      const delegated = data[0] as boolean
      setIsDelegated(delegated)
    } catch (err) {
      console.error("Failed to check delegation:", err)
      setError(err instanceof Error ? err.message : "Failed to check delegation")
      setIsDelegated(false)
    } finally {
      setIsChecking(false)
    }
  }

  const delegateTrading = async (): Promise<boolean> => {
    if (!connected || !account || !subaccount) {
      setError("Wallet not connected")
      return false
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const payload = {
        type: "entry_function_payload",
        function: `${DECIBEL_PACKAGE}::dex_accounts::delegate_trading_to_for_subaccount`,
        type_arguments: [],
        arguments: [
          subaccount,
          BOT_OPERATOR,
          [], // expiration (none = unlimited)
        ],
      }

      const response = await signAndSubmitTransaction({
        data: payload,
      })

      // Wait for transaction confirmation
      const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1"
      let confirmed = false
      let attempts = 0
      const maxAttempts = 20

      while (!confirmed && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000))

        const txResponse = await fetch(`${APTOS_NODE}/transactions/by_hash/${response.hash}`)
        if (txResponse.ok) {
          const txData = await txResponse.json()
          if (txData.success === true) {
            confirmed = true
            break
          } else if (txData.success === false) {
            throw new Error("Transaction failed")
          }
        }

        attempts++
      }

      if (!confirmed) {
        throw new Error("Transaction confirmation timeout")
      }

      setIsDelegated(true)
      return true
    } catch (err) {
      console.error("Failed to delegate trading:", err)
      setError(err instanceof Error ? err.message : "Failed to delegate trading")
      return false
    } finally {
      setIsSubmitting(false)
    }
  }

  const revokeDelegation = async (): Promise<boolean> => {
    if (!connected || !account || !subaccount) {
      setError("Wallet not connected")
      return false
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const payload = {
        type: "entry_function_payload",
        function: `${DECIBEL_PACKAGE}::dex_accounts::revoke_trading_delegation_for_subaccount`,
        type_arguments: [],
        arguments: [subaccount, BOT_OPERATOR],
      }

      const response = await signAndSubmitTransaction({
        data: payload,
      })

      // Wait for confirmation (same as above)
      const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1"
      let confirmed = false
      let attempts = 0

      while (!confirmed && attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        const txResponse = await fetch(`${APTOS_NODE}/transactions/by_hash/${response.hash}`)
        if (txResponse.ok) {
          const txData = await txResponse.json()
          if (txData.success === true) {
            confirmed = true
            break
          } else if (txData.success === false) {
            throw new Error("Transaction failed")
          }
        }
        attempts++
      }

      if (!confirmed) {
        throw new Error("Transaction confirmation timeout")
      }

      setIsDelegated(false)
      return true
    } catch (err) {
      console.error("Failed to revoke delegation:", err)
      setError(err instanceof Error ? err.message : "Failed to revoke delegation")
      return false
    } finally {
      setIsSubmitting(false)
    }
  }

  return {
    isDelegated,
    isChecking,
    isSubmitting,
    error,
    checkDelegation,
    delegateTrading,
    revokeDelegation,
  }
}
