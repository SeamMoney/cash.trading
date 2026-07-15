import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
  type InputEntryFunctionData,
} from "@aptos-labs/ts-sdk";
import {
  serializeCashRewardVoucherForAsset,
  type CashRewardVoucher,
} from "../lib/cash-rewards";

const MANAGER = "0x69d3e19408b35905854a56f14dc7381850b6e55a43a2d7bc2fd9bd176cbe39fa";
const EXPECTED_ISSUER_PUBLIC_KEY =
  "8881213155e405d6e1e2b34c7700197166c28b5599c4006f93c2317473f6dee8";
const TEST_COIN = `${MANAGER}::test_cash::TestCash`;
const MODULE = `${MANAGER}::cash_rewards`;
const CLAIM_INCREMENT = 100_000_000n;
const MAX_GAS_AMOUNT = 20_000;

function privateKey(raw: string | undefined, label: string) {
  const normalized = raw
    ?.replace(/^ed25519-priv-/i, "")
    .replace(/\r?\n/g, "")
    .trim();
  if (!normalized) throw new Error(`${label} is missing`);
  return new Ed25519PrivateKey(normalized);
}

async function view(
  aptos: Aptos,
  functionName: `${string}::${string}::${string}`,
  typeArguments: string[],
  functionArguments: Array<string | number>,
) {
  return aptos.view({
    payload: { function: functionName, typeArguments, functionArguments },
  });
}

async function submit(
  aptos: Aptos,
  signer: Account,
  data: InputEntryFunctionData,
) {
  const transaction = await aptos.transaction.build.simple({
    sender: signer.accountAddress,
    data,
    options: { maxGasAmount: MAX_GAS_AMOUNT },
  });
  const [simulation] = await aptos.transaction.simulate.simple({
    signerPublicKey: signer.publicKey,
    transaction,
  });
  assert.equal(simulation.success, true, simulation.vm_status);
  const pending = await aptos.signAndSubmitTransaction({ signer, transaction });
  const committed = await aptos.waitForTransaction({ transactionHash: pending.hash });
  assert.equal(committed.success, true, committed.vm_status);
  return pending.hash;
}

function claimData(
  voucher: CashRewardVoucher,
  signature: Uint8Array,
): InputEntryFunctionData {
  return {
    function: `${MODULE}::claim` as `${string}::${string}::${string}`,
    typeArguments: [TEST_COIN],
    functionArguments: [
      voucher.epoch.toString(),
      voucher.cumulativeAmountAtomic.toString(),
      voucher.expiresAtSeconds.toString(),
      Array.from(signature),
    ],
  };
}

async function simulateRejectedClaim(
  aptos: Aptos,
  recipient: Account,
  voucher: CashRewardVoucher,
  issuer: Ed25519PrivateKey,
) {
  const signature = issuer.sign(
    serializeCashRewardVoucherForAsset(voucher, MANAGER, TEST_COIN),
  );
  const transaction = await aptos.transaction.build.simple({
    sender: recipient.accountAddress,
    data: claimData(voucher, signature.toUint8Array()),
    options: { maxGasAmount: MAX_GAS_AMOUNT },
  });
  const [simulation] = await aptos.transaction.simulate.simple({
    signerPublicKey: recipient.publicKey,
    transaction,
  });
  assert.equal(simulation.success, false, "invalid claim unexpectedly simulated successfully");
  return simulation.vm_status;
}

async function main() {
  const recipient = Account.fromPrivateKey({
    privateKey: privateKey(process.env.APTOS_PRIVATE_KEY, "APTOS_PRIVATE_KEY"),
  });
  assert.notEqual(recipient.accountAddress.toString(), MANAGER, "recipient must be isolated from manager");

  const issuer = privateKey(
    readFileSync(".cash-rewards/issuer.key", "utf8"),
    ".cash-rewards/issuer.key",
  );
  assert.equal(
    issuer.publicKey().toString().replace(/^0x/, "").toLowerCase(),
    EXPECTED_ISSUER_PUBLIC_KEY,
    "local issuer key does not match the configured contract issuer",
  );

  const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));
  const registered = await view(
    aptos,
    "0x1::coin::is_account_registered",
    [TEST_COIN],
    [recipient.accountAddress.toString()],
  );
  if (registered[0] !== true) {
    await submit(aptos, recipient, {
      function: "0x1::managed_coin::register",
      typeArguments: [TEST_COIN],
      functionArguments: [],
    });
  }

  const [state, epochResult] = await Promise.all([
    view(aptos, `${MODULE}::get_state`, [TEST_COIN], []),
    view(aptos, `${MODULE}::current_epoch`, [], []),
  ]);
  assert.equal(state[2], false, "testnet distributor must be unpaused for canary");
  const epoch = BigInt(String(epochResult[0]));
  const maxWalletAtomic = BigInt(String(state[5]));
  const beforeVaultAtomic = BigInt(String(state[6]));
  const [claimedResult, balanceResult] = await Promise.all([
    view(aptos, `${MODULE}::claimed_by`, [], [recipient.accountAddress.toString(), epoch.toString()]),
    view(aptos, "0x1::coin::balance", [TEST_COIN], [recipient.accountAddress.toString()]),
  ]);
  const beforeClaimedAtomic = BigInt(String(claimedResult[0]));
  const beforeBalanceAtomic = BigInt(String(balanceResult[0]));
  const cumulativeAmountAtomic = beforeClaimedAtomic + CLAIM_INCREMENT;
  assert.ok(cumulativeAmountAtomic <= maxWalletAtomic, "test recipient reached its epoch cap");

  const voucher: CashRewardVoucher = {
    chainId: 2,
    recipient: recipient.accountAddress.toString(),
    epoch,
    cumulativeAmountAtomic,
    expiresAtSeconds: BigInt(Math.floor(Date.now() / 1_000) + 900),
  };
  const signature = issuer.sign(
    serializeCashRewardVoucherForAsset(voucher, MANAGER, TEST_COIN),
  );
  const claimHash = await submit(
    aptos,
    recipient,
    claimData(voucher, signature.toUint8Array()),
  );

  const [afterState, afterClaimedResult, afterBalanceResult] = await Promise.all([
    view(aptos, `${MODULE}::get_state`, [TEST_COIN], []),
    view(aptos, `${MODULE}::claimed_by`, [], [recipient.accountAddress.toString(), epoch.toString()]),
    view(aptos, "0x1::coin::balance", [TEST_COIN], [recipient.accountAddress.toString()]),
  ]);
  const afterVaultAtomic = BigInt(String(afterState[6]));
  const afterClaimedAtomic = BigInt(String(afterClaimedResult[0]));
  const afterBalanceAtomic = BigInt(String(afterBalanceResult[0]));
  assert.equal(afterClaimedAtomic - beforeClaimedAtomic, CLAIM_INCREMENT);
  assert.equal(afterBalanceAtomic - beforeBalanceAtomic, CLAIM_INCREMENT);
  assert.equal(beforeVaultAtomic - afterVaultAtomic, CLAIM_INCREMENT);

  const replayStatus = await simulateRejectedClaim(aptos, recipient, voucher, issuer);
  const overCapStatus = await simulateRejectedClaim(
    aptos,
    recipient,
    { ...voucher, cumulativeAmountAtomic: maxWalletAtomic + 1n },
    issuer,
  );

  console.log(
    JSON.stringify(
      {
        network: "testnet",
        manager: MANAGER,
        recipient: recipient.accountAddress.toString(),
        claimHash,
        claimedAtomic: afterClaimedAtomic.toString(),
        recipientBalanceAtomic: afterBalanceAtomic.toString(),
        vaultBalanceAtomic: afterVaultAtomic.toString(),
        replayRejected: replayStatus,
        walletCapRejected: overCapStatus,
      },
      null,
      2,
    ),
  );
}

void main();
