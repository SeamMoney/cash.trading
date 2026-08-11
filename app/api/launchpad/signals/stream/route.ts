import { NextRequest, NextResponse } from "next/server";

import { isProprietarySignalIndicator } from "../route";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { isValidAptosAddress, normalizeAptosAddress } from "@/lib/decibel";
import {
  getLaunchpadSignalHistory,
  getLaunchpadSignalsAfter,
  type StoredLaunchpadSignal,
} from "@/lib/launchpad/signals-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};
const HISTORY_PER_CONNECTION = 10;
const MAX_POLL_BATCH = 500;
const POLL_INTERVAL_MS = 3_000;

function signalPayload(signal: StoredLaunchpadSignal, historical = false): string {
  const { id: _id, ...entry } = signal;
  return JSON.stringify(historical ? { ...entry, historical: true } : entry);
}

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

  const watchedIndicators = [...watched];
  let history: StoredLaunchpadSignal[];
  try {
    history = await getLaunchpadSignalHistory(
      watchedIndicators,
      HISTORY_PER_CONNECTION,
    );
  } catch (error) {
    console.error("[launchpad-signal-stream] history read failed:", error);
    return NextResponse.json(
      { error: "Signal stream is temporarily unavailable" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      let cursorId = history.at(-1)?.id ?? 0n;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let keepalive: ReturnType<typeof setInterval> | null = null;

      cleanup = () => {
        if (closed) return;
        closed = true;
        if (keepalive) clearInterval(keepalive);
        if (pollTimer) clearTimeout(pollTimer);
        try { controller.close(); } catch { /* already closed */ }
      };

      const enqueue = (value: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(enc.encode(value));
          return true;
        } catch {
          cleanup();
          return false;
        }
      };

      enqueue("retry: 5000\n\n");
      for (const signal of history) {
        enqueue(`data: ${signalPayload(signal, true)}\n\n`);
      }

      keepalive = setInterval(() => {
        enqueue(": keepalive\n\n");
      }, 15000);

      const poll = async () => {
        if (closed) return;
        try {
          const signals = await getLaunchpadSignalsAfter(
            watchedIndicators,
            cursorId,
            MAX_POLL_BATCH,
          );
          for (const signal of signals) {
            if (!enqueue(`data: ${signalPayload(signal)}\n\n`)) return;
            cursorId = signal.id;
          }
        } catch (error) {
          console.error("[launchpad-signal-stream] polling failed:", error);
          enqueue('event: status\ndata: {"error":"Signal updates are temporarily delayed"}\n\n');
        } finally {
          if (!closed) pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      };

      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      req.signal.addEventListener("abort", cleanup, { once: true });
      if (req.signal.aborted) cleanup();
    },
    cancel() {
      cleanup();
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
