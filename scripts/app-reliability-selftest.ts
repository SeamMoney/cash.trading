import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { PYTH_FEED_IDS } from "../lib/launchpad/constants";
import { SEALED_MARKETS_BY_NETWORK } from "../lib/sealed-vaults";
import {
  builderFeeBpsToChainUnits,
  buildDecibelOrderPayload,
  normalizeAptosAddress,
  normalizePositiveU64,
  normalizeU128,
} from "../lib/decibel";
import {
  buildCreateDecibelVaultPayload,
  buildDelegateDecibelVaultPayload,
  buildDepositDecibelVaultPayload,
  buildWithdrawDecibelVaultPayload,
} from "../lib/decibel-vaults";
import {
  decodeMoveU8Vector,
  pairOnChainTrades,
  parseOnChainTradeVectors,
  sanitizeOnChainTrades,
} from "../lib/launchpad/move-view";
import { decibelSubaccountStorageKey } from "../lib/decibel-selection";
import { resolveDecibelWalletIdentity } from "../lib/decibel-wallet-identity";
import { parseCctpMessage } from "../lib/decibel-cctp";
import { summarizeDecibelFees } from "../lib/decibel-fees";
import { getEvmSourceChainFromChainId } from "../lib/evm-cctp";
import {
  formatVaultUsd,
  hasMeaningfulVaultActivity,
} from "../lib/decibel-vault-display";
import type { DecibelTrade } from "../lib/decibel-api";
import { extractConfirmedDecibelFill } from "../lib/decibel-trade-fill";
import {
  DEFAULT_AUTOMATED_VAULT_BUILDER_FEE_BPS,
  DEFAULT_DECIBEL_BUILDER_FEE_BPS,
  DEFAULT_DECIBEL_BUILDER_FEE_RATE,
  MAX_AUTOMATED_VAULT_BUILDER_FEE_BPS,
} from "../lib/decibel-builder-config";
import {
  runBacktest as runLegacyLaunchpadBacktest,
  runRandomizedBacktests as runLegacyRandomizedBacktests,
} from "../lib/launchpad/keeper";

const vaultRoute = readFileSync("app/api/decibel/vaults/route.ts", "utf8");
const decibelVaultList = readFileSync("lib/decibel-vault-list.ts", "utf8");
const tradePage = readFileSync("components/trade/TradePageClient.tsx", "utf8");
const cronRoute = readFileSync("app/api/cron/bot-tick/route.ts", "utf8");
const keeperRoute = readFileSync("app/api/launchpad/keeper/route.ts", "utf8");
const launchpadExecuteRoute = readFileSync("app/api/launchpad/execute/route.ts", "utf8");
const launchpadCrankRoute = readFileSync("app/api/launchpad/crank/route.ts", "utf8");
const sealedLaunch = readFileSync("components/sealed/SealedLaunch.tsx", "utf8");
const strategySourceEditor = readFileSync("components/launchpad/StrategySourceEditor.tsx", "utf8");
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
const pointsData = readFileSync("components/points/use-points-data.ts", "utf8");
const pointsPageClient = readFileSync("components/points/points-page-client.tsx", "utf8");
const pointsProfileRoute = readFileSync("app/api/points/profile/route.ts", "utf8");
const decibelSubaccountHook = readFileSync("hooks/useDecibelSubaccounts.ts", "utf8");
const decibelTransactionSubmitter = readFileSync("hooks/useDecibelTransactionSubmitter.ts", "utf8");
const portfolioPage = readFileSync("components/portfolio/PortfolioPageClient.tsx", "utf8");
const decibelFeesRoute = readFileSync("app/api/decibel/fees/route.ts", "utf8");
const positionsComponent = readFileSync("components/trade/Positions.tsx", "utf8");
const tradePanel = readFileSync("components/trade/TradePanel.tsx", "utf8");
const btcChart = readFileSync("components/trade/BTCChart.tsx", "utf8");
const swapAssetButton = readFileSync("components/trade/swap/SwapAssetButton.tsx", "utf8");
const accountManager = readFileSync("components/trade/DecibelAccountManager.tsx", "utf8");
const mobileModalSheet = readFileSync("components/ui/mobile-modal-sheet.tsx", "utf8");
const responsiveModalSheet = readFileSync("components/ui/responsive-modal-sheet.tsx", "utf8");
const mobilePortfolioSheet = readFileSync("components/trade/MobilePortfolioSheet.tsx", "utf8");
const walletAccountModal = readFileSync("components/wallet/wallet-account-modal.tsx", "utf8");
const decibelPoints = readFileSync("lib/decibel-points.ts", "utf8");
const pointsProfileCard = readFileSync("components/points/points-profile-card.tsx", "utf8");
const userStatsRoute = readFileSync("app/api/decibel/user-stats/route.ts", "utf8");
const pointsLeaderboard = readFileSync("components/points/leaderboard.tsx", "utf8");
const cashRewardsRoute = readFileSync("app/api/cash/rewards/route.ts", "utf8");
const cashRewardsPanel = readFileSync("components/portfolio/CashRewardsPanel.tsx", "utf8");
const cashRewardsLib = readFileSync("lib/cash-rewards.ts", "utf8");
const decibelApi = readFileSync("lib/decibel-api.ts", "utf8");
const cashRewardsCheckpointMigration = readFileSync(
  "prisma/migrations/20260810000000_add_cash_reward_epoch_checkpoints/migration.sql",
  "utf8",
);
const decibelBuilderLib = readFileSync("lib/decibel-builder.ts", "utf8");
const decibelBuilderRoute = readFileSync("app/api/decibel/builder/route.ts", "utf8");
const decibelBuilderConfig = readFileSync("lib/decibel-builder-config.ts", "utf8");
const automatedVaultBuilder = readFileSync("lib/automated-vault-builder.ts", "utf8");
const moveCompileService = readFileSync("lib/move-compile-service.ts", "utf8");
const sealedDeployScript = readFileSync("scripts/sealed-e2e-deploy.ts", "utf8");
const portfolioCleanroomScript = readFileSync("scripts/portfolio-cleanroom-testnet.ts", "utf8");
const portfolioMaxholdScript = readFileSync("scripts/portfolio-maxhold-testnet.ts", "utf8");
const vaultEconomics = readFileSync("lib/vault-economics.ts", "utf8");
const cashRewardsConfig = JSON.parse(readFileSync("config/cash-rewards.json", "utf8")) as {
  formulaVersion: number;
  formulaEffectiveEpoch: number;
  capitalHourRewardCash: number;
  activeDayRewardCash: number;
};
const legacyBacktestRoute = readFileSync("app/api/backtest/route.ts", "utf8");
const launchpadBacktestRoute = readFileSync("app/api/launchpad/backtest/route.ts", "utf8");
const launchpadKeeper = readFileSync("lib/launchpad/keeper.ts", "utf8");
const launchpadCandlesRoute = readFileSync("app/api/launchpad/candles/route.ts", "utf8");
const launchpadPyth = readFileSync("lib/launchpad/pyth.ts", "utf8");
const launchpadPriceTickRoute = readFileSync("app/api/launchpad/price-tick/route.ts", "utf8");
const launchpadOnChainRoute = readFileSync("app/api/launchpad/on-chain/route.ts", "utf8");
const launchpadMoveCodegen = readFileSync("lib/launchpad/move-codegen.ts", "utf8");
const launchpadTradesRoute = readFileSync("app/api/launchpad/trades/route.ts", "utf8");
const launchpadSignalStreamRoute = readFileSync("app/api/launchpad/signals/stream/route.ts", "utf8");
const launchpadSignalStore = readFileSync("lib/launchpad/signals-store.ts", "utf8");
const launchpadPrismaSchema = readFileSync("prisma/schema.prisma", "utf8");
const launchpadSignalMigration = readFileSync(
  "prisma/migrations/20260810150000_add_launchpad_signal_store/migration.sql",
  "utf8",
);
const marketRefreshRoute = readFileSync("app/api/markets/refresh/route.ts", "utf8");
const vercelIgnore = readFileSync(".vercelignore", "utf8");
const launchpadSignalsRoute = readFileSync("app/api/launchpad/signals/route.ts", "utf8");
const launchpadCurveRoute = readFileSync("app/api/launchpad/curve/route.ts", "utf8");
const launchpadIndicatorsRoute = readFileSync("app/api/launchpad/indicators/route.ts", "utf8");
const launchpadCreateRoute = readFileSync("app/api/launchpad/create/route.ts", "utf8");
const launchpadVerifyRoute = readFileSync("app/api/launchpad/verify/route.ts", "utf8");
const launchpadWithdrawRoute = readFileSync("app/api/launchpad/withdraw/route.ts", "utf8");
const launchpadScheduledRoute = readFileSync("app/api/launchpad/scheduled/route.ts", "utf8");
const launchpadGraduateRoute = readFileSync("app/api/launchpad/graduate/route.ts", "utf8");
const launchpadPage = readFileSync("components/launchpad/LaunchpadPage.tsx", "utf8");
const sharedHeader = readFileSync("components/layout/Header.tsx", "utf8");
const automationPage = readFileSync("app/automation/page.tsx", "utf8");
const decibelDepthRoute = readFileSync("app/api/decibel/depth/route.ts", "utf8");
const depthCaptureWorker = readFileSync("scripts/depth-capture-worker.mjs", "utf8");
const depthStorageDoctor = readFileSync("scripts/depth-storage-doctor.mjs", "utf8");
const depthStorage = readFileSync("scripts/lib/depth-storage.mjs", "utf8");
const depthCompactionCron = readFileSync("app/api/cron/depth-compact/route.ts", "utf8");
const depthVercelConfig = JSON.parse(readFileSync("vercel.json", "utf8"));
const sponsorSubmitRoute = readFileSync("app/api/decibel/sponsor-submit/route.ts", "utf8");
// The allowlist moved to a shared module so the client can pre-check whether a
// gasless wallet's payload is even worth signing. The route must import it.
const sponsorAllowlist = readFileSync("lib/decibel-sponsor-allowlist.ts", "utf8");
const evmDerivedAptos = readFileSync("lib/evm-derived-aptos.ts", "utf8");
const txUtils = readFileSync("lib/tx-utils.ts", "utf8");
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
const botOwnerGuard = readFileSync("lib/bot-owner-guard.ts", "utf8");
const cloudStatusRoute = readFileSync("app/api/cloud-status/route.ts", "utf8");
const tvImportRoute = readFileSync("app/api/launchpad/tv-import/route.ts", "utf8");
const decibelPublicRoute = readFileSync("app/api/decibel/public/route.ts", "utf8");
const sdkTestRoute = readFileSync("app/api/sdk-test/route.ts", "utf8");
const botDebugRoute = readFileSync("app/api/bot/debug/route.ts", "utf8");
const dlpBenchmarkRoute = readFileSync("app/api/dlp/benchmark/route.ts", "utf8");
const decibelPositionsRoute = readFileSync("app/api/decibel/positions/route.ts", "utf8");
const decibelVaultPositionsRoute = readFileSync("app/api/decibel/vault-positions/route.ts", "utf8");
const vaultPositionsTable = readFileSync("components/trade/VaultPositionsTable.tsx", "utf8");
const decibelPortfolioChartRoute = readFileSync("app/api/decibel/portfolio-chart/route.ts", "utf8");
const decibelSubaccountRoute = readFileSync("app/api/decibel/subaccount/route.ts", "utf8");
const decibelWalletBalanceRoute = readFileSync("app/api/decibel/wallet-balance/route.ts", "utf8");
const decibelStreamRoute = readFileSync("app/api/decibel/stream/route.ts", "utf8");
const decibelVaultStatusRoute = readFileSync("app/api/decibel/vaults/status/route.ts", "utf8");
const vaultActionModal = readFileSync("components/trade/VaultActionModal.tsx", "utf8");
const cashWalletSelector = readFileSync("components/wallet/cash-wallet-selector.tsx", "utf8");
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
const cctpDiscoverRoute = readFileSync("app/api/decibel/cctp/discover/route.ts", "utf8");
const cctpClaimRoute = readFileSync("app/api/decibel/cctp/claim/route.ts", "utf8");
const decibelOrderRoute = readFileSync("app/api/decibel/order/route.ts", "utf8");
const decibelCancelOrderRoute = readFileSync("app/api/decibel/cancel-order/route.ts", "utf8");
const decibelCreateSubaccountRoute = readFileSync("app/api/decibel/create-subaccount/route.ts", "utf8");
const decibelDepositRoute = readFileSync("app/api/decibel/deposit/route.ts", "utf8");
const decibelWithdrawRoute = readFileSync("app/api/decibel/withdraw/route.ts", "utf8");
const decibelTransferUsdcRoute = readFileSync("app/api/decibel/transfer-usdc/route.ts", "utf8");
const constantsSource = readFileSync("lib/constants.ts", "utf8");
const launchpadOnChainChart = readFileSync("components/launchpad/OnChainChart.tsx", "utf8");
const orderBook = readFileSync("components/trade/OrderBook.tsx", "utf8");
const tradePageClient = readFileSync("components/trade/TradePageClient.tsx", "utf8");
const swapMarketLayout = readFileSync("components/trade/swap/SwapMarketLayout.tsx", "utf8");
const decibelTradeEvents = readFileSync("lib/decibel-trade-events.ts", "utf8");
const decibelTradeFill = readFileSync("lib/decibel-trade-fill.ts", "utf8");
const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  build?: { env?: Record<string, string> };
};
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies: Record<string, string>;
  scripts?: Record<string, string>;
  engines?: { node?: string };
  pnpm?: { overrides?: Record<string, string> };
  packageManager?: string;
};
const nextConfig = readFileSync("next.config.mjs", "utf8");

assert.match(
  packageJson.scripts?.["vercel-build"] ?? "",
  /prisma migrate deploy/,
  "Vercel builds must apply checked-in migrations before starting the app",
);
assert.equal(
  (vercelConfig as { buildCommand?: string }).buildCommand,
  "pnpm vercel-build",
  "Vercel must use the migration-aware production build command",
);

assert.match(decibelVaultList, /const VAULT_PAGE_SIZE = 1_000;/);
assert.match(decibelVaultList, /status: "active"/);
assert.match(decibelVaultList, /remainingOffsets\.map\(fetchPage\)/);
assert.match(vaultRoute, /s-maxage=30, stale-while-revalidate=300/);
assert.match(decibelVaultList, /unstable_cache/);
assert.match(decibelVaultList, /\{ revalidate: 30 \}/);
assert.match(decibelVaultList, /cache: "no-store"/);
assert.match(vaultRoute, /status: 502, headers: VAULT_UNAVAILABLE_HEADERS/);
assert.match(decibelVaultList, /function validatePage/);
assert.match(decibelVaultList, /uniqueVaults\.size !== firstPage\.total_count/);
assert.match(decibelVaultList, /let inFlight: Promise<DecibelVaultSnapshot> \| null/);
assert.match(vaultRoute, /getActiveDecibelVaults/);
assert.ok(!vaultRoute.includes("/vaults?limit=50"), "vault discovery must not stop at 50");

assert.equal(formatVaultUsd(312_980.887387), "$312.98K");
assert.equal(formatVaultUsd(3_603_310_466), "$3.6B");
assert.equal(formatVaultUsd(-12_450), "-$12.45K");
assert.equal(
  hasMeaningfulVaultActivity({
    tvl: 23_714_356,
    volume: 3_603_310_466,
    all_time_pnl: 312_980,
  }),
  true,
);
for (const emptyVault of [
  { tvl: 0, volume: 1, all_time_pnl: 1 },
  { tvl: 1, volume: 0, all_time_pnl: 1 },
  { tvl: 1, volume: 1, all_time_pnl: 0 },
] as const) {
  assert.equal(hasMeaningfulVaultActivity(emptyVault), false);
}

assert.ok(!tradePage.includes("GUILD_OVERRIDES"), "real vault identities must not be replaced with demo guilds");
assert.ok(!tradePage.includes("buildPnlCurve"), "vault charts must not fabricate PnL history");
assert.ok(
  tradePage.includes('className="no-scrollbar flex items-start snap-x snap-mandatory overflow-x-auto overscroll-x-contain"'),
  "vault carousels must remain swipeable without exposing horizontal scrollbars",
);
assert.ok(
  tradePage.includes("{ind.name} indicator") && tradePage.includes("Vault Manager"),
  "the demo strategy vault must identify its indicator as the vault manager",
);
assert.ok(
  !tradePage.includes("<DecibelMark") && !tradePage.includes("<CashMark"),
  "real Decibel vault cards must not display fabricated manager profile pictures",
);
assert.ok(
  vaultActionModal.includes("Available")
    && vaultActionModal.includes("MAX")
    && vaultActionModal.includes('rounded-[14px]'),
  "vault deposits must expose a real available balance and the same MAX input geometry as trading",
);
assert.ok(
  tradePanel.includes("availableUsdc") && tradePanel.includes("MAX"),
  "the trade collateral input must show withdrawable USDC and support MAX",
);
assert.ok(
  !btcChart.includes(">Mark Price<")
    && btcChart.includes("grid-cols-5")
    && !btcChart.includes("Right fade to hint horizontal scroll"),
  "the market stats row must use equal columns from Oracle through Funding without horizontal scrolling",
);
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
const rainbowDecibelIdentity = resolveDecibelWalletIdentity({
  adapterAddress: "0x2222222222222222222222222222222222222222222222222222222222222222",
  chainOrigin: "ethereum",
  publicKey: {
    ethereumAddress: "0x1111111111111111111111111111111111111111",
  },
});
assert.equal(
  rainbowDecibelIdentity.ownerAddress,
  "0xaaa3e90d34d422699e3f62e64786a60b37af05ee57f1bbe15fe82cb2ee6a8238",
  "Rainbow must resolve to the same app.decibel.trade owner that owns its Primary account",
);
assert.equal(getEvmSourceChainFromChainId("0x2105"), "Base");
assert.equal(getEvmSourceChainFromChainId(8453), "Base");
assert.equal(getEvmSourceChainFromChainId("0xa4b1"), "Arbitrum");
assert.equal(getEvmSourceChainFromChainId("0x1"), "Ethereum");
assert.equal(getEvmSourceChainFromChainId("0x999999"), null);
assert.match(walletAccountModal, /formatWalletConnectionName\(wallet\.name, activeEvmSourceChain\)/);
assert.match(accountManager, /if \(activeEvmSourceChain\) selectBridgeSourceChain\(activeEvmSourceChain\)/);
assert.equal(
  rainbowDecibelIdentity.originAddress,
  "0x1111111111111111111111111111111111111111",
);
assert.equal(
  resolveDecibelWalletIdentity({
    adapterAddress: "0xabc",
    chainOrigin: "aptos",
    publicKey: {},
  }).ownerAddress,
  "0xabc",
  "native Aptos wallet identity must remain unchanged",
);
assert.match(decibelSubaccountHook, /const owner = identity\.ownerAddress/);
assert.match(decibelTransactionSubmitter, /DECIBEL_APP_DERIVED_DOMAIN/);
assert.match(decibelTransactionSubmitter, /needsSponsoredGas\(identity\.ownerAddress\)/);
assert.ok(
  !decibelSubaccountHook.includes('name: "Primary"'),
  "an unverified stored address must not be presented as an active Primary account",
);
assert.match(pointsData, /requestIdRef\.current !== requestId/);
assert.match(pointsData, /requestIdRef\.current \+= 1/);
assert.ok(!portfolioPage.includes("buildPortfolioSeries"), "portfolio history must not be synthesized from one snapshot");
for (const fabricatedMetric of ["2.0139", "67.28%", "41.67%"] as const) {
  assert.ok(!portfolioPage.includes(fabricatedMetric), "portfolio risk metrics must not be hard-coded");
}
assert.match(portfolioPage, /cash\.trading does not fabricate missing history/);
assert.match(portfolioPage, /\/api\/decibel\/portfolio-chart/);
assert.match(portfolioPage, /PORTFOLIO_CHART_RANGES/);
for (const range of ['"24h"', '"7d"', '"30d"', '"90d"', '"all"'] as const) {
  assert.ok(portfolioPage.includes(range), `portfolio chart must expose ${range}`);
}
assert.match(decibelPortfolioChartRoute, /portfolioChart\.getByAddr/);
assert.match(decibelPortfolioChartRoute, /source: "decibel"/);
assert.ok(
  !decibelPortfolioChartRoute.includes("Math.random"),
  "portfolio history must come from Decibel rather than generated points",
);
assert.match(portfolioPage, /Total fees paid/i);
assert.match(portfolioPage, /\/api\/decibel\/fees/);
assert.match(decibelFeesRoute, /MAX_TRADE_HISTORY/);
assert.match(decibelFeesRoute, /strict: true/);
const feeTrade = (overrides: Partial<DecibelTrade> = {}): DecibelTrade => ({
  account: "0x1",
  market: "BTC/USD",
  action: "fill",
  trade_id: 1,
  size: 1,
  price: 100,
  is_profit: false,
  realized_pnl_amount: 0,
  is_funding_positive: false,
  realized_funding_amount: 0,
  is_rebate: false,
  fee_amount: 0.25,
  order_id: "1",
  client_order_id: "1",
  transaction_unix_ms: 1,
  transaction_version: 1,
  ...overrides,
});
assert.deepEqual(
  summarizeDecibelFees([
    feeTrade(),
    feeTrade(),
    feeTrade({ trade_id: 2, transaction_version: 2, fee_amount: 0.1, is_rebate: true }),
  ]),
  { fills: 2, totalFeesPaidUsd: 0.25, rebatesUsd: 0.1, netFeesUsd: 0.15 },
  "all-time fees must deduplicate fills and report paid fees separately from rebates",
);
assert.match(vaultActionModal, /<ResponsiveModalSheet/);
assert.match(tradePage, /hasHolding \? "Manage" : "Deposit"/);
assert.ok(
  !btcChart.includes('placeholder="Search markets"'),
  "the mobile market sheet must not summon a keyboard with a search field",
);
assert.match(cashWalletSelector, /<ResponsiveModalSheet/);
assert.match(cashWalletSelector, /Show more wallets/);
assert.match(cashWalletSelector, /EVM_SOURCE_CHAINS/);
assert.ok(!cashWalletSelector.toLowerCase().includes('"nightly"'), "Nightly must not be offered by cash.trading");
assert.ok(
  cashWalletSelector.includes("isRainbowWallet(b.name)")
    && cashWalletSelector.includes("getPreferredWalletIcon(wallet.name, wallet.icon)"),
  "Rainbow must be the first EVM option and use the supplied Rainbow brand asset",
);
assert.match(portfolioPage, /withdrawingRef\.current/);
assert.match(portfolioPage, /withdrawalTokenRef/);
assert.match(portfolioPage, /closingActionTokensRef/);
assert.match(portfolioPage, /cancelingActionTokensRef/);
assert.match(portfolioPage, /actionContextRef\.current !== requestContext/);
assert.match(portfolioPage, /isValidAptosAddress\(recipient\)/);
assert.ok(!portfolioPage.includes("overview?.equity ?? 0"), "an unavailable portfolio must not render as zero equity");
assert.ok(!portfolioPage.includes("position.estimatedPnl ?? 0"), "an unavailable position mark must not render as zero PnL");
assert.match(sharedHeader, /balanceRequestIdRef/);
assert.match(sharedHeader, /balanceContextRef\.current === requestContext/);
// One name for entering the app. The header used to say "Sign In" while every
// page said "Connect wallet" and Portfolio said "Deposit USDC" — three names
// for one act. "Connect wallet" is the one that survived.
assert.equal((sharedHeader.match(/>\s*Connect wallet\s*</g) ?? []).length, 1, "the header must expose one connect action");
assert.ok(!sharedHeader.includes("Sign In"), "the header must not reintroduce a second name for connecting");
assert.ok(!btcChart.includes("autoFocus"), "opening the mobile market sheet must not summon the keyboard");
assert.ok(!btcChart.includes('type="search"'), "the asset selector must not render a search control");
assert.match(btcChart, /ResponsiveModalSheet/);
assert.match(btcChart, /onSelect\(market\.id\);\s+requestClose\(\);/);
assert.match(btcChart, /focus-visible:ring-2 focus-visible:ring-ring/);
assert.match(swapAssetButton, /PRESSABLE_CONTROL/);
assert.match(swapAssetButton, /transition-\[transform,opacity\]/);
assert.match(swapAssetButton, /focus-visible:ring-2 focus-visible:ring-ring/);
assert.ok(!swapAssetButton.includes("transition-all"));
assert.ok(
  !btcChart.includes('{displayConnected ? "Live" : "..."}')
    && !btcChart.includes('displayConnected ? "bg-success" : "bg-muted"'),
  "the asset selector header must not repeat live or network status",
);
assert.match(btcChart, /cash:selected-trade-market:v1/);
assert.match(btcChart, /persistedMarketRef/);
assert.match(btcChart, /window\.localStorage\.setItem\(selectedMarketStorageKey\(network\), id\)/);
assert.match(walletAccountModal, /ResponsiveModalSheet/);
assert.match(responsiveModalSheet, /<MobileModalSheet/);
assert.match(responsiveModalSheet, /mobileSheetRef\.current/);
assert.match(responsiveModalSheet, /sheet\.close\(\)/);
assert.match(responsiveModalSheet, /<DialogContent/);
assert.match(responsiveModalSheet, /sm:!max-w-\[900px\]/);
assert.match(
  responsiveModalSheet,
  /border-b border-card-border bg-card/,
  "the desktop sheet header must paint with the shared surface tokens so the light theme reaches it",
);
assert.doesNotMatch(responsiveModalSheet, /#171717|#101010/, "the shared modal shell must not hard-code its own blacks");
assert.match(orderBook, /gridTemplateRows: `repeat\(\$\{rows\.length\}, minmax\(24px, 1fr\)\)`/);
assert.match(orderBook, /\[--trade-row-min:44px\] sm:\[--trade-row-min:28px\]/);
assert.match(orderBook, /gridTemplateRows: `repeat\(\$\{trades\.length\}, minmax\(var\(--trade-row-min\), 1fr\)\)`/);
assert.match(orderBook, /RECENT_TRADES_TIMEOUT_MS = 8_000/);
assert.match(orderBook, /recentTradesCache/);
assert.match(orderBook, /recentTradesRequests/);
assert.match(orderBook, /formatUsdNotional\(trade\.price, trade\.size\)/);
assert.match(orderBook, /onDecibelTradeConfirmed/);
assert.match(tradePageClient, /rowCount=\{21\}[\s\S]*className="h-full min-h-0"/);
assert.match(tradePageClient, /rowCount=\{11\}[\s\S]*className="h-\[452px\] sm:h-\[572px\]"/);
assert.match(swapMarketLayout, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
// 17 rows fill the swap card's ~504px without an at-rest scroll; 21 needed ~572px.
assert.match(swapMarketLayout, /rowCount=\{desktopMarketLayout \? 17 : 11\}/);
// On desktop the book is taken out of flow inside a stretched grid item so it
// matches the swap card's height exactly without ever adding to it; below lg it
// keeps the Trade page's mobile heights.
assert.match(swapMarketLayout, /className="h-\[452px\] sm:h-\[572px\] lg:absolute lg:inset-0 lg:h-auto"/);
assert.match(swapMarketLayout, /lg:items-stretch/);
assert.match(
  swapMarketLayout,
  /<div className="relative min-w-0 lg:order-1">\s*<OrderBook/,
  "the absolutely positioned book needs a relative wrapper or it escapes the grid item",
);
assert.ok(
  !swapMarketLayout.includes("lg:h-[672px]") && !swapMarketLayout.includes("overflow-y-auto"),
  "the swap column must size to its content — no fixed desktop height and no nested scroll",
);
assert.equal(
  (swapMarketLayout.match(/<OrderBook/g) ?? []).length,
  1,
  "the responsive swap layout must mount one shared orderbook instance",
);
assert.match(swapMarketLayout, /import \{ OrderBook \} from "@\/components\/trade\/OrderBook"/);
assert.match(tradePanel, /emitDecibelTradeConfirmed/);
assert.match(tradePanel, /extractConfirmedDecibelFill/);
assert.match(decibelTradeEvents, /cash:decibel-trade-confirmed/);
assert.match(decibelTradeFill, /OrderEvent/);
assert.match(decibelTradeFill, /FILLED/);
assert.deepEqual(
  extractConfirmedDecibelFill({
    transaction: {
      events: [{
        type: "0x1::market_types::OrderEvent",
        data: {
          is_taker: true,
          market: "0x731b",
          orig_size: "40000",
          parent: "0x1234",
          price: "85229000",
          remaining_size: "0",
          status: { __variant__: "FILLED" },
        },
      }],
    },
    subaccount: "0x1234",
    marketAddress: "0x731b",
    requestedSize: 0.04,
    requestedSizeRaw: 40_000,
    requestedPrice: 85.229,
    requestedPriceRaw: 85_229_000,
  }),
  { price: 85.229, size: 0.04 },
);
const multiFill = extractConfirmedDecibelFill({
    transaction: {
      events: [
        {
          type: "0x1::perp_positions::TradeEvent",
          data: {
            account: "0x1234",
            is_taker: true,
            market: { inner: "0x731b" },
            price: "85200000",
            size: "15000",
          },
        },
        {
          type: "0x1::perp_positions::TradeEvent",
          data: {
            account: "0x1234",
            is_taker: true,
            market: { inner: "0x731b" },
            price: "85300000",
            size: "25000",
          },
        },
        {
          type: "0x1::market_types::OrderEvent",
          data: {
            is_taker: true,
            market: "0x731b",
            orig_size: "40000",
            parent: "0x1234",
            price: "85300000",
            remaining_size: "0",
            status: { __variant__: "FILLED" },
          },
        },
      ],
    },
    subaccount: "0x1234",
    marketAddress: "0x731b",
    requestedSize: 0.04,
    requestedSizeRaw: 40_000,
    requestedPrice: 85.3,
    requestedPriceRaw: 85_300_000,
  });
assert.ok(multiFill);
assert.equal(multiFill.size, 0.04);
assert.ok(Math.abs(multiFill.price - 85.2625) < 1e-9);
assert.ok(!orderBook.includes("flex-col justify-center"), "book rows must fill the pane instead of floating in the middle");
assert.match(mobileModalSheet, /animateMobileSheetSpring/);
assert.match(mobileModalSheet, /useImperativeHandle\(ref, \(\) => \(\{ close: closeSheet \}\)/);
assert.ok(!mobileModalSheet.includes("backdropFilter"));
assert.ok(!mobileModalSheet.includes("WebkitBackdropFilter"));
assert.match(mobilePortfolioSheet, /animateMobileSheetSpring/);
assert.match(mobileModalSheet, /overflow-y-auto overscroll-contain/);
assert.match(mobileModalSheet, /WebkitOverflowScrolling: "touch"/);
assert.match(mobileModalSheet, /addEventListener\("touchcancel"/);
assert.match(mobileModalSheet, /addEventListener\("mousedown"/);
assert.match(mobileModalSheet, /window\.addEventListener\("mousemove"/);
assert.match(mobileModalSheet, /data-mobile-sheet-drag-surface="true"/);
assert.match(mobileModalSheet, /data-mobile-sheet-drag-handle="true"/);
assert.match(mobileModalSheet, /data-mobile-sheet-scroll-area="true"/);
assert.match(mobileModalSheet, /startedInScrollArea/);
assert.match(mobileModalSheet, /touchAction: "pan-y"/);
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
assert.match(positionsComponent, /useDecibelWalletIdentity/);
assert.match(positionsComponent, /signAndSubmitDecibelTransaction/);
assert.match(tradePanel, /submissionTokenRef/);
assert.match(tradePanel, /tradeContextRef/);
assert.match(tradePanel, /signAndSubmitDecibelTransaction/);
assert.match(portfolioPage, /signAndSubmitDecibelTransaction/);
assert.match(accountManager, /activeActionTokenRef/);
assert.match(accountManager, /accountActionContextRef/);
assert.match(accountManager, /autoDiscoverKeyRef/);
assert.ok(!accountManager.includes("setAutoDiscoverKey"), "bridge discovery must not cancel itself via state");
assert.match(accountManager, /disabled=\{status === "submitting"\}/);
assert.match(accountManager, /hydratedBridgeStorageKey !== bridgeStorageKey/);
assert.match(accountManager, /accountActionContextRef\.current !== lookupContext/);
assert.match(tradePage, /const activityVaults = vaults\.filter\(hasMeaningfulVaultActivity\)/);
assert.match(tradePage, /chartKind\[vault\.address\] === "real"/);
assert.match(tradePage, /\(chartData\[vault\.address\]\?\.length \?\? 0\) >= 2/);
assert.ok(!tradePage.includes('if (n == null) return "$0"'), "missing vault metrics must not render as real zero dollars");
assert.ok(!tradePage.includes("vault.depositors ?? 0"), "missing vault depositor counts must remain unavailable");
assert.ok(!tradePage.includes("vault.sharpe_ratio ?? 0"), "missing vault risk metrics must remain unavailable");
assert.match(tradePage, /<dl className="mt-3 grid grid-cols-2 border-y/);
assert.match(tradePage, /All-time volume/);
assert.match(tradePage, /Depositors/);
assert.ok(
  !tradePage.includes('bg-[#0e1a0e]') && !tradePage.includes('border-[#1a2e1a]'),
  "vault metadata must stay a quiet ledger strip instead of a tinted card inside the vault card",
);
assert.ok(
  tradePage.includes('tradesVaultAddress === vault.address ? "Overview" : "Trades"'),
  "every eligible vault card must switch between its overview and live positions",
);
assert.match(tradePage, /vault-history\?vault=\$\{v\.address\}&range=all&type=pnl/);
assert.match(tradePage, /hasHolding \? "Manage" : "Deposit"/);
assert.match(tradePage, /hasHolding \? "withdraw" : "deposit"/);
assert.match(decibelVaultPositionsRoute, /get_vault_portfolio_subaccounts/);
assert.match(decibelVaultPositionsRoute, /getIndexedPositions/);
assert.match(decibelVaultPositionsRoute, /marketPrices\.getAll/);
assert.match(decibelVaultPositionsRoute, /limit: 1_000/);
assert.ok(
  !decibelVaultPositionsRoute.includes("s-maxage")
    && decibelVaultPositionsRoute.includes("headers: NO_STORE_HEADERS"),
  "live vault PnL must never be held behind a CDN cache",
);
assert.match(vaultPositionsTable, /<table/);
assert.match(vaultPositionsTable, /Open positions/);
assert.match(vaultPositionsTable, /canScrollDown/);
assert.match(vaultPositionsTable, /LIVE_REFRESH_MS = 2_500/);
assert.ok(
  !vaultPositionsTable.includes("overflow-x-auto"),
  "the compact vault positions table must never need a horizontal scrollbar",
);
assert.ok(
  !vaultPositionsTable.includes("rounded-lg border")
    && !vaultPositionsTable.includes("h-[510px]"),
  "the vault trades view must sit directly in the card without a nested framed box",
);
assert.match(positionsComponent, /Vault Positions \(\{vaultHoldings\.length\}\)/);
assert.match(positionsComponent, /\/api\/vault\/user\?account=/);

assert.match(cronRoute, /if \(!cronSecret\)/);
assert.match(keeperRoute, /if \(!cronSecret\)/);
assert.match(keeperRoute, /LAUNCHPAD_KEEPER_API_SECRET/);
assert.match(launchpadExecuteRoute, /function authorizeKeeperExecution/);
assert.match(launchpadCrankRoute, /Server crank is not configured/);
assert.match(
  sealedLaunch,
  /<StrategySourceEditor/,
  "the sealed launch flow must use the shared Pine and Move source workbench",
);
assert.ok(
  strategySourceEditor.includes('type SourceTab = "pine" | "move"')
    && strategySourceEditor.includes('target: "vault"')
    && strategySourceEditor.includes('lineNumbers: "on"')
    && strategySourceEditor.includes('wordWrap: "off"')
    && strategySourceEditor.includes("scrollBeyondLastLine: false")
    && strategySourceEditor.includes("alwaysConsumeMouseWheel: false"),
  "the strategy IDE must retain Pine/Move tabs, exact vault codegen, line numbers, and page-scroll handoff",
);
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
assert.match(pointsData, /!response\.ok \|\| !json \|\| json\.unavailable/);
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
assert.match(predepositPointsRoute, /realized_pnl: points\.realizedPnl/);
assert.match(predepositUserRoute, /getDecibelOwnerPoints/);
// Points page: one server-side profile route (s-maxage) replaces client polling,
// localStorage caching and mock data; the owner comes from the verified wallet
// identity, never the raw adapter address.
assert.ok(!pointsData.includes("localStorage"), "points data must not cache in localStorage; route-level s-maxage replaces it");
assert.ok(!pointsData.includes("setInterval"), "points data must not poll on a timer");
assert.ok(!pointsData.includes("MOCK"), "points data must not ship a mock branch");
assert.match(pointsData, /api\/points\/profile\?owner=/);
assert.match(pointsData, /search_term/);
assert.match(pointsPageClient, /useDecibelWalletIdentity/);
assert.match(pointsPageClient, /Season 1/);
assert.ok(!pointsProfileCard.includes("|| 0"), "unavailable profile pieces must render as unavailable, not as a real zero");
assert.match(pointsProfileCard, /Connect to see/);
assert.match(pointsProfileCard, /Trading/);
assert.match(pointsProfileCard, /Referral/);
// "PnL" everywhere. The app used to call one concept three names — a "PNL"
// stat tile, a "Profit/loss" heading and a "REALIZED PNL" column.
assert.match(pointsProfileCard, /PnL/);
assert.match(pointsLeaderboard, /PnL/);
assert.ok(
  !pointsProfileCard.includes("PNL") && !pointsLeaderboard.includes("PNL"),
  "PnL must not be shouted in a second casing",
);
assert.match(pointsLeaderboard, /Show more/);
assert.match(pointsProfileRoute, /Promise\.allSettled/);
assert.match(pointsProfileRoute, /s-maxage=120/);
assert.match(pointsProfileRoute, /checkApiRateLimit/);
assert.match(pointsProfileRoute, /isValidAptosAddress/);
assert.match(pointsProfileRoute, /unavailable: true/);
assert.doesNotMatch(
  pointsData,
  /predeposit\/user\?account=/,
  "the Points dashboard must not couple valid AMPs to the retired predeposit balance lookup",
);
assert.match(userStatsRoute, /checkApiRateLimit\(request, "decibel-user-stats"/);
assert.match(userStatsRoute, /getDecibelOwnerPoints/);
assert.match(userStatsRoute, /getFastSubaccounts/);
assert.match(userStatsRoute, /getFastOverview/);
assert.match(userStatsRoute, /getAccountVaultPerformance/);
assert.match(vaultTotalRoute, /getActiveDecibelVaults/);
assert.match(vaultTotalRoute, /vault\.status === 'active'/);
assert.match(vaultTotalRoute, /protocolTvl/);
// Warm every 5 minutes, not every minute. Cold vault reads take ~10s, so the
// warm must stay frequent enough to keep the feed hot — but the route's own
// stale-while-revalidate window is 300s, so a per-minute cron re-warmed a
// cache that was still fresh, and 43,200 expensive multi-call reads a month
// exhausted the RPC provider's monthly credit, taking every data surface in
// the app offline. */5 covers the same staleness window at a fifth the cost.
assert.ok(
  depthVercelConfig.crons.some(
    (cron: { path?: string; schedule?: string }) =>
      cron.path === "/api/decibel/vaults" && cron.schedule === "*/5 * * * *",
  ),
  "production must warm the shared vault cache within its stale-while-revalidate window",
);
assert.match(vaultUserRoute, /'mainnet', true/);
assert.match(decibelPoints, /typeof value !== 'number'/);
assert.match(decibelApi, /DECIBEL_READ_TIMEOUT_MS = 12_000/);
assert.match(decibelApi, /signal: AbortSignal\.timeout\(DECIBEL_READ_TIMEOUT_MS\)/);
assert.match(decibelApi, /cache: ['"]no-store['"]/);
assert.doesNotMatch(cashRewardsRoute, /DATABASE_URL/);
assert.match(cashRewardsRoute, /checkApiRateLimit\(request, "cash-rewards-read"/);
assert.match(cashRewardsRoute, /verifyDecibelSubaccountOwnership/);
assert.match(cashRewardsRoute, /getCashRewardSnapshot/);
assert.match(cashRewardsRoute, /Direct server payouts are disabled/);
assert.match(cashRewardsPanel, /STREAM_PREVIEW_SECONDS = 15/);
assert.match(cashRewardsPanel, /Server-verified · resets in/);
assert.match(cashRewardsPanel, /Preview only — no CASH has been issued/);
assert.match(cashRewardsPanel, /do not carry into a new reward week/);
assert.match(cashRewardsPanel, /Optional \$\{builderStatus\.feeBps\} bp/);
assert.match(cashRewardsPanel, /Approve \$\{builderStatus\?\.feeBps \?\? 10\} bp Builder fee/);
assert.doesNotMatch(cashRewardsPanel, /snapshot\?\.contract\.status !== "live"/);
assert.match(decibelBuilderLib, /enrollmentOpen: enabled/);
assert.match(cashRewardsPanel, /Revoke Builder fee/);
assert.match(decibelBuilderRoute, /checkApiRateLimit\(request, 'decibel-builder-read'/);
assert.match(decibelBuilderRoute, /buildDecibelBuilderApprovalPayload/);
assert.match(decibelBuilderLib, /get_approved_max_fee/);
assert.match(decibelBuilderLib, /BUILDER_APPROVAL_READ_TIMEOUT_MS = 2_000/);
assert.doesNotMatch(decibelBuilderLib, /rewardConfig\.status === 'live'/);
assert.doesNotMatch(decibelBuilderLib, /CASH rewards enrollment is not live yet/);
assert.match(decibelOrderRoute, /builderStatus\.approval\.readable/);
assert.match(decibelOrderRoute, /builderStatus\.enrollmentOpen/);
assert.match(decibelOrderRoute, /estimatedBuilderFee/);
assert.match(decibelOrderRoute, /builderApplied \? builderStatus\.builderAddress : null/);
assert.match(cashRewardsLib, /currentCapitalBasisUsd/);
assert.match(cashRewardsLib, /cashRewardEpochCheckpoint/);
assert.match(cashRewardsLib, /cursorTimestampMs/);
assert.match(cashRewardsLib, /sourceTruncated/);
assert.match(cashRewardsLib, /startTimestamp/);
assert.doesNotMatch(
  cashRewardsLib,
  /safeView/,
  "Aptos RPC failures must not be converted into fake zero reward balances",
);
assert.ok(
  !cashRewardsLib.includes("getDecibelAccountOverview"),
  "the reward stream must not use the stale indexed account-overview margin",
);
assert.equal(cashRewardsConfig.formulaVersion, 2);
assert.equal(cashRewardsConfig.formulaEffectiveEpoch, 2950);
assert.equal(cashRewardsConfig.capitalHourRewardCash, 2);
assert.equal(cashRewardsConfig.activeDayRewardCash, 1_000);
// Every surface that links a transaction out to the explorer must build the URL
// through explorerTxUrl() so it follows the configured Decibel network, instead
// of pinning ?network=testnet. (This used to be asserted on the dashboard/bot
// history tables, which have been deleted; these are the surfaces that render
// explorer links today.)
for (const [name, source] of [
  ["trade panel", tradePanel],
  ["positions", positionsComponent],
  ["account manager", accountManager],
  ["portfolio page", portfolioPage],
  ["cash rewards panel", cashRewardsPanel],
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
assert.match(launchpadBacktestRoute, /indicatorType is required and must be an integer/);
assert.match(launchpadBacktestRoute, /pine_backtester_required/);
assert.ok(!launchpadBacktestRoute.includes("body.indicatorType ?? 0"));
// /launchpad is now the Vaults page: it renders the sealed-vault feed and the
// launch flow only. The indicatorType contract is guarded on BacktestViewer
// above; the page itself must not resurrect the mock-scored indicator list.
assert.ok(
  launchpadPage.includes("<SealedVaultFeed") && launchpadPage.includes("<SealedLaunch"),
  "the Vaults page must render the sealed-vault feed and the launch flow",
);
assert.ok(
  !launchpadPage.includes("BacktestViewer") && !launchpadPage.includes("indicatorType"),
  "the Vaults page must not render the legacy indicator marketplace",
);
assert.match(launchpadKeeper, /throw new RangeError\("Unsupported legacy backtest indicator type"\)/);
assert.ok(!launchpadKeeper.includes("indicatorType = 0"));
assert.throws(
  () => runLegacyLaunchpadBacktest({
    candles: [],
    params: [10, 30],
    initialCapital: 10_000,
    positionSizePct: 100,
    indicatorType: 5,
  }),
  /Unsupported legacy backtest indicator type/,
);
assert.throws(
  () => runLegacyRandomizedBacktests([], [10, 30], 1, 1n, 5),
  /Unsupported legacy backtest indicator type/,
);
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
assert.match(launchpadOnChainRoute, /function parsePriceLikeLine/);
assert.match(launchpadOnChainRoute, /statsResult\.length !== 2 && statsResult\.length !== 3/);
assert.match(launchpadOnChainRoute, /status: 502/);
assert.ok(!launchpadOnChainRoute.includes("error: String(err)"));
assert.match(launchpadMoveCodegen, /f\.source === "ta_computed"/);
assert.match(launchpadMoveCodegen, /!f\.name\.startsWith\("prev_"\)/);
assert.match(launchpadTradesRoute, /checkApiRateLimit\(req, "launchpad-trades"/);
assert.match(launchpadTradesRoute, /isValidAptosAddress\(addr\)/);
assert.match(launchpadTradesRoute, /normalizeAptosAddress\(pkgParam, "pkg"\)/);
assert.match(launchpadTradesRoute, /parseOnChainTradeVectors/);
assert.match(launchpadTradesRoute, /sanitizeOnChainTrades/);
assert.match(launchpadTradesRoute, /completedTrades/);
assert.match(launchpadTradesRoute, /status: 502/);
assert.match(launchpadTradesRoute, /trade_history_not_supported/);
assert.match(launchpadOnChainChart, /candleAbortRef/);
assert.match(launchpadOnChainChart, /packageAddress\?: string/);
assert.match(launchpadOnChainChart, /pkg=\$\{encodeURIComponent\(packageAddress\)\}/);
assert.match(launchpadOnChainChart, /high < Math\.max\(open, close\)/);
assert.match(launchpadOnChainChart, /manualKeeperEnabled = process\.env\.NODE_ENV !== "production"/);
assert.ok(
  !launchpadPage.includes("OnChainChart") && !launchpadPage.includes("ind.pkg"),
  "the Vaults page must not render the legacy indicator detail pane",
);
assert.ok(!launchpadPage.includes("d.lastPrice > 1000"), "launchpad prices are already normalized by the API");
assert.match(sharedHeader, /\{ href: "\/", label: "Trade" \}/);
assert.match(tradePanel, /aria-label="Order collateral amount"/);
assert.match(tradePanel, /role="slider"/);
assert.match(tradePanel, /handleLeverageKeyDown/);
assert.match(tradePanel, /role=\{tradeStatus === "error" \? "alert" : "status"\}/);
assert.match(positionsComponent, /Close \$\{p\.market\} \$\{p\.isLong \? "long" : "short"\} position/);
assert.match(positionsComponent, /Cancel \$\{o\.market\} \$\{o\.isBuy \? "buy" : "sell"\} order/);
assert.match(positionsComponent, /role=\{actionStatus\.tone === "error" \? "alert" : "status"\}/);
assert.match(responsiveModalSheet, /<DialogContent/);
assert.match(responsiveModalSheet, /<DialogTitle/);
assert.match(mobileModalSheet, /aria-modal="true"/);
assert.match(mobileModalSheet, /role="dialog"/);
assert.ok(!btcChart.includes('aria-label="Search markets"'));

const sanitizedTradeHistory = sanitizeOnChainTrades([
  { tradeId: 0, signal: 1, price: 0.00011, gainBps: 0, lossBps: 0, timestamp: 1, type: "BUY", pnlBps: 0 },
  { tradeId: 1, signal: 2, price: 62_200, gainBps: 5_654_545_444_545, lossBps: 0, timestamp: 2, type: "SELL", pnlBps: 5_654_545_444_545 },
  { tradeId: 2, signal: 1, price: 70_083.5, gainBps: 0, lossBps: 0, timestamp: 3, type: "BUY", pnlBps: 0 },
  { tradeId: 3, signal: 2, price: 70_083.5, gainBps: 0, lossBps: 0, timestamp: 4, type: "SELL", pnlBps: 0 },
]);
assert.deepEqual(sanitizedTradeHistory.map((trade) => trade.tradeId), [2, 3]);
// The explainer page was retired (off-brand shell, stale claims). It must not
// come back, and the old URL must keep resolving somewhere real.
assert.ok(!existsSync("app/explainer"), "the explainer page was retired and must not return as an off-brand route");
assert.match(
  nextConfig,
  /source: '\/explainer',[\s\S]*?destination: '\/',[\s\S]*?permanent: true/,
  "old /explainer links must 308 to / rather than 404",
);
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
assert.ok(!launchpadSignalsRoute.includes("signalBuffer"), "signal ingestion must not rely on instance memory");
assert.ok(!launchpadSignalsRoute.includes("sseSubscribers"), "signal delivery must work across Vercel instances");
assert.match(launchpadSignalsRoute, /appendLaunchpadSignal/);
assert.match(launchpadSignalsRoute, /getRecentLaunchpadSignals/);
assert.match(launchpadSignalStreamRoute, /requested\.length > 32/);
assert.match(launchpadSignalStreamRoute, /isProprietarySignalIndicator/);
assert.match(launchpadSignalStreamRoute, /checkApiRateLimit\(req, "launchpad-signal-stream"/);
assert.match(launchpadSignalStreamRoute, /getLaunchpadSignalsAfter/);
assert.ok(!launchpadSignalStreamRoute.includes("signalBuffer"), "SSE must poll the shared signal ledger");
assert.ok(!launchpadSignalStreamRoute.includes("sseSubscribers"), "SSE must not subscribe to one process");
assert.match(launchpadSignalStore, /MAX_RETAINED_SIGNALS_PER_INDICATOR = 1_000/);
assert.match(launchpadSignalStore, /launchpadSignal\.deleteMany/);
assert.match(launchpadSignalStore, /ROW_NUMBER\(\) OVER \(PARTITION BY "indicatorAddr"/);
assert.match(launchpadPrismaSchema, /model LaunchpadSignal/);
assert.match(launchpadSignalMigration, /CREATE TABLE "LaunchpadSignal"/);
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
assert.match(launchpadWithdrawRoute, /creator_payout_not_enabled/);
assert.match(launchpadScheduledRoute, /launchpad_automation_not_enabled/);
assert.match(launchpadGraduateRoute, /launchpad_graduation_not_deployed/);
assert.ok(!launchpadGraduateRoute.includes("VAULT_ADDR_PLACEHOLDER"), "graduation must not return fake transactions");
assert.ok(!launchpadPage.includes("Fund Strategy"), "the undeployed bonding curve must not ask users for APT");
assert.ok(!launchpadPage.includes("Unlock · $29/mo"), "local browser state must not impersonate a paid subscription");
assert.ok(!launchpadPage.includes("ScheduleTradeModal"), "disabled automation must not expose a fake deploy flow");
// The automation surface is no longer hidden by environment; it is gated on an
// owner allowlist being configured, and the API enforces that allowlist per
// request. What must stay true is that an UNCONFIGURED deployment still shows
// nothing and routes away.
assert.match(automationPage, /botOwnerAllowlistConfigured\(\)/);
assert.match(automationPage, /redirect\("\/portfolio"\)/);
assert.ok(
  sharedHeader.includes("NEXT_PUBLIC_BOT_AUTOMATION_UI"),
  "the automation nav link must be behind an explicit flag, not shown unconditionally",
);
assert.ok(
  !sharedHeader.includes("process.env.BOT_OWNER_ADDRESSES"),
  "the client bundle must never read the server-side owner allowlist",
);
assert.ok(!tradePage.includes("buildDemoStrategyCurve"), "strategy vault charts must not fabricate performance");
assert.ok(!tradePage.includes("subscribers"), "strategy cards must not fabricate subscriber counts");
assert.ok(!tradePage.includes("ScheduleTradeModal"), "the trade page must not expose disabled automation");
assert.ok(!decibelDepthRoute.includes("generateSyntheticDepth"), "order-book depth must come from Decibel");
assert.match(depthCaptureWorker, /CAPTURE_INTERVAL_S, 60/);
assert.match(depthCaptureWorker, /RAW_RETENTION_DAYS, 3/);
assert.match(depthCaptureWorker, /compactDepthBatch/);
assert.ok(
  !depthCaptureWorker.includes("DELETE FROM decibel_depth_snapshots"),
  "the capture worker must summarize raw books before removing them",
);
assert.match(depthStorage, /CREATE TABLE IF NOT EXISTS \$\{SUMMARY_TABLE\}/);
assert.match(depthStorage, /pg_try_advisory_xact_lock/);
assert.ok(
  depthStorage.indexOf("INSERT INTO ${SUMMARY_TABLE}") < depthStorage.indexOf("DELETE FROM ${RAW_TABLE}"),
  "summary insertion must precede raw deletion",
);
assert.match(depthStorageDoctor, /const APPLY = process\.env\.APPLY === "1"/);
assert.match(depthStorageDoctor, /CONFIRM_DEPTH_COMPACTION === "compact"/);
assert.match(depthCompactionCron, /if \(!cronSecret\)/);
assert.match(depthCompactionCron, /Authorization: Bearer \$CRON_SECRET/);
assert.match(depthCompactionCron, /compactDepthBatch/);
assert.ok(
  depthVercelConfig.crons?.some(
    (cron: { path?: string; schedule?: string }) =>
      cron.path === "/api/cron/depth-compact" && cron.schedule === "17 4 * * *",
  ),
  "Vercel must run the protected depth compactor daily",
);
assert.match(launchpadSignalsRoute, /paid_signal_delivery_not_configured/);
assert.ok(!launchpadSignalsRoute.includes('url.searchParams.get("bot")'), "paid signal feeds must not have a public bypass");
assert.match(sponsorSubmitRoute, /checkApiRateLimit\(req, "sponsor-submit"/);
assert.match(sponsorSubmitRoute, /transaction\.feePayerAddress\.equals\(AccountAddress\.ZERO\)/);
assert.match(sponsorSubmitRoute, /transaction\.feePayerAddress = sponsor\.accountAddress/);
assert.ok(
  sponsorSubmitRoute.indexOf("transaction.feePayerAddress = sponsor.accountAddress")
    < sponsorSubmitRoute.indexOf("aptos.transaction.simulate.simple"),
  "the server must bind the sponsor after sender approval and before simulation",
);
assert.match(sponsorSubmitRoute, /checkRateLimitForKey\("sponsor-submit-sender"/);
assert.match(sponsorSubmitRoute, /MAX_BODY_BYTES/);
assert.match(sponsorSubmitRoute, /moduleName === "dex_accounts_entry"/);
assert.match(sponsorSubmitRoute, /moduleName === "cash_rewards"/);
assert.match(sponsorSubmitRoute, /functionName === "claim"/);
assert.match(sponsorSubmitRoute, /cashRewardConfig\.managerAddress/);
assert.ok(
  !sponsorSubmitRoute.includes('functionName === "fund"'),
  "the public sponsor must never pay for reward-vault administration",
);
assert.ok(
  !sponsorSubmitRoute.includes("TransactionPayloadScript"),
  "EVM-derived sponsorship must only accept entry-function transactions",
);
for (const functionName of [
  "approve_max_builder_fee_for_subaccount",
  "cancel_order_to_subaccount",
  "create_new_subaccount",
  "deposit_to_subaccount_at",
  "place_order_to_subaccount",
  "revoke_max_builder_fee_for_subaccount",
  "withdraw_from_subaccount",
] as const) {
  assert.ok(
    sponsorAllowlist.includes(`"${functionName}"`),
    `${functionName} must be explicitly sponsorable for gasless Decibel-domain owners`,
  );
}
assert.ok(
  sponsorSubmitRoute.includes("SPONSORABLE_DEX_ACCOUNT_FUNCTIONS"),
  "the sponsor route must enforce the shared sponsorable-function allowlist",
);
// A fresh native wallet (no APT, no on-chain account) cannot pay for its own
// first transaction; the submitter hook must route sponsorable calls through
// the fee-payer flow or first-time account creation fails in the wallet.
assert.ok(
  readFileSync("hooks/useDecibelTransactionSubmitter.ts", "utf8").includes(
    "submitSponsoredNativeAptosPayload",
  ),
  "native wallets must fall back to sponsored submission when gasless",
);
assert.ok(
  !sponsorSubmitRoute.includes("BOT_OPERATOR_PRIVATE_KEY"),
  "gas sponsorship must use a dedicated sponsor key",
);
assert.match(evmDerivedAptos, /accountSequenceNumber/);
assert.match(evmDerivedAptos, /SEQUENCE_LOOKUP_ATTEMPTS = 3/);
assert.ok(
  evmDerivedAptos.includes("error instanceof AptosApiError && error.status === 404"),
  "only a confirmed missing derived account may use sponsored sequence zero",
);
assert.ok(
  evmDerivedAptos.includes("data?.vmStatus") && txUtils.includes("data?.vmStatus"),
  "sponsor failures must expose the Aptos VM reason",
);
assert.ok(
  !evmDerivedAptos.includes("transaction.feePayerAddress ="),
  "EVM-derived senders must sign Aptos's canonical zero-address fee-payer placeholder",
);
assert.ok(
  !txUtils.includes("transaction.feePayerAddress ="),
  "wallet-adapter senders must leave fee-payer binding to the sponsor service",
);
// The bot API used to fail closed in production behind a blanket 501 because it
// had no authorization at all. It is now authorized per-request instead: an
// explicit owner allowlist plus on-chain proof that the caller owns the
// subaccount being traded. These assertions replace the blanket-gate tripwire —
// the surface must never go back to accepting an arbitrary body.
assert.match(legacyBotGuard, /reason: "legacy_bot_api_not_enabled"/);
assert.match(botOwnerGuard, /BOT_OWNER_ADDRESSES/);
assert.match(botOwnerGuard, /verifyDecibelSubaccountOwnership/);
assert.ok(
  botOwnerGuard.includes("lookupIncomplete") && botOwnerGuard.includes("status: 503"),
  "an ownership lookup that fails must be treated as denial, never as permission",
);
assert.ok(
  botOwnerGuard.includes("botOwnerAllowlistConfigured") && botOwnerGuard.includes("bot_owner_allowlist_not_configured"),
  "an unconfigured allowlist must disable the bot API rather than open it",
);
for (const [path, source] of legacyBotRoutes) {
  // The money-moving and data-exposing bot routes authorize per request.
  if (path.startsWith("app/api/bot/")) {
    assert.match(
      source,
      /denyUnlessBotOwner\(/,
      `${path} must authorize the caller against the bot owner allowlist`,
    );
    continue;
  }
  // The cron entry point is machine-authenticated, not user-authorized: it is
  // invoked by Vercel, not a wallet. It must keep its shared-secret check and
  // must refuse to run when that secret is unset.
  if (path === "app/api/cron/bot-tick/route.ts") {
    assert.match(source, /secretMatches\(provided, cronSecret\)/, "the bot cron must require CRON_SECRET (constant-time compare)");
    assert.match(source, /if \(!cronSecret\)/, "the bot cron must refuse to run when CRON_SECRET is unset");
    assert.match(
      source,
      /network: getActiveNetwork\(\)/,
      "the bot cron must only tick bots belonging to this deployment's network",
    );
    assert.match(source, /tickFailures/, "the bot cron must back off bots that keep failing");
    continue;
  }
  // Everything else on this surface stays behind the original blanket gate.
  assert.match(
    source,
    /legacyBotAutomationUnavailable\(\)/,
    `${path} must fail closed in production until wallet-signed authorization exists`,
  );
}
// Every route that can move funds must also prove subaccount ownership, not
// just that the caller is allowlisted.
for (const path of [
  "app/api/bot/start/route.ts",
  "app/api/bot/tick/route.ts",
  "app/api/bot/stop/route.ts",
  "app/api/bot/close-position/route.ts",
]) {
  const source = readFileSync(path, "utf8");
  assert.match(
    source,
    /denyUnlessBotOwner\(\{[^}]*subaccount/s,
    `${path} must verify the subaccount belongs to the authorized wallet`,
  );
}
assert.match(cloudStatusRoute, /legacyBotAutomationEnabled\(\)/);
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
assert.match(decibelStreamRoute, /STREAM_LIFETIME_MS = 4 \* 60 \* 1_000/);
assert.match(decibelStreamRoute, /reason: "scheduled_reconnect"/);
assert.match(decibelStreamRoute, /if \(lifetimeTimer\) clearTimeout\(lifetimeTimer\)/);
assert.ok(!nextConfig.includes("ignoreBuildErrors"), "production builds must fail on TypeScript errors");
for (const header of [
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
] as const) {
  assert.ok(nextConfig.includes(header), `production responses must set ${header}`);
}
assert.match(decibelMarketsRoute, /checkApiRateLimit\(req, "decibel-markets"/);
assert.match(decibelVaultStatusRoute, /isValidAptosAddress/);
assert.match(decibelVaultStatusRoute, /resolveDecibelNetwork\(body\.network\)/);
assert.match(vaultActionModal, /network: indicator\.network/);
assert.match(vaultActionModal, /endpoint: "\/api\/decibel\/vaults\/withdraw"/);
assert.match(vaultActionModal, /shares: mode === "withdraw"/);
assert.match(vaultActionModal, /owner: ownerWallet/);
assert.match(vaultActionModal, /explorer\.aptoslabs\.com\/account/);
assert.ok(
  !vaultActionModal.includes("Subaccount is required.")
    && vaultActionModal.includes("isContributionMode ?"),
  "vault contributions must resolve the primary account automatically and use the simplified contribution sheet",
);
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
const ownerResolvedVaultDeposit = buildDepositDecibelVaultPayload({
  owner: "0x1",
  vaultAddress: "0x2",
  amountRaw: "1000000",
  network: "mainnet",
});
assert.match(
  String(ownerResolvedVaultDeposit.payload.functionArguments[0]),
  /^0x[0-9a-f]{64}$/,
  "vault deposits must derive the primary Decibel subaccount from the connected owner",
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
assert.equal(
  buildWithdrawDecibelVaultPayload({
    subaccount: "0x1",
    vaultAddress: "0x2",
    sharesRaw: "2500000",
    network: "mainnet",
  }).sharesRaw,
  "2500000",
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
assert.match(cctpStatusRoute, /destinationCaller: parsed\.destinationCaller/);
assert.match(cctpDiscoverRoute, /Promise\.allSettled/);
assert.match(cctpDiscoverRoute, /https:\/\/base\.drpc\.org/);
assert.match(cctpDiscoverRoute, /chunkBlocks: 10_000/);
assert.match(cctpDiscoverRoute, /batchMaxCount: 1/);
assert.match(cctpDiscoverRoute, /attempt < 3/);
assert.ok(
  !cctpStatusRoute.includes("{ error: rawText"),
  "CCTP status must not echo arbitrary Circle response bodies",
);
assert.match(cctpClaimRoute, /checkApiRateLimit\(req, "cctp-claim"/);
assert.match(cctpClaimRoute, /checkRateLimitForKey\(\s*"cctp-claim-transfer"/);
assert.match(cctpClaimRoute, /parsed\.destinationCaller !== ZERO_CCTP_ADDRESS/);
assert.match(cctpClaimRoute, /sender: sponsor\.accountAddress/);
assert.match(cctpClaimRoute, /signerPublicKey: sponsor\.publicKey/);
assert.match(cctpClaimRoute, /MAX_RELAY_GAS_OCTAS/);
assert.match(accountManager, /fetch\("\/api\/decibel\/cctp\/claim"/);
assert.ok(
  !accountManager.includes("buildAptosCctpClaimPayload"),
  "wallets must not be asked to authenticate Circle's Move script",
);
const cctpBytes = new Uint8Array(216);
const cctpView = new DataView(cctpBytes.buffer);
cctpView.setUint32(4, 6, false);
cctpView.setUint32(8, 9, false);
cctpView.setBigUint64(12, 77n, false);
cctpBytes[183] = 0xab;
let cctpAmount = 56_014_641n;
for (let i = 215; i >= 184; i -= 1) {
  cctpBytes[i] = Number(cctpAmount & 0xffn);
  cctpAmount >>= 8n;
}
const parsedCctp = parseCctpMessage(
  `0x${Buffer.from(cctpBytes).toString("hex")}`,
);
assert.equal(parsedCctp?.sourceDomain, 6);
assert.equal(parsedCctp?.destinationDomain, 9);
assert.equal(parsedCctp?.destinationCaller, `0x${"0".repeat(64)}`);
assert.equal(parsedCctp?.mintRecipient, `0x${"0".repeat(62)}ab`);
assert.equal(parsedCctp?.amount, 56.014641);
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
assert.equal(builderFeeBpsToChainUnits(1), "100");
assert.equal(builderFeeBpsToChainUnits(10), "1000");
assert.throws(() => builderFeeBpsToChainUnits(0), /positive whole basis-point/);
assert.equal(DEFAULT_DECIBEL_BUILDER_FEE_BPS, 10);
assert.equal(DEFAULT_DECIBEL_BUILDER_FEE_RATE, 0.001);
assert.equal(DEFAULT_AUTOMATED_VAULT_BUILDER_FEE_BPS, 0);
assert.equal(MAX_AUTOMATED_VAULT_BUILDER_FEE_BPS, 0);
assert.match(
  decibelBuilderConfig,
  /DEFAULT_DECIBEL_BUILDER_FEE_RATE\s*=\s*\n?\s*DEFAULT_DECIBEL_BUILDER_FEE_BPS \/ 10_000/,
);
assert.match(
  vaultEconomics,
  /builderFeeBps: DEFAULT_AUTOMATED_VAULT_BUILDER_FEE_BPS/,
);
assert.match(
  sealedDeployScript,
  /SEALED_TREASURY_ADDRESS is required for a mainnet publish/,
);
assert.match(sealedDeployScript, /SEALED_VAULT_BUILDER_FEE_BPS must be 0/);
assert.match(sealedDeployScript, /state network mismatch/);
assert.match(sealedDeployScript, /--private-key-file/);
assert.doesNotMatch(
  sealedDeployScript,
  /"--private-key",\s*deployerKey\.toString\(\)/,
);
assert.match(sealedDeployScript, /assertPlatformTerms\(terms, platformEconomics\)/);
assert.match(sealedDeployScript, /refusing to continue or silently redirect revenue/);
assert.match(portfolioCleanroomScript, /writeOwnerOnlyFile\(statePath,/);
assert.match(portfolioCleanroomScript, /writeOwnerOnlyFile\(keyPath,/);
assert.match(portfolioCleanroomScript, /mode: 0o600/);
assert.match(portfolioCleanroomScript, /chmodSync\(path, 0o600\)/);
assert.match(portfolioCleanroomScript, /chmodSync\(DIR, 0o700\)/);
assert.match(portfolioCleanroomScript, /--migrate-key-only/);
assert.match(portfolioCleanroomScript, /no transaction submitted/);
assert.match(portfolioCleanroomScript, /"--private-key-file", keyPath/);
assert.doesNotMatch(portfolioCleanroomScript, /"--private-key",/);
assert.doesNotMatch(portfolioCleanroomScript, /crankPrivateKey: state\.privateKey/);
assert.match(portfolioMaxholdScript, /readFileSync\(keyPath, "utf8"\)/);
assert.doesNotMatch(portfolioMaxholdScript, /S\.privateKey/);
assert.match(moveCompileService, /writeOwnerOnlyFile\(keyPath, key\)/);
assert.match(moveCompileService, /"--private-key-file",\s*keyPath/);
assert.doesNotMatch(moveCompileService, /"--private-key",\s*key/);
const builderOrderConfig = {
  address: "0x2",
  maxLeverage: 10,
  minSizeRaw: 1,
  sizeDecimals: 2,
  priceDecimals: 2,
  tickSize: 1,
  lotSize: 1,
};
const builderFreeOrder = buildDecibelOrderPayload({
  marketName: "TEST/USD",
  marketConfig: builderOrderConfig,
  price: 10,
  size: 1,
  isBuy: true,
  orderType: "limit",
  subaccount: "0x1",
});
assert.equal(builderFreeOrder.payload.functionArguments[13], null);
assert.equal(builderFreeOrder.payload.functionArguments[14], null);
const routedBuilderOrder = buildDecibelOrderPayload({
  marketName: "TEST/USD",
  marketConfig: builderOrderConfig,
  price: 10,
  size: 1,
  isBuy: true,
  orderType: "limit",
  subaccount: "0x1",
  builderAddress: "0x3",
  builderFeeBps: 1,
});
assert.equal(
  routedBuilderOrder.payload.functionArguments[13],
  normalizeAptosAddress("0x3"),
);
assert.equal(routedBuilderOrder.payload.functionArguments[14], "100");
assert.throws(
  () => buildDecibelOrderPayload({
    marketName: "TEST/USD",
    marketConfig: builderOrderConfig,
    price: 10,
    size: 1,
    isBuy: true,
    orderType: "limit",
    subaccount: "0x1",
    builderAddress: "0x3",
  }),
  /must be provided together/,
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

assert.equal(packageJson.dependencies.next, "16.2.11");
assert.equal(packageJson.dependencies.ws, "^8.21.0");
assert.equal(packageJson.dependencies["@noble/hashes"], "1.8.0");
assert.equal(packageJson.dependencies.pg, "^8.22.0");
assert.equal(packageJson.scripts?.["depth:storage"], "node scripts/depth-storage-doctor.mjs");
assert.equal(packageJson.pnpm?.overrides?.["uuid@<11.1.1"], "11.1.1");
assert.equal(packageJson.packageManager, "pnpm@10.19.0");
assert.equal(packageJson.engines?.node, "22.x");
assert.equal(vercelConfig.build?.env?.NODE_VERSION, "22");
assert.ok(!existsSync("package-lock.json"), "the pnpm project must not ship a competing npm lockfile");


// ─── Sealed strategy vaults (docs/SEALED-INDICATOR.md) ───────────────────────
// The privacy invariant is the whole product: a sealed vault's PineScript must
// never be persisted or echoed. These assertions exist so a future refactor
// can't quietly start leaking it.

const sealedCommitRoute = readFileSync("app/api/sealed/commit/route.ts", "utf8");
assert.ok(
  !/pineScript\s*[,:]/.test(sealedCommitRoute.split("return NextResponse.json")[1] ?? ""),
  "the commit route must never echo the PineScript back in its response",
);
assert.ok(
  sealedCommitRoute.includes("commitProgram"),
  "the commit route must hash through commitProgram, not roll its own",
);

const sealedVaultsRoute = readFileSync("app/api/sealed/vaults/route.ts", "utf8");
assert.ok(
  !sealedVaultsRoute.includes("pineScript"),
  "the sealed registry must not accept or store a PineScript",
);

const sealedLib = readFileSync("lib/sealed-vaults.ts", "utf8");
assert.ok(
  !/pineScript:/.test(sealedLib.split("export interface PublicSealedVault")[1]?.split("}")[0] ?? ""),
  "PublicSealedVault must not expose the strategy source",
);
assert.ok(
  sealedLib.includes("revealedPine"),
  "the registry must keep reveals in a dedicated field so unrevealed vaults stay private",
);

// The attestation layout is a cross-language contract with sealed_vault.move.
// Drift here breaks every signature, so pin the domain and the field order.
const attestorLib = readFileSync("lib/sealed-attestor.ts", "utf8");
const portfolioAttestorLib = readFileSync("lib/portfolio-attestor.ts", "utf8");
const sealedVaultMove = readFileSync("contracts/strategy-vaults/sources/sealed_vault.move", "utf8");
const portfolioVaultMove = readFileSync(
  "contracts/strategy-vaults/sources/portfolio_vault.move",
  "utf8",
);
assert.ok(
  attestorLib.includes('"cash.trading/sealed-vault/v2"'),
  "the attestation domain separator must be pinned in the TypeScript signer",
);
assert.ok(
  sealedVaultMove.includes('b"cash.trading/sealed-vault/v2"'),
  "the attestation domain separator must match in Move",
);
assert.ok(
  portfolioAttestorLib.includes('"cash.trading/portfolio-vault/v2"') &&
    portfolioVaultMove.includes('b"cash.trading/portfolio-vault/v2"'),
  "the portfolio attestation domain separator must match in TypeScript and Move",
);
const bcsOrder = [
  "domain",
  "chain_id",
  "strategy_vault",
  "program_commitment",
  "seq",
  "input_digest",
  "bar_ts",
  "signal",
];
let cursor = 0;
for (const field of bcsOrder) {
  const at = attestorLib.indexOf(`// ${field}`, cursor);
  assert.ok(at > 0, `serializeAttestation must serialize ${field} in the documented order`);
  cursor = at;
}
const portfolioBcsOrder = [
  "domain",
  "chain_id",
  "strategy_vault",
  "program_commitment",
  "seq",
  "input_digest",
  "bar_ts",
  "actions_digest",
];
cursor = 0;
for (const field of portfolioBcsOrder) {
  const at = portfolioAttestorLib.indexOf(`// ${field}`, cursor);
  assert.ok(at > 0, `serializePortfolioAttestation must serialize ${field} in order`);
  cursor = at;
}

// Rules the module must keep enforcing. Each of these is a depositor guarantee.
assert.ok(
  sealedVaultMove.includes("assert!(sv.sealed, E_NOT_SEALED)"),
  "an unsealed vault must never be able to trade",
);
assert.ok(
  sealedVaultMove.includes("public_read_api::get_mark_price"),
  "the price must be read on-chain; perp_engine's reader is friend-visible on the current package",
);
assert.ok(
  !sealedVaultMove.includes("perp_engine::"),
  "sealed_vault must not call perp_engine directly — those accessors are friend-visible",
);
assert.ok(
  sealedVaultMove.includes("if (size < sv.min_size) return 0"),
  "sub-minimum orders must be SKIPPED, not clamped up past the NAV cap",
);
assert.ok(
  sealedVaultMove.includes("if (sv.in_position && sv.is_long == want_long_check)"),
  "a repeated same-direction signal must not pyramid the position past the leverage cap",
);
assert.ok(
  sealedVaultMove.includes("E_BAR_TOO_SOON"),
  "min_bar_interval_s must bound how often the attestor can act",
);
assert.ok(
  sealedVaultMove.includes("bar_ts + MAX_ATTESTATION_AGE_SECS >= now") &&
    sealedVaultMove.includes("bar_ts,") &&
    sealedVaultMove.includes("E_BAR_TOO_OLD"),
  "sealed attestations must bind their timestamp and expire on-chain",
);
assert.ok(
  portfolioVaultMove.includes("bar_ts + MAX_ATTESTATION_AGE_SECS >= now") &&
    portfolioVaultMove.includes("bar_ts,") &&
    portfolioVaultMove.includes("E_BAR_TOO_OLD"),
  "portfolio attestations must bind their timestamp and expire on-chain",
);
assert.ok(
  sealedVaultMove.includes("sealed: true,"),
  "a vault must be sealed by create_sealed_vault itself — a two-phase seal leaves a window in " +
    "which the rules are mutable, and lets a vault whose delegation failed be frozen forever",
);
assert.ok(
  !/public entry fun seal\(/.test(sealedVaultMove),
  "there must be no separate seal() entry — sealing is part of creation",
);
assert.ok(
  !/public entry fun set_sizing\(/.test(sealedVaultMove),
  "sizing is part of the sealed rule set and must have no post-creation setter",
);

// The launch sequence. This block exists because an earlier revision of SealedLaunch.tsx
// shipped with steps 1 and 3 missing entirely: it passed the user's own wallet address where
// the Decibel vault belonged and never delegated, so the vault it produced could not have
// placed a single order. Nothing in the type system catches that — only this does.
const sealedLaunchUi = readFileSync("components/sealed/SealedLaunch.tsx", "utf8");
/** Same file with runs of whitespace collapsed, so copy assertions survive re-wrapping. */
const sealedLaunchCopy = sealedLaunchUi.replace(/\s+/g, " ");
for (const kind of ['kind: "decibel-vault"', 'kind: "create"', 'kind: "delegate"']) {
  assert.ok(
    sealedLaunchUi.includes(kind),
    `the launch flow must perform ${kind} — all three transactions are required for a vault ` +
      `that can trade`,
  );
}
assert.ok(
  !/decibelVaultAddr:\s*(creator|account\.address)/.test(sealedLaunchUi),
  "the Decibel vault address must come from the create transaction, never from the user's wallet",
);
assert.ok(
  sealedLaunchUi.indexOf('kind: "delegate"') > sealedLaunchUi.indexOf('kind: "create"'),
  "delegation must be the LAST step — no trading authority may be granted before the strategy " +
    "is sealed and bound",
);

// The platform fee has to reach the chain. It previously lived only in the cost panel.
const sealedPayloadRoute = readFileSync("app/api/sealed/payload/route.ts", "utf8");
assert.ok(
  sealedPayloadRoute.includes("feeBps: PLATFORM_FEE.totalFeeBps"),
  "the vault must be created with the platform's fee_bps — a displayed fee that is never set " +
    "on-chain is not a fee",
);
assert.ok(
  sealedPayloadRoute.includes("feeIntervalS: DECIBEL_VAULT_LIMITS.minFeeIntervalS"),
  "fee_interval_s must use Decibel's 30-day floor; anything shorter aborts vault creation",
);
assert.ok(
  !sealedPayloadRoute.includes('kind === "seal"'),
  "the seal payload kind must be gone — sealing happens inside create_sealed_vault",
);

// ── Launch revenue and delegated-order compatibility ───────────────────────
// The launch fee is contract-enforced. Direct user orders retain the normal builder fee, but
// delegated vault orders must stay at zero until Decibel exposes a public approval path for the
// vault's actual trading subaccount. Approving the strategy object does not authorize that
// subaccount and makes every paid order abort with EBUILDER_NOT_REGISTERED.
assert.ok(
  sealedVaultMove.includes("collect_launch_fee(creator, decibel_vault_addr)"),
  "create_sealed_vault must collect the platform launch fee — a fee the UI charges but the " +
    "contract does not is bypassable by calling the contract directly",
);
assert.ok(
  sealedVaultMove.includes("primary_fungible_store::transfer"),
  "the launch fee must actually move USDC to the treasury",
);
assert.ok(
  sealedVaultMove.includes("if (!table::contains(licenses, decibel_vault))"),
  "the launch fee must be charged once per Decibel vault, not once per strategy — swapping " +
    "the algo is the thing the fee buys",
);
assert.ok(
  sealedVaultMove.includes("builder_code(builder_addr, builder_fee_bps)"),
  "the order path must keep the zero-fee builder-code omission and old-vault compatibility path",
);
assert.ok(
  sealedVaultMove.includes("builder_addr,\n            builder_fee_bps,"),
  "builder terms must be snapshotted into the vault at creation, so a later platform-config " +
    "change cannot redirect an existing vault's fees",
);
assert.ok(
  !sealedVaultMove.includes("perp_engine_api::approve_max_fee") &&
    !portfolioVaultMove.includes("perp_engine_api::approve_max_fee"),
  "a strategy object approval is the wrong identity and must never be presented as authorizing " +
    "the Decibel vault's trading subaccount",
);
assert.ok(
  sealedVaultMove.includes("assert!(launch_fee_units <= MAX_LAUNCH_FEE_UNITS, E_BAD_FEE)") &&
    sealedVaultMove.includes(
      "assert!(builder_fee_bps <= MAX_AUTOMATED_VAULT_BUILDER_FEE_BPS, E_BAD_FEE)",
    ) &&
    portfolioVaultMove.includes("sealed_vault::builder_stamp_friend()"),
  "the launch fee must stay bounded and automated vault builder fees must stay locked at zero",
);
assert.ok(
  sealedVaultMove.includes("public fun get_builder_terms") &&
    portfolioVaultMove.includes("public fun get_builder_terms"),
  "both vault modes must expose their frozen builder terms for exact preflight checks",
);
assert.ok(
  automatedVaultBuilder.includes("dex_primary_subaccount") &&
    automatedVaultBuilder.includes("builder_code_registry::get_approved_max_fee") &&
    automatedVaultBuilder.includes("AUTOMATED_VAULT_DECIBEL_PACKAGE_BY_NETWORK") &&
    automatedVaultBuilder.includes("0xe7da2794b1d8af76532ed95f38bfdf1136abfd8ea3a240189971988a83101b7f") &&
    !automatedVaultBuilder.includes("getDecibelPackage") &&
    automatedVaultBuilder.includes("Approval on the strategy object") &&
    automatedVaultBuilder.includes("builderFeeBps === 0"),
  "the legacy-vault preflight must use the package automated vaults were compiled against, " +
    "check the actual Decibel subaccount, and let new zero-fee vaults pass without fabricating " +
    "an approval",
);
assert.ok(
  sealedVaultMove.includes("struct StrategyRelaunched"),
  "an algo swap must emit an event — depositors need to see, on chain, when the strategy " +
    "behind their vault changed",
);

// ── The swap notice period ─────────────────────────────────────────────────
// Swapping the algo is the one hole in the sealed guarantee: build a record with strategy A,
// take deposits on it, quietly run strategy B. The notice period is what closes it, and every
// assertion here defends a property that was wrong at some point while building it.
assert.ok(
  sealedVaultMove.includes("assert_may_trade(sv)") &&
    sealedVaultMove.indexOf("assert_may_trade(sv)") <
      sealedVaultMove.indexOf("verify_attestation(sv, sv_addr"),
  "the swap gate must run inside tick_attested, before anything is committed — gating the " +
    "DELEGATION is impossible because Decibel's delegate_dex_actions_to is a private entry " +
    "this module can neither hook nor observe, so the trade is the only enforceable point",
);
assert.ok(
  sealedVaultMove.includes("if (!sv.is_swap) return;"),
  "the FIRST strategy on a vault is what depositors bought into and must never be gated",
);
assert.ok(
  sealedVaultMove.includes("if (!has_outside_depositors(sv.decibel_vault_addr, sv.creator)) return;"),
  "a creator alone in their own vault must be able to iterate instantly — the notice period " +
    "protects depositors, and with none present it is pure friction",
);
assert.ok(
  sealedVaultMove.includes("dex_accounts::primary_subaccount_public(creator)"),
  "the creator's shares must be counted in their SUBACCOUNT as well as their wallet: " +
    "create_and_fund_vault pays shares to the subaccount, so counting only the wallet made " +
    "every vault look like it had outside depositors and silently gated every swap",
);
assert.ok(
  sealedVaultMove.includes("assert!(now <= sv.announced_at + ANNOUNCE_VALIDITY_SECS, E_ANNOUNCE_EXPIRED)"),
  "an announcement must expire — otherwise a creator announces while their vault is empty " +
    "(no notice required), waits for deposits, and activates instantly months later on a " +
    "stale-but-satisfied announcement",
);
assert.ok(
  sealedVaultMove.includes("struct SwapAnnounced"),
  "the announcement must be an on-chain event; notice nobody can observe is not notice",
);

// ── Managed attestation ────────────────────────────────────────────────────
// A launched vault does nothing until something ticks it. Before this existed, the only cron
// in production was depth-compact and /api/sealed/attest required a caller to supply the
// PineScript — which for a private strategy only the creator had. A creator could complete the
// whole launch flow and own a vault that never placed an order.
const sealedTickLib = readFileSync("lib/sealed-tick.ts", "utf8");
const committedTraceLib = readFileSync("lib/committed-price-trace.ts", "utf8");
const sealedTickCron = readFileSync("app/api/cron/sealed-tick/route.ts", "utf8");
const sealedTickPersistence = readFileSync("lib/sealed-tick-persistence.ts", "utf8");
const sealedAttestRoute = readFileSync("app/api/sealed/attest/route.ts", "utf8");
const sourceVaultLib = readFileSync("lib/sealed-source-vault.ts", "utf8");
const sealedReadinessLib = readFileSync("lib/sealed-readiness.ts", "utf8");

assert.ok(
  sealedAttestRoute.includes("performTick") && sealedTickCron.includes("performTick"),
  "the manual endpoint and the cron must share ONE signing path — two implementations is how " +
    "a scheduled job quietly starts signing something the endpoint would have refused",
);
assert.ok(
  sealedTickLib.includes('stage: "commitment"') &&
    sealedTickLib.includes("localCommitment.toLowerCase() !== snapshot.commitment.toLowerCase()"),
  "the attestor must refuse to sign for a program the vault did not commit to; that refusal " +
    "IS the product guarantee",
);
assert.ok(
  sealedTickLib.includes("::sealed_vault::get_trace") &&
    !sealedTickLib.includes("fetchPythCandles") &&
    sealedTickLib.includes('stage: "state-changed"'),
  "the single-market attestor must evaluate the contract's committed prior-bar trace and " +
    "refuse to sign if that snapshot changes; a fresh Pyth download is not the signed input",
);
assert.ok(
  sealedTickLib.includes("assertAutomatedVaultBuilderCompatible") &&
    sealedTickLib.includes('stage: "builder-preflight"') &&
    sealedTickLib.indexOf("assertAutomatedVaultBuilderCompatible({") <
      sealedTickLib.indexOf("signAttestation(new Ed25519PrivateKey"),
  "a directional single-market tick must prove builder compatibility before it signs",
);
assert.ok(
  committedTraceLib.includes("parseSingleCommittedTrace") &&
    committedTraceLib.includes("trace timestamps must increase strictly") &&
    committedTraceLib.includes("Number.MAX_SAFE_INTEGER"),
  "committed price traces must be decoded strictly before JavaScript evaluates or signs them",
);
assert.ok(
  sealedTickCron.includes("isTooSoon(r)"),
  "E_BAR_TOO_SOON is the normal state of a vault slower than the cron — counting it as a " +
    "failure would back off every healthy vault",
);
assert.ok(
  sealedTickCron.includes("backoffMs(row.tickFailures)"),
  "a persistently failing vault must back off rather than burn gas every minute",
);
assert.ok(
  !sealedTickCron.includes("catch(() => undefined)"),
  "sealed-vault tick persistence must never fail silently — otherwise confirmed fills vanish " +
    "from analytics and failed vaults never enter backoff",
);
assert.ok(
  sealedTickCron.includes("persistSingleMarketTick") &&
    sealedAttestRoute.includes("persistSingleMarketTick") &&
    sealedTickPersistence.includes("prisma.$transaction(writes)") &&
    sealedTickPersistence.includes("skipDuplicates: true"),
  "a confirmed single-market tick must persist its receipt and health cursor atomically and " +
    "remain idempotent when the same receipt is replayed, regardless of which attestation " +
    "entry point submitted it",
);
assert.ok(
  sealedTickCron.includes("persistenceWarning") &&
    sealedTickCron.includes("statusPersistenceWarning") &&
    sealedTickCron.includes("persistenceWarnings") &&
    sealedAttestRoute.includes("persistenceWarning"),
  "database failures after an on-chain tick must be surfaced in the authenticated cron result " +
    "and logs, not reported as a clean success",
);
const managedRowsLookup = sealedTickCron.indexOf("const rows = await prisma.sealedVault.findMany");
const emptyManagedQueue = sealedTickCron.indexOf("if (rows.length === 0)");
const executionKeyGate = sealedTickCron.indexOf("if (!attestorKey || !crankKey)");
assert.ok(
  managedRowsLookup >= 0 &&
    emptyManagedQueue > managedRowsLookup &&
    executionKeyGate > emptyManagedQueue &&
    sealedTickCron.includes('skipped: "no managed sealed vaults"'),
  "the cron must inspect its queue before demanding execution keys: an empty preview deployment " +
    "is a healthy no-op, while keys remain mandatory before any live managed vault can tick",
);
const vercelJson = readFileSync("vercel.json", "utf8");
assert.ok(
  vercelJson.includes("/api/cron/sealed-tick"),
  "the tick cron must be scheduled — without it every launched vault sits inert",
);

// The encrypted-source custody that makes managed attestation possible at all.
assert.ok(
  sourceVaultLib.includes("aes-256-gcm") && sourceVaultLib.includes("setAAD"),
  "sources must be authenticated-encrypted with the vault address bound in, so a row swap " +
    "cannot hand one creator another's strategy",
);
assert.ok(
  sourceVaultLib.includes("randomBytes(IV_BYTES)"),
  "GCM nonces must be fresh per encryption — reuse is catastrophic",
);
assert.ok(
  !/SEALED_SOURCE_KEY[^\n]*(default|\?\?\s*")/.test(sourceVaultLib),
  "the encryption key must have no fallback — a default key is no key",
);
const sealedVaultsRoute2 = readFileSync("app/api/sealed/vaults/route.ts", "utf8");
assert.ok(
  sealedVaultsRoute2.includes("managedPine") && sealedVaultsRoute2.includes("encryptSource"),
  "a managed source must be stored encrypted, never in plaintext",
);
assert.ok(
  sealedVaultsRoute2.split("managedPine")[1]?.includes("verifyRevealedProgram") ||
    sealedVaultsRoute2.includes("the source given for managed attestation does not hash"),
  "a source accepted for managed attestation must be verified against the vault's commitment " +
    "before it is stored — otherwise the attestor could be handed a different strategy",
);
// The UI must state the trade-off rather than implying custody is free.
assert.ok(
  sealedLaunchCopy.includes("we can technically read it"),
  "managed attestation must say plainly that the platform can read the source; tier-1 custody " +
    "is trust, not cryptography, and implying otherwise is a lie",
);

// ── Deploy-breaking configuration traps ────────────────────────────────────
// Each of these shipped and would have produced a deployment that LOOKS healthy while no vault
// ever trades. They are the failure mode that costs the most to diagnose, because nothing
// errors — the app reports ready and the vaults are simply silent.
assert.ok(
  sealedTickCron.includes("process.env.CRON_SECRET"),
  "the tick cron must accept CRON_SECRET — that is what Vercel Cron actually sends in the " +
    "Authorization header. Reading only CRANK_SECRET made the scheduled run 401 forever while " +
    "config reported ready:true and creators launched vaults that never placed an order",
);
assert.ok(
  sealedTickCron.includes("attestorKeyMismatch"),
  "the cron must cross-check the attestor keypair: the PUBLIC key is committed into every " +
    "vault at creation and vaults are sealed at birth, so a swapped pair is unrecoverable",
);
assert.ok(
  sourceVaultLib.includes("keyProblem") &&
    sourceVaultLib.includes("silently TRUNCATES"),
  "a malformed SEALED_SOURCE_KEY must report as malformed, not as missing — Buffer.from(hex) " +
    "truncates at the first bad character, so a key that IS set reported as 'not set'",
);
const envExample = readFileSync(".env.example", "utf8");
assert.ok(
  !/^DECIBEL_VAULT_PACKAGE="0x[0-9a-f]+"/m.test(envExample),
  ".env.example must not ship DECIBEL_VAULT_PACKAGE pre-filled — it was pinned to the TESTNET " +
    "package, so copying this file to production pinned mainnet to testnet Decibel",
);
assert.ok(
  envExample.includes("SEALED_SOURCE_KEY"),
  ".env.example must document SEALED_SOURCE_KEY — without it a production deploy ships with " +
    "managed attestation silently disabled",
);
const sealedConfigRoute = readFileSync("app/api/sealed/config/route.ts", "utf8");
assert.ok(
  sealedReadinessLib.includes("0x[0-9a-fA-F]{64}"),
  "config must validate the attestor pubkey FORMAT, not just its presence: a bare-hex key " +
    "reported ready:true and then failed on the LAST launch step, after the creator had " +
    "already paid to create the Decibel vault",
);
assert.ok(
  sealedConfigRoute.includes("evaluateSealedReadiness") &&
    sealedConfigRoute.includes("withSealedPlatformReadiness") &&
    sealedReadinessLib.includes("ready: managedReady") &&
    sealedReadinessLib.includes("SEALED_ATTESTOR_PRIVATE_KEY") &&
    sealedReadinessLib.includes("SEALED_CRANK_PRIVATE_KEY") &&
    sealedReadinessLib.includes("SEALED_SOURCE_KEY") &&
    sealedReadinessLib.includes("CRON_SECRET"),
  "config.ready must mean the default managed bot can actually decrypt, sign and crank — " +
    "package + public key alone can create a paid vault that never trades",
);
assert.ok(
  sealedPayloadRoute.includes("readPlatformTerms(network)") &&
    sealedPayloadRoute.includes("before any funds are spent"),
  "the first paid launch payload must require live on-chain platform terms: a syntactically " +
    "valid but unpublished package can otherwise charge the Decibel fee before binding fails",
);
assert.ok(
  sealedVaultsRoute2.includes("readiness.managedReady") &&
    sealedVaultsRoute2.includes("must match the configured platform attestor key"),
  "managed registration must reject an incomplete runner and an on-chain attestor key the " +
    "platform cannot sign for",
);
const launchScript = readFileSync("scripts/sealed-vault-launch.ts", "utf8");
assert.ok(
  launchScript.includes("hexToBytes(attestorPub)"),
  "the CLI launch script must pass vector<u8> as bytes; a hex string is encoded as its UTF-8 " +
    "characters and aborts with E_BAD_PUBKEY, which reads like a bad env var",
);
// Prisma drift: the cron's hottest query depends on this index existing in BOTH places.
const prismaSchema = readFileSync("prisma/schema.prisma", "utf8");
assert.ok(
  prismaSchema.includes("@@index([managedAttestation, network])"),
  "schema.prisma must declare the index the migration creates, or `prisma migrate diff` " +
    "reports drift and a future `db push` would drop the tick cron's index",
);
assert.ok(
  prismaSchema.includes("@@index([network, retiredAt])"),
  "same for the retirement index the cron's working-set query now filters on",
);
assert.ok(
  prismaSchema.includes("model CashRewardEpochCheckpoint"),
  "weekly CASH earnings need a monotonic checkpoint instead of a moving 1,000-fill window",
);
assert.ok(
  cashRewardsCheckpointMigration.includes('CREATE TABLE "CashRewardEpochCheckpoint"'),
  "the monotonic CASH checkpoint must be created in production before the rewards route runs",
);

// ── Swapping an algo must not leave the vault dark ─────────────────────────
// The failure this guards is silent and total: a swap revokes the outgoing strategy's
// delegation on-chain and delegates the replacement, but the tick cron works off the registry.
// If the registry is not updated in the same flow, the cron keeps ticking a strategy that can
// no longer place an order and never ticks the one that can — the vault simply stops trading,
// with nothing in the UI to say so. Same shape as the CRON_SECRET trap.
assert.ok(
  /retiredAt:\s*null/.test(sealedTickCron),
  "the tick cron must exclude retired vaults: a retired strategy's delegation was revoked in " +
    "a swap, so every tick of it that produced an order would abort on Decibel forever",
);
const swapUi = readFileSync("components/sealed/SealedSwap.tsx", "utf8");
assert.ok(
  swapUi.includes("retiresStrategyVaultAddrs"),
  "the handover must register the replacement AND retire its predecessor in one call — " +
    "registering alone leaves two strategies in the cron's working set for one Decibel vault, " +
    "retiring alone leaves the vault with nothing being ticked",
);
assert.ok(
  /kind:\s*"revoke",\s*\n\s*decibelVaultAddr:\s*p\.decibelVaultAddr,\s*\n\s*\}\)/.test(swapUi),
  "the handover must revoke with NO address list, which builds revoke_all_dex_actions_delegations. " +
    "Naming addresses only disarms the delegates we know about; one we missed keeps trading the " +
    "same subaccount as the replacement and the engine nets them together (DEPLOY-SEALED §8.5c)",
);
assert.ok(
  sealedLib.includes("revoke_all_dex_actions_delegations"),
  "buildRevokeDelegationPayload must support the revoke-all form — it is the only variant that " +
    "needs no knowledge of who the delegates are",
);
const vaultsRoute = readFileSync("app/api/sealed/vaults/route.ts", "utf8");
assert.ok(
  vaultsRoute.includes("prisma.$transaction"),
  "register-and-retire must be one transaction; a half-applied swap is a vault with either " +
    "two live strategies or none",
);
assert.ok(
  vaultsRoute.includes("belongs to a different creator") &&
    vaultsRoute.includes("trades a different Decibel vault"),
  "retirement is unauthenticated like the rest of these routes, so it must be checked against " +
    "what is already registered — otherwise anyone could retire a stranger's live vault by " +
    "registering a throwaway one",
);

// ── Launch layout ──────────────────────────────────────────────────────────
// The launch flow is a single-column 3-step panel (Strategy → Markets & limits → Name & fund).
// The property that matters is the one the old two-column grid used to guard: the primary
// action is never below the fold. It now holds because ONE footer() is rendered twice — in the
// desktop panel footer and in the fixed mobile bar — and renders exactly one primary per step.
assert.ok(
  /const footer = \(compact: boolean\) =>/.test(sealedLaunchUi)
    && sealedLaunchUi.includes("{footer(false)}")
    && sealedLaunchUi.includes("{footer(true)}"),
  "the desktop action row and the fixed mobile bar must share ONE footer — two implementations " +
    "is how the primary action drifts out of sync between widths",
);
assert.ok(
  /className="hidden border-t [^"]*lg:block">\s*\{footer\(false\)\}/.test(sealedLaunchUi),
  "on desktop the action row must sit in the panel footer, not ~2000px down a centred column",
);
assert.equal(
  (sealedLaunchUi.match(/\{primary\}/g) ?? []).length,
  1,
  "the footer must render exactly one primary action per step",
);
assert.ok(
  !sealedLaunchUi.includes("lg:overflow-y-auto"),
  "the launch panel must use the page scroll instead of creating a nested desktop scroll trap",
);
assert.ok(
  sealedLaunchUi.includes("PineVisualPreview"),
  "the behaviour preview belongs on the launch page — a strategy is not judgeable from source " +
    "alone",
);
// Strategies are a vertical radio list in a deliberate order: the three with the most
// defensible default behaviour lead and Swing Consensus (eight votes, weakest backtest) goes
// last instead of being preselected for every new creator.
assert.ok(
  sealedLaunchUi.includes("ORDERED_CATALOG.map")
    && sealedLaunchUi.indexOf('role="radiogroup" aria-label="Strategy"') > 0
    && sealedLaunchUi.indexOf('role="radiogroup" aria-label="Strategy"')
      < sealedLaunchUi.indexOf("ORDERED_CATALOG.map"),
  "strategies must render as an ordered radio list, not an unordered template pill strip",
);
assert.ok(
  /const CATALOG_ORDER = \[\s*"breakout-channel",[\s\S]*?"swing-consensus",\s*\]/.test(sealedLaunchUi)
    && sealedLaunchUi.includes("const DEFAULT_STRATEGY = ORDERED_CATALOG[0]"),
  "breakout-channel must lead and be the default; swing-consensus must be last",
);

// ── Mobile ─────────────────────────────────────────────────────────────────
// The launch page was built and reviewed exclusively at desktop width. On a phone the result
// was 3.8 screens of identical full-width cards with the launch button at y=2992 — reachable
// only by scrolling past every decision the user had already made.
assert.ok(
  sealedLaunchUi.includes("fixed inset-x-0 bottom-0") && sealedLaunchUi.includes("lg:hidden"),
  "mobile needs a fixed action bar: the desktop rail footer sits ~3000px down on a phone",
);
assert.ok(
  sealedLaunchUi.includes("env(safe-area-inset-bottom)"),
  "the mobile action bar must respect the safe area or it sits under the home indicator",
);
assert.ok(
  sealedLaunchUi.includes('className="h-24 lg:hidden"'),
  "a spacer must reserve room for the fixed bar, or it covers the last card",
);
// The template pill strip is gone. What replaced it must not re-create the phone problem it
// caused: each strategy option is a full-width ≥44px row and nothing in the list scrolls
// sideways.
assert.ok(
  /role="radio"\s+aria-checked=\{active\}[\s\S]*?"flex min-h-11 w-full items-start/.test(sealedLaunchUi)
    && !sealedLaunchUi.includes("overflow-x-auto px-4 no-scrollbar"),
  "strategy options must be full-width 44px rows — no horizontal pill strip on a phone",
);

// ── Truthful UI state ──────────────────────────────────────────────────────
// The worst defect a UX review found: the Launch button rendered as a live green primary
// action while the page said launching was impossible. A financial action must never look
// available when it isn't.
{
  const previewGate = sealedLaunchUi.indexOf("if (previewMode) {");
  assert.ok(
    sealedLaunchCopy.includes("Launch unavailable in preview mode")
      && /if \(previewMode\) \{\s*return \(\s*<div\s+role="status"/.test(sealedLaunchUi)
      && previewGate > sealedLaunchUi.indexOf("const footer = (compact: boolean) =>")
      && previewGate < sealedLaunchUi.indexOf("<ActionButton"),
    "when the contract is unpublished the shared footer must RENDER the primary as an " +
      "unavailable status, not reach the launch button with a disabled prop that still looks " +
      "launchable",
  );
}
{
  const banner = sealedLaunchUi.indexOf("Preview mode · launching is unavailable");
  assert.ok(
    banner > 0 && banner < sealedLaunchUi.indexOf("<ProductPanel"),
    "the unavailable state must render ABOVE the step panel — users should not configure " +
      "the whole flow before learning they cannot launch",
  );
}
assert.ok(
  sealedLaunchUi.includes("Developer details"),
  "raw env-var names belong behind a disclosure, not in the default customer experience",
);
// Capital-at-risk language. "Stays yours" read as though the seed were protected.
assert.ok(
  sealedLaunchCopy.includes("exposed to its gains and losses") &&
    !sealedLaunchCopy.includes("Stays yours"),
  "starting capital must be described as at risk, not as money the creator keeps safe",
);
assert.ok(
  sealedLaunchCopy.includes("Before you launch") && sealedLaunchCopy.includes("Capital at risk"),
  "a risk review must appear immediately before the launch action",
);
// The privacy copy contradicted the Public option sitting directly beneath it.
assert.ok(
  !sealedLaunchCopy.includes("never your source") &&
    !sealedLaunchCopy.includes("Nobody can read your alpha"),
  "privacy copy must not make absolute claims, nor contradict the Public option",
);

// The launch fee is spent from the WALLET while Decibel's fee comes from the SUBACCOUNT.
// Checking only one pot lets the UI green-light a launch that aborts on EINSUFFICIENT_BALANCE.
const sealedPreflightRoute = readFileSync("app/api/sealed/decibel-vault/route.ts", "utf8");
assert.ok(
  sealedPreflightRoute.includes("primary_fungible_store::balance") &&
    sealedPreflightRoute.includes("max_allowed_withdraw_from_cross"),
  "preflight must check BOTH the wallet's USDC (our launch fee) and the subaccount's " +
    "(Decibel's fee plus the seed)",
);

// The Public toggle must actually publish, and only a source that matches the commitment.
assert.ok(
  sealedVaultsRoute.includes("verifyRevealedProgram"),
  "a revealed PineScript must be re-hashed against the commitment before it is stored — " +
    "otherwise a vault can display one strategy and execute another",
);

// Deps must target the CURRENT Decibel package. The old one has no delegation
// revocation at all (docs/CURATOR-RULES.md §2).
const decibelAccountsToml = readFileSync(
  "contracts/strategy-vaults/deps/decibel_accounts/Move.toml",
  "utf8",
);
assert.ok(
  /decibel = "_"/.test(decibelAccountsToml),
  "the decibel named address must stay parameterized ('_') so one source publishes to both networks",
);
assert.ok(
  !decibelAccountsToml.includes("0x952535c3049e52f195f26798c2f1340d7dd5100edbe0f464e520a974d16fbe9f"),
  "the old Decibel package (no delegation revocation) must never come back",
);
const e2eScript = readFileSync("scripts/sealed-e2e-deploy.ts", "utf8");
assert.ok(
  e2eScript.includes("0xe7da2794b1d8af76532ed95f38bfdf1136abfd8ea3a240189971988a83101b7f") &&
    e2eScript.includes("0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06"),
  "the e2e pipeline must pin the current Decibel package for BOTH networks",
);

assert.equal(packageJson.scripts?.["test:sealed"], "tsx scripts/sealed-attestor-selftest.ts");
assert.equal(packageJson.scripts?.["test:catalog"], "tsx scripts/sealed-catalog-selftest.ts");
assert.equal(packageJson.scripts?.["test:economics"], "tsx scripts/vault-economics-selftest.ts");
assert.equal(
  packageJson.scripts?.["test:sealed-package"],
  "tsx scripts/sealed-package-verification-selftest.ts",
);
assert.equal(
  packageJson.scripts?.["test:sealed-deploy"],
  "tsx scripts/sealed-mainnet-deploy-guard-selftest.ts",
);

// Decibel's vault limits are consensus-enforced — a stale value aborts vault
// creation in production. The 30-day fee-interval floor in particular bit us:
// the e2e pipeline shipped 86400 (1 day), which Decibel rejects outright.
const economics = readFileSync("lib/vault-economics.ts", "utf8");
assert.ok(economics.includes("minFeeIntervalS: 2_592_000"), "fee-interval floor must stay pinned at 30 days");
assert.ok(economics.includes("maxFeeBps: 1000"), "Decibel's 10% profit-share ceiling must stay pinned");
const e2e = readFileSync("scripts/sealed-e2e-deploy.ts", "utf8");
assert.ok(
  !/"86400", \/\/ fee_interval_s/.test(e2e),
  "the e2e pipeline must not pass a fee interval below Decibel's 30-day floor",
);

// The launch flow must stay minimal. These assertions exist because the first
// version asked creators for a Decibel vault address and a raw ed25519 attestor
// key — neither of which is theirs to decide.
const launchUi = readFileSync("components/sealed/SealedLaunch.tsx", "utf8");
const pineMarketplaceUi = readFileSync("components/launchpad/PineMarketplace.tsx", "utf8");
const pinePreviewUi = readFileSync("components/launchpad/PineVisualPreview.tsx", "utf8");
const marketPermissionsUi = readFileSync("components/launchpad/MarketPermissionsModal.tsx", "utf8");
const productSurfaceUi = readFileSync("components/ui/product-surface.tsx", "utf8");
const launchpadRoute = readFileSync("app/launchpad/page.tsx", "utf8");
// The <Theme> wrapper moved out of the route so `appearance` can follow the
// light/dark toggle, which needs a client component. The route still has to
// render it — asserted below against both files.
const launchpadTheme = readFileSync("components/launchpad/launchpad-theme.tsx", "utf8");
const rootLayout = readFileSync("app/layout.tsx", "utf8");
const globalsCss = readFileSync("app/globals.css", "utf8");
const surfaceTokens = readFileSync("lib/surface.ts", "utf8");
assert.ok(
  !/placeholder="0x…"/.test(launchUi),
  "the launch flow must not ask the user to paste raw addresses or keys",
);
assert.ok(
  launchUi.includes("/api/sealed/config"),
  "the launch flow must source the attestor key and defaults from the server",
);
// The shared UI kits must keep their accessibility and reduced-motion
// contracts — interior.dev's whole point is that these get done badly by
// default, and a refactor that drops them is silent.
const agentKit = readFileSync("components/ui/agent/index.tsx", "utf8");
const interactionKit = readFileSync("components/ui/interactions/index.tsx", "utf8");
for (const [name, src] of [["agent", agentKit], ["interactions", interactionKit]] as const) {
  assert.ok(src.includes("useReducedMotion"), `${name} kit must honour prefers-reduced-motion`);
}
assert.ok(agentKit.includes('aria-label="Copy code"'), "the code block's copy button must be labelled");
assert.ok(interactionKit.includes('aria-modal="true"'), "the modal must set aria-modal");
assert.ok(interactionKit.includes('aria-busy'), "the action button must expose a busy state");
assert.ok(
  interactionKit.includes("restoreTo.current?.focus?.()"),
  "the modal must restore focus on close",
);
// One easing curve across both kits — mixed easing is the jank interior.dev warns about.
assert.ok(
  agentKit.includes("[0.16, 1, 0.3, 1]") && interactionKit.includes("[0.16, 1, 0.3, 1]"),
  "both kits must share the same easing curve",
);

// Surface consistency: the launchpad must use the trade page's radii and
// borders. Tailwind's named scale does NOT match — with --radius: 0.75rem,
// rounded-2xl is 20px against the trade page's 16px panels, which is exactly
// the mismatch that made the new components look bolted on.
for (const f of [
  "components/ui/agent/index.tsx",
  "components/ui/interactions/index.tsx",
  "components/sealed/SealedLaunch.tsx",
  "components/sealed/SealedVaultFeed.tsx",
]) {
  const src = readFileSync(f, "utf8");
  const named = src.match(/(?<![\w-])rounded-(sm|md|lg|xl|2xl|3xl)(?![\w-])/g);
  assert.ok(
    !named,
    `${f} must use explicit radii from lib/surface.ts, not Tailwind's named scale (found ${named?.join(", ")})`,
  );
  assert.ok(
    !src.includes("border-[#2a2a2a]"),
    `${f} must use border-white/[0.08] like the trade page, not the harder #2a2a2a`,
  );
}
const sealedVaultFeed = readFileSync("components/sealed/SealedVaultFeed.tsx", "utf8");
assert.ok(
  !sealedVaultFeed.includes("network=testnet") &&
    sealedVaultFeed.includes("NEXT_PUBLIC_DECIBEL_NETWORK"),
  "the sealed-vault marketplace must follow the configured Decibel network",
);

// New product workflows must be assembled from the same semantic surfaces as
// the trade page. This catches the exact regression where Launchpad introduced
// its own blacks, borders, radii, selectors, and full-screen desktop dialog.
assert.ok(
  productSurfaceUi.includes("bg-background-secondary")
    && productSurfaceUi.includes("border-card-border")
    && productSurfaceUi.includes("rounded-[var(--radius)]"),
  "product surfaces must consume the cash-trade-theme semantic tokens",
);
assert.equal(
  packageJson.dependencies["frosted-ui"],
  "0.0.1-canary.155",
  "Frosted UI must stay exactly pinned while its public API is canary-only",
);
// Frosted UI's stylesheet is imported into a `frosted` cascade layer in
// globals.css (ordered below Tailwind utilities) rather than plainly in the
// layout — importing it unlayered let its resets beat every Tailwind utility
// site-wide (borders → 0px, headings → 400). Assert the layered import + the
// declared layer order so the regression can't silently return.
assert.ok(
  globalsCss.includes('@import "frosted-ui/styles.css" layer(frosted)'),
  "Frosted UI styles must load in the `frosted` cascade layer, not unlayered",
);
assert.ok(
  /@layer[^;]*\bframework\b[^;]*;|@layer[^;]*\butilities\b[^;]*;/.test(globalsCss)
    && globalsCss.indexOf("@layer ") < globalsCss.indexOf('@import "frosted-ui/styles.css"'),
  "the cascade layer order must be declared before the frosted import so utilities win",
);
assert.ok(
  !rootLayout.includes('import "frosted-ui/styles.css"'),
  "Frosted UI styles must NOT be imported unlayered in the root layout",
);
assert.ok(
  launchpadRoute.includes("<LaunchpadTheme>")
    && launchpadTheme.includes('from "frosted-ui"')
    && launchpadTheme.includes("<Theme")
    && launchpadTheme.includes('accentColor="lime"')
    && /className=\{cn\("cash-trade-theme"/.test(launchpadTheme),
  "the launchpad route must scope Frosted UI to the cash.trading theme",
);
// frosted-ui resolves its token set from the theme, so a hardcoded "dark"
// would leave every frosted surface on this route dark on a light page. It
// must follow the document theme — but via the CLASS, not the `appearance`
// prop: an explicit appearance makes this a frosted "root" theme, which ships
// an inline script that rewrites documentElement's light/dark class and
// color-scheme on every render. On /launchpad that fought the boot script in
// app/layout.tsx and leaked the class onto <html> after a client-side
// navigation away.
assert.ok(
  launchpadTheme.includes("useThemeName") && /className=\{cn\("cash-trade-theme", theme\)\}/.test(launchpadTheme),
  "the launchpad Frosted UI theme must follow the active theme via its own class",
);
assert.ok(
  !launchpadTheme.includes("appearance="),
  "the launchpad Frosted UI theme must not take `appearance`, which hijacks documentElement's theme class",
);
assert.ok(
  productSurfaceUi.includes('from "frosted-ui"')
    && productSurfaceUi.includes("<Card")
    && productSurfaceUi.includes("<Button")
    && productSurfaceUi.includes("<Badge"),
  "shared launchpad surfaces must be backed by Frosted UI primitives",
);
assert.ok(
  !/bg-\[#[0-9a-f]{3,8}\]/i.test(productSurfaceUi),
  "shared product surfaces must not hard-code a private color palette",
);
assert.ok(
  pineMarketplaceUi.includes("ProductSelectorButton")
    && pineMarketplaceUi.includes("ResponsiveModalSheet")
    && pineMarketplaceUi.includes("ProductPanel"),
  "the Pine workbench and browser must use the shared product primitives",
);
assert.ok(
  launchUi.includes("ProductPanel")
    && launchUi.includes("ProductSection")
    && launchUi.includes("ProductSelectorButton"),
  "the launch configuration must use the shared product primitives",
);
assert.ok(
  marketPermissionsUi.includes('from "frosted-ui"')
    && marketPermissionsUi.includes("<ResponsiveModalSheet")
    && marketPermissionsUi.includes("<Switch")
    && marketPermissionsUi.includes("Allow all launch-ready markets")
    && marketPermissionsUi.includes("onToggleAll"),
  "market access must be a responsive Frosted UI permission sheet with a master switch",
);
assert.ok(
  launchUi.includes("<MarketPermissionsModal")
    && !launchUi.includes("<MarketModal")
    && !launchUi.includes("previewMarketOpen"),
  "launchpad market access must use one permission picker, not trade-page dropdowns",
);
assert.ok(
  pineMarketplaceUi.includes('label="Indicator library"')
    && pineMarketplaceUi.includes('aria-label="Browse indicator library"')
    && !pineMarketplaceUi.includes("function ChevronDownIcon"),
  "the indicator selector must expose a labelled compact library trigger",
);
assert.ok(
  productSurfaceUi.includes("<ChevronDown")
    && productSurfaceUi.includes("!h-10")
    && productSurfaceUi.includes("hover:!bg-white/[0.05]")
    && productSurfaceUi.includes('<span className="sr-only">{label}</span>'),
  "launchpad selectors must share the trade page's compact icon/value/chevron contract",
);
assert.ok(
  !pineMarketplaceUi.includes("flex flex-col gap-2 border-b")
    && !pineMarketplaceUi.includes("source loaded")
    && !launchUi.includes("All ${markets.length} markets approved"),
  "launchpad selectors must not regress to oversized multi-line action cards",
);
assert.ok(
  !pineMarketplaceUi.includes("h-[100dvh] w-screen"),
  "the desktop Pine browser must not regress to a full-screen one-off modal",
);
assert.ok(
  !surfaceTokens.includes('"bg-[#') && !surfaceTokens.includes('"border-white/[0.06]'),
  "surface constants must stay semantic so theme changes reach every workflow",
);
assert.ok(
  !pinePreviewUi.includes("border-[#2a2a2a]"),
  "Pine chart chrome must use the same border token as the rest of the product",
);

const launchPage = readFileSync("components/launchpad/LaunchpadPage.tsx", "utf8");
// The marketplace tab strip is gone: /launchpad is the Vaults page. One
// `launching` boolean swaps the vault list for the launch flow in place, so
// there is exactly one primary action on screen at any time; All / Mine is a
// pressed-state filter, not a tab bar.
assert.ok(
  /const \[launching, setLaunching\] = useState\(false\)/.test(launchPage),
  "the launch flow must be toggled by one boolean, not a Tab union",
);
assert.ok(
  !/type Tab\s*=/.test(launchPage) && !launchPage.includes("setTab("),
  "the Explore / My Bots / Creator tab strip must not return",
);
assert.ok(
  launchPage.includes("Launch a vault") && launchPage.includes("setLaunching(true)"),
  "the launch flow must be reachable via the Launch a vault CTA",
);
assert.ok(
  launchPage.includes("{!launching && !isEmpty && (")
    && /\{launching \? \(\s*<SealedLaunch/.test(launchPage)
    && launchPage.includes("onCancel={() => setLaunching(false)}"),
  "the header CTA must hide while the launch flow (which carries its own primary) or the " +
    "empty state (which carries its own) is showing — never two primaries at once",
);
assert.ok(
  launchPage.includes("aria-pressed={active}") && launchPage.includes('setMineOnly(key === "mine")'),
  "All / Mine must be an aria-pressed filter, not a tab strip",
);
assert.ok(
  !launchPage.includes("<Tabs.Trigger") && !launchPage.includes('from "frosted-ui"'),
  "the launchpad nav must use the plain underline tab bar, not frosted-ui Tabs",
);
assert.equal(packageJson.scripts?.["test:transpiler"], "tsx scripts/transpiler-honesty-selftest.ts");

// ── Portfolio mode: the wiring that decides which contract a vault runs on ──
//
// Every check here guards a failure that is silent rather than loud: a vault created on one
// module and ticked as the other, or an allowlist whose order stops matching the on-chain
// indices that address it.
{
  const sealedVaults = readFileSync("lib/sealed-vaults.ts", "utf8");
  const portfolioTick = readFileSync("lib/portfolio-tick.ts", "utf8");
  const payloadRoute = readFileSync("app/api/sealed/payload/route.ts", "utf8");
  const cron = readFileSync("app/api/cron/sealed-tick/route.ts", "utf8");
  const launchUi = readFileSync("components/sealed/SealedLaunch.tsx", "utf8");
  const registry = readFileSync("app/api/sealed/vaults/route.ts", "utf8");
  const backtestRoute = readFileSync("app/api/sealed/backtest/route.ts", "utf8");

  // Every market must carry its OWN engine params. APT is 10^5 size precision against BTC's
  // 10^9 on testnet — one shared set of constants would mis-size three markets out of four.
  for (const m of SEALED_MARKETS_BY_NETWORK.testnet) {
    assert.ok(m.pythAsset, `${m.name} has no Pyth feed — launch equivalence and backtests are unavailable`);
    assert.ok(
      Object.hasOwn(PYTH_FEED_IDS, m.pythAsset),
      `${m.name} names a Pyth asset that does not exist: ${m.pythAsset}`,
    );
  }
  for (const net of ["testnet", "mainnet"] as const) {
    const names = SEALED_MARKETS_BY_NETWORK[net].map((m) => m.name);
    assert.equal(new Set(names).size, names.length, `${net} market table has a duplicate`);
    for (const m of SEALED_MARKETS_BY_NETWORK[net]) {
      for (const k of ["sizeDecimalsPow", "lotSize", "minSize", "tickerSize"] as const) {
        assert.ok(/^\d+$/.test(m[k]) && BigInt(m[k]) > 0n, `${net} ${m.name}.${k} must be a positive integer string`);
      }
    }
  }
  // The two networks must not share a market address — that would mean one of the tables was
  // copied from the other, which is how the stale testnet BTC entry happened before.
  const testnetAddrs = new Set(SEALED_MARKETS_BY_NETWORK.testnet.map((m) => m.addr));
  for (const m of SEALED_MARKETS_BY_NETWORK.mainnet) {
    assert.ok(!testnetAddrs.has(m.addr), `${m.name} has the same address on both networks`);
  }

  assert.ok(
    sealedVaults.includes("buildCreatePortfolioVaultPayload"),
    "the portfolio create payload builder is missing",
  );
  assert.ok(
    payloadRoute.includes('kind === "create-portfolio"'),
    "the payload route has no portfolio branch",
  );
  // The aggregate cap is the field that actually bounds depositor loss; a missing bound check
  // here surfaces as a Move abort AFTER the creator has paid for the Decibel vault.
  for (const bound of [
    "maxPortfolioLeverageX100 must be 100..1000",
    "maxPositions must be 1..8",
    "maxHoldBars must be 1..14400",
    "maxAdverseFundingBps must be 1..10000",
  ]) {
    assert.ok(payloadRoute.includes(bound), `payload route is missing the bound check: ${bound}`);
  }
  assert.ok(
    payloadRoute.includes("listed twice"),
    "the payload route must reject a duplicated market — two indices addressing one book is the pyramiding path",
  );

  // Kind must be DERIVED from the allowlist, never trusted from the request body: a record
  // claiming "portfolio" with one market sends the cron down a path the module does not have.
  assert.ok(
    /const vaultKind = allowlist\.length > 1 \? "portfolio" : "single"/.test(registry),
    "vaultKind must be derived from the allowlist length, not read from the body",
  );
  assert.ok(
    registry.includes("unknown market in allowlist"),
    "the registry must reject an unknown market rather than dropping it — dropping shifts every later index",
  );

  // The cron routes on the stored kind. Routing on market count would tick a one-market
  // portfolio vault through the single-market module.
  assert.ok(
    /row\.vaultKind === "portfolio"/.test(cron),
    "the cron must route on vaultKind, not on how many markets are stored",
  );
  assert.ok(
    cron.includes("performPortfolioTick"),
    "the cron never calls the portfolio tick path",
  );
  assert.ok(
    portfolioTick.includes("::portfolio_vault::get_trace") &&
      portfolioTick.includes("::portfolio_vault::get_markets") &&
      portfolioTick.includes("stablePositions.fingerprint !== positions.fingerprint") &&
      !portfolioTick.includes("fetchPythCandles") &&
      !portfolioTick.includes('return "0x1"') &&
      portfolioTick.includes('stage: "state-changed"') &&
      portfolioTick.includes("market.idx !== index"),
    "the portfolio attestor must verify exact on-chain allowlist addresses, replay the frozen " +
    "contract trace by index, and refuse context or position changes instead of signing stale state",
  );
  assert.ok(
    portfolioTick.includes("assertAutomatedVaultBuilderCompatible") &&
      portfolioTick.includes('stage: "builder-preflight"') &&
      portfolioTick.indexOf("assertAutomatedVaultBuilderCompatible({") <
        portfolioTick.indexOf("signPortfolioAttestation(new Ed25519PrivateKey"),
    "a directional portfolio tick must prove builder compatibility before it signs",
  );

  // Selecting a second market is what switches modules; the UI must send the matching kind.
  assert.ok(
    launchUi.includes('kind: "create-portfolio"'),
    "the launch UI cannot create a portfolio vault",
  );
  assert.ok(
    /const isPortfolio = markets\.length > 1/.test(launchUi),
    "portfolio mode must be derived from the market selection",
  );
  // The last market cannot be deselected — an empty selection is unlaunchable, and failing at
  // the signature instead of at the click is the worse of the two.
  assert.ok(
    /if \(markets\.length === 1\) return;/.test(launchUi)
      && /const cannotRemove = approved && selectedIds\.length === 1/.test(marketPermissionsUi),
    "the market picker must refuse to deselect the last market",
  );

  // Capital SPLIT across markets, not replicated. Replicating would report the returns of N
  // vaults as if they were one — an N-fold overstatement dressed as diversification.
  assert.ok(
    /const perMarket = initialCapital \/ assets\.length/.test(backtestRoute),
    "the multi-market backtest must split capital, not replicate it",
  );
  assert.ok(
    backtestRoute.includes("unavailable"),
    "markets that could not be simulated must be named, not silently dropped",
  );
}
console.log("portfolio mode: market table, payload bounds, kind routing and backtest split all hold");

console.log("app reliability self-test: passed");
