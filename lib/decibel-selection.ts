export interface SelectableDecibelSubaccount {
  address: string;
  isPrimary?: boolean;
}

const BASE_KEY = "decibel:selected-subaccount";
const CHANGE_EVENT = "decibel-subaccount-change";
const POSITIONS_REFRESH_EVENT = "decibel-positions-refresh";

export function decibelSubaccountStorageKey(
  owner?: string | null,
  network?: string | null,
) {
  const normalizedOwner = owner?.trim().toLowerCase();
  if (!normalizedOwner) return BASE_KEY;
  return network
    ? `${BASE_KEY}:${normalizedOwner}:${network}`
    : `${BASE_KEY}:${normalizedOwner}`;
}

export function getStoredDecibelSubaccount(
  owner?: string | null,
  network?: string | null,
): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(decibelSubaccountStorageKey(owner, network));
}

export function storeDecibelSubaccount(
  subaccount: string | null,
  owner?: string | null,
  network?: string | null,
) {
  if (typeof window === "undefined") return;
  const key = decibelSubaccountStorageKey(owner, network);
  if (subaccount) {
    window.localStorage.setItem(key, subaccount);
  } else {
    window.localStorage.removeItem(key);
  }
  if (owner && network) {
    window.localStorage.removeItem(BASE_KEY);
    window.localStorage.removeItem(decibelSubaccountStorageKey(owner));
  }
  window.dispatchEvent(
    new CustomEvent(CHANGE_EVENT, {
      detail: { network, owner, subaccount },
    })
  );
}

export function pickDecibelSubaccount<T extends SelectableDecibelSubaccount>(
  subaccounts: T[],
  owner?: string | null,
  preferred?: string | null,
  network?: string | null,
): string | null {
  const stored = getStoredDecibelSubaccount(owner, network);
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
