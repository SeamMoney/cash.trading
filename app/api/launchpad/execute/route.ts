/**
 * Signal Executor — takes an on-chain indicator signal and fires a real
 * Decibel perps order server-side using the keeper's private key.
 *
 * POST /api/launchpad/execute
 * Body: {
 *   indicatorAddr: string,   // on-chain indicator address
 *   signal: 1 | 2,           // 1=BUY (open long), 2=SELL (close long / open short)
 *   marketName: string,      // "BTC/USD", "ETH/USD", etc.
 *   size?: number,           // asset units (default: 0.001 BTC)
 *   price?: number,          // if provided → limit order; else market
 *   reduceOnly?: boolean,    // true to close existing position
 * }
 *
 * Returns: { decibelTxHash, subaccount, side, size, marketName, signal }
 */
import { NextResponse } from "next/server";
import {
  Aptos,
  AptosConfig,
  Network,
  Account,
  Ed25519PrivateKey,
} from "@aptos-labs/ts-sdk";
import type { Prisma } from "@prisma/client";
import {
  getActiveNetwork,
  buildDecibelOrderPayload,
  getDecibelPackage,
  getDecibelMarketConfigFromRegistry,
  type MarketConfig,
} from "@/lib/decibel";
import { indicatorRegistry } from "@/app/api/launchpad/indicators/route";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export let platformRevenueUsdt = 0;

const CONTRACT = "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee";

function authorizeKeeperExecution(req: Request) {
  if (process.env.NODE_ENV !== "production") return null;
  const secret = process.env.LAUNCHPAD_KEEPER_API_SECRET ?? process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Launchpad execution is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function getAptos() {
  const net = getActiveNetwork();
  return new Aptos(new AptosConfig({
    network: net === "mainnet" ? Network.MAINNET : Network.TESTNET,
  }));
}

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

async function submitTx(aptos: Aptos, account: Account, payload: {
  function: string;
  typeArguments: string[];
  functionArguments: unknown[];
}) {
  const txn = await aptos.transaction.build.simple({
    sender: account.accountAddress,
    data: {
      function: payload.function as `${string}::${string}::${string}`,
      typeArguments: payload.typeArguments,
      functionArguments: payload.functionArguments as (string | boolean | number | null)[],
    },
    options: {
      maxGasAmount: 100_000,
      gasUnitPrice: 100,
    },
  });
  const auth = aptos.transaction.sign({ signer: account, transaction: txn });
  const committed = await aptos.transaction.submit.simple({
    transaction: txn,
    senderAuthenticator: auth,
  });
  await aptos.waitForTransaction({ transactionHash: committed.hash });
  return committed.hash;
}

function moveVariantName(value: unknown): string {
  if (value && typeof value === "object" && "__variant__" in value) {
    return String((value as { __variant__?: unknown }).__variant__);
  }
  return String(value ?? "unknown");
}

async function readDecibelMarketState(
  aptos: Aptos,
  marketConfig: MarketConfig,
  network: ReturnType<typeof getActiveNetwork>,
): Promise<{ isOpen: boolean; mode: string; markPrice: number | null }> {
  const pkg = getDecibelPackage(network);
  const marketAddress = marketConfig.address;
  const [isOpenRaw, modeRaw, markAndOracle] = await Promise.all([
    aptos.view({
      payload: {
        function: `${pkg}::perp_engine::is_market_open` as `${string}::${string}::${string}`,
        functionArguments: [marketAddress],
      },
    }).then(([value]) => value),
    aptos.view({
      payload: {
        function: `${pkg}::perp_engine::get_market_mode` as `${string}::${string}::${string}`,
        functionArguments: [marketAddress],
      },
    }).then(([value]) => value),
    aptos.view({
      payload: {
        function: `${pkg}::perp_engine::get_mark_and_oracle_price` as `${string}::${string}::${string}`,
        functionArguments: [marketAddress],
      },
    }),
  ]);
  const markRaw = Array.isArray(markAndOracle) ? markAndOracle[0] : null;
  const markPrice = markRaw === null || markRaw === undefined
    ? null
    : Number(markRaw) / Math.pow(10, marketConfig.priceDecimals);

  return {
    isOpen: Boolean(isOpenRaw),
    mode: moveVariantName(modeRaw),
    markPrice:
      markPrice !== null && Number.isFinite(markPrice) && markPrice > 0
        ? markPrice
        : null,
  };
}

async function auditExecution(args: {
  strategyVaultId: string;
  decisionId?: string | null;
  indicatorAddr: string;
  requestedSignal: number;
  onChainSignal?: number | null;
  allowed: boolean;
  status: string;
  reason?: string;
  marketName: string;
  side?: string;
  size?: number;
  sizeUsdt?: number;
  orderPrice?: number;
  decibelTxHash?: string;
  subaccount?: string;
  rawRequest?: Record<string, unknown>;
  rawResponse?: Record<string, unknown>;
}) {
  return prisma.executionAudit.create({
    data: {
      strategyVaultId: args.strategyVaultId,
      decisionId: args.decisionId,
      indicatorAddr: args.indicatorAddr,
      requestedSignal: args.requestedSignal,
      onChainSignal: args.onChainSignal,
      allowed: args.allowed,
      status: args.status,
      reason: args.reason,
      marketName: args.marketName,
      side: args.side,
      size: args.size,
      sizeUsdt: args.sizeUsdt,
      orderPrice: args.orderPrice,
      decibelTxHash: args.decibelTxHash,
      subaccount: args.subaccount,
      rawRequest: args.rawRequest ? compactJson(args.rawRequest) : undefined,
      rawResponse: args.rawResponse ? compactJson(args.rawResponse) : undefined,
    },
  });
}

function compactJson<T extends Record<string, unknown>>(value: T): Prisma.InputJsonObject {
  const result: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry as Prisma.InputJsonValue;
  }
  return result as Prisma.InputJsonObject;
}

export async function POST(req: Request) {
  const unauthorized = authorizeKeeperExecution(req);
  if (unauthorized) return unauthorized;

  try {
    const body = await req.json() as {
      strategyVaultId?: string;
      decisionId?: string;
      indicatorAddr: string;
      signal: number;
      marketName: string;
      size?: number;
      sizeUsdt?: number;
      price?: number;
      reduceOnly?: boolean;
      entryPrice?: number;  // previous entry price (for P&L calc on close)
    };

    const { strategyVaultId, decisionId, indicatorAddr, signal, marketName, sizeUsdt } = body;
    const size = body.size ?? 0.001; // default 0.001 BTC

    if (!strategyVaultId || !decisionId) {
      return NextResponse.json(
        { error: "strategyVaultId and decisionId are required for launchpad execution" },
        { status: 400 },
      );
    }

    if (!indicatorAddr || !signal || !marketName) {
      return NextResponse.json({ error: "indicatorAddr, signal, marketName required" }, { status: 400 });
    }
    if (signal !== 1 && signal !== 2) {
      return NextResponse.json({ error: "signal must be 1 (BUY) or 2 (SELL)" }, { status: 400 });
    }

    const rawRequest = {
      strategyVaultId,
      decisionId,
      indicatorAddr,
      signal,
      marketName,
      size,
      sizeUsdt,
      price: body.price,
      reduceOnly: body.reduceOnly,
    };

    const deny = async (
      reason: string,
      status = 409,
      onChainSignal?: number | null,
    ) => {
      await auditExecution({
        strategyVaultId,
        decisionId,
        indicatorAddr,
        requestedSignal: signal,
        onChainSignal,
        allowed: false,
        status: "DENIED",
        reason,
        marketName,
        size,
        sizeUsdt,
        rawRequest,
      }).catch((auditErr) => {
        console.error("[launchpad/execute] audit deny failed:", auditErr);
      });
      return NextResponse.json({ error: reason }, { status });
    };

    const strategyVault = await prisma.strategyVault.findUnique({
      where: { id: strategyVaultId },
    });
    if (!strategyVault) {
      return NextResponse.json({ error: "Strategy vault not found" }, { status: 404 });
    }
    if (strategyVault.status !== "ACTIVE") {
      return deny("Strategy vault is not active", 409);
    }
    if (strategyVault.indicatorAddr.toLowerCase() !== indicatorAddr.toLowerCase()) {
      return deny("Indicator does not match strategy vault", 409);
    }
    if (strategyVault.marketName !== marketName) {
      return deny("Market does not match strategy vault policy", 409);
    }
    if (!strategyVault.decibelSubaccount && !strategyVault.vaultAddr) {
      return deny("Strategy vault has no Decibel execution account configured", 409);
    }

    const decision = await prisma.indicatorSignalDecision.findUnique({
      where: { id: decisionId },
    });
    if (!decision) {
      return deny("Indicator decision not found", 404);
    }
    if (decision.strategyVaultId !== strategyVaultId) {
      return deny("Decision does not belong to strategy vault", 409);
    }
    if (decision.indicatorAddr.toLowerCase() !== indicatorAddr.toLowerCase()) {
      return deny("Decision indicator mismatch", 409);
    }
    if (strategyVault.latestDecisionId !== decision.id) {
      return deny("Decision is not the latest strategy vault decision", 409);
    }
    if (decision.consumedAt) {
      return deny("Decision has already been consumed", 409);
    }
    if (decision.expiresAt.getTime() <= Date.now()) {
      return deny("Decision has expired", 409);
    }
    if (decision.signal !== signal) {
      return deny("Requested signal does not match persisted indicator decision", 409);
    }
    if (decision.signal !== 1 && decision.signal !== 2) {
      return deny("Neutral indicator decisions cannot execute", 409);
    }

    const aptos = getAptos();
    const keeper = getKeeperAccount();
    const net = getActiveNetwork();

    // ── Read current on-chain signal to confirm ───────────────────────────
    const [onChainSig, , , lastPrice] = await aptos.view({
      payload: {
        function: `${CONTRACT}::indicator::get_signal_view` as `${string}::${string}::${string}`,
        functionArguments: [indicatorAddr],
      },
    }) as [number, string, string, string, string];
    const liveSignal = Number(onChainSig);
    if (liveSignal !== decision.signal) {
      return deny("Live on-chain signal no longer matches decision", 409, liveSignal);
    }

    const isBuy = decision.signal === 1;
    const reduceOnly = decision.signal === 2;
    const subaccount = strategyVault.decibelSubaccount ?? strategyVault.vaultAddr!;
    const { marketName: resolvedMarketName, config: resolvedMarketConfig } =
      await getDecibelMarketConfigFromRegistry(marketName);
    const marketState = await readDecibelMarketState(
      aptos,
      resolvedMarketConfig,
      net,
    );

    if (!marketState.isOpen && !reduceOnly) {
      return deny(
        `Decibel market ${resolvedMarketName} is not open (${marketState.mode})`,
        409,
        liveSignal,
      );
    }

    // Use the Decibel market mark price for protective IOC pricing. The
    // indicator's last price only validates the signal; it can be a different
    // asset from the market a strategy vault chooses to trade.
    const orderPrice = body.price ?? marketState.markPrice ?? (Number(lastPrice) / 1e8);
    const orderNotionalUsdt = Number.isFinite(size * orderPrice)
      ? size * orderPrice
      : sizeUsdt;
    // Platform fee: 10 bps (0.10%) of submitted order notional, recorded only
    // after policy and live-market checks pass.
    const platformFee = Math.round((orderNotionalUsdt ?? 0) * 0.001 * 100) / 100;
    platformRevenueUsdt += platformFee;

    // ── Build Decibel order payload ───────────────────────────────────────
    const {
      payload: orderPayload,
      marketConfig,
      sizeRaw,
      priceRaw,
    } = buildDecibelOrderPayload({
      marketName: resolvedMarketName,
      marketConfig: resolvedMarketConfig,
      price: orderPrice,
      size,
      isBuy,
      orderType: body.price ? "limit" : "market",
      reduceOnly,
      subaccount,
    });

    let decibelTxHash: string;
    try {
      decibelTxHash = await submitTx(aptos, keeper, orderPayload);
    } catch (submitErr) {
      await auditExecution({
        strategyVaultId,
        decisionId,
        indicatorAddr,
        requestedSignal: signal,
        onChainSignal: liveSignal,
        allowed: true,
        status: "FAILED_SUBMIT",
        reason: submitErr instanceof Error ? submitErr.message : String(submitErr),
        marketName,
        side: isBuy ? "long" : "reduce-only sell",
        size,
        sizeUsdt: orderNotionalUsdt,
        orderPrice,
        subaccount,
        rawRequest,
        rawResponse: {
          sizeRaw,
          priceRaw,
          marketAddress: marketConfig.address,
          marketName: resolvedMarketName,
          marketMode: marketState.mode,
          markPrice: marketState.markPrice,
        },
      }).catch((auditErr) => {
        console.error("[launchpad/execute] audit submit failure failed:", auditErr);
      });
      throw submitErr;
    }
    await prisma.indicatorSignalDecision.update({
      where: { id: decision.id },
      data: { consumedAt: new Date() },
    });

    // ── Creator fee collection on profitable close ────────────────────────
    let creatorFeePaid = 0;
    let creatorFeeBps = 0;

    if (reduceOnly && body.entryPrice && body.entryPrice > 0) {
      const exitPrice = orderPrice;
      const entryPriceVal = body.entryPrice;
      // Long close P&L: (exit - entry) * size
      const profitUsdt = (exitPrice - entryPriceVal) * size;

      if (profitUsdt > 0) {
        // Look up the indicator in the registry to get its fee bps
        const ind = indicatorRegistry.find(i => i.address === indicatorAddr);
        creatorFeeBps = ind?.creatorFeeBps ?? 0;

        if (creatorFeeBps > 0) {
          creatorFeePaid = profitUsdt * creatorFeeBps / 10000;
          const profitUsdtE6 = Math.round(profitUsdt * 1e6);

          // Update in-memory earnings immediately
          if (ind) {
            ind.creatorEarningsUsdt = (ind.creatorEarningsUsdt ?? 0) + creatorFeePaid;
          }

          // Attempt on-chain record_creator_fee — non-blocking
          try {
            await submitTx(aptos, keeper, {
              function: `${CONTRACT}::indicator::record_creator_fee` as `${string}::${string}::${string}`,
              typeArguments: [],
              functionArguments: [indicatorAddr, String(profitUsdtE6)],
            });
            console.log(
              `[launchpad/execute] creator fee recorded: indicatorAddr=${indicatorAddr} ` +
              `profitUsdt=${profitUsdt.toFixed(4)} feeBps=${creatorFeeBps} feePaid=${creatorFeePaid.toFixed(4)}`,
            );
          } catch (feeErr) {
            // Don't block the trade response — log and continue
            console.error("[launchpad/execute] record_creator_fee on-chain call failed (non-fatal):", feeErr);
          }
        }
      }
    }

    const audit = await auditExecution({
      strategyVaultId,
      decisionId,
      indicatorAddr,
      requestedSignal: signal,
      onChainSignal: liveSignal,
      allowed: true,
      status: "SUBMITTED",
      marketName: resolvedMarketName,
      side: isBuy ? "long" : "reduce-only sell",
      size,
      sizeUsdt: orderNotionalUsdt,
      orderPrice,
      decibelTxHash,
      subaccount,
      rawRequest,
      rawResponse: {
        decibelTxHash,
        sizeRaw,
        priceRaw,
        marketAddress: marketConfig.address,
        marketName: resolvedMarketName,
        marketMode: marketState.mode,
        markPrice: marketState.markPrice,
      },
    }).catch((auditErr) => {
      console.error("[launchpad/execute] audit success failed:", auditErr);
      return null;
    });

    return NextResponse.json({
      success: true,
      decibelTxHash,
      subaccount,
      side: isBuy ? "long" : "short",
      size,
      sizeRaw,
      priceRaw,
      marketName: resolvedMarketName,
      marketAddress: marketConfig.address,
      signal: onChainSig,
      entryPrice: orderPrice,
      reduceOnly,
      explorerUrl: `https://explorer.aptoslabs.com/txn/${decibelTxHash}?network=${net}`,
      creatorFeePaid,
      creatorFeeBps,
      platformFeePaid: platformFee,
      decisionId: decision.id,
      strategyVaultId: strategyVault.id,
      auditId: audit?.id ?? null,
    });
  } catch (err) {
    console.error("[launchpad/execute]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
