#!/usr/bin/env node

/**
 * HFT IOC Market Order Test Script
 *
 * Tests instant execution using IOC (Immediate Or Cancel) limit orders
 * with aggressive pricing to simulate market orders.
 *
 * This script runs indefinitely, placing random long/short trades
 * to stress test the system and generate PNL variance.
 *
 * Usage:
 *   export BOT_OPERATOR_PRIVATE_KEY="ed25519-priv-0x..."
 *   export USER_WALLET_ADDRESS="0x..."
 *   node scripts/test_hft_ioc.mjs
 */

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';

const DECIBEL_PACKAGE = "0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75";

const MARKETS = {
  'BTC/USD': {
    address: '0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e',
    tickerSize: 100000n,  // Price must be multiple of this
    lotSize: 10n,         // Size must be multiple of this
    minSize: 100000n,     // Minimum order size
    pxDecimals: 6,        // Price decimals
    szDecimals: 8,        // Size decimals (satoshis)
    maxLeverage: 40,
  },
};

// Configuration
const CONFIG = {
  market: 'BTC/USD',
  slippagePct: 0.02,        // 2% slippage for guaranteed fills
  minDelayMs: 3000,         // Minimum 3 seconds between trades
  maxDelayMs: 10000,        // Maximum 10 seconds between trades
  targetNotionalUSD: 500,   // ~$500 per trade
};

let stats = {
  tradesAttempted: 0,
  tradesSucceeded: 0,
  tradesFailed: 0,
  totalVolume: 0,
  startTime: Date.now(),
};

async function getMarketPrice(aptos, marketAddress, pxDecimals) {
  try {
    const resources = await aptos.getAccountResources({ accountAddress: marketAddress });
    const priceResource = resources.find(r => r.type.includes('price_management::Price'));

    if (priceResource?.data) {
      const data = priceResource.data;
      const priceRaw = data.oracle_px || data.mark_px || data.price;
      if (priceRaw) {
        return parseInt(priceRaw) / Math.pow(10, pxDecimals);
      }
    }
  } catch (e) {
    console.log('⚠️  Could not fetch price, using fallback');
  }
  return 97000; // Fallback BTC price
}

function roundPriceToTickerSize(priceUSD, marketConfig) {
  const priceInChainUnits = BigInt(Math.floor(priceUSD * Math.pow(10, marketConfig.pxDecimals)));
  return (priceInChainUnits / marketConfig.tickerSize) * marketConfig.tickerSize;
}

function roundSizeToLotSize(size, marketConfig) {
  const sizeBigInt = BigInt(Math.floor(size));
  let rounded = (sizeBigInt / marketConfig.lotSize) * marketConfig.lotSize;
  if (rounded < marketConfig.minSize) {
    rounded = marketConfig.minSize;
  }
  return rounded;
}

async function placeIOCOrder(aptos, botAccount, userSubaccount, marketConfig, isLong, currentPrice) {
  // Calculate aggressive limit price for instant fill
  // LONG = buy = price ABOVE market (willing to pay more)
  // SHORT = sell = price BELOW market (willing to accept less)
  const aggressivePrice = isLong
    ? currentPrice * (1 + CONFIG.slippagePct)
    : currentPrice * (1 - CONFIG.slippagePct);

  const limitPrice = roundPriceToTickerSize(aggressivePrice, marketConfig);

  // Calculate size for target notional
  const sizeInBTC = CONFIG.targetNotionalUSD / currentPrice;
  const rawSize = Math.floor(sizeInBTC * Math.pow(10, marketConfig.szDecimals));
  const contractSize = roundSizeToLotSize(rawSize, marketConfig);

  const actualNotional = (Number(contractSize) / Math.pow(10, marketConfig.szDecimals)) * currentPrice;

  console.log(`\n📝 [IOC ${isLong ? 'LONG' : 'SHORT'}]`);
  console.log(`   Price: $${currentPrice.toFixed(2)} → Limit: $${(Number(limitPrice) / Math.pow(10, marketConfig.pxDecimals)).toFixed(2)}`);
  console.log(`   Size: ${contractSize} (${(Number(contractSize) / Math.pow(10, marketConfig.szDecimals)).toFixed(6)} BTC)`);
  console.log(`   Notional: ~$${actualNotional.toFixed(2)}`);

  const transaction = await aptos.transaction.build.simple({
    sender: botAccount.accountAddress,
    data: {
      function: `${DECIBEL_PACKAGE}::dex_accounts::place_order_to_subaccount`,
      typeArguments: [],
      functionArguments: [
        userSubaccount,
        marketConfig.address,
        limitPrice.toString(),         // px FIRST (properly rounded!)
        contractSize.toString(),       // sz SECOND
        isLong,                        // is_long
        1,                             // time_in_force: 1 = IOC
        false,                         // post_only: false (we want to take)
        undefined,                     // client_order_id
        undefined,                     // conditional_order
        undefined,                     // trigger_price
        undefined,                     // take_profit_px
        undefined,                     // stop_loss_px
        undefined,                     // reduce_only
        undefined,                     // builder_address
        undefined,                     // max_builder_fee
      ],
    },
  });

  const committedTxn = await aptos.signAndSubmitTransaction({
    signer: botAccount,
    transaction,
  });

  console.log(`   TX: ${committedTxn.hash.slice(0, 20)}...`);

  const executedTxn = await aptos.waitForTransaction({
    transactionHash: committedTxn.hash,
  });

  return {
    success: executedTxn.success,
    txHash: committedTxn.hash,
    vmStatus: executedTxn.vm_status,
    notional: actualNotional,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomDelay() {
  return Math.floor(Math.random() * (CONFIG.maxDelayMs - CONFIG.minDelayMs)) + CONFIG.minDelayMs;
}

function getRandomDirection() {
  return Math.random() > 0.5;
}

function printStats() {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const successRate = stats.tradesAttempted > 0
    ? ((stats.tradesSucceeded / stats.tradesAttempted) * 100).toFixed(1)
    : 0;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 STATS after ${elapsed.toFixed(0)}s`);
  console.log(`   Trades: ${stats.tradesSucceeded}/${stats.tradesAttempted} (${successRate}% success)`);
  console.log(`   Volume: $${stats.totalVolume.toFixed(2)}`);
  console.log(`   Rate: ${(stats.tradesSucceeded / (elapsed / 60)).toFixed(1)} trades/min`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

async function main() {
  console.log('🚀 HFT IOC Market Order Test\n');
  console.log('This script tests instant execution using IOC limit orders.');
  console.log('Press Ctrl+C to stop.\n');

  // Load credentials
  let botPrivateKeyHex = process.env.BOT_OPERATOR_PRIVATE_KEY;
  if (!botPrivateKeyHex) {
    console.error('❌ BOT_OPERATOR_PRIVATE_KEY not set');
    process.exit(1);
  }

  // Get user wallet - either from address or derive from private key
  let userWalletAddress = process.env.USER_WALLET_ADDRESS;
  if (!userWalletAddress) {
    const userPrivateKeyHex = process.env.USER_WALLET_PRIVATE_KEY;
    if (!userPrivateKeyHex) {
      console.error('❌ USER_WALLET_ADDRESS or USER_WALLET_PRIVATE_KEY not set');
      process.exit(1);
    }
    // Derive address from private key
    const cleanUserKey = userPrivateKeyHex.replace('ed25519-priv-', '');
    const userPrivateKey = new Ed25519PrivateKey(cleanUserKey);
    const userAccount = Account.fromPrivateKey({ privateKey: userPrivateKey });
    userWalletAddress = userAccount.accountAddress.toString();
    console.log(`Derived user wallet from private key: ${userWalletAddress.slice(0, 20)}...`);
  }

  if (botPrivateKeyHex.startsWith('ed25519-priv-')) {
    botPrivateKeyHex = botPrivateKeyHex.replace('ed25519-priv-', '');
  }

  const config = new AptosConfig({ network: Network.TESTNET });
  const aptos = new Aptos(config);

  const botPrivateKey = new Ed25519PrivateKey(botPrivateKeyHex);
  const botAccount = Account.fromPrivateKey({ privateKey: botPrivateKey });

  console.log(`Bot: ${botAccount.accountAddress.toString().slice(0, 20)}...`);
  console.log(`User: ${userWalletAddress.slice(0, 20)}...`);

  // Get user's subaccount
  const subaccountResult = await aptos.view({
    payload: {
      function: `${DECIBEL_PACKAGE}::dex_accounts::primary_subaccount`,
      typeArguments: [],
      functionArguments: [userWalletAddress],
    },
  });
  const userSubaccount = subaccountResult[0];
  console.log(`Subaccount: ${userSubaccount.slice(0, 20)}...\n`);

  const marketConfig = MARKETS[CONFIG.market];

  // Main loop
  console.log('Starting HFT loop...\n');

  while (true) {
    try {
      stats.tradesAttempted++;

      // Get fresh price
      const currentPrice = await getMarketPrice(aptos, marketConfig.address, marketConfig.pxDecimals);

      // Random direction
      const isLong = getRandomDirection();

      // Place IOC order
      const result = await placeIOCOrder(
        aptos,
        botAccount,
        userSubaccount,
        marketConfig,
        isLong,
        currentPrice
      );

      if (result.success) {
        stats.tradesSucceeded++;
        stats.totalVolume += result.notional;
        console.log(`   ✅ FILLED!`);
      } else {
        stats.tradesFailed++;
        console.log(`   ❌ FAILED: ${result.vmStatus}`);
      }

      // Print stats every 5 trades
      if (stats.tradesAttempted % 5 === 0) {
        printStats();
      }

    } catch (error) {
      stats.tradesFailed++;
      console.log(`   ❌ ERROR: ${error.message}`);

      // Check for specific errors
      if (error.message.includes('EPRICE_NOT_RESPECTING_TICKER_SIZE')) {
        console.log('   💡 Price rounding issue - will retry');
      } else if (error.message.includes('INSUFFICIENT')) {
        console.log('   💡 Insufficient margin or balance');
      }
    }

    // Random delay between trades
    const delay = getRandomDelay();
    console.log(`   ⏳ Waiting ${(delay/1000).toFixed(1)}s...`);
    await sleep(delay);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n🛑 Stopping...');
  printStats();
  console.log('\nGoodbye!');
  process.exit(0);
});

main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  printStats();
  process.exit(1);
});
