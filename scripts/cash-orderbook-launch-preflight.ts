import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CASH_INDEXER_MAX_LAG_VERSIONS,
  isCashIndexerVersionFresh,
  moduleFingerprint,
  normalizeLaunchAddress,
  validateCashLaunchManifest,
  validateCashSmokeProofPlan,
  verifyAdmin,
  verifyAssetMetadata,
  verifyExactSeededBook,
  verifyFrontendConfig,
  verifyIndexerHealth,
  verifyMarket,
  verifyMarketBootstrap,
  verifyMarketExecutionPolicy,
  verifyMoveManifest,
  verifyPackage,
  parseUnsigned,
  verifyPublicDepth,
  verifyPublicTrades,
  verifySafeLiveBook,
  verifySmokeTransaction,
  verifyWalletFunding,
  type CashLaunchManifest,
  type CashSmokeProofPlan,
  type DeployedModule,
  type LaunchWalletBalances,
  type MetadataResource,
  type PackageMetadata,
} from "../lib/cash-orderbook-launch";

type Stage = "local" | "package" | "market" | "funded" | "ready" | "smoke";

interface Options {
  stage: Stage;
  manifestPath: string;
  moveTomlPath: string;
  modulesDirectory: string;
  contractAddress: string;
  adminAddress: string;
  lpAddress: string;
  expectedFingerprint: string;
  frontendEnvPath: string;
  frontendUrl: string;
  indexerHealthUrl: string;
  smokeProofPath: string;
  fullnodeUrl: string;
  trustedFullnodeOrigin: string;
}

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const STAGE_RANK: Record<Stage, number> = {
  local: 0,
  package: 1,
  market: 2,
  funded: 3,
  ready: 4,
  smoke: 5,
};

const DEFAULT_MANIFEST = resolve(process.cwd(), "../cash-orderbook/launch/mainnet-cash-usdc.json");
const DEFAULT_MOVE_TOML = resolve(process.cwd(), "../cash-orderbook/contracts/Move.toml");
const FULLNODE_DEFAULT = "https://api.mainnet.aptoslabs.com/v1";
const APTOS_MAINNET_ORIGIN = "https://api.mainnet.aptoslabs.com";
export const MAX_MAINNET_LEDGER_AGE_MS = 60_000;
const MAX_MAINNET_LEDGER_FUTURE_SKEW_MS = 10_000;

export interface MainnetLedgerProof {
  chainId: 1;
  version: bigint;
  timestampUsec: bigint;
  observedAtMs: number;
}

function usage(): never {
  console.error("Usage: pnpm cash-orderbook:preflight -- --stage <local|package|market|funded|ready|smoke> [options]");
  console.error("Required for every stage: --modules-dir");
  console.error("Required from package onward: --contract-address, --admin-address, --expected-fingerprint");
  console.error("Required from market onward: --lp-address");
  console.error("Required from ready onward: --frontend-env, --frontend-url, --indexer-health-url");
  console.error("Required for smoke: --smoke-proof <reviewed buy-and-sell proof JSON>");
  console.error("Custom fullnodes also require --trusted-fullnode-origin <exact HTTPS origin>.");
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  argv = argv.filter((value) => value !== "--");
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) usage();
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) usage();
    values.set(flag, value);
    index += 1;
  }
  const stage = values.get("--stage") as Stage | undefined;
  if (!stage || !(stage in STAGE_RANK)) usage();
  return {
    stage,
    manifestPath: resolve(values.get("--manifest") ?? DEFAULT_MANIFEST),
    moveTomlPath: resolve(values.get("--move-toml") ?? DEFAULT_MOVE_TOML),
    modulesDirectory: values.get("--modules-dir") ? resolve(values.get("--modules-dir")!) : "",
    contractAddress: values.get("--contract-address") ?? process.env.CASH_ORDERBOOK_CONTRACT_ADDRESS ?? "",
    adminAddress: values.get("--admin-address") ?? process.env.CASH_ORDERBOOK_ADMIN_ADDRESS ?? "",
    lpAddress: values.get("--lp-address") ?? process.env.CASH_ORDERBOOK_LP_ADDRESS ?? "",
    expectedFingerprint: (
      values.get("--expected-fingerprint")
      ?? process.env.CASH_ORDERBOOK_AUDITED_MODULES_SHA256
      ?? ""
    ).toLowerCase(),
    frontendEnvPath: values.get("--frontend-env") ? resolve(values.get("--frontend-env")!) : "",
    frontendUrl: (values.get("--frontend-url") ?? "").replace(/\/$/, ""),
    indexerHealthUrl: values.get("--indexer-health-url") ?? "",
    smokeProofPath: values.get("--smoke-proof")
      ? resolve(values.get("--smoke-proof")!)
      : "",
    fullnodeUrl: (values.get("--fullnode-url") ?? process.env.APTOS_NODE_URL_MAINNET ?? FULLNODE_DEFAULT)
      .replace(/\/$/, ""),
    trustedFullnodeOrigin: (
      values.get("--trusted-fullnode-origin")
      ?? process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN
      ?? ""
    ).replace(/\/$/, ""),
  };
}

function parseTrustedOrigin(value: string): string {
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--trusted-fullnode-origin must be an exact HTTPS origin.");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error("--trusted-fullnode-origin must be an exact HTTPS origin.");
  }
  return url.origin;
}

export function validateMainnetFullnodeUrl(raw: string, trustedOrigin = ""): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("--fullnode-url must be a valid HTTPS Aptos mainnet URL.");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error("--fullnode-url must be a valid HTTPS Aptos mainnet URL.");
  }
  const explicitlyTrusted = parseTrustedOrigin(trustedOrigin);
  if (url.origin !== APTOS_MAINNET_ORIGIN && url.origin !== explicitlyTrusted) {
    throw new Error(
      "Custom Aptos fullnodes require --trusted-fullnode-origin matching the fullnode HTTPS origin.",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function requireInputs(options: Options): void {
  const rank = STAGE_RANK[options.stage];
  validateMainnetFullnodeUrl(options.fullnodeUrl, options.trustedFullnodeOrigin);
  if (!options.modulesDirectory) throw new Error("--modules-dir is required for every launch stage.");
  if (rank >= STAGE_RANK.package) {
    normalizeLaunchAddress(options.contractAddress, "contract address");
    normalizeLaunchAddress(options.adminAddress, "admin address");
    if (!/^[0-9a-f]{64}$/.test(options.expectedFingerprint)) {
      throw new Error("--expected-fingerprint must be a 64-character SHA-256 value.");
    }
  }
  if (rank >= STAGE_RANK.market) normalizeLaunchAddress(options.lpAddress, "LP address");
  if (rank >= STAGE_RANK.ready) {
    if (!options.frontendEnvPath) throw new Error("--frontend-env is required from the ready stage onward.");
    if (!/^https:\/\//.test(options.frontendUrl)) throw new Error("--frontend-url must be an HTTPS origin.");
    if (!/^https:\/\//.test(options.indexerHealthUrl)) {
      throw new Error("--indexer-health-url must be an HTTPS endpoint.");
    }
  }
  if (options.stage === "smoke" && !options.smokeProofPath) {
    throw new Error("--smoke-proof is required for the smoke stage.");
  }
}

function aptosLabsApiKey(): string {
  return (
    process.env.APTOS_API_KEY_MAINNET
    ?? process.env.APTOS_NODE_API_KEY_MAINNET
    ?? process.env.GEOMI_API_KEY_MAINNET
    ?? process.env.APTOS_API_KEY
    ?? process.env.APTOS_NODE_API_KEY
    ?? process.env.GEOMI_API_KEY
    ?? process.env.APTOSLABS_API_KEY
    ?? ""
  ).trim();
}

function apiKeyForFullnode(fullnodeUrl: string, trustedFullnodeOrigin: string): string {
  const base = new URL(validateMainnetFullnodeUrl(fullnodeUrl, trustedFullnodeOrigin));
  if (base.origin === APTOS_MAINNET_ORIGIN) return aptosLabsApiKey();
  return (process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_API_KEY ?? "").trim();
}

function requestHeaders(init: RequestInit, apiKey = ""): Headers {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("x-aptos-client", "cash-trading/launch-preflight");
  headers.delete("authorization");
  headers.delete("proxy-authorization");
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);
  return headers;
}

function isWithinFullnodeBase(target: URL, fullnodeBase: URL): boolean {
  const basePath = fullnodeBase.pathname.replace(/\/+$/, "");
  return target.origin === fullnodeBase.origin
    && (target.pathname === basePath || target.pathname.startsWith(`${basePath}/`));
}

export async function aptosAuthenticatedFetch(
  fullnodeUrl: string,
  trustedFullnodeOrigin: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const validatedBase = validateMainnetFullnodeUrl(fullnodeUrl, trustedFullnodeOrigin);
  const target = new URL(url);
  const base = new URL(validatedBase);
  if (!isWithinFullnodeBase(target, base)) {
    throw new Error("Refusing to send Aptos credentials outside the trusted fullnode base URL.");
  }
  const key = apiKeyForFullnode(fullnodeUrl, trustedFullnodeOrigin);
  const request = (withKey: boolean) => fetch(target, {
    ...init,
    cache: "no-store",
    redirect: "error",
    headers: requestHeaders(init, withKey ? key : ""),
    signal: init.signal ?? AbortSignal.timeout(10_000),
  });
  let response = await request(true);
  if (key && (response.status === 401 || response.status === 403)) response = await request(false);
  return response;
}

export async function externalFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    cache: "no-store",
    headers: requestHeaders(init),
    signal: init.signal ?? AbortSignal.timeout(10_000),
  });
}

async function externalJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await externalFetch(url, init);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.json() as Promise<unknown>;
}

function aptosUrl(options: Options, path: string): string {
  const base = validateMainnetFullnodeUrl(options.fullnodeUrl, options.trustedFullnodeOrigin);
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function pinnedAptosStateUrl(
  fullnodeUrl: string,
  trustedFullnodeOrigin: string,
  path: string,
  proof: MainnetLedgerProof,
): string {
  const url = new URL(`${validateMainnetFullnodeUrl(fullnodeUrl, trustedFullnodeOrigin)}${
    path.startsWith("/") ? path : `/${path}`
  }`);
  const existingVersions = url.searchParams.getAll("ledger_version");
  const expectedVersion = proof.version.toString();
  if (existingVersions.length > 1 || (existingVersions[0] && existingVersions[0] !== expectedVersion)) {
    throw new Error("Aptos state read requested a ledger version outside the pinned launch snapshot.");
  }
  url.searchParams.set("ledger_version", expectedVersion);
  return url.toString();
}

async function aptosJson(
  options: Options,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await aptosAuthenticatedFetch(
    options.fullnodeUrl,
    options.trustedFullnodeOrigin,
    url,
    init,
  );
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.json() as Promise<unknown>;
}

async function aptosStateJson(
  options: Options,
  proof: MainnetLedgerProof,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  return aptosJson(
    options,
    pinnedAptosStateUrl(options.fullnodeUrl, options.trustedFullnodeOrigin, path, proof),
    init,
  );
}

export function parseFreshMainnetLedgerProof(
  value: unknown,
  expectedChainId: number,
  nowMs = Date.now(),
): MainnetLedgerProof {
  if (!value || typeof value !== "object") throw new Error("Ledger response is malformed.");
  const body = value as {
    chain_id?: unknown;
    ledger_version?: unknown;
    ledger_timestamp?: unknown;
  };
  if (String(body.chain_id) !== String(expectedChainId) || expectedChainId !== 1) {
    throw new Error(`Fullnode chain ID is ${String(body.chain_id)}, expected Aptos mainnet chain 1.`);
  }
  const versionText = String(body.ledger_version ?? "");
  const timestampText = String(body.ledger_timestamp ?? "");
  if (!/^\d+$/.test(versionText) || BigInt(versionText) <= 0n) {
    throw new Error("Ledger version is malformed.");
  }
  if (!/^\d+$/.test(timestampText) || BigInt(timestampText) <= 0n) {
    throw new Error("Ledger timestamp is malformed.");
  }
  const timestampUsec = BigInt(timestampText);
  const ageUsec = BigInt(nowMs) * 1_000n - timestampUsec;
  if (ageUsec > BigInt(MAX_MAINNET_LEDGER_AGE_MS) * 1_000n) {
    throw new Error("Aptos mainnet ledger timestamp is stale.");
  }
  if (ageUsec < -BigInt(MAX_MAINNET_LEDGER_FUTURE_SKEW_MS) * 1_000n) {
    throw new Error("Aptos mainnet ledger timestamp is implausibly far in the future.");
  }
  return {
    chainId: 1,
    version: BigInt(versionText),
    timestampUsec,
    observedAtMs: nowMs,
  };
}

export function verifyVersionAgainstLedgerProof(
  response: unknown,
  field: string,
  label: string,
  proof: MainnetLedgerProof,
): void {
  if (!response || typeof response !== "object") throw new Error(`${label} response is malformed.`);
  const versionText = String((response as Record<string, unknown>)[field] ?? "");
  if (!/^\d+$/.test(versionText)) throw new Error(`${label} ledger version is malformed.`);
  if (!isCashIndexerVersionFresh(BigInt(versionText), proof.version, CASH_INDEXER_MAX_LAG_VERSIONS)) {
    throw new Error(`${label} is not fresh relative to the pinned Aptos mainnet ledger snapshot.`);
  }
}

async function aptosView(
  options: Options,
  proof: MainnetLedgerProof,
  functionId: string,
  args: unknown[] = [],
): Promise<unknown[]> {
  const response = await aptosStateJson(options, proof, "/view", {
    method: "POST",
    body: JSON.stringify({
      function: `${options.contractAddress}::${functionId}`,
      type_arguments: [],
      arguments: args,
    }),
  });
  if (!Array.isArray(response)) throw new Error(`${functionId} returned malformed data.`);
  return response;
}

async function loadLocalModules(
  directory: string,
  expectedNames: string[],
): Promise<DeployedModule[]> {
  const filenames = (await readdir(directory)).filter((name) => name.endsWith(".mv")).sort();
  const expectedFiles = expectedNames.map((name) => `${name}.mv`).sort();
  if (JSON.stringify(filenames) !== JSON.stringify(expectedFiles)) {
    throw new Error("Local bytecode directory does not contain the exact production module set.");
  }
  return Promise.all(filenames.map(async (filename) => ({
    name: filename.slice(0, -3),
    bytecode: `0x${(await readFile(resolve(directory, filename))).toString("hex")}`,
  })));
}

function deployedModules(value: unknown): DeployedModule[] {
  if (!Array.isArray(value)) throw new Error("On-chain module response is malformed.");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("On-chain module entry is malformed.");
    const module = raw as { abi?: { name?: unknown } | null; bytecode?: unknown };
    return { name: String(module.abi?.name ?? ""), bytecode: String(module.bytecode ?? "") };
  });
}

function packageRegistry(value: unknown): PackageMetadata[] {
  if (!value || typeof value !== "object") throw new Error("Package registry response is malformed.");
  const packages = (value as { data?: { packages?: unknown } }).data?.packages;
  if (!Array.isArray(packages)) throw new Error("Package registry packages are missing.");
  return packages as PackageMetadata[];
}

function metadataResource(value: unknown): MetadataResource {
  if (!value || typeof value !== "object") throw new Error("Metadata response is malformed.");
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== "object") throw new Error("Metadata resource data is missing.");
  return data as MetadataResource;
}

function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim();
    result[match[1]] = (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) ? value.slice(1, -1) : value;
  }
  return result;
}

async function fungibleBalance(
  options: Options,
  proof: MainnetLedgerProof,
  owner: string,
  metadata: string,
): Promise<string> {
  const response = await aptosStateJson(options, proof, "/view", {
    method: "POST",
    body: JSON.stringify({
      function: "0x1::primary_fungible_store::balance",
      type_arguments: ["0x1::fungible_asset::Metadata"],
      arguments: [owner, metadata],
    }),
  });
  if (!Array.isArray(response) || !/^\d+$/.test(String(response[0] ?? ""))) {
    throw new Error("Primary fungible-store balance is malformed.");
  }
  return String(response[0]);
}

async function aptBalance(
  options: Options,
  proof: MainnetLedgerProof,
  owner: string,
): Promise<string> {
  const type = encodeURIComponent("0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>");
  const response = await aptosStateJson(options, proof, `/accounts/${owner}/resource/${type}`);
  const value = (response as { data?: { coin?: { value?: unknown } } })?.data?.coin?.value;
  if (!/^\d+$/.test(String(value ?? ""))) throw new Error("APT balance is malformed.");
  return String(value);
}

async function walletBalances(
  options: Options,
  manifest: CashLaunchManifest,
  proof: MainnetLedgerProof,
): Promise<LaunchWalletBalances> {
  const [cash, usdc, apt, internal] = await Promise.all([
    fungibleBalance(options, proof, options.lpAddress, manifest.assets.cash.metadataAddress),
    fungibleBalance(options, proof, options.lpAddress, manifest.assets.usdc.metadataAddress),
    aptBalance(options, proof, options.lpAddress),
    aptosView(options, proof, "views::get_user_balances", [
      options.lpAddress,
      manifest.assets.cash.metadataAddress,
      manifest.assets.usdc.metadataAddress,
    ]),
  ]);
  if (internal.length !== 4 || internal.some((value) => !/^\d+$/.test(String(value)))) {
    throw new Error("Orderbook LP balances are malformed.");
  }
  return {
    externalCashAtomic: cash,
    externalUsdcAtomic: usdc,
    aptAtomic: apt,
    internalCashAvailableAtomic: String(internal[0]),
    internalCashLockedAtomic: String(internal[1]),
    internalUsdcAvailableAtomic: String(internal[2]),
    internalUsdcLockedAtomic: String(internal[3]),
  };
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  requireInputs(options);
  const manifest = validateCashLaunchManifest(
    JSON.parse(await readFile(options.manifestPath, "utf8")) as unknown,
  );
  let smokeProof: CashSmokeProofPlan | null = null;
  if (options.stage === "smoke") {
    smokeProof = validateCashSmokeProofPlan(
      JSON.parse(await readFile(options.smokeProofPath, "utf8")) as unknown,
      manifest,
    );
    if (smokeProof.sender === normalizeLaunchAddress(options.lpAddress, "LP address")) {
      throw new Error("Smoke sender must differ from the LP wallet to prevent self-trades.");
    }
  }
  const results: CheckResult[] = [];
  let ledgerProof: MainnetLedgerProof | null = null;
  let localModules: DeployedModule[] = [];
  let attestedFingerprint = options.expectedFingerprint;
  let balances: LaunchWalletBalances | null = null;

  const check = async (name: string, action: () => Promise<string | void> | string | void): Promise<void> => {
    try {
      const detail = await action();
      results.push({ name, ok: true, detail: typeof detail === "string" ? detail : "passed" });
    } catch (error) {
      results.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const pinnedProof = (): MainnetLedgerProof => {
    if (!ledgerProof) throw new Error("A fresh pinned Aptos mainnet ledger snapshot is unavailable.");
    return ledgerProof;
  };

  await check("launch manifest", () => `schema ${manifest.schemaVersion}, chain ${manifest.chainId}`);
  await check("immutable Move package policy", async () => {
    verifyMoveManifest(await readFile(options.moveTomlPath, "utf8"));
  });

  if (options.modulesDirectory) {
    await check("local production bytecode", async () => {
      localModules = await loadLocalModules(options.modulesDirectory, manifest.package.modules);
      const localFingerprint = moduleFingerprint(localModules, manifest.package.modules);
      if (options.expectedFingerprint && localFingerprint !== options.expectedFingerprint) {
        throw new Error("Local bytecode does not match the auditor-approved fingerprint.");
      }
      return localFingerprint;
    });
  } else if (options.stage !== "local") {
    results.push({ name: "local production bytecode", ok: false, detail: "--modules-dir is required." });
  }

  if (STAGE_RANK[options.stage] >= STAGE_RANK.package) {
    await check("fresh pinned Aptos mainnet ledger", async () => {
      const ledger = await aptosJson(options, aptosUrl(options, "/"));
      ledgerProof = parseFreshMainnetLedgerProof(ledger, manifest.chainId);
      return `chain 1, ledger ${ledgerProof.version}, timestamp ${ledgerProof.timestampUsec}`;
    });

    await check("immutable deployed package and bytecode", async () => {
      const proof = pinnedProof();
      const packageType = encodeURIComponent("0x1::code::PackageRegistry");
      const [moduleResponse, packageResponse] = await Promise.all([
        aptosStateJson(options, proof, `/accounts/${options.contractAddress}/modules`),
        aptosStateJson(
          options,
          proof,
          `/accounts/${options.contractAddress}/resource/${packageType}`,
        ),
      ]);
      const onChainModules = deployedModules(moduleResponse);
      attestedFingerprint = verifyPackage(
        manifest,
        packageRegistry(packageResponse),
        onChainModules,
        options.expectedFingerprint,
      );
      if (localModules.length !== manifest.package.modules.length) {
        throw new Error("Local production bytecode was not loaded for deployed-bytecode comparison.");
      }
      const localByName = new Map(localModules.map((module) => [module.name, module.bytecode.toLowerCase()]));
      for (const module of onChainModules) {
        if (localByName.get(module.name) !== module.bytecode.toLowerCase()) {
          throw new Error(`Deployed ${module.name} does not match the approved local bytecode.`);
        }
      }
      return attestedFingerprint;
    });

    await check("protocol admin", async () => {
      const proof = pinnedProof();
      verifyAdmin(
        options.adminAddress,
        await aptosView(options, proof, "types::get_admin"),
        await aptosView(options, proof, "types::get_pending_admin"),
      );
    });

    await check("exact CASH and USDC metadata", async () => {
      const proof = pinnedProof();
      const metadataType = encodeURIComponent("0x1::fungible_asset::Metadata");
      const [cash, usdc] = await Promise.all([
        aptosStateJson(
          options,
          proof,
          `/accounts/${manifest.assets.cash.metadataAddress}/resource/${metadataType}`,
        ),
        aptosStateJson(
          options,
          proof,
          `/accounts/${manifest.assets.usdc.metadataAddress}/resource/${metadataType}`,
        ),
      ]);
      verifyAssetMetadata(manifest.assets.cash, metadataResource(cash));
      verifyAssetMetadata(manifest.assets.usdc, metadataResource(usdc));
    });
  }

  if (STAGE_RANK[options.stage] >= STAGE_RANK.market) {
    const marketShouldBeActive = STAGE_RANK[options.stage] >= STAGE_RANK.ready;
    await check(
      marketShouldBeActive
        ? "pair 0 parameters, completed bootstrap, active state, and zero fees"
        : "pair 0 parameters, sealed pending bootstrap, paused state, and zero fees",
      async () => {
        const proof = pinnedProof();
        const [market, fees, active, bootstrap, designatedMaker, matchNodeBudget] = await Promise.all([
          aptosView(options, proof, "market::get_market_info", [manifest.market.pairId]),
          aptosView(options, proof, "fees::get_fee_config"),
          aptosView(options, proof, "market::is_market_active", [manifest.market.pairId]),
          aptosView(options, proof, "market::get_market_bootstrap_info", [manifest.market.pairId]),
          aptosView(options, proof, "market::get_designated_maker", [manifest.market.pairId]),
          aptosView(options, proof, "market::max_match_order_nodes"),
        ]);
        verifyMarket(manifest, market, fees, active, marketShouldBeActive);
        verifyMarketBootstrap(manifest, options.lpAddress, bootstrap, !marketShouldBeActive);
        verifyMarketExecutionPolicy(options.lpAddress, designatedMaker, matchNodeBudget);
      },
    );

    if (options.stage === "market") {
      await check("LP wallet assets and gas", async () => {
        balances = await walletBalances(options, manifest, pinnedProof());
        verifyWalletFunding(manifest, balances, "wallet");
      });
    } else {
      await check("LP gas reserve", async () => {
        balances = await walletBalances(options, manifest, pinnedProof());
        if (
          parseUnsigned(balances.aptAtomic, "LP APT balance")
          < parseUnsigned(manifest.liquidity.minimumLpAptAtomic, "minimum LP APT")
        ) {
          throw new Error("LP wallet APT balance is below the launch gas threshold.");
        }
      });
    }
  }

  if (STAGE_RANK[options.stage] === STAGE_RANK.funded) {
    await check("LP orderbook deposits", async () => {
      balances ??= await walletBalances(options, manifest, pinnedProof());
      verifyWalletFunding(manifest, balances, "orderbook");
    });
  }

  if (STAGE_RANK[options.stage] >= STAGE_RANK.ready) {
    await check(options.stage === "ready" ? "exact seeded LP ladder" : "safe live orderbook", async () => {
      const book = await aptosView(
        options,
        pinnedProof(),
        "views::get_orderbook",
        [manifest.market.pairId],
      );
      if (options.stage === "ready") verifyExactSeededBook(manifest, options.lpAddress, book);
      else verifySafeLiveBook(manifest, book);
    });

    if (options.stage === "ready") {
      await check("LP locked collateral", async () => {
        balances ??= await walletBalances(options, manifest, pinnedProof());
        const expectedCash = BigInt(manifest.liquidity.askQuantityPerLevelAtomic)
          * BigInt(manifest.liquidity.levelsPerSide);
        const expectedUsdc = manifest.liquidity.bidPricesAtomic.reduce(
          (sum, price) => sum + (
            BigInt(price) * BigInt(manifest.liquidity.bidQuantityPerLevelAtomic)
          ) / 1_000_000_000_000n,
          0n,
        );
        if (
          BigInt(balances.internalCashLockedAtomic) !== expectedCash
          || BigInt(balances.internalUsdcLockedAtomic) !== expectedUsdc
          || BigInt(balances.internalCashAvailableAtomic) !== 0n
          || BigInt(balances.internalUsdcAvailableAtomic)
            !== BigInt(manifest.liquidity.maximumBidCapitalAtomic) - expectedUsdc
        ) {
          throw new Error("LP balances do not match the exact atomically seeded ladder and reviewed spare USDC.");
        }
      });
    }

    await check("frontend production environment", async () => {
      const frontendConfig = parseEnvFile(await readFile(options.frontendEnvPath, "utf8"));
      verifyFrontendConfig(
        options.contractAddress,
        options.adminAddress,
        options.lpAddress,
        attestedFingerprint,
        frontendConfig,
        options.indexerHealthUrl,
        options.fullnodeUrl,
        options.trustedFullnodeOrigin,
      );
    });

    await check("public Swap page", async () => {
      const response = await externalFetch(`${options.frontendUrl}/swap`);
      if (!response.ok) throw new Error(`Swap page returned HTTP ${response.status}.`);
      const type = response.headers.get("content-type") ?? "";
      if (!type.includes("text/html")) throw new Error("Swap page did not return HTML.");
    });

    await check("public authoritative depth endpoint", async () => {
      const depth = await externalJson(`${options.frontendUrl}/api/cash-orderbook/depth`);
      verifyPublicDepth(depth, options.contractAddress, manifest);
      verifyVersionAgainstLedgerProof(depth, "ledgerVersion", "Public depth endpoint", pinnedProof());
    });

    await check("public wallet balance endpoint", async () => {
      const response = await externalJson(
        `${options.frontendUrl}/api/cash-orderbook/balances?address=${encodeURIComponent(options.lpAddress)}`,
      );
      if (!response || typeof response !== "object") throw new Error("Public balance response is malformed.");
      const body = response as {
        network?: unknown;
        address?: unknown;
        ledgerVersion?: unknown;
        raw?: Record<string, unknown>;
      };
      if (
        body.network !== "mainnet"
        || normalizeLaunchAddress(body.address, "public balance address") !== normalizeLaunchAddress(options.lpAddress)
        || !body.raw
        || ["CASH", "USDC", "APT"].some((key) => !/^\d+$/.test(String(body.raw?.[key] ?? "")))
      ) {
        throw new Error("Public balance endpoint does not report the LP wallet on mainnet.");
      }
      verifyVersionAgainstLedgerProof(
        body,
        "ledgerVersion",
        "Public balance endpoint",
        pinnedProof(),
      );
    });

    await check("public shared trade tape", async () => {
      const trades = await externalJson(`${options.frontendUrl}/api/cash-orderbook/trades`);
      verifyPublicTrades(trades, options.contractAddress);
      verifyVersionAgainstLedgerProof(
        trades,
        "indexedLedgerVersion",
        "Public trade tape",
        pinnedProof(),
      );
    });

    await check("indexer health", async () => {
      const health = await externalJson(options.indexerHealthUrl);
      verifyIndexerHealth(
        health,
        options.contractAddress,
        pinnedProof().version,
      );
    });
  }

  if (options.stage === "smoke") {
    const proof = smokeProof;
    if (!proof) throw new Error("Reviewed smoke proof is unavailable.");
    const smokeVersions: Record<"buy" | "sell", string> = { buy: "", sell: "" };
    for (const direction of ["buy", "sell"] as const) {
      await check(`post-launch ${direction} transaction`, async () => {
        const transaction = await aptosJson(
          options,
          aptosUrl(options, `/transactions/by_hash/${proof[direction].transactionHash}`),
        );
        const verified = verifySmokeTransaction(
          transaction,
          options.contractAddress,
          manifest,
          proof,
          direction,
        );
        if (BigInt(verified.version) > pinnedProof().version) {
          throw new Error(`Smoke ${direction} transaction is newer than the pinned ledger snapshot.`);
        }
        smokeVersions[direction] = verified.version;
        return `version ${verified.version}, ${verified.filledBaseAtomic} base / ${verified.filledQuoteAtomic} quote atomic`;
      });
    }

    await check("public trade tape includes both smoke fills", async () => {
      if (!smokeVersions.buy || !smokeVersions.sell) {
        throw new Error("Both smoke transactions must produce verified versions.");
      }
      if (smokeVersions.buy === smokeVersions.sell) {
        throw new Error("Smoke buy and sell transactions must have distinct versions.");
      }
      const trades = await externalJson(`${options.frontendUrl}/api/cash-orderbook/trades`);
      verifyPublicTrades(trades, options.contractAddress, smokeVersions.buy, "buy");
      verifyPublicTrades(trades, options.contractAddress, smokeVersions.sell, "sell");
      verifyVersionAgainstLedgerProof(
        trades,
        "indexedLedgerVersion",
        "Public trade tape",
        pinnedProof(),
      );
    });
  }

  console.log(`CASH/USDC launch preflight: ${options.stage}`);
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}: ${result.detail}`);
  }
  const failures = results.filter((result) => !result.ok);
  console.log("");
  console.log(failures.length === 0 ? "READY: every required check passed." : `BLOCKED: ${failures.length} required check(s) failed.`);
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch((error: unknown) => {
    console.error(`BLOCKED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
