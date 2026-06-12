/**
 * Deploy-from-UI: compile + publish a user's PineScript as a trustless
 * strategy-vault module (docs/DEPLOY-FROM-UI.md).
 *
 * POST /api/launchpad/deploy-vault
 *   { step: "compile", pineScript, marketName, creatorAddr? }
 *     → { ok, sourceHash, moduleName, moveSource } |
 *       { ok:false, transpileErrors?/compilerError? }  (verbatim, never softened)
 *   { step: "publish", moveSource, moduleName }
 *     → { ok, packageAddress, txHash } | { ok:false, error }
 *
 * Truthfulness contract:
 * - 501 when the deployment has no `aptos` CLI (Vercel prod today) — the UI
 *   must present deploy-from-UI as local/self-hosted-only, not as broken.
 * - 429 with retryAfterS when rate-limited.
 * - Compiles are serialized server-side and take ~95s cold / ms cached — the
 *   client should show honest progress, not a fake quick spinner.
 *
 * GET — availability + market list for the picker.
 */
import { NextResponse } from "next/server";
import {
  checkRateLimit,
  compilePineVault,
  isCompileServiceAvailable,
  publishPineVault,
} from "@/lib/move-compile-service";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Testnet perp markets the vault target can bind to (mirror of the Deploy
 *  tab's VAULT_MARKETS — server-side copy so the API is self-contained). */
const MARKETS: Record<string, { addr: string; lotSize: number; minSize: number; szDecimalsPow: string }> = {
  "BTC/USD": {
    addr: "0x6e9c93c836abebdcf998a7defdd56cd067b6db50127db5d51b000ccfc483b90a",
    lotSize: 10, minSize: 100000, szDecimalsPow: "100000000",
  },
  "ETH/USD": {
    addr: "0x0dd1772998bb9bbb1189ef7d680353f1b97adb947b178167b03ace95dd2fcf8e",
    lotSize: 10, minSize: 100000, szDecimalsPow: "10000000",
  },
  "APT/USD": {
    addr: "0x57ba43880ee443eebd5021af91d5a8156fb3e04247c97c30912e6501c187a428",
    lotSize: 10, minSize: 100000, szDecimalsPow: "10000",
  },
};

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : "local") || "local";
}

export async function GET() {
  const available = await isCompileServiceAvailable();
  return NextResponse.json({
    available,
    markets: Object.keys(MARKETS),
    note: available
      ? "Compile service ready (testnet publishes, deployer-paid)."
      : "Compile service unavailable on this deployment — deploy-from-UI runs locally/self-hosted only for now.",
  });
}

export async function POST(req: Request) {
  if (!(await isCompileServiceAvailable())) {
    return NextResponse.json(
      { ok: false, error: "Compile service unavailable on this deployment (no aptos CLI). Run locally or self-hosted for deploy-from-UI." },
      { status: 501 },
    );
  }

  const limit = checkRateLimit(clientKey(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limited", retryAfterS: limit.retryAfterS },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterS ?? 60) } },
    );
  }

  const body = await req.json().catch(() => ({}));

  if (body.step === "compile") {
    const pineScript = typeof body.pineScript === "string" ? body.pineScript : "";
    const marketName = typeof body.marketName === "string" ? body.marketName : "BTC/USD";
    const market = MARKETS[marketName];
    if (!pineScript.trim()) {
      return NextResponse.json({ ok: false, error: "pineScript required" }, { status: 400 });
    }
    if (!market) {
      return NextResponse.json(
        { ok: false, error: `Unknown market '${marketName}'. Available: ${Object.keys(MARKETS).join(", ")}` },
        { status: 400 },
      );
    }
    const creatorAddr =
      typeof body.creatorAddr === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(body.creatorAddr)
        ? body.creatorAddr
        : "0xcreator";

    const result = await compilePineVault({
      pineScript,
      creatorAddr,
      marketAddr: market.addr,
      lotSize: market.lotSize,
      minSize: market.minSize,
      szDecimalsPow: market.szDecimalsPow,
    });
    // Verbatim errors pass through — sourceHash is the SHELBY-PIN commitment input.
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  }

  if (body.step === "publish") {
    const moveSource = typeof body.moveSource === "string" ? body.moveSource : "";
    const moduleName = typeof body.moduleName === "string" ? body.moduleName : "";
    if (!moveSource || !moduleName) {
      return NextResponse.json({ ok: false, error: "moveSource and moduleName required" }, { status: 400 });
    }
    const result = await publishPineVault({ moveSource, moduleName, network: "testnet" });
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  }

  return NextResponse.json({ ok: false, error: 'step must be "compile" or "publish"' }, { status: 400 });
}
