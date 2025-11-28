#!/usr/bin/env bash

# Delegation Test Runner
# This script runs both delegation tests in sequence

set -e  # Exit on error

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Decibrrr Delegation Test Suite"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if APTOS_PRIVATE_KEY is set
if [ -z "$APTOS_PRIVATE_KEY" ]; then
  echo "❌ Error: APTOS_PRIVATE_KEY not set"
  echo ""
  echo "Please export your wallet's private key:"
  echo ""
  echo "  export APTOS_PRIVATE_KEY=\"ed25519-priv-0x...\""
  echo ""
  echo "📝 Note: Use the wallet with testnet APT for gas fees"
  echo "   (e.g., 0xc1dd7c7b9ce198a0f8168869ea925bcfd04a900090d018ab7d246b7369b4bc5c)"
  echo ""
  exit 1
fi

echo "✅ APTOS_PRIVATE_KEY detected"
echo ""

# Run Test 1: Delegation to our bot
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 1: User delegation to our bot"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

node scripts/test_bot_delegation.mjs

if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Test 1 failed - delegation not possible"
  echo ""
  echo "This means users cannot delegate to arbitrary addresses."
  echo "Architecture decision: Use Option A (user-signing flow)"
  exit 1
fi

echo ""
echo "✅ Test 1 passed - delegation works!"
echo ""
echo "Waiting 3 seconds before Test 2..."
sleep 3

# Run Test 2: Bot places order for delegated user
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 2: Bot placing order on behalf of user"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get the user wallet address that just delegated
USER_ADDRESS=$(node -e "
import('@aptos-labs/ts-sdk').then(({ Account, Ed25519PrivateKey }) => {
  let key = process.env.APTOS_PRIVATE_KEY;
  if (key.startsWith('ed25519-priv-')) {
    key = key.replace('ed25519-priv-', '');
  }
  const privateKey = new Ed25519PrivateKey(key);
  const account = Account.fromPrivateKey({ privateKey });
  console.log(account.accountAddress.toString());
});
")

# Load bot private key from .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep BOT_OPERATOR_PRIVATE_KEY | xargs)
fi

if [ -z "$BOT_OPERATOR_PRIVATE_KEY" ]; then
  echo "❌ Error: BOT_OPERATOR_PRIVATE_KEY not found in .env"
  exit 1
fi

export USER_WALLET_ADDRESS="$USER_ADDRESS"

node scripts/test_delegated_order.mjs

if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Test 2 failed - bot cannot place delegated orders"
  echo ""
  echo "Delegation works, but doesn't grant order placement permissions."
  echo "Architecture decision: Use Option A (user-signing flow)"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 ALL TESTS PASSED! 🎉"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Users can delegate to our bot"
echo "✅ Bot can place orders on behalf of delegated users"
echo "✅ Autonomous bot architecture is POSSIBLE!"
echo ""
echo "Next steps:"
echo "1. Build continuous trading loop in /api/bot/run"
echo "2. Users delegate once, bot runs 24/7"
echo "3. Bot pays gas (APT), users provide margin (USDC)"
echo ""
