/**
 * On-chain state reader for indicator contracts.
 *
 * GET /api/launchpad/on-chain?addr=<addr>&type=state|prices|position
 */
import { NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

export const runtime = "nodejs";

const CONTRACT = "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee";
const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));

type ViewFn = `${string}::${string}::${string}`;

async function safeView(fn: ViewFn, args: string[]) {
  return aptos.view({ payload: { function: fn, functionArguments: args } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const addr = url.searchParams.get("addr");
  const type = url.searchParams.get("type") || "state";

  if (!addr) return NextResponse.json({ error: "addr required" }, { status: 400 });

  try {
    if (type === "prices") {
      const prices = await safeView(`${CONTRACT}::indicator::get_prices`, [addr]);
      const timestamps = await safeView(`${CONTRACT}::indicator::get_timestamps`, [addr]);
      return NextResponse.json({
        prices: (prices as string[]).map((p) => Number(p) / 1e8),
        timestamps: (timestamps as string[]).map((t) => Number(t)),
      });
    }

    if (type === "position") {
      const [inPos, entry, gain, loss] = await safeView(`${CONTRACT}::indicator::get_position`, [addr]);
      return NextResponse.json({
        inPosition: inPos,
        entryPrice: Number(entry) / 1e8,
        realizedGainBps: Number(gain),
        realizedLossBps: Number(loss),
      });
    }

    // Default: full state including price buffer
    // get_signal_view returns (signal, fast_line, slow_line, last_price, last_signal_time)
    const [
      signalResult,
      statsResult,
      positionResult,
      pricesResult,
      timestampsResult,
    ] = await Promise.all([
      safeView(`${CONTRACT}::indicator::get_signal_view`, [addr]),
      safeView(`${CONTRACT}::indicator::get_stats`, [addr]),
      safeView(`${CONTRACT}::indicator::get_position`, [addr]),
      safeView(`${CONTRACT}::indicator::get_prices`, [addr]),
      safeView(`${CONTRACT}::indicator::get_timestamps`, [addr]),
    ]);

    const [sig, fast, slow, price, sigTime] = signalResult;
    const [pushed, signals, graduated] = statsResult;
    const [inPos, entry, gain, loss] = positionResult;

    return NextResponse.json({
      indicatorAddr: addr,
      signal: Number(sig),
      fastLine: Number(fast) / 1e8,
      slowLine: Number(slow) / 1e8,
      lastPrice: Number(price) / 1e8,
      lastSignalTime: Number(sigTime),
      totalPushed: Number(pushed),
      totalSignals: Number(signals),
      isGraduated: graduated as boolean,
      inPosition: inPos as boolean,
      entryPrice: Number(entry) / 1e8,
      realizedGainBps: Number(gain),
      realizedLossBps: Number(loss),
      prices: (pricesResult[0] as string[]).map((p) => Number(p) / 1e8),
      timestamps: (timestampsResult[0] as string[]).map((t) => Number(t)),
    });
  } catch (err) {
    // Indicator may not exist on-chain (mock demo address)
    return NextResponse.json({ error: String(err), onChain: false }, { status: 200 });
  }
}
