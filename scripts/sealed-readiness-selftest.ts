import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

import {
  SEALED_PLATFORM_TERMS_MISSING,
  evaluateSealedReadiness,
  withSealedPlatformReadiness,
} from "../lib/sealed-readiness";

const PACKAGE = `0x${"12".repeat(32)}`;
const attestor = Ed25519PrivateKey.generate();
const cranker = Ed25519PrivateKey.generate();
const base = {
  SEALED_VAULT_PACKAGE: PACKAGE,
  SEALED_ATTESTOR_PUBLIC_KEY: attestor.publicKey().toString(),
  DATABASE_URL: "postgresql://readiness.invalid/db",
};

const empty = evaluateSealedReadiness({});
assert.equal(empty.ready, false);
assert.equal(empty.launchReady, false);
assert.equal(empty.managedReady, false);
assert.ok(empty.missing.includes("SEALED_VAULT_PACKAGE"));
assert.ok(empty.missing.includes("DATABASE_URL"));
assert.ok(empty.missing.includes("SEALED_ATTESTOR_PRIVATE_KEY"));
assert.ok(empty.missing.includes("SEALED_CRANK_PRIVATE_KEY"));
assert.ok(empty.missing.includes("CRON_SECRET"));

const launchOnly = evaluateSealedReadiness(base);
assert.equal(launchOnly.launchReady, true, "contract + registry should be launch-ready");
assert.equal(launchOnly.managedReady, false, "launch-only config cannot run managed ticks");
assert.equal(launchOnly.ready, false, "the default managed launch gate must fail closed");

const malformed = evaluateSealedReadiness({
  ...base,
  SEALED_VAULT_PACKAGE: "not-an-address",
  SEALED_ATTESTOR_PUBLIC_KEY: attestor.publicKey().toString().replace(/^0x/, ""),
});
assert.ok(malformed.launchMissing.some((item) => item.startsWith("SEALED_VAULT_PACKAGE")));
assert.ok(malformed.launchMissing.some((item) => item.startsWith("SEALED_ATTESTOR_PUBLIC_KEY")));

const wrongAttestor = Ed25519PrivateKey.generate();
const mismatch = evaluateSealedReadiness({
  ...base,
  SEALED_ATTESTOR_PRIVATE_KEY: wrongAttestor.toString(),
  SEALED_CRANK_PRIVATE_KEY: cranker.toString(),
  SEALED_SOURCE_KEY: randomBytes(32).toString("hex"),
  CRON_SECRET: randomBytes(32).toString("hex"),
});
assert.ok(
  mismatch.managedMissing.includes(
    "SEALED_ATTESTOR_KEYPAIR (private key does not match public key)",
  ),
  "a mismatched attestor pair must block launch before an unfixable vault is created",
);

const shortCron = evaluateSealedReadiness({
  ...base,
  SEALED_ATTESTOR_PRIVATE_KEY: attestor.toString(),
  SEALED_CRANK_PRIVATE_KEY: cranker.toString(),
  SEALED_SOURCE_KEY: randomBytes(32).toString("hex"),
  CRON_SECRET: "short",
});
assert.ok(shortCron.managedMissing.some((item) => item.startsWith("CRON_SECRET")));

const ready = evaluateSealedReadiness({
  ...base,
  SEALED_ATTESTOR_PRIVATE_KEY: attestor.toString(),
  SEALED_CRANK_PRIVATE_KEY: cranker.toString(),
  SEALED_SOURCE_KEY: randomBytes(32).toString("hex"),
  CRON_SECRET: randomBytes(32).toString("hex"),
});
assert.equal(ready.launchReady, true);
assert.equal(ready.managedReady, true);
assert.equal(ready.ready, true);
assert.deepEqual(ready.missing, []);
assert.equal(ready.packageAddress, PACKAGE);
assert.equal(ready.attestorPubkey, attestor.publicKey().toString().toLowerCase());

const unpublished = withSealedPlatformReadiness(ready, false);
assert.equal(unpublished.launchReady, false);
assert.equal(unpublished.managedReady, false);
assert.equal(unpublished.ready, false);
assert.ok(unpublished.launchMissing.includes(SEALED_PLATFORM_TERMS_MISSING));
assert.ok(unpublished.missing.includes(SEALED_PLATFORM_TERMS_MISSING));

const published = withSealedPlatformReadiness(ready, true);
assert.deepEqual(published, ready, "an initialized on-chain package must preserve env readiness");

const absentPackage = withSealedPlatformReadiness(empty, false);
assert.equal(
  absentPackage.launchMissing.includes(SEALED_PLATFORM_TERMS_MISSING),
  false,
  "a missing package should not also report a redundant on-chain initialization error",
);

console.log("sealed readiness: passed");
