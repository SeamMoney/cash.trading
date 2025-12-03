/**
 * Emergency Position Close Script
 *
 * Immediately closes any open position on the subaccount.
 * Use this when a position needs to be closed manually.
 *
 * Usage:
 *   npx tsx scripts/close-position.ts
 */

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk'

const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'
const BTC_MARKET = '0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e'
const SUBACCOUNT = '0xfd59a5bbaa2d534533385511c79adace521eb67e3ac824c9ad0b8e0eaad4f14d'

// Position details from on-chain
const POSITION_SIZE = 211661460  // 2.1166 BTC
const IS_LONG = true

async function main() {
  console.log('=== EMERGENCY POSITION CLOSE ===')
  console.log('Position: 2.1166 BTC LONG')
  console.log('')

  // Get private key from environment
  const privateKeyHex = process.env.BOT_OPERATOR_PRIVATE_KEY || process.env.APTOS_PRIVATE_KEY
  if (!privateKeyHex) {
    console.error('ERROR: Set BOT_OPERATOR_PRIVATE_KEY or APTOS_PRIVATE_KEY')
    process.exit(1)
  }

  // Setup Aptos client
  const config = new AptosConfig({ network: Network.TESTNET })
  const aptos = new Aptos(config)

  // Setup account
  const cleanKey = privateKeyHex.replace('ed25519-priv-', '').replace('0x', '')
  const privateKey = new Ed25519PrivateKey(cleanKey)
  const botAccount = Account.fromPrivateKey({ privateKey })

  console.log('Bot operator:', botAccount.accountAddress.toString())

  // Get current price
  const priceRes = await fetch(`https://api.testnet.aptoslabs.com/v1/accounts/${BTC_MARKET}/resources`)
  const resources = await priceRes.json()
  const priceResource = resources.find((r: any) => r.type.includes('Price'))
  const currentPrice = Number(priceResource.data.oracle_px) / 1e6
  console.log('Current BTC price: $' + currentPrice.toFixed(2))

  // To close a LONG, we need to SHORT
  const closeDirection = !IS_LONG

  // Aggressive limit price for instant fill (2% slippage)
  const slippage = 0.02
  const aggressivePrice = closeDirection
    ? currentPrice * (1 - slippage)  // selling (closing long)
    : currentPrice * (1 + slippage)  // buying (closing short)

  // BTC ticker size is 100000 (0.1 USD)
  const tickerSize = 100000
  const limitPrice = Math.floor((aggressivePrice * 1e6) / tickerSize) * tickerSize
  console.log('Limit price: $' + (limitPrice / 1e6).toFixed(2))
  console.log('')

  console.log('Sending close order...')

  const transaction = await aptos.transaction.build.simple({
    sender: botAccount.accountAddress,
    data: {
      function: `${DECIBEL_PACKAGE}::dex_accounts::place_order_to_subaccount`,
      typeArguments: [],
      functionArguments: [
        SUBACCOUNT,
        BTC_MARKET,
        limitPrice.toString(),      // px
        POSITION_SIZE.toString(),   // sz
        closeDirection,             // is_long (false to close long)
        1,                          // IOC
        false,                      // post_only
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      ],
    },
  })

  const committedTxn = await aptos.signAndSubmitTransaction({
    signer: botAccount,
    transaction,
  })

  console.log('TX submitted:', committedTxn.hash)

  const result = await aptos.waitForTransaction({
    transactionHash: committedTxn.hash,
  })

  if (result.success) {
    console.log('✅ POSITION CLOSED!')

    // Calculate PnL
    const entryPrice = 91854.45
    const priceChange = (currentPrice - entryPrice) / entryPrice
    const sizeInBtc = POSITION_SIZE / 1e8
    const positionValueUSD = sizeInBtc * entryPrice
    const realizedPnl = positionValueUSD * priceChange

    console.log('')
    console.log('Entry: $' + entryPrice.toFixed(2))
    console.log('Exit: $' + currentPrice.toFixed(2))
    console.log('Price change: ' + (priceChange * 100).toFixed(3) + '%')
    console.log('Realized PnL: $' + realizedPnl.toFixed(2))
  } else {
    console.error('❌ Close failed:', result.vm_status)
  }
}

main().catch(console.error)
