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
import {
  getActiveNetwork,
  getReadDex,
  buildDecibelOrderPayload,
  getDecibelPackage,
} from "@/lib/decibel";
import { indicatorRegistry } from "@/app/api/launchpad/indicators/route";

export const runtime = "nodejs";

export let platformRevenueUsdt = 0;

const CONTRACT = "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee";

function getAptos() {
  const net = getActiveNetwork();
  return new Aptos(new AptosConfig({
    network: net === "mainnet" ? Network.MAINNET : Network.TESTNET,
  }));
}

function getKeeperAccount(): Account {
  const keyHex = process.env.LAUNCHPAD_KEEPER_KEY;
  if (!keyHex) throw new Error("LAUNCHPAD_KEEPER_KEY not configured");
  return Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(keyHex) });
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
  });
  const auth = aptos.transaction.sign({ signer: account, transaction: txn });
  const committed = await aptos.transaction.submit.simple({
    transaction: txn,
    senderAuthenticator: auth,
  });
  await aptos.waitForTransaction({ transactionHash: committed.hash });
  return committed.hash;
}

async function ensureSubaccount(aptos: Aptos, account: Account): Promise<string> {
  const dex = getReadDex();
  const ownerAddr = account.accountAddress.toString();

  // Check existing subaccounts
  const subaccounts = await dex.userSubaccounts
    .getByAddr({ ownerAddr })
    .catch(() => [] as Array<{ subaccount_address: string; is_primary: boolean }>);

  if (subaccounts.length > 0) {
    const primary = subaccounts.find((s) => s.is_primary) ?? subaccounts[0];
    return primary.subaccount_address;
  }

  // No subaccount — create one
  const pkg = getDecibelPackage();
  await submitTx(aptos, account, {
    function: `${pkg}::dex_accounts_entry::create_new_subaccount`,
    typeArguments: [],
    functionArguments: [],
  });

  // Re-fetch after creation
  const created = await dex.userSubaccounts
    .getByAddr({ ownerAddr })
    .catch(() => [] as Array<{ subaccount_address: string; is_primary: boolean }>);

  if (created.length === 0) throw new Error("Subaccount creation failed or not yet indexed");
  const primary = created.find((s) => s.is_primary) ?? created[0];
  return primary.subaccount_address;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      indicatorAddr: string;
      signal: number;
      marketName: string;
      size?: number;
      sizeUsdt?: number;
      price?: number;
      reduceOnly?: boolean;
      entryPrice?: number;  // previous entry price (for P&L calc on close)
    };

    const { indicatorAddr, signal, marketName, reduceOnly = false, sizeUsdt } = body;
    const size = body.size ?? 0.001; // default 0.001 BTC

    // Platform fee: 10 bps (0.10%) of sizeUsdt
    const platformFee = Math.round((sizeUsdt ?? 0) * 0.001 * 100) / 100;
    platformRevenueUsdt += platformFee;

    if (!indicatorAddr || !signal || !marketName) {
      return NextResponse.json({ error: "indicatorAddr, signal, marketName required" }, { status: 400 });
    }
    if (signal !== 1 && signal !== 2) {
      return NextResponse.json({ error: "signal must be 1 (BUY) or 2 (SELL)" }, { status: 400 });
    }

    const aptos = getAptos();
    const keeper = getKeeperAccount();
    const net = getActiveNetwork();

    // ── Get or create subaccount ──────────────────────────────────────────
    const subaccount = await ensureSubaccount(aptos, keeper);

    // ── Read current on-chain signal to confirm ───────────────────────────
    const [onChainSig, , , lastPrice] = await aptos.view({
      payload: {
        function: `${CONTRACT}::indicator::get_signal` as `${string}::${string}::${string}`,
        functionArguments: [indicatorAddr],
      },
    }) as [number, string, string, string];

    // Use actual on-chain price for the order if not provided
    const orderPrice = body.price ?? (Number(lastPrice) / 1e8);
    const isBuy = signal === 1; // BUY signal → LONG; SELL signal → close/SHORT

    // ── Build Decibel order payload ───────────────────────────────────────
    const {
      payload: orderPayload,
      marketConfig,
      sizeRaw,
      priceRaw,
    } = buildDecibelOrderPayload({
      marketName,
      price: orderPrice,
      size,
      isBuy,
      orderType: body.price ? "limit" : "market",
      reduceOnly,
      subaccount,
    });

    const decibelTxHash = await submitTx(aptos, keeper, orderPayload);

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

    return NextResponse.json({
      success: true,
      decibelTxHash,
      subaccount,
      side: isBuy ? "long" : "short",
      size,
      sizeRaw,
      priceRaw,
      marketName,
      marketAddress: marketConfig.address,
      signal: onChainSig,
      entryPrice: orderPrice,
      reduceOnly,
      explorerUrl: `https://explorer.aptoslabs.com/txn/${decibelTxHash}?network=${net}`,
      creatorFeePaid,
      creatorFeeBps,
      platformFeePaid: platformFee,
    });
  } catch (err) {
    console.error("[launchpad/execute]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
