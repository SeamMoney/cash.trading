/**
 * Decibel entry functions the gas sponsor will pay for. One definition shared
 * by the server route that enforces it and the client that decides whether a
 * sponsored submission is even worth asking the wallet to sign.
 */
export const SPONSORABLE_DEX_ACCOUNT_FUNCTIONS = new Set([
  "approve_max_builder_fee_for_subaccount",
  "cancel_order_to_subaccount",
  "create_new_subaccount",
  "deposit_to_subaccount_at",
  "place_order_to_subaccount",
  "revoke_max_builder_fee_for_subaccount",
  "withdraw_from_subaccount",
]);

/** True when an entry-function id (`0xpkg::module::name`) is sponsorable. */
export function isSponsorableEntryFunction(functionId: string): boolean {
  const parts = functionId.split("::");
  if (parts.length !== 3) return false;
  return parts[1] === "dex_accounts_entry" && SPONSORABLE_DEX_ACCOUNT_FUNCTIONS.has(parts[2]);
}
