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
import { AccountAddress, createResourceAddress } from "@aptos-labs/ts-sdk";
import {
  checkRateLimit,
  compilePineVault,
  isCompileServiceAvailable,
  publishPineVault,
} from "@/lib/move-compile-service";
import { transpileV3, TRANSPILER_VERSION } from "@/lib/launchpad/transpiler-v3";
import { checkEquivalence } from "@/lib/strategy-equivalence";
import { storeArtifact, getArtifact } from "@/lib/strategy-artifacts";
import { getDecibelApiKey, resolveMarketAddress } from "@/lib/decibel-market-resolve";

export const runtime = "nodejs";
export const maxDuration = 300;

const DECIBEL_MAINNET_CANDLES = "https://api.mainnet.aptoslabs.com/decibel/api/v1/candlesticks";

/** Best-effort historical closes for the equivalence gate, by market NAME.
 *  Uses MAINNET candles (deep history) regardless of deploy network — the
 *  gate checks Pine-vs-Move math fidelity, which is venue-independent, and
 *  testnet candle history is too sparse to compare meaningfully. Returns []
 *  on any failure so a candle hiccup degrades equivalence to "unknown".  */
async function fetchClosesByName(marketName: string): Promise<number[]> {
  const key = getDecibelApiKey();
  if (!key) return [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const addr = await resolveMarketAddress(marketName, key, ctrl.signal);
    if (!addr) { clearTimeout(t); return []; }
    const end = Date.now();
    const start = end - 500 * 3_600_000; // 500 hourly bars
    const params = new URLSearchParams({ market: addr, interval: "1h", startTime: String(start), endTime: String(end) });
    const res = await fetch(`${DECIBEL_MAINNET_CANDLES}?${params}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .map((c) => (typeof c === "object" && c && typeof (c as { c: number }).c === "number" ? (c as { c: number }).c : NaN))
      .filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

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
    if (!result.ok) {
      // Verbatim errors pass through — never softened.
      return NextResponse.json(result, { status: 422 });
    }

    // Equivalence gate: replay the strategy over real candles with both math
    // backends (bigint Move-mirror vs float Pine) and diff the signals. A
    // divergence means the deployed vault would trade differently than the
    // backtest. Best-effort: a candle-API failure degrades to "unknown".
    let equivalence: ReturnType<typeof checkEquivalence> | null = null;
    try {
      const t = transpileV3(pineScript, creatorAddr, {
        target: "vault",
        marketAddr: market.addr,
        lotSize: market.lotSize,
        minSize: market.minSize,
        szDecimalsPow: market.szDecimalsPow,
      }) as { ir: Parameters<typeof checkEquivalence>[0] };
      const closes = await fetchClosesByName(marketName);
      if (closes.length >= 100) equivalence = checkEquivalence(t.ir, closes);
    } catch {
      equivalence = null;
    }

    // Persist the verifiability record (best-effort — never block deploy on DB).
    try {
      await storeArtifact({
        sourceHash: result.sourceHash,
        pineScript,
        moveSource: result.moveSource,
        marketAddr: market.addr,
        transpilerVersion: TRANSPILER_VERSION,
        equivalenceReport: equivalence ? JSON.stringify(equivalence) : null,
      });
    } catch (err) {
      console.error("[deploy-vault] storeArtifact (compile) failed:", err instanceof Error ? err.message : err);
    }

    return NextResponse.json({ ...result, equivalence }, { status: 200 });
  }

  if (body.step === "publish") {
    const moveSource = typeof body.moveSource === "string" ? body.moveSource : "";
    const moduleName = typeof body.moduleName === "string" ? body.moduleName : "";
    const sourceHash = typeof body.sourceHash === "string" ? body.sourceHash : "";
    if (!moveSource || !moduleName) {
      return NextResponse.json({ ok: false, error: "moveSource and moduleName required" }, { status: 400 });
    }

    // Hard equivalence gate: refuse to publish a strategy that provably diverges
    // from its backtest. Unknown/absent reports do not block (candle-API hiccup).
    if (sourceHash) {
      try {
        const artifact = await getArtifact({ sourceHash });
        if (artifact?.equivalenceReport) {
          const report = JSON.parse(artifact.equivalenceReport) as { equivalent: boolean; divergences?: unknown[] };
          if (report.equivalent === false) {
            return NextResponse.json(
              { ok: false, error: "Strategy failed the equivalence gate — the on-chain module would trade differently than the backtest. Not publishing.", divergences: report.divergences?.slice(0, 5) },
              { status: 422 },
            );
          }
        }
      } catch {
        // No artifact / unparseable report → proceed (gate is best-effort).
      }
    }

    const result = await publishPineVault({ moveSource, moduleName, network: "testnet" });
    if (result.ok && result.packageAddress && sourceHash) {
      // Indicator resource-account address is deterministic from the package.
      let indicatorAddr: string | undefined;
      try {
        indicatorAddr = createResourceAddress(AccountAddress.from(result.packageAddress), moduleName).toString();
      } catch { /* leave undefined */ }
      try {
        await storeArtifact({
          sourceHash,
          packageAddress: result.packageAddress,
          publishTxHash: result.txHash ?? null,
          indicatorAddr: indicatorAddr ?? null,
        });
      } catch (err) {
        console.error("[deploy-vault] storeArtifact (publish) failed:", err instanceof Error ? err.message : err);
      }
      return NextResponse.json({ ...result, indicatorAddr }, { status: 200 });
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  }

  if (body.step === "register") {
    // Called by the rail after the wallet runs create_strategy_vault + delegate.
    // Recording the binding makes the live fly crank auto-tick this vault within
    // one interval (DATA-NEEDS item E).
    const sourceHash = typeof body.sourceHash === "string" ? body.sourceHash : "";
    const strategyVaultAddr = typeof body.strategyVaultAddr === "string" ? body.strategyVaultAddr : "";
    // sourceHash is an opaque sha3 hash (only require non-empty); the vault addr is 0x.
    if (!sourceHash || !/^0x[0-9a-fA-F]{1,64}$/.test(strategyVaultAddr)) {
      return NextResponse.json({ ok: false, error: "sourceHash and 0x strategyVaultAddr required" }, { status: 400 });
    }
    try {
      const updated = await storeArtifact({ sourceHash, strategyVaultAddr });
      return NextResponse.json({ ok: true, strategyVaultAddr: updated.strategyVaultAddr, packageAddress: updated.packageAddress }, { status: 200 });
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "register failed" }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: false, error: 'step must be "compile", "publish", or "register"' }, { status: 400 });
}
