#!/usr/bin/env node
import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Ed25519Account } from '@aptos-labs/ts-sdk'
import dotenv from 'dotenv'
dotenv.config()

const DECIBEL_PACKAGE = '0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844'
const BTC_MARKET = '0xdb8c5e968efa1b4dcbb4aaa7e4389358768d9b26bd126d5fe1a33e0aa076c380'
const BOT_PRIVATE_KEY = process.env.BOT_OPERATOR_PRIVATE_KEY
const NEW_PKG_SUBACCOUNT = '0xedc4f80385388098aa18832727056fb30b33c4f3b7076b6653346d5712088289'

async function main() {
  console.log('=== Testing IOC Order with Verbose Output ===\n')

  const apiKey = (process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY || '')
    .replace(/\\n/g, '').replace(/\n/g, '').trim()

  console.log('API Key present:', apiKey ? 'YES (' + apiKey.slice(0,10) + '...)' : 'NO')

  const config = new AptosConfig({
    network: Network.TESTNET,
    clientConfig: apiKey ? { HEADERS: { Authorization: `Bearer ${apiKey}` } } : undefined
  })
  const aptos = new Aptos(config)

  const privateKey = new Ed25519PrivateKey(BOT_PRIVATE_KEY.replace('ed25519-priv-', ''))
  const botAccount = new Ed25519Account({ privateKey })
  console.log('Bot address:', botAccount.accountAddress.toString())

  // Get current BTC price from market
  try {
    const marketRes = await aptos.getAccountResources({ accountAddress: BTC_MARKET })
    const priceRes = marketRes.find(r => r.type.includes('Price'))
    const markPx = Number(priceRes?.data?.mark_px || 0)
    const oraclePx = Number(priceRes?.data?.oracle_px || 0)
    const indexPrice = (markPx || oraclePx) / 1e6
    console.log('BTC price: $' + indexPrice.toFixed(2) + ' (mark: $' + (markPx/1e6).toFixed(2) + ', oracle: $' + (oraclePx/1e6).toFixed(2) + ')')

    // Calculate aggressive IOC price
    const isLong = true
    const slippage = 0.02 // 2%
    const tickerSize = 100000 // $0.10 in chain units
    const iocPrice = isLong ? indexPrice * (1 + slippage) : indexPrice * (1 - slippage)
    // Round price to ticker size
    const iocPriceChain = Math.round(iocPrice * 1e6 / tickerSize) * tickerSize

    console.log('\nPlacing IOC order...')
    console.log('  Price: $' + iocPrice.toFixed(2))
    console.log('  Size: 500000 (0.005 BTC)')
    console.log('  Direction: LONG')

    const transaction = await aptos.transaction.build.simple({
      sender: botAccount.accountAddress,
      data: {
        function: DECIBEL_PACKAGE + '::dex_accounts_entry::place_order_to_subaccount',
        typeArguments: [],
        functionArguments: [
          NEW_PKG_SUBACCOUNT,
          BTC_MARKET,
          iocPriceChain.toString(),  // price
          '500000',                   // size (0.005 BTC)
          isLong,                     // is_long
          1,                          // time_in_force: 1 = IOC
          false,                      // post_only
          undefined,                  // client_order_id
          undefined,                  // conditional_order
          undefined,                  // trigger_price
          undefined,                  // take_profit_px
          undefined,                  // stop_loss_px
          undefined,                  // reduce_only
          undefined,                  // builder_address
          undefined,                  // max_builder_fee
        ],
      },
    })

    console.log('TX built, signing and submitting...')
    const committed = await aptos.signAndSubmitTransaction({
      signer: botAccount,
      transaction,
    })
    console.log('TX hash:', committed.hash)

    const result = await aptos.waitForTransaction({ transactionHash: committed.hash })
    console.log('TX success:', result.success)
    if (!result.success) {
      console.log('VM status:', result.vm_status)
    } else {
      console.log('✅ IOC ORDER PLACED SUCCESSFULLY!')

      // Check if position was opened
      await new Promise(r => setTimeout(r, 2000))
      const subRes = await aptos.getAccountResources({ accountAddress: NEW_PKG_SUBACCOUNT })
      const posRes = subRes.find(r => r.type.includes('PerpPosition'))
      const posData = posRes?.data?.positions?.data || []
      const btcPos = posData.find(p => p.key === BTC_MARKET)

      if (btcPos && btcPos.value?.size && BigInt(btcPos.value.size) !== 0n) {
        console.log('Position opened!')
        console.log('  Size:', btcPos.value.size)
        console.log('  Entry:', (Number(btcPos.value.avg_entry_price) / 1e6).toFixed(2))
      } else {
        console.log('No position (IOC may not have filled)')
      }
    }
  } catch (e) {
    console.error('\n❌ ERROR:')
    console.error(e.message || e)
    if (e.data) {
      console.error('Error data:', JSON.stringify(e.data, null, 2))
    }
  }
}

main()
