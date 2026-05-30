import { NextRequest, NextResponse } from "next/server";
import {
  AccountAddress,
  Aptos,
  AptosConfig,
  Network,
  type CommittedTransactionResponse,
} from "@aptos-labs/ts-sdk";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type DecibelNetwork = "testnet" | "mainnet";

const TESTNET_DECIBEL_PACKAGE =
  "0x952535c3049e52f195f26798c2f1340d7dd5100edbe0f464e520a974d16fbe9f";
const MAINNET_DECIBEL_PACKAGE =
  "0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06";

type ExtractVaultBody = {
  txHash?: string;
  transactionHash?: string;
  hash?: string;
  network?: DecibelNetwork;
  strategyVaultId?: string;
  indicatorAddr?: string;
  ownerWallet?: string;
  marketName?: string;
  allocationPct?: number;
  decibelSubaccount?: string | null;
  status?: string;
};

function getNetwork(input?: string): DecibelNetwork {
  if (input === "mainnet") return "mainnet";
  const env =
    process.env.DECIBEL_NETWORK ||
    process.env.NEXT_PUBLIC_DECIBEL_NETWORK ||
    process.env.NEXT_PUBLIC_APTOS_NETWORK;
  return env === "mainnet" ? "mainnet" : "testnet";
}

function cleanApiKey(key: string | undefined) {
  return key?.replace(/\\n/g, "").replace(/\n/g, "").trim() || undefined;
}

function getAptosApiKey(network: DecibelNetwork) {
  return cleanApiKey(
    network === "mainnet"
      ? process.env.APTOS_API_KEY_MAINNET ||
          process.env.APTOS_NODE_API_KEY_MAINNET ||
          process.env.GEOMI_API_KEY_MAINNET ||
          process.env.APTOS_API_KEY ||
          process.env.APTOS_NODE_API_KEY ||
          process.env.GEOMI_API_KEY
      : process.env.APTOS_API_KEY_TESTNET ||
          process.env.APTOS_NODE_API_KEY_TESTNET ||
          process.env.GEOMI_API_KEY_TESTNET ||
          process.env.APTOS_NODE_API_KEY ||
          process.env.APTOS_API_KEY ||
          process.env.GEOMI_API_KEY,
  );
}

function getAptos(network: DecibelNetwork) {
  const apiKey = getAptosApiKey(network);
  return new Aptos(
    new AptosConfig({
      network: network === "mainnet" ? Network.MAINNET : Network.TESTNET,
      clientConfig: apiKey
        ? network === "mainnet"
          ? { API_KEY: apiKey }
          : { HEADERS: { Authorization: `Bearer ${apiKey}` } }
        : undefined,
    }),
  );
}

function getDecibelPackage(network: DecibelNetwork) {
  return network === "mainnet" ? MAINNET_DECIBEL_PACKAGE : TESTNET_DECIBEL_PACKAGE;
}

function normalizeAddress(value: unknown, fieldName: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  try {
    return AccountAddress.fromString(value.trim()).toString();
  } catch {
    throw new Error(`${fieldName} must be a valid Aptos address`);
  }
}

function optionalAddress(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") return undefined;
  return normalizeAddress(value, fieldName);
}

function clampAllocationPct(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.min(100, Math.max(0.1, n));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getVaultField(value: unknown): string | null {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  const inner = record?.inner;
  return typeof inner === "string" ? inner : null;
}

function extractVaultAddressFromCreateTx(tx: CommittedTransactionResponse) {
  const txEvents = asRecord(tx)?.events;
  if (!Array.isArray(txEvents)) {
    throw new Error("Transaction does not include events");
  }

  for (const event of txEvents) {
    const eventRecord = asRecord(event);
    if (!eventRecord) continue;
    const type = eventRecord.type;
    if (typeof type !== "string" || !type.includes("::vault::VaultCreatedEvent")) {
      continue;
    }

    const data = asRecord(eventRecord.data);
    const vaultAddress =
      getVaultField(data?.vault) ??
      getVaultField(data?.vault_address) ??
      getVaultField(data?.vaultAddress);

    if (vaultAddress) return normalizeAddress(vaultAddress, "vaultAddress");
  }

  throw new Error("Unable to extract vault address from transaction");
}

async function getVaultPortfolioSubaccounts(
  aptos: Aptos,
  network: DecibelNetwork,
  vaultAddress: string,
) {
  const result = await aptos.view({
    payload: {
      function: `${getDecibelPackage(network)}::vault::get_vault_portfolio_subaccounts`,
      typeArguments: [],
      functionArguments: [vaultAddress],
    },
  });
  const first = result[0];
  return Array.isArray(first)
    ? first.map((address) => normalizeAddress(address, "vaultPortfolioSubaccount"))
    : [];
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as ExtractVaultBody;
    const txHash = body.txHash ?? body.transactionHash ?? body.hash;
    if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]+$/.test(txHash.trim())) {
      return NextResponse.json({ error: "txHash is required" }, { status: 400 });
    }

    const network = getNetwork(body.network);
    const aptos = getAptos(network);
    const tx = await aptos.waitForTransaction({
      transactionHash: txHash.trim(),
      options: { timeoutSecs: 45, checkSuccess: true },
    });
    const vaultAddress = extractVaultAddressFromCreateTx(tx);
    const portfolioSubaccounts = await getVaultPortfolioSubaccounts(
      aptos,
      network,
      vaultAddress,
    ).catch(() => []);
    const decibelSubaccount =
      optionalAddress(body.decibelSubaccount, "decibelSubaccount") ??
      portfolioSubaccounts[0] ??
      vaultAddress;

    let strategyVault = null;
    let linkReason: string | null = null;

    if (body.strategyVaultId) {
      const existing = await prisma.strategyVault.findUnique({
        where: { id: body.strategyVaultId },
      });
      if (!existing) {
        return NextResponse.json(
          { error: "Strategy vault not found", vaultAddress, network },
          { status: 404 },
        );
      }

      strategyVault = await prisma.strategyVault.update({
        where: { id: body.strategyVaultId },
        data: {
          vaultAddr: vaultAddress,
          decibelSubaccount,
          ...(body.marketName ? { marketName: body.marketName.trim() } : {}),
          ...(body.allocationPct !== undefined
            ? { allocationPct: clampAllocationPct(body.allocationPct) }
            : {}),
          ...(body.status ? { status: body.status } : {}),
        },
      });
    } else if (body.indicatorAddr && body.ownerWallet && body.marketName) {
      const indicatorAddr = normalizeAddress(body.indicatorAddr, "indicatorAddr");
      const ownerWallet = normalizeAddress(body.ownerWallet, "ownerWallet");
      const marketName = body.marketName.trim();
      if (!marketName) throw new Error("marketName is required");

      strategyVault = await prisma.strategyVault.upsert({
        where: {
          indicatorAddr_ownerWallet: {
            indicatorAddr,
            ownerWallet,
          },
        },
        create: {
          indicatorAddr,
          ownerWallet,
          marketName,
          allocationPct: clampAllocationPct(body.allocationPct),
          vaultAddr: vaultAddress,
          decibelSubaccount,
          status: body.status ?? "ACTIVE",
        },
        update: {
          marketName,
          allocationPct: clampAllocationPct(body.allocationPct),
          vaultAddr: vaultAddress,
          decibelSubaccount,
          status: body.status ?? "ACTIVE",
        },
      });
    } else {
      linkReason =
        "Pass strategyVaultId or indicatorAddr + ownerWallet + marketName to link this vault to an indicator strategy.";
    }

    return NextResponse.json({
      success: true,
      network,
      txHash: tx.hash,
      txVersion: tx.version,
      vaultAddress,
      portfolioSubaccounts,
      decibelSubaccount,
      strategyVault,
      linkReason,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to extract Decibel vault address";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
