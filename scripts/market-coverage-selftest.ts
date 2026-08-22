/**
 * Fails when Decibel lists a market the app has no name or no logo for.
 *
 * New listings appear in the UI on their own — the markets route reads
 * `dex.markets.getAll()` — but they arrive as a bare ticker behind a grey
 * letter badge until someone adds a MARKET_LABELS entry, a TOKEN_LOGOS entry
 * and the icon file. That gap has been noticed by a person twice; this turns
 * it into a check.
 *
 * Needs a mainnet fullnode key to read the registry. Without one it skips
 * rather than fails, so CI (which holds no secrets) stays green.
 *
 *   pnpm test:market-coverage
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { MARKET_LABELS, TOKEN_LOGOS } from "@/components/trade/marketMetadata";
import { getAptosFullnodeApiKey, getReadDex } from "@/lib/decibel";

const PUBLIC_DIR = join(process.cwd(), "public");

function baseSymbol(marketName: string): string {
  return marketName.split("/")[0].toUpperCase();
}

async function main() {
  if (!getAptosFullnodeApiKey("mainnet")) {
    console.log(
      "market coverage self-test: SKIPPED (no mainnet fullnode key; set GEOMI_API_KEY to run)",
    );
    return;
  }

  const dex = getReadDex("mainnet");
  const markets = await dex.markets.getAll();
  const bases = [
    ...new Set(
      markets
        .map((market) => (market as { market_name?: string }).market_name ?? "")
        .filter(Boolean)
        .map(baseSymbol),
    ),
  ].sort();

  if (bases.length === 0) throw new Error("read zero markets from the registry");

  const labels = new Set(Object.keys(MARKET_LABELS).map((key) => key.toUpperCase()));
  const logos = new Map(
    Object.entries(TOKEN_LOGOS).map(([key, value]) => [key.toUpperCase(), value]),
  );

  const noName = bases.filter((base) => !labels.has(base));
  const noLogo = bases.filter((base) => !logos.has(base));
  const brokenLogo = bases
    .map((base) => [base, logos.get(base)] as const)
    .filter(([, path]) => path && !existsSync(join(PUBLIC_DIR, path.replace(/^\//, ""))))
    .map(([base, path]) => `${base} -> ${path}`);

  const problems: string[] = [];
  if (noName.length) problems.push(`no display name: ${noName.join(", ")}`);
  if (noLogo.length) problems.push(`no logo mapping: ${noLogo.join(", ")}`);
  if (brokenLogo.length) problems.push(`logo file missing: ${brokenLogo.join(", ")}`);

  if (problems.length) {
    console.error(`market coverage self-test: FAILED across ${bases.length} live markets`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      "\nAdd the name to MARKET_LABELS and the logo to TOKEN_LOGOS in\n" +
        "components/trade/marketMetadata.ts, and drop the icon in public/tokens.",
    );
    process.exit(1);
  }

  console.log(
    `market coverage self-test: passed (${bases.length} live markets, all named and all with an icon on disk)`,
  );
}

main().catch((error) => {
  console.error("market coverage self-test: FAILED", error?.message ?? error);
  process.exit(1);
});
