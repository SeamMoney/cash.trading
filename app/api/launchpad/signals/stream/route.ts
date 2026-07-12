import { NextRequest, NextResponse } from "next/server";

import {
  isProprietarySignalIndicator,
  signalBuffer,
  sseSubscribers,
} from "../route";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { isValidAptosAddress, normalizeAptosAddress } from "@/lib/decibel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

/**
 * GET /api/launchpad/signals/stream?indicators=addr1,addr2
 * Server-Sent Events stream — emits signals for watched indicators in real-time.
 */
export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "launchpad-signal-stream", 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }

  const url = new URL(req.url);
  const requested = (url.searchParams.get("indicators") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    requested.length < 1 ||
    requested.length > 32 ||
    requested.some((value) => !isValidAptosAddress(value))
  ) {
    return NextResponse.json(
      { error: "indicators must contain 1 to 32 valid Aptos addresses" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const watched = new Set(
    requested.map((value) => normalizeAptosAddress(value, "indicator")),
  );
  if ([...watched].some(isProprietarySignalIndicator)) {
    return NextResponse.json(
      {
        unavailable: true,
        reason: "paid_signal_delivery_not_configured",
        error: "Authenticated paid signal delivery is not configured.",
      },
      { status: 501, headers: NO_STORE_HEADERS },
    );
  }

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode("retry: 5000\n\n"));

      // Send recent history on connect
      for (const addr of watched) {
        const buf = signalBuffer.get(addr) || [];
        const recent = buf.slice(-10);
        for (const s of recent) {
          const payload = JSON.stringify({ indicatorAddr: addr, ...s, historical: true });
          controller.enqueue(enc.encode(`data: ${payload}\n\n`));
        }
      }

      // Send keepalive every 15s
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
        }
      }, 15000);

      // Subscribe to new signals
      function onSignal(data: string) {
        try {
          const parsed = JSON.parse(data) as { indicatorAddr: string };
          if (watched.has(parsed.indicatorAddr)) {
            controller.enqueue(enc.encode(`data: ${data}\n\n`));
          }
        } catch {
          // ignore
        }
      }
      sseSubscribers.add(onSignal);

      // Poll the authenticated delivery buffer for entries written in this instance.
      const lastSeen = new Map<string, number>();
      for (const addr of watched) {
        lastSeen.set(addr, (signalBuffer.get(addr) || []).length);
      }
      const poll = setInterval(() => {
        for (const addr of watched) {
          const buf = signalBuffer.get(addr) || [];
          const prev = lastSeen.get(addr) || 0;
          if (buf.length > prev) {
            for (let i = prev; i < buf.length; i++) {
              const payload = JSON.stringify({ indicatorAddr: addr, ...buf[i] });
              try {
                controller.enqueue(enc.encode(`data: ${payload}\n\n`));
              } catch {
                // stream closed
              }
            }
            lastSeen.set(addr, buf.length);
          }
        }
      }, 1000);

      // Cleanup on close
      req.signal.addEventListener("abort", () => {
        clearInterval(keepalive);
        clearInterval(poll);
        sseSubscribers.delete(onSignal);
        try { controller.close(); } catch { /* already closed */ }
      }, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
