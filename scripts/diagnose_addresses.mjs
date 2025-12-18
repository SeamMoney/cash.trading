#!/usr/bin/env node
/**
 * Diagnose which addresses are valid/invalid after testnet reset
 */

import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk'
import dotenv from 'dotenv'
dotenv.config()

const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'
const BTC_MARKET = '0xece61c5c5979000a563ab54a27b844f6636d40f6e0540eb0f0dc3c8e42b0a8ad'
const USER_SUBACCOUNT = '0xf9072807a102e8a86c21992366edf9b26607ed2e8cea170ca35c1ade61ae2e4e'
const BOT_OPERATOR = '0x501f5aab249607751b53dcb84ed68c95ede4990208bd861c3374a9b8ac1426da'

async function main() {
  console.log('=== Diagnosing Addresses ===\n')

  const apiKey = (process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY || '')
    .replace(/\\n/g, '').replace(/\n/g, '').trim()

  const config = new AptosConfig({
    network: Network.TESTNET,
    clientConfig: apiKey ? { HEADERS: { Authorization: `Bearer ${apiKey}` } } : undefined
  })
  const aptos = new Aptos(config)

  // 1. Check Decibel package exists
  console.log('1. DECIBEL PACKAGE:', DECIBEL_PACKAGE.slice(0, 20) + '...')
  try {
    const modules = await aptos.getAccountModules({ accountAddress: DECIBEL_PACKAGE })
    console.log(`   ✅ EXISTS - ${modules.length} modules deployed`)
    const dexAccounts = modules.find(m => m.abi?.name === 'dex_accounts')
    if (dexAccounts) {
      const funcs = dexAccounts.abi?.exposed_functions?.map(f => f.name) || []
      console.log(`   dex_accounts functions: ${funcs.slice(0, 5).join(', ')}...`)
    }
  } catch (e) {
    console.log(`   ❌ NOT FOUND: ${e.message}`)
  }

  // 2. Check market exists
  console.log('\n2. BTC MARKET:', BTC_MARKET.slice(0, 20) + '...')
  try {
    const resources = await aptos.getAccountResources({ accountAddress: BTC_MARKET })
    console.log(`   ✅ EXISTS - ${resources.length} resources`)

    // Check for market config
    const marketConfig = resources.find(r => r.type.includes('PerpMarketConfig'))
    if (marketConfig) {
      const data = marketConfig.data
      console.log(`   Market name: ${data.name || 'unknown'}`)
      console.log(`   Is active: ${data.is_active}`)
    }

    // Check for price
    const price = resources.find(r => r.type.includes('Price'))
    if (price) {
      console.log(`   Oracle price: $${(Number(price.data.oracle_px) / 1e6).toFixed(2)}`)
    }
  } catch (e) {
    console.log(`   ❌ NOT FOUND: ${e.message}`)
  }

  // 3. Check subaccount exists
  console.log('\n3. USER SUBACCOUNT:', USER_SUBACCOUNT.slice(0, 20) + '...')
  try {
    const resources = await aptos.getAccountResources({ accountAddress: USER_SUBACCOUNT })
    console.log(`   ✅ EXISTS - ${resources.length} resources`)

    // Check for Subaccount resource
    const subaccount = resources.find(r => r.type.includes('Subaccount'))
    if (subaccount) {
      console.log(`   Subaccount resource found`)
      const data = subaccount.data
      console.log(`   Owner: ${data.owner?.slice(0, 20)}...`)
      console.log(`   Is active: ${data.is_active}`)

      // Check delegations
      const delegations = data.delegated_permissions?.entries || []
      console.log(`   Delegations: ${delegations.length}`)
      delegations.forEach(d => {
        console.log(`     - ${d.key.slice(0, 20)}... (bot: ${d.key.toLowerCase() === BOT_OPERATOR.toLowerCase()})`)
      })
    } else {
      console.log(`   ⚠️  No Subaccount resource - might be wrong address type`)
    }

    // Check for positions
    const positions = resources.find(r => r.type.includes('UserPositions'))
    if (positions) {
      const entries = positions.data?.positions?.root?.children?.entries || []
      console.log(`   Open positions: ${entries.length}`)
    }
  } catch (e) {
    console.log(`   ❌ NOT FOUND: ${e.message}`)
  }

  // 4. Check bot operator exists
  console.log('\n4. BOT OPERATOR:', BOT_OPERATOR.slice(0, 20) + '...')
  try {
    const resources = await aptos.getAccountResources({ accountAddress: BOT_OPERATOR })
    console.log(`   ✅ EXISTS - ${resources.length} resources`)
  } catch (e) {
    console.log(`   ❌ NOT FOUND: ${e.message}`)
  }

  // 5. Try to get fresh market addresses from SDK
  console.log('\n5. CHECKING FRESH MARKET ADDRESSES FROM SDK...')
  try {
    const { getAllMarketAddresses } = await import('../lib/decibel-sdk.js')
    const markets = await getAllMarketAddresses()
    console.log(`   Found ${markets.length} markets:`)
    markets.forEach(m => {
      const isCurrent = m.address.toLowerCase() === BTC_MARKET.toLowerCase()
      console.log(`   ${isCurrent ? '→' : ' '} ${m.name}: ${m.address.slice(0, 20)}...${isCurrent ? ' (MATCHES)' : ''}`)
    })

    const btcMarket = markets.find(m => m.name === 'BTC/USD')
    if (btcMarket && btcMarket.address.toLowerCase() !== BTC_MARKET.toLowerCase()) {
      console.log(`\n   ⚠️  BTC MARKET ADDRESS CHANGED!`)
      console.log(`   Old: ${BTC_MARKET}`)
      console.log(`   New: ${btcMarket.address}`)
    }
  } catch (e) {
    console.log(`   ❌ SDK error: ${e.message}`)
  }

  console.log('\n=== Diagnosis Complete ===')
}

main().catch(console.error)
