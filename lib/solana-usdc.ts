/**
 * Read-only Solana USDC lookup for Solana-derived wallet connections.
 *
 * A Backpack/Phantom user connected through the Solana-derived Aptos identity
 * sees "Wallet 0 USDC" while their actual USDC sits on Solana — the deposit UI
 * only ever read the Aptos side, which made the app look broken. This reads
 * the Solana side so the UI can show the balance and point it at the bridge.
 */

/** Circle's native USDC mint on Solana mainnet. */
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/**
 * Base58 Solana address behind a Solana-derived Aptos wallet connection, or ""
 * for every other wallet kind. Duck-typed: `SolanaDerivedPublicKey` exposes a
 * `solanaPublicKey` (a web3 PublicKey with toBase58/toString).
 */
export function getSolanaAddressFromPublicKey(publicKey: unknown): string {
  if (!publicKey || typeof publicKey !== "object") return "";
  const inner = (publicKey as { solanaPublicKey?: unknown }).solanaPublicKey;
  if (!inner) return "";
  try {
    const asString =
      typeof (inner as { toBase58?: () => string }).toBase58 === "function"
        ? (inner as { toBase58: () => string }).toBase58()
        : String(inner);
    // Base58, 32-44 chars — reject anything that doesn't look like a pubkey.
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(asString) ? asString : "";
  } catch {
    return "";
  }
}

/**
 * Sum of the owner's USDC token accounts on Solana mainnet, or null on
 * failure. Read through our own API route: Solana's public RPC 403s/429s
 * requests straight from mobile browsers, which made real balances render as
 * "No Solana USDC found" on phones.
 */
export async function fetchSolanaUsdcBalance(
  owner: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const res = await fetch(`/api/solana/usdc?owner=${encodeURIComponent(owner)}`, {
    cache: "no-store",
    signal,
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { balance?: number } | null;
  return typeof body?.balance === "number" && Number.isFinite(body.balance)
    ? body.balance
    : null;
}
