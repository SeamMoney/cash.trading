# Deploy-from-UI: user PineScript → live trustless vault (design)

Every engine piece exists and is verified; this service connects them so a user can go from pasting
PineScript to a live, investable, trustless vault without leaving the app.

## Verified pipeline (all live today)
1. `transpileV3(pine, addr, {target:"vault", marketAddr})` → one self-contained Move module
   (indicator + tick_oracle + NAV sizing + delegated orders). Compile-verified.
2. `aptos move compile/publish` against `contracts/strategy-vaults/deps` → on-chain package.
3. `create_strategy_vault` → binding object → `vault_admin_api::delegate_dex_actions_to`
   (payload builder already in `lib/decibel-vaults.ts`).
4. `POST /api/launchpad/crank` keeps it ticking (oracle-priced; 2 genuine flips executed).

## Service shape (proposal)
`POST /api/launchpad/deploy-vault` { pineScript, marketName, feeBps, pctBps }
1. Transpile (vault target) — reject on transpiler errors (confidence < threshold).
2. Compile in a sandboxed temp package (server has `aptos` CLI; reuse the deps stubs). Cache by
   source hash. **Compile failures return the Move error verbatim** (no silent fallback).
3. Publish under a fresh object/resource address.
   - Gas: a funded deployer key (env) pays publish gas; meter per-user.
4. Wallet steps (user signs): create Decibel vault (`create_and_fund_vault`), then
   `create_strategy_vault`, then `delegate_dex_actions_to(vault, sv)`.
5. Register in the strategy registry (`/api/launchpad/strategy-vaults` Prisma) + start cranking.
6. Card appears in the STRATEGY VAULTS feed automatically (live state via `/api/launchpad/on-chain?pkg=`).

## Backend-lane asks (flagging — not mine to build)
- **Publish-payer key management**: a funded deployer key on the server (or sponsored-tx variant of
  the publish), with per-user rate limits + size caps so the faucet can't be drained.
- **Compile sandbox hardening**: `aptos move compile` on user input is effectively running the Move
  compiler on attacker-controlled source — needs timeout/memory caps + no network + tmpdir isolation
  (the compiler itself is safe-ish but rate-limit it).
- **Rate limiting** on /deploy-vault (compile is CPU-heavy).

## UI-lane remaining (mine)
- Market picker for the vault target (today BTC default in the .vault.move tab).
- Per-market lot/min/szDecimals into `StrategyVaultOpts` from `lib/decibel.ts` MARKETS.
- Deploy progress UI (transpile → compile → publish → vault → delegate → live), reusing the
  bridge-rail pattern.
- Shelby pin step: canonical Pine + emitted Move + compile artifacts; content hash on-chain (the
  verifiability story: depositors check bytecode ⇄ published Pine).
