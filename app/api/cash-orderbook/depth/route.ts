import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  CASH_DECIMALS,
  CASH_LOT_SIZE,
  CASH_METADATA_ADDRESS,
  CASH_MIN_ORDER_SIZE,
  CASH_ORDERBOOK_PAIR_ID,
  USDC_DECIMALS,
  USDC_METADATA_ADDRESS,
  type CashOrderbookDepth,
} from "@/lib/cash-orderbook";
import {
  depthFromCashOrderbookOrders,
  parseCashExecutableOrderbookSide,
  validatedCashOrderbookDepth,
} from "@/lib/cash-orderbook-view";
import {
  assertFreshMainnetAptosTimestamp,
  fetchMainnetAptos,
  mainnetAptosStatePath,
  normalizeAptosAddressText,
  readFreshMainnetAptosLedger,
  requireMainnetAptosResponse,
} from "@/lib/aptos-server-lite";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};
const EXPECTED_TICK_SIZE_ATOMIC = 10_000n;
const EXPECTED_PACKAGE_NAME = "cash_orderbook";
const REQUIRED_MODULES = [
  "accounts",
  "admin",
  "cancel",
  "fees",
  "market",
  "matching",
  "order_placement",
  "settlement",
  "subaccounts",
  "types",
  "views",
] as const;

interface ModuleResponse {
  bytecode?: string;
  abi?: { name?: string } | null;
}

interface PackageMetadataResponse {
  name?: unknown;
  upgrade_policy?: { policy?: unknown } | null;
  upgrade_number?: unknown;
  modules?: Array<{ name?: unknown }> | null;
}

interface VerifiedDeployment {
  designatedMaker: string;
  ledgerVersion: string;
  ledgerTimestampUsec: string;
  matchOrderNodeBudget: number;
  makerFeeBps: number;
  takerFeeBps: number;
  moduleFingerprint: string;
}

interface CashExecutionWindow {
  nodeBudget: number;
  bids: { scannedNodes: number; hasMoreRawNodes: boolean };
  asks: { scannedNodes: number; hasMoreRawNodes: boolean };
}

let moduleVerificationCache: {
  key: string;
  expiresAt: number;
  fingerprint: string;
} | null = null;
const EXPECTED_MATCH_ORDER_NODE_BUDGET = 16;

function configuredValue(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

async function aptosFetch(path: string, init: RequestInit = {}) {
  return fetchMainnetAptos(path, init, {
    clientName: "cash-trading/cash-orderbook-verification",
    timeoutMs: 4_000,
  });
}

async function aptosView(
  contractAddress: string,
  functionName: string,
  args: unknown[] = [],
  ledgerVersion = "",
) {
  const path = ledgerVersion ? mainnetAptosStatePath("/view", ledgerVersion) : "/view";
  const response = await aptosFetch(path, {
    method: "POST",
    body: JSON.stringify({
      function: `${contractAddress}::${functionName}`,
      type_arguments: [],
      arguments: args,
    }),
  });
  if (ledgerVersion) await requireMainnetAptosResponse(response, ledgerVersion);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${functionName} view failed (${response.status})`);
  }
  const result = await response.json();
  if (!Array.isArray(result)) throw new Error(`${functionName} returned malformed data`);
  return result as unknown[];
}

async function readExecutableOrderbookSide(
  contractAddress: string,
  isBid: boolean,
  excludedOwner: string,
  ledgerVersion: string,
) {
  return parseCashExecutableOrderbookSide(await aptosView(
    contractAddress,
    "views::get_executable_orderbook_side",
    [CASH_ORDERBOOK_PAIR_ID, isBid, excludedOwner || "0x0"],
    ledgerVersion,
  ));
}

async function readExecutableOrderbookView(
  contractAddress: string,
  excludedOwner: string,
  ledgerVersion: string,
) {
  const [bids, asks] = await Promise.all([
    readExecutableOrderbookSide(contractAddress, true, excludedOwner, ledgerVersion),
    readExecutableOrderbookSide(contractAddress, false, excludedOwner, ledgerVersion),
  ]);
  return {
    depth: depthFromCashOrderbookOrders(bids.orders, asks.orders, excludedOwner),
    execution: {
      nodeBudget: EXPECTED_MATCH_ORDER_NODE_BUDGET,
      bids: {
        scannedNodes: bids.scannedNodes,
        hasMoreRawNodes: bids.hasMoreRawNodes,
      },
      asks: {
        scannedNodes: asks.scannedNodes,
        hasMoreRawNodes: asks.hasMoreRawNodes,
      },
    },
    truncated: bids.hasMoreRawNodes || asks.hasMoreRawNodes,
  };
}

function moduleFingerprint(modules: ModuleResponse[]) {
  const selected = modules
    .map((module) => ({ name: module.abi?.name ?? "", bytecode: module.bytecode ?? "" }))
    .filter((module) => REQUIRED_MODULES.includes(module.name as typeof REQUIRED_MODULES[number]))
    .sort((a, b) => a.name.localeCompare(b.name));
  const expectedNames = [...REQUIRED_MODULES].sort();
  if (
    selected.length !== expectedNames.length
    || selected.some((module, index) => (
      !module.bytecode || module.name !== expectedNames[index]
    ))
  ) {
    throw new Error("The deployed package is missing an audited module");
  }
  return createHash("sha256")
    .update(selected.map((module) => `${module.name}:${module.bytecode}`).join("\n"))
    .digest("hex");
}

async function verifyImmutablePackageMetadata(response: Response, ledgerVersion: string) {
  await requireMainnetAptosResponse(response, ledgerVersion);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Package metadata lookup failed (${response.status})`);
  }
  const resource = await response.json() as {
    data?: { packages?: PackageMetadataResponse[] };
  };
  const packages = resource.data?.packages;
  if (!Array.isArray(packages)) throw new Error("Package registry returned malformed data");
  const matches = packages.filter((candidate) => candidate.name === EXPECTED_PACKAGE_NAME);
  if (matches.length !== 1) throw new Error("The cash_orderbook package identity is ambiguous");
  const packageMetadata = matches[0];
  const moduleNames = Array.isArray(packageMetadata.modules)
    ? packageMetadata.modules.map((module) => String(module.name ?? "")).sort()
    : [];
  const expectedNames = [...REQUIRED_MODULES].sort();
  if (
    String(packageMetadata.upgrade_policy?.policy) !== "2"
    || String(packageMetadata.upgrade_number) !== "0"
    || JSON.stringify(moduleNames) !== JSON.stringify(expectedNames)
  ) {
    throw new Error("The package is not the immutable first-publish audited module set");
  }
}

async function readVerifiedModules(contractAddress: string, ledgerVersion: string) {
  const ledgerQuery = `ledger_version=${encodeURIComponent(ledgerVersion)}`;
  const response = await aptosFetch(`/accounts/${contractAddress}/modules?${ledgerQuery}`);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Package module lookup failed (${response.status})`);
  }
  await requireMainnetAptosResponse(response, ledgerVersion);
  const modules = await response.json() as unknown;
  if (!Array.isArray(modules)) throw new Error("Package module lookup returned malformed data");
  return modules as ModuleResponse[];
}

async function verifyPackageRegistry(contractAddress: string, ledgerVersion: string) {
  const ledgerQuery = `ledger_version=${encodeURIComponent(ledgerVersion)}`;
  const response = await aptosFetch(
    `/accounts/${contractAddress}/resource/${encodeURIComponent("0x1::code::PackageRegistry")}?${ledgerQuery}`,
  );
  await verifyImmutablePackageMetadata(response, ledgerVersion);
}

async function verifyDeployment(
  contractAddress: string,
  expectedFingerprint: string,
  expectedAdmin: string,
  expectedMaker: string,
): Promise<VerifiedDeployment> {
  const cacheKey = `${contractAddress.toLowerCase()}:${expectedFingerprint.toLowerCase()}`;
  const cachedFingerprint = moduleVerificationCache?.key === cacheKey
    && moduleVerificationCache.expiresAt > Date.now()
    ? moduleVerificationCache.fingerprint
    : "";

  const ledger = await readFreshMainnetAptosLedger({
    clientName: "cash-trading/cash-orderbook-verification",
    timeoutMs: 4_000,
  });
  const ledgerVersion = ledger.version;
  const [
    marketInfo,
    feeConfig,
    adminInfo,
    pendingAdminInfo,
    bootstrapInfo,
    designatedMakerInfo,
    matchNodeBudgetInfo,
    modules,
  ] = await Promise.all([
    aptosView(contractAddress, "market::get_market_info", [CASH_ORDERBOOK_PAIR_ID], ledgerVersion),
    aptosView(contractAddress, "fees::get_fee_config", [], ledgerVersion),
    aptosView(contractAddress, "types::get_admin", [], ledgerVersion),
    aptosView(contractAddress, "types::get_pending_admin", [], ledgerVersion),
    aptosView(
      contractAddress,
      "market::get_market_bootstrap_info",
      [CASH_ORDERBOOK_PAIR_ID],
      ledgerVersion,
    ),
    aptosView(contractAddress, "market::get_designated_maker", [CASH_ORDERBOOK_PAIR_ID], ledgerVersion),
    aptosView(contractAddress, "market::max_match_order_nodes", [], ledgerVersion),
    cachedFingerprint
      ? Promise.resolve(null)
      : readVerifiedModules(contractAddress, ledgerVersion),
    verifyPackageRegistry(contractAddress, ledgerVersion),
  ]);
  let fingerprint = cachedFingerprint;
  if (modules) {
    fingerprint = moduleFingerprint(modules);
    moduleVerificationCache = {
      key: cacheKey,
      expiresAt: Date.now() + 30_000,
      fingerprint,
    };
  }
  if (fingerprint !== expectedFingerprint.toLowerCase()) {
    throw new Error("The deployed package does not match the audited module fingerprint");
  }

  if (marketInfo.length < 7) throw new Error("Market 0 returned incomplete configuration");
  const expectedLot = BigInt(CASH_LOT_SIZE) * 10n ** BigInt(CASH_DECIMALS);
  const expectedMinimum = BigInt(CASH_MIN_ORDER_SIZE) * 10n ** BigInt(CASH_DECIMALS);
  const [base, quote, lot, tick, minimum, status, quoteDecimals] = marketInfo.map(String);
  const marketMatches =
    normalizeAptosAddressText(base).toLowerCase() === normalizeAptosAddressText(CASH_METADATA_ADDRESS).toLowerCase()
    && normalizeAptosAddressText(quote).toLowerCase() === normalizeAptosAddressText(USDC_METADATA_ADDRESS).toLowerCase()
    && BigInt(lot) === expectedLot
    && BigInt(tick) === EXPECTED_TICK_SIZE_ATOMIC
    && BigInt(minimum) === expectedMinimum
    && status === "0"
    && Number(quoteDecimals) === USDC_DECIMALS;
  if (!marketMatches) {
    throw new Error("Market 0 does not match the audited CASH/USDC launch configuration");
  }
  if (
    bootstrapInfo.length !== 6
    || bootstrapInfo[0] !== false
    || normalizeAptosAddressText(bootstrapInfo[1], "bootstrap owner")
      !== normalizeAptosAddressText("0x0")
    || !bootstrapInfo.slice(2).every((value) => Array.isArray(value) && value.length === 0)
  ) {
    throw new Error("The CASH/USDC atomic bootstrap is pending or malformed");
  }
  if (
    designatedMakerInfo.length !== 1
    || normalizeAptosAddressText(designatedMakerInfo[0], "designated maker")
      !== normalizeAptosAddressText(expectedMaker, "expected designated maker")
  ) {
    throw new Error("The resting-order maker does not match the reviewed CASH LP");
  }
  if (
    matchNodeBudgetInfo.length !== 1
    || String(matchNodeBudgetInfo[0]) !== String(EXPECTED_MATCH_ORDER_NODE_BUDGET)
  ) {
    throw new Error("The on-chain matching work budget does not match the audited frontend");
  }

  if (
    adminInfo.length !== 1
    || normalizeAptosAddressText(adminInfo[0], "on-chain protocol admin")
      !== normalizeAptosAddressText(expectedAdmin, "expected protocol admin")
  ) {
    throw new Error("The protocol admin does not match the reviewed deployment configuration");
  }
  if (
    pendingAdminInfo.length !== 2
    || String(pendingAdminInfo[0]) !== "false"
    || normalizeAptosAddressText(pendingAdminInfo[1], "pending protocol admin")
      !== normalizeAptosAddressText("0x0")
  ) {
    throw new Error("The protocol admin handoff is incomplete or another transfer is pending");
  }

  const makerFeeBps = Number(feeConfig[0]);
  const takerFeeBps = Number(feeConfig[1]);
  if (!Number.isSafeInteger(makerFeeBps) || !Number.isSafeInteger(takerFeeBps)) {
    throw new Error("Fee configuration is malformed");
  }
  // Quote math is deliberately fee-free at launch. Fail closed if governance
  // changes either fee until fee-aware quoting and receipt parsing is shipped.
  if (makerFeeBps !== 0 || takerFeeBps !== 0) {
    throw new Error("CASH/USDC swaps are paused because on-chain fees are no longer zero");
  }

  const result = {
    designatedMaker: normalizeAptosAddressText(designatedMakerInfo[0]),
    ledgerVersion,
    ledgerTimestampUsec: ledger.timestampUsec,
    matchOrderNodeBudget: EXPECTED_MATCH_ORDER_NODE_BUDGET,
    makerFeeBps,
    takerFeeBps,
    moduleFingerprint: fingerprint,
  };
  return result;
}

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "cash-orderbook-depth", 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({
      ready: false,
      contractAddress: "",
      depth: null,
      message: "Too many quote requests. Try again shortly.",
    }, {
      status: 429,
      headers: {
        ...NO_STORE_HEADERS,
        "Retry-After": String(rate.retryAfterS ?? 60),
      },
    });
  }
  const apiUrl = configuredValue(
    process.env.CASH_ORDERBOOK_API_URL,
    process.env.NEXT_PUBLIC_CASH_ORDERBOOK_API_URL,
  ).replace(/\/$/, "");
  const contractAddress = configuredValue(
    process.env.CASH_ORDERBOOK_CONTRACT_ADDRESS,
    process.env.NEXT_PUBLIC_CASH_ORDERBOOK_CONTRACT_ADDRESS,
  );
  const expectedFingerprint = configuredValue(process.env.CASH_ORDERBOOK_AUDITED_MODULES_SHA256);
  const expectedAdmin = configuredValue(process.env.CASH_ORDERBOOK_ADMIN_ADDRESS);
  const expectedMaker = configuredValue(process.env.CASH_ORDERBOOK_LP_ADDRESS);
  const excludedOwner = request.nextUrl.searchParams.get("excludeOwner")?.trim() ?? "";
  if (excludedOwner && !/^0x[0-9a-fA-F]{1,64}$/.test(excludedOwner)) {
    return NextResponse.json({
      ready: false,
      contractAddress: "",
      depth: null,
      message: "A valid Aptos wallet address is required for an executable quote.",
    }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const unsafeDevMock = process.env.NODE_ENV !== "production"
    && process.env.CASH_ORDERBOOK_DEV_UNSAFE_SKIP_VERIFY === "1";

  const hasProductionConfig = /^0x[0-9a-fA-F]+$/.test(contractAddress)
    && /^0x[0-9a-fA-F]+$/.test(expectedAdmin)
    && /^0x[0-9a-fA-F]+$/.test(expectedMaker)
    && /^[0-9a-fA-F]{64}$/.test(expectedFingerprint);
  if ((!unsafeDevMock && !hasProductionConfig) || (unsafeDevMock && !apiUrl)) {
    return NextResponse.json({
      ready: false,
      contractAddress: "",
      depth: null,
      message: "CASH/USDC orderbook deployment is not configured and audit-approved yet.",
    }, { headers: NO_STORE_HEADERS });
  }

  try {
    let depth: CashOrderbookDepth;
    let depthTruncated = false;
    let execution: CashExecutionWindow | null = null;
    let ledgerVersion: string | null = null;
    let responseContractAddress = contractAddress;
    if (!unsafeDevMock) {
      const normalizedContract = normalizeAptosAddressText(contractAddress);
      const deployment = await verifyDeployment(
        normalizedContract,
        expectedFingerprint,
        expectedAdmin,
        expectedMaker,
      );
      const orderbook = await readExecutableOrderbookView(
        normalizedContract,
        excludedOwner,
        deployment.ledgerVersion,
      );
      assertFreshMainnetAptosTimestamp(deployment.ledgerTimestampUsec);
      depth = orderbook.depth;
      depthTruncated = orderbook.truncated;
      execution = orderbook.execution;
      ledgerVersion = deployment.ledgerVersion;
      responseContractAddress = normalizedContract;
    } else {
      const depthResponse = await fetch(`${apiUrl}/depth`, {
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      });
      if (!depthResponse.ok) {
        await depthResponse.body?.cancel();
        throw new Error(`Depth service returned ${depthResponse.status}`);
      }
      const candidate: unknown = await depthResponse.json();
      const validated = validatedCashOrderbookDepth(candidate);
      if (!validated) throw new Error("Depth service returned malformed data");
      depth = validated;
    }

    return NextResponse.json({
      ready: true,
      contractAddress: responseContractAddress,
      depth,
      depthTruncated,
      execution,
      ledgerVersion,
      pairId: CASH_ORDERBOOK_PAIR_ID,
      makerFeeBps: 0,
      takerFeeBps: 0,
      verified: !unsafeDevMock,
      source: unsafeDevMock ? "development-mock" : "aptos-executable-prefix-view",
      excludedOwner: excludedOwner || null,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[cash-orderbook-depth] on-chain verification failed:", error);
    return NextResponse.json({
      ready: false,
      contractAddress: "",
      depth: null,
      message: "CASH/USDC deployment verification failed. Swapping is paused.",
    }, { headers: NO_STORE_HEADERS });
  }
}
