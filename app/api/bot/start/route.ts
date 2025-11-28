import { NextRequest, NextResponse } from "next/server"
import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk"
import { DECIBEL_PACKAGE, MARKETS, MarketName } from "@/lib/decibel-client"

// Get bot operator credentials from environment
const BOT_OPERATOR_PRIVATE_KEY = process.env.BOT_OPERATOR_PRIVATE_KEY
const BOT_OPERATOR_ADDRESS = process.env.BOT_OPERATOR_ADDRESS

if (!BOT_OPERATOR_PRIVATE_KEY || !BOT_OPERATOR_ADDRESS) {
  throw new Error("Bot operator credentials not configured in environment variables")
}

interface StartBotRequest {
  userAddress: string
  market: MarketName
  notionalSize: number // USD value
  tradingMode: "aggressive" | "normal" | "passive"
  directionalBias: number // 0-100, % allocated to long side
  takeProfitPct?: number
  stopLossPct?: number
}

interface BotOrder {
  side: "long" | "short"
  market: string
  size: number
  txHash: string
}

export async function POST(req: NextRequest) {
  try {
    const body: StartBotRequest = await req.json()
    const { userAddress, market, notionalSize, tradingMode, directionalBias } = body

    // Validate inputs
    if (!userAddress || !market || !notionalSize || !tradingMode) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    if (notionalSize < 10) {
      return NextResponse.json({ error: "Minimum notional size is $10" }, { status: 400 })
    }

    if (directionalBias < 0 || directionalBias > 100) {
      return NextResponse.json({ error: "Directional bias must be between 0-100" }, { status: 400 })
    }

    // Initialize Aptos SDK with bot operator wallet
    const config = new AptosConfig({ network: Network.TESTNET })
    const aptos = new Aptos(config)

    // Strip ed25519-priv- prefix if present
    let privateKeyHex = BOT_OPERATOR_PRIVATE_KEY
    if (privateKeyHex.startsWith("ed25519-priv-")) {
      privateKeyHex = privateKeyHex.replace("ed25519-priv-", "")
    }

    const privateKey = new Ed25519PrivateKey(privateKeyHex)
    const botAccount = Account.fromPrivateKey({ privateKey })

    console.log(`🤖 Bot Operator: ${botAccount.accountAddress.toString()}`)
    console.log(`👤 User: ${userAddress}`)

    // Get user's primary subaccount
    const subaccountResult = await aptos.view({
      payload: {
        function: `${DECIBEL_PACKAGE}::dex_accounts::primary_subaccount`,
        typeArguments: [],
        functionArguments: [userAddress],
      },
    })
    const subaccountAddr = subaccountResult[0] as string

    console.log(`📦 Subaccount: ${subaccountAddr}`)

    // Check if bot is delegated
    const delegationResult = await aptos.view({
      payload: {
        function: `${DECIBEL_PACKAGE}::dex_accounts::is_delegated_trader`,
        typeArguments: [],
        functionArguments: [subaccountAddr, BOT_OPERATOR_ADDRESS],
      },
    })
    const isDelegated = delegationResult[0] as boolean

    if (!isDelegated) {
      return NextResponse.json(
        { error: "Bot is not authorized. Please delegate trading permissions first." },
        { status: 403 }
      )
    }

    // Map trading mode to TWAP duration
    const durations = {
      aggressive: { min: 300, max: 600 }, // 5-10 min
      normal: { min: 600, max: 1200 }, // 10-20 min
      passive: { min: 1200, max: 2400 }, // 20-40 min
    }
    const { min, max } = durations[tradingMode]

    // Calculate long/short allocation
    const longNotional = notionalSize * (directionalBias / 100)
    const shortNotional = notionalSize * ((100 - directionalBias) / 100)

    // Get market config
    const marketConfig = MARKETS[market]
    if (!marketConfig) {
      return NextResponse.json({ error: "Invalid market" }, { status: 400 })
    }

    const orders: BotOrder[] = []

    // Helper function to convert USD notional to contract units
    // For now, we'll use a simplified conversion - you'll need to adjust based on current price
    const convertToSize = (notional: number): number => {
      // This is a placeholder - you should fetch current market price and calculate actual size
      // For BTC at ~$100k: $100 / $100000 = 0.001 BTC = 100,000 units (8 decimals)
      // For now, return a small test size
      const BTC_PRICE = 100000 // Placeholder
      const sizeInAsset = notional / BTC_PRICE
      return Math.floor(sizeInAsset * Math.pow(10, marketConfig.sizeDecimals))
    }

    // Place long TWAP order if applicable
    if (longNotional > 0) {
      const size = convertToSize(longNotional)

      const transaction = await aptos.transaction.build.simple({
        sender: botAccount.accountAddress,
        data: {
          function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
          typeArguments: [],
          functionArguments: [
            subaccountAddr,
            marketConfig.address,
            size,
            true, // is_long
            false, // reduce_only
            min,
            max,
            undefined, // builder_address
            undefined, // max_builder_fee
          ],
        },
      })

      const committedTxn = await aptos.signAndSubmitTransaction({
        signer: botAccount,
        transaction,
      })

      console.log(`✅ Long TWAP order submitted: ${committedTxn.hash}`)

      orders.push({
        side: "long",
        market,
        size,
        txHash: committedTxn.hash,
      })
    }

    // Place short TWAP order if applicable
    if (shortNotional > 0) {
      const size = convertToSize(shortNotional)

      const transaction = await aptos.transaction.build.simple({
        sender: botAccount.accountAddress,
        data: {
          function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
          typeArguments: [],
          functionArguments: [
            subaccountAddr,
            marketConfig.address,
            size,
            false, // is_long (short)
            false, // reduce_only
            min,
            max,
            undefined,
            undefined,
          ],
        },
      })

      const committedTxn = await aptos.signAndSubmitTransaction({
        signer: botAccount,
        transaction,
      })

      console.log(`✅ Short TWAP order submitted: ${committedTxn.hash}`)

      orders.push({
        side: "short",
        market,
        size,
        txHash: committedTxn.hash,
      })
    }

    // Generate bot session ID
    const botId = `bot_${Date.now()}_${userAddress.slice(0, 8)}`

    return NextResponse.json({
      success: true,
      botId,
      orders,
      config: {
        market,
        notionalSize,
        tradingMode,
        directionalBias,
        duration: { min, max },
      },
    })
  } catch (error) {
    console.error("❌ Bot start error:", error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to start bot",
      },
      { status: 500 }
    )
  }
}
