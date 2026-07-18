# cash.trading Builder and CASH incentive strategy

Status: implementation-ready, launch-gated. Last reviewed July 18, 2026.

## The product advantage

cash.trading should win on account clarity, points intelligence, vault automation,
cross-chain onboarding, and responsive charts. CASH rewards are an acquisition and
retention layer for those useful workflows; they are not a substitute for them.

The first production program uses Decibel Builder Codes. A user may opt in by
approving a maximum fee for the isolated cash.trading Builder address on a specific
Decibel subaccount. Approved orders placed through cash.trading include a 1 bp
(0.01%) Builder fee. The approval is shown clearly and can be revoked at any time.
Accounts that do not opt in pay no cash.trading Builder fee.

Official mechanics:

- https://docs.decibel.trade/quickstart/builder-codes
- https://docs.decibel.trade/developer-hub/on-chain/builder-fee/approve-max-builder-fee
- https://docs.decibel.trade/for-traders/fees

## Revenue math

At 1 bp, gross Builder revenue is simple:

| Filled notional routed through cash.trading | Gross Builder revenue |
| ---: | ---: |
| $10,000 | $1 |
| $100,000 | $10 |
| $1,000,000 | $100 |
| $10,000,000 | $1,000 |

Decibel protocol maker/taker fees still apply independently. Product reporting must
show protocol fees and Builder fees separately.

The Builder address is the isolated CASH rewards manager address. It is not a hot
user wallet. Orders only include Builder fields after an on-chain approval read
confirms that the selected subaccount approved at least the configured fee. Failed,
slow, or unavailable reads fail open: the order stays usable and omits Builder fields.

## CASH pilot budget

The current distributor limits are deliberately conservative:

- 100,000 CASH maximum per wallet per seven-day epoch.
- 4,200,000 CASH maximum across all wallets per epoch.
- Rewards derive from verified fills/fees, conservative capital-dollar-hours, and
  distinct active days—not leveraged headline notional.
- Liquidation is never rewarded.

Using the owner's working estimate of 600 million CASH worth about $9,000, the
implied mark-to-market is roughly $0.000015 per CASH. At that reference value, one
maximum epoch is about $63 and one maximum wallet epoch is about $1.50. These are
planning estimates, not an oracle or a promise of value.

Fund only one epoch plus a small claim buffer for the canary. Do not transfer the
full treasury. A four-week pilot at the hard ceiling emits at most 16.8 million CASH,
or 2.8% of a 600 million supply. Continuing the same ceiling for a full year would
emit too much supply, so the program must be reviewed after the pilot and should
eventually converge toward a fraction of realized Builder revenue.

## Launch gates

Enrollment remains disabled until every gate is green:

1. Fund the isolated manager with enough APT to publish and initialize the reward
   contract.
2. Publish the exact reviewed Move package and verify its module hash/address.
3. Fund only the canary CASH amount, issue one voucher, claim it from a non-admin
   wallet, and verify epoch and wallet caps on-chain.
4. Approve the 1 bp Builder maximum from a test subaccount, place a small production
   order, and verify the fee receipt at the isolated Builder address.
5. Revoke approval, place another order, and verify that both Builder arguments are
   absent and no Builder fee is collected.
6. Change `config/cash-rewards.json` status to `live` only after those checks. The UI
   then permits voluntary enrollment.

## Success measures

The pilot dashboard should report these per day and per cohort:

- Unique connected and funded Decibel owners, resolved across EVM-derived/Aptos
  identities.
- Unique traders with verified fills and their D1/D7/D30 return rate.
- Deposited collateral and capital-dollar-hours (the closest measure of actual
  committed dollars), distinct from leveraged notional.
- Filled notional, maker/taker protocol fees, cash.trading Builder revenue, claimed
  CASH, and a conservative mark-to-market reward cost.
- Net acquisition cost per retained funded trader.
- Vault deposits, vault retention, and strategy usage attributable to cash.trading.

Raw volume is not a success metric by itself. The first milestone is at least $9,000
of genuine funded/committed capital from retained users, not $9,000 of leveraged
notional cycling through wash trades.

## Abuse and treasury controls

- Reject self-referral, wash trading, circular accounts, and scripted farming meant
  only to manufacture points or rewards.
- Keep all eligibility inputs server-verified against Decibel history.
- Never reward liquidation, failed orders, canceled orders, deposits immediately
  withdrawn, or unverified client telemetry.
- Freeze formula changes for the current epoch; make changes effective only at an
  announced future epoch.
- Pause issuance automatically on issuer mismatch, contract mismatch, exhausted
  epoch budget, stale source data, or anomalous concentration.
- Keep manager/admin keys offline. Vercel receives only the capped voucher issuer
  key, never the manager key.

## Monetization roadmap

1. Launch the voluntary 1 bp Builder-linked rewards pilot.
2. Earn retention with the points intelligence and vault-management experience.
3. Offer advanced automation with explicit strategy risk controls. Do not promise
   returns or automate activity merely to farm Decibel AMPs.
4. Add transparent revenue reporting and use a budgeted share of realized Builder
   revenue to fund future epochs.
5. Consider premium automation or manager tooling only after the core trading and
   vault flows demonstrate retained users; never hide fees inside spreads or token
   estimates.
