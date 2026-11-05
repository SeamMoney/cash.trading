import { compilePineToSolana } from "../../../../lib/pine-solana/compiler";
import { validateCompileOptions } from "../../../../lib/pine-solana/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BODY_LIMIT = 160_000;

/** Pure source generation: no database writes, RPC calls, wallets, publishing or funds. */
export async function POST(request: Request): Promise<Response> {
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "A JSON request body is required" }, { status: 400 });
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.length;
      if (bytes > BODY_LIMIT) { await reader.cancel(); return Response.json({ error: "Request exceeds 160000 bytes" }, { status: 413 }); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.pineScript !== "string") return Response.json({ error: "pineScript must be a string" }, { status: 400 });
    for (const key of Object.keys(body)) if (!["pineScript", "options"].includes(key)) return Response.json({ error: `Unknown request field ${key}` }, { status: 400 });
    const result = compilePineToSolana(body.pineScript, validateCompileOptions(body.options));
    return Response.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid compile request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  } finally { reader.releaseLock(); }
}
