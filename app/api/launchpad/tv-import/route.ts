import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

/**
 * GET /api/launchpad/tv-import?url=<tradingview_script_url>
 *
 * Fetches the TradingView indicator page and extracts the PineScript source.
 * TradingView embeds script source in various places in the HTML:
 *   - window.__NEXT_DATA__ JSON blob under "source" keys
 *   - JSON-LD or inline <script> tags with "scriptSource" / "pine_text"
 *   - Raw text inside <pre> or code blocks
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_URL_CHARS = 2_048;
const MAX_HTML_BYTES = 2_000_000;
const MAX_API_BYTES = 500_000;
const MAX_SOURCE_CHARS = 100_000;

function parseTradingViewScriptUrl(raw: string): URL | null {
  if (!raw || raw.length > MAX_URL_CHARS) return null;

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== "https:" ||
      (host !== "tradingview.com" && host !== "www.tradingview.com") ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !parsed.pathname.startsWith("/script/") ||
      parsed.pathname.length <= "/script/".length
    ) {
      return null;
    }

    return new URL(`${parsed.pathname}${parsed.search}`, "https://www.tradingview.com");
  } catch {
    return null;
  }
}

async function readTextWithinLimit(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("upstream_response_too_large");
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error("upstream_response_too_large");
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("upstream_response_too_large");
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "launchpad-tv-import", 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { "Cache-Control": "no-store", "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }

  const rawUrl = req.nextUrl.searchParams.get("url");

  if (!rawUrl) {
    return NextResponse.json({ error: "Missing ?url= parameter" }, { status: 400 });
  }

  const pageUrl = parseTradingViewScriptUrl(rawUrl);
  if (!pageUrl) {
    return NextResponse.json(
      { error: "URL must be a valid https://www.tradingview.com/script/... address" },
      { status: 400 },
    );
  }

  try {
    let html = "";

    // ── Strategy 0: TradingView pine-facade API ──────────────────────────────
    // Step 1: Fetch the HTML page to find the internal PUB;xxx script ID
    // Step 2: Call the pine-facade API with that ID to get the source
    {
      try {
        const pageRes = await fetch(pageUrl, {
          cache: "no-store",
          redirect: "error",
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            Accept: "text/html",
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (pageRes.ok) {
          const pageHtml = await readTextWithinLimit(pageRes, MAX_HTML_BYTES);
          html = pageHtml;
          // Extract internal PUB;xxx ID from the HTML
          const pubIdMatch = pageHtml.match(/"(PUB;[a-f0-9]+)"/);
          if (pubIdMatch) {
            const pubId = pubIdMatch[1];
            const apiRes = await fetch(
              `https://pine-facade.tradingview.com/pine-facade/get/${encodeURIComponent(pubId)}/last?no_4xx=true`,
              {
                cache: "no-store",
                redirect: "error",
                headers: {
                  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                  Origin: "https://www.tradingview.com",
                  Referer: "https://www.tradingview.com/",
                },
                signal: AbortSignal.timeout(10_000),
              },
            );
            if (apiRes.ok) {
              const data = JSON.parse(
                await readTextWithinLimit(apiRes, MAX_API_BYTES),
              ) as { source?: string; scriptName?: string; description?: string };
              if (data.source && data.source.length > 30) {
                return NextResponse.json({
                  source: cleanSource(data.source),
                  title: data.scriptName || data.description || "TradingView Indicator",
                });
              }
            }
          }
        }
      } catch {
        // API approach failed, fall through to HTML scraping
      }
    }

    // ── Fallback: HTML scraping ─────────────────────────────────────────────
    if (!html) {
      const res = await fetch(pageUrl, {
        cache: "no-store",
        redirect: "error",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        return NextResponse.json(
          { error: `TradingView returned HTTP ${res.status}` },
          { status: 502 },
        );
      }

      html = await readTextWithinLimit(res, MAX_HTML_BYTES);
    }

    // Extract title from <title> or og:title
    let title = "Untitled Indicator";
    const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
    if (ogTitle) {
      title = decodeHtmlEntities(ogTitle[1]);
    } else {
      const titleTag = html.match(/<title>([^<]+)<\/title>/);
      if (titleTag) {
        title = decodeHtmlEntities(titleTag[1]).replace(/ — Indicator by .+$/, "").replace(/ — TradingView$/, "");
      }
    }

    // ── Strategy 1: __NEXT_DATA__ JSON blob ──────────────────────────────────
    const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const json = JSON.parse(nextDataMatch[1]);
        const source = findSourceInObject(json);
        if (source && source.length > 30) {
          return NextResponse.json({ source: cleanSource(source), title });
        }
      } catch {
        // JSON parse failed, continue to other strategies
      }
    }

    // ── Strategy 2: "scriptSource":"..." or "source":"..." in any script tag ─
    const scriptSourcePatterns = [
      /"scriptSource"\s*:\s*"((?:[^"\\]|\\.)*)"/,
      /"pine_text"\s*:\s*"((?:[^"\\]|\\.)*)"/,
      /"source"\s*:\s*"((?:[^"\\]|\\.)*\/\/@version(?:[^"\\]|\\.)*)"/,
      /"scriptSource"\s*:\s*'((?:[^'\\]|\\.)*)'/,
    ];

    for (const pattern of scriptSourcePatterns) {
      const match = html.match(pattern);
      if (match && match[1].length > 30) {
        const decoded = match[1]
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
        return NextResponse.json({ source: cleanSource(decoded), title });
      }
    }

    // ── Strategy 3: Look for PineScript in <pre> or code blocks ──────────────
    const preBlocks = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/gi) ?? [];
    for (const block of preBlocks) {
      const inner = block.replace(/<\/?[^>]+>/g, "");
      const decoded = decodeHtmlEntities(inner);
      if (decoded.includes("//@version") || decoded.includes("strategy(") || decoded.includes("indicator(")) {
        return NextResponse.json({ source: cleanSource(decoded), title });
      }
    }

    // ── Strategy 4: data-script-id-part or large text blocks with Pine markers
    const codeBlocks = html.match(/<code[^>]*>([\s\S]*?)<\/code>/gi) ?? [];
    for (const block of codeBlocks) {
      const inner = block.replace(/<\/?[^>]+>/g, "");
      const decoded = decodeHtmlEntities(inner);
      if (decoded.includes("//@version") || decoded.includes("strategy(") || decoded.includes("indicator(")) {
        return NextResponse.json({ source: cleanSource(decoded), title });
      }
    }

    // ── Strategy 5: Broad regex for anything that looks like PineScript ───────
    const broadMatch = html.match(/\/\/@version=\d[\s\S]{50,5000}?(?:strategy\.(?:entry|close)|plot\(|alertcondition\()/);
    if (broadMatch) {
      // Try to extract a clean block around it
      const start = html.indexOf(broadMatch[0]);
      // Find the enclosing quotes or tag
      let end = start + broadMatch[0].length;
      // Extend to the next quote boundary or tag close
      const remaining = html.slice(end, end + 5000);
      const endBoundary = remaining.search(/["'<]/);
      if (endBoundary > 0) {
        end += endBoundary;
      }
      const raw = html.slice(start, end)
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
      if (raw.length > 50) {
        return NextResponse.json({ source: cleanSource(raw), title });
      }
    }

    // ── All strategies failed ────────────────────────────────────────────────
    return NextResponse.json(
      {
        error:
          "Could not extract PineScript source from this page. " +
          "The script may be private or require login. " +
          "Try opening the indicator page in TradingView, click the source code icon (</>), " +
          "copy the PineScript, and paste it directly into the editor.",
      },
      { status: 422 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("timeout") || message.includes("abort")) {
      return NextResponse.json(
        { error: "Request to TradingView timed out. Try again." },
        { status: 504 },
      );
    }
    if (message === "upstream_response_too_large") {
      return NextResponse.json(
        { error: "TradingView returned more data than this importer accepts." },
        { status: 502 },
      );
    }
    if (message === "pine_source_too_large") {
      return NextResponse.json(
        { error: `PineScript source exceeds the ${MAX_SOURCE_CHARS.toLocaleString()} character limit.` },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: "Failed to fetch TradingView page." },
      { status: 502 },
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ");
}

function cleanSource(source: string): string {
  const cleaned = source.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (cleaned.length > MAX_SOURCE_CHARS) throw new Error("pine_source_too_large");
  return cleaned;
}

/**
 * Recursively search a JSON object for a string value that looks like PineScript.
 * Prioritizes keys named "source", "scriptSource", "pine_text", "pineCode".
 */
function findSourceInObject(obj: unknown, depth = 0): string | null {
  if (depth > 15) return null;
  if (typeof obj === "string") {
    if (obj.includes("//@version") || (obj.includes("strategy(") && obj.length > 100)) {
      return obj;
    }
    return null;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findSourceInObject(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (obj && typeof obj === "object") {
    // Check priority keys first
    const priorityKeys = ["source", "scriptSource", "pine_text", "pineCode", "script_source"];
    for (const key of priorityKeys) {
      if (key in (obj as Record<string, unknown>)) {
        const val = (obj as Record<string, unknown>)[key];
        if (typeof val === "string" && val.length > 30 && (val.includes("//@version") || val.includes("strategy("))) {
          return val;
        }
      }
    }
    // Then recurse all keys
    for (const val of Object.values(obj as Record<string, unknown>)) {
      const found = findSourceInObject(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}
