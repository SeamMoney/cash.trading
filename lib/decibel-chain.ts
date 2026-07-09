import {
  AccountAddress,
  createObjectAddress,
  MoveString,
} from "@aptos-labs/ts-sdk";
import {
  getActiveNetwork,
  getDecibelCollateralMetadata,
  getDecibelMarketConfig,
  getDecibelPackage,
  getAptosFullnodeApiKey,
  getReadDex,
  MARKET_NAMES,
  MARKETS,
  PRICE_DECIMALS,
  USDC_DECIMALS,
  type DecibelNetwork,
} from "@/lib/decibel";

type ViewPayload = {
  function: string;
  typeArguments?: string[];
  functionArguments?: unknown[];
};

type RawRecord = Record<string, unknown>;

export interface ChainDecibelSubaccount {
  address: string;
  name: string | null;
  isPrimary: boolean;
  isActive: boolean;
  hasAssetsOrPositions: boolean;
}

export interface ChainDecibelPosition {
  market: string;
  marketAddress: string | null;
  size: number;
  isLong: boolean;
  leverage: number;
  entryPrice: number;
  /** Mark price; null when not enriched (e.g., on the 1s chainOnly hot path). */
  markPrice: number | null;
  /** Notional value at entry (abs(size) * entryPrice). */
  notionalEntry: number;
  /** abs(size) * markPrice when markPrice is available, otherwise null. */
  value: number | null;
  /** Long: (mark - entry) * abs(size); short: (entry - mark) * abs(size); null when no mark. */
  estimatedPnl: number | null;
  /** notionalEntry / leverage as a margin fallback for cross positions. */
  marginUsed: number;
  isIsolated: boolean;
  /**
   * Unrealized funding (USD). `null` distinguishes "chain/indexer didn't expose
   * it" from a true zero. Chain `list_positions` rarely populates this; the
   * SDK-indexed reader does.
   */
  unrealizedFunding: number | null;
  /**
   * Estimated liquidation price. `null` when the source didn't expose it (e.g.,
   * cross-margin positions on the chain payload). The SDK-indexed reader
   * populates this for known markets.
   */
  estimatedLiquidationPrice: number | null;
  tpOrderId: string | null;
  tpTriggerPrice: number | null;
  slOrderId: string | null;
  slTriggerPrice: number | null;
  /**
   * Where this row came from. Indexed rows are authoritative for human-scaled
   * size, liq, and funding; chain rows fill in only when the indexed reader
   * isn't available or times out.
   */
  source: "chain" | "indexed";
  /**
   * `true` when the parser had explicit decimals for this market (from the
   * server-side metadata cache, the nested `market` object on the chain
   * payload, or the static `MARKETS` map). `false` when the parser fell back
   * to defaults — the size in this row is then potentially mis-scaled.
   *
   * Indexed rows always set this to `true` (the SDK returns human-scaled
   * values regardless of decimals). The frontend uses this signal to avoid
   * regressing an indexed-correct row back to a wrong-decimals chain re-parse
   * during the cold-cache window.
   */
  decimalsKnown: boolean;
}

export interface ChainDecibelOverview {
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number | null;
  marginRatio: number;
  maintenanceMargin: number;
  leverage: number | null;
  totalMargin: number;
  crossWithdrawable: number;
  volume30d: number | null;
  totalNotional: number;
  collateral: number;
  hasAssetsOrPositions: boolean;
  source: "chain";
}

export interface ChainDecibelMarket {
  name: string;
  address: string;
  markPrice: number | null;
  midPrice: number | null;
  oraclePrice: number | null;
  fundingRateBps: number | null;
  isFundingPositive: boolean | null;
  openInterest: number | null;
  priceUpdatedAt: number | null;
  maxLeverage: number;
  tickSize: number;
  minSize: number;
  lotSize: number;
  mode: string;
  szDecimals: number;
  pxDecimals: number;
  source: "chain";
}

function getFullnodeUrl(network?: DecibelNetwork): string {
  const net = network ?? getActiveNetwork();
  return net === "mainnet"
    ? process.env.APTOS_NODE_URL_MAINNET ??
        "https://api.mainnet.aptoslabs.com/v1"
    : process.env.APTOS_NODE_URL_TESTNET ??
        "https://api.testnet.aptoslabs.com/v1";
}

function derivePrimarySubaccountAddress(owner: string, network?: DecibelNetwork) {
  const packageAddress = AccountAddress.fromString(getDecibelPackage(network));
  const deriver = createObjectAddress(
    packageAddress,
    new TextEncoder().encode("GlobalSubaccountManager")
  );
  const ownerBytes = AccountAddress.fromString(owner).toUint8Array();
  const seedBytes = new Uint8Array([
    ...ownerBytes,
    ...new MoveString("primary_subaccount").bcsToBytes(),
  ]);
  return createObjectAddress(deriver, seedBytes).toString();
}

async function view<T = unknown[]>(
  payload: ViewPayload,
  network?: DecibelNetwork
): Promise<T[]> {
  const net = network ?? getActiveNetwork();
  const apiKey = getAptosFullnodeApiKey(net);
  const body = JSON.stringify({
    function: payload.function,
    type_arguments: payload.typeArguments ?? [],
    arguments: payload.functionArguments ?? [],
  });
  const fetchView = (key?: string) =>
    fetch(`${getFullnodeUrl(net)}/view`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-aptos-client": "cash-trading/decibel-chain",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body,
    });

  let response = await fetchView(apiKey);
  if (apiKey && (response.status === 401 || response.status === 403)) {
    response = await fetchView();
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Aptos view failed (${response.status}) for ${payload.function}: ${text}`
    );
  }

  return (await response.json()) as T[];
}

async function safeView<T>(
  payload: ViewPayload,
  network?: DecibelNetwork
): Promise<T | null> {
  try {
    const result = await view<T>(payload, network);
    return result[0] ?? null;
  } catch {
    return null;
  }
}

async function safeViewAll<T>(
  payload: ViewPayload,
  network?: DecibelNetwork
): Promise<T[] | null> {
  try {
    return await view<T>(payload, network);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : null;
}

function pick(record: RawRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function rawToDecimal(value: unknown, decimals: number): number {
  const n = toNumber(value);
  if (n === null) return 0;
  return n / Math.pow(10, decimals);
}

function rawPrice(value: unknown, decimals = PRICE_DECIMALS): number {
  const n = toNumber(value);
  if (n === null) return 0;
  // Mainnet prices are 6-decimal raw values. Some testnet oracle mocks return
  // small whole-number fixtures, so do not scale values that are already human.
  if (Math.abs(n) > 0 && Math.abs(n) < Math.pow(10, Math.max(decimals - 2, 0))) {
    return n;
  }
  return n / Math.pow(10, decimals);
}

function rawUsd(value: unknown): number {
  return rawToDecimal(value, USDC_DECIMALS);
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function extractAddress(value: unknown): string | null {
  if (typeof value === "string" && value.startsWith("0x")) return value;
  const record = asRecord(value);
  if (!record) return null;

  const direct = pick(record, [
    "inner",
    "address",
    "addr",
    "account_address",
    "market_addr",
    "market_address",
  ]);
  if (typeof direct === "string" && direct.startsWith("0x")) return direct;

  for (const nested of Object.values(record)) {
    const nestedAddress = extractAddress(nested);
    if (nestedAddress) return nestedAddress;
  }

  return null;
}

function marketNameFromRaw(value: unknown): { market: string; address: string | null } {
  const direct = asString(value);
  if (direct && direct.includes("/")) return { market: direct, address: null };

  const address = extractAddress(value);
  if (!address) return { market: "Unknown", address: null };

  const market =
    MARKET_NAMES[address.toLowerCase()] ??
    Object.entries(MARKETS).find(
      ([, config]) => config.address.toLowerCase() === address.toLowerCase()
    )?.[0] ??
    "Unknown";

  return { market, address };
}

const NAME_FIELDS = [
  "market_name",
  "marketName",
  "name",
  "symbol",
  "asset",
  "base",
  "coin",
  "ticker",
];

/**
 * Pull a raw market name from `record` itself or from any nested record under
 * the `market` field. Some SDK payloads put identity inside `market` rather
 * than as sibling fields. Returns the value verbatim — callers must not
 * append `/USD` or otherwise mutate the registry-supplied name.
 */
function pickMarketName(record: RawRecord): string | null {
  const direct = asString(pick(record, NAME_FIELDS));
  if (direct) return direct;

  const marketField = pick(record, [
    "market",
    "market_addr",
    "marketAddress",
    "market_address",
    "perp_market",
  ]);
  const marketRecord = asRecord(marketField);
  if (marketRecord) {
    const nested = asString(pick(marketRecord, NAME_FIELDS));
    if (nested) return nested;
  }
  return null;
}

/**
 * Resolve a Decibel position's market label.
 *
 * Priority:
 *   1. Address-based lookup via MARKET_NAMES (canonical for known markets).
 *   2. Raw identity fields on the record or inside a nested `market` object —
 *      preserved verbatim. Non-crypto markets like SILVER/GOLD identify
 *      themselves this way; we must not mutate the registry name (no `/USD`
 *      suffix unless it's already there or it matches an existing MARKETS
 *      key).
 *   3. "Unknown" as a last resort. Caller may enrich later via the on-chain
 *      `perp_engine::market_name` registry.
 */
function resolveMarketIdentity(
  record: RawRecord
): { market: string; address: string | null } {
  const marketRaw = pick(record, [
    "market",
    "market_addr",
    "marketAddress",
    "market_address",
    "perp_market",
  ]);

  const directSlash = asString(marketRaw);
  if (directSlash && directSlash.includes("/")) {
    return { market: directSlash, address: extractAddress(marketRaw) };
  }

  const address = extractAddress(marketRaw);
  const known = address ? MARKET_NAMES[address.toLowerCase()] : null;
  if (known) return { market: known, address };

  const rawName = pickMarketName(record);
  if (rawName) {
    return { market: rawName, address };
  }

  return { market: "Unknown", address };
}

function optionValue(value: unknown): unknown | null {
  const record = asRecord(value);
  if (!record) return value ?? null;
  const vec = record.vec;
  if (Array.isArray(vec)) return vec[0] ?? null;
  return value;
}

function variantName(value: unknown, fallback = "Open"): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (!record) return fallback;
  const variant = asString(record.__variant__) ?? asString(record.variant);
  if (variant) return variant;
  const keys = Object.keys(record);
  return keys.length === 1 ? keys[0] : fallback;
}

function tryGetMarketConfig(market: string) {
  try {
    return getDecibelMarketConfig(market);
  } catch {
    return null;
  }
}

/**
 * Module-scope cache of market metadata learned from authoritative sources
 * (the SDK-indexed reader, the on-chain registry views, etc.). When the
 * chain hot path returns a row whose market isn't in our static `MARKETS`
 * map but has been seen before via an indexed source, we use the cached
 * decimals so the chain row scales correctly without needing the slower
 * indexed/registry call on every 1s tick.
 *
 * Keyed by lowercased marketAddress.
 */
interface MarketMetaCacheEntry {
  sizeDecimals: number;
  priceDecimals: number;
  marketName: string | null;
}

const marketMetaCache = new Map<string, MarketMetaCacheEntry>();

export function recordMarketMetadata(
  marketAddress: string,
  meta: Partial<MarketMetaCacheEntry>
): void {
  const key = marketAddress.toLowerCase();
  const existing = marketMetaCache.get(key);
  marketMetaCache.set(key, {
    sizeDecimals: meta.sizeDecimals ?? existing?.sizeDecimals ?? 8,
    priceDecimals:
      meta.priceDecimals ?? existing?.priceDecimals ?? PRICE_DECIMALS,
    marketName: meta.marketName ?? existing?.marketName ?? null,
  });
}

export function getCachedMarketMetadata(
  marketAddress: string
): MarketMetaCacheEntry | null {
  return marketMetaCache.get(marketAddress.toLowerCase()) ?? null;
}

/** Pull sz_decimals / px_decimals from a nested `market` object on the
 *  position record. Lets non-crypto markets (anything not in our static
 *  MARKETS map) scale size and price correctly using Decibel's own
 *  registry data, without us guessing or hardcoding specs. */
function decimalsFromNestedMarket(
  record: RawRecord
): { sizeDecimals: number | null; priceDecimals: number | null } {
  const marketField = pick(record, [
    "market",
    "market_addr",
    "marketAddress",
    "market_address",
    "perp_market",
  ]);
  const nested = asRecord(marketField);
  if (!nested) return { sizeDecimals: null, priceDecimals: null };
  return {
    sizeDecimals: toNumber(
      pick(nested, ["sz_decimals", "szDecimals", "size_decimals"])
    ),
    priceDecimals: toNumber(
      pick(nested, ["px_decimals", "pxDecimals", "price_decimals"])
    ),
  };
}

/** rawUsd that returns null when the value is missing/non-numeric, instead
 *  of conflating "unset" with a true zero. */
function rawUsdOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = toNumber(value);
  if (n === null) return null;
  return n / Math.pow(10, USDC_DECIMALS);
}

/** rawPrice that returns null when the value is missing or zero, so the UI
 *  can render `—` instead of an unsupported placeholder. */
function rawPriceOrNull(value: unknown, decimals: number): number | null {
  if (value === null || value === undefined) return null;
  const n = toNumber(value);
  if (n === null) return null;
  if (Math.abs(n) > 0 && Math.abs(n) < Math.pow(10, Math.max(decimals - 2, 0))) {
    return n;
  }
  const scaled = n / Math.pow(10, decimals);
  return scaled === 0 ? null : scaled;
}

function parsePositionRecord(raw: unknown): ChainDecibelPosition | null {
  const record = asRecord(optionValue(raw));
  if (!record) return null;

  const { market, address } = resolveMarketIdentity(record);
  const marketConfig = tryGetMarketConfig(market);
  const nestedDecimals = decimalsFromNestedMarket(record);
  const cached = address ? getCachedMarketMetadata(address) : null;
  // Cache wins, then nested-record decimals (raw payload), then static
  // MARKETS config, then defaults. Cache is highest-priority so that once
  // an indexed reader has taught us the correct decimals for a non-MARKETS
  // market (e.g. SILVER), subsequent hot-path chain parses scale correctly.
  const sizeDecimalsExplicit =
    cached?.sizeDecimals ??
    nestedDecimals.sizeDecimals ??
    marketConfig?.sizeDecimals ??
    null;
  const priceDecimalsExplicit =
    cached?.priceDecimals ??
    nestedDecimals.priceDecimals ??
    marketConfig?.priceDecimals ??
    null;
  // Track whether we actually had decimals from a trusted source. Falling
  // back to the 8/PRICE_DECIMALS defaults means the row's size may be
  // mis-scaled, which the merge layer needs to know about.
  const decimalsKnown =
    sizeDecimalsExplicit !== null && priceDecimalsExplicit !== null;
  const sizeDecimals = sizeDecimalsExplicit ?? 8;
  const priceDecimals = priceDecimalsExplicit ?? PRICE_DECIMALS;
  const sizeRaw = pick(record, ["size", "position_size", "base_size"]);
  const rawSizeNumber = toNumber(sizeRaw) ?? 0;
  if (rawSizeNumber === 0) return null;

  const explicitIsLong = asBoolean(
    pick(record, ["is_long", "isLong", "long"])
  );
  const isLong = explicitIsLong ?? rawSizeNumber >= 0;
  const unsignedSize = Math.abs(rawSizeNumber);
  const size = rawToDecimal(unsignedSize, sizeDecimals) * (isLong ? 1 : -1);
  const entryRaw = pick(record, [
    "entry_price",
    "entry_px",
    "avg_price",
    "avg_entry_price",
    "avg_acquire_entry_px",
  ]);

  const entryPrice = rawPrice(entryRaw, priceDecimals);
  const leverage = toNumber(pick(record, ["user_leverage", "leverage"])) ?? 1;
  const absSize = Math.abs(size);
  const notionalEntry = absSize * entryPrice;
  const marginUsed = leverage > 0 ? notionalEntry / leverage : 0;

  return {
    market,
    marketAddress: address,
    size,
    isLong,
    leverage,
    entryPrice,
    markPrice: null,
    notionalEntry,
    value: null,
    estimatedPnl: null,
    marginUsed,
    isIsolated:
      asBoolean(pick(record, ["is_isolated", "isIsolated", "isolated"])) ??
      false,
    unrealizedFunding: rawUsdOrNull(
      pick(record, [
        "unrealized_funding",
        "unrealized_funding_cost",
        "unrealizedFunding",
      ])
    ),
    estimatedLiquidationPrice: rawPriceOrNull(
      pick(record, [
        "estimated_liquidation_price",
        "liquidation_price",
        "liq_price",
      ]),
      priceDecimals
    ),
    tpOrderId: asString(pick(record, ["tp_order_id", "tpOrderId"])),
    tpTriggerPrice: rawPrice(
      pick(record, ["tp_trigger_price", "tpTriggerPrice"]),
      priceDecimals
    ),
    slOrderId: asString(pick(record, ["sl_order_id", "slOrderId"])),
    slTriggerPrice: rawPrice(
      pick(record, ["sl_trigger_price", "slTriggerPrice"]),
      priceDecimals
    ),
    source: "chain",
    decimalsKnown,
  };
}

export async function getPrimarySubaccountOnChain(
  owner: string,
  network?: DecibelNetwork
): Promise<string | null> {
  const pkg = getDecibelPackage(network);
  const viewed = await safeView<string>(
    {
      function: `${pkg}::dex_accounts::primary_subaccount`,
      functionArguments: [owner],
    },
    network
  );
  if (viewed) return viewed;
  try {
    return derivePrimarySubaccountAddress(owner, network);
  } catch {
    return null;
  }
}

export async function isSubaccountActiveOnChain(
  subaccount: string,
  network?: DecibelNetwork
): Promise<boolean> {
  const pkg = getDecibelPackage(network);
  const active = await safeView<boolean>(
    {
      function: `${pkg}::dex_accounts::view_is_subaccount_active`,
      functionArguments: [subaccount],
    },
    network
  );
  return active === true;
}

export async function hasAssetsOrPositionsOnChain(
  subaccount: string,
  network?: DecibelNetwork
): Promise<boolean> {
  // Contract upgrade 22 removed perp_engine::has_any_assets_or_positions.
  // Equivalent signal: any listed position, or any account value.
  const pkg = getDecibelPackage(network);
  const [positions, nav] = await Promise.all([
    safeView<unknown[]>(
      {
        function: `${pkg}::perp_engine::list_positions`,
        functionArguments: [subaccount],
      },
      network
    ),
    safeView<string | number>(
      {
        function: `${pkg}::perp_engine::get_account_net_asset_value`,
        functionArguments: [subaccount],
      },
      network
    ),
  ]);
  if (Array.isArray(positions) && positions.length > 0) return true;
  const navValue = Number(nav ?? 0);
  return Number.isFinite(navValue) && navValue !== 0;
}

export async function getFastSubaccounts(
  owner: string,
  network?: DecibelNetwork
): Promise<ChainDecibelSubaccount[]> {
  const primary = await getPrimarySubaccountOnChain(owner, network);
  if (!primary) return [];

  const [isActive, hasAssetsOrPositions] = await Promise.all([
    isSubaccountActiveOnChain(primary, network),
    hasAssetsOrPositionsOnChain(primary, network),
  ]);

  if (!isActive && !hasAssetsOrPositions) return [];

  return [
    {
      address: primary,
      name: "Primary",
      isPrimary: true,
      isActive,
      hasAssetsOrPositions,
    },
  ];
}

async function getPositionFromMarketViews(
  subaccount: string,
  market: string,
  network?: DecibelNetwork
): Promise<ChainDecibelPosition | null> {
  const pkg = getDecibelPackage(network);
  const config = getDecibelMarketConfig(market);
  const hasPosition = await safeView<boolean>(
    {
      function: `${pkg}::perp_engine::has_position`,
      functionArguments: [subaccount, config.address],
    },
    network
  );

  if (hasPosition !== true) return null;

  const [viewPosition, sizeRaw, isLong, avgPriceRaw, fundingRaw] =
    await Promise.all([
      safeView<unknown>(
        {
          function: `${pkg}::perp_engine::view_position`,
          functionArguments: [subaccount, config.address],
        },
        network
      ),
      safeView<string | number>(
        {
          function: `${pkg}::perp_engine::get_position_size`,
          functionArguments: [subaccount, config.address],
        },
        network
      ),
      safeView<boolean>(
        {
          function: `${pkg}::perp_engine::get_position_is_long`,
          functionArguments: [subaccount, config.address],
        },
        network
      ),
      safeView<string | number>(
        {
          function: `${pkg}::perp_engine::get_position_avg_price`,
          functionArguments: [subaccount, config.address],
        },
        network
      ),
      safeView<string | number>(
        {
          function: `${pkg}::perp_engine::get_position_unrealized_funding_cost`,
          functionArguments: [subaccount, config.address],
        },
        network
      ),
    ]);

  const parsed = parsePositionRecord(viewPosition);
  if (parsed) {
    return {
      ...parsed,
      market,
      marketAddress: config.address,
      source: "chain",
    };
  }

  const rawSize = toNumber(sizeRaw) ?? 0;
  if (rawSize === 0) return null;
  const long = isLong === true;
  const sizeHuman =
    rawToDecimal(Math.abs(rawSize), config.sizeDecimals) * (long ? 1 : -1);
  const entry = rawPrice(avgPriceRaw, config.priceDecimals);
  const notional = Math.abs(sizeHuman) * entry;

  return {
    market,
    marketAddress: config.address,
    size: sizeHuman,
    isLong: long,
    leverage: 1,
    entryPrice: entry,
    markPrice: null,
    notionalEntry: notional,
    value: null,
    estimatedPnl: null,
    marginUsed: notional,
    isIsolated: false,
    unrealizedFunding: rawUsdOrNull(fundingRaw),
    estimatedLiquidationPrice: null,
    tpOrderId: null,
    tpTriggerPrice: null,
    slOrderId: null,
    slTriggerPrice: null,
    source: "chain",
    // This fallback path runs only for known MARKETS entries (we iterate
    // Object.keys(MARKETS) above), so decimals are always explicit.
    decimalsKnown: true,
  };
}

export async function getFastPositions(
  subaccount: string,
  network?: DecibelNetwork
): Promise<ChainDecibelPosition[]> {
  const pkg = getDecibelPackage(network);
  const listed = await safeView<unknown[]>(
    {
      function: `${pkg}::perp_engine::list_positions`,
      functionArguments: [subaccount],
    },
    network
  );

  if (Array.isArray(listed)) {
    const parsed = listed
      .map((position) => parsePositionRecord(position))
      .filter((position): position is ChainDecibelPosition => Boolean(position));
    if (parsed.length > 0 || listed.length === 0) return parsed;
  }

  const positions = await Promise.all(
    Object.keys(MARKETS).map((market) =>
      getPositionFromMarketViews(subaccount, market, network)
    )
  );

  return positions.filter(
    (position): position is ChainDecibelPosition => Boolean(position)
  );
}

export async function getFastOverview(
  subaccount: string,
  network?: DecibelNetwork
): Promise<ChainDecibelOverview> {
  const pkg = getDecibelPackage(network);
  const collateralMetadata = getDecibelCollateralMetadata(network);
  const [status, nav, collateralValue, withdrawable] = await Promise.all([
    safeView<RawRecord>(
      {
        function: `${pkg}::perp_engine::cross_position_status`,
        functionArguments: [subaccount],
      },
      network
    ),
    safeView<string | number>(
      {
        function: `${pkg}::perp_engine::get_account_net_asset_value`,
        functionArguments: [subaccount],
      },
      network
    ),
    safeView<string | number>(
      {
        function: `${pkg}::perp_engine::get_cross_total_collateral_value`,
        functionArguments: [subaccount],
      },
      network
    ),
    safeView<string | number>(
      {
        function: `${pkg}::perp_engine::max_allowed_withdraw_from_cross`,
        functionArguments: [subaccount, collateralMetadata],
      },
      network
    ),
  ]);

  const statusRecord = asRecord(status) ?? {};
  if (!status && nav === null && collateralValue === null) {
    throw new Error("Decibel chain overview unavailable");
  }

  const equityRaw = pick(statusRecord, ["account_equity"]) ?? nav;
  const collateralRaw =
    pick(statusRecord, [
      "primary_collateral_balance",
      "secondary_collateral_balance",
    ]) ?? collateralValue;
  const totalNotionalRaw = pick(statusRecord, ["total_notional_value"]);
  const maintenanceMarginRaw = pick(statusRecord, [
    "liquidation_margin",
    "maintenance_margin",
  ]);
  const totalMarginRaw = pick(statusRecord, [
    "margin_for_max_leverage",
    "margin_for_free_collateral",
  ]);

  const equity = rawUsd(equityRaw);
  const collateral = rawUsd(collateralRaw);
  const totalNotional = rawUsd(totalNotionalRaw);
  const maintenanceMargin = rawUsd(maintenanceMarginRaw);
  const totalMargin = rawUsd(totalMarginRaw);
  const unrealizedPnl = equity - collateral;

  return {
    equity,
    unrealizedPnl,
    realizedPnl: null,
    marginRatio: equity > 0 ? maintenanceMargin / equity : 0,
    maintenanceMargin,
    leverage: equity > 0 && totalNotional > 0 ? totalNotional / equity : null,
    totalMargin,
    crossWithdrawable:
      withdrawable === null ? Math.max(equity - totalMargin, 0) : rawUsd(withdrawable),
    volume30d: null,
    totalNotional,
    collateral,
    // Derived: upgrade 22 removed has_any_assets_or_positions, and equity /
    // notional already answer the same question for overview consumers.
    hasAssetsOrPositions: equity !== 0 || totalNotional !== 0 || collateral !== 0,
    source: "chain",
  };
}

async function getFastMarket(
  market: string,
  network?: DecibelNetwork
): Promise<ChainDecibelMarket> {
  const pkg = getDecibelPackage(network);
  const staticConfig = getDecibelMarketConfig(market);
  const args = [staticConfig.address];
  const [
    markAndOracle,
    isOpen,
    mode,
    openInterest,
    maxLeverage,
    minSize,
    lotSize,
    tickSize,
    sizeDecimals,
  ] = await Promise.all([
    safeViewAll<string | number>(
      {
        function: `${pkg}::perp_engine::get_mark_and_oracle_price`,
        functionArguments: args,
      },
      network
    ),
    safeView<boolean>(
      {
        function: `${pkg}::perp_engine::is_market_open`,
        functionArguments: args,
      },
      network
    ),
    safeView<unknown>(
      {
        function: `${pkg}::perp_engine::get_market_mode`,
        functionArguments: args,
      },
      network
    ),
    safeView<string | number>(
      {
        function: `${pkg}::perp_engine::get_current_open_interest`,
        functionArguments: args,
      },
      network
    ),
    safeView<string | number>(
      {
        function: `${pkg}::perp_engine::market_max_leverage`,
        functionArguments: args,
      },
      network
    ),
    safeView<string | number>(
      {
        function: `${pkg}::perp_engine::market_min_size`,
        functionArguments: args,
      },
      network
    ),
    safeView<string | number>(
      {
        function: `${pkg}::perp_engine::market_lot_size`,
        functionArguments: args,
      },
      network
    ),
    safeView<string | number>(
      {
        function: `${pkg}::perp_engine::market_ticker_size`,
        functionArguments: args,
      },
      network
    ),
    safeView<string | number>(
      {
        function: `${pkg}::perp_engine::market_sz_decimals`,
        functionArguments: args,
      },
      network
    ),
  ]);

  const markPrice = rawPrice(markAndOracle?.[0], staticConfig.priceDecimals);
  const oraclePrice = rawPrice(markAndOracle?.[1], staticConfig.priceDecimals);
  const szDecimals = toNumber(sizeDecimals) ?? staticConfig.sizeDecimals;

  return {
    name: market,
    address: staticConfig.address,
    markPrice: markPrice || null,
    midPrice: null,
    oraclePrice: oraclePrice || null,
    fundingRateBps: null,
    isFundingPositive: null,
    openInterest:
      openInterest === null ? null : rawToDecimal(openInterest, szDecimals),
    priceUpdatedAt: null,
    maxLeverage: toNumber(maxLeverage) ?? staticConfig.maxLeverage,
    tickSize: toNumber(tickSize) ?? staticConfig.tickSize,
    minSize: toNumber(minSize) ?? staticConfig.minSizeRaw,
    lotSize: toNumber(lotSize) ?? staticConfig.lotSize,
    mode: isOpen === false ? "Halt" : variantName(mode, "Open"),
    szDecimals,
    pxDecimals: staticConfig.priceDecimals,
    source: "chain",
  };
}

export async function getFastMarkets(
  network?: DecibelNetwork
): Promise<ChainDecibelMarket[]> {
  return Promise.all(
    Object.keys(MARKETS).map((market) => getFastMarket(market, network))
  );
}

const MARKETS_METADATA_TTL_MS = 5 * 60_000;
let marketsMetadataLoadedAt = 0;
let marketsMetadataInflight: Promise<void> | null = null;

/**
 * Lazily fetch the full Decibel market registry via `dex.markets.getAll()` and
 * populate the module-scope `marketMetaCache` with `{ sizeDecimals,
 * priceDecimals, marketName }` keyed by lowercased market address. Cached for
 * 5 minutes; concurrent callers share the same in-flight promise. Bounded by
 * the caller's AbortSignal.
 *
 * Lets the chain hot path scale non-MARKETS markets (SILVER/GOLD/etc.)
 * correctly on its own once the registry has been seen at least once.
 */
export async function loadAndCacheMarketMetadata(
  options: { signal?: AbortSignal; network?: DecibelNetwork } = {}
): Promise<void> {
  const now = Date.now();
  if (now - marketsMetadataLoadedAt < MARKETS_METADATA_TTL_MS) return;
  if (marketsMetadataInflight) return marketsMetadataInflight;

  marketsMetadataInflight = (async () => {
    try {
      const dex = getReadDex(options.network);
      const all = await dex.markets.getAll({
        fetchOptions: { signal: options.signal },
      });
      for (const market of all) {
        recordMarketMetadata(market.market_addr, {
          sizeDecimals: market.sz_decimals,
          priceDecimals: market.px_decimals,
          marketName: market.market_name,
        });
      }
      marketsMetadataLoadedAt = Date.now();
    } catch {
      // Best-effort enrichment; chain rows + nested-market decimals still work.
    } finally {
      marketsMetadataInflight = null;
    }
  })();

  return marketsMetadataInflight;
}

/**
 * Fetch positions via the Decibel SDK's indexed REST reader
 * (`dex.userPositions.getByAddr`). Returns rows with human-scaled `size` /
 * `entry_price` and authoritative `unrealized_funding` /
 * `estimated_liquidation_price` fields the chain payload doesn't carry
 * reliably.
 *
 * Side effect: ALSO populates the market metadata cache (via a `markets.getAll`
 * call started in parallel) so that the chain hot path can scale non-MARKETS
 * markets (SILVER, etc.) correctly on subsequent ticks even when the indexer
 * is unavailable.
 *
 * Failure-mode contract:
 *   - throws on outright failure → caller falls back to chain rows
 *   - bounded by `options.signal` so the route's short timeout truncates it
 */
export async function getIndexedPositions(
  subaccount: string,
  options: { signal?: AbortSignal; network?: DecibelNetwork; limit?: number } = {}
): Promise<ChainDecibelPosition[]> {
  const dex = getReadDex(options.network);

  // Race metadata population in parallel with the positions read under the
  // same timeout/signal budget. We MUST await metadata: the indexed
  // response may return SILVER's correctly-scaled size, but if the cache
  // is empty when the next 1s chain hot poll lands, parsePositionRecord
  // falls back to default decimals and the UI flips back to 0.1508.
  // loadAndCacheMarketMetadata is best-effort internally (swallows its
  // own errors), so this never fails the positions read on metadata
  // alone — it just ensures the cache is populated when present.
  const [, rows] = await Promise.all([
    loadAndCacheMarketMetadata({
      signal: options.signal,
      network: options.network,
    }),
    dex.userPositions.getByAddr({
      subAddr: subaccount,
      limit: options.limit ?? 50,
      fetchOptions: { signal: options.signal },
    }),
  ]);

  const out: ChainDecibelPosition[] = [];
  for (const row of rows) {
    if (!Number.isFinite(row.size) || row.size === 0) continue;
    const isLong = row.size > 0;
    const absSize = Math.abs(row.size);
    const entryPrice = Number.isFinite(row.entry_price) ? row.entry_price : 0;
    const leverage =
      Number.isFinite(row.user_leverage) && row.user_leverage > 0
        ? row.user_leverage
        : 1;
    const notionalEntry = absSize * entryPrice;
    const marginUsed = leverage > 0 ? notionalEntry / leverage : 0;

    // SDK liq=0 maps to null because no real position has a $0 liquidation
    // price — that's the SDK's "unset" sentinel.
    //
    // SDK funding is honored as-is, including a true 0. Per #16's
    // truthfulness contract we must distinguish "indexer returned 0"
    // (display "$0.00") from "no source for this field" (display "—"),
    // and the SDK schema makes funding non-optional, so a 0 here is the
    // computed value, not "unset".
    const liq =
      Number.isFinite(row.estimated_liquidation_price) &&
      row.estimated_liquidation_price !== 0
        ? row.estimated_liquidation_price
        : null;
    const funding = Number.isFinite(row.unrealized_funding)
      ? row.unrealized_funding
      : null;

    const cachedName = getCachedMarketMetadata(row.market)?.marketName;
    const fallbackName = MARKET_NAMES[row.market.toLowerCase()] ?? "Unknown";

    out.push({
      market: cachedName ?? fallbackName,
      marketAddress: row.market,
      size: absSize * (isLong ? 1 : -1),
      isLong,
      leverage,
      entryPrice,
      markPrice: null,
      notionalEntry,
      value: null,
      estimatedPnl: null,
      marginUsed,
      isIsolated: row.is_isolated,
      unrealizedFunding: funding,
      estimatedLiquidationPrice: liq,
      tpOrderId: row.tp_order_id,
      tpTriggerPrice: row.tp_trigger_price,
      slOrderId: row.sl_order_id,
      slTriggerPrice: row.sl_trigger_price,
      source: "indexed",
      // SDK returns human-scaled values regardless of the registry; the
      // decimals contract is intrinsic to the indexed payload shape.
      decimalsKnown: true,
    });
  }
  return out;
}

/**
 * Resolve market names from the on-chain Decibel registry for a small set of
 * addresses. Used by the indexed path to recover labels for non-crypto
 * markets (SILVER, GOLD, …) whose addresses aren't in our static MARKETS
 * map. Reads from `perp_engine::market_name` — global registry data, not
 * operator-specific.
 *
 * Independently failable: a single missing address yields `null` for that
 * key without affecting the others. Caller is responsible for keeping this
 * off the 1s `chainOnly` hot path.
 */
export async function getMarketNamesForAddresses(
  addresses: string[],
  network?: DecibelNetwork
): Promise<Record<string, string | null>> {
  const unique = Array.from(
    new Set(addresses.filter((a): a is string => typeof a === "string" && a.startsWith("0x")))
  );
  if (unique.length === 0) return {};
  const pkg = getDecibelPackage(network);

  const results = await Promise.allSettled(
    unique.map((address) =>
      view<unknown>(
        {
          function: `${pkg}::perp_engine::market_name`,
          functionArguments: [address],
        },
        network
      )
    )
  );

  const out: Record<string, string | null> = {};
  unique.forEach((address, i) => {
    const result = results[i];
    if (result.status === "fulfilled" && Array.isArray(result.value) && result.value.length > 0) {
      out[address.toLowerCase()] = asString(result.value[0]);
    } else {
      out[address.toLowerCase()] = null;
    }
  });
  return out;
}

/**
 * Fetch mark prices for a small set of market addresses.
 *
 * Used by the indexed (default) positions path to enrich open positions with a
 * mark price drawn from the same `get_mark_and_oracle_price` view that the
 * markets page already relies on. We accept a `priceDecimalsByAddress` hint
 * so non-standard markets (anything not in MARKETS) still scale correctly.
 *
 * Each lookup is independently failable: `Promise.allSettled` keeps a single
 * slow address from blocking the rest. Caller is responsible for keeping this
 * off the 1s `chainOnly` hot path.
 */
export async function getMarkPricesForAddresses(
  addresses: string[],
  priceDecimalsByAddress: Record<string, number> = {},
  network?: DecibelNetwork
): Promise<Record<string, number | null>> {
  const unique = Array.from(
    new Set(addresses.filter((a): a is string => typeof a === "string" && a.startsWith("0x")))
  );
  if (unique.length === 0) return {};
  const pkg = getDecibelPackage(network);

  const results = await Promise.allSettled(
    unique.map((address) =>
      view<string | number>(
        {
          function: `${pkg}::perp_engine::get_mark_and_oracle_price`,
          functionArguments: [address],
        },
        network
      )
    )
  );

  const out: Record<string, number | null> = {};
  unique.forEach((address, i) => {
    const result = results[i];
    if (result.status === "fulfilled" && Array.isArray(result.value) && result.value.length > 0) {
      const decimals =
        priceDecimalsByAddress[address.toLowerCase()] ?? PRICE_DECIMALS;
      const mark = rawPrice(result.value[0], decimals);
      out[address.toLowerCase()] = mark || null;
    } else {
      out[address.toLowerCase()] = null;
    }
  });
  return out;
}
