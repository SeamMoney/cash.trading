# CASH orderbook architecture decision

Status: launch candidate  
Decision date: 2026-08-17  
Scope: CASH/USDC spot market on Aptos mainnet

## Decision

The CASH venue uses our independent Move orderbook in the
[`cash-orderbook`](https://github.com/SeamMoney/cash-orderbook) repository. It is
not a fork of Decibel's current spot contracts.

We will keep hardening the existing engine for the first CASH/USDC launch. We
will adopt compatible ideas from Decibel's public spot documentation where
they improve safety or user expectations, but we will not claim source-level
compatibility and will not copy unverified bytecode or reverse-engineer a live
package.

This is the only defensible launch path because Decibel currently publishes
spot transaction documentation and SDKs, but not the Move source for its spot
matching and clearing modules. Its public GitHub organization contains SDK,
CLI, and configuration repositories rather than a public spot-contract
repository.

Primary references:

- [Decibel spot order transaction](https://docs.decibel.trade/developer-hub/on-chain/order-management/place-spot-order)
- [Decibel spot bulk order transaction](https://docs.decibel.trade/developer-hub/on-chain/order-management/place-spot-bulk-order)
- [Decibel spot cancellation](https://docs.decibel.trade/developer-hub/on-chain/order-management/cancel-spot-order)
- [Decibel order formatting](https://docs.decibel.trade/developer-hub/on-chain/overview/formatting-prices-sizes)
- [Decibel public GitHub organization](https://github.com/decibeltrade)

## What our launch engine is

Our package is a purpose-built, on-chain central limit orderbook for Aptos
fungible assets. For CASH/USDC it provides:

- a dedicated market with immutable base and quote metadata;
- price-time priority over separate bid and ask maps;
- GTC, PostOnly, IOC, and FOK order behavior;
- immutable v1 maker policy: the sealed launch LP, or a delegate acting for
  that LP owner, is the only account allowed to rest GTC/PostOnly liquidity;
  public wallets remain permissionless takers through IOC, FOK, and wallet
  market swaps;
- fully collateralized resting bids and asks;
- atomic matching and settlement;
- cancellation that returns the exact remaining escrow;
- direct wallet entry functions for retail buys and sells;
- internal-balance and delegated entry functions for makers and bots;
- market pause controls and cancellation while paused;
- fixed tick, lot, and minimum-size validation;
- a 16-raw-node matching budget and the identical owner-aware executable-prefix
  view for safe wallet quoting;
- permanently zero protocol trading fees for the first immutable release.

The retail Swap UI uses `buy_from_wallet` and `sell_from_wallet`. A buyer signs
an explicit USDC ceiling and minimum CASH output. A seller signs an explicit
CASH amount and minimum USDC output. Unused input and purchased output return
to the wallet in the same transaction; retail users do not need to maintain a
protocol balance.

## Decibel semantics we intentionally share

These are product semantics, not copied source code:

| Behavior | Decibel public design | CASH launch |
| --- | --- | --- |
| Asset custody | Orders are fully collateralized | Same |
| Settlement | Immediate spot settlement | Same |
| Market identity | A spot market is a distinct on-chain market | Same; CASH/USDC is pair `0` |
| Price and size rules | Tick, lot, and minimum-size constraints | Same |
| Time in force | GTC, PostOnly, IOC | Same, plus FOK |
| Wallet path | Direct-wallet spot order is supported | Same through retail-safe wrapper functions |
| Self-trade prevention | Matching must not trade an owner with itself | Same; an unfilled self-crossing taker remainder is cancelled |
| Cancel behavior | Cancellation releases escrow | Same |

## Features deliberately deferred

Decibel documents features that our first release does not need:

- replace-all, sequence-numbered two-sided bulk ladders;
- builder/referrer fee arguments on every order;
- Decibel Trading Accounts and collateral-backed storage;
- multiple public markets in the cash.trading retail surface;
- protocol fees or mutable fee tiers.

Adding any of these now would change contract state, transaction payloads, or
economic behavior and restart the audit. Launch seeding uses the reviewed
single-transaction atomic bootstrap, not ordinary individual order calls. Bulk
replacement can be designed and audited as a later immutable package rather
than rushed into the first release.

## Launch invariants

The website must keep Swap disabled unless it independently verifies all of
the following against Aptos mainnet:

1. The fullnode reports chain ID `1`.
2. The configured package exists and has the audited immutable module set.
3. The published module-bytecode fingerprint matches the reviewed build.
4. The package is the first immutable publication, not an upgradeable package.
5. Pair `0` is active and its base, quote, decimals, tick, lot, and minimum
   exactly match the reviewed CASH/USDC launch configuration.
6. The protocol admin matches the approved launch admin.
7. Maker and taker fees are both zero.
8. The owner-filtered on-chain book can be read through bounded views.
9. The quote is recent, fully fillable, and still matches the signed payload.
10. The connected wallet explicitly reports Aptos mainnet.

If any invariant cannot be proved, the public surface may explain that the
venue is not ready, but it must not build or submit a swap transaction.

## Trust and governance

The first package must be immutable after review. Protocol administration is
limited to operational controls such as market registration and pause/unpause;
it cannot replace matching or wallet-withdrawal code.

The publisher may initialize the package, but protocol administration must be
handed to the approved admin through a two-step propose/accept flow. The
publisher key and protocol admin should not remain the same single hot key at
launch. Exact custody policy, signers, and recovery procedure belong in the
private activation record; no secret material belongs in this repository.

## Data path

Executable quotes come from bounded on-chain orderbook views, filtered to omit
the connected wallet's own orders. The API/indexer can power recent trades,
candles, history, and monitoring after its replay and checkpoint behavior is
validated, but a delayed or corrupt event projection must never determine a
wallet's executable output protection.

The client performs all amount and payload arithmetic with decimal strings and
integers. Floating-point values are display-only.

## Non-goals for this launch

- deploying or publishing before the code review and activation approval;
- promising "no slippage" when a market order walks more than one price level;
- presenting maker-owned liquidity as executable to that same maker wallet;
- silently routing CASH/USDC through LiquidSwap when the orderbook is paused;
- describing the package as audited until an independent audit is complete;
- describing the implementation as Decibel code or an official Decibel venue.

## Future compatibility

After launch, a separate design can add a sequence-numbered maker ladder,
public recent-trade and candle projections, or Decibel builder attribution.
Those features should reuse the public product semantics where helpful, but
must be specified and tested against our own package rather than assumed to be
compatible with Decibel internals.
