"use client";

import { waitForTransactionConfirmation } from "@/lib/tx-utils";

/**
 * Builder-fee consent, folded into the first trade.
 *
 * Decibel only lets a builder collect its fee from accounts that signed a
 * one-time on-chain approval. Parked as a button on the portfolio page nobody
 * found it — trades went out with empty builder args and the code earned
 * nothing. Instead, the order flow calls this right before building the
 * order: the first trade asks for two signatures (approve, then trade), and
 * every trade after that skips straight through.
 *
 * Never blocks trading: any failure — user denies, lookup down — degrades to
 * placing the order without the code.
 */

type SignAndSubmit = (input: { data: never }) => Promise<{ hash: string }>;

/** Subaccounts confirmed approved (or builder disabled) this session. */
const settled = new Set<string>();

export async function ensureBuilderApproval(args: {
  subaccount: string;
  network: string;
  signAndSubmit: SignAndSubmit;
  onStep?: (message: string) => void;
}): Promise<void> {
  const key = `${args.network}:${args.subaccount}`.toLowerCase();
  if (settled.has(key)) return;

  try {
    const params = new URLSearchParams({ subaccount: args.subaccount, network: args.network });
    const statusRes = await fetch(`/api/decibel/builder?${params}`, { cache: "no-store" });
    const status = (await statusRes.json().catch(() => null)) as {
      enabled?: boolean;
      enrollmentOpen?: boolean;
      approval?: { approved?: boolean; readable?: boolean };
    } | null;
    if (!statusRes.ok || !status) return; // transient — retry on the next trade
    if (!status.enabled || !status.enrollmentOpen) {
      settled.add(key);
      return;
    }
    if (status.approval?.approved) {
      settled.add(key);
      return;
    }
    // An unreadable approval is indistinguishable from "not approved"; asking
    // for a redundant approval signature is safe (it is idempotent on-chain),
    // so proceed.

    const payloadRes = await fetch("/api/decibel/builder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", subaccount: args.subaccount, network: args.network }),
    });
    const payloadBody = (await payloadRes.json().catch(() => null)) as
      | { payload?: unknown; error?: string }
      | null;
    if (!payloadRes.ok || !payloadBody?.payload) return;

    args.onStep?.("One-time setup: approve fee routing in your wallet...");
    const { hash } = await args.signAndSubmit({ data: payloadBody.payload as never });
    args.onStep?.("Confirming fee routing approval...");
    await waitForTransactionConfirmation(hash);
    settled.add(key);
  } catch {
    // Degrade to a code-less order rather than blocking the trade.
  }
}
