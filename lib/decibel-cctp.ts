import { MoveVector, type InputGenerateTransactionPayloadData } from "@aptos-labs/ts-sdk";
import type { DecibelNetwork } from "@/lib/decibel";

export type CctpChainName =
  | "Ethereum"
  | "Arbitrum"
  | "Base"
  | "Solana"
  | "Sui"
  | "Aptos"
  | "Sepolia"
  | "ArbitrumSepolia"
  | "BaseSepolia";

export type ParsedCctpMessage = {
  sourceDomain: number;
  sourceChain: CctpChainName | "Unknown";
  destinationDomain: number;
  destinationChain: CctpChainName | "Unknown";
  destinationCaller: string;
  nonce: string;
  mintRecipient: string;
  amount: number;
};

export const CCTP_DOMAIN_BY_CHAIN = {
  Ethereum: 0,
  Arbitrum: 3,
  Solana: 5,
  Base: 6,
  Sui: 8,
  Aptos: 9,
  Sepolia: 0,
  ArbitrumSepolia: 3,
  BaseSepolia: 6,
} as const satisfies Record<CctpChainName, number>;

export const APTOS_CCTP_HANDLE_RECEIVE_MESSAGE_BYTECODE: Record<DecibelNetwork, string> = {
  mainnet:
    "0xa11ceb0b0700000a0601000402040403080c051416072a53087d40000001010002000000030203000101040304000103060c0a020a020003060c060a02060a020108000101136d6573736167655f7472616e736d69747465720f746f6b656e5f6d657373656e67657207526563656970740f726563656976655f6d6573736167651668616e646c655f726563656976655f6d657373616765177e17751820e4b4371873ca8c30279be63bdea63b88ed0f2239c2eea10f17729bce6734f7b63e835108e3bd8c36743d4709fe435f44791918801d0989640a9d000001070b000e010e02110011010102",
  testnet:
    "0xa11ceb0b0700000a0601000402040403080c051416072a53087d40000001010002000000030203000101040304000103060c0a020a020003060c060a02060a020108000101136d6573736167655f7472616e736d69747465720f746f6b656e5f6d657373656e67657207526563656970740f726563656976655f6d6573736167651668616e646c655f726563656976655f6d657373616765081e86cebf457a0c6004f35bd648a2794698f52e0dde09a48619dcd3d4cc23d95f9b937419dda90aa06c1836b7847f65bbbe3f1217567758dc2488be31a477b9000001070b000e010e02110011010102",
};

const CCTP_CHAIN_BY_DOMAIN = Object.entries(CCTP_DOMAIN_BY_CHAIN).reduce(
  (acc, [chain, domain]) => {
    if (!acc[domain]) acc[domain] = chain as CctpChainName;
    return acc;
  },
  {} as Record<number, CctpChainName>
);

export function getCctpDomain(chain: string): number | null {
  const match = Object.keys(CCTP_DOMAIN_BY_CHAIN).find(
    (name) => name.toLowerCase() === chain.trim().toLowerCase()
  ) as CctpChainName | undefined;
  return match ? CCTP_DOMAIN_BY_CHAIN[match] : null;
}

export function getCctpChain(domain: number): CctpChainName | "Unknown" {
  return CCTP_CHAIN_BY_DOMAIN[domain] ?? "Unknown";
}

export function normalizeSourceTxHash(txHash: string): string {
  return txHash.trim();
}

function stripHexPrefix(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = stripHexPrefix(hex);
  if (normalized.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(normalized)) {
    throw new Error("Invalid hex bytes.");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes;
}

export function isLikelySourceTxHash(txHash: string): boolean {
  const trimmed = normalizeSourceTxHash(txHash);
  return (
    /^(0x)?[0-9a-fA-F]{64}$/.test(trimmed) ||
    /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(trimmed)
  );
}

export function isValidCctpAttestation(attestation?: string | null): boolean {
  if (!attestation || attestation === "PENDING") return false;
  const trimmed = attestation.startsWith("0x")
    ? attestation.slice(2)
    : attestation;
  return trimmed.length > 0 && /^[0-9a-fA-F]+$/.test(trimmed);
}

function readUint32(hex: string, start: number): number {
  return Number.parseInt(hex.slice(start, start + 8), 16);
}

function readUint64(hex: string, start: number): string {
  return BigInt(`0x${hex.slice(start, start + 16)}`).toString();
}

function readUint256(hex: string, start: number): bigint {
  return BigInt(`0x${hex.slice(start, start + 64)}`);
}

export function parseCctpMessage(message: string): ParsedCctpMessage | null {
  const hex = stripHexPrefix(message);
  if (hex.length < 432 || !/^[0-9a-fA-F]+$/.test(hex)) return null;

  const sourceDomain = readUint32(hex, 8);
  const destinationDomain = readUint32(hex, 16);
  const nonce = readUint64(hex, 24);
  const destinationCaller = `0x${hex.slice(168, 232).toLowerCase()}`;
  const mintRecipient = `0x${hex.slice(304, 368).toLowerCase()}`;
  const rawAmount = readUint256(hex, 368);
  const whole = rawAmount / 1_000_000n;
  const fractional = rawAmount % 1_000_000n;

  return {
    sourceDomain,
    sourceChain: getCctpChain(sourceDomain),
    destinationDomain,
    destinationChain: getCctpChain(destinationDomain),
    destinationCaller,
    nonce,
    mintRecipient,
    amount: Number(whole) + Number(fractional) / 1_000_000,
  };
}

export function buildAptosCctpClaimPayload(args: {
  attestation: string;
  messageBytes: string;
  network: DecibelNetwork;
}): InputGenerateTransactionPayloadData {
  if (!isValidCctpAttestation(args.attestation)) {
    throw new Error("Circle attestation is not ready yet.");
  }

  return {
    bytecode: APTOS_CCTP_HANDLE_RECEIVE_MESSAGE_BYTECODE[args.network],
    functionArguments: [
      MoveVector.U8(hexToBytes(args.messageBytes)),
      MoveVector.U8(hexToBytes(args.attestation)),
    ],
  };
}

export function getSourceTxExplorerUrl(
  chain: string,
  txHash: string
): string | null {
  const normalized = normalizeSourceTxHash(txHash);
  const key = chain.trim().toLowerCase();
  if (key === "ethereum" || key === "sepolia") {
    return `https://${key === "sepolia" ? "sepolia." : ""}etherscan.io/tx/${normalized}`;
  }
  if (key === "arbitrum" || key === "arbitrumsepolia") {
    return `https://${key === "arbitrumsepolia" ? "sepolia." : ""}arbiscan.io/tx/${normalized}`;
  }
  if (key === "base" || key === "basesepolia") {
    return `https://${key === "basesepolia" ? "sepolia." : ""}basescan.org/tx/${normalized}`;
  }
  if (key === "solana") return `https://solscan.io/tx/${normalized}`;
  return null;
}
