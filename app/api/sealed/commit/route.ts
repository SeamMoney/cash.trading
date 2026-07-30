/**
 * POST /api/sealed/commit
 *
 * Transpiles a PineScript and returns ONLY its program commitment plus public
 * metadata. The source is never persisted and never echoed back — that is the
 * whole point of a sealed vault (docs/SEALED-INDICATOR.md §3.1).
 *
 * This is also the honest-rejection gate: a strategy the transpiler rejects, or
 * one whose IR the attestor could not evaluate, gets a 422 with the verbatim
 * reasons rather than a commitment it cannot stand behind.
 */
import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { commitProgram, findSealedMarket, SEALED_MARKETS } from "@/lib/sealed-vaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-commit", 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE },
    );
  }

  let body: { pineScript?: unknown; market?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  if (typeof body.pineScript !== "string") {
    return NextResponse.json({ error: "pineScript required" }, { status: 400, headers: NO_STORE });
  }
  const marketName = typeof body.market === "string" ? body.market : SEALED_MARKETS[0].name;
  const market = findSealedMarket(marketName);
  if (!market) {
    return NextResponse.json(
      { error: `unknown market "${marketName}"`, supported: SEALED_MARKETS.map((m) => m.name) },
      { status: 400, headers: NO_STORE },
    );
  }

  const result = commitProgram({ pine: body.pineScript, marketAddr: market.addr });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, errors: result.errors },
      { status: result.status, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      commitment: result.commitment,
      manifestJson: result.manifestJson,
      moduleName: result.moduleName,
      warmupBars: result.warmupBars,
      bufferCapacity: result.bufferCapacity,
      warnings: result.warnings,
      market: { name: market.name, addr: market.addr },
    },
    { status: 200, headers: NO_STORE },
  );
}
