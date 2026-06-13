# CURATOR-RULES.md — Enforcement Matrix for Strategy-Vault Curator Restrictions

> WS4 deliverable (spec only — no Move/TS changes). What a vault curator on
> cash.trading is *physically prevented* from doing, what Decibel's own vault
> layer guarantees, what is still a gap, and the honest trust statement a
> depositor should read.
>
> Sources verified 2026-06-12:
> - `contracts/strategy-vaults/sources/strategy_vault.move` @ `78ad464` (line numbers below refer to this revision)
> - `contracts/strategy-vaults/sources/indicator.move` @ `78ad464`
> - Testnet ABI: `0xe7da2794b1d8af76532ed95f38bfdf1136abfd8ea3a240189971988a83101b7f::{vault, vault_api, vault_admin_api}` (current package)
> - Testnet ABI: `0x952535c3049e52f195f26798c2f1340d7dd5100edbe0f464e520a974d16fbe9f::vault` (older package, for diff)
> - Mainnet indexer: `GET https://api.mainnet.aptoslabs.com/decibel/api/v1/vaults` (live response inspected)

Terminology: **curator** = the human who created the strategy vault (the
`creator` in `StrategyVault` and, today, also the Decibel vault admin).
**Strategy object** = the `StrategyVault` Move Object at address `R`; `R` is
the delegated trader. **Decibel vault** = the `0x…e7da::vault::Vault` object
holding depositor funds.

---

## 1. Enforced today (our Move layer)

| Rule | Enforcement point | Can the curator bypass it? |
|---|---|---|
| **Market binding** — the strategy trades exactly one perp market | `market: Object<PerpMarket>` is set once in `create_strategy_vault` (L95–119) and read in `tick_internal` (L176, L181). There is **no setter** for `market`; the only mutators in the module are `set_paused`, `set_order_size`, `set_nav_sizing`. | **Not via this module.** But see the delegation row: the Decibel grant is `TradePerpsAllMarkets`, so the market restriction lives entirely in our module, not in the delegation. If the curator can route orders any other way, the binding is moot. |
| **Module-only trading (delegation)** | Decibel's `dex_accounts::place_perp_order_to_subaccount` internally authorizes via the delegation map (`get_subaccount_signer_if_owner_or_delegated_for_perp_trading`, per decompiled source). The delegate is the strategy object address `R` (`delegated_trader`, L292); only this module can mint `R`'s signer, via the private `ExtendRef` (L170). | **YES, today.** The curator is the Decibel vault admin and `vault_admin_api::delegate_dex_actions_to(&signer, vault, address, Option<u64>)` can be called **again** with the curator's own address (or any bot). Decibel keeps a delegation *map*, not a single slot. Mitigations: (a) monitor/alert on extra delegations + `revoke_dex_actions_delegation` events and de-badge the vault in the feed; (b) long-term, transfer vault admin to a neutral object (see Gaps §3.6). The vault admin also keeps `update_vault_manager_subaccount`, `revoke_all_dex_actions_delegations`, `close_vault` — admin power is the root trust residue. |
| **NAV % cap ≤ 100%** | `set_nav_sizing` asserts `pct_bps > 0 && pct_bps <= 10000` (L217, `E_BAD_BPS`); `resolve_order_size` computes `nav * pct_bps / 10000` per order (L205). | **Partially.** Within NAV mode, no — the 100% bound is hard. But the cap is **per order notional**, not per position: consecutive flips re-size against current NAV, and the close+open pair on a flip places 2× size transiently (L174–182). Also, if `SizingConfig` was never created, the **fixed-size path has no NAV bound at all** — `set_order_size` only asserts `> 0` (L277). A curator using fixed sizing can set an order size far beyond NAV (the engine's margin check then becomes the only limit). |
| **Pause rights** | `set_paused` is creator-gated (`E_NOT_CREATOR`, L270–274); `tick_internal` aborts with `E_PAUSED` while paused (L152). | Pause itself can't be bypassed (every trade funnels through `tick_internal`). Caveats: pause only blocks **new** ticks — it does not flatten an open position, and **only** the creator can pause (no protocol guardian, no depositor emergency brake). |
| **Oracle pricing** | `tick_oracle` reads `perp_engine::get_mark_price(market)` **inside the transaction** (L131–138) — the caller never supplies a price; same-block read→decide→trade. | **The raw-price escape hatch exists:** `tick(keeper, sv_addr, price, ts)` (L142–146) accepts an arbitrary caller-supplied price. It is gated upstream by `indicator::push_price` (indicator.move L429: signer must be the indicator's `keeper` or `owner`) — and the indicator owner **is the curator's deployment**. So a curator who controls the indicator keeper key can feed fabricated prices and force signal flips. Must be closed before any real-money claim (Gaps §3.5). Note this also means cranking is not actually permissionless today, despite the L130 comment — only the registered keeper/owner passes the `E_NOT_KEEPER` check. |
| **Order size lot/min clamps** | `resolve_order_size` floors to `LOT_SIZE = 10` and clamps up to `MIN_SIZE = 100_000` (L46–50, L208–209). | Not bypassable, but **hardcoded for testnet BTC/USD only**. On any other market these constants are wrong: orders may abort (lot mismatch) or the `MIN_SIZE` clamp-up may place a *larger* order than the NAV formula intended — i.e., the clamp can **violate** the NAV cap for tiny vaults. Production must read lot/min per market (the file's own L49 comment agrees). |

Also enforced by construction (worth stating to depositors):

- **No withdrawal power.** The delegation grants perp trading only; the
  strategy module never touches `SubaccountFundsMovement`. Depositor funds can
  only leave the vault through Decibel's own redemption path.
- **Signal logic is bytecode.** The indicator math runs on-chain
  (`indicator::push_price` → `get_signal`, L155–158); the equivalence gate
  (`lib/strategy-equivalence.ts`) ties that bytecode to the published Pine
  source at deploy time (WS3 makes this depositor-verifiable).
- **Caveat — package upgradeability:** `Move.toml` sets no `upgrade_policy`,
  so the package defaults to *compatible* (upgradeable). The "immutable
  bytecode" guarantee currently depends on the publisher key not upgrading.
  Mainnet policy must be `immutable` or a resource-account publish with the
  upgrade capability burned (see Open Questions).

---

## 2. Provided by Decibel's vault layer (verified ABI)

All function names below were confirmed by fetching the module ABIs from the
testnet fullnode (package `0xe7da27…b7f`, abbreviated `dec` below).

### Lockup
- Set at creation: `vault_api::create_and_fund_vault(&signer, Object<Subaccount>, Object<Metadata>, name, description, social_links, share_symbol, share_icon_uri, share_project_uri, fee_bps: u64, fee_interval_s: u64, contribution_lockup_duration_s: u64, initial_funding: u64, accepts_contributions: bool, delegate_to_creator: bool)` — the 11th argument is the contribution lockup. (Our builder: `lib/decibel-vaults.ts#buildCreateDecibelVaultPayload`.)
- Surfaced by the mainnet indexer as `lockdown_period_s` (live values seen: `259200` = 3 days on the protocol vault and "Stone"; `0` on "Crypto Vikings").
- **No exposed entry updates the lockup after creation** in either testnet package — it is creation-time-fixed as far as the public ABI shows.

### Redemption
- Depositor entry: `dex_accounts_entry::redeem_from_vault(subaccount, vault, shares)` (our builder: `buildWithdrawDecibelVaultPayload`).
- Mechanics inside `dec::vault`: `lock_for_initated_redemption(address, Object<Vault>, u64)`, `try_complete_redemption(address, Object<Vault>, u64, bool) -> bool`, `get_redemption_funds_needed(Object<Vault>, u64) -> u64`, `get_max_withdrawable_amount(Object<Vault>) -> u64`.
- Liquidity backstop: `vault::place_force_closing_order(Object<Vault>, address, Object<PerpMarket>) -> Option<OrderRef>` — the vault layer can force-close perp positions to fund redemptions, plus `cancel_open_order` / `cancel_bulk_order` (the latter new-package only).
- Async queue: `vault_api::process_pending_requests(u32)` (entry, permissionless crank) and view `vault_api::get_max_synchronous_redemption(Object<Vault>) -> u64`.
- Slippage policy toggle: `vault_admin_api::update_vault_use_global_redemption_slippage_adjustment(&signer, Object<Vault>, bool)`.

### Profit share / fees
- Set at creation via `fee_bps` + `fee_interval_s` (args 9–10 of `create_and_fund_vault` / `create_vault`).
- Accrual/distribution: `vault_api::distribute_fees(Object<Vault>)` (entry, permissionless); fee state lives in `vault::VaultFeeConfig` / `vault::VaultFeeState` structs.
- Indexer surfaces `profit_share` as a percentage (live values: `0.0` protocol vault, `10.0` user vaults — matching Hyperliquid's customary 10%).
- **No exposed entry updates fee config post-creation** in either testnet package. However, the ABI declares a `VaultFeeConfigUpdatedEvent` struct, implying an internal (friend) update path exists or is planned — do **not** promise depositors fee immutability until the mainnet package is re-checked.

### Deposit caps & manager skin-in-the-game
- `vault_admin_api::update_vault_max_outstanding_shares(&signer, Object<Vault>, u64)` — a share cap is an effective deposit cap (this is the primitive Gaps §3.4 builds policy on).
- `acceptsContributions` bool at creation gates open deposits.
- Manager minimum: `vault::compute_min_shares_for_manager(&Vault, u64, u64) -> u64` enforces a manager share floor (Hyperliquid-style skin-in-the-game), **but** `vault_admin_api::set_not_respecting_manager_minimum_shares_requirement(&signer, Object<Vault>)` lets the admin opt out of it — disclose this.
- `vault::burn_shares_for_liquidation(address, FungibleAsset, address)` (new package) handles share burning when vault shares are used as collateral (`vault_admin_api::register_vault_shares_as_collateral(&signer, Object<Vault>, u64, u64, u64)`).

### Admin & delegation lifecycle
- Two-step admin transfer: `request_admin_change` → `approve_become_admin` (+ `cancel_admin_change_request`).
- Delegation: `vault_admin_api::delegate_dex_actions_to(&signer, Object<Vault>, address, Option<u64>)` — the `Option<u64>` is an **expiry timestamp** (our builder passes `null` = no expiry; consider always setting one, see Open Questions).
- Revocation (new package only): `vault_admin_api::revoke_dex_actions_delegation(&signer, Object<Vault>, vector<address>)` and `revoke_all_dex_actions_delegations(&signer, Object<Vault>)`.
- Lifecycle: `activate_vault`, `close_vault` (new package only).

### Old package (`0x952535…be9f`) vs current (`0xe7da27…b7f`) — diff
The current package **adds**: `cancel_bulk_order`, `burn_shares_for_liquidation`,
`close_vault`, `revoke_dex_actions_delegations` / `revoke_all_dex_actions_delegations`,
`get_vault_share_asset_type_public`, and structs `VaultState` / `VaultClosedEvent`;
`vault_admin_api` adds `close_vault`, `register_vault_shares_as_collateral`, and the
revocation entries. The old package has **no delegation revocation at all** —
a delegation there is irrevocable until expiry. The current package also moves
`order_book_types` to the AptosTrading framework address (`0x5::order_book_types`)
instead of the standalone `0xb4e85b…c6c7`. **Build and deploy exclusively against
the current package.**

### Mainnet indexer fields (live, `/decibel/api/v1/vaults`)
`address, name, manager, status, created_at, lockdown_period_s, tvl, volume,
volume_30d, all_time_pnl, net_deposits, all_time_return, apr,
past_month_return, sharpe_ratio, max_drawdown, weekly_win_rate_12w,
profit_share, pnl_90d, manager_cash_pct, average_leverage, depositors,
perp_equity, vault_type (protocol|user), description, social_links` — i.e.,
drawdown, leverage and profit-share are already indexed per vault; our feed
can display them without extra infra, and our on-chain guards (§3) should be
configured in the same units so UI and chain agree.

### Comparison anchor: Hyperliquid native vaults
10k USDC to create; leader must hold ≥ 5% of the vault forever; fixed 10%
profit share; **the leader can trade anything at any time** — adherence to a
stated strategy is pure trust (and HL native vaults are officially "legacy").
Our pitch is the categorical inverse: the *only* signer that can move
positions is a module whose behavior is the published strategy. Every row in
§1 that says "can bypass: yes" is the distance between our pitch and reality —
§3 closes it.

---

## 3. Gaps to implement (additive Move designs)

Constraint honored throughout: the package's default upgrade policy is
*compatible*, so **no existing struct layout may change and no public function
may be removed**. Every design below is a **new `has key` resource stored on
the StrategyVault object** (created via the existing `extend_ref`, exactly the
`SizingConfig` precedent at L121–127) plus behavior-only edits inside existing
function bodies.

### 3.1 Per-vault max leverage
```move
/// Additive resource on the StrategyVault object.
struct LeverageCap has key { max_leverage_x100: u64 }  // 250 = 2.5x

public entry fun set_leverage_cap(creator, sv_addr, max_leverage_x100)
    // creator-gated; assert!(max_leverage_x100 >= 100 && <= MAX_SANE, E_BAD_LEV);
    // blocked when Immutable (§3.5) exists.
```
Check inside `resolve_order_size` (after the lot/min clamps so the clamp-up
cannot silently exceed it): `order_notional = size * mark_px / 10^size_decimals`;
abort `E_LEVERAGE` if `order_notional > nav * max_leverage_x100 / 100`. For the
flip case (close + open in one tick), count only the opening order — the close
is `reduce_only`. Display the same number the indexer calls `average_leverage`.

### 3.2 Drawdown auto-pause (high-water-mark resource)
```move
struct DrawdownGuard has key {
    high_water_nav: u64,     // peak NAV observed at tick time
    max_drawdown_bps: u64,   // e.g. 2000 = pause at -20%
    tripped_at: u64,         // 0 = not tripped; else timestamp
}
#[event] struct DrawdownTripped has drop, store { strategy_vault: address, nav: u64, high_water_nav: u64 }
```
Hook at the **top** of `tick_internal` (before the signal logic): read
`nav = perp_engine::get_account_net_asset_value(primary_subaccount(decibel_vault_addr))`;
if `nav > high_water_nav` update the HWM; if
`high_water_nav - nav > high_water_nav * max_drawdown_bps / 10000`, set
`sv.paused = true` (writing the existing `bool` is layout-safe), set
`tripped_at`, emit, and `return` without trading. Notes:
- HWM updates only on ticks, so it is keeper-cadence granular — disclose.
- NAV-based HWM conflates PnL with deposits/withdrawals; v1 accepts this
  (deposit-heavy vaults get a *more* conservative trigger after inflows is
  false — inflows raise HWM, so a later true drawdown triggers correctly, but
  large redemptions can false-trigger). v2 should track share price
  (`get_vault_net_asset_value / get_vault_num_shares`) instead — both are
  exposed views on `dec::vault`.
- Re-arm policy: `unpause` by the creator must also reset `high_water_nav`
  to current NAV, otherwise the guard re-trips on the next tick. Whether a
  tripped vault may unpause at all on mainnet is an open question (§5).

### 3.3 Curator fee config bounds
Decibel's `fee_bps`/`fee_interval_s` are fixed at vault creation and not
updatable through any exposed entry (§2), so the binding move is **at the
deploy rail**, with an on-chain commitment for verifiability:
```move
struct FeePolicy has key {
    fee_bps: u64,                 // copied from the create_and_fund_vault args
    lockup_s: u64,                // ditto
}
```
Written once inside `create_strategy_vault` (extra args) or a one-shot
`commit_fee_policy` (creator-gated, `assert!(!exists<FeePolicy>)`). The deploy
rail asserts `fee_bps <= PROTOCOL_MAX_FEE_BPS` (proposed default: 2000 = 20%,
i.e. at most 2× Hyperliquid's 10%) before building the create payload, and the
verify endpoint (WS3) cross-checks the resource against the actual
`VaultCreatedEvent` args. If a Decibel fee-update path materializes
(`VaultFeeConfigUpdatedEvent` exists in the ABI), the indexer watcher must
de-badge any vault whose live `profit_share` deviates from `FeePolicy`.

### 3.4 Deposit cap
The enforcement primitive already exists at the Decibel layer:
`vault_admin_api::update_vault_max_outstanding_shares`. Our additive layer
records the *promise* so raising it is detectable:
```move
struct DepositCapPolicy has key { max_outstanding_shares: u64 }
```
Deploy rail: after vault creation, call `update_vault_max_outstanding_shares`
with the same value and write the resource. Watcher: if on-chain
`get_vault_num_shares` ceiling diverges from the policy resource, flag the
vault. (True hard enforcement would require the vault admin key to be held by
an object we control — see §3.6.)

### 3.5 Strategy-immutability flag (+ closing the raw-price tick)
```move
struct Immutable has key {}   // empty marker, one-way

public entry fun lock_strategy(creator, sv_addr)
    // creator-gated; moves Immutable to the object; emits StrategyLocked.
```
Behavior-only edits (no signature changes, upgrade-compatible):
- `set_nav_sizing`, `set_order_size`, `set_leverage_cap`, and any future
  config setter: `assert!(!exists<Immutable>(sv_addr), E_IMMUTABLE);`
- `set_paused`: **stays allowed** (safety valve) unless mainnet policy says
  otherwise.
- `tick` (the explicit-price entry, L142): add
  `assert!(!exists<Immutable>(sv_addr), E_IMMUTABLE);` — locking a strategy
  forces all future cranks through `tick_oracle`. We cannot *remove* the
  public entry under compatible upgrades, but we can make it abort. The
  deploy rail should call `lock_strategy` as the final launch step, making
  "launched" synonymous with "oracle-only and config-frozen".

### 3.6 (Stretch, mainnet-blocking) Admin custody
The single biggest bypass in §1 is the curator-as-vault-admin adding a second
delegate. Decibel's two-step `request_admin_change` / `approve_become_admin`
makes a clean fix possible without forking their layer: transfer vault admin
to a **custody object** of ours whose only capabilities are (a) delegate to
the strategy object, (b) revoke-all on drawdown trip, (c) never delegate to an
EOA. Spec separately; until then, the watcher + de-badging is the mitigation
and the trust statement must say so.

---

## 4. Trust statement (what a depositor reads)

> **What is guaranteed:** your funds sit in a Decibel vault on Aptos; the only
> trading authority delegated by this vault is an immutable Move module bound
> to one market, and that module places an order only when its on-chain
> indicator — whose bytecode was checked at deploy time to match the published
> PineScript — flips its signal at Decibel's own mark price, sized to at most
> the configured percent of vault NAV. The curator never holds a trading key,
> cannot withdraw your money (withdrawals go only through Decibel's redemption
> queue, subject to the lockup shown on the vault card), and the
> fee/profit-share you saw at deposit time is fixed at vault creation.
> **What is not guaranteed:** trade *timing* depends on our keeper cranking
> the strategy — if the keeper stalls, the strategy simply does not trade
> (it cannot misfire, but it can miss); prices come from Decibel's oracle and
> mark-price mechanism, which we do not control; the source-equivalence check
> covers signal logic, not fill quality — live fills face spread, slippage,
> and funding that backtests approximate; the curator (and on a tripped
> drawdown guard, the protocol) can pause new trades, which freezes — not
> closes — any open position; and while the Decibel vault admin role remains
> with the curator, an adversarial curator could grant themselves a second
> trading delegation — we monitor for this on-chain and immediately flag the
> vault, but until admin custody ships (roadmap) this is detection, not
> prevention. Leverage and drawdown are bounded only on vaults that display
> those guards. This is testnet-grade software; do not deposit more than you
> can lose.

(When §3.1/3.2/3.6 ship, tighten the corresponding hedges.)

---

## 5. Open questions for the user

1. **Fees.** Do we take a protocol cut on top of the curator's
   `fee_bps`, and how (second fee at our layer vs. revenue share off the
   curator's)? What is the cap — proposed `PROTOCOL_MAX_FEE_BPS = 2000`
   (20%)? Minimum lockup we require for a "verified" badge (Decibel protocol
   vault uses 3 days)?
2. **Who can pause.** Creator-only (today), or also a protocol guardian key?
   After a drawdown-guard trip, may the creator unpause + reset the HWM, or is
   a tripped vault permanently wind-down (force-close via Decibel redemption
   path)? Should *depositor* redemptions auto-trigger anything?
3. **Mainnet policy.** (a) Publish `cash_strategy` as `immutable` (or
   resource-account with burned upgrade cap) vs. keeping compatible upgrades
   with a timelock — the entire "physically unable" pitch rests on this.
   (b) Do we require admin-custody (§3.6) before listing real-money vaults,
   or launch with watcher + de-badging only? (c) Always set a delegation
   expiry (`Option<u64>` in `delegate_dex_actions_to`) and have the keeper
   renew, so a dead protocol fails safe?
4. **Keeper economics.** Who funds gas for per-vault cranking at scale
   (VPS decision in WS5), and do we expose `tick_oracle` as a public bounty
   (it is safe to crank permissionlessly once §3.5 lands and the indicator
   keeper gate is relaxed to keeper-or-anyone-for-oracle-ticks)?
5. **Per-market params.** Lot size / min size must be read per market before
   any non-BTC/USD vault launches (L46–50 hardcodes testnet BTC/USD) — is
   there an exposed view on `perp_market` we should bind, or do we ship a
   small on-chain registry we maintain?
