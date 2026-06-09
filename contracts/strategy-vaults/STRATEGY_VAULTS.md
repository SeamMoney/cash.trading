# Strategy Vaults — trustless PineScript-controlled Decibel vaults

> Deploy a PineScript indicator as a **trading bot** whose funds live in a **Decibel perp vault**,
> where the vault can *only* trade according to the published strategy — enforced on-chain, not
> trusted off-chain. The Aptos/Decibel/Move-v2 answer to tread.fi algo-vaults on Hyperliquid and to
> PineForge (PineScript → executable strategy).

## The trust problem

Every "copy a curator's vault" product — Hyperliquid vaults, and cash.trading's own bot engine today
(`lib/bot-engine.ts`, a centralized **bot operator key** placing Decibel orders) — asks depositors to
*trust* that the manager trades the advertised strategy. Nothing binds the funds to the strategy.

Because Decibel is fully on-chain **and** exposes order placement as a `public fun` (not just an
`entry`), we can make the binding cryptographic: the only code that can move a vault's positions is an
**immutable strategy module** whose bytecode depositors can audit.

## How it works (verified against decompiled Decibel source)

```
PineScript ──transpiler──▶ on-chain indicator (already deployed) ┐
                                                                 │ get_signal()
StrategyVault Object R  ◀── binds indicator + Decibel vault ─────┘
        │
Decibel vault V ── vault_admin_api::delegate_dex_actions_to(V, R) ──▶ grants TradePerpsAllMarkets to R
        │
   tick(price): indicator::push_price → get_signal → on flip:
   dex_accounts::place_perp_order_to_subaccount(R_signer, V.subaccount, market, …)
```

- **Order placement is composable** — `dex_accounts::place_perp_order_to_subaccount(...)` is a
  `public fun`. `strategy_vault::tick` mints its delegated signer from the Object `ExtendRef` and calls
  it directly, gated by the on-chain indicator. (This function is `public` but not `entry`, so it is
  absent from the on-chain ABI — its signature comes from the decompiled bytecode; that's why the build
  uses an interface package, see below.)
- **Delegation** — `vault_admin_api::delegate_dex_actions_to(admin, vault, R, expiry?)` grants
  `TradePerpsAllMarkets` to the StrategyVault Object address `R`. cash.trading already builds this
  payload: `lib/decibel-vaults.ts → buildDelegateDecibelVaultPayload`.
- **Vault + fees** — `vault_api::create_and_fund_vault(...)` (built-in performance fee via
  `fee_bps`/`fee_interval_s`). cash.trading already builds create/fund/deposit/withdraw/activate.

Decibel package: testnet `0x952535…`, mainnet `0x50ead22…`. `order_book_types` is
`aptos_experimental::order_book_types` (framework package).

## Layout

```
contracts/strategy-vaults/
  sources/strategy_vault.move        the on-chain bridge (indicator ⇄ Decibel vault)
  deps/decibel-interface/            compile-time interface package (Decibel + indicator signatures)
  Move.toml
```

### Building against a closed-source dependency

Decibel does **not** publish Move source for its perp-dex package (the on-chain `PackageRegistry` has
~0 source bytes, so `aptos move download` returns nothing usable). We *do* have the full **decompiled
bytecode** (`~/decibel-security-research/decompiled/`) and **real AIP-120 source** for the order-book
package. To compile a module that calls Decibel's public functions we vendor a minimal **interface
package** under `deps/decibel-interface/`: matching struct + public-fn signatures with `abort` bodies.
It is **never published** — at publish time the real on-chain modules link in.

```bash
cd contracts/strategy-vaults
aptos move compile --skip-fetch-latest-git-deps        # ✅ compiles today
# publish (fill the real deployer + verify order_book/aptos_experimental address per network):
aptos move publish --named-addresses cash_strategy=0x<deployer>
```

> **Deploy caveat:** before publishing, repoint `order_book` in `deps/decibel-interface/Move.toml` to
> the real `aptos_experimental` address for the target network and prefer linking the real package, so
> the `TimeInForce`/`OrderId` type identities match what Decibel's `dex_accounts` expects. The
> interface package is sufficient for compilation and review; the link-identity step is the gate to a
> successful on-chain publish.

## Status & next steps

- [x] `strategy_vault.move` — binds indicator → Decibel vault; `tick()` trades on signal flips. **Compiles.**
- [x] Decibel interface package — exact signatures from decompiled source.
- [ ] Resolve real `aptos_experimental` address per network + publish to testnet; integration-test
      create → delegate → tick → order fills against a live Decibel testnet vault.
- [ ] Transpiler: emit a strategy-vault-wired module from `lib/launchpad/move-codegen.ts` (today it
      generates a signal-only indicator and never compiles/deploys it).
- [ ] Wire the lifecycle into the app: reuse `lib/decibel-vaults.ts` (create + **delegate to R**) and
      replace the centralized keeper in `lib/bot-engine.ts` / `app/api/launchpad/execute` with on-chain
      `tick()` for enforced vaults.
- [ ] Shelby: pin canonical PineScript + transpile artifacts + backtest report; store the content hash
      on-chain so depositors verify deployed bytecode ⇄ published Pine.
- [ ] Frontend: indicator overlay on Decibel charts + a trustless-vault marketplace.

## Open decisions

- **Tick cadence / oracle** — who calls `tick()` and with what price? Permissionless keeper vs. reading
  Decibel's oracle inside `tick()` (preferred — makes the price un-spoofable).
- **Position sizing** — fixed lot (`order_size`, today) vs. % of vault NAV.
