/**
 * Direct bot test script
 * Tests the bot engine directly without going through API routes
 * Run with: node test-bot-direct.mjs
 */

import 'dotenv/config'

console.log('🧪 DIRECT BOT TEST')
console.log('=' .repeat(60))

// Check environment
console.log('\n📋 Environment Check:')
console.log('BOT_OPERATOR_PRIVATE_KEY:', process.env.BOT_OPERATOR_PRIVATE_KEY ? '✅ Set' : '❌ Missing')
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '✅ Set' : '❌ Missing')

// Import bot engine
console.log('\n📦 Importing bot engine...')
const { VolumeBotEngine } = await import('./lib/bot-engine.ts')
console.log('✅ Bot engine imported')

// Test configuration
const config = {
  userWalletAddress: '0xc1dd7c7b9ce198a0f8168869ea925bcfd04a900090d018ab7d246b7369b4bc5c',
  userSubaccount: '0xfd59a5bbaa2d534533385511c79adace521eb67e3ac824c9ad0b8e0eaad4f14d',
  capitalUSDC: 2920.92,
  volumeTargetUSDC: 10000,
  bias: 'long',
  strategy: 'high_risk',
  market: '0xdb8c5e968efa1b4dcbb4aaa7e4389358768d9b26bd126d5fe1a33e0aa076c380',
  marketName: 'BTC/USD',
}

console.log('\n🎯 Test Configuration:')
console.log(JSON.stringify(config, null, 2))

try {
  console.log('\n🤖 Creating bot instance...')
  const bot = new VolumeBotEngine(config)
  console.log('✅ Bot instance created')

  console.log('\n📊 Initial Status:')
  const statusBefore = bot.getStatus()
  console.log(JSON.stringify(statusBefore, null, 2))

  console.log('\n🚀 Executing single trade...')
  console.log('This will attempt to place a real order on Aptos testnet')
  console.log('Watch for transaction hash and confirmation')
  console.log('-'.repeat(60))

  const success = await bot.executeSingleTrade()

  console.log('-'.repeat(60))
  console.log('\n📊 Final Status:')
  const statusAfter = bot.getStatus()
  console.log(JSON.stringify(statusAfter, null, 2))

  console.log('\n' + '='.repeat(60))
  if (success) {
    console.log('✅ TEST PASSED - Trade executed successfully!')
    console.log(`Orders placed: ${statusAfter.ordersPlaced}`)
    console.log(`Volume generated: $${statusAfter.cumulativeVolume.toFixed(2)}`)
  } else {
    console.log('❌ TEST FAILED - Trade execution failed')
  }
  console.log('='.repeat(60))

  process.exit(success ? 0 : 1)
} catch (error) {
  console.error('\n❌ FATAL ERROR:')
  console.error(error)
  console.error('\nStack trace:')
  console.error(error.stack)
  process.exit(1)
}
