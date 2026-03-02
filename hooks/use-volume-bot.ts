"use client"

import { useState, useEffect, useRef } from "react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk"
import { getClientNetwork, getActivePackage, MARKETS, MAINNET_MARKETS } from "@/lib/decibel-client"

const ACTIVE_PACKAGE = getActivePackage()
const BTC_MARKET = getClientNetwork() === 'mainnet'
  ? MAINNET_MARKETS['BTC/USD'].address
  : MARKETS['BTC/USD'].address

interface BotConfig {
  capitalUSDC: number
  volumeTargetUSDC: number
  bias: "long" | "short" | "neutral"
  subaccount: string
}

interface OrderRecord {
  timestamp: number
  txHash: string
  direction: "long" | "short"
  volumeGenerated: number
  success: boolean
}

export function useVolumeBot() {
  const { account, signAndSubmitTransaction } = useWallet()
  const [isRunning, setIsRunning] = useState(false)
  const [config, setConfig] = useState<BotConfig | null>(null)
  const [cumulativeVolume, setCumulativeVolume] = useState(0)
  const [ordersPlaced, setOrdersPlaced] = useState(0)
  const [orderHistory, setOrderHistory] = useState<OrderRecord[]>([])
  const [lastOrderTime, setLastOrderTime] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const configRef = useRef<BotConfig | null>(null)
  const aptos = new Aptos(new AptosConfig({ network: getClientNetwork() === 'mainnet' ? Network.MAINNET : Network.TESTNET }))

  const placeOrder = async (isLong: boolean) => {
    const currentConfig = configRef.current
    if (!account || !currentConfig || !signAndSubmitTransaction) {
      throw new Error("Wallet not connected")
    }

    console.log(`\n📝 Placing ${isLong ? 'LONG' : 'SHORT'} order...`)

    const orderSize = currentConfig.capitalUSDC * 0.03 // 3% of capital per order
    const contractSize = 10000 // 0.0001 BTC (small test size)

    try {
      // Match the exact format that works in the delegation hook
      const payload = {
        type: "entry_function_payload",
        function: `${ACTIVE_PACKAGE}::dex_accounts_entry::place_twap_order_to_subaccount`,
        type_arguments: [],
        arguments: [
          currentConfig.subaccount,
          BTC_MARKET,
          String(contractSize), // Convert to string
          isLong,
          false, // reduce_only
          String(60),    // min duration: 1 min (FASTER!)
          String(120),   // max duration: 2 min (FASTER!)
        ],
      }

      console.log("🔐 Transaction payload:", JSON.stringify(payload, null, 2))
      console.log("🔐 Requesting wallet signature...")
      const response = await signAndSubmitTransaction({
        data: payload,
      })
      const txHash = response.hash

      console.log(`✅ Order submitted: ${txHash}`)
      console.log(`🔗 View: https://explorer.aptoslabs.com/txn/${txHash}?network=${getClientNetwork()}`)

      // Wait for transaction
      await aptos.waitForTransaction({ transactionHash: txHash })

      console.log(`✅ Order confirmed!`)

      return {
        success: true,
        txHash,
        volumeGenerated: orderSize,
      }
    } catch (err: any) {
      console.error("❌ Order failed:", err)
      console.error("Error details:", err.message || err)
      return {
        success: false,
        txHash: "",
        volumeGenerated: 0,
        error: err.message || "Unknown error",
      }
    }
  }

  const runBotLoop = async () => {
    const currentConfig = configRef.current
    console.log("🔄 runBotLoop called, config:", currentConfig ? "exists" : "null")

    if (!currentConfig) {
      console.error("❌ runBotLoop: config is null!")
      return
    }

    if (!account) {
      console.error("❌ runBotLoop: wallet not connected!")
      return
    }

    // Check if volume target reached
    if (cumulativeVolume >= currentConfig.volumeTargetUSDC) {
      console.log("🎉 Volume target reached! Stopping bot.")
      stop()
      return
    }

    // Calculate order size
    const orderSize = currentConfig.capitalUSDC * 0.03
    const remainingVolume = currentConfig.volumeTargetUSDC - cumulativeVolume

    if (remainingVolume <= 0) {
      stop()
      return
    }

    // Determine direction
    let isLong: boolean
    if (currentConfig.bias === "long") {
      isLong = true
    } else if (currentConfig.bias === "short") {
      isLong = false
    } else {
      // Neutral: alternate
      isLong = ordersPlaced % 2 === 0
    }

    // Place order
    const result = await placeOrder(isLong)

    // Record order
    const record: OrderRecord = {
      timestamp: Date.now(),
      txHash: result.txHash,
      direction: isLong ? "long" : "short",
      volumeGenerated: result.volumeGenerated,
      success: result.success,
    }

    setOrderHistory(prev => [...prev, record])

    if (result.success) {
      setCumulativeVolume(prev => prev + result.volumeGenerated)
      setOrdersPlaced(prev => prev + 1)
      setLastOrderTime(Date.now())
      setError(null)

      console.log(`\n📊 Bot Status:`)
      console.log(`Orders: ${ordersPlaced + 1}`)
      console.log(`Volume: $${(cumulativeVolume + result.volumeGenerated).toFixed(2)} / $${config.volumeTargetUSDC}`)
    } else {
      const errorMsg = (result as any).error || "Order placement failed"
      setError(errorMsg)
      console.error("⚠️ Error:", errorMsg)
    }
  }

  const start = (botConfig: BotConfig) => {
    if (isRunning) {
      console.log("⚠️  Bot already running")
      return
    }

    console.log("\n🚀 Starting Volume Bot (CLIENT-SIDE)...")
    console.log("Capital:", `$${botConfig.capitalUSDC}`)
    console.log("Target:", `$${botConfig.volumeTargetUSDC}`)
    console.log("Bias:", botConfig.bias)
    console.log("Frequency: Every 30 seconds")

    // Store config in ref FIRST before setting state
    configRef.current = botConfig

    setConfig(botConfig)
    setIsRunning(true)
    setCumulativeVolume(0)
    setOrdersPlaced(0)
    setOrderHistory([])
    setError(null)

    // Run first order immediately
    setTimeout(() => {
      console.log("⏰ First order timeout fired!")
      runBotLoop()
    }, 1000)

    // Then run every 30 seconds (MUCH FASTER!)
    intervalRef.current = setInterval(() => {
      console.log("⏰ Interval timer fired!")
      runBotLoop()
    }, 30000) // 30 seconds
  }

  const stop = () => {
    console.log("\n⏹️  Stopping Volume Bot...")
    setIsRunning(false)

    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  return {
    isRunning,
    config,
    cumulativeVolume,
    ordersPlaced,
    orderHistory,
    lastOrderTime,
    error,
    start,
    stop,
  }
}
