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
  signAndSubmitTransaction: SignFn
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
