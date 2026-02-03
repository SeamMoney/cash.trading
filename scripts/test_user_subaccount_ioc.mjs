#!/usr/bin/env node
/**
 * Test IOC order with user's actual subaccount
 * This simulates what the HIGH_RISK bot does
 */
import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Ed25519Account } from '@aptos-labs/ts-sdk'
import dotenv from 'dotenv'
dotenv.config()

const DECIBEL_PACKAGE = '0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844'
const BTC_MARKET = '0xdb8c5e968efa1b4dcbb4aaa7e4389358768d9b26bd126d5fe1a33e0aa076c380'
const BOT_PRIVATE_KEY = process.env.BOT_OPERATOR_PRIVATE_KEY

// User's actual subaccount from context
const USER_SUBACCOUNT = '0xe24848442b45138d19973bc0d0dfc3b07d45521723a5343564faa5805c5ffbed'

// Market config from bot-engine.ts
const TICKER_SIZE = 100000n // BTC ticker size in chain units ($0.10)
const LOT_SIZE = 10n
const MIN_SIZE = 100000n // 0.001 BTC minimum

function roundPriceToTickerSize(priceUSD) {
  const priceInChainUnits = BigInt(Math.floor(priceUSD * 1e6))
  return (priceInChainUnits / TICKER_SIZE) * TICKER_SIZE
}

async function main() {
  console.log('=== Testing IOC Order with User Subaccount ===\n')

  const apiKey = (process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY || '')
    .replace(/\\n/g, '').replace(/\n/g, '').trim()

  console.log('API Key present:', apiKey ? 'YES' : 'NO')

  const config = new AptosConfig({
    network: Network.TESTNET,
    clientConfig: apiKey ? { HEADERS: { Authorization: `Bearer ${apiKey}` } } : undefined
  })
  const aptos = new Aptos(config)

  const privateKey = new Ed25519PrivateKey(BOT_PRIVATE_KEY.replace('ed25519-priv-', ''))
  const botAccount = new Ed25519Account({ privateKey })
  console.log('Bot address:', botAccount.accountAddress.toString())
  console.log('User subaccount:', USER_SUBACCOUNT)

  // Check delegation
  console.log('\nChecking delegation...')
  const subRes = await aptos.getAccountResources({ accountAddress: USER_SUBACCOUNT })
  const subaccountRes = subRes.find(r => r.type.includes('Subaccount'))
  const delegations = subaccountRes?.data?.delegated_permissions?.root?.children?.entries || []
  const botDelegated = delegations.some(d =>
    d.key.toLowerCase() === botAccount.accountAddress.toString().toLowerCase()
  )
  console.log('Bot delegated:', botDelegated ? 'YES' : 'NO')

  if (!botDelegated) {
    console.log('\n❌ Bot not delegated! Cannot place orders.')
    return
  }

  // Get market price
  const marketRes = await aptos.getAccountResources({ accountAddress: BTC_MARKET })
  const priceRes = marketRes.find(r => r.type.includes('Price'))
  const markPx = Number(priceRes?.data?.mark_px || 0) / 1e6
  console.log('\nBTC mark price: $' + markPx.toFixed(2))

  // Calculate IOC price with slippage (2%)
  const isLong = true
  const IOC_SLIPPAGE_PCT = 0.02
  const PROFIT_TARGET_PCT = 0.005 // 0.5%
  const STOP_LOSS_PCT = 0.003 // 0.3%

  const iocPrice = isLong ? markPx * (1 + IOC_SLIPPAGE_PCT) : markPx * (1 - IOC_SLIPPAGE_PCT)
  const tpPrice = isLong ? markPx * (1 + PROFIT_TARGET_PCT) : markPx * (1 - PROFIT_TARGET_PCT)
  const slPrice = isLong ? markPx * (1 - STOP_LOSS_PCT) : markPx * (1 + STOP_LOSS_PCT)

  // Round to ticker size
  const iocPriceChain = roundPriceToTickerSize(iocPrice)
  const tpPriceChain = roundPriceToTickerSize(tpPrice)
  const slPriceChain = roundPriceToTickerSize(slPrice)

  // Position size: 0.005 BTC = 500000 in chain units
  const positionSize = 500000

  console.log('\nOrder params:')
  console.log('  Direction: LONG')
  console.log('  IOC Price: $' + (Number(iocPriceChain) / 1e6).toFixed(2) + ' (chain: ' + iocPriceChain + ')')
  console.log('  Size: ' + positionSize + ' (0.005 BTC)')
  console.log('  TP: $' + (Number(tpPriceChain) / 1e6).toFixed(2))
  console.log('  SL: $' + (Number(slPriceChain) / 1e6).toFixed(2))

  console.log('\n>>> DRY RUN - Not submitting transaction <<<')
  console.log('To actually submit, uncomment the submit code below')

  // Build transaction (dry run)
  try {
    const transaction = await aptos.transaction.build.simple({
      sender: botAccount.accountAddress,
      data: {
        function: `${DECIBEL_PACKAGE}::dex_accounts_entry::place_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          USER_SUBACCOUNT,
          BTC_MARKET,
          iocPriceChain.toString(),
          positionSize.toString(),
          isLong,
          1, // IOC
          false, // post_only
          undefined, undefined, undefined,
          tpPriceChain.toString(),
          slPriceChain.toString(),
          undefined, undefined, undefined,
        ],
      },
    })
    console.log('\n✅ Transaction built successfully!')
    console.log('   This confirms the parameters are valid.')

    // Uncomment to actually submit:
    // const committed = await aptos.signAndSubmitTransaction({ signer: botAccount, transaction })
    // console.log('TX hash:', committed.hash)
    // const result = await aptos.waitForTransaction({ transactionHash: committed.hash })
    // console.log('TX success:', result.success)

  } catch (e) {
    console.error('\n❌ Transaction build failed:', e.message)
  }
}

main().catch(console.error)
