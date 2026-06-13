/**
 * Permissionless crank for trustless strategy vaults.
 *
 * POST /api/launchpad/crank
 *   Body: { svAddr?: string, pkg?: string, module?: string }
 *   Submits `{module}::tick_oracle(sv, now)` — module defaults to
 *   "strategy_vault" (the hand-written package); rail-deployed packages
 *   bundle everything into a module named "indicator". The contract reads the
 *   mark price from Decibel's perp engine itself, so this caller contributes
 *   nothing but gas + a timestamp. Anyone could run this crank; we expose it
 *   so the app/bot-runner can keep live strategies ticking.
 *
 * GET /api/launchpad/crank — returns the default crank target + whether a
 * keeper key is configured (no secrets returned).
 */
import { NextResponse } from "next/server";
import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
  PrivateKey,
  PrivateKeyVariants,
} from "@aptos-labs/ts-sdk";

export const runtime = "nodejs";

/** Deployed trustless strategy-vault package (testnet). */
const DEFAULT_PKG = "0x44bccd01a872341d7c74baf3497501ceb0b768a83a5ed9675799bfbac86e0ed3";
/** The live SMA 3/5 strategy vault object bound to Decibel vault 0x8939…ec6e. */
const DEFAULT_SV = "0x97ac8825850adadfc1a6c0792e25ca08e46a5123ffe693615f26e74551c7bc69";

const ADDR_RE = /^0x[0-9a-fA-F]{1,64}$/;

function getCrankAccount() {
  // Testnet crank: prefer the testnet deployer key (funded); the bot-operator
  // key is mainnet-funded and has no testnet gas.
  const keyHex =
    process.env.EXPOSED_TESTNET_KEY ??
    process.env.LAUNCHPAD_KEEPER_KEY ??
    process.env.BOT_OPERATOR_PRIVATE_KEY;
  if (!keyHex) return null;
  const clean = PrivateKey.formatPrivateKey(keyHex.trim(), PrivateKeyVariants.Ed25519);
  return Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(clean) });
}

function getAptos() {
  const apiKey =
    process.env.GEOMI_API_KEY_TESTNET ?? process.env.APTOS_API_KEY_TESTNET;
  return new Aptos(new AptosConfig({
    network: Network.TESTNET,
    ...(apiKey ? { clientConfig: { API_KEY: apiKey } } : {}),
  }));
}

export async function GET() {
  return NextResponse.json({
    defaultStrategyVault: DEFAULT_SV,
    pkg: DEFAULT_PKG,
    keeperConfigured: Boolean(
      process.env.LAUNCHPAD_KEEPER_KEY ??
      process.env.BOT_OPERATOR_PRIVATE_KEY ??
      process.env.EXPOSED_TESTNET_KEY,
    ),
    note: "tick_oracle reads Decibel's mark price on-chain; the crank supplies only gas + timestamp.",
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const svAddr = typeof body.svAddr === "string" ? body.svAddr : DEFAULT_SV;
    const pkg = typeof body.pkg === "string" ? body.pkg : DEFAULT_PKG;
    const moduleName = typeof body.module === "string" ? body.module : "strategy_vault";
    if (!ADDR_RE.test(svAddr) || !ADDR_RE.test(pkg)) {
      return NextResponse.json({ error: "svAddr/pkg must be 0x hex addresses" }, { status: 400 });
    }
    if (!/^[a-z0-9_]{1,64}$/.test(moduleName)) {
      return NextResponse.json({ error: "module must be a Move identifier" }, { status: 400 });
    }

    const account = getCrankAccount();
    if (!account) {
      return NextResponse.json(
        { error: "No keeper key configured (LAUNCHPAD_KEEPER_KEY / BOT_OPERATOR_PRIVATE_KEY)" },
        { status: 503 },
      );
    }

    const aptos = getAptos();
    const txn = await aptos.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function: `${pkg}::${moduleName}::tick_oracle`,
        functionArguments: [svAddr, String(Math.floor(Date.now() / 1000))],
      },
    });
    const submitted = await aptos.signAndSubmitTransaction({ signer: account, transaction: txn });
    const result = await aptos.waitForTransaction({ transactionHash: submitted.hash });

    const traded = (result as { events?: { type: string; data: unknown }[] }).events
      ?.filter((e) => e.type.includes("VaultTraded"))
      .map((e) => e.data) ?? [];

    return NextResponse.json({
      hash: submitted.hash,
      success: (result as { success?: boolean }).success ?? true,
      traded,
      crankedAt: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "crank failed";
    // Non-flip ticks succeed with no trade; engine aborts (e.g. paused) surface here.
    return NextResponse.json({ error: message.slice(0, 400) }, { status: 502 });
  }
}
