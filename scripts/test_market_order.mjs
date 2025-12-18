#!/usr/bin/env node
/**
 * Test direct market order via place_market_order_to_subaccount
 * This should fill INSTANTLY unlike TWAP
 */

import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Ed25519Account } from '@aptos-labs/ts-sdk'
import dotenv from 'dotenv'
dotenv.config()

const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'
const BTC_MARKET = '0xece61c5c5979000a563ab54a27b844f6636d40f6e0540eb0f0dc3c8e42b0a8ad'

// Test with bot operator credentials
const BOT_PRIVATE_KEY = process.env.BOT_OPERATOR_PRIVATE_KEY
const USER_SUBACCOUNT = '0xf9072807a102e8a86c21992366edf9b26607ed2e8cea170ca35c1ade61ae2e4e' // Working TX_SPAMMER subaccount

async function main() {
  console.log('=== Testing Direct Market Order ===\n')

  if (!BOT_PRIVATE_KEY) {
    console.error('Missing BOT_OPERATOR_PRIVATE_KEY')
    process.exit(1)
  }

  // Setup Aptos client with API key
  const apiKey = (process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY || '')
    .replace(/\\n/g, '').replace(/\n/g, '').trim()

  const config = new AptosConfig({
    network: Network.TESTNET,
    clientConfig: apiKey ? { HEADERS: { Authorization: `Bearer ${apiKey}` } } : undefined
  })
  const aptos = new Aptos(config)

  // Setup bot account
  const privateKey = new Ed25519PrivateKey(BOT_PRIVATE_KEY.replace('ed25519-priv-', ''))
  const botAccount = new Ed25519Account({ privateKey })
  console.log('Bot operator:', botAccount.accountAddress.toString())

  // Small test size: 0.0001 BTC = 10000 in contract units (8 decimals)
  const contractSize = 10000
  const isLong = true

  console.log(`\nPlacing MARKET ORDER:`)
  console.log(`  Size: ${contractSize} (0.0001 BTC)`)
  console.log(`  Direction: ${isLong ? 'LONG' : 'SHORT'}`)
  console.log(`  Market: BTC/USD`)
  console.log(`  Subaccount: ${USER_SUBACCOUNT.slice(0, 20)}...`)

  try {
    const startTime = Date.now()

    const transaction = await aptos.transaction.build.simple({
      sender: botAccount.accountAddress,
      data: {
        function: `${DECIBEL_PACKAGE}::dex_accounts::place_market_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          USER_SUBACCOUNT,     // subaccount
          BTC_MARKET,          // market
          contractSize,        // size (u64)
          isLong,              // is_long (bool)
          false,               // reduce_only (bool)
          undefined,           // client_order_id
          undefined,           // stop_price
          undefined,           // tp_trigger_price
          undefined,           // tp_limit_price
          undefined,           // sl_trigger_price
          undefined,           // sl_limit_price
          undefined,           // builder_address
          undefined,           // max_builder_fee
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
      console.log(`\n✅ MARKET ORDER SUCCESS in ${elapsed}ms!`)
      console.log(`   TX: https://explorer.aptoslabs.com/txn/${committedTxn.hash}?network=testnet`)
    } else {
      console.log(`\n❌ MARKET ORDER FAILED: ${executedTxn.vm_status}`)
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message || error)

    // Check if it's the same ERESOURCE error
    if (error.message?.includes('ERESOURCE_DOES_NOT_EXIST')) {
      console.log('\n⚠️  Same ERESOURCE_DOES_NOT_EXIST error as SDK IOC')
      console.log('   This means the market order function is also broken')
    }
  }
}

main().catch(console.error)
