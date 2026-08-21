"use client"

import { useState } from "react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { BOT_OPERATOR, getAptosNodeUrl, getActivePackage } from "@/lib/decibel-client"

export interface DelegationState {
  isDelegated: boolean
  isChecking: boolean
  isSubmitting: boolean
  error: string | null
  checkDelegation: () => Promise<void>
  delegateTrading: () => Promise<boolean>
  revokeDelegation: () => Promise<boolean>
}

/**
 * How long the operator may trade this subaccount before the user has to say
 * yes again. Kept in step with DELEGATION_TTL_SECONDS in
 * app/api/bot/delegate/route.ts — a permission nobody ever has to renew is one
 * nobody ever revisits, and this one signs orders.
 */
const DELEGATION_TTL_SECONDS = 30 * 24 * 60 * 60

/**
 * Delegations now expire, so being present in the permissions map is no longer
 * the same as being able to trade. DelegatedPermissions is an on-chain enum
 * whose JSON shape the module ABI does not pin, so read the expiry defensively
 * and only treat it as expired on an unambiguous timestamp that has passed.
 * Missing or zero means unlimited — what the older delegations look like.
 * Mirrors findExpirySeconds in app/api/bot/check-delegation/route.ts.
 */
const EXPIRY_KEYS = ["expiration", "expiration_secs", "expiration_time", "expires_at", "expiry"]

function findExpirySeconds(value: unknown, depth = 0): number | null {
  if (depth > 6 || value === null || typeof value !== "object") return null
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (EXPIRY_KEYS.includes(key)) {
      const inner =
        typeof raw === "object" && raw !== null ? (raw as { vec?: unknown[] }).vec?.[0] : raw
      const n = Number(inner)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  for (const raw of Object.values(value as Record<string, unknown>)) {
    const found = findExpirySeconds(raw, depth + 1)
    if (found !== null) return found
  }
  return null
}

/**
 * @param subaccount The subaccount to delegate. Passed in explicitly rather
 * than discovered inside the hook: callers now own more than one subaccount
 * (a personal strategy runner trades a different one from the dashboard bot),
 * and a hook that silently picks one for you delegates the wrong account
 * without ever saying so.
 */
export function useDelegation(subaccount: string | null | undefined): DelegationState {
  const { account, connected, signAndSubmitTransaction } = useWallet()
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
      const APTOS_NODE = getAptosNodeUrl()

      // Check if bot operator is delegated for this subaccount.
      // Contract upgrade 22 removed is_delegated_trader; the delegation set
      // now comes back as an OrderedMap keyed by delegate address.
      const response = await fetch(`${APTOS_NODE}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          function: `${getActivePackage()}::dex_accounts::view_delegated_permissions`,
          type_arguments: [],
          arguments: [subaccount],
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to check delegation: ${response.status}`)
      }

      const data = await response.json()
      const entries: Array<{ key?: string; value?: unknown }> = data?.[0]?.entries ?? []
      const operator = BOT_OPERATOR.toLowerCase()
      const entry = entries.find(
        (e) => typeof e.key === "string" && e.key.toLowerCase() === operator
      )
      const expiresAtSeconds = entry ? findExpirySeconds(entry.value) : null
      const expired = expiresAtSeconds !== null && expiresAtSeconds <= Math.floor(Date.now() / 1000)
      setIsDelegated(Boolean(entry) && !expired)
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
      // The fourth argument is Option<u64>. It used to be `[]` — no expiry at
      // all — so an authorization granted once stayed live forever. Thirty days
      // and the user is asked again.
      const expiresAtSeconds = Math.floor(Date.now() / 1000) + DELEGATION_TTL_SECONDS

      const response = await signAndSubmitTransaction({
        data: {
          // Only the module path needs the cast: it is built at runtime from
          // the active package, so TS cannot see it as `a::b::c`.
          function: `${getActivePackage()}::dex_accounts_entry::delegate_trading_to_for_subaccount` as `${string}::${string}::${string}`,
          typeArguments: [],
          functionArguments: [subaccount, BOT_OPERATOR, String(expiresAtSeconds)],
        },
      })

      // Wait for transaction confirmation
      const APTOS_NODE = getAptosNodeUrl()
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
      const response = await signAndSubmitTransaction({
        data: {
          function: `${getActivePackage()}::dex_accounts_entry::revoke_delegation` as `${string}::${string}::${string}`,
          typeArguments: [],
          functionArguments: [subaccount, BOT_OPERATOR],
        },
      })

      // Wait for confirmation (same as above)
      const APTOS_NODE = getAptosNodeUrl()
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
