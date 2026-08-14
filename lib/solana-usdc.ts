/**
 * Read-only Solana USDC lookup for Solana-derived wallet connections.
 *
 * A Backpack/Phantom user connected through the Solana-derived Aptos identity
 * sees "Wallet 0 USDC" while their actual USDC sits on Solana — the deposit UI
 * only ever read the Aptos side, which made the app look broken. This reads
 * the Solana side so the UI can show the balance and point it at the bridge.
 */

const SOLANA_MAINNET_RPC = "https://api.mainnet-beta.solana.com";
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

/** Sum of the owner's USDC token accounts on Solana mainnet, or null on failure. */
export async function fetchSolanaUsdcBalance(
  owner: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const res = await fetch(SOLANA_MAINNET_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [owner, { mint: SOLANA_USDC_MINT }, { encoding: "jsonParsed" }],
    }),
    signal,
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    result?: {
      value?: Array<{
        account?: {
          data?: {
            parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } };
          };
        };
      }>;
    };
  } | null;
  const accounts = body?.result?.value;
  if (!Array.isArray(accounts)) return null;
  let total = 0;
  for (const entry of accounts) {
    const amount = entry.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
    if (typeof amount === "number" && Number.isFinite(amount)) total += amount;
  }
  return total;
}
