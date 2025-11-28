# Decibrrr Test Scripts

## Script Inventory

### 🔬 NEW - Delegation Architecture Tests

#### `test_bot_delegation.mjs` - Test Custom Delegation
**Purpose:** Verify users can delegate to our bot wallet (not just Decibel operator)

**Usage:**
```bash
export APTOS_PRIVATE_KEY="ed25519-priv-0x..."
node scripts/test_bot_delegation.mjs
```

**What it tests:**
- Can users delegate to arbitrary addresses?
- Does delegation transaction succeed?
- Will it replace existing Decibel operator delegation?

**Expected:** Should succeed (delegation accepts any address)

---

#### `test_delegated_order.mjs` - Test Bot Order Placement
**Purpose:** THE critical test - can bot place orders for delegated users?

**Usage:**
```bash
export BOT_OPERATOR_PRIVATE_KEY="ed25519-priv-0x..."  # From .env
export USER_WALLET_ADDRESS="0x..."                    # User who delegated
node scripts/test_delegated_order.mjs
```

**What it tests:**
- Can bot sign transactions on behalf of user?
- Does delegation grant order placement permissions?
- Who pays gas? (Bot or user?)
- Can bot trade user's USDC?

**Critical:** If this fails, autonomous bot is NOT possible

---

### ✅ EXISTING - Proven Working Scripts

#### `delegate_trading.mjs` - Delegate to Decibel Operator
**Status:** ✅ Known working

**What it does:**
- User delegates to Decibel's official operator
- User then signs own trades
- Proves delegation mechanism works

**Usage:**
```bash
export APTOS_PRIVATE_KEY="ed25519-priv-0x..."
node delegate_trading.mjs
```

---

#### `test_twap_order.mjs` - User Places TWAP Order
**Status:** ✅ Known working

**What it does:**
- User signs TWAP order with own wallet
- Proves TWAP orders work on Decibel
- Used to verify order parameters

**Usage:**
```bash
export APTOS_PRIVATE_KEY="ed25519-priv-0x..."
node test_twap_order.mjs
```

---

#### `test_limit_order.mjs` - User Places Limit Order
**Status:** ✅ Known working

**What it does:**
- User signs regular limit order
- Tests `place_order_to_subaccount` function

**Usage:**
```bash
export APTOS_PRIVATE_KEY="ed25519-priv-0x..."
node test_limit_order.mjs
```

---

#### `create_bot_wallet.mjs` - Generate Bot Wallet
**Status:** ✅ Already used (bot wallet created)

**What it does:**
- Generates new Aptos keypair for bot
- Outputs address and private key
- Should be run ONCE then deleted

**Usage:**
```bash
node scripts/create_bot_wallet.mjs
# Save output to .env, then DELETE this script
```

---

### 🛠️ Utility Scripts

#### `fund_wallet.mjs` - Get Testnet APT
**What it does:**
- Calls testnet faucet to get APT
- Used to fund wallets for gas

**Usage:**
```bash
export APTOS_PRIVATE_KEY="ed25519-priv-0x..."
node fund_wallet.mjs
```

---

#### `check_apt_balance.mjs` - Check APT Balance
**What it does:**
- Queries wallet APT balance
- Useful for checking gas funds

**Usage:**
```bash
export APTOS_PRIVATE_KEY="ed25519-priv-0x..."
node check_apt_balance.mjs
```

---

## Test Flow

### Phase 1: Verify Autonomous Bot is Possible

```bash
# 1. Delegate user to our bot
export APTOS_PRIVATE_KEY="<user_private_key>"
node scripts/test_bot_delegation.mjs
# Expected: ✅ Success

# 2. Test bot placing orders
export BOT_OPERATOR_PRIVATE_KEY="<bot_private_key>"  # From .env
export USER_WALLET_ADDRESS="<user_wallet>"
node scripts/test_delegated_order.mjs
# Expected: ✅ Success OR ❌ Fail (determines architecture)
```

### Phase 2: If Autonomous Bot Works

Build continuous loop in `/api/bot/run`:
- Bot signs all transactions
- Runs 24/7 server-side
- Users just delegate once

### Phase 3: If Autonomous Bot Fails

Build user-signing flow:
- Backend calculates strategy
- Frontend prompts wallet signature
- User must keep browser open

---

## Current Status

- ✅ User delegation to Decibel: Works
- ✅ User TWAP orders: Works
- ✅ Bot wallet: Created
- ❓ User delegation to OUR bot: **Testing now**
- ❓ Bot placing orders for users: **Testing next**

Run the new tests to determine which architecture is possible!
