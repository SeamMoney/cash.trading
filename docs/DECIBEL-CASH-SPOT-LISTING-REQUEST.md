# Request: list CASH/USDC on Decibel spot

**From:** cash.trading (SeamMoney) · builder subaccount `0xc755b3bb6477e11e1635de67cded8d0683e9d4e360b6c484a33eb2fd6cb9ca39`
**Ask in one line:** register a `CASH/USDC` spot market and we will run the book — committed two-sided inventory from day one.

## Why we are asking rather than deploying

Spot market creation is not permissionless. On the live mainnet package
`0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06`, every
`register_market_*` entry lives in `admin_apis` with private/friend visibility, and
`spot_engine::register_market` is `friend`. There is no public wrapper. We checked again
after your recent upgrades (aptos_market 32, decibel_accounts 29, decibel_spot_dex 3).

We have a working alternative — an independent CASH/USDC CLOB of our own, 243 Move tests
green — but listing on Decibel is better for both of us: one book instead of two, your
matching engine and risk stack instead of a second unaudited one, and volume that counts
on your venue.

## What we bring

- **Inventory, committed:** 600,000,000 CASH on the ask side and USDC bids funded from day
  one, quoted two-sided rather than dumped as a single wall.
- **A market maker that already runs:** the same ladder/recenter tooling we built for our
  own venue, with hash-sealed plans and explicit drift stops.
- **Distribution:** CASH/USDC would be the default pair on cash.trading's `/swap`, which
  already routes APT/USDC and BTC/USDC to your spot engine today.
- **Skin in the game:** we are a registered builder earning 10 bp on cash.trading order
  flow; our incentive is depth and uptime, not a listing pop.

## The asset

- CASH is a legacy Aptos coin with a paired fungible-asset metadata object at
  `0xc692...6e40` — the FA store your escrow path expects already exists, so no wrapper or
  token migration is required.
- Current venue is a LiquidSwap CASH/APT pool with roughly $3.1K of liquidity and
  effectively no volume. That is the problem we are trying to fix, and we are not pretending
  otherwise.

## Market parameters we would suggest

CASH trades around `$0.000013`, so the usual defaults do not fit. What matters is that the
minimum tick is small enough that a quote is not forced 7–8% away from mid:

| Parameter | Suggested | Why |
| --- | --- | --- |
| Quote | USDC | Matches your existing spot quote asset |
| Tick | `$0.00000001` | At `$0.000013` a larger tick makes a tight book impossible |
| Lot | 1,000 CASH | Keeps the smallest fill worth ≥ 10 USDC micro-units at the minimum tick |
| Min size | your call | Happy to take whatever your risk process wants |

We derived these from our own book; treat them as a starting point, not a demand.

## Questions

1. Is there a listing process or set of criteria we should be meeting first?
2. Do you require a market-making agreement (uptime, spread, depth) for a new pair? We are
   willing to sign to real numbers.
3. Is `spot_admin_apis` delegation ever granted to third parties, or is registration always
   run by your team?
4. If CASH is not a fit, we would rather hear that plainly than wait — we have our own venue
   ready as a fallback and would just need to plan around it.

## Where we are meanwhile

`/swap` on cash.trading routes APT/USDC and BTC/USDC to Decibel spot today with a fee-aware
quote, protected limit and settlement recovery. CASH is present in the selector and honestly
labelled "not live yet". Nothing about this request blocks that.
