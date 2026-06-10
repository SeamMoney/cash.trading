#!/usr/bin/env bash
# Strategy-vault integration test on Aptos testnet.
#
# Stage A (indicator half) — VALIDATED 2026-06-09: deploy → init factory → create indicator →
#   push a rising price series → on-chain SMA(3)/SMA(5) crossover yields signal=BUY. Proves the
#   on-chain TA engine end-to-end.
# Stage B (Decibel order half) — IN PROGRESS: create/fund a Decibel vault, delegate trading to the
#   strategy-vault object, then strategy_vault::tick() places a real perp order on the vault
#   subaccount. Requires testnet USDC collateral + a perp-market Object (see TODO below).
#
# Prereqs: `aptos` CLI, a funded testnet profile `cashvault` (the package deployer). Fund via a
# transfer from a funded account — the public testnet faucet is currently returning HTTP 500.
set -euo pipefail

PKG=0x44bccd01a872341d7c74baf3497501ceb0b768a83a5ed9675799bfbac86e0ed3   # deployed package + keeper
PROFILE=cashvault
run() { aptos move run --function-id "$1" "${@:2}" --profile "$PROFILE" --assume-yes; }
view() { aptos move view --function-id "$1" "${@:2}" --profile "$PROFILE"; }

echo "== Stage A: indicator =="
run ${PKG}::indicator::initialize_factory || true   # idempotent-ish; ok if already initialized
run ${PKG}::indicator::create_indicator \
  --args 'string:SMA Test' 'string:SMAT' 'string:BTC/USD' 'u8:0' 'u64:3' 'u64:5' "address:${PKG}"

IND=$(view ${PKG}::indicator::get_all_indicators | python3 -c 'import sys,json;print(json.load(sys.stdin)["Result"][0][-1])')
echo "indicator: $IND"

i=0
for p in 10000 10000 10000 10000 10000 11000 12000 13000; do
  run ${PKG}::indicator::push_price --args "address:${IND}" "u64:${p}" "u64:$((1781000000+i))" >/dev/null
  i=$((i+1))
done
echo "signal_view (signal,fast,slow,last,ts):"
view ${PKG}::indicator::get_signal_view --args "address:${IND}"   # expect signal=1 (BUY)

echo "== Stage B: Decibel vault + delegate + tick (TODO) =="
# TODO(next iteration):
#  1. Acquire testnet USDC (app/api/decibel/faucet) and create a Decibel subaccount.
#  2. vault_api::create_and_fund_vault(...) — reuse lib/decibel-vaults.ts buildCreateDecibelVaultPayload.
#  3. MARKET=<perp_market Object addr on testnet>   # resolve from decibel-chain.ts perp_market reads
#  4. run ${PKG}::strategy_vault::create_strategy_vault \
#       --args "address:${IND}" "address:<VAULT>" "address:${MARKET}" "u64:<order_size>"
#     SV=<new StrategyVault object addr from txn events>
#  5. Delegate trading to SV: vault_admin_api::delegate_dex_actions_to(<VAULT>, SV, none)
#       — reuse lib/decibel-vaults.ts buildDelegateDecibelVaultPayload.
#  6. run ${PKG}::strategy_vault::tick --args "address:${SV}" "u64:13000" "u64:<ts>"
#     → expect a VaultTraded event + a real order on the vault subaccount.
echo "Stage B not yet automated — see TODO."
