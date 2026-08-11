import assert from "node:assert/strict";

import {
  SEALED_PACKAGE_MODULES,
  bytecodeSha256,
  compareSealedPackageBytecode,
  normalizeBytecodeHex,
  sealedPackageBytecodeMatches,
  type BytecodeByModule,
} from "../lib/sealed-package-verification";

const local = Object.fromEntries(
  SEALED_PACKAGE_MODULES.map((module, index) => [module, `a11c${index.toString(16).padStart(2, "0")}`]),
) as BytecodeByModule;

const identical = Object.fromEntries(
  Object.entries(local).map(([module, bytecode]) => [module, `0x${bytecode!.toUpperCase()}`]),
) as BytecodeByModule;
const matching = compareSealedPackageBytecode(local, identical);
assert.equal(sealedPackageBytecodeMatches(matching), true);
assert.deepEqual(matching.map(({ status }) => status), Array(SEALED_PACKAGE_MODULES.length).fill("match"));

const drifted = { ...identical, sealed_vault: "0xa11cff" };
const mismatch = compareSealedPackageBytecode(local, drifted);
assert.equal(sealedPackageBytecodeMatches(mismatch), false);
assert.equal(mismatch.find(({ module }) => module === "sealed_vault")?.status, "mismatch");
assert.notEqual(
  mismatch.find(({ module }) => module === "sealed_vault")?.localSha256,
  mismatch.find(({ module }) => module === "sealed_vault")?.onChainSha256,
);

const missing = { ...identical };
delete missing.portfolio_vault;
assert.equal(
  compareSealedPackageBytecode(local, missing).find(({ module }) => module === "portfolio_vault")
    ?.status,
  "missing-on-chain",
);

assert.equal(normalizeBytecodeHex("  0xA11C00  "), "a11c00");
assert.equal(bytecodeSha256("0x00"), bytecodeSha256("00"));
assert.throws(() => normalizeBytecodeHex("0xxyz"), /even-length hex string/);

console.log("sealed package bytecode verification self-test passed");
