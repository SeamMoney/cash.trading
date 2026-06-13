import { createHash } from "crypto";
import type { StrategyArtifact } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { transpileV3, TRANSPILER_VERSION } from "@/lib/launchpad/transpiler-v3";

/**
 * StrategyArtifact registry — the verifiability record binding a deployed
 * strategy package to the exact PineScript it came from (MASTER-PLAN WS3.1).
 *
 * The deploy pipeline calls storeArtifact() right after compile (pine + move +
 * hash + market), then again after publish to attach packageAddress/txHash/
 * indicatorAddr. /api/launchpad/verify uses getArtifact() + verifyArtifact()
 * to recompute the source hash and re-emit the Move with the pinned
 * transpiler, diffing against what was actually published.
 *
 * No network calls here — pure DB + transpiler.
 */

// Same algorithm as move-compile-service.ts: Node's sha3-256 matches Move's
// std::hash::sha3_256, 0x-prefixed hex over the utf8 Pine source.
export function sha3_256Hex(input: string): string {
  return "0x" + createHash("sha3-256").update(input, "utf8").digest("hex");
}

// ── Pure re-emission diff (no Prisma — unit-testable) ───────────────────────

export interface ArtifactVerifyResult {
  /** Pinned-transpiler re-emission byte-matches the stored moveSource. */
  emissionMatches: boolean;
  /** 1-based line of the first divergence when emissionMatches=false. */
  firstDiffLine?: number;
  /** sha3-256 of the stored pineScript, recomputed now. */
  recomputedHash: string;
  /** recomputedHash === stored sourceHash. */
  hashMatches: boolean;
}

/** Per-market engine constraints the deploy used (affect NAV-sizing constants
 *  in the emitted vault section). Omitted = codegen defaults. */
export interface EmissionSizing {
  lotSize?: number;
  minSize?: number;
  szDecimalsPow?: string;
}

/**
 * Re-run the pinned transpiler on the stored Pine with the SAME options the
 * deploy pipeline used (target "vault", stored marketAddr) and diff against
 * the stored Move line-by-line. creatorAddr does not influence moveSource
 * (only Move.toml), so the default is safe here.
 */
export function diffReEmission(
  stored: Pick<StrategyArtifact, "sourceHash" | "pineScript" | "moveSource" | "marketAddr">,
  sizing?: EmissionSizing,
): ArtifactVerifyResult {
  const recomputedHash = sha3_256Hex(stored.pineScript);
  const hashMatches = recomputedHash === stored.sourceHash;

  let emitted: string | null = null;
  try {
    const result = transpileV3(stored.pineScript, undefined, {
      target: "vault",
      marketAddr: stored.marketAddr,
      lotSize: sizing?.lotSize,
      minSize: sizing?.minSize,
      szDecimalsPow: sizing?.szDecimalsPow,
    });
    emitted = result.moveSource;
  } catch {
    // Transpiler refuses what it once emitted — not reproducible, so not verified.
    emitted = null;
  }

  if (emitted === null) {
    return { emissionMatches: false, firstDiffLine: 1, recomputedHash, hashMatches };
  }
  if (emitted === stored.moveSource) {
    return { emissionMatches: true, recomputedHash, hashMatches };
  }

  const storedLines = stored.moveSource.split("\n");
  const emittedLines = emitted.split("\n");
  const common = Math.min(storedLines.length, emittedLines.length);
  let firstDiffLine = common + 1; // sources differ only in length
  for (let i = 0; i < common; i++) {
    if (storedLines[i] !== emittedLines[i]) {
      firstDiffLine = i + 1;
      break;
    }
  }
  return { emissionMatches: false, firstDiffLine, recomputedHash, hashMatches };
}

// ── Registry (Prisma) ────────────────────────────────────────────────────────

export interface StoreArtifactInput {
  sourceHash: string;
  /** Required when the row does not exist yet (post-compile call). */
  pineScript?: string;
  moveSource?: string;
  marketAddr?: string;
  /** Defaults to the pinned TRANSPILER_VERSION on create. */
  transpilerVersion?: string;
  /** Publish-phase fields — attached by the second call. */
  packageAddress?: string | null;
  publishTxHash?: string | null;
  indicatorAddr?: string | null;
  strategyVaultAddr?: string | null;
  /** JSON.stringify'd EquivalenceReport (lib/strategy-equivalence.ts). */
  equivalenceReport?: string | null;
}

/**
 * Upsert by sourceHash. Fields left undefined are not touched on update, so
 * the post-publish call can attach packageAddress/txHash/indicatorAddr without
 * re-sending the sources.
 */
export async function storeArtifact(input: StoreArtifactInput): Promise<StrategyArtifact> {
  const update = {
    pineScript: input.pineScript,
    moveSource: input.moveSource,
    marketAddr: input.marketAddr,
    transpilerVersion: input.transpilerVersion,
    packageAddress: input.packageAddress,
    publishTxHash: input.publishTxHash,
    indicatorAddr: input.indicatorAddr,
    strategyVaultAddr: input.strategyVaultAddr,
    equivalenceReport: input.equivalenceReport,
  };

  if (input.pineScript !== undefined && input.moveSource !== undefined && input.marketAddr !== undefined) {
    return prisma.strategyArtifact.upsert({
      where: { sourceHash: input.sourceHash },
      update,
      create: {
        sourceHash: input.sourceHash,
        pineScript: input.pineScript,
        moveSource: input.moveSource,
        marketAddr: input.marketAddr,
        transpilerVersion: input.transpilerVersion ?? TRANSPILER_VERSION,
        packageAddress: input.packageAddress ?? null,
        publishTxHash: input.publishTxHash ?? null,
        indicatorAddr: input.indicatorAddr ?? null,
        strategyVaultAddr: input.strategyVaultAddr ?? null,
        equivalenceReport: input.equivalenceReport ?? null,
      },
    });
  }

  // Partial input can only update an existing row — surface a clear error
  // instead of Prisma's P2025 when the compile-phase write never happened.
  try {
    return await prisma.strategyArtifact.update({
      where: { sourceHash: input.sourceHash },
      data: update,
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") {
      throw new Error(
        `storeArtifact: no artifact for sourceHash ${input.sourceHash} and ` +
          "pineScript/moveSource/marketAddr were not provided to create one",
      );
    }
    throw err;
  }
}

export async function getArtifact(by: {
  sourceHash?: string;
  packageAddress?: string;
  indicatorAddr?: string;
}): Promise<StrategyArtifact | null> {
  if (by.sourceHash) {
    return prisma.strategyArtifact.findUnique({ where: { sourceHash: by.sourceHash } });
  }
  if (by.packageAddress) {
    return prisma.strategyArtifact.findUnique({ where: { packageAddress: by.packageAddress } });
  }
  if (by.indicatorAddr) {
    return prisma.strategyArtifact.findFirst({
      where: { indicatorAddr: by.indicatorAddr },
      orderBy: { createdAt: "desc" },
    });
  }
  throw new Error("getArtifact: provide sourceHash, packageAddress, or indicatorAddr");
}

/**
 * Verify a stored artifact: recompute sha3-256 of the Pine and re-emit the
 * Move with the pinned transpiler, diffing against what was stored at deploy
 * time. Pass the market's engine constraints (lotSize/minSize/szDecimalsPow)
 * when the deploy used non-default values — they are baked into the emitted
 * vault constants.
 */
export async function verifyArtifact(
  sourceHash: string,
  sizing?: EmissionSizing,
): Promise<ArtifactVerifyResult> {
  const artifact = await prisma.strategyArtifact.findUnique({ where: { sourceHash } });
  if (!artifact) {
    throw new Error(`verifyArtifact: no artifact for sourceHash ${sourceHash}`);
  }
  return diffReEmission(artifact, sizing);
}
