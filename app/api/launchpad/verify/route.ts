/**
 * Strategy-source verification (docs/SHELBY-PIN.md).
 *
 * GET /api/launchpad/verify?indicator=0x…[&pkg=0x…]
 *
 * Full verification needs the Shelby-pinned artifacts (canonical Pine, emitted
 * Move, build manifest). Until the backend's Shelby upload + registry column
 * land, this returns the on-chain commitment honestly with the remaining
 * checks marked "pending" — no fake green badges.
 */
import { NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

export const runtime = "nodejs";

const LEGACY_PKG = "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee";
const ADDR_RE = /^0x[0-9a-fA-F]{1,64}$/;

const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));

type CheckState = "ok" | "fail" | "absent" | "pending";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const indicator = url.searchParams.get("indicator") ?? "";
  const pkgParam = url.searchParams.get("pkg") ?? "";
  const pkg = ADDR_RE.test(pkgParam) ? pkgParam : LEGACY_PKG;

  if (!ADDR_RE.test(indicator)) {
    return NextResponse.json({ error: "indicator must be a 0x hex address" }, { status: 400 });
  }

  // On-chain commitment: get_creator_info returns
  // (is_proprietary, algo_hash, creator_fee_bps, creator_fee_model, creator_earnings)
  let onChainHash: string | null = null;
  let hashCheck: CheckState = "absent";
  try {
    const res = await aptos.view({
      payload: {
        function: `${pkg}::indicator::get_creator_info`,
        functionArguments: [indicator],
      },
    });
    const raw = res[1];
    const hex = typeof raw === "string" ? raw : "";
    if (hex && hex !== "0x" && !/^0x0+$/.test(hex)) {
      onChainHash = hex;
      hashCheck = "pending"; // committed on-chain; artifacts needed to recompute
    }
  } catch {
    return NextResponse.json(
      { error: "indicator not found on-chain for that package", indicator, pkg },
      { status: 404 },
    );
  }

  return NextResponse.json({
    indicator,
    pkg,
    onChainHash,
    checks: {
      // sha3_256(pine || 0x00 || move || 0x00 || manifest) vs onChainHash —
      // needs the Shelby artifacts (backend: upload client + shelbyUri column).
      hash: hashCheck,
      // Re-run pinned-version transpiler on the Pine, diff against pinned Move.
      emission: "pending" as CheckState,
      // Recompile pinned Move; compare module bytes vs code::PackageRegistry.
      bytecode: "pending" as CheckState,
    },
    verified: false,
    note: onChainHash
      ? "Commitment found on-chain; full verification awaits Shelby-pinned artifacts."
      : "No source commitment set for this indicator (set_proprietary was never called).",
  });
}
