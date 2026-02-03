#!/usr/bin/env node
/**
 * Test with OLD package address (matching subaccount)
 */

import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Ed25519Account } from '@aptos-labs/ts-sdk'
import dotenv from 'dotenv'
dotenv.config()

// OLD package (matches subaccount type)
const OLD_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'
// NEW package (matches market type)
const NEW_PACKAGE = '0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844'

const BTC_MARKET = '0xdb8c5e968efa1b4dcbb4aaa7e4389358768d9b26bd126d5fe1a33e0aa076c380'
const BOT_PRIVATE_KEY = process.env.BOT_OPERATOR_PRIVATE_KEY
const USER_SUBACCOUNT = '0x562bc63876b907d9903f8e435df2b1ef44ef46c896e6a3f162a5880167099749'

async function main() {
  console.log('=== Testing Package Compatibility ===\n')

  const apiKey = (process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY || '')
    .replace(/\\n/g, '').replace(/\n/g, '').trim()

  const config = new AptosConfig({
    network: Network.TESTNET,
    clientConfig: apiKey ? { HEADERS: { Authorization: `Bearer ${apiKey}` } } : undefined
  })
  const aptos = new Aptos(config)

  const privateKey = new Ed25519PrivateKey(BOT_PRIVATE_KEY.replace('ed25519-priv-', ''))
  const botAccount = new Ed25519Account({ privateKey })

  const contractSize = 10000
  const isLong = true

  // Get subaccount package
  const subRes = await aptos.getAccountResources({ accountAddress: USER_SUBACCOUNT })
  const subType = subRes.find(r => r.type.includes('Subaccount'))?.type || ''
  const subPkg = subType.split('::')[0]
  console.log('Subaccount package:', subPkg.slice(0, 20) + '...')

  // Get market package
  const mktRes = await aptos.getAccountResources({ accountAddress: BTC_MARKET })
  const mktType = mktRes.find(r => r.type.includes('PerpMarket'))?.type || ''
  const mktPkg = mktType.split('::')[0]
  console.log('Market package:', mktPkg.slice(0, 20) + '...')

  console.log('\nPackages match:', subPkg === mktPkg ? '✅ YES' : '❌ NO - INCOMPATIBLE!')

  if (subPkg !== mktPkg) {
    console.log('\n⚠️  Subaccount and market are from DIFFERENT packages!')
    console.log('   This means the subaccount was created before the testnet reset.')
    console.log('   Users need to create NEW subaccounts with the current package.')
    console.log('\n   Solution: Create new subaccount via Decibel UI, then re-delegate to bot.')
  }

  // Try OLD package anyway (will fail because market doesn't match)
  console.log('\n--- TEST: OLD PACKAGE (subaccount matches) ---')
  try {
    const tx = await aptos.transaction.build.simple({
      sender: botAccount.accountAddress,
      data: {
        function: `${OLD_PACKAGE}::dex_accounts_entry::place_twap_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          USER_SUBACCOUNT, BTC_MARKET, contractSize.toString(), isLong, false, 60, 120, undefined, undefined
        ],
      },
    })
    const committed = await aptos.signAndSubmitTransaction({ signer: botAccount, transaction: tx })
    const result = await aptos.waitForTransaction({ transactionHash: committed.hash })
    console.log(result.success ? '✅ SUCCESS!' : `❌ FAILED: ${result.vm_status}`)
  } catch (e) {
    console.log('❌ ERROR:', e.message?.slice(0, 80))
  }

  // Try NEW package (will fail because subaccount doesn't match)
  console.log('\n--- TEST: NEW PACKAGE (market matches) ---')
  try {
    const tx = await aptos.transaction.build.simple({
      sender: botAccount.accountAddress,
      data: {
        function: `${NEW_PACKAGE}::dex_accounts_entry::place_twap_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          USER_SUBACCOUNT, BTC_MARKET, contractSize.toString(), isLong, false, 60, 120, undefined, undefined
        ],
      },
    })
    const committed = await aptos.signAndSubmitTransaction({ signer: botAccount, transaction: tx })
    const result = await aptos.waitForTransaction({ transactionHash: committed.hash })
    console.log(result.success ? '✅ SUCCESS!' : `❌ FAILED: ${result.vm_status}`)
  } catch (e) {
    console.log('❌ ERROR:', e.message?.slice(0, 80))
  }
}

main().catch(console.error)
