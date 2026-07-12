/**
 * Strategy-source verification (docs/SHELBY-PIN.md).
 *
 * GET /api/launchpad/verify?sourceHash=…  (preferred)
 *                          | ?packageAddress=0x…  | ?indicator=0x…[&pkg=0x…]
 *
 * Recomputes the source hash and re-emits the Move from the registry's stored
 * PineScript with the pinned transpiler, diffing against the stored Move — so
 * a depositor can confirm the deployed vault matches the published strategy.
 * Bytecode-vs-on-chain recompile compare is still future work (marked pending).
 */
import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { getArtifact, verifyArtifact } from "@/lib/strategy-artifacts";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { isValidAptosAddress, normalizeAptosAddress } from "@/lib/decibel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEGACY_PKG = "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee";
const ADDR_RE = /^0x[0-9a-fA-F]{1,64}$/;
const SOURCE_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

// marketAddr → engine sizing constants (baked into the emitted vault module, so
// re-emission must use the same ones). Mirrors deploy-vault's MARKETS.
const SIZING_BY_ADDR: Record<string, { lotSize: number; minSize: number; szDecimalsPow: string }> = {
  "0x6e9c93c836abebdcf998a7defdd56cd067b6db50127db5d51b000ccfc483b90a": { lotSize: 10, minSize: 100000, szDecimalsPow: "100000000" },
  "0x0dd1772998bb9bbb1189ef7d680353f1b97adb947b178167b03ace95dd2fcf8e": { lotSize: 10, minSize: 100000, szDecimalsPow: "10000000" },
  "0x57ba43880ee443eebd5021af91d5a8156fb3e04247c97c30912e6501c187a428": { lotSize: 10, minSize: 100000, szDecimalsPow: "10000" },
};

const apiKey = process.env.GEOMI_API_KEY_TESTNET ?? process.env.APTOS_API_KEY_TESTNET;
const aptos = new Aptos(new AptosConfig({
  network: Network.TESTNET,
  ...(apiKey ? { clientConfig: { API_KEY: apiKey } } : {}),
}));

type CheckState = "ok" | "fail" | "absent" | "pending";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Aptos verification timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "launchpad-verify", 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }
  const url = new URL(req.url);
  const sourceHashParam = url.searchParams.get("sourceHash") ?? "";
  const packageAddress = url.searchParams.get("packageAddress") ?? "";
  const indicatorParam = url.searchParams.get("indicator") ?? "";
  const pkgParam = url.searchParams.get("pkg") ?? "";
  if (
    (sourceHashParam && !SOURCE_HASH_RE.test(sourceHashParam)) ||
    (packageAddress && !isValidAptosAddress(packageAddress)) ||
    (indicatorParam && !isValidAptosAddress(indicatorParam)) ||
    (pkgParam && !isValidAptosAddress(pkgParam))
  ) {
    return NextResponse.json(
      { error: "sourceHash, packageAddress, indicator, or pkg is invalid" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const normalizedPackage = packageAddress
    ? normalizeAptosAddress(packageAddress, "packageAddress")
    : "";
  const normalizedIndicator = indicatorParam
    ? normalizeAptosAddress(indicatorParam, "indicator")
    : "";
  const normalizedPkg = pkgParam ? normalizeAptosAddress(pkgParam, "pkg") : "";

  // Resolve the registry artifact from whichever identifier was given.
  let artifact = null;
  let registryUnavailable = false;
  try {
    if (sourceHashParam) artifact = await getArtifact({ sourceHash: sourceHashParam });
    else if (normalizedPackage) artifact = await getArtifact({ packageAddress: normalizedPackage });
    else if (normalizedIndicator) artifact = await getArtifact({ indicatorAddr: normalizedIndicator });
  } catch (error) {
    registryUnavailable = true;
    console.error(
      "Strategy artifact registry lookup failed:",
      error instanceof Error ? error.message : error,
    );
  }

  const indicator = artifact?.indicatorAddr ?? normalizedIndicator;
  const pkg = normalizedPkg || LEGACY_PKG;

  // 1+2. Registry checks: recompute the source hash and re-emit the Move.
  let hash: CheckState = "absent";
  let emission: CheckState = "pending";
  let recomputedHash: string | null = null;
  let firstDiffLine: number | undefined;
  if (artifact) {
    try {
      const sizing = SIZING_BY_ADDR[artifact.marketAddr];
      const v = await verifyArtifact(artifact.sourceHash, sizing);
      hash = v.hashMatches ? "ok" : "fail";
      emission = v.emissionMatches ? "ok" : "fail";
      recomputedHash = v.recomputedHash;
      firstDiffLine = v.firstDiffLine;
    } catch {
      hash = "absent";
    }
  }

  // 3. On-chain commitment (optional): does the indicator carry a hash?
  let onChainHash: string | null = null;
  if (ADDR_RE.test(indicator)) {
    try {
      const res = await withTimeout(
        aptos.view({
          payload: { function: `${pkg}::indicator::get_creator_info`, functionArguments: [indicator] },
        }),
        5_000,
      );
      const hex = typeof res[1] === "string" ? res[1] : "";
      if (hex && hex !== "0x" && !/^0x0+$/.test(hex)) onChainHash = hex;
    } catch {
      onChainHash = null;
    }
  }

  if (!artifact && !ADDR_RE.test(indicator)) {
    if (registryUnavailable) {
      return NextResponse.json(
        {
          unavailable: true,
          reason: "artifact_registry_unavailable",
          error: "Strategy source verification is temporarily unavailable.",
        },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { error: "no registry artifact and no valid indicator address — pass sourceHash, packageAddress, or indicator" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  const verified = hash === "ok" && emission === "ok";
  return NextResponse.json({
    sourceHash: artifact?.sourceHash ?? null,
    packageAddress: artifact?.packageAddress ?? null,
    indicator: indicator || null,
    recomputedHash,
    onChainHash,
    registryUnavailable,
    checks: {
      hash,
      emission,
      ...(firstDiffLine ? { emissionFirstDiffLine: firstDiffLine } : {}),
      // Recompile pinned Move; compare module bytes vs code::PackageRegistry.
      bytecode: "pending" as CheckState,
    },
    verified,
    note: registryUnavailable
      ? "The source registry is unavailable; only the on-chain commitment is shown."
      : !artifact
      ? "No registry artifact for that identifier; only the on-chain commitment (if any) is shown."
      : verified
        ? "Verified: the stored PineScript hashes to its commitment and re-emits byte-identical Move."
        : "NOT verified — the stored source does not reproduce the deployed module (see checks).",
  }, { headers: NO_STORE_HEADERS });
}
