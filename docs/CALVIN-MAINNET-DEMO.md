# Calvin demo: what is live and what is proven

This is the short, evidence-first walkthrough for a Decibel builder demo. It separates
mainnet facts, testnet execution receipts, and the one mainnet action we intentionally have
not taken.

## Mainnet sealed-vault launch path

The current five-module package is published and initialized on Aptos mainnet:

- Package: [`0x3590…5105`](https://explorer.aptoslabs.com/account/0x3590fbae95f65fd00d01be6bf2d5e0049b5b447e749ed269d8cca744d71b5105/modules?network=mainnet)
- Publish transaction: [`0x19ee…5c6b`](https://explorer.aptoslabs.com/txn/0x19ee80346da94d44a13434808656b2047802ab1737577ad0a69dc62d18da5c6b?network=mainnet)
- Platform initialization: [`0x1e50…4611`](https://explorer.aptoslabs.com/txn/0x1e50ab268a3d3732e5a772897d59d713c111818130616306ab3e6b6ac19e4611?network=mainnet)

The live platform terms are:

- 50 USDC one-time cash.trading launch fee
- treasury and builder identity `0x69d3…39fa`
- 0 bp builder fee for automated vault orders
- Aptos compatible upgrade policy, upgrade number 0

The package was recompiled at its final address. Every local module matched the published
bytecode exactly:

| Module | SHA-256 prefix |
|---|---|
| `math_lib` | `aee9afc62c7ca1e3` |
| `indicator` | `8af44bc1da40c7cc` |
| `sealed_vault` | `20e4ed03dd10e3a9` |
| `strategy_vault` | `4dc72ae2572ed22b` |
| `portfolio_vault` | `c12dfe2767e86a6a` |

The current Move suite passes 22 of 22 tests. Publishing and initialization created no vault
and spent no USDC.

## Existing non-vault bot execution proof

The same controlled bot operator used by cash.trading completed a consecutive delegated order
cycle on Decibel testnet. These are chain receipts, not database fixtures or screenshots:

1. [`Open order submitted`](https://explorer.aptoslabs.com/txn/0xf2adacb1da10871e04ddee2065b0eaa9364137209bf82e947b12e3d301b0266a?network=testnet) by the bot operator to a delegated Decibel subaccount.
2. [`OpenLong filled`](https://explorer.aptoslabs.com/txn/0x279e9c51b709bcdb8f526d74d607184a96221859e7674bc469556fed68179768?network=testnet), with matching account and order ID.
3. [`Close order submitted`](https://explorer.aptoslabs.com/txn/0x2121f03f84c7282a30d2f56e2798fc81d0f9df507fabe6a13c9b51f30673cfe1?network=testnet) by the same operator to the same subaccount.
4. [`CloseLong filled`](https://explorer.aptoslabs.com/txn/0x3086fb6c6276675f20d949e6dcf62913a323db3061ebe778a1540db3566a8eca?network=testnet), again with matching account and order ID.

The four transactions are consecutive operator sequence numbers 14323 through 14326. The
fill events show 0.001 BTC opened at $70,753 and closed at $70,752. The verification command
downloads the receipts again and fails if the sender, delegated subaccount, order IDs, statuses,
actions, or sequence numbers do not match:

```bash
DOTENV_CONFIG_PATH=.env.production pnpm demo:automation
```

The command then reads current BTC/USD state from Decibel mainnet, finds an existing production
bot account with collateral and an on-chain delegation to the controlled operator, builds the
production `place_twap_order_to_subaccount` payload, and simulates it without signing or
submitting. The user's subaccount address is deliberately redacted from the output.

## Exact mainnet automation status

Current mainnet reads, delegation, collateral lookup, payload construction, and VM execution all
work. Against the existing delegated production account, the live BTC/USD TWAP payload returns
`Executed successfully` in Aptos mainnet simulation. Simulation supplies only the operator's
public key; it does not sign or submit a transaction, so it cannot spend funds.

That is strong proof that the non-vault automation is wired correctly for current mainnet state,
but it is not a mainnet fill and we do not present it as one. The completed order → fill → close →
fill receipts above remain on testnet. Placing a new mainnet order just to improve a demo would be
a separate money-moving action and is intentionally outside this verification.

## Three-minute walkthrough

1. Open [cash.trading Launchpad](https://cash.trading/launchpad) and show the two-stage deploy
   flow: build from Pine, then launch a vault.
2. Open the [production readiness response](https://cash.trading/api/sealed/config). Confirm
   `network: "mainnet"`, `launchReady: true`, `managedReady: true`, `termsOnChain: true`, and
   the 50 USDC launch fee.
3. Open the publish and initialization transactions above.
4. Run `DOTENV_CONFIG_PATH=.env.production pnpm demo:automation` and open its four execution
   receipt links.

Do not claim a funded sealed vault or mainnet automated fill yet. The package and production
runner are ready, and the existing non-vault payload passes the mainnet VM against a real
delegated account. The first funded vault remains the explicit money-moving acceptance test.
