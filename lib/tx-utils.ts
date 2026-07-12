import { explorerTxUrl } from "./constants";
import { aptos } from "./aptos";

/**
 * Shared transaction utility for the payload-builder pattern.
 *
 * 1. POST to a server API route that returns { payload }
 * 2. Sign and submit via the wallet adapter
 * 3. Return the tx hash
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SignFn = (transaction: any) => Promise<any>;

export async function buildAndSign(
  apiUrl: string,
  body: Record<string, unknown>,
  signAndSubmitTransaction: SignFn,
  shouldSign: () => boolean = () => true,
): Promise<{ hash: string; explorerUrl: string }> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json();

  if (!res.ok || json.error) {
    throw new Error(json.error || `API returned ${res.status}`);
  }

  const { payload } = json;
  if (!payload) {
    throw new Error("API did not return a payload");
  }
  if (!shouldSign()) {
    throw new Error("Transaction context changed before signing");
  }

  const result = await signAndSubmitTransaction({ data: payload });

  return {
    hash: result.hash,
    explorerUrl: explorerTxUrl(result.hash),
  };
}

export async function waitForTransactionConfirmation(hash: string) {
  const tx = await aptos.waitForTransaction({ transactionHash: hash });
  if ("success" in tx && tx.success === false) {
    throw new Error(tx.vm_status || "Transaction failed on-chain");
  }
  return tx;
}

export async function buildSignAndWait(
  apiUrl: string,
  body: Record<string, unknown>,
  signAndSubmitTransaction: SignFn
): Promise<{ hash: string; explorerUrl: string }> {
  const result = await buildAndSign(apiUrl, body, signAndSubmitTransaction);
  await waitForTransactionConfirmation(result.hash);
  return result;
}

// Wallet-adapter signTransaction shape (sign without submitting), used for
// the sponsored path where the server fee-payer completes the transaction.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SignTransactionFn = (args: { transactionOrPayload: any; asFeePayer?: boolean }) => Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticator: any;
  rawTransaction: Uint8Array;
}>;

/**
 * Sign a payload with the connected wallet but let the server fee-payer
 * cover gas via /api/decibel/sponsor-submit. For senders with no APT
 * (e.g. derived accounts that only ever received bridged USDC).
 */
export async function signAndSubmitSponsored(args: {
  senderAddress: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  signTransaction: SignTransactionFn;
}): Promise<{ hash: string; explorerUrl: string }> {
  const transaction = await aptos.transaction.build.simple({
    sender: args.senderAddress,
    data: args.payload,
    withFeePayer: true,
    // Sponsor route caps max_gas_amount * gas_unit_price at 0.05 APT.
    options: { maxGasAmount: 20_000 },
  });

  const { authenticator } = await args.signTransaction({
    transactionOrPayload: transaction,
  });

  const res = await fetch("/api/decibel/sponsor-submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactionHex: transaction.bcsToHex().toString(),
      senderAuthenticatorHex: authenticator.bcsToHex().toString(),
    }),
  });
  const data = (await res.json().catch(() => null)) as
    | { hash?: string; error?: string; reason?: string }
    | null;
  if (!res.ok || !data?.hash) {
    throw new Error(
      data?.error || data?.reason || `Gas sponsor rejected the transaction (${res.status}).`
    );
  }
  return { hash: data.hash, explorerUrl: explorerTxUrl(data.hash) };
}

/**
 * buildAndSign, but routed through the gas sponsor: fetches the payload from
 * the API route, signs with the wallet, and submits with the server fee-payer.
 */
export async function buildAndSignSponsored(
  apiUrl: string,
  body: Record<string, unknown>,
  opts: { senderAddress: string; signTransaction: SignTransactionFn }
): Promise<{ hash: string; explorerUrl: string }> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error || `API returned ${res.status}`);
  }
  if (!json.payload) {
    throw new Error("API did not return a payload");
  }
  return signAndSubmitSponsored({
    senderAddress: opts.senderAddress,
    payload: json.payload,
    signTransaction: opts.signTransaction,
  });
}
