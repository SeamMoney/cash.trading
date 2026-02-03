#!/usr/bin/env node
/**
 * Test aggressive limit order via place_order_to_subaccount
 * Set price 5% above market for LONG to ensure instant fill
 */

import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Ed25519Account } from '@aptos-labs/ts-sdk'
import dotenv from 'dotenv'
dotenv.config()

const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'
const BTC_MARKET = '0xdb8c5e968efa1b4dcbb4aaa7e4389358768d9b26bd126d5fe1a33e0aa076c380'  // CORRECT address from DB

const BOT_PRIVATE_KEY = process.env.BOT_OPERATOR_PRIVATE_KEY
const USER_SUBACCOUNT = '0xf9072807a102e8a86c21992366edf9b26607ed2e8cea170ca35c1ade61ae2e4e'  // TX_SPAMMER with $85k volume

async function main() {
  console.log('=== Testing Aggressive Limit Order ===\n')

  if (!BOT_PRIVATE_KEY) {
    console.error('Missing BOT_OPERATOR_PRIVATE_KEY')
    process.exit(1)
  }

  const apiKey = (process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY || '')
    .replace(/\\n/g, '').replace(/\n/g, '').trim()

  const config = new AptosConfig({
    network: Network.TESTNET,
    clientConfig: apiKey ? { HEADERS: { Authorization: `Bearer ${apiKey}` } } : undefined
  })
  const aptos = new Aptos(config)

  const privateKey = new Ed25519PrivateKey(BOT_PRIVATE_KEY.replace('ed25519-priv-', ''))
  const botAccount = new Ed25519Account({ privateKey })
  console.log('Bot operator:', botAccount.accountAddress.toString())

  // Use hardcoded BTC price (around $105k on testnet)
  const oraclePrice = 105000
  console.log(`Using BTC price: $${oraclePrice.toFixed(2)}`)

  // For LONG: set limit price 5% ABOVE market to ensure fill
  const slippagePct = 0.05 // 5%
  const isLong = true
  const limitPrice = isLong
    ? Math.floor(oraclePrice * (1 + slippagePct) * 1e6)  // Above for long
    : Math.floor(oraclePrice * (1 - slippagePct) * 1e6)  // Below for short

  const contractSize = 10000  // 0.0001 BTC

  console.log(`\nPlacing AGGRESSIVE LIMIT ORDER:`)
  console.log(`  Size: ${contractSize} (0.0001 BTC)`)
  console.log(`  Direction: ${isLong ? 'LONG' : 'SHORT'}`)
  console.log(`  Limit price: $${(limitPrice / 1e6).toFixed(2)} (${slippagePct * 100}% slippage)`)
  console.log(`  Market: BTC/USD`)

  try {
    const startTime = Date.now()

    const transaction = await aptos.transaction.build.simple({
      sender: botAccount.accountAddress,
      data: {
        function: `${DECIBEL_PACKAGE}::dex_accounts_entry::place_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          USER_SUBACCOUNT,           // subaccount
          BTC_MARKET,                // market
          limitPrice.toString(),     // px FIRST (u64 with 6 decimals)
          contractSize.toString(),   // sz SECOND (u64)
          isLong,                    // is_long (bool)
          1,                         // time_in_force: 1 = IOC for instant fill
          false,                     // post_only: false (we want to take)
          undefined,                 // client_order_id
          undefined,                 // conditional_order
          undefined,                 // trigger_price
          undefined,                 // take_profit_px
          undefined,                 // stop_loss_px
          undefined,                 // reduce_only
          undefined,                 // builder_address
          undefined,                 // max_builder_fee
        ],
      },
    })

    console.log('\nSubmitting transaction...')
    const committedTxn = await aptos.signAndSubmitTransaction({
      signer: botAccount,
      transaction,
    })
    console.log(`TX submitted: ${committedTxn.hash}`)

    const executedTxn = await aptos.waitForTransaction({
      transactionHash: committedTxn.hash,
    })

    const elapsed = Date.now() - startTime

    if (executedTxn.success) {
      console.log(`\n✅ LIMIT ORDER SUCCESS in ${elapsed}ms!`)
      console.log(`   TX: https://explorer.aptoslabs.com/txn/${committedTxn.hash}?network=testnet`)
    } else {
      console.log(`\n❌ LIMIT ORDER FAILED: ${executedTxn.vm_status}`)
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message || error)
  }
}

main().catch(console.error)
