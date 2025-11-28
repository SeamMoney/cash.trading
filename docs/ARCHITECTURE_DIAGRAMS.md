# Decibrrr Architecture Diagrams

Visual guide to understanding how our trading bot interacts with Decibel DEX.

---

## 1. System Overview

```mermaid
graph TB
    subgraph "User Interface"
        UI[Web UI - Next.js]
        WB[Wallet Button]
        TV[Trading View]
        DB[Dashboard]
    end

    subgraph "Frontend Hooks"
        UWB[useWalletBalance]
        UD[useDelegation]
    end

    subgraph "Backend API Routes"
        BS[/api/bot/start]
        BST[/api/bot/status/:id]
    end

    subgraph "Aptos Blockchain"
        PW[Petra Wallet]
        ARP[Aptos RPC]
        DC[Decibel Smart Contracts]
    end

    subgraph "Decibel REST API"
        DAPI[api.netna.aptoslabs.com/decibel]
        EP1[/api/v1/active_twaps]
        EP2[/api/v1/market_prices]
        EP3[/api/v1/positions]
        EP4[/api/v1/trades]
    end

    subgraph "Bot Operator"
        BW[Bot Wallet]
        BPK[Private Key in .env]
    end

    UI --> UWB
    UI --> UD
    UI --> BS
    UI --> BST

    UWB --> ARP
    UD --> PW
    PW --> DC

    BS --> BPK
    BS --> DC
    BW --> DC

    BST --> DAPI
    DAPI --> EP1
    DAPI --> EP2
    DAPI --> EP3
    DAPI --> EP4

    DC --> ARP

    style UI fill:#1a1a2e,stroke:#16213e,color:#fff
    style BS fill:#0f3460,stroke:#16213e,color:#fff
    style DC fill:#e94560,stroke:#16213e,color:#fff
    style DAPI fill:#533483,stroke:#16213e,color:#fff
    style BW fill:#f39c12,stroke:#16213e,color:#000
```

---

## 2. Delegation Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Web UI
    participant Wallet as Petra Wallet
    participant Hook as useDelegation Hook
    participant RPC as Aptos RPC
    participant Contract as Decibel Contract

    User->>UI: Click "Authorize Bot"
    UI->>Hook: delegateTrading()
    Hook->>Wallet: Sign transaction request
    Note over Wallet: User approves in<br/>Petra popup
    Wallet->>Hook: Transaction signed
    Hook->>RPC: Submit transaction
    RPC->>Contract: delegate_trading_to_for_subaccount()
    Contract->>Contract: Store permission:<br/>BOT_OPERATOR can trade<br/>for user's subaccount
    Contract->>RPC: Transaction success
    RPC->>Hook: Confirmation
    Hook->>UI: Update state (isDelegated = true)
    UI->>User: Show "Bot Authorized ✓"

    Note over User,Contract: ⚠️ Important: User's funds stay in subaccount.<br/>Bot can only place trades, NOT withdraw!
```

---

## 3. Bot Execution Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Trading View
    participant API as /api/bot/start
    participant BotWallet as Bot Operator Wallet
    participant RPC as Aptos RPC
    participant Contract as Decibel Contract
    participant Decibel as Decibel Backend

    User->>UI: Enter $100, Select Normal mode
    User->>UI: Click "Initialize Trading"
    UI->>API: POST { userAddress, market, notionalSize }

    Note over API: Read BOT_OPERATOR_PRIVATE_KEY<br/>from .env

    API->>RPC: Get user's subaccount address
    RPC-->>API: subaccount: 0xabc123...

    API->>RPC: Check is_delegated_trader(subaccount, BOT)
    RPC-->>API: isDelegated: true ✓

    Note over API: Calculate order params:<br/>- size from USD notional<br/>- duration: 10-20min (normal)<br/>- split long/short by bias

    API->>BotWallet: Sign transaction
    BotWallet->>RPC: Submit signed tx
    RPC->>Contract: place_twap_order_to_subaccount(<br/>  subaccount,<br/>  market,<br/>  size,<br/>  is_long,<br/>  min_duration,<br/>  max_duration<br/>)

    Contract->>Contract: Verify bot is delegated ✓
    Contract->>Contract: Create TWAP order
    Contract->>Decibel: Emit TWAP order event
    Decibel->>Decibel: Start executing slices<br/>over 10-20 minutes

    Contract->>RPC: Transaction hash
    RPC->>API: 0x789def... (tx hash)
    API->>UI: { botId, orders: [...] }
    UI->>User: "Bot started successfully!"

    Note over Decibel: Decibel's backend now executes<br/>the TWAP order by splitting<br/>into smaller limit orders
```

---

## 4. Bot Status Monitoring Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Status Dashboard
    participant API as /api/bot/status/:id
    participant Decibel as Decibel REST API
    participant Contract as Blockchain State

    User->>UI: View bot status page
    UI->>API: GET /api/bot/status/bot_123_0xuser

    Note over API: Extract user address<br/>from botId

    API->>Decibel: GET /api/v1/active_twaps?user=0xuser
    Decibel->>Contract: Query on-chain TWAP state
    Contract-->>Decibel: Active TWAP orders
    Decibel-->>API: [{<br/>  order_id,<br/>  orig_size: 1000,<br/>  remaining_size: 600,<br/>  status: "active",<br/>  duration_s: 900<br/>}]

    Note over API: Calculate progress:<br/>(1000 - 600) / 1000 = 40%

    API->>Decibel: GET /api/v1/market_prices
    Decibel-->>API: [{ symbol: "BTC/USD", mark_price: "101234.56" }]

    API->>UI: {<br/>  progress: 40%,<br/>  status: "active",<br/>  currentPrice: 101234.56,<br/>  remainingTime: "9 min"<br/>}

    UI->>User: Show progress bar (40%)

    loop Every 10 seconds
        UI->>API: Poll for updates
        API->>Decibel: GET /api/v1/active_twaps
        Decibel-->>API: Updated state
        API->>UI: New progress
        UI->>User: Update display
    end
```

---

## 5. Data Flow Architecture

```mermaid
graph LR
    subgraph "Wallet Operations"
        W1[Connect Wallet]
        W2[Check Balance]
        W3[Delegate Trading]
    end

    subgraph "Read Operations"
        R1[Get Subaccount]
        R2[Get Balance]
        R3[Get Positions]
        R4[Get Orders]
        R5[Get Prices]
    end

    subgraph "Write Operations"
        WR1[Place TWAP Order]
        WR2[Cancel Order]
        WR3[Withdraw]
    end

    subgraph "Data Sources"
        DS1[Aptos RPC<br/>View Functions]
        DS2[Decibel REST API]
        DS3[Smart Contract<br/>Entry Functions]
    end

    W1 --> DS1
    W2 --> R2
    W3 --> DS3

    R1 --> DS1
    R2 --> DS1
    R3 --> DS2
    R4 --> DS2
    R5 --> DS2

    WR1 --> DS3
    WR2 --> DS3
    WR3 --> DS3

    DS1 -.Read Only.-> Blockchain[(Aptos Blockchain)]
    DS2 -.Read Only.-> Blockchain
    DS3 -.Read/Write.-> Blockchain

    style Blockchain fill:#e94560,stroke:#16213e,color:#fff
    style DS1 fill:#0f3460,stroke:#16213e,color:#fff
    style DS2 fill:#533483,stroke:#16213e,color:#fff
    style DS3 fill:#f39c12,stroke:#16213e,color:#000
```

---

## 6. Smart Contract Interaction Map

```mermaid
graph TB
    subgraph "Decibel Smart Contract Functions"
        subgraph "View Functions (Read-Only)"
            V1["primary_subaccount(user)"]
            V2["is_delegated_trader(subaccount, trader)"]
            V3["available_order_margin(subaccount)"]
        end

        subgraph "Entry Functions (Require Signature)"
            E1["delegate_trading_to_for_subaccount(...)"]
            E2["place_twap_order_to_subaccount(...)"]
            E3["cancel_twap_order(...)"]
            E4["deposit(...)"]
            E5["withdraw(...)"]
        end
    end

    subgraph "Our App Usage"
        U1[useWalletBalance Hook]
        U2[useDelegation Hook]
        U3[/api/bot/start]
    end

    U1 --> V1
    U1 --> V3
    U2 --> V2
    U2 --> E1
    U3 --> E2

    style V1 fill:#27ae60,stroke:#16213e,color:#fff
    style V2 fill:#27ae60,stroke:#16213e,color:#fff
    style V3 fill:#27ae60,stroke:#16213e,color:#fff
    style E1 fill:#e74c3c,stroke:#16213e,color:#fff
    style E2 fill:#e74c3c,stroke:#16213e,color:#fff
    style E3 fill:#e74c3c,stroke:#16213e,color:#fff
```

---

## 7. REST API Endpoints Map

```mermaid
graph TB
    subgraph "Decibel REST API"
        BASE[https://api.netna.aptoslabs.com/decibel/api/v1]

        subgraph "User Endpoints"
            U1[/active_twaps?user=X]
            U2[/positions?user=X]
            U3[/trades?user=X]
            U4[/open_orders?user=X]
            U5[/delegations?user=X]
        end

        subgraph "Market Data"
            M1[/markets]
            M2[/market_prices]
            M3[/orderbook?market=X]
            M4[/candles?market=X]
        end
    end

    subgraph "Our Application Usage"
        APP1[Bot Status API]
        APP2[Portfolio View]
        APP3[History Table]
        APP4[Market Selector]
        APP5[Price Feed]
    end

    BASE --> U1
    BASE --> U2
    BASE --> U3
    BASE --> M1
    BASE --> M2

    APP1 --> U1
    APP2 --> U2
    APP3 --> U3
    APP4 --> M1
    APP5 --> M2

    style BASE fill:#533483,stroke:#16213e,color:#fff
    style APP1 fill:#0f3460,stroke:#16213e,color:#fff
    style APP2 fill:#0f3460,stroke:#16213e,color:#fff
    style APP3 fill:#0f3460,stroke:#16213e,color:#fff
```

---

## 8. Security Model

```mermaid
graph TB
    subgraph "User's Assets"
        UA[User's Aptos Wallet]
        US[User's Decibel Subaccount]
        UF[USDC Funds]
    end

    subgraph "Permissions"
        DP[Delegation Permission]
        TP[Trading Permission ONLY]
        NWP[❌ NO Withdraw Permission]
    end

    subgraph "Bot Operator"
        BW[Bot Wallet]
        BK[Private Key - Secure in .env]
        BA[Bot Actions]
    end

    subgraph "What Bot CAN Do"
        C1[✓ Place orders]
        C2[✓ Cancel orders]
        C3[✓ Execute TWAP]
    end

    subgraph "What Bot CANNOT Do"
        NC1[✗ Withdraw funds]
        NC2[✗ Transfer USDC]
        NC3[✗ Close subaccount]
    end

    UA --> US
    US --> UF
    US --> DP
    DP --> TP
    DP --> NWP

    BW --> BK
    BK --> BA

    TP --> C1
    TP --> C2
    TP --> C3

    NWP -.blocks.-> NC1
    NWP -.blocks.-> NC2
    NWP -.blocks.-> NC3

    style UF fill:#27ae60,stroke:#16213e,color:#fff
    style TP fill:#f39c12,stroke:#16213e,color:#000
    style NWP fill:#e74c3c,stroke:#16213e,color:#fff
    style NC1 fill:#c0392b,stroke:#16213e,color:#fff
    style NC2 fill:#c0392b,stroke:#16213e,color:#fff
    style NC3 fill:#c0392b,stroke:#16213e,color:#fff
```

---

## 9. Component Hierarchy

```
┌─────────────────────────────────────────────┐
│           app/page.tsx                      │
│         (Landing Page)                      │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│      app/dashboard/page.tsx                 │
│    <DashboardLayout>                        │
└─────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌──────────────────┐  ┌──────────────────────┐
│ DashboardHeader  │  │   TradingView        │
│  - WalletButton  │  │  - NotionalInput     │
│  - UserInfo      │  │  - TradingModes      │
└──────────────────┘  │  - DelegationButton  │
                      │  - InitializeButton  │
                      └──────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐
│ useWalletBalance│  │  useDelegation   │  │ /api/bot/start │
│  - Fetch USDC   │  │  - Check status  │  │ - Place order  │
│  - Fetch APT    │  │  - Delegate      │  │ - Sign tx      │
│  - Subaccount   │  │  - Revoke        │  │ - Submit       │
└─────────────────┘  └──────────────────┘  └────────────────┘
         │                     │                     │
         └─────────────────────┴─────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   Aptos Blockchain   │
                    │  Decibel Contracts   │
                    └──────────────────────┘
```

---

## 10. File Structure & Responsibilities

```
decibrrr/
│
├── app/
│   ├── page.tsx                    → Landing page
│   ├── dashboard/page.tsx          → Main dashboard
│   └── api/
│       └── bot/
│           ├── start/route.ts      → 🔴 Place TWAP orders (WRITE)
│           └── status/[id]/        → 🟢 Check bot status (READ)
│               └── route.ts
│
├── components/
│   ├── wallet/
│   │   ├── wallet-button.tsx       → 🔵 Connect wallet + show balance
│   │   └── wallet-provider.tsx     → 🔵 Wallet adapter setup
│   ├── trading/
│   │   └── delegation-button.tsx   → 🔴 Delegate trading permissions
│   └── dashboard/
│       ├── trading-view.tsx        → 📊 Main trading interface
│       ├── header.tsx              → 🎨 Top navigation
│       └── background.tsx          → 🎨 Animated background
│
├── hooks/
│   ├── use-wallet-balance.ts       → 🟢 Fetch USDC + APT balance
│   └── use-delegation.ts           → 🟢 Check & manage delegation
│
├── lib/
│   ├── decibel-client.ts           → 📚 Constants (markets, fees)
│   └── twap-bot.ts                 → 🤖 Advanced TWAP logic (unused)
│
└── docs/
    ├── decibel-complete/           → 📖 51 scraped API docs
    ├── DECIBEL_DOCS_SUMMARY.md     → 📋 Quick reference
    └── ARCHITECTURE_DIAGRAMS.md    → 📐 This file

Legend:
🔴 Write operations (require signature)
🟢 Read operations (no signature)
🔵 Wallet operations (user signs)
📊 UI components
🎨 Visual components
📚 Configuration
🤖 Logic/algorithms
📖 Documentation
```

---

## 11. Environment Variables & Configuration

```
┌──────────────────────────────────────────────┐
│            .env (LOCAL ONLY)                 │
├──────────────────────────────────────────────┤
│ BOT_OPERATOR_ADDRESS=0x501f5...              │ ← Bot wallet address
│ BOT_OPERATOR_PRIVATE_KEY=ed25519-priv-...   │ ← SENSITIVE! Never commit
└──────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│       process.env (Server-side only)         │
│   Only accessible in /api routes            │
│   NOT available in browser                  │
└──────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│      lib/decibel-client.ts                   │
│   (Public constants - safe to expose)       │
├──────────────────────────────────────────────┤
│ DECIBEL_PACKAGE = "0x1f513904..."           │
│ BOT_OPERATOR = "0x501f5..."                 │
│ MARKETS = { BTC/USD: {...}, ... }           │
│ USDC_DECIMALS = 6                           │
└──────────────────────────────────────────────┘
                    │
                    ▼
        ┌───────────┴───────────┐
        ▼                       ▼
┌────────────────┐    ┌──────────────────┐
│   Frontend     │    │    Backend API   │
│  (Public)      │    │   (Private)      │
└────────────────┘    └──────────────────┘
```

---

## 12. User Journey Flow

```mermaid
journey
    title User Trading Journey
    section Setup
      Visit website: 5: User
      Connect Petra wallet: 4: User, Petra
      Check USDC balance: 3: User, Hook
      Authorize bot (delegate): 4: User, Hook, Contract
    section Trading
      Enter trade amount: 5: User
      Select trading mode: 5: User
      Set directional bias: 4: User
      Click "Initialize Trading": 5: User
      Bot places TWAP order: 3: Bot, Contract
    section Monitoring
      View bot status: 4: User, API
      Check order progress: 3: User, Decibel
      See fills in real-time: 5: User, WebSocket
      View final PnL: 4: User, API
```

---

## 13. Error Handling Flow

```mermaid
graph TD
    START[User Action] --> CHECK1{Wallet Connected?}
    CHECK1 -->|No| ERROR1[Show: Connect Wallet]
    CHECK1 -->|Yes| CHECK2{Has USDC Balance?}

    CHECK2 -->|No| ERROR2[Show: Mint USDC<br/>Link to faucet]
    CHECK2 -->|Yes| CHECK3{Bot Delegated?}

    CHECK3 -->|No| ERROR3[Show: Authorize Bot<br/>delegation-button]
    CHECK3 -->|Yes| CHECK4{Sufficient Balance?}

    CHECK4 -->|No| ERROR4[Show: Insufficient Balance<br/>Need $10 minimum]
    CHECK4 -->|Yes| SUBMIT[Submit Order]

    SUBMIT --> CHECK5{Bot Has APT?}
    CHECK5 -->|No| ERROR5[Bot Error: No gas<br/>Admin must fund bot]
    CHECK5 -->|Yes| SUCCESS[Order Placed!]

    ERROR1 --> END[Stop]
    ERROR2 --> END
    ERROR3 --> END
    ERROR4 --> END
    ERROR5 --> END
    SUCCESS --> MONITOR[Monitor Progress]

    style ERROR1 fill:#e74c3c,stroke:#c0392b,color:#fff
    style ERROR2 fill:#e74c3c,stroke:#c0392b,color:#fff
    style ERROR3 fill:#e74c3c,stroke:#c0392b,color:#fff
    style ERROR4 fill:#e74c3c,stroke:#c0392b,color:#fff
    style ERROR5 fill:#e74c3c,stroke:#c0392b,color:#fff
    style SUCCESS fill:#27ae60,stroke:#229954,color:#fff
```

---

## 14. Technology Stack

```mermaid
graph TB
    subgraph "Frontend"
        F1[Next.js 16]
        F2[React 19]
        F3[TailwindCSS]
        F4[TypeScript]
    end

    subgraph "Blockchain"
        B1[Aptos SDK]
        B2[Wallet Adapter]
        B3[Petra Wallet]
    end

    subgraph "Backend"
        BE1[Next.js API Routes]
        BE2[Node.js Runtime]
    end

    subgraph "External Services"
        E1[Aptos Testnet RPC]
        E2[Decibel REST API]
        E3[Decibel Smart Contracts]
    end

    F1 --> F2
    F2 --> F3
    F1 --> F4
    F1 --> BE1

    F2 --> B2
    B2 --> B3
    B2 --> B1

    BE1 --> BE2
    BE1 --> B1

    B1 --> E1
    BE1 --> E2
    B1 --> E3

    style F1 fill:#0f3460,stroke:#16213e,color:#fff
    style B1 fill:#e94560,stroke:#16213e,color:#fff
    style BE1 fill:#533483,stroke:#16213e,color:#fff
    style E1 fill:#f39c12,stroke:#16213e,color:#000
```

---

## Summary

These diagrams show:

1. **System Overview** - High-level architecture
2. **Delegation Flow** - How users authorize the bot
3. **Bot Execution** - How orders are placed
4. **Status Monitoring** - How we track progress
5. **Data Flow** - Where data comes from
6. **Smart Contract Map** - Which functions we use
7. **REST API Map** - Which endpoints we call
8. **Security Model** - What bot can/cannot do
9. **Component Hierarchy** - Code organization
10. **File Structure** - Where everything lives
11. **Environment Setup** - Configuration flow
12. **User Journey** - End-to-end experience
13. **Error Handling** - What can go wrong
14. **Tech Stack** - Technologies used

All diagrams are in Mermaid format and will render automatically on GitHub!
