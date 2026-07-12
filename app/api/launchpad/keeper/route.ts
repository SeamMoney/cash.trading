/**
 * Keeper API — Pushes live Pyth prices to all deployed on-chain indicator Objects.
 *
 * GET  /api/launchpad/keeper          — Cron-triggered sweep (every 60s via vercel.json)
 *   Vercel sends: Authorization: Bearer <CRON_SECRET>
 *   Discovers all indicators from factory, fetches Pyth price per asset, pushes on-chain.
 *   Returns: { results: [...], totalPushed, signalChanges }
 *
 * POST /api/launchpad/keeper          — Manual / frontend push for a single indicator
 *   Body: { indicatorAddr, asset, executeOnDecibel?, decibelMarket?, decibelSize? }
 *   Returns: { txHash, price, signal, timestamp }
 */
import { NextResponse } from "next/server";
import {
  Aptos,
  AptosConfig,
  Network,
  Account,
  Ed25519PrivateKey,
} from "@aptos-labs/ts-sdk";
import { PYTH_HERMES_URL, PYTH_FEED_IDS } from "@/lib/launchpad/constants";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const CONTRACT = "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee";
const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));

// Track the last known signal per indicator address across sweeps.
// This lets Phase 2 detect actual crossovers instead of firing on every sweep.
const lastKnownSignals = new Map<string, number>();

function getOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${process.env.PORT ?? "3001"}`;
}

// ── Pyth price fetch ─────────────────────────────────────────────────────────

async function fetchPythPrice(asset: string): Promise<{ price: bigint; timestamp: number }> {
  const feedId = PYTH_FEED_IDS[asset];
  if (!feedId) throw new Error(`No feed ID for asset: ${asset}`);

  const url = `${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Pyth Hermes error ${res.status}`);

  const data = await res.json() as {
    parsed: Array<{
      price: { price: string; expo: number; publish_time: number };
    }>;
  };

  const parsed = data.parsed?.[0];
  if (!parsed) throw new Error("No price data from Pyth");

  const rawPrice = BigInt(parsed.price.price);
  const expo = parsed.price.expo;        // typically -8
  const publishTime = parsed.price.publish_time;

  // Normalize to 1e8 scale (USD * 1e8) — what the Move contract expects
  // expo=-8: no-op; expo=-7: multiply by 10; expo=-9: divide by 10
  const targetExpo = -8;
  const expoDiff = expo - targetExpo;
  let priceScaled: bigint;
  if (expoDiff >= 0) {
    priceScaled = rawPrice * (10n ** BigInt(expoDiff));
  } else {
    priceScaled = rawPrice / (10n ** BigInt(-expoDiff));
  }

  return { price: priceScaled, timestamp: publishTime };
}

// ── Build keeper account from env ────────────────────────────────────────────

function getKeeperAccount(): Account {
  const keyHex = process.env.LAUNCHPAD_KEEPER_KEY ?? process.env.BOT_OPERATOR_PRIVATE_KEY;
  if (!keyHex) {
    throw new Error("LAUNCHPAD_KEEPER_KEY or BOT_OPERATOR_PRIVATE_KEY not configured");
  }
  const cleanKey = keyHex
    .replace("ed25519-priv-", "")
    .replace(/\\n/g, "")
    .replace(/\n/g, "")
    .trim();
  return Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(cleanKey) });
}

// ── Push a single price on-chain, return new signal ─────────────────────────

async function pushPriceOnChain(
  keeperAccount: Account,
  indicatorAddr: string,
  price: bigint,
  timestamp: number,
): Promise<string> {
  const txn = await aptos.transaction.build.simple({
    sender: keeperAccount.accountAddress,
    data: {
      function: `${CONTRACT}::indicator::push_price` as `${string}::${string}::${string}`,
      functionArguments: [indicatorAddr, price.toString(), timestamp.toString()],
    },
    options: {
      maxGasAmount: 100_000,
      gasUnitPrice: 100,
    },
  });

  const senderAuth = aptos.transaction.sign({ signer: keeperAccount, transaction: txn });
  const committed = await aptos.transaction.submit.simple({
    transaction: txn,
    senderAuthenticator: senderAuth,
  });
  await aptos.waitForTransaction({ transactionHash: committed.hash });

  return committed.hash;
}

// ── Read current signal from on-chain state ──────────────────────────────────

async function readSignal(indicatorAddr: string): Promise<number> {
  try {
    const result = await aptos.view({
      payload: {
        function: `${CONTRACT}::indicator::get_signal_view` as `${string}::${string}::${string}`,
        functionArguments: [indicatorAddr],
      },
    });
    return Number(result[0]);
  } catch {
    return -1;
  }
}

// ── GET — cron-triggered full sweep ─────────────────────────────────────────

export async function GET(req: Request) {
  // Verify Vercel cron secret so random internet traffic can't trigger this
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "Keeper cron is not configured" }, { status: 503 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[keeper] cron sweep started");

  let keeperAccount: Account;
  try {
    keeperAccount = getKeeperAccount();
  } catch (err) {
    console.error("[keeper] missing key:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  // 1. Discover all indicator Object addresses from factory
  let indicatorAddrs: string[] = [];
  try {
    const result = await aptos.view({
      payload: {
        function: `${CONTRACT}::indicator::get_all_indicators` as `${string}::${string}::${string}`,
        functionArguments: [],
      },
    });
    // get_all_indicators returns vector<address> — SDK unwraps as string[]
    indicatorAddrs = (result[0] as string[]) ?? [];
    console.log(`[keeper] found ${indicatorAddrs.length} indicators on-chain`);
  } catch (err) {
    console.error("[keeper] get_all_indicators failed:", err);
    return NextResponse.json({ error: `Factory read failed: ${err}` }, { status: 500 });
  }

  if (indicatorAddrs.length === 0) {
    return NextResponse.json({ results: [], totalPushed: 0, signalChanges: 0 });
  }

  // 2. For each indicator, get asset, fetch price, push on-chain
  //    Deduplicate Pyth fetches by asset — only one HTTP call per unique feed
  const priceCache = new Map<string, { price: bigint; timestamp: number }>();

  const results: Array<{
    indicatorAddr: string;
    name: string;
    asset: string;
    priceUsd: number;
    txHash: string;
    signal: number;
    prevSignal: number;
    signalChanged: boolean;
    error?: string;
  }> = [];

  let totalPushed = 0;
  let signalChanges = 0;
  let decisionsCreated = 0;
  const freshDecisions: Array<{
    strategyVaultId: string;
    decisionId: string;
    indicatorAddr: string;
    signal: number;
    marketName: string;
    allocationPct: number;
    priceUsd: number;
  }> = [];

  for (const addr of indicatorAddrs) {
    let name = addr.slice(0, 10) + "...";
    let asset = "";

    try {
      // get_info returns (name, symbol, asset, indicator_type, short_period, long_period)
      const info = await aptos.view({
        payload: {
          function: `${CONTRACT}::indicator::get_info` as `${string}::${string}::${string}`,
          functionArguments: [addr],
        },
      });
      name = String(info[0]);
      asset = String(info[2]);  // index 2 = asset field
    } catch (err) {
      console.warn(`[keeper] get_info failed for ${addr}:`, err);
      results.push({
        indicatorAddr: addr, name, asset: "unknown",
        priceUsd: 0, txHash: "", signal: 0, prevSignal: 0,
        signalChanged: false, error: `get_info failed: ${err}`,
      });
      continue;
    }

    // Read signal before push so we can detect changes
    const prevSignal = await readSignal(addr);

    // Fetch Pyth price (cached per asset)
    let priceData: { price: bigint; timestamp: number };
    try {
      if (!priceCache.has(asset)) {
        priceCache.set(asset, await fetchPythPrice(asset));
      }
      priceData = priceCache.get(asset)!;
    } catch (err) {
      console.warn(`[keeper] Pyth fetch failed for ${asset} (${addr}):`, err);
      results.push({
        indicatorAddr: addr, name, asset,
        priceUsd: 0, txHash: "", signal: prevSignal, prevSignal,
        signalChanged: false, error: `Pyth fetch failed: ${err}`,
      });
      continue;
    }

    // Push on-chain
    let txHash = "";
    try {
      txHash = await pushPriceOnChain(keeperAccount, addr, priceData.price, priceData.timestamp);
      totalPushed++;
    } catch (err) {
      console.warn(`[keeper] push_price failed for ${addr}:`, err);
      results.push({
        indicatorAddr: addr, name, asset,
        priceUsd: Number(priceData.price) / 1e8,
        txHash: "", signal: prevSignal, prevSignal,
        signalChanged: false, error: `push_price failed: ${err}`,
      });
      continue;
    }

    // Read new signal and detect changes
    const newSignal = await readSignal(addr);
    const signalChanged = prevSignal !== newSignal && (newSignal === 1 || newSignal === 2);
    if (signalChanged) {
      signalChanges++;
      const direction = newSignal === 1 ? "BUY" : "SELL";
      console.log(
        `[keeper] *** SIGNAL CHANGE *** ${name} (${asset}): ${direction} @ $${(Number(priceData.price) / 1e8).toFixed(2)} | tx=${txHash}`,
      );

      const priceUsd = Number(priceData.price) / 1e8;
      const activeVaults = await prisma.strategyVault.findMany({
        where: {
          indicatorAddr: addr,
          status: "ACTIVE",
        },
      }).catch((error) => {
        console.warn(`[keeper] strategy vault lookup failed for ${addr}:`, error);
        return [];
      });

      for (const vault of activeVaults) {
        const decision = await prisma.indicatorSignalDecision.create({
          data: {
            strategyVaultId: vault.id,
            indicatorAddr: addr,
            signal: newSignal,
            prevSignal,
            price: priceUsd,
            priceTimestamp: new Date(priceData.timestamp * 1000),
            onChainTxHash: txHash,
            expiresAt: new Date(Date.now() + 5 * 60_000),
          },
        });
        await prisma.strategyVault.update({
          where: { id: vault.id },
          data: { latestDecisionId: decision.id },
        });
        decisionsCreated++;
        freshDecisions.push({
          strategyVaultId: vault.id,
          decisionId: decision.id,
          indicatorAddr: addr,
          signal: newSignal,
          marketName: vault.marketName,
          allocationPct: vault.allocationPct,
          priceUsd,
        });
      }
    } else {
      console.log(
        `[keeper] pushed ${name} (${asset}) price=$${(Number(priceData.price) / 1e8).toFixed(2)} signal=${newSignal} tx=${txHash.slice(0, 12)}...`,
      );
    }

    // Update the last-known signal AFTER we've captured prevSignal for Phase 2
    lastKnownSignals.set(addr, newSignal);

    results.push({
      indicatorAddr: addr,
      name,
      asset,
      priceUsd: Number(priceData.price) / 1e8,
      txHash,
      signal: newSignal,
      prevSignal,
      signalChanged,
    });
  }

  console.log(`[keeper] sweep complete — pushed=${totalPushed}/${indicatorAddrs.length} signalChanges=${signalChanges}`);

  // ── Phase 2: Execute fresh persisted strategy decisions ──────────────────
  let jobsExecuted = 0;
  let jobsFailed = 0;
  let jobsRecurringReset = 0;

  const origin = getOrigin();

  try {
    console.log(`[keeper] Phase 2: ${freshDecisions.length} fresh strategy decisions`);

    for (const decision of freshDecisions) {
      const notionalBalance = Number(process.env.LAUNCHPAD_STRATEGY_NOTIONAL_USD ?? "100");
      if (!Number.isFinite(notionalBalance) || notionalBalance <= 0) {
        console.warn("[keeper] LAUNCHPAD_STRATEGY_NOTIONAL_USD must be positive");
        jobsFailed++;
        continue;
      }
      if (decision.priceUsd <= 0) {
        console.warn(`[keeper] decision ${decision.decisionId} has no usable price`);
        jobsFailed++;
        continue;
      }

      const allocationPct = Math.min(100, Math.max(0.1, decision.allocationPct));
      const sizeUsdt = notionalBalance * allocationPct / 100;
      const execSize = sizeUsdt / decision.priceUsd;
      console.log(
        `[keeper] Position sizing: ${allocationPct}% of $${notionalBalance} = ` +
        `$${sizeUsdt.toFixed(2)} = ${execSize.toFixed(6)} ${decision.marketName.split("/")[0]} ` +
        `at $${decision.priceUsd.toFixed(2)}`,
      );

      try {
        const execRes = await fetch(`${origin}/api/launchpad/execute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cronSecret}`,
          },
          body: JSON.stringify({
            strategyVaultId: decision.strategyVaultId,
            decisionId: decision.decisionId,
            indicatorAddr: decision.indicatorAddr,
            signal: decision.signal,
            marketName: decision.marketName,
            size: execSize,
            sizeUsdt,
            reduceOnly: decision.signal === 2,
          }),
        });
        const execBody = await execRes.json() as Record<string, unknown>;
        if (!execRes.ok || execBody.error) {
          throw new Error(String(execBody.error || `Execution returned ${execRes.status}`));
        }
        console.log(`[keeper] executed decision ${decision.decisionId}: signal=${decision.signal}`, execBody);
        jobsExecuted++;

        // Post a signal to the signal feed
        await fetch(`${origin}/api/launchpad/signals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            indicatorAddr: decision.indicatorAddr,
            signal: decision.signal,
            price: decision.priceUsd,
            confidence: 5000,
            asset: decision.marketName,
          }),
        }).catch(() => {});
      } catch (jobErr) {
        console.error(`[keeper] decision ${decision.decisionId} execute failed:`, jobErr);
        jobsFailed++;
      }
    }
  } catch (phase2Err) {
    console.error("[keeper] Phase 2 error:", phase2Err);
  }

  if (jobsExecuted > 0 || jobsFailed > 0) {
    console.log(`[keeper] Phase 2 complete — executed=${jobsExecuted} failed=${jobsFailed}`);
  }

  return NextResponse.json({
    results,
    totalPushed,
    totalIndicators: indicatorAddrs.length,
    signalChanges,
    decisionsCreated,
    jobsExecuted,
    jobsFailed,
    jobsRecurringReset,
    timestamp: Math.floor(Date.now() / 1000),
  });
}

// ── POST — manual single-indicator push (frontend / demo) ───────────────────

export async function POST(req: Request) {
  const keeperSecret = process.env.LAUNCHPAD_KEEPER_API_SECRET ?? process.env.CRON_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!keeperSecret) {
      return NextResponse.json({ error: "Keeper API is not configured" }, { status: 503 });
    }
    if (req.headers.get("authorization") !== `Bearer ${keeperSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const body = await req.json() as {
      indicatorAddr: string;
      asset: string;
      executeOnDecibel?: boolean;
      decibelMarket?: string;
      decibelSize?: number;
    };
    const {
      indicatorAddr,
      asset,
      executeOnDecibel = false,
      decibelMarket,
      decibelSize = 0.001,
    } = body;

    if (!indicatorAddr || !asset) {
      return NextResponse.json({ error: "indicatorAddr and asset required" }, { status: 400 });
    }

    let keeperAccount: Account;
    try {
      keeperAccount = getKeeperAccount();
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }

    // Read pre-push signal for change detection
    const prevSignal = await readSignal(indicatorAddr);

    // Fetch Pyth price
    const { price, timestamp } = await fetchPythPrice(asset);

    // Push on-chain
    const txHash = await pushPriceOnChain(keeperAccount, indicatorAddr, price, timestamp);

    // Read new signal
    const signal = await readSignal(indicatorAddr);

    const signalChanged = prevSignal !== signal && (signal === 1 || signal === 2);
    if (signalChanged) {
      const direction = signal === 1 ? "BUY" : "SELL";
      console.log(`[keeper/post] *** SIGNAL CHANGE *** ${indicatorAddr}: ${direction} @ $${(Number(price) / 1e8).toFixed(2)}`);
    }

    // Optionally auto-execute on Decibel when signal fires
    let decibelResult: Record<string, unknown> | null = null;
    if (executeOnDecibel && decibelMarket && signalChanged && (signal === 1 || signal === 2)) {
      try {
        const strategyVault = await prisma.strategyVault.findFirst({
          where: {
            indicatorAddr,
            marketName: decibelMarket,
            status: "ACTIVE",
          },
          orderBy: { updatedAt: "desc" },
        });
        if (!strategyVault) {
          decibelResult = {
            error: "No active strategy vault is configured for this indicator and market",
          };
        } else {
          const decision = await prisma.indicatorSignalDecision.create({
            data: {
              strategyVaultId: strategyVault.id,
              indicatorAddr,
              signal,
              prevSignal,
              price: Number(price) / 1e8,
              priceTimestamp: new Date(timestamp * 1000),
              onChainTxHash: txHash,
              expiresAt: new Date(Date.now() + 5 * 60_000),
              source: "manual-keeper",
            },
          });
          await prisma.strategyVault.update({
            where: { id: strategyVault.id },
            data: { latestDecisionId: decision.id },
          });

          const sizeUsdt = Number(process.env.LAUNCHPAD_STRATEGY_NOTIONAL_USD ?? "100") *
            Math.min(100, Math.max(0.1, strategyVault.allocationPct)) / 100;
          const sizedFromAllocation =
            Number(price) > 0 ? sizeUsdt / (Number(price) / 1e8) : decibelSize;

          const execRes = await fetch(`${getOrigin()}/api/launchpad/execute`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(keeperSecret ? { Authorization: `Bearer ${keeperSecret}` } : {}),
            },
            body: JSON.stringify({
              strategyVaultId: strategyVault.id,
              decisionId: decision.id,
              indicatorAddr,
              signal,
              marketName: decibelMarket,
              size: sizedFromAllocation || decibelSize,
              sizeUsdt,
              reduceOnly: signal === 2,
            }),
          });
          decibelResult = await execRes.json() as Record<string, unknown>;
        }
      } catch (execErr) {
        decibelResult = { error: String(execErr) };
      }
    }

    return NextResponse.json({
      success: true,
      txHash,
      price: Number(price) / 1e8,
      priceRaw: price.toString(),
      signal,
      prevSignal,
      signalChanged,
      timestamp,
      ...(decibelResult ? { decibel: decibelResult } : {}),
    });
  } catch (err) {
    console.error("[keeper/post] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Dev-only auto-keeper: replaces Vercel cron locally ──────────────────────
// In development, there's no Vercel cron to trigger the keeper every minute.
// This self-invoking interval ensures the keeper runs automatically.

let _devKeeperStarted = false;

function startDevKeeper() {
  if (_devKeeperStarted) return;
  if (process.env.NODE_ENV !== "development") return;
  _devKeeperStarted = true;

  const cronSecret = process.env.CRON_SECRET ?? "";
  const port = process.env.PORT ?? "3001";
  const baseUrl = `http://localhost:${port}`;

  console.log(`[keeper] dev auto-keeper started — will sweep every 60s on ${baseUrl}`);

  setInterval(async () => {
    try {
      const res = await fetch(`${baseUrl}/api/launchpad/keeper`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      const data = await res.json() as Record<string, unknown>;
      console.log(
        `[keeper/dev] sweep: pushed=${data.totalPushed} signals=${data.signalChanges} jobs=${data.jobsExecuted}`,
      );
    } catch (err) {
      console.warn("[keeper/dev] sweep failed:", err);
    }
  }, 60_000);
}

startDevKeeper();
