export function isValidAptosAddressText(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(value);
}

export function normalizeAptosAddressText(value: unknown, fieldName = "address") {
  if (!isValidAptosAddressText(value)) {
    throw new Error(`${fieldName} must be a valid Aptos address`);
  }
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

export function getMainnetAptosApiKey() {
  const value = process.env.APTOS_API_KEY_MAINNET
    || process.env.APTOS_NODE_API_KEY_MAINNET
    || process.env.GEOMI_API_KEY_MAINNET
    || process.env.APTOS_API_KEY
    || process.env.APTOS_NODE_API_KEY
    || process.env.GEOMI_API_KEY;
  const cleaned = value?.replace(/\\n/g, "").replace(/\n/g, "").trim();
  return cleaned || undefined;
}

function getTrustedCustomMainnetAptosApiKey() {
  const value = process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_API_KEY;
  const cleaned = value?.replace(/\\n/g, "").replace(/\n/g, "").trim();
  return cleaned || undefined;
}

export const DEFAULT_APTOS_MAINNET_FULLNODE = "https://api.mainnet.aptoslabs.com/v1";
const DEFAULT_APTOS_MAINNET_ORIGIN = "https://api.mainnet.aptoslabs.com";
const MAX_MAINNET_LEDGER_AGE_MS = 60_000;
const MAX_MAINNET_LEDGER_FUTURE_SKEW_MS = 10_000;

export interface MainnetAptosLedgerProof {
  chainId: 1;
  version: string;
  timestampUsec: string;
  observedAtMs: number;
}

export interface MainnetAptosResponseProof {
  chainId: 1;
  version: string;
  timestampUsec: string;
}

export function assertFreshMainnetAptosTimestamp(timestampUsec: string, nowMs = Date.now()) {
  if (!/^\d+$/.test(timestampUsec)) throw new Error("Aptos ledger timestamp is malformed");
  const observedUsec = BigInt(nowMs) * 1_000n;
  const ledgerUsec = BigInt(timestampUsec);
  if (
    ledgerUsec < observedUsec - BigInt(MAX_MAINNET_LEDGER_AGE_MS) * 1_000n
    || ledgerUsec > observedUsec + BigInt(MAX_MAINNET_LEDGER_FUTURE_SKEW_MS) * 1_000n
  ) {
    throw new Error("The Aptos mainnet ledger proof is stale or time-skewed");
  }
}

function exactHttpsOrigin(value: string, fieldName: string) {
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${fieldName} must be an exact HTTPS origin`);
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error(`${fieldName} must be an exact HTTPS origin`);
  }
  return url.origin;
}

export function getMainnetAptosFullnodeBase() {
  const raw = process.env.APTOS_NODE_URL_MAINNET ?? DEFAULT_APTOS_MAINNET_FULLNODE;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("APTOS_NODE_URL_MAINNET must be a valid HTTPS URL");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error("APTOS_NODE_URL_MAINNET must be a valid HTTPS URL");
  }
  const trustedOrigin = exactHttpsOrigin(
    process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN?.trim() ?? "",
    "CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN",
  );
  if (url.origin !== DEFAULT_APTOS_MAINNET_ORIGIN && url.origin !== trustedOrigin) {
    throw new Error(
      "A custom Aptos mainnet fullnode requires CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function mainnetAptosTarget(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("Aptos request path must stay within the configured fullnode base");
  }
  const base = getMainnetAptosFullnodeBase();
  const target = new URL(`${base}${path}`);
  const baseUrl = new URL(base);
  const basePath = baseUrl.pathname.replace(/\/+$/, "");
  if (
    target.origin !== baseUrl.origin
    || (target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`))
  ) {
    throw new Error("Aptos request path escaped the configured fullnode base");
  }
  return target;
}

export async function fetchMainnetAptos(
  path: string,
  init: RequestInit = {},
  options: { clientName?: string; timeoutMs?: number } = {},
) {
  const target = mainnetAptosTarget(path);
  const apiKey = target.origin === DEFAULT_APTOS_MAINNET_ORIGIN
    ? getMainnetAptosApiKey()
    : getTrustedCustomMainnetAptosApiKey();
  const headers = new Headers(init.headers);
  headers.delete("authorization");
  headers.delete("proxy-authorization");
  headers.set("accept", "application/json");
  headers.set("x-aptos-client", options.clientName ?? "cash-trading/cash-orderbook");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const signals = [AbortSignal.timeout(options.timeoutMs ?? 4_000)];
  if (init.signal) signals.push(init.signal);

  const request = (withKey: boolean) => {
    const requestHeaders = new Headers(headers);
    if (withKey && apiKey) requestHeaders.set("authorization", `Bearer ${apiKey}`);
    return fetch(target, {
      ...init,
      cache: "no-store",
      redirect: "error",
      headers: requestHeaders,
      signal: AbortSignal.any(signals),
    });
  };

  let response = await request(Boolean(apiKey));
  if (apiKey && (response.status === 401 || response.status === 403)) {
    await response.body?.cancel();
    response = await request(false);
  }
  return response;
}

export async function requireMainnetAptosResponse(
  response: Response,
  minimumLedgerVersion: string,
  nowMs = Date.now(),
): Promise<MainnetAptosResponseProof> {
  try {
    if (!/^\d+$/.test(minimumLedgerVersion)) {
      throw new Error("Pinned Aptos ledger version is malformed");
    }
    const chainId = response.headers.get("x-aptos-chain-id") ?? "";
    const version = response.headers.get("x-aptos-ledger-version") ?? "";
    const timestampUsec = response.headers.get("x-aptos-ledger-timestampusec") ?? "";
    if (chainId !== "1" || !/^\d+$/.test(version) || !/^\d+$/.test(timestampUsec)) {
      throw new Error("Aptos state response is missing canonical mainnet ledger headers");
    }
    if (BigInt(version) < BigInt(minimumLedgerVersion)) {
      throw new Error("Aptos state response predates the pinned ledger snapshot");
    }
    assertFreshMainnetAptosTimestamp(timestampUsec, nowMs);
    return { chainId: 1, version, timestampUsec };
  } catch (error) {
    await response.body?.cancel();
    throw error;
  }
}

export function mainnetAptosStatePath(path: string, ledgerVersion: string) {
  if (!/^\d+$/.test(ledgerVersion)) throw new Error("Aptos ledger version is malformed");
  const base = getMainnetAptosFullnodeBase();
  const target = mainnetAptosTarget(path);
  const existing = target.searchParams.getAll("ledger_version");
  if (existing.length > 1 || (existing[0] && existing[0] !== ledgerVersion)) {
    throw new Error("Aptos state read requested a different ledger version");
  }
  target.searchParams.set("ledger_version", ledgerVersion);
  const basePath = new URL(base).pathname.replace(/\/+$/, "");
  const suffix = target.pathname.slice(basePath.length) || "/";
  return `${suffix.startsWith("/") ? suffix : `/${suffix}`}${target.search}`;
}

export async function readFreshMainnetAptosLedger(
  options: { clientName?: string; timeoutMs?: number; nowMs?: number } = {},
): Promise<MainnetAptosLedgerProof> {
  const response = await fetchMainnetAptos("/", {}, options);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Aptos ledger lookup failed (${response.status})`);
  }
  const ledger = await response.json() as {
    chain_id?: unknown;
    ledger_version?: unknown;
    ledger_timestamp?: unknown;
  };
  const version = String(ledger.ledger_version ?? "");
  const timestampUsec = String(ledger.ledger_timestamp ?? "");
  if (String(ledger.chain_id) !== "1") throw new Error("The configured fullnode is not Aptos mainnet");
  if (!/^\d+$/.test(version) || !/^\d+$/.test(timestampUsec)) {
    throw new Error("Aptos returned malformed ledger metadata");
  }
  const observedAtMs = options.nowMs ?? Date.now();
  assertFreshMainnetAptosTimestamp(timestampUsec, observedAtMs);
  return { chainId: 1, version, timestampUsec, observedAtMs };
}
