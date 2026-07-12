import { signalBuffer, sseSubscribers } from "../route";

export const runtime = "nodejs";

/**
 * GET /api/launchpad/signals/stream?indicators=addr1,addr2
 * Server-Sent Events stream — emits signals for watched indicators in real-time.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const watched = new Set((url.searchParams.get("indicators") || "").split(",").filter(Boolean));

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();

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
          if (watched.size === 0 || watched.has(parsed.indicatorAddr)) {
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
      });
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
