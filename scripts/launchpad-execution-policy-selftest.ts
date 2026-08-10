import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/launchpad/execute/route.ts", "utf8");

assert.match(
  route,
  /legacyBotAutomationUnavailable\(\)/,
  "the superseded keeper executor must remain disabled in production",
);
assert.match(
  route,
  /indicatorSignalDecision\.updateMany\([\s\S]*consumedAt: null[\s\S]*expiresAt: \{ gt: claimedAt \}/,
  "signal consumption must use an atomic compare-and-set before submission",
);

const claimIndex = route.indexOf("indicatorSignalDecision.updateMany");
const submitIndex = route.indexOf("decibelTxHash = await submitTx");
assert.ok(claimIndex >= 0 && submitIndex > claimIndex, "the decision must be claimed before the order is submitted");

for (const forbidden of [
  "platformRevenueUsdt",
  "platformFeePaid",
  "creatorFeePaid",
  "record_creator_fee",
  "entryPrice?: number",
]) {
  assert.ok(
    !route.includes(forbidden),
    `legacy execution must not report or accrue uncollected fees (${forbidden})`,
  );
}

console.log("launchpad execution policy self-test passed");
