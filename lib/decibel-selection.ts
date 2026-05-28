export interface SelectableDecibelSubaccount {
  address: string;
  isPrimary?: boolean;
}

const BASE_KEY = "decibel:selected-subaccount";
const CHANGE_EVENT = "decibel-subaccount-change";
const POSITIONS_REFRESH_EVENT = "decibel-positions-refresh";

function storageKey(owner?: string | null) {
  return owner ? `${BASE_KEY}:${owner}` : BASE_KEY;
}

export function getStoredDecibelSubaccount(owner?: string | null): string | null {
  if (typeof window === "undefined") return null;
  return (
    window.localStorage.getItem(storageKey(owner)) ||
    window.localStorage.getItem(BASE_KEY)
  );
}

export function storeDecibelSubaccount(
  subaccount: string | null,
  owner?: string | null
) {
  if (typeof window === "undefined") return;
  const keys = [BASE_KEY, storageKey(owner)];
  for (const key of keys) {
    if (subaccount) {
      window.localStorage.setItem(key, subaccount);
    } else {
      window.localStorage.removeItem(key);
    }
  }
  window.dispatchEvent(
    new CustomEvent(CHANGE_EVENT, {
      detail: { owner, subaccount },
    })
  );
}

export function pickDecibelSubaccount<T extends SelectableDecibelSubaccount>(
  subaccounts: T[],
  owner?: string | null,
  preferred?: string | null
): string | null {
  const stored = getStoredDecibelSubaccount(owner);
  const candidates = [preferred, stored];
  for (const candidate of candidates) {
    if (candidate && subaccounts.some((s) => s.address === candidate)) {
      return candidate;
    }
  }
  return (
    subaccounts.find((subaccount) => subaccount.isPrimary)?.address ??
    subaccounts[0]?.address ??
    null
  );
}

export function onDecibelSubaccountChange(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function emitDecibelPositionsRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(POSITIONS_REFRESH_EVENT));
}

export function onDecibelPositionsRefresh(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener(POSITIONS_REFRESH_EVENT, handler);
  return () => window.removeEventListener(POSITIONS_REFRESH_EVENT, handler);
}
