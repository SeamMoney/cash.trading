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
- 2 CASH per conservative capital-dollar-hour reconstructed from fills
- 1,000 CASH for each distinct UTC day with a verified fill

The formula intentionally uses fee and conservative capital exposure instead
of leveraged notional volume. It never pays simply for being liquidated.
Formula v2 began with reward epoch 2950. Formula changes ship only at an epoch
boundary so an active week's cumulative entitlement does not change mid-week.

## Launch sequence

Run `pnpm cash-rewards:mainnet` first. Its default plan mode is read-only. It
verifies both ignored keys, runs the five Move tests, compiles the exact
production package, checks the manager's APT balance, and compares any
published bytecode and initialized settings with this repository. It never
prints private-key material.

1. Back up `.cash-rewards/manager.key` offline. It is ignored by git.
2. Send only enough mainnet APT to the public manager address for package
   publication and initialization.
3. Run the guarded command printed by plan mode. It publishes only when the
   module is absent, initializes only when the contract is uninitialized, and
   verifies the bytecode, issuer, duration, and caps after each step. The
   command is safe to rerun and always leaves claims paused.
4. Set the issuer private key in Vercel and verify a zero-value dry run.
5. Fund the vault with a small CASH canary amount, claim to a test recipient,
   verify balances/events/caps, then fund the intended pilot budget.
6. Unpause only after the canary passes.

`pnpm test:cash-rewards:mainnet-readiness` remains the final read-only launch
check. It also verifies canary funding and the paused state, so it will remain
blocked until the canary is funded and claims are deliberately enabled.

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

The Move signature fixture is intentionally pinned to the test named address
`0xCA54`, because the signed voucher includes the module publisher address.
Run the five-test suite with
`aptos move test --named-addresses cash_rewards=0xCA54`. Production-address
compilation is a separate check; changing the named address without
regenerating the fixture is expected to invalidate that one signature.
