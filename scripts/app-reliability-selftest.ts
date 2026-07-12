import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  normalizeAptosAddress,
  normalizePositiveU64,
  normalizeU128,
} from "../lib/decibel";
import {
  buildCreateDecibelVaultPayload,
  buildDelegateDecibelVaultPayload,
  buildDepositDecibelVaultPayload,
} from "../lib/decibel-vaults";
import {
  decodeMoveU8Vector,
  pairOnChainTrades,
  parseOnChainTradeVectors,
} from "../lib/launchpad/move-view";
import { decibelSubaccountStorageKey } from "../lib/decibel-selection";

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
const predepositBalancesRoute = readFileSync("app/api/predeposit/balances/route.ts", "utf8");
const predepositEventsRoute = readFileSync("app/api/predeposit/events/route.ts", "utf8");
const predepositLeaderboardRoute = readFileSync("app/api/predeposit/leaderboard/route.ts", "utf8");
const predepositPointsRoute = readFileSync("app/api/predeposit/points/route.ts", "utf8");
const predepositTotalRoute = readFileSync("app/api/predeposit/total/route.ts", "utf8");
const predepositUserRoute = readFileSync("app/api/predeposit/user/route.ts", "utf8");
const vaultTotalRoute = readFileSync("app/api/vault/total/route.ts", "utf8");
const vaultUserRoute = readFileSync("app/api/vault/user/route.ts", "utf8");
const pointsDataContext = readFileSync("contexts/points-data-context.tsx", "utf8");
const walletWatcher = readFileSync("components/points/wallet-watcher.tsx", "utf8");
const decibelSubaccountHook = readFileSync("hooks/useDecibelSubaccounts.ts", "utf8");
const portfolioPage = readFileSync("components/portfolio/PortfolioPageClient.tsx", "utf8");
const positionsComponent = readFileSync("components/trade/Positions.tsx", "utf8");
const tradePanel = readFileSync("components/trade/TradePanel.tsx", "utf8");
const depositHistory = readFileSync("components/points/deposit-history.tsx", "utf8");
const dashboardHistory = readFileSync("components/dashboard/history-table.tsx", "utf8");
const botStatusMonitor = readFileSync("components/bot/bot-status-monitor.tsx", "utf8");
const botOrderHistory = readFileSync("components/bot/order-history-table.tsx", "utf8");
const decibelPoints = readFileSync("lib/decibel-points.ts", "utf8");
const pointsStats = readFileSync("components/points/points-stats.tsx", "utf8");
const pointsCalculator = readFileSync("components/points/points-calculator.tsx", "utf8");
const pointsLeaderboard = readFileSync("components/points/leaderboard.tsx", "utf8");
const farmingTips = readFileSync("components/points/farming-tips.tsx", "utf8");
const cashRewardsRoute = readFileSync("app/api/cash/rewards/route.ts", "utf8");
const legacyBacktestRoute = readFileSync("app/api/backtest/route.ts", "utf8");
const launchpadBacktestRoute = readFileSync("app/api/launchpad/backtest/route.ts", "utf8");
const launchpadCandlesRoute = readFileSync("app/api/launchpad/candles/route.ts", "utf8");
const launchpadPyth = readFileSync("lib/launchpad/pyth.ts", "utf8");
const launchpadPriceTickRoute = readFileSync("app/api/launchpad/price-tick/route.ts", "utf8");
const launchpadOnChainRoute = readFileSync("app/api/launchpad/on-chain/route.ts", "utf8");
const launchpadTradesRoute = readFileSync("app/api/launchpad/trades/route.ts", "utf8");
const launchpadSignalStreamRoute = readFileSync("app/api/launchpad/signals/stream/route.ts", "utf8");
const marketRefreshRoute = readFileSync("app/api/markets/refresh/route.ts", "utf8");
const vercelIgnore = readFileSync(".vercelignore", "utf8");
const launchpadSignalsRoute = readFileSync("app/api/launchpad/signals/route.ts", "utf8");
const launchpadCurveRoute = readFileSync("app/api/launchpad/curve/route.ts", "utf8");
const launchpadIndicatorsRoute = readFileSync("app/api/launchpad/indicators/route.ts", "utf8");
const launchpadCreateRoute = readFileSync("app/api/launchpad/create/route.ts", "utf8");
const launchpadVerifyRoute = readFileSync("app/api/launchpad/verify/route.ts", "utf8");
const creatorDashboard = readFileSync("components/launchpad/CreatorDashboard.tsx", "utf8");
const launchpadWithdrawRoute = readFileSync("app/api/launchpad/withdraw/route.ts", "utf8");
const launchpadScheduledRoute = readFileSync("app/api/launchpad/scheduled/route.ts", "utf8");
const launchpadGraduateRoute = readFileSync("app/api/launchpad/graduate/route.ts", "utf8");
const launchpadPage = readFileSync("components/launchpad/LaunchpadPage.tsx", "utf8");
const sharedHeader = readFileSync("components/layout/Header.tsx", "utf8");
const automationPage = readFileSync("app/automation/page.tsx", "utf8");
const decibelDepthRoute = readFileSync("app/api/decibel/depth/route.ts", "utf8");
const sponsorSubmitRoute = readFileSync("app/api/decibel/sponsor-submit/route.ts", "utf8");
const legacyBotRoutes = [
  "app/api/bot/start/route.ts",
  "app/api/bot/stop/route.ts",
  "app/api/bot/tick/route.ts",
  "app/api/bot/delegate/route.ts",
  "app/api/bot/close-position/route.ts",
  "app/api/bot/check-delegation/route.ts",
  "app/api/bot/status/route.ts",
  "app/api/cron/bot-tick/route.ts",
  "app/api/portfolio/route.ts",
  "app/api/positions/route.ts",
  "app/api/stats/route.ts",
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
const decibelVaultApi = readFileSync("lib/decibel-vault-api.ts", "utf8");
const decibelVaultDelegateRoute = readFileSync("app/api/decibel/vaults/delegate/route.ts", "utf8");
const btcCandlesRoute = readFileSync("app/api/btc/candles/route.ts", "utf8");
const btcTickerRoute = readFileSync("app/api/btc/ticker/route.ts", "utf8");
const btcHistory = readFileSync("lib/btc-history.ts", "utf8");
const coinbaseCandlesRoute = readFileSync("app/api/coinbase/candles/route.ts", "utf8");
const coinbaseTickerRoute = readFileSync("app/api/coinbase/ticker/route.ts", "utf8");
const coinbaseTradesRoute = readFileSync("app/api/coinbase/trades/route.ts", "utf8");
const cctpStatusRoute = readFileSync("app/api/decibel/cctp/status/route.ts", "utf8");
const decibelOrderRoute = readFileSync("app/api/decibel/order/route.ts", "utf8");
const decibelCancelOrderRoute = readFileSync("app/api/decibel/cancel-order/route.ts", "utf8");
const decibelCreateSubaccountRoute = readFileSync("app/api/decibel/create-subaccount/route.ts", "utf8");
const decibelDepositRoute = readFileSync("app/api/decibel/deposit/route.ts", "utf8");
const decibelWithdrawRoute = readFileSync("app/api/decibel/withdraw/route.ts", "utf8");
const decibelTransferUsdcRoute = readFileSync("app/api/decibel/transfer-usdc/route.ts", "utf8");
const constantsSource = readFileSync("lib/constants.ts", "utf8");
const launchpadOnChainChart = readFileSync("components/launchpad/OnChainChart.tsx", "utf8");
const explainerPage = readFileSync("app/explainer/page.tsx", "utf8");
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
assert.match(vaultRoute, /status: 502, headers: VAULT_UNAVAILABLE_HEADERS/);
assert.match(vaultRoute, /function validatePage/);
assert.match(vaultRoute, /uniqueVaults\.size !== firstPage\.total_count/);
assert.ok(!vaultRoute.includes("/vaults?limit=50"), "vault discovery must not stop at 50");
assert.ok(
  !vaultRoute.includes("v.status === \"active\" && (v.tvl ?? 0) > 0"),
  "zero-TVL active vaults must not be hidden after Decibel returns them",
);

assert.ok(!tradePage.includes("GUILD_OVERRIDES"), "real vault identities must not be replaced with demo guilds");
assert.ok(!tradePage.includes("buildPnlCurve"), "vault charts must not fabricate PnL history");
assert.notEqual(
  decibelSubaccountStorageKey("0xABC", "mainnet"),
  decibelSubaccountStorageKey("0xABC", "testnet"),
  "selected subaccounts must be scoped by Decibel network",
);
assert.notEqual(
  decibelSubaccountStorageKey("0xABC", "mainnet"),
  decibelSubaccountStorageKey("0xDEF", "mainnet"),
  "selected subaccounts must be scoped by wallet owner",
);
assert.ok(
  !decibelSubaccountHook.includes('name: "Primary"'),
  "an unverified stored address must not be presented as an active Primary account",
);
assert.match(pointsDataContext, /requestIdRef\.current === requestId/);
assert.match(pointsDataContext, /activeAddrRef\.current === addr/);
assert.match(pointsDataContext, /requestIdRef\.current \+= 1/);
assert.ok(!portfolioPage.includes("buildPortfolioSeries"), "portfolio history must not be synthesized from one snapshot");
for (const fabricatedMetric of ["2.0139", "67.28%", "41.67%"] as const) {
  assert.ok(!portfolioPage.includes(fabricatedMetric), "portfolio risk metrics must not be hard-coded");
}
assert.match(portfolioPage, /cash\.trading does not fabricate missing history/);
assert.match(portfolioPage, /withdrawingRef\.current/);
assert.match(portfolioPage, /isValidAptosAddress\(recipient\)/);
assert.ok(
  portfolioPage.indexOf("await waitForTransactionConfirmation(cancel.hash)")
    < portfolioPage.indexOf("openOrders: prev.openOrders.filter"),
  "an order must remain visible until its cancellation confirms",
);
assert.ok(!tradePage.includes("local-liq-"), "browser-only liquidations must not impersonate on-chain state");
assert.ok(!tradePage.includes("onPositionOpen={"), "confirmed Decibel positions must not be duplicated in local state");
assert.ok(!tradePage.includes("<PositionsTable"), "the page must show only the wallet-signed Decibel positions table");
assert.ok(!tradePage.includes("<PnlCardModal"), "the page must not show locally calculated realized PnL as a confirmed close");
const cancelOrderAction = positionsComponent.slice(
  positionsComponent.indexOf("const handleCancelOrder"),
  positionsComponent.indexOf("useEffect(() => {", positionsComponent.indexOf("const handleCancelOrder")),
);
assert.ok(
  cancelOrderAction.indexOf("await waitForTransactionConfirmation(hash)")
    < cancelOrderAction.indexOf("setOpenOrders((prev)"),
  "an open order must remain visible until its cancellation confirms",
);
assert.match(positionsComponent, /closingActionTokensRef/);
assert.match(positionsComponent, /cancelingActionTokensRef/);
assert.match(tradePanel, /submissionTokenRef/);
assert.match(tradePanel, /tradeContextRef/);
assert.match(tradePage, /const displayVaults = \[\.\.\.vaults\]/);
assert.ok(!tradePage.includes('if (n == null) return "$0"'), "missing vault metrics must not render as real zero dollars");
assert.ok(!tradePage.includes("vault.depositors ?? 0"), "missing vault depositor counts must remain unavailable");
assert.ok(!tradePage.includes("vault.sharpe_ratio ?? 0"), "missing vault risk metrics must remain unavailable");
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
assert.match(predepositData, /const FULLNODE_TIMEOUT_MS = 5_000/);
assert.match(predepositData, /AbortSignal\.timeout\(FULLNODE_TIMEOUT_MS\)/);
assert.match(predepositData, /const MAX_INDEXER_PAGES = 200/);
assert.ok(
  !predepositData.includes("dlp_balance: 0,\n      ua_balance: 0"),
  "failed mainnet balance reads must not masquerade as a zero balance",
);
for (const [path, source] of [
  ["predeposit balances", predepositBalancesRoute],
  ["predeposit events", predepositEventsRoute],
  ["predeposit leaderboard", predepositLeaderboardRoute],
  ["predeposit points", predepositPointsRoute],
  ["predeposit total", predepositTotalRoute],
  ["predeposit user", predepositUserRoute],
  ["vault total", vaultTotalRoute],
  ["vault user", vaultUserRoute],
] as const) {
  assert.match(source, /checkApiRateLimit/, `${path} must be rate limited`);
  assert.match(source, /unavailable: true/, `${path} must identify unavailable upstream data`);
  assert.match(source, /status: 502/, `${path} must not return a successful zero on upstream failure`);
}
assert.match(pointsDataContext, /!response\.ok \|\| !json \|\| json\.unavailable/);
assert.match(walletWatcher, /if \(!pointsRes\.ok \|\| !balancesRes\.ok\)/);
assert.match(walletWatcher, /network=mainnet/);
assert.match(depositHistory, /timestamp < 1_000_000_000_000/);
assert.match(depositHistory, /network=mainnet/);
assert.match(predepositData, /user_transactions/);
assert.match(predepositData, /transactions\/by_version/);
assert.match(predepositData, /::predeposit::WithdrawEvent/);
assert.match(predepositEventsRoute, /rawEventKind === 'promote'/);
assert.match(predepositData, /has_depositor_transitioned/);
assert.match(predepositData, /::predeposit::LaunchTransitionEvent/);
assert.match(decibelPoints, /\/points\/global/);
assert.match(decibelPoints, /\/points_leaderboard/);
assert.match(decibelPoints, /\/points\/amps/);
assert.match(decibelPoints, /AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/);
assert.match(predepositTotalRoute, /getDecibelGlobalPoints/);
assert.match(predepositLeaderboardRoute, /getDecibelPointsLeaderboard/);
assert.match(predepositPointsRoute, /getDecibelOwnerPoints/);
assert.match(predepositUserRoute, /getDecibelOwnerPoints/);
assert.match(pointsDataContext, /cash_trading_points_cache_v2/);
assert.match(pointsDataContext, /vaultTotal\.protocolTvl/);
assert.match(pointsStats, /Season 1/);
assert.match(pointsLeaderboard, /Vault AMPs/);
assert.ok(!pointsCalculator.includes("POINTS_RATE"), "the AMPs scenario must not use the obsolete S0 formula");
assert.ok(!pointsCalculator.includes("HYPE was"), "the AMPs scenario must not imply an unrelated token valuation");
assert.ok(!farmingTips.includes("Automated volume generation"), "points tips must not encourage artificial volume");
assert.match(vaultTotalRoute, /limit: 1000, strict: true/);
assert.match(vaultTotalRoute, /vault\.status === 'active'/);
assert.match(vaultTotalRoute, /protocolTvl/);
assert.match(vaultUserRoute, /'mainnet', true/);
assert.match(decibelPoints, /typeof value !== 'number'/);
assert.match(readFileSync("lib/decibel-api.ts", "utf8"), /VAULT_READ_TIMEOUT_MS = 12_000/);
assert.match(cashRewardsRoute, /reason: 'database_not_configured'/);
assert.match(cashRewardsRoute, /checkApiRateLimit\(request, 'cash-rewards-read'/);
assert.match(cashRewardsRoute, /checkApiRateLimit\(request, 'cash-rewards-process'/);
assert.match(cashRewardsRoute, /isValidAptosAddress\(rawWalletAddress\)/);
assert.match(cashRewardsRoute, /MAX_BODY_BYTES = 4_000/);
for (const [name, source] of [
  ["dashboard history", dashboardHistory],
  ["bot status history", botStatusMonitor],
  ["bot order history", botOrderHistory],
] as const) {
  assert.match(source, /explorerTxUrl/);
  assert.ok(
    !source.includes("?network=testnet"),
    `${name} must follow the configured Decibel network`,
  );
}
assert.match(legacyBacktestRoute, /process\.env\.NODE_ENV === 'production'/);
assert.match(launchpadBacktestRoute, /A valid indicatorAddr is required/);
assert.match(launchpadBacktestRoute, /numSims must be an integer from 1 to 10,000/);
assert.match(launchpadBacktestRoute, /checkApiRateLimit\(req, "launchpad-backtest"/);
assert.match(launchpadBacktestRoute, /MAX_BODY_BYTES = 16_000/);
assert.match(launchpadBacktestRoute, /AbortSignal\.any/);
assert.match(launchpadCandlesRoute, /MAX_DAYS_BY_RESOLUTION/);
assert.match(launchpadCandlesRoute, /checkApiRateLimit\(req, "launchpad-candles"/);
assert.match(launchpadPyth, /AbortSignal\.timeout\(10_000\)/);
assert.match(launchpadPriceTickRoute, /checkApiRateLimit\(req, "launchpad-price-tick"/);
assert.match(launchpadPriceTickRoute, /Pyth returned invalid price data/);
assert.match(launchpadOnChainRoute, /checkApiRateLimit\(req, "launchpad-on-chain"/);
assert.match(launchpadOnChainRoute, /isValidAptosAddress\(addr\)/);
assert.match(launchpadOnChainRoute, /parseScaledVectorView/);
assert.match(launchpadOnChainRoute, /status: 502/);
assert.ok(!launchpadOnChainRoute.includes("error: String(err)"));
assert.match(launchpadTradesRoute, /checkApiRateLimit\(req, "launchpad-trades"/);
assert.match(launchpadTradesRoute, /isValidAptosAddress\(addr\)/);
assert.match(launchpadTradesRoute, /parseOnChainTradeVectors/);
assert.match(launchpadTradesRoute, /completedTrades/);
assert.match(launchpadTradesRoute, /status: 502/);
assert.match(launchpadOnChainChart, /candleAbortRef/);
assert.match(launchpadOnChainChart, /high < Math\.max\(open, close\)/);
assert.match(launchpadOnChainChart, /manualKeeperEnabled = process\.env\.NODE_ENV !== "production"/);
assert.ok(!explainerPage.includes('href="#"'), "explainer calls to action must navigate somewhere real");
assert.match(explainerPage, /60 live markets/);
assert.match(marketRefreshRoute, /function authorizeRefresh/);
assert.match(marketRefreshRoute, /if \(!secret\)/);
assert.match(vercelIgnore, /^\.data$/m);
assert.ok(!launchpadSignalsRoute.includes("seedSignals"), "signal history must not be seeded");
assert.ok(!launchpadSignalsRoute.includes("ensureGenerator"), "signals must not be randomly generated");
assert.ok(!launchpadSignalsRoute.includes("Math.random"), "signals must come from authenticated keeper decisions");
assert.match(launchpadSignalsRoute, /Signal ingestion is not configured/);
assert.match(launchpadSignalsRoute, /checkApiRateLimit\(req, "launchpad-signals"/);
assert.match(launchpadSignalsRoute, /paid_signal_delivery_not_configured/);
assert.match(launchpadSignalsRoute, /streamUrl\.searchParams\.set\("indicators"/);
assert.match(launchpadSignalStreamRoute, /requested\.length > 32/);
assert.match(launchpadSignalStreamRoute, /isProprietarySignalIndicator/);
assert.match(launchpadSignalStreamRoute, /checkApiRateLimit\(req, "launchpad-signal-stream"/);
assert.match(launchpadVerifyRoute, /checkApiRateLimit\(req, "launchpad-verify"/);
assert.match(launchpadVerifyRoute, /SOURCE_HASH_RE/);
assert.match(launchpadVerifyRoute, /clientConfig: \{ API_KEY: apiKey \}/);
assert.match(launchpadVerifyRoute, /withTimeout/);
assert.match(launchpadVerifyRoute, /artifact_registry_unavailable/);
assert.match(launchpadVerifyRoute, /registryUnavailable/);
assert.match(launchpadCurveRoute, /bonding_curve_not_deployed/);
assert.match(launchpadCurveRoute, /checkApiRateLimit\(req, "launchpad-curve-read"/);
assert.match(launchpadCurveRoute, /checkApiRateLimit\(req, "launchpad-curve-payload"/);
assert.match(launchpadCurveRoute, /const MAX_BODY_BYTES = 4_000/);
assert.match(launchpadCurveRoute, /const U64_MAX/);
assert.ok(
  launchpadCurveRoute.indexOf("if (!launchpadPackage)") < launchpadCurveRoute.indexOf("const rawBody"),
  "the disabled bonding curve must fail closed before reading a request body",
);
assert.ok(!launchpadCurveRoute.includes("currentPrice: 0.00005"), "bonding-curve prices must not be fabricated");
assert.match(launchpadIndicatorsRoute, /discoverOnChainIndicators/);
assert.match(launchpadIndicatorsRoute, /checkApiRateLimit\(req, "launchpad-indicators"/);
assert.match(launchpadIndicatorsRoute, /process\.env\.NODE_ENV !== "production"/);
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
assert.match(launchpadCreateRoute, /checkApiRateLimit\(req, "launchpad-create"/);
assert.match(launchpadCreateRoute, /MAX_BODY_BYTES = 120_000/);
assert.ok(
  !launchpadCreateRoute.includes("{ error: message }"),
  "transpiler internals must not leak to clients",
);
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
assert.match(sharedHeader, /process\.env\.NODE_ENV !== "production"/);
assert.match(automationPage, /process\.env\.NODE_ENV === "production"/);
assert.match(automationPage, /redirect\("\/portfolio"\)/);
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
const validVaultCreate = buildCreateDecibelVaultPayload({
  subaccount: "0x1",
  vaultName: "Reliability Vault",
  vaultShareSymbol: "RVT",
  initialFundingRaw: "0",
  feeBps: 100,
  network: "mainnet",
});
assert.equal(validVaultCreate.network, "mainnet");
assert.equal(validVaultCreate.kind, "create");
assert.throws(
  () => buildCreateDecibelVaultPayload({
    subaccount: "0x1",
    vaultName: "v".repeat(65),
    vaultShareSymbol: "RVT",
    network: "mainnet",
  }),
  /vaultName must be at most 64 characters/,
);
assert.throws(
  () => buildCreateDecibelVaultPayload({
    subaccount: "0x1",
    vaultName: "Vault",
    vaultShareSymbol: "RVT",
    feeBps: 10_001,
    network: "mainnet",
  }),
  /feeBps must be between 0 and 10000/,
);
assert.throws(
  () => buildCreateDecibelVaultPayload({
    subaccount: "0x1",
    vaultName: "Vault",
    vaultShareSymbol: "RVT",
    network: "invalid" as "mainnet",
  }),
  /network must be testnet or mainnet/,
);
assert.equal(
  buildDepositDecibelVaultPayload({
    subaccount: "0x1",
    vaultAddress: "0x2",
    amountRaw: "18446744073709551615",
    network: "mainnet",
  }).amountRaw,
  "18446744073709551615",
);
assert.throws(
  () => buildDepositDecibelVaultPayload({
    subaccount: "0x1",
    vaultAddress: "0x2",
    amountRaw: "9".repeat(10_000),
    network: "mainnet",
  }),
  /amountRaw must fit in u64/,
);
assert.throws(
  () => buildDelegateDecibelVaultPayload({
    vaultAddress: "0x2",
    network: "mainnet",
  }),
  /delegate must be a valid Aptos address/,
);
assert.match(decibelVaultApi, /MAX_VAULT_PAYLOAD_BODY_BYTES = 32_000/);
assert.match(decibelVaultApi, /checkApiRateLimit\(req, routeKey/);
assert.match(decibelVaultDelegateRoute, /launchpad_automation_not_enabled/);
assert.match(btcCandlesRoute, /checkApiRateLimit\(req, "btc-candles"/);
assert.match(btcCandlesRoute, /limit must be an integer from 1 to 1000/);
assert.match(btcTickerRoute, /checkApiRateLimit\(req, "btc-ticker"/);
assert.match(btcHistory, /AbortSignal\.timeout\(MARKET_DATA_TIMEOUT_MS\)/);
assert.match(coinbaseCandlesRoute, /SUPPORTED_GRANULARITIES/);
assert.match(coinbaseCandlesRoute, /checkApiRateLimit\(req, "coinbase-candles"/);
assert.match(coinbaseTickerRoute, /checkApiRateLimit\(req, "coinbase-ticker"/);
assert.match(coinbaseTradesRoute, /checkApiRateLimit\(req, "coinbase-trades"/);
assert.match(coinbaseTradesRoute, /COINBASE_TRADES_TIMEOUT_MS/);
assert.match(cctpStatusRoute, /checkApiRateLimit\(req, "cctp-status"/);
assert.match(cctpStatusRoute, /rawNetwork !== "testnet" && rawNetwork !== "mainnet"/);
assert.match(cctpStatusRoute, /MAX_IRIS_RESPONSE_BYTES/);
assert.ok(
  !cctpStatusRoute.includes("{ error: rawText"),
  "CCTP status must not echo arbitrary Circle response bodies",
);
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
assert.deepEqual(decodeMoveU8Vector("0x010201"), [1, 2, 1]);
assert.throws(() => decodeMoveU8Vector("0x010"), /Move byte vector/);
const parsedMoveTrades = parseOnChainTradeVectors([
  ["10", "11", "12", "13"],
  "0x01010202",
  ["100000000", "110000000", "120000000", "130000000"],
  ["0", "0", "250", "0"],
  ["0", "0", "0", "125"],
  ["100", "101", "102", "103"],
]);
assert.deepEqual(parsedMoveTrades.map((trade) => trade.signal), [1, 1, 2, 2]);
assert.equal(parsedMoveTrades[2].pnlBps, 250);
const parsedMovePairs = pairOnChainTrades(parsedMoveTrades);
assert.equal(parsedMovePairs.length, 1);
assert.equal(parsedMovePairs[0].entryTrade.tradeId, 11);
assert.equal(parsedMovePairs[0].exitTrade?.tradeId, 12);
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
