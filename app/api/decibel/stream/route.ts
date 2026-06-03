import { NextRequest, NextResponse } from "next/server";
import { getAptosFullnodeApiKey, type DecibelNetwork } from "@/lib/decibel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DECIBEL_WS_URLS: Record<DecibelNetwork, string> = {
  testnet: "wss://api.testnet.aptoslabs.com/decibel/ws",
  mainnet: "wss://api.mainnet.aptoslabs.com/decibel/ws",
};

const SSE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Connection": "keep-alive",
  "Content-Type": "text/event-stream",
  "X-Accel-Buffering": "no",
};
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

const MARKET_TOPIC_PATTERN =
  /^(all_market_prices|market_price:0x[a-fA-F0-9]+|market_candlestick:0x[a-fA-F0-9]+:(?:1m|5m|15m|30m|1h|2h|4h|8h|12h|1d|3d|1w|1mo)|trades:0x[a-fA-F0-9]+|depth:0x[a-fA-F0-9]+(?::(?:1|2|5|10|100|1000))?)$/;
const ACCOUNT_TOPIC_PATTERN =
  /^(account_open_orders|order_updates|account_positions|account_overview|user_trades|notifications|withdraw_queue|bulk_orders|bulk_order_fills|bulk_order_rejections|twap_order_updates|twap_fills|twap_rejections):0x[a-fA-F0-9]+$/;

function getNetwork(req: NextRequest): DecibelNetwork {
  return req.nextUrl.searchParams.get("network") === "mainnet"
    ? "mainnet"
    : "testnet";
}

function getTopics(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("topics") ?? "all_market_prices";
  return raw
    .split(",")
    .map((topic) => topic.trim())
    .filter((topic) => topic.length > 0)
    .filter((topic, index, all) => all.indexOf(topic) === index)
    .filter((topic) => MARKET_TOPIC_PATTERN.test(topic) || ACCOUNT_TOPIC_PATTERN.test(topic))
    .slice(0, 20);
}

function encodeSse(payload: unknown) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(req: NextRequest) {
  const network = getNetwork(req);
  const topics = getTopics(req);
  const apiKey = getAptosFullnodeApiKey(network);

  if (!apiKey) {
    return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
  }

  if (topics.length === 0) {
    return NextResponse.json(
      { error: "No valid Decibel stream topics requested" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const encoder = new TextEncoder();
  let ws: WebSocket | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const send = (payload: unknown) => enqueue(encodeSse(payload));
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (keepAlive) clearInterval(keepAlive);
        ws?.close();
        try {
          controller.close();
        } catch {
          // Stream may already be closed by the client.
        }
      };

      ws = new WebSocket(DECIBEL_WS_URLS[network], ["decibel", apiKey]);
      keepAlive = setInterval(() => enqueue(": keepalive\n\n"), 25_000);

      ws.addEventListener("open", () => {
        send({ type: "connected", network, topics });
        for (const topic of topics) {
          ws?.send(JSON.stringify({ method: "subscribe", topic }));
        }
      });

      ws.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          enqueue(`data: ${event.data}\n\n`);
          return;
        }

        send({ type: "message", data: String(event.data) });
      });

      ws.addEventListener("error", () => {
        send({ type: "error", message: "Decibel WebSocket error" });
      });

      ws.addEventListener("close", () => {
        send({ type: "closed" });
        cleanup();
      });

      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      ws?.close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
