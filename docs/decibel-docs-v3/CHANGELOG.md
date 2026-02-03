# Decibel API Documentation Changelog

**Scraped:** Feb 3, 2026
**Previous scrape:** Nov 28, 2025
**Pages:** 104 (was 52)

## New API Endpoints (Not in Nov 2025 docs)

### Predeposit Points (5 new endpoints)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/predeposits/points` | GET | Get current predeposit points for user |
| `/api/v1/predeposits/dlp_balance` | GET | Get DLP (Decibel LP) balance for user |
| `/api/v1/predeposits/balance_events` | GET | Get predeposit balance event history |
| `/api/v1/predeposits/total` | GET | Get total predeposit points (Season 0) |
| `/api/v1/predeposits/ua_positions` | GET | Get UA positions (non-zero balances) |

### Referrals (3 new endpoints)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/referrals/info/{account}` | GET | Get who referred an account |
| `/api/v1/referrals/stats/{account}` | GET | Get referrer statistics |
| `/api/v1/referrals/referred/{account}` | GET | Get users referred by referrer |

### User Fund History (1 new endpoint)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/account_fund_history` | GET | Get deposits/withdrawals history |

### New Transaction Types
| Transaction | Module | Description |
|-------------|--------|-------------|
| `configure_settings` | `dex_accounts_entry` | Configure margin mode, leverage |
| `delegate_dex_actions` | `vault` | Delegate vault trading permissions |

## Updated Endpoints

### Response Format Changes
All list endpoints now return `{items: [], total: x}` format instead of bare arrays:
- `user_trade_history`
- `user_order_history`
- `funding_rate_history`
- `twap_history`

### Deprecated Endpoints (marked in docs)
- `/api/v1/user_positions` → Use `/api/v1/account_positions`
- `/api/v1/user_owned_vaults` → Use `/api/v1/account_owned_vaults`
- `/api/v1/user_vault_performance` → Use `/api/v1/account_vault_performance`
- `/api/v1/fund_history` → Use `/api/v1/account_fund_history`

## New WebSocket Topics
| Topic | Description |
|-------|-------------|
| `notifications:{userAddr}` | User notifications |
| `order_update:{userAddr}` | Order status updates |

## SDK Changes (v0.2.9)

### New Methods
- `read.predeposit.getPoints()`
- `read.predeposit.getDlpBalance()`
- `read.predeposit.getBalanceEvents()`
- `read.referrals.getInfo()`
- `read.referrals.getStats()`
- `read.referrals.getReferred()`
- `read.accountFundHistory.get()`

### Configuration Changes
- Package address: `0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88`
- New module: `dex_accounts_entry` (entry functions wrapper)
- Rate limit via Geomi API key: 200 req/30s

## Architecture Documentation

New architecture pages added:
- `/architecture/orderbook/orderbook` - CLOB architecture
- `/architecture/perps/global-risk-controls` - Risk management
- `/architecture/perps/perps-contract-overview` - Contract structure
- `/architecture/perps/position-management` - Position logic

## Security

- `/security/audits` - Links to OtterSec audit reports
