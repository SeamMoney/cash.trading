#!/usr/bin/env node
/**
 * Test HIGH_RISK compatible subaccount with limit order
 */

import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Ed25519Account } from '@aptos-labs/ts-sdk'
import dotenv from 'dotenv'
dotenv.config()

const NEW_PACKAGE = '0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844'
const BTC_MARKET = '0xdb8c5e968efa1b4dcbb4aaa7e4389358768d9b26bd126d5fe1a33e0aa076c380'
const BOT_PRIVATE_KEY = process.env.BOT_OPERATOR_PRIVATE_KEY

// HIGH_RISK with NEW package subaccount
const NEW_PKG_SUBACCOUNT = '0xedc4f80385388098aa18832727056fb30b33c4f3b7076b6653346d5712088289'

async function main() {
  console.log('=== Testing NEW Package HIGH_RISK Subaccount ===\n')

  const apiKey = (process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY || '')
    .replace(/\\n/g, '').replace(/\n/g, '').trim()

  const config = new AptosConfig({
    network: Network.TESTNET,
    clientConfig: apiKey ? { HEADERS: { Authorization: `Bearer ${apiKey}` } } : undefined
  })
  const aptos = new Aptos(config)

  const privateKey = new Ed25519PrivateKey(BOT_PRIVATE_KEY.replace('ed25519-priv-', ''))
  const botAccount = new Ed25519Account({ privateKey })

  // First check delegation
  console.log('Checking delegation...')
  const resources = await aptos.getAccountResources({ accountAddress: NEW_PKG_SUBACCOUNT })
  const subRes = resources.find(r => r.type.includes('Subaccount'))
  const delegations = subRes?.data?.delegated_permissions?.root?.children?.entries || []
  const hasBotDelegation = delegations.some(d =>
    d.key.toLowerCase() === botAccount.accountAddress.toString().toLowerCase()
  )
  console.log('Bot delegated:', hasBotDelegation ? '✅ YES' : '❌ NO')

  if (!hasBotDelegation) {
    console.log('\n⚠️  Bot operator needs delegation on this subaccount!')
    console.log('   User needs to delegate via Decibel UI first.')
    return
  }

  const contractSize = 500000  // 0.005 BTC = ~$525 (min is 100000 = 0.001 BTC)
  const isLong = true

  // Test TWAP (should work)
  console.log('\n--- TEST: TWAP ORDER ---')
  try {
    const tx = await aptos.transaction.build.simple({
      sender: botAccount.accountAddress,
      data: {
        function: `${NEW_PACKAGE}::dex_accounts_entry::place_twap_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          NEW_PKG_SUBACCOUNT,
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
    const committed = await aptos.signAndSubmitTransaction({ signer: botAccount, transaction: tx })
    console.log('TX:', committed.hash.slice(0, 40) + '...')
    const result = await aptos.waitForTransaction({ transactionHash: committed.hash })
    console.log(result.success ? '✅ TWAP SUCCESS!' : `❌ FAILED: ${result.vm_status}`)
  } catch (e) {
    console.log('❌ ERROR:', e.message?.slice(0, 100))
  }

  // Test limit order with IOC
  console.log('\n--- TEST: LIMIT ORDER (IOC) ---')
  const limitPrice = Math.floor(110000 * 1e6)
  try {
    const tx = await aptos.transaction.build.simple({
      sender: botAccount.accountAddress,
      data: {
        function: `${NEW_PACKAGE}::dex_accounts_entry::place_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          NEW_PKG_SUBACCOUNT,
          BTC_MARKET,
          limitPrice.toString(),     // price
          contractSize.toString(),   // size
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
    const committed = await aptos.signAndSubmitTransaction({ signer: botAccount, transaction: tx })
    console.log('TX:', committed.hash.slice(0, 40) + '...')
    const result = await aptos.waitForTransaction({ transactionHash: committed.hash })
    console.log(result.success ? '✅ LIMIT SUCCESS!' : `❌ FAILED: ${result.vm_status}`)
  } catch (e) {
    console.log('❌ ERROR:', e.message?.slice(0, 100))
  }
}

main().catch(console.error)
