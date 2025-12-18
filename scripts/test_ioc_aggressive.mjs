#!/usr/bin/env node
import { Aptos, AptosConfig, Network, Ed25519PrivateKey, Ed25519Account } from '@aptos-labs/ts-sdk'
import dotenv from 'dotenv'
dotenv.config()

const DECIBEL_PACKAGE = '0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844'
const BTC_MARKET = '0xdb8c5e968efa1b4dcbb4aaa7e4389358768d9b26bd126d5fe1a33e0aa076c380'
const BOT_PRIVATE_KEY = process.env.BOT_OPERATOR_PRIVATE_KEY
const USER_SUBACCOUNT = '0xe24848442b45138d19973bc0d0dfc3b07d45521723a5343564faa5805c5ffbed'
const TICKER_SIZE = 100000n

function roundPriceToTickerSize(priceUSD) {
  const priceInChainUnits = BigInt(Math.floor(priceUSD * 1e6))
  return (priceInChainUnits / TICKER_SIZE) * TICKER_SIZE
}

async function main() {
  console.log('=== Aggressive IOC Test (10% slippage) ===\n')

  const apiKey = (process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY || '')
    .replace(/\\n/g, '').replace(/\n/g, '').trim()

  const config = new AptosConfig({
    network: Network.TESTNET,
    clientConfig: apiKey ? { HEADERS: { Authorization: `Bearer ${apiKey}` } } : undefined
  })
  const aptos = new Aptos(config)

  const privateKey = new Ed25519PrivateKey(BOT_PRIVATE_KEY.replace('ed25519-priv-', ''))
  const botAccount = new Ed25519Account({ privateKey })
  
  const marketRes = await aptos.getAccountResources({ accountAddress: BTC_MARKET })
  const priceRes = marketRes.find(r => r.type.includes('Price'))
  const markPx = Number(priceRes?.data?.mark_px || 0) / 1e6
  console.log('BTC price: $' + markPx.toFixed(2))

  const isLong = true
  const slippage = 0.10 // 10%!
  const iocPrice = isLong ? markPx * (1 + slippage) : markPx * (1 - slippage)
  const iocPriceChain = roundPriceToTickerSize(iocPrice)
  const positionSize = 500000

  console.log('IOC Price: $' + (Number(iocPriceChain) / 1e6).toFixed(2) + ' (' + (slippage*100) + '% slippage)')
  console.log('Size: ' + positionSize + ' (0.005 BTC)')

  try {
    const tx = await aptos.transaction.build.simple({
      sender: botAccount.accountAddress,
      data: {
        function: `${DECIBEL_PACKAGE}::dex_accounts::place_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          USER_SUBACCOUNT, BTC_MARKET, iocPriceChain.toString(), positionSize.toString(),
          isLong, 1, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined
        ],
      },
    })
    const committed = await aptos.signAndSubmitTransaction({ signer: botAccount, transaction: tx })
    console.log('TX:', committed.hash.slice(0, 40) + '...')
    const result = await aptos.waitForTransaction({ transactionHash: committed.hash })
    console.log('Success:', result.success)

    await new Promise(r => setTimeout(r, 2000))
    const subRes = await aptos.getAccountResources({ accountAddress: USER_SUBACCOUNT })
    const posRes = subRes.find(r => r.type.includes('UserPositions'))
    const positions = posRes?.data?.positions?.root?.children?.entries || []
    const btcPos = positions.find(p => p.key?.inner === BTC_MARKET)
    
    if (btcPos && parseInt(btcPos.value?.value?.size || '0') > 0) {
      console.log('\n✅ POSITION OPENED!')
      console.log('   Size:', btcPos.value.value.size)
      console.log('   Entry: $' + (Number(btcPos.value.value.avg_entry_price) / 1e6).toFixed(2))
    } else {
      console.log('\n⚠️ Still no fill - testnet might have no liquidity')
    }
  } catch (e) {
    console.error('ERROR:', e.message?.slice(0, 100))
  }
}
main()
