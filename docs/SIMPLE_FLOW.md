# Decibrrr - Simple Flow Diagram

## How It Works (Simple Version)

```mermaid
graph LR
    A[1. Connect Wallet] --> B[2. Check Balance]
    B --> C[3. Authorize Bot]
    C --> D[4. Enter Trade Size]
    D --> E[5. Click Start]
    E --> F[6. Bot Places Orders]
    F --> G[7. Monitor Progress]

    style A fill:#0f3460,stroke:#fff,color:#fff
    style B fill:#0f3460,stroke:#fff,color:#fff
    style C fill:#f39c12,stroke:#000,color:#000
    style D fill:#0f3460,stroke:#fff,color:#fff
    style E fill:#27ae60,stroke:#fff,color:#fff
    style F fill:#e94560,stroke:#fff,color:#fff
    style G fill:#533483,stroke:#fff,color:#fff
```

## What Happens Under the Hood

```mermaid
sequenceDiagram
    participant You
    participant Bot
    participant Decibel

    You->>Decibel: 1. Delegate trading permission
    Note over You,Decibel: ✓ Your funds stay in YOUR account

    You->>Bot: 2. Request: Trade $100 BTC
    Bot->>Decibel: 3. Place TWAP order (splits into small orders)

    loop Every 30 seconds for 15 minutes
        Decibel->>Decibel: 4. Execute small slice
    end

    Decibel->>You: 5. Order complete! View results
```

## Security: What Bot Can/Cannot Do

| Bot CAN ✅ | Bot CANNOT ❌ |
|-----------|--------------|
| Place trades | Withdraw your USDC |
| Cancel trades | Transfer funds |
| Execute TWAP orders | Close your account |
| Monitor positions | Access your wallet |

**Your private keys stay with YOU. Bot only has trading permission.**

---

For detailed diagrams, see [ARCHITECTURE_DIAGRAMS.md](./ARCHITECTURE_DIAGRAMS.md)
