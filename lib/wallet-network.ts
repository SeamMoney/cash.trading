/**
 * Pre-submit wallet/app network guard (UI-flow check).
 *
 * The app's Decibel network selection and the wallet's own network are two
 * independent settings. When they disagree, network-specific payloads (the
 * testnet USDC faucet, deposits, orders) reach the wallet and die in
 * simulation with a raw `module_not_found` error. Call this before
 * signAndSubmitTransaction and surface the message instead.
 */
export function walletNetworkMismatchMessage(
  walletNetworkName: string | null | undefined,
  appNetwork: string,
): string | null {
  const walletNet = walletNetworkName?.toLowerCase().trim() ?? "";
  // Unknown wallet network (some adapters omit it) — don't block, the warning
  // banner in the account modal still covers the visible mismatch case.
  if (!walletNet) return null;
  if (walletNet === appNetwork.toLowerCase()) return null;
  return `Your wallet is on ${walletNet} but this action needs ${appNetwork}. Switch the network inside your wallet app, then try again.`;
}
