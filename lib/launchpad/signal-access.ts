/**
 * In-memory signal access map for graduated indicator gating.
 * Key: indicator address
 * Value: Set of Whop membership IDs that have paid for access
 *
 * This module is imported by both the signals route and the webhook handler
 * so they share the same in-process Map. Fine for demo / single-instance
 * deployments (Vercel Fluid Functions keep state warm across requests).
 */

// indicatorAddr -> Set<membershipId>
export const signalAccess: Map<string, Set<string>> = new Map();

/** Grant a membership access to an indicator's live signal feed. */
export function grantAccess(indicatorAddr: string, membershipId: string) {
  if (!signalAccess.has(indicatorAddr)) {
    signalAccess.set(indicatorAddr, new Set());
  }
  signalAccess.get(indicatorAddr)!.add(membershipId);
  console.log(`[signal-access] GRANTED  mem=${membershipId}  ind=${indicatorAddr.slice(0, 10)}…`);
}

/** Revoke a membership's access to an indicator's live signal feed. */
export function revokeAccess(indicatorAddr: string, membershipId: string) {
  signalAccess.get(indicatorAddr)?.delete(membershipId);
  console.log(`[signal-access] REVOKED  mem=${membershipId}  ind=${indicatorAddr.slice(0, 10)}…`);
}

/** Check whether a membership currently has access. */
export function hasAccess(indicatorAddr: string, membershipId: string): boolean {
  return signalAccess.get(indicatorAddr)?.has(membershipId) ?? false;
}

/** Number of active subscribers for an indicator. */
export function subscriberCount(indicatorAddr: string): number {
  return signalAccess.get(indicatorAddr)?.size ?? 0;
}
