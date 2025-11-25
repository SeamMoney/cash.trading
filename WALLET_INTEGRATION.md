# Wallet Integration Documentation

## Overview

This document details the complete Aptos wallet integration for the Decibel TWAP Bot, including architecture, fixes applied, known issues, and troubleshooting guidance.

## Architecture

### Core Components

1. **WalletProvider** (`components/wallet/wallet-provider.tsx`)
   - Wraps Aptos Wallet Adapter v7.2.2
   - Implements AIP-62 Wallet Standard for auto-detection
   - Configured with Petra, Razor, and Nightly wallets

2. **useWalletBalance Hook** (`hooks/use-wallet-balance.ts`)
   - Fetches user's primary subaccount from Decibel
   - Queries available margin using browser-native fetch API
   - Converts raw margin values (6 decimals) to USDC
   - Auto-refreshes on wallet connection/disconnection

3. **WalletButton** (`components/wallet/wallet-button.tsx`)
   - Connection UI with wallet selection modal
   - Account details dialog showing wallet address, subaccount, and balance
   - Copy-to-clipboard and explorer links

4. **DashboardHeader** (`components/dashboard/header.tsx`)
   - Live wallet status display
   - Real-time balance updates
   - Network indicator (Aptos Testnet)

### Data Flow

```
User Connects Wallet
  ↓
WalletProvider detects connection
  ↓
useWalletBalance triggered by account change
  ↓
1. Fetch primary subaccount:
   POST /v1/view
   Function: 0x1f51...::dex_accounts::primary_subaccount
   Args: [wallet_address]
  ↓
2. Fetch available margin:
   POST /v1/view
   Function: 0x1f51...::accounts_collateral::available_order_margin
   Args: [subaccount_address]
  ↓
3. Convert to USDC:
   marginUSDC = Number(marginRaw) / 1_000_000
  ↓
Display in UI
```

## Critical Fixes Applied

### Fix 1: Account Address Type Mismatch

**Problem:** Wallet adapters return `AccountAddress` objects, not strings. Code was calling `.slice()` directly on objects.

**Error:**
```
TypeError: t.address.slice is not a function
```

**Solution:** Added `.toString()` conversions throughout codebase

**Files Modified:**
- `hooks/use-wallet-balance.ts:43` - API arguments
- `components/wallet/wallet-button.tsx:20-23` - formatAddress helper
- `components/dashboard/header.tsx:46` - Address display

**Code Example:**
```typescript
// Before (breaks with AccountAddress objects):
arguments: [account.address]

// After (works with all wallet types):
arguments: [account.address.toString()]
```

### Fix 2: SDK Bundling in Browser

**Problem:** Importing `DecibelClient` class caused Next.js to bundle Node.js libraries (`got`, `keyv`) for browser, breaking builds.

**Error:**
```
Module not found: Can't resolve 'stream'
Module not found: Can't resolve 'http'
```

**Solution:** Split constants into browser-safe file

**Files Modified:**
- Created `lib/decibel-client.ts` - Constants only (DECIBEL_PACKAGE, MARKETS, etc.)
- Server-side DecibelClient moved to future `lib/decibel-server.ts` file

**Result:** Clean browser bundle, no HTTP library pollution

### Fix 3: Balance Calculation Precision

**Problem:** Using `parseInt()` truncates decimal values, causing slight discrepancies with Decibel UI.

**User Report:**
> "our website was able to query our balance, but it looked like the balance was not the same as the ui, but very close"

**Solution:** Changed to `Number()` for full precision

**File:** `hooks/use-wallet-balance.ts:77`

```typescript
// Before (loses sub-cent precision):
const marginUSDC = parseInt(marginRaw) / 1_000_000

// After (preserves all decimals):
const marginUSDC = Number(marginRaw) / 1_000_000
```

### Fix 4: Enhanced Error Logging

**Problem:** Generic errors made debugging impossible

**Solution:** Added detailed console logging

**File:** `hooks/use-wallet-balance.ts:68-72`

```typescript
if (!marginResponse.ok) {
  const errorText = await marginResponse.text()
  console.error("Margin fetch error:", errorText)
  console.error("Subaccount used:", subaccountAddr)
  throw new Error(`Failed to fetch margin: ${marginResponse.status}`)
}
```

## Common Errors & Solutions

### Error: `Move abort in 0x1::table: 0x6507`

**Full Error:**
```json
{
  "message": "Move abort in 0x1::table: 0x6507",
  "error_code": "invalid_input",
  "vm_error_code": 4016
}
```

**Meaning:**
- Error code `0x6507` = "table key not found" in Move's table module
- The subaccount has no margin data in Decibel's smart contract

**Root Cause:**
Wallet hasn't minted USDC on Decibel testnet yet

**Solution:**
1. Go to https://app.decibel.trade
2. Connect the wallet
3. Click "Mint USDC" to get 1000 testnet USDC
4. Refresh our app - balance will now appear

**This is NOT a bug** - it's expected behavior for new wallets.

### Error: Wallet Popup Not Appearing

**Symptoms:** Clicking wallet in connection modal does nothing

**Affected Wallets:** Backpack (reported by user)

**Working Wallets:** Petra, Razor, Nightly

**Root Cause:**
- Backpack is primarily a Solana wallet
- Aptos support may be limited or experimental
- AIP-62 auto-detection may not fully support Backpack

**Solution:** Use Petra wallet (most reliable for Aptos)

## Wallet Compatibility Matrix

| Wallet | Status | Notes |
|--------|--------|-------|
| Petra | ✅ Working | Recommended - most reliable |
| Razor | ✅ Working | Returns AccountAddress objects (handled) |
| Nightly | ✅ Working | Standard AIP-62 compatible |
| Backpack | ⚠️ Limited | Popup not appearing, primarily Solana-focused |

## Configuration

### Environment Variables

None required - all configuration is in code.

### Constants

**File:** `lib/decibel-client.ts`

```typescript
export const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'
export const USDC_DECIMALS = 6
export const PRICE_DECIMALS = 6
```

### RPC Endpoint

**File:** `hooks/use-wallet-balance.ts:34`

```typescript
const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1"
```

## API Reference

### View Functions Used

#### 1. Get Primary Subaccount

```typescript
POST https://api.testnet.aptoslabs.com/v1/view
Content-Type: application/json

{
  "function": "0x1f513904...::dex_accounts::primary_subaccount",
  "type_arguments": [],
  "arguments": ["<wallet_address>"]
}

// Response:
["0x778970004d8fc42a2c0e2d915b83197794439b867248bff76f761d47adfbb6ca"]
```

#### 2. Get Available Margin

```typescript
POST https://api.testnet.aptoslabs.com/v1/view
Content-Type: application/json

{
  "function": "0x1f513904...::accounts_collateral::available_order_margin",
  "type_arguments": [],
  "arguments": ["<subaccount_address>"]
}

// Response (raw value with 6 decimals):
["1000000000"]  // = 1000.00 USDC
```

### Decimal Conversion

All USDC values use 6 decimals:

```typescript
// Raw value from API
const marginRaw = "1000000000"  // String

// Convert to USDC
const marginUSDC = Number(marginRaw) / 1_000_000
// Result: 1000.00
```

## Testing

### Manual Testing Checklist

- [ ] Connect Petra wallet
- [ ] Verify wallet address displays correctly (truncated: `0x1234...5678`)
- [ ] Check balance appears in header
- [ ] Open wallet modal - verify full address, subaccount, and balance
- [ ] Copy wallet address to clipboard
- [ ] Click explorer link - opens Aptos Explorer
- [ ] Disconnect wallet - verify balance clears
- [ ] Reconnect - verify balance refetches

### Test Scenarios

#### Scenario 1: New Wallet (No USDC Minted)

**Expected:**
- Connection: ✅ Success
- Subaccount fetch: ✅ Success
- Balance fetch: ❌ Error 0x6507
- Display: "No balance found"

**Action:** Mint USDC on Decibel, refresh page

#### Scenario 2: Existing Wallet (USDC Minted)

**Expected:**
- Connection: ✅ Success
- Subaccount fetch: ✅ Success
- Balance fetch: ✅ Success
- Display: "$1000.00 USDC" (or actual balance)

#### Scenario 3: Balance Accuracy

**Verification:**
1. Connect wallet with known balance
2. Compare three sources:
   - Our app display
   - Decibel UI display
   - Raw API response / 1,000,000
3. All should match exactly (after `Number()` fix)

## Troubleshooting

### Debug Checklist

1. **Open browser console** - All errors logged with details
2. **Check wallet is connected** - Look for wallet address in header
3. **Verify network** - Must be on Aptos Testnet
4. **Check for error 0x6507** - Means wallet needs USDC minted
5. **Try Petra wallet** - Most reliable if others fail

### Common Console Messages

**Success:**
```
(No errors - balance appears silently)
```

**New Wallet (Expected):**
```
Margin fetch error: {"message":"Move abort in 0x1::table: 0x6507",...}
Subaccount used: 0x778970004d8fc42a2c0e2d915b83197794439b867248bff76f761d47adfbb6ca
Failed to fetch wallet balance: Failed to fetch margin: 400
```

**Network Error:**
```
Failed to fetch wallet balance: Failed to fetch
```

## Future Improvements

1. **Add loading states** - Show spinner while fetching balance
2. **Add retry logic** - Auto-retry failed balance fetches
3. **Cache subaccount** - Avoid re-fetching on every balance check
4. **Add balance refresh button** - Manual refetch trigger
5. **Add error boundaries** - Graceful fallback for wallet errors
6. **Support mainnet** - Add network switcher
7. **Add transaction history** - Show recent trades/deposits
8. **Implement wallet detection** - Show "Install Petra" if no wallets found

## Security Considerations

1. **No private keys in browser** - Wallet adapter handles all signing
2. **Read-only view calls** - Balance fetches don't require signatures
3. **No API keys required** - Public Aptos RPC endpoints
4. **No CORS issues** - Using official Aptos Labs endpoints
5. **Type safety** - Full TypeScript coverage

## Dependencies

```json
{
  "@aptos-labs/wallet-adapter-react": "^7.2.2",
  "@aptos-labs/wallet-adapter-ant-design": "^7.2.2",
  "petra-plugin-wallet-adapter": "^0.4.5",
  "razor-wallet-adapter": "^0.0.1",
  "nightly-wallet-adapter": "^0.0.1"
}
```

## Related Files

- `/components/wallet/wallet-provider.tsx` - Wallet context setup
- `/components/wallet/wallet-button.tsx` - Connection UI
- `/hooks/use-wallet-balance.ts` - Balance fetching logic
- `/components/dashboard/header.tsx` - Balance display
- `/lib/decibel-client.ts` - Constants and config
- `/components/client-providers.tsx` - Client-side wrapper
- `/app/layout.tsx` - Root layout with providers

## Support

For issues:
1. Check browser console for detailed errors
2. Verify wallet has minted USDC on https://app.decibel.trade
3. Try Petra wallet if others fail
4. Check this documentation for common errors

---

**Last Updated:** 2025-11-24
**Integration Status:** ✅ Working (with precision fix applied)
**Tested Wallets:** Petra ✅, Razor ✅, Nightly ✅, Backpack ⚠️
