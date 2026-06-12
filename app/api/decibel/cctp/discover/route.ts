import { NextRequest, NextResponse } from "next/server";
import { AbiCoder, JsonRpcProvider } from "ethers";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import type { DecibelNetwork } from "@/lib/decibel";
import { getEvmCctpConfig, type EvmCctpSourceChain } from "@/lib/evm-cctp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
// Three parallel chain scans, each capped at 30s — give the function headroom
// beyond the platform's 15s default.
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

// CCTP v1 TokenMessenger event (destinationCaller is bytes32):
// DepositForBurn(uint64 indexed nonce, address indexed burnToken, uint256 amount,
//   address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain,
//   bytes32 destinationTokenMessenger, bytes32 destinationCaller)
const DEPOSIT_FOR_BURN_TOPIC0 =
  "0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0";
const APTOS_CCTP_DOMAIN = 9;

const SOURCE_CHAINS: EvmCctpSourceChain[] = ["Arbitrum", "Base", "Ethereum"];

// Per-chain scan strategy, verified empirically against the public RPCs:
// Arbitrum's RPC accepts a single 60M-block topic-filtered query (~170 days);
// Base and Ethereum (publicnode) cap eth_getLogs at 50k blocks per call, so
// those chains scan in chunks with bounded concurrency.
const SCAN_CONFIG: Record<
  EvmCctpSourceChain,
  { spanBlocks: number; chunkBlocks: number; scanRpcUrl?: string }
> = {
  Arbitrum: { spanBlocks: 60_000_000, chunkBlocks: 60_000_000 }, // ~170d, 1 call
  Base: {
    spanBlocks: 1_000_000, // ~23d at 2s blocks
    chunkBlocks: 50_000, // 20 calls
    scanRpcUrl: "https://base-rpc.publicnode.com",
  },
  Ethereum: { spanBlocks: 450_000, chunkBlocks: 50_000 }, // ~60d, 9 calls
};

const CHUNK_CONCURRENCY = 10;
const PER_CHAIN_TIMEOUT_MS = 30_000;

export interface DiscoveredBurn {
  sourceChain: EvmCctpSourceChain;
  txHash: string;
  amount: number;
  mintRecipient: string;
  blockNumber: number;
  timestamp: number | null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("scan timed out")), ms),
    ),
  ]);
}

async function scanChain(
  network: DecibelNetwork,
  sourceChain: EvmCctpSourceChain,
  depositor: string,
): Promise<DiscoveredBurn[]> {
  const config = getEvmCctpConfig(network, sourceChain);
  const scan = SCAN_CONFIG[sourceChain];
  const provider = new JsonRpcProvider(scan.scanRpcUrl ?? config.rpcUrl, undefined, {
    staticNetwork: true,
  });
  const latest = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latest - scan.spanBlocks);
  const depositorTopic = `0x${depositor.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

  // Newest-first chunks so recent transfers surface even if older chunks fail.
  const chunks: Array<{ from: number; to: number }> = [];
  for (let to = latest; to > fromBlock; to -= scan.chunkBlocks) {
    chunks.push({ from: Math.max(fromBlock, to - scan.chunkBlocks + 1), to });
  }
  const logs: Awaited<ReturnType<typeof provider.getLogs>> = [];
  for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
    const batch = await Promise.all(
      chunks.slice(i, i + CHUNK_CONCURRENCY).map((c) =>
        provider.getLogs({
          address: config.tokenMessenger,
          topics: [DEPOSIT_FOR_BURN_TOPIC0, null, null, depositorTopic],
          fromBlock: c.from,
          toBlock: c.to,
        }),
      ),
    );
    logs.push(...batch.flat());
  }

  const coder = AbiCoder.defaultAbiCoder();
  const burns: DiscoveredBurn[] = [];
  for (const log of logs) {
    try {
      const [amount, mintRecipient, destinationDomain] = coder.decode(
        ["uint256", "bytes32", "uint32", "bytes32", "bytes32"],
        log.data,
      );
      if (Number(destinationDomain) !== APTOS_CCTP_DOMAIN) continue;
      burns.push({
        sourceChain,
        txHash: log.transactionHash,
        amount: Number(amount) / 1_000_000,
        mintRecipient: String(mintRecipient).toLowerCase(),
        blockNumber: log.blockNumber,
        timestamp: null,
      });
    } catch {
      // Skip undecodable logs rather than failing the whole scan.
    }
  }

  // Few hits expected; stamp real times so the client can sort/display them.
  await Promise.all(
    burns.map(async (b) => {
      try {
        const block = await provider.getBlock(b.blockNumber);
        b.timestamp = block ? block.timestamp * 1000 : null;
      } catch {
        b.timestamp = null;
      }
    }),
  );
  return burns;
}

export async function GET(req: NextRequest) {
  // The scan fans out dozens of public-RPC getLogs calls — keep it scarce.
  const rate = checkApiRateLimit(req, "cctp-discover", 6, 600_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }
  const address = req.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json(
      { error: "address must be a 0x-prefixed EVM address" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const networkParam = req.nextUrl.searchParams.get("network") ?? "mainnet";
  if (networkParam !== "mainnet" && networkParam !== "testnet") {
    return NextResponse.json(
      { error: "network must be mainnet or testnet" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const network = networkParam as DecibelNetwork;

  const results = await Promise.all(
    SOURCE_CHAINS.map(async (chain) => {
      try {
        const burns = await withTimeout(
          scanChain(network, chain, address),
          PER_CHAIN_TIMEOUT_MS,
        );
        return { chain, burns, error: null };
      } catch (error) {
        return {
          chain,
          burns: [] as DiscoveredBurn[],
          error: error instanceof Error ? error.message : "scan failed",
        };
      }
    }),
  );

  const burns = results
    .flatMap((r) => r.burns)
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const errors = Object.fromEntries(
    results.filter((r) => r.error).map((r) => [r.chain, r.error]),
  );

  return NextResponse.json(
    { address: address.toLowerCase(), network, burns, errors, fetchedAt: Date.now() },
    { headers: NO_STORE_HEADERS },
  );
}
