import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

/** Circle's native USDC mint on Solana mainnet. */
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/**
 * Public RPCs in preference order. Solana's own endpoint aggressively 403s and
 * 429s browser and cloud traffic — which is exactly why this proxy exists: the
 * client-side balance read failed on real phones while the UI showed
 * "No Solana USDC found" for what was actually a dead lookup.
 */
const RPC_ENDPOINTS = [
  process.env.SOLANA_RPC_URL,
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
].filter((value): value is string => Boolean(value));

async function rpcCall<T>(endpoint: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(6_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${method} ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || `${method} rpc error`);
  return body.result as T;
}

/**
 * GET /api/solana/usdc?owner=<base58>
 * → { balance, tokenAccount, blockhash } — everything the client-side burn
 * builder needs, in one round trip, from whichever RPC answers first.
 */
export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "solana-usdc", 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) } },
    );
  }

  const owner = req.nextUrl.searchParams.get("owner") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) {
    return NextResponse.json(
      { error: "owner must be a base58 Solana address" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let lastError = "no rpc endpoints configured";
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const accounts = await rpcCall<{
        value?: Array<{
          pubkey: string;
          account?: { data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } } };
        }>;
      }>(endpoint, "getTokenAccountsByOwner", [
        owner,
        { mint: SOLANA_USDC_MINT },
        { encoding: "jsonParsed" },
      ]);

      let balance = 0;
      let tokenAccount: string | null = null;
      let best = -1;
      for (const entry of accounts?.value ?? []) {
        const amount = entry.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
        if (typeof amount === "number" && Number.isFinite(amount)) {
          balance += amount;
          if (amount > best) {
            best = amount;
            tokenAccount = entry.pubkey;
          }
        }
      }

      const latest = await rpcCall<{ value?: { blockhash?: string } }>(endpoint, "getLatestBlockhash", [
        { commitment: "confirmed" },
      ]);
      const blockhash = latest?.value?.blockhash ?? null;

      return NextResponse.json(
        { balance, tokenAccount, blockhash },
        { headers: NO_STORE_HEADERS },
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return NextResponse.json(
    { error: `All Solana RPCs failed: ${lastError}` },
    { status: 502, headers: NO_STORE_HEADERS },
  );
}
