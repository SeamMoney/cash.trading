import "dotenv/config";
import {
  cashRewardsReadinessBlockers,
  inspectCashRewardsMainnet,
} from "../lib/cash-rewards-mainnet";

const OCTAS_PER_APT = 100_000_000;

function status(value: boolean) {
  return value ? "ok" : "missing";
}

async function main() {
  const inspection = await inspectCashRewardsMainnet();
  const { managerKey, issuerKey, managerAccount, published, contract } =
    inspection;
  const blockers = cashRewardsReadinessBlockers(inspection);

  console.log("CASH rewards mainnet readiness\n");
  console.log(`manager key        ${status(managerKey.present && managerKey.matches)}`);
  console.log(`issuer key         ${status(issuerKey.present && issuerKey.matches)}`);
  console.log(
    `manager account    ${managerAccount.exists ? "exists" : "not created"}`,
  );
  console.log(
    `manager APT        ${(
      Number(managerAccount.aptOctas) / OCTAS_PER_APT
    ).toFixed(8)}`,
  );
  console.log(`module published   ${published ? "yes" : "no"}`);
  console.log(
    `contract initialized ${contract.initialized ? "yes" : "no"}`,
  );
  if (contract.initialized) {
    console.log(`claims paused      ${contract.paused ? "yes" : "no"}`);
    console.log(`issuer matches     ${contract.issuerMatches ? "yes" : "no"}`);
    console.log(
      `epoch config       ${
        contract.epochDurationMatches &&
        contract.epochCapMatches &&
        contract.walletCapMatches
          ? "matches"
          : "mismatch"
      }`,
    );
    console.log(`vault CASH atomic  ${contract.vaultBalanceAtomic}`);
  }

  if (blockers.length === 0) {
    console.log("\nREADY: all local and on-chain launch checks passed.");
    return;
  }

  console.log("\nBLOCKED:");
  blockers.forEach((blocker, index) =>
    console.log(`${index + 1}. ${blocker}`),
  );
  process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`CASH rewards readiness check failed: ${message}`);
  process.exitCode = 1;
});
