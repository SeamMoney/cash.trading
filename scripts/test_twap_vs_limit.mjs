#!/usr/bin/env node
/**
 * Compare TWAP (works) vs Limit order (fails) with identical params
 */

import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Ed25519Account } from '@aptos-labs/ts-sdk'
import dotenv from 'dotenv'
dotenv.config()

const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'
const BTC_MARKET = '0xdb8c5e968efa1b4dcbb4aaa7e4389358768d9b26bd126d5fe1a33e0aa076c380'
const BOT_PRIVATE_KEY = process.env.BOT_OPERATOR_PRIVATE_KEY
const USER_SUBACCOUNT = '0xf9072807a102e8a86c21992366edf9b26607ed2e8cea170ca35c1ade61ae2e4e'

async function main() {
  console.log('=== TWAP vs Limit Order Test ===\n')

  const apiKey = (process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY || '')
    .replace(/\\n/g, '').replace(/\n/g, '').trim()

  const config = new AptosConfig({
    network: Network.TESTNET,
    clientConfig: apiKey ? { HEADERS: { Authorization: `Bearer ${apiKey}` } } : undefined
  })
  const aptos = new Aptos(config)

  const privateKey = new Ed25519PrivateKey(BOT_PRIVATE_KEY.replace('ed25519-priv-', ''))
  const botAccount = new Ed25519Account({ privateKey })

  const contractSize = 10000  // 0.0001 BTC
  const isLong = true

  console.log('Common params:')
  console.log('  Subaccount:', USER_SUBACCOUNT.slice(0, 30) + '...')
  console.log('  Market:', BTC_MARKET.slice(0, 30) + '...')
  console.log('  Size:', contractSize)
  console.log('  Direction:', isLong ? 'LONG' : 'SHORT')

  // Test 1: TWAP (should work)
  console.log('\n--- TEST 1: TWAP ORDER ---')
  try {
    const twapTx = await aptos.transaction.build.simple({
      sender: botAccount.accountAddress,
      data: {
        function: `${DECIBEL_PACKAGE}::dex_accounts_entry::place_twap_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          USER_SUBACCOUNT,
          BTC_MARKET,
          contractSize.toString(),
          isLong,
          false,     // reduce_only
          60,        // min duration
          120,       // max duration
          undefined, // builder_address
          undefined, // max_builder_fee
        ],
      },
    })

    const twapCommitted = await aptos.signAndSubmitTransaction({
      signer: botAccount,
      transaction: twapTx,
    })
    console.log('TX:', twapCommitted.hash.slice(0, 30) + '...')

    const twapResult = await aptos.waitForTransaction({ transactionHash: twapCommitted.hash })
    console.log(twapResult.success ? '✅ TWAP SUCCESS!' : `❌ TWAP FAILED: ${twapResult.vm_status}`)
  } catch (e) {
    console.log('❌ TWAP ERROR:', e.message?.slice(0, 100))
  }

  // Test 2: Limit order with IOC (should fail?)
  console.log('\n--- TEST 2: LIMIT ORDER (IOC) ---')
  const limitPrice = Math.floor(110000 * 1e6)  // $110k with 6 decimals
  console.log('  Limit price:', limitPrice, '($110,000)')

  try {
    const limitTx = await aptos.transaction.build.simple({
      sender: botAccount.accountAddress,
      data: {
        function: `${DECIBEL_PACKAGE}::dex_accounts_entry::place_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          USER_SUBACCOUNT,
          BTC_MARKET,
          limitPrice.toString(),     // px
          contractSize.toString(),   // sz
          isLong,                    // is_long
          1,                         // time_in_force: 1 = IOC
          false,                     // post_only
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

    const limitCommitted = await aptos.signAndSubmitTransaction({
      signer: botAccount,
      transaction: limitTx,
    })
    console.log('TX:', limitCommitted.hash.slice(0, 30) + '...')

    const limitResult = await aptos.waitForTransaction({ transactionHash: limitCommitted.hash })
    console.log(limitResult.success ? '✅ LIMIT SUCCESS!' : `❌ LIMIT FAILED: ${limitResult.vm_status}`)
  } catch (e) {
    console.log('❌ LIMIT ERROR:', e.message?.slice(0, 100))
  }

  console.log('\n=== Test Complete ===')
}

main().catch(console.error)
