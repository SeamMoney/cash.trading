#!/usr/bin/env node
/**
 * Delegate trading permissions to the bot operator wallet
 *
 * This allows the bot to place orders on your behalf without requiring
 * you to sign each transaction manually.
 */

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk'

const DECIBEL_PACKAGE = '0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844'
const BOT_OPERATOR = '0x501f5aab249607751b53dcb84ed68c95ede4990208bd861c3374a9b8ac1426da'

async function main() {
  console.log('🤖 Delegating Trading Permissions to Bot Operator\n')

  // Initialize Aptos
  const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }))

  // Load YOUR wallet private key
  let privateKeyHex = process.env.USER_WALLET_PRIVATE_KEY || process.env.APTOS_PRIVATE_KEY
  if (!privateKeyHex) {
    console.error('❌ Error: USER_WALLET_PRIVATE_KEY or APTOS_PRIVATE_KEY not set')
    console.log('\nUsage:')
    console.log('  export USER_WALLET_PRIVATE_KEY="0x..." (or APTOS_PRIVATE_KEY)')
    console.log('  node delegate_to_bot.mjs')
    process.exit(1)
  }

  // Strip prefix if present
  if (privateKeyHex.startsWith('ed25519-priv-')) {
    privateKeyHex = privateKeyHex.replace('ed25519-priv-', '')
  }

  const privateKey = new Ed25519PrivateKey(privateKeyHex)
  const userAccount = Account.fromPrivateKey({ privateKey })

  console.log(`👤 Your Wallet: ${userAccount.accountAddress.toString()}`)
  console.log(`🤖 Bot Operator: ${BOT_OPERATOR}`)

  // Get subaccount
  console.log('\n📦 Getting your subaccount...')
  const subaccountResult = await aptos.view({
    payload: {
      function: `${DECIBEL_PACKAGE}::dex_accounts::primary_subaccount`,
      typeArguments: [],
      functionArguments: [userAccount.accountAddress.toString()],
    },
  })

  const subaccount = subaccountResult[0]
  console.log(`✅ Subaccount: ${subaccount}`)

  // Delegate trading permissions
  console.log('\n🔐 Delegating trading permissions...')
  const transaction = await aptos.transaction.build.simple({
    sender: userAccount.accountAddress,
    data: {
      function: `${DECIBEL_PACKAGE}::dex_accounts::delegate_trading_to_for_subaccount`,
      typeArguments: [],
      functionArguments: [
        subaccount,
        BOT_OPERATOR,
        undefined, // expiration (none = unlimited)
      ],
    },
  })

  const committedTxn = await aptos.signAndSubmitTransaction({
    signer: userAccount,
    transaction,
  })

  console.log(`✅ Transaction submitted: ${committedTxn.hash}`)
  console.log(`🔗 Explorer: https://explorer.aptoslabs.com/txn/${committedTxn.hash}?network=testnet`)

  // Wait for confirmation
  console.log('\n⏳ Waiting for confirmation...')
  const executedTxn = await aptos.waitForTransaction({
    transactionHash: committedTxn.hash,
  })

  if (executedTxn.success) {
    console.log('✅ Delegation confirmed!')
    console.log('\n🎉 The bot can now trade on your behalf!')
    console.log('\nNext: Start the bot from the UI and it will place orders automatically!')
  } else {
    console.log('❌ Delegation failed')
    console.log(executedTxn)
  }
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message)
  if (error.data) {
    console.error('Details:', JSON.stringify(error.data, null, 2))
  }
  process.exit(1)
})
