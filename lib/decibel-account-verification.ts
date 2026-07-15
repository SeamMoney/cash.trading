import { getFastSubaccounts } from "@/lib/decibel-chain";
import {
  getReadDex,
  normalizeAptosAddress,
  type DecibelNetwork,
} from "@/lib/decibel";

const REST_TIMEOUT_MS = 4_000;

export async function verifyDecibelSubaccountOwnership(args: {
  owner: string;
  subaccount: string;
  network: DecibelNetwork;
}): Promise<{ owned: boolean; lookupIncomplete: boolean }> {
  const owner = normalizeAptosAddress(args.owner, "owner");
  const subaccount = normalizeAptosAddress(args.subaccount, "subaccount");

  try {
    const chainSubaccounts = await getFastSubaccounts(owner, args.network);
    if (
      chainSubaccounts.some(
        (item) => normalizeAptosAddress(item.address).toLowerCase() === subaccount.toLowerCase(),
      )
    ) {
      return { owned: true, lookupIncomplete: false };
    }
  } catch {
    // The indexed fallback below is authoritative for non-primary accounts.
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);
  try {
    const dex = getReadDex(args.network);
    const subaccounts = await dex.userSubaccounts.getByAddr({
      ownerAddr: owner,
      fetchOptions: { signal: controller.signal },
    });
    const owned = subaccounts.some(
      (item: { subaccount_address: string; is_active?: boolean }) =>
        item.is_active !== false &&
        normalizeAptosAddress(item.subaccount_address).toLowerCase() === subaccount.toLowerCase(),
    );
    return { owned, lookupIncomplete: false };
  } catch {
    return { owned: false, lookupIncomplete: true };
  } finally {
    clearTimeout(timeout);
  }
}
