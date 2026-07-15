# CASH rewards

cash.trading rewards verified Decibel activity with cumulative, user-claimed
CASH vouchers. The web runtime never controls the reward vault.

## Safety model

- `contracts/cash-rewards` holds CASH under an isolated manager address.
- The manager/admin private key stays offline in `.cash-rewards/manager.key`.
- Vercel receives only the issuer key. It can sign eligibility vouchers but
  cannot withdraw the vault.
- Move enforces a 100,000 CASH wallet cap and 4,200,000 CASH global cap per
  seven-day epoch, regardless of what the web server signs.
- Vouchers are bound to the chain, contract, CASH type, recipient, epoch,
  cumulative amount, and a short expiration.
- Claims start paused. The manager must publish, initialize, fund, and
  explicitly unpause the module.
- Emergency withdrawals require the contract to be paused and the offline
  admin signature.

## Pilot reward formula

Only server-read Decibel trade history for an owner-verified subaccount counts.
The cumulative weekly entitlement combines:

- 5,000 CASH per dollar of paid trading fees (25% more for rebates/maker flow)
- 8 CASH per conservative capital-dollar-hour reconstructed from fills
- 2,500 CASH for each distinct UTC day with a verified fill

The formula intentionally uses fee and conservative capital exposure instead
of leveraged notional volume. It never pays simply for being liquidated.

## Launch sequence

1. Back up `.cash-rewards/manager.key` offline. It is ignored by git.
2. Send only enough mainnet APT to the public manager address for package
   publication and initialization.
3. Publish `contracts/cash-rewards` with the manager named address.
4. Initialize with the public issuer key and the caps in
   `config/cash-rewards.json`; leave claims paused.
5. Set the issuer private key in Vercel and verify a zero-value dry run.
6. Fund the vault with a small CASH canary amount, claim to a test recipient,
   verify balances/events/caps, then fund the intended pilot budget.
7. Unpause only after the canary passes.

Do not send the full token inventory to the distributor. Fund one pilot epoch
at a time so the maximum economic exposure stays obvious and reversible.

## Verification

The contract has five passing Move tests covering cumulative claims, replay
protection, wallet/global caps, and byte-for-byte TypeScript/Move voucher
compatibility. A separate recipient also completed a funded testnet claim;
the recipient balance increased by exactly the claim amount, the vault fell by
the same amount, and replay/over-cap simulations aborted as designed. Public
transaction hashes are recorded in `config/cash-rewards-testnet.json`.

Run `pnpm test:cash-rewards:testnet` to repeat the funded testnet canary. It
uses the ignored local issuer key and the test-only account configured in
`.env`; it never touches mainnet CASH.
