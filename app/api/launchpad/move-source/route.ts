/**
 * GET /api/launchpad/move-source?file=indicator
 * Returns the actual Move contract source code from the contracts directory.
 */
import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";

const CONTRACTS_DIR = join(process.cwd(), "contracts/indicator-launchpad/sources");

const ALLOWED_FILES: Record<string, string> = {
  indicator: "indicator.move",
  bonding_curve: "bonding_curve.move",
  backtester: "backtester.move",
  scheduled_txns: "scheduled_txns.move",
  math_lib: "math_lib.move",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const file = url.searchParams.get("file") ?? "indicator";

  const filename = ALLOWED_FILES[file];
  if (!filename) {
    return NextResponse.json({ error: `Unknown file: ${file}` }, { status: 400 });
  }

  try {
    const source = readFileSync(join(CONTRACTS_DIR, filename), "utf-8");
    return NextResponse.json({ source, filename });
  } catch {
    return NextResponse.json({ error: `Could not read ${filename}` }, { status: 500 });
  }
}
