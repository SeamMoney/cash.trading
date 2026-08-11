/**
 * End-to-end readiness for sealed strategy launches.
 *
 * A package address and public attestor key are enough to build an on-chain payload, but they
 * are not enough to deliver a managed bot. The normal launch flow also needs a registry, the
 * matching private signer, a funded cranker key, encrypted source custody and an authenticated
 * cron. Reporting `ready: true` before all of those exist lets a creator pay for a vault that
 * the platform can never tick.
 */
import { AccountAddress, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

import { sourceKeyProblem } from "@/lib/sealed-source-vault";

type Environment = Readonly<Record<string, string | undefined>>;

export interface SealedReadiness {
  /** Normalized package address, or null when absent/malformed. */
  packageAddress: string | null;
  /** Normalized public key, or null when absent/malformed. */
  attestorPubkey: string | null;
  /** Contract + registry are safe to launch and register against. */
  launchReady: boolean;
  /** The platform can also decrypt, evaluate, sign and submit every managed tick. */
  managedReady: boolean;
  /** Backward-compatible gate used by the current launch UI. Managed mode is the default. */
  ready: boolean;
  launchMissing: string[];
  managedMissing: string[];
  missing: string[];
}

export const SEALED_PLATFORM_TERMS_MISSING =
  "SEALED_PLATFORM_TERMS (configured package is not initialized on-chain)";

function normalizeAptosAddress(raw: string | undefined): string | null {
  const match = /^0x([0-9a-fA-F]{1,64})$/.exec(raw?.trim() ?? "");
  if (!match) return null;
  try {
    return AccountAddress.fromString(`0x${match[1].padStart(64, "0")}`).toString();
  } catch {
    return null;
  }
}

function normalizePublicKey(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value && /^0x[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() : null;
}

function parsePrivateKey(raw: string | undefined): Ed25519PrivateKey | null {
  if (!raw?.trim()) return null;
  try {
    return new Ed25519PrivateKey(raw.trim());
  } catch {
    return null;
  }
}

function pushUnique(target: string[], value: string) {
  if (!target.includes(value)) target.push(value);
}

export function evaluateSealedReadiness(
  env: Environment = process.env,
): SealedReadiness {
  const packageRaw = env.SEALED_VAULT_PACKAGE ?? env.NEXT_PUBLIC_SEALED_VAULT_PACKAGE;
  const publicKeyRaw =
    env.SEALED_ATTESTOR_PUBLIC_KEY ?? env.NEXT_PUBLIC_SEALED_ATTESTOR_PUBLIC_KEY;
  const packageAddress = normalizeAptosAddress(packageRaw);
  const attestorPubkey = normalizePublicKey(publicKeyRaw);

  const launchMissing: string[] = [];
  if (!packageRaw?.trim()) {
    launchMissing.push("SEALED_VAULT_PACKAGE");
  } else if (!packageAddress) {
    launchMissing.push("SEALED_VAULT_PACKAGE (must be a valid Aptos address)");
  }
  if (!publicKeyRaw?.trim()) {
    launchMissing.push("SEALED_ATTESTOR_PUBLIC_KEY");
  } else if (!attestorPubkey) {
    launchMissing.push("SEALED_ATTESTOR_PUBLIC_KEY (must be 0x + 64 hex)");
  }
  if (!env.DATABASE_URL?.trim()) launchMissing.push("DATABASE_URL");

  const managedMissing: string[] = [];
  const attestorPrivateKey = parsePrivateKey(env.SEALED_ATTESTOR_PRIVATE_KEY);
  if (!env.SEALED_ATTESTOR_PRIVATE_KEY?.trim()) {
    managedMissing.push("SEALED_ATTESTOR_PRIVATE_KEY");
  } else if (!attestorPrivateKey) {
    managedMissing.push("SEALED_ATTESTOR_PRIVATE_KEY (invalid ed25519 key)");
  }

  if (attestorPrivateKey && attestorPubkey) {
    const derived = attestorPrivateKey.publicKey().toString().toLowerCase().replace(/^0x/, "");
    if (derived !== attestorPubkey.replace(/^0x/, "")) {
      managedMissing.push("SEALED_ATTESTOR_KEYPAIR (private key does not match public key)");
    }
  }

  if (!env.SEALED_CRANK_PRIVATE_KEY?.trim()) {
    managedMissing.push("SEALED_CRANK_PRIVATE_KEY");
  } else if (!parsePrivateKey(env.SEALED_CRANK_PRIVATE_KEY)) {
    managedMissing.push("SEALED_CRANK_PRIVATE_KEY (invalid ed25519 key)");
  }

  const sourceProblem = sourceKeyProblem(env.SEALED_SOURCE_KEY);
  if (sourceProblem) pushUnique(managedMissing, sourceProblem);

  const cronSecret = env.CRON_SECRET?.trim() ?? "";
  if (!cronSecret) {
    managedMissing.push("CRON_SECRET");
  } else if (cronSecret.length < 32) {
    managedMissing.push("CRON_SECRET (must be at least 32 characters)");
  }

  const launchReady = launchMissing.length === 0;
  const managedReady = launchReady && managedMissing.length === 0;
  const missing = [...launchMissing];
  for (const problem of managedMissing) pushUnique(missing, problem);

  return {
    packageAddress,
    attestorPubkey,
    launchReady,
    managedReady,
    // Managed execution is the product default. Until the UI has a separate self-hosted gate,
    // fail closed instead of selling an inert vault.
    ready: managedReady,
    launchMissing,
    managedMissing,
    missing,
  };
}

/**
 * Add the one readiness check a local environment inspection cannot prove.
 *
 * A syntactically valid Aptos address can still point at an unpublished package or at a package
 * whose `init_platform` transaction never landed. In either case, letting the launch flow build
 * its first Decibel transaction can cost the creator real USDC before the sealed-vault step
 * inevitably fails. Apply this after reading `sealed_vault::platform_terms` from chain.
 */
export function withSealedPlatformReadiness(
  readiness: SealedReadiness,
  platformTermsOnChain: boolean,
): SealedReadiness {
  if (!readiness.packageAddress || platformTermsOnChain) return readiness;

  const launchMissing = [...readiness.launchMissing];
  pushUnique(launchMissing, SEALED_PLATFORM_TERMS_MISSING);
  const missing = [...launchMissing];
  for (const problem of readiness.managedMissing) pushUnique(missing, problem);

  return {
    ...readiness,
    launchReady: false,
    managedReady: false,
    ready: false,
    launchMissing,
    missing,
  };
}
