import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  normalizeAptosAddress,
  normalizePositiveU64,
  normalizeU128,
} from "../lib/decibel";

const vaultRoute = readFileSync("app/api/decibel/vaults/route.ts", "utf8");
const tradePage = readFileSync("components/trade/TradePageClient.tsx", "utf8");
const cronRoute = readFileSync("app/api/cron/bot-tick/route.ts", "utf8");
const keeperRoute = readFileSync("app/api/launchpad/keeper/route.ts", "utf8");
const launchpadExecuteRoute = readFileSync("app/api/launchpad/execute/route.ts", "utf8");
const launchpadCrankRoute = readFileSync("app/api/launchpad/crank/route.ts", "utf8");
const launchpadDeployForm = readFileSync("components/launchpad/DeployForm.tsx", "utf8");
const testTradeRoute = readFileSync("app/api/bot/test-trade/route.ts", "utf8");
const statsRoute = readFileSync("app/api/stats/route.ts", "utf8");
const decibelCore = readFileSync("lib/decibel.ts", "utf8");
const decibelMarketsRoute = readFileSync("app/api/decibel/markets/route.ts", "utf8");
const decibelFaucetRoute = readFileSync("app/api/decibel/faucet/route.ts", "utf8");
const moveSourceRoute = readFileSync("app/api/launchpad/move-source/route.ts", "utf8");
const strategyVaultsRoute = readFileSync("app/api/launchpad/strategy-vaults/route.ts", "utf8");
const predepositData = readFileSync("lib/mainnet-predeposit.ts", "utf8");
const cashRewardsRoute = readFileSync("app/api/cash/rewards/route.ts", "utf8");
const legacyBacktestRoute = readFileSync("app/api/backtest/route.ts", "utf8");
const launchpadBacktestRoute = readFileSync("app/api/launchpad/backtest/route.ts", "utf8");
const marketRefreshRoute = readFileSync("app/api/markets/refresh/route.ts", "utf8");
const vercelIgnore = readFileSync(".vercelignore", "utf8");
const launchpadSignalsRoute = readFileSync("app/api/launchpad/signals/route.ts", "utf8");
const launchpadCurveRoute = readFileSync("app/api/launchpad/curve/route.ts", "utf8");
const launchpadIndicatorsRoute = readFileSync("app/api/launchpad/indicators/route.ts", "utf8");
const launchpadCreateRoute = readFileSync("app/api/launchpad/create/route.ts", "utf8");
const creatorDashboard = readFileSync("components/launchpad/CreatorDashboard.tsx", "utf8");
const launchpadWithdrawRoute = readFileSync("app/api/launchpad/withdraw/route.ts", "utf8");
const launchpadScheduledRoute = readFileSync("app/api/launchpad/scheduled/route.ts", "utf8");
const launchpadGraduateRoute = readFileSync("app/api/launchpad/graduate/route.ts", "utf8");
const launchpadPage = readFileSync("components/launchpad/LaunchpadPage.tsx", "utf8");
const decibelDepthRoute = readFileSync("app/api/decibel/depth/route.ts", "utf8");
const sponsorSubmitRoute = readFileSync("app/api/decibel/sponsor-submit/route.ts", "utf8");
const legacyBotRoutes = [
  "app/api/bot/start/route.ts",
  "app/api/bot/stop/route.ts",
  "app/api/bot/tick/route.ts",
  "app/api/bot/delegate/route.ts",
  "app/api/bot/close-position/route.ts",
  "app/api/cron/bot-tick/route.ts",
  "app/api/portfolio/route.ts",
  "app/api/positions/route.ts",
].map((path) => [path, readFileSync(path, "utf8")] as const);
const legacyBotGuard = readFileSync("lib/legacy-bot-guard.ts", "utf8");
const cloudStatusRoute = readFileSync("app/api/cloud-status/route.ts", "utf8");
const serverBotConfig = readFileSync("components/bot/server-bot-config.tsx", "utf8");
const tvImportRoute = readFileSync("app/api/launchpad/tv-import/route.ts", "utf8");
const decibelPublicRoute = readFileSync("app/api/decibel/public/route.ts", "utf8");
const sdkTestRoute = readFileSync("app/api/sdk-test/route.ts", "utf8");
const botDebugRoute = readFileSync("app/api/bot/debug/route.ts", "utf8");
const dlpBenchmarkRoute = readFileSync("app/api/dlp/benchmark/route.ts", "utf8");
const decibelPositionsRoute = readFileSync("app/api/decibel/positions/route.ts", "utf8");
const decibelSubaccountRoute = readFileSync("app/api/decibel/subaccount/route.ts", "utf8");
const decibelWalletBalanceRoute = readFileSync("app/api/decibel/wallet-balance/route.ts", "utf8");
const decibelStreamRoute = readFileSync("app/api/decibel/stream/route.ts", "utf8");
const decibelVaultStatusRoute = readFileSync("app/api/decibel/vaults/status/route.ts", "utf8");
const vaultActionModal = readFileSync("components/trade/VaultActionModal.tsx", "utf8");
const decibelVaultExtractRoute = readFileSync("app/api/decibel/vaults/extract/route.ts", "utf8");
const decibelOrderRoute = readFileSync("app/api/decibel/order/route.ts", "utf8");
const decibelCancelOrderRoute = readFileSync("app/api/decibel/cancel-order/route.ts", "utf8");
const decibelCreateSubaccountRoute = readFileSync("app/api/decibel/create-subaccount/route.ts", "utf8");
const decibelDepositRoute = readFileSync("app/api/decibel/deposit/route.ts", "utf8");
const decibelWithdrawRoute = readFileSync("app/api/decibel/withdraw/route.ts", "utf8");
const decibelTransferUsdcRoute = readFileSync("app/api/decibel/transfer-usdc/route.ts", "utf8");
const constantsSource = readFileSync("lib/constants.ts", "utf8");
const launchpadOnChainChart = readFileSync("components/launchpad/OnChainChart.tsx", "utf8");
const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  build?: { env?: Record<string, string> };
};
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies: Record<string, string>;
  engines?: { node?: string };
  pnpm?: { overrides?: Record<string, string> };
  packageManager?: string;
};

assert.match(vaultRoute, /const VAULT_PAGE_SIZE = 1_000;/);
assert.match(vaultRoute, /status: "active"/);
assert.match(vaultRoute, /remainingOffsets\.map\(fetchPage\)/);
assert.match(vaultRoute, /s-maxage=30, stale-while-revalidate=300/);
assert.match(vaultRoute, /next: \{ revalidate: 30 \}/);
assert.ok(!vaultRoute.includes("/vaults?limit=50"), "vault discovery must not stop at 50");
assert.ok(
  !vaultRoute.includes("v.status === \"active\" && (v.tvl ?? 0) > 0"),
  "zero-TVL active vaults must not be hidden after Decibel returns them",
);

assert.ok(!tradePage.includes("GUILD_OVERRIDES"), "real vault identities must not be replaced with demo guilds");
assert.ok(!tradePage.includes("buildPnlCurve"), "vault charts must not fabricate PnL history");
assert.match(tradePage, /const displayVaults = \[\.\.\.vaults\]/);
assert.ok(
  !tradePage.includes(".filter((v) => v.vault_type === \"protocol\""),
  "the vault carousel must show every active vault returned by Decibel",
);

assert.match(cronRoute, /if \(!cronSecret\)/);
assert.match(keeperRoute, /if \(!cronSecret\)/);
assert.match(keeperRoute, /LAUNCHPAD_KEEPER_API_SECRET/);
assert.match(launchpadExecuteRoute, /function authorizeKeeperExecution/);
assert.match(launchpadCrankRoute, /Server crank is not configured/);
assert.ok(
  !launchpadDeployForm.includes('fetch("/api/launchpad/crank"'),
  "the launchpad crank must use the connected wallet instead of spending server gas",
);
assert.match(launchpadDeployForm, /::indicator::tick_oracle/);
assert.match(testTradeRoute, /process\.env\.NODE_ENV === 'production'/);
assert.ok(!testTradeRoute.includes("PRIVATE_KEY preview"), "private-key fragments must never be logged");
assert.ok(!testTradeRoute.includes("error.stack"), "API responses must not expose server stacks");
assert.match(statsRoute, /reason: 'database_not_configured'/);
assert.match(decibelCore, /export function resolveDecibelNetwork/);
assert.match(decibelCore, /process\.env\.NEXT_PUBLIC_DECIBEL_NETWORK/);
assert.match(decibelMarketsRoute, /resolveDecibelNetwork/);
assert.match(decibelFaucetRoute, /resolveDecibelNetwork/);
assert.match(moveSourceRoute, /contracts\/strategy-vaults\/sources/);
assert.match(strategyVaultsRoute, /function databaseUnavailable/);
assert.match(strategyVaultsRoute, /launchpad_automation_not_enabled/);
assert.match(predepositData, /let depositorsInFlight/);
assert.match(predepositData, /const INDEXER_TIMEOUT_MS = 3_500/);
assert.match(cashRewardsRoute, /reason: 'database_not_configured'/);
assert.match(legacyBacktestRoute, /process\.env\.NODE_ENV === 'production'/);
assert.match(launchpadBacktestRoute, /A valid indicatorAddr is required/);
assert.match(launchpadBacktestRoute, /numSims must be an integer from 1 to 10,000/);
assert.match(marketRefreshRoute, /function authorizeRefresh/);
assert.match(marketRefreshRoute, /if \(!secret\)/);
assert.match(vercelIgnore, /^\.data$/m);
assert.ok(!launchpadSignalsRoute.includes("seedSignals"), "signal history must not be seeded");
assert.ok(!launchpadSignalsRoute.includes("ensureGenerator"), "signals must not be randomly generated");
assert.ok(!launchpadSignalsRoute.includes("Math.random"), "signals must come from authenticated keeper decisions");
assert.match(launchpadSignalsRoute, /Signal ingestion is not configured/);
assert.match(launchpadCurveRoute, /bonding_curve_not_deployed/);
assert.ok(!launchpadCurveRoute.includes("currentPrice: 0.00005"), "bonding-curve prices must not be fabricated");
assert.match(launchpadIndicatorsRoute, /discoverOnChainIndicators/);
assert.match(launchpadIndicatorsRoute, /aptos_testnet_unavailable/);
assert.match(launchpadIndicatorsRoute, /process\.env\.NODE_ENV === "production"\s*\? \[\]/);
assert.ok(
  !launchpadIndicatorsRoute.includes("prod_launchpad_5007e41e80"),
  "production marketplace entries must not ship mock Whop product IDs",
);
assert.ok(!launchpadCreateRoute.includes("Math.random"), "strategy creation must not invent an address");
assert.ok(!launchpadCreateRoute.includes("indicatorRegistry"), "unconfirmed strategies must not enter the marketplace");
assert.match(launchpadCreateRoute, /indicatorAddr: null/);
assert.match(launchpadCreateRoute, /pineScript\.length > 100_000/);
assert.match(launchpadDeployForm, /IndicatorCreated/);
assert.match(launchpadDeployForm, /LAUNCHPAD_CONTRACT,\s*\]\s*,/);
assert.match(launchpadDeployForm, /::indicator::set_proprietary/);
assert.match(launchpadDeployForm, /sha3_256/);
assert.ok(!launchpadDeployForm.includes("Compute SHA-256 hash"), "the displayed commitment must match Move's SHA3-256 contract");
assert.ok(!creatorDashboard.includes("MOCK_INDICATOR"), "creator balances must be read from Aptos");
assert.ok(!creatorDashboard.includes("DAILY_DATA_90"), "creator earnings charts must not be synthetic");
assert.ok(!creatorDashboard.includes("RECENT_PAYOUTS"), "creator payouts must not be synthetic");
assert.match(creatorDashboard, /indicators\?creator=/);
assert.match(launchpadWithdrawRoute, /creator_payout_not_enabled/);
assert.match(launchpadScheduledRoute, /launchpad_automation_not_enabled/);
assert.match(launchpadGraduateRoute, /launchpad_graduation_not_deployed/);
assert.ok(!launchpadGraduateRoute.includes("VAULT_ADDR_PLACEHOLDER"), "graduation must not return fake transactions");
assert.ok(!launchpadPage.includes("Fund Strategy"), "the undeployed bonding curve must not ask users for APT");
assert.ok(!launchpadPage.includes("Unlock · $29/mo"), "local browser state must not impersonate a paid subscription");
assert.ok(!launchpadPage.includes("ScheduleTradeModal"), "disabled automation must not expose a fake deploy flow");
assert.ok(!tradePage.includes("buildDemoStrategyCurve"), "strategy vault charts must not fabricate performance");
assert.ok(!tradePage.includes("subscribers"), "strategy cards must not fabricate subscriber counts");
assert.ok(!tradePage.includes("ScheduleTradeModal"), "the trade page must not expose disabled automation");
assert.ok(!decibelDepthRoute.includes("generateSyntheticDepth"), "order-book depth must come from Decibel");
assert.match(launchpadSignalsRoute, /paid_signal_delivery_not_configured/);
assert.ok(!launchpadSignalsRoute.includes('url.searchParams.get("bot")'), "paid signal feeds must not have a public bypass");
assert.match(sponsorSubmitRoute, /checkApiRateLimit\(req, "sponsor-submit"/);
assert.match(sponsorSubmitRoute, /checkRateLimitForKey\("sponsor-submit-sender"/);
assert.match(sponsorSubmitRoute, /MAX_BODY_BYTES/);
assert.ok(
  !sponsorSubmitRoute.includes("BOT_OPERATOR_PRIVATE_KEY"),
  "gas sponsorship must use a dedicated sponsor key",
);
assert.match(legacyBotGuard, /reason: "legacy_bot_api_not_enabled"/);
for (const [path, source] of legacyBotRoutes) {
  assert.match(
    source,
    /legacyBotAutomationUnavailable\(\)/,
    `${path} must fail closed in production until wallet-signed authorization exists`,
  );
}
assert.match(cloudStatusRoute, /legacyBotAutomationEnabled\(\)/);
assert.match(serverBotConfig, /wallet authorization is being hardened/);
assert.match(serverBotConfig, /automationEnabled && connected/);
assert.match(tvImportRoute, /parseTradingViewScriptUrl/);
assert.match(tvImportRoute, /parsed\.protocol !== "https:"/);
assert.match(tvImportRoute, /redirect: "error"/);
assert.match(tvImportRoute, /readTextWithinLimit/);
assert.match(tvImportRoute, /checkApiRateLimit\(req, "launchpad-tv-import"/);
assert.ok(!tvImportRoute.includes("fetch(rawUrl"), "the Pine importer must never fetch an unvalidated URL");
assert.match(decibelPublicRoute, /checkApiRateLimit\(req, "decibel-public"/);
assert.match(decibelPublicRoute, /APTOS_ADDRESS_RE/);
assert.match(decibelPublicRoute, /end - start > intervalMs \* 990/);
assert.match(sdkTestRoute, /process\.env\.NODE_ENV === 'production'/);
assert.match(botDebugRoute, /process\.env\.NODE_ENV === 'production'/);
assert.match(dlpBenchmarkRoute, /reason: 'dlp_benchmark_not_enabled'/);
assert.match(decibelCore, /export function isValidAptosAddress/);
assert.match(decibelPositionsRoute, /decibel-positions-hot/);
assert.match(decibelPositionsRoute, /isValidAptosAddress\(address\)/);
assert.ok(!decibelPositionsRoute.includes("unavailable: ${indexedResult.error}"));
assert.match(decibelSubaccountRoute, /checkApiRateLimit\(req, "decibel-subaccount"/);
assert.match(decibelSubaccountRoute, /isValidAptosAddress\(address\)/);
assert.match(decibelWalletBalanceRoute, /checkApiRateLimit\(req, "decibel-wallet-balance"/);
assert.match(decibelWalletBalanceRoute, /AbortSignal\.timeout\(4_000\)/);
assert.ok(!decibelWalletBalanceRoute.includes("response.text()"), "wallet balance errors must not echo upstream bodies");
assert.match(decibelStreamRoute, /checkApiRateLimit\(req, "decibel-stream"/);
assert.match(decibelStreamRoute, /resolveDecibelNetwork/);
assert.match(decibelStreamRoute, /\[a-fA-F0-9\]\{1,64\}/);
assert.match(decibelMarketsRoute, /checkApiRateLimit\(req, "decibel-markets"/);
assert.match(decibelVaultStatusRoute, /isValidAptosAddress/);
assert.match(decibelVaultStatusRoute, /resolveDecibelNetwork\(body\.network\)/);
assert.match(vaultActionModal, /network: indicator\.network/);
assert.match(decibelVaultExtractRoute, /checkApiRateLimit\(req, "decibel-vault-extract"/);
assert.match(decibelVaultExtractRoute, /\^0x\[0-9a-fA-F\]\{64\}\$/);
assert.match(decibelVaultExtractRoute, /expectedEventType/);
assert.match(decibelVaultExtractRoute, /type\.toLowerCase\(\) !== expectedEventType/);
assert.match(decibelVaultExtractRoute, /linkReason = "launchpad_automation_not_enabled"/);
assert.match(decibelVaultExtractRoute, /transaction_sender_does_not_own_strategy/);
assert.match(vaultActionModal, /allocationPct,\s*network: indicator\.network/);
assert.match(constantsSource, /process\.env\.NEXT_PUBLIC_DECIBEL_NETWORK/);
assert.match(constantsSource, /network: AptosNetworkName = APTOS_NETWORK/);
assert.match(launchpadOnChainChart, /explorerAccountUrl\(indicatorAddr, "testnet"\)/);
assert.equal(normalizePositiveU64("18446744073709551615"), "18446744073709551615");
assert.equal(normalizePositiveU64("000001"), "1");
assert.throws(() => normalizePositiveU64("18446744073709551616"), /within range/);
assert.throws(() => normalizeU128("9".repeat(10_000)), /within range/);
assert.throws(() => normalizePositiveU64(Number.MAX_SAFE_INTEGER + 1), /safe unsigned integer/);
assert.equal(
  normalizeU128("340282366920938463463374607431768211455"),
  "340282366920938463463374607431768211455",
);
assert.throws(
  () => normalizeU128("340282366920938463463374607431768211456"),
  /within range/,
);
assert.equal(
  normalizeAptosAddress("0x1"),
  `0x${"0".repeat(63)}1`,
);
assert.match(decibelCore, /normalizePositiveU64\(args\.amount, "amount"\)/);
assert.match(decibelOrderRoute, /checkApiRateLimit\(req, "decibel-order-build"/);
assert.match(decibelOrderRoute, /typeof isBuy !== "boolean"/);
assert.match(decibelOrderRoute, /typeof reduceOnly !== "boolean"/);
assert.match(decibelCancelOrderRoute, /normalizeU128\(orderId, "orderId"\)/);
assert.match(decibelCreateSubaccountRoute, /isValidAptosAddress\(owner\)/);
assert.match(decibelFaucetRoute, /normalizePositiveU64\(body\.amount/);
assert.match(decibelFaucetRoute, /checkApiRateLimit\(req, "decibel-faucet-build"/);
for (const route of [decibelDepositRoute, decibelWithdrawRoute, decibelTransferUsdcRoute]) {
  assert.match(route, /normalizePositiveU64\(amount, "amount"\)/);
  assert.match(route, /checkApiRateLimit\(req,/);
}
assert.ok(
  !decibelTransferUsdcRoute.includes("Number(amount)"),
  "raw USDC transfers must not lose precision through JavaScript Number",
);

for (const removedDependency of [
  "@blocto/aptos-wallet-adapter-plugin",
  "@keyv/etcd",
  "@keyv/sqlite",
  "@telegram-apps/bridge",
  "keyv",
  "petra-plugin-wallet-adapter",
]) {
  assert.ok(
    !(removedDependency in packageJson.dependencies),
    `${removedDependency} must not return as an unused production dependency`,
  );
}

assert.equal(packageJson.dependencies.next, "^16.2.10");
assert.equal(packageJson.dependencies.ws, "^8.21.0");
assert.equal(packageJson.dependencies["@noble/hashes"], "1.8.0");
assert.equal(packageJson.pnpm?.overrides?.["uuid@<11.1.1"], "11.1.1");
assert.equal(packageJson.packageManager, "pnpm@10.19.0");
assert.equal(packageJson.engines?.node, "22.x");
assert.equal(vercelConfig.build?.env?.NODE_VERSION, "22");
assert.ok(!existsSync("package-lock.json"), "the pnpm project must not ship a competing npm lockfile");

console.log("app reliability self-test: passed");
