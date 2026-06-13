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
import { NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { getArtifact, verifyArtifact } from "@/lib/strategy-artifacts";

export const runtime = "nodejs";

const LEGACY_PKG = "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee";
const ADDR_RE = /^0x[0-9a-fA-F]{1,64}$/;

// marketAddr → engine sizing constants (baked into the emitted vault module, so
// re-emission must use the same ones). Mirrors deploy-vault's MARKETS.
const SIZING_BY_ADDR: Record<string, { lotSize: number; minSize: number; szDecimalsPow: string }> = {
  "0x6e9c93c836abebdcf998a7defdd56cd067b6db50127db5d51b000ccfc483b90a": { lotSize: 10, minSize: 100000, szDecimalsPow: "100000000" },
  "0x0dd1772998bb9bbb1189ef7d680353f1b97adb947b178167b03ace95dd2fcf8e": { lotSize: 10, minSize: 100000, szDecimalsPow: "10000000" },
  "0x57ba43880ee443eebd5021af91d5a8156fb3e04247c97c30912e6501c187a428": { lotSize: 10, minSize: 100000, szDecimalsPow: "10000" },
};

const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));

type CheckState = "ok" | "fail" | "absent" | "pending";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sourceHashParam = url.searchParams.get("sourceHash") ?? "";
  const packageAddress = url.searchParams.get("packageAddress") ?? "";
  const indicatorParam = url.searchParams.get("indicator") ?? "";
  const pkgParam = url.searchParams.get("pkg") ?? "";

  // Resolve the registry artifact from whichever identifier was given.
  let artifact = null;
  try {
    if (sourceHashParam) artifact = await getArtifact({ sourceHash: sourceHashParam });
    else if (ADDR_RE.test(packageAddress)) artifact = await getArtifact({ packageAddress });
    else if (ADDR_RE.test(indicatorParam)) artifact = await getArtifact({ indicatorAddr: indicatorParam });
  } catch {
    artifact = null;
  }

  const indicator = artifact?.indicatorAddr ?? (ADDR_RE.test(indicatorParam) ? indicatorParam : "");
  const pkg = ADDR_RE.test(pkgParam) ? pkgParam : LEGACY_PKG;

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
      const res = await aptos.view({
        payload: { function: `${pkg}::indicator::get_creator_info`, functionArguments: [indicator] },
      });
      const hex = typeof res[1] === "string" ? res[1] : "";
      if (hex && hex !== "0x" && !/^0x0+$/.test(hex)) onChainHash = hex;
    } catch {
      onChainHash = null;
    }
  }

  if (!artifact && !ADDR_RE.test(indicator)) {
    return NextResponse.json(
      { error: "no registry artifact and no valid indicator address — pass sourceHash, packageAddress, or indicator" },
      { status: 404 },
    );
  }

  const verified = hash === "ok" && emission === "ok";
  return NextResponse.json({
    sourceHash: artifact?.sourceHash ?? null,
    packageAddress: artifact?.packageAddress ?? null,
    indicator: indicator || null,
    recomputedHash,
    onChainHash,
    checks: {
      hash,
      emission,
      ...(firstDiffLine ? { emissionFirstDiffLine: firstDiffLine } : {}),
      // Recompile pinned Move; compare module bytes vs code::PackageRegistry.
      bytecode: "pending" as CheckState,
    },
    verified,
    note: !artifact
      ? "No registry artifact for that identifier; only the on-chain commitment (if any) is shown."
      : verified
        ? "Verified: the stored PineScript hashes to its commitment and re-emits byte-identical Move."
        : "NOT verified — the stored source does not reproduce the deployed module (see checks).",
  });
}
