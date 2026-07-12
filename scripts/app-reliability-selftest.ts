import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

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
].map((path) => [path, readFileSync(path, "utf8")] as const);
const legacyBotGuard = readFileSync("lib/legacy-bot-guard.ts", "utf8");
const cloudStatusRoute = readFileSync("app/api/cloud-status/route.ts", "utf8");
const serverBotConfig = readFileSync("components/bot/server-bot-config.tsx", "utf8");
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
