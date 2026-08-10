import { prisma } from "@/lib/prisma";
import {
  extractDecibelBuilderFills,
  type DecibelBuilderFillReceipt,
} from "@/lib/decibel-builder-receipt";
import { getDecibelBuilderConfig } from "@/lib/decibel-builder";
import {
  getAptosFullnodeApiKey,
  type DecibelNetwork,
} from "@/lib/decibel";

const RECEIPT_FETCH_TIMEOUT_MS = 8_000;

function fullnodeUrl(network: DecibelNetwork): string {
  if (network === "mainnet") {
    return (
      process.env.APTOS_NODE_URL_MAINNET ??
      "https://api.mainnet.aptoslabs.com/v1"
    );
  }
  return (
    process.env.APTOS_NODE_URL_TESTNET ??
    "https://api.testnet.aptoslabs.com/v1"
  );
}

function normalizeTransactionHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("transactionHash must be a 32-byte Aptos transaction hash");
  }
  return normalized;
}

async function fetchTransactionReceipt(args: {
  network: DecibelNetwork;
  transactionHash: string;
  signal?: AbortSignal;
}): Promise<unknown> {
  const transactionHash = normalizeTransactionHash(args.transactionHash);
  const apiKey = getAptosFullnodeApiKey(args.network);
  const timeoutSignal = AbortSignal.timeout(RECEIPT_FETCH_TIMEOUT_MS);
  const signal = args.signal
    ? AbortSignal.any([args.signal, timeoutSignal])
    : timeoutSignal;
  const url = `${fullnodeUrl(args.network).replace(/\/$/, "")}/transactions/by_hash/${transactionHash}`;
  const request = (key?: string) =>
    fetch(url, {
      headers: {
        "x-aptos-client": "cash-trading/builder-receipt",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      cache: "no-store",
      signal,
    });

  let response = await request(apiKey);
  if (apiKey && (response.status === 401 || response.status === 403)) {
    response = await request();
  }
  if (!response.ok) {
    throw new Error(`Aptos transaction lookup failed (${response.status})`);
  }

  const transaction = (await response.json()) as unknown;
  const receiptHash =
    transaction && typeof transaction === "object" && "hash" in transaction
      ? String((transaction as { hash?: unknown }).hash ?? "").toLowerCase()
      : "";
  if (receiptHash !== transactionHash) {
    throw new Error("Aptos transaction lookup returned a different receipt");
  }
  return transaction;
}

/** Persist exact receipt-derived builder fees. Safe to call repeatedly for the same receipt. */
export async function persistDecibelBuilderFills(args: {
  fills: DecibelBuilderFillReceipt[];
  strategyVaultAddr?: string;
  decibelVaultAddr?: string;
}): Promise<number> {
  if (args.fills.length === 0) return 0;

  const result = await prisma.decibelBuilderFill.createMany({
    data: args.fills.map((fill) => ({
      ...fill,
      strategyVaultAddr: args.strategyVaultAddr ?? null,
      decibelVaultAddr: args.decibelVaultAddr ?? null,
      transactionVersion: BigInt(fill.transactionVersion),
      transactionUnixMs:
        fill.transactionUnixMs === null ? null : BigInt(fill.transactionUnixMs),
      priceRaw: BigInt(fill.priceRaw),
      sizeRaw: BigInt(fill.sizeRaw),
      feeRaw: fill.feeRaw === null ? null : BigInt(fill.feeRaw),
      builderFeeRaw: BigInt(fill.builderFeeRaw),
      builderFeeChainUnits: BigInt(fill.builderFeeChainUnits),
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Fetch and reconcile one confirmed Aptos transaction. The caller supplies only a hash;
 * account, fill, and fee data are re-read from the chain and attributed only when Decibel's
 * receipt credits the configured cash.trading builder address.
 */
export async function reconcileDecibelBuilderTransaction(args: {
  network: DecibelNetwork;
  transactionHash: string;
  signal?: AbortSignal;
}): Promise<{ recognized: number; inserted: number }> {
  const transaction = await fetchTransactionReceipt(args);
  const builderAddress = getDecibelBuilderConfig(args.network).builderAddress;
  const fills = extractDecibelBuilderFills({
    transaction,
    network: args.network,
    expectedBuilderAddress: builderAddress,
  });
  const inserted = await persistDecibelBuilderFills({ fills });
  return { recognized: fills.length, inserted };
}
