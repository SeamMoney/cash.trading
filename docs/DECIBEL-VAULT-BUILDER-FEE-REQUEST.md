# Request: a builder-fee approval path for Decibel vault subaccounts

**From:** cash.trading (SeamMoney) · builder subaccount `0xc755b3bb6477e11e1635de67cded8d0683e9d4e360b6c484a33eb2fd6cb9ca39`
**Ask in one line:** expose a way for a vault's manager (or its delegated strategy) to approve a
builder fee for the vault's own trading subaccount — today only the vault object's signer can,
and nothing outside `decibel::vault` can produce it.

## What already works (no action needed)

Builder codes for direct user orders are fully permissionless and live for us on mainnet:

- We created our builder identity with the public `dex_accounts_entry::create_new_subaccount`
  (tx `0x714eeb7450fb02c9631f8cfd51c8d3fbda698eaabfe99fd3e8756d179c9b9ea2`).
- Users approve it per subaccount (`approve_max_builder_fee_for_subaccount`, e.g.
  `0xbcc929cd8f96df76d14ab1ae5d2238a94a9d32824eafe87043c39164c37e5eec`), orders carry it
  (`0x599a3bf151e2386c4a4dcb024e9e9490bddacd9d650b124b712d75a0e0949bb7`), and fees accrue to the
  builder subaccount's Decibel balance. This mechanism is well designed; we are not asking you
  to change it.

## What is blocked: builder fees on automated vault orders

Our sealed/portfolio strategy vaults trade a Decibel vault's capital through delegation
(`delegate_dex_actions_to`). We want those orders to carry a small builder fee (2 bp). They
cannot, because the fee payer is the **vault's own primary subaccount**, and its approval can
only be signed by the vault object:

Simulation matrix, identical on testnet (`0xe7da2794…`) and mainnet (`0x50ead2…`), function
`dex_accounts_entry::approve_max_builder_fee_for_subaccount(signer, vault_primary_subaccount,
builder_subaccount, fee)`:

| Signer                          | Result |
| ---                             | --- |
| Vault creator / manager         | abort `dex_accounts::ENOT_SUBACCOUNT_OWNER(0x1)` |
| Delegated strategy vault object | abort `dex_accounts::ENOT_SUBACCOUNT_OWNER(0x1)` |
| Unrelated wallet                | abort `dex_accounts::ENOT_SUBACCOUNT_OWNER(0x1)` |
| The vault object itself         | executes — but no external code can produce this signer |

And without that approval, any delegated order carrying the code aborts, regardless of how
valid the builder identity is:

- Order simulation with a **registered, working builder subaccount** attached but no
  payer-side approval → abort `builder_code_registry::EBUILDER_NOT_REGISTERED(0x2)`.
- Live confirmation from our testnet vault run (package `0x4ad6f9f4…c0e9`, Decibel vault
  `0x90d7ce26…99ea`): identical strategy code, `builder_fee_bps = 2` aborted every order with
  `EBUILDER_NOT_REGISTERED`; `builder_fee_bps = 0` filled four orders across BTC/ETH/SOL/APT.
  (An approval signed by the *strategy object* was recorded and did not help — the engine
  correctly checks the vault subaccount that pays.)

Everything above is reproducible by simulation with no keys and no gas.

## What we're asking for (any one of these)

1. A manager-signed wrapper, e.g. `vault_api::approve_max_builder_fee_for_vault(manager,
   vault, builder, max_fee)`, mirroring how other vault admin actions are authorized; or
2. an approval scoped to an existing dex-actions delegate; or
3. optional builder params on `create_and_fund_vault`, snapshotting consent at creation; or
4. if a path already exists that we missed, point us at it and we'll use it.

## Where we are meanwhile

Vault orders ship with the builder fee **locked to 0 bp** (a vault created with a positive fee
today can never trade, and our tooling now refuses that configuration). The day an approval
path exists we flip one config call — our builder identity (`0xc755…ca39`) is already live,
collecting direct-order fees on mainnet.
