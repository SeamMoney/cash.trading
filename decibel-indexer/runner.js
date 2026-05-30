import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  DecibelReadDex,
  MAINNET_CONFIG,
  TESTNET_CONFIG,
} from "@decibeltrade/sdk";

const prisma = new PrismaClient();

const network =
  process.env.DECIBEL_INDEXER_NETWORK ||
  process.env.DECIBEL_NETWORK ||
  process.env.NEXT_PUBLIC_DECIBEL_NETWORK ||
  "testnet";
const enabled = process.env.DECIBEL_INDEXER_ENABLED !== "false";
const runOnce = process.env.DECIBEL_INDEXER_RUN_ONCE === "true";
const backfillIntervalMs = Number(process.env.DECIBEL_INDEXER_BACKFILL_INTERVAL_MS || 30_000);
const accountRefreshMs = Number(process.env.DECIBEL_INDEXER_ACCOUNT_REFRESH_MS || 3_000);
const instanceId = process.env.DECIBEL_INDEXER_INSTANCE_ID || `local-${process.pid}`;

function cleanApiKey(value) {
  return value?.replace(/\\n/g, "").replace(/\n/g, "").trim() || undefined;
}

function getApiKey() {
  if (network === "mainnet") {
    return cleanApiKey(
      process.env.APTOS_API_KEY_MAINNET ||
        process.env.APTOS_NODE_API_KEY_MAINNET ||
        process.env.GEOMI_API_KEY_MAINNET ||
        process.env.APTOS_API_KEY ||
        process.env.APTOS_NODE_API_KEY ||
        process.env.GEOMI_API_KEY
    );
  }
  return cleanApiKey(
    process.env.APTOS_API_KEY_TESTNET ||
      process.env.APTOS_NODE_API_KEY_TESTNET ||
      process.env.GEOMI_API_KEY_TESTNET ||
      process.env.APTOS_API_KEY ||
      process.env.APTOS_NODE_API_KEY ||
      process.env.GEOMI_API_KEY
  );
}

const dex = new DecibelReadDex(network === "mainnet" ? MAINNET_CONFIG : TESTNET_CONFIG, {
  nodeApiKey: getApiKey(),
  onWsError: (error) => console.error("[decibel-indexer] ws error", error),
});

function safeJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_, current) =>
      typeof current === "bigint" ? current.toString() : current
    )
  );
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value) {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.length > 0 ? s : null;
}

function bigint(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function pick(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  }
  return null;
}

function marketNameForSubscription(name) {
  return String(name || "").replace("/", "-");
}

async function checkpoint(source, data = {}) {
  await prisma.decibelIndexerCheckpoint.upsert({
    where: { network_source: { network, source } },
    update: {
      status: data.status || "ok",
      error: data.error || null,
      lastTransactionVersion: data.lastTransactionVersion ?? undefined,
      lastEventIndex: data.lastEventIndex ?? undefined,
      lastUnixMs: data.lastUnixMs ?? BigInt(Date.now()),
    },
    create: {
      network,
      source,
      status: data.status || "ok",
      error: data.error || null,
      lastTransactionVersion: data.lastTransactionVersion ?? null,
      lastEventIndex: data.lastEventIndex ?? null,
      lastUnixMs: data.lastUnixMs ?? BigInt(Date.now()),
    },
  });
}

async function recordError(source, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[decibel-indexer] ${source}:`, message);
  await checkpoint(source, { status: "error", error: message });
}

async function indexMarkets() {
  const markets = await dex.markets.getAll();
  for (const market of markets) {
    const marketAddress = str(pick(market, ["market_addr", "market", "marketAddress", "address"]));
    const marketName = str(pick(market, ["market_name", "name", "symbol"])) || marketAddress;
    if (!marketAddress || !marketName) continue;

    await prisma.decibelMarket.upsert({
      where: { network_marketAddress: { network, marketAddress } },
      update: {
        marketName,
        tickSize: num(pick(market, ["tick_size", "tickSize"])),
        lotSize: num(pick(market, ["lot_size", "lotSize"])),
        maxLeverage: num(pick(market, ["max_leverage", "maxLeverage"])),
        sizeDecimals: num(pick(market, ["sz_decimals", "sizeDecimals"])),
        priceDecimals: num(pick(market, ["px_decimals", "priceDecimals"])),
        mode: str(pick(market, ["mode", "market_mode"])),
      },
      create: {
        network,
        marketAddress,
        marketName,
        tickSize: num(pick(market, ["tick_size", "tickSize"])),
        lotSize: num(pick(market, ["lot_size", "lotSize"])),
        maxLeverage: num(pick(market, ["max_leverage", "maxLeverage"])),
        sizeDecimals: num(pick(market, ["sz_decimals", "sizeDecimals"])),
        priceDecimals: num(pick(market, ["px_decimals", "priceDecimals"])),
        mode: str(pick(market, ["mode", "market_mode"])),
      },
    });
  }
  await checkpoint("markets", { lastUnixMs: BigInt(Date.now()) });
  return markets;
}

async function indexMarketPrices() {
  const prices = await dex.marketPrices.getAll();
  for (const price of prices) {
    const marketAddress = str(pick(price, ["market", "market_addr", "marketAddress"]));
    if (!marketAddress) continue;
    const market = await prisma.decibelMarket.findUnique({
      where: { network_marketAddress: { network, marketAddress } },
      select: { marketName: true },
    });

    await prisma.decibelMarketPrice.upsert({
      where: { network_marketAddress: { network, marketAddress } },
      update: {
        marketName: market?.marketName || str(pick(price, ["market_name", "name"])),
        markPrice: num(pick(price, ["mark_px", "markPrice"])),
        midPrice: num(pick(price, ["mid_px", "midPrice"])),
        oraclePrice: num(pick(price, ["oracle_px", "oraclePrice"])),
        fundingRateBps: num(pick(price, ["funding_rate_bps", "fundingRateBps"])),
        isFundingPositive: pick(price, ["is_funding_positive", "isFundingPositive"]),
        openInterest: num(pick(price, ["open_interest", "openInterest"])),
        transactionUnixMs: bigint(pick(price, ["transaction_unix_ms", "unix_ms", "timestamp"])),
      },
      create: {
        network,
        marketAddress,
        marketName: market?.marketName || str(pick(price, ["market_name", "name"])),
        markPrice: num(pick(price, ["mark_px", "markPrice"])),
        midPrice: num(pick(price, ["mid_px", "midPrice"])),
        oraclePrice: num(pick(price, ["oracle_px", "oraclePrice"])),
        fundingRateBps: num(pick(price, ["funding_rate_bps", "fundingRateBps"])),
        isFundingPositive: pick(price, ["is_funding_positive", "isFundingPositive"]),
        openInterest: num(pick(price, ["open_interest", "openInterest"])),
        transactionUnixMs: bigint(pick(price, ["transaction_unix_ms", "unix_ms", "timestamp"])),
      },
    });
  }
  await checkpoint("market-prices", { lastUnixMs: BigInt(Date.now()) });
}

async function indexMarketTrades(markets) {
  const requested = (process.env.DECIBEL_INDEXER_MARKETS || "ALL")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const shouldIndex = (name) =>
    requested.includes("ALL") ||
    requested.includes(name) ||
    requested.includes(marketNameForSubscription(name));

  for (const market of markets) {
    const marketAddress = str(pick(market, ["market_addr", "market", "marketAddress", "address"]));
    const marketName = str(pick(market, ["market_name", "name", "symbol"]));
    if (!marketAddress || !marketName || !shouldIndex(marketName)) continue;

    try {
      const trades = await dex.marketTrades.getByName(marketNameForSubscription(marketName), 50);
      const items = Array.isArray(trades?.items) ? trades.items : Array.isArray(trades) ? trades : [];
      for (const trade of items) {
        const tradeId = str(pick(trade, ["trade_id", "tradeId", "id"]));
        const version = bigint(pick(trade, ["transaction_version", "version"]));
        const timestamp = bigint(pick(trade, ["transaction_unix_ms", "unix_ms", "timestamp"]));
        const eventKey = tradeId || `${marketAddress}:${version || timestamp || Date.now()}:${str(pick(trade, ["order_id", "orderId"])) || ""}`;
        await prisma.decibelMarketTrade.upsert({
          where: { network_eventKey: { network, eventKey } },
          update: {},
          create: {
            network,
            eventKey,
            marketAddress,
            marketName,
            account: str(pick(trade, ["account", "subaccount", "sub_addr"])),
            side: str(pick(trade, ["side", "direction", "action"])),
            size: num(pick(trade, ["size", "sz", "fill_size"])),
            price: num(pick(trade, ["price", "px", "fill_price"])),
            pnl: num(pick(trade, ["pnl", "realized_pnl"])),
            funding: num(pick(trade, ["funding", "funding_payment"])),
            fee: num(pick(trade, ["fee", "fees"])),
            orderId: str(pick(trade, ["order_id", "orderId"])),
            tradeId,
            transactionVersion: version,
            transactionUnixMs: timestamp,
            raw: safeJson(trade),
          },
        });
      }
    } catch (error) {
      await recordError(`market-trades:${marketName}`, error);
    }
  }
  await checkpoint("market-trades", { lastUnixMs: BigInt(Date.now()) });
}

async function watchedSubaccounts() {
  const [bots, vaults, watched] = await Promise.all([
    prisma.botInstance.findMany({
      where: { userSubaccount: { not: "" } },
      select: { userSubaccount: true, userWalletAddress: true },
    }),
    prisma.strategyVault.findMany({
      where: { decibelSubaccount: { not: null } },
      select: { decibelSubaccount: true, ownerWallet: true },
    }),
    prisma.decibelWatchedSubaccount.findMany({
      where: { network, enabled: true },
      select: { subaccount: true, ownerWallet: true, source: true },
    }),
  ]);

  const rows = [];
  for (const bot of bots) {
    rows.push({
      subaccount: bot.userSubaccount,
      ownerWallet: bot.userWalletAddress,
      source: "bot-instance",
    });
  }
  for (const vault of vaults) {
    if (!vault.decibelSubaccount) continue;
    rows.push({
      subaccount: vault.decibelSubaccount,
      ownerWallet: vault.ownerWallet,
      source: "strategy-vault",
    });
  }
  for (const row of watched) rows.push(row);
  for (const subaccount of (process.env.DECIBEL_INDEXER_EXTRA_SUBACCOUNTS || "").split(",")) {
    const value = subaccount.trim();
    if (value) rows.push({ subaccount: value, ownerWallet: null, source: "env" });
  }

  const unique = new Map();
  for (const row of rows) {
    if (!row.subaccount) continue;
    unique.set(`${row.subaccount.toLowerCase()}:${row.source}`, row);
  }

  for (const row of unique.values()) {
    await prisma.decibelWatchedSubaccount.upsert({
      where: {
        network_subaccount_source: {
          network,
          subaccount: row.subaccount,
          source: row.source,
        },
      },
      update: { ownerWallet: row.ownerWallet || null, enabled: true },
      create: {
        network,
        subaccount: row.subaccount,
        ownerWallet: row.ownerWallet || null,
        source: row.source,
        enabled: true,
      },
    });
  }

  return [...new Set([...unique.values()].map((row) => row.subaccount))];
}

async function indexAccount(subaccount) {
  const [overview, positions, openOrders, orderHistory] = await Promise.all([
    dex.accountOverview.getByAddr(subaccount, "30d").catch((error) => ({ __error: error })),
    dex.userPositions.getByAddr({ subAddr: subaccount, includeDeleted: false, limit: 100 }).catch((error) => ({ __error: error })),
    dex.userOpenOrders.getByAddr({ subAddr: subaccount, limit: 100 }).catch((error) => ({ __error: error })),
    dex.userOrderHistory.getByAddr({ subAddr: subaccount, limit: 100 }).catch((error) => ({ __error: error })),
  ]);

  if (!overview.__error) {
    await prisma.decibelAccountOverview.upsert({
      where: { network_subaccount: { network, subaccount } },
      update: {
        equity: num(pick(overview, ["equity", "account_equity", "portfolio_value"])),
        unrealizedPnl: num(pick(overview, ["unrealized_pnl", "unrealizedPnl"])),
        realizedPnl: num(pick(overview, ["realized_pnl", "realizedPnl"])),
        marginRatio: num(pick(overview, ["margin_ratio", "marginRatio"])),
        maintenanceMargin: num(pick(overview, ["maintenance_margin", "maintenanceMargin"])),
        leverage: num(pick(overview, ["leverage", "account_leverage"])),
        totalMargin: num(pick(overview, ["total_margin", "totalMargin"])),
        totalNotional: num(pick(overview, ["total_notional", "totalNotional"])),
        collateral: num(pick(overview, ["collateral", "total_collateral"])),
        crossWithdrawable: num(pick(overview, ["cross_withdrawable", "crossWithdrawable", "withdrawable"])),
        volume30d: num(pick(overview, ["volume_30d", "volume30d"])),
        raw: safeJson(overview),
      },
      create: {
        network,
        subaccount,
        equity: num(pick(overview, ["equity", "account_equity", "portfolio_value"])),
        unrealizedPnl: num(pick(overview, ["unrealized_pnl", "unrealizedPnl"])),
        realizedPnl: num(pick(overview, ["realized_pnl", "realizedPnl"])),
        marginRatio: num(pick(overview, ["margin_ratio", "marginRatio"])),
        maintenanceMargin: num(pick(overview, ["maintenance_margin", "maintenanceMargin"])),
        leverage: num(pick(overview, ["leverage", "account_leverage"])),
        totalMargin: num(pick(overview, ["total_margin", "totalMargin"])),
        totalNotional: num(pick(overview, ["total_notional", "totalNotional"])),
        collateral: num(pick(overview, ["collateral", "total_collateral"])),
        crossWithdrawable: num(pick(overview, ["cross_withdrawable", "crossWithdrawable", "withdrawable"])),
        volume30d: num(pick(overview, ["volume_30d", "volume30d"])),
        raw: safeJson(overview),
      },
    });
  } else {
    await recordError(`account-overview:${subaccount}`, overview.__error);
  }

  if (!positions.__error) {
    const items = Array.isArray(positions?.items) ? positions.items : Array.isArray(positions) ? positions : [];
    for (const position of items) {
      const marketAddress = str(pick(position, ["market", "market_addr", "marketAddress"]));
      const marketName = str(pick(position, ["market_name", "marketName", "name"]));
      const isLong = Boolean(pick(position, ["is_long", "isLong"]));
      const marketKey = marketAddress || marketName || `${isLong ? "L" : "S"}:${str(pick(position, ["id", "position_id"])) || "unknown"}`;
      await prisma.decibelPosition.upsert({
        where: { network_subaccount_marketKey: { network, subaccount, marketKey } },
        update: {
          marketAddress,
          marketName,
          isLong,
          size: num(pick(position, ["size", "sz"])),
          leverage: num(pick(position, ["leverage"])),
          entryPrice: num(pick(position, ["entry_price", "entryPrice"])),
          markPrice: num(pick(position, ["mark_price", "markPrice"])),
          value: num(pick(position, ["value", "notional"])),
          estimatedPnl: num(pick(position, ["estimated_pnl", "estimatedPnl", "pnl"])),
          marginUsed: num(pick(position, ["margin_used", "marginUsed", "margin"])),
          unrealizedFunding: num(pick(position, ["unrealized_funding", "unrealizedFunding", "funding"])),
          estimatedLiquidationPrice: num(pick(position, ["estimated_liquidation_price", "estimatedLiquidationPrice", "liq_price"])),
          tpTriggerPrice: num(pick(position, ["tp_trigger_price", "tpTriggerPrice"])),
          slTriggerPrice: num(pick(position, ["sl_trigger_price", "slTriggerPrice"])),
          transactionVersion: bigint(pick(position, ["transaction_version", "version"])),
          raw: safeJson(position),
        },
        create: {
          network,
          subaccount,
          marketKey,
          marketAddress,
          marketName,
          isLong,
          size: num(pick(position, ["size", "sz"])),
          leverage: num(pick(position, ["leverage"])),
          entryPrice: num(pick(position, ["entry_price", "entryPrice"])),
          markPrice: num(pick(position, ["mark_price", "markPrice"])),
          value: num(pick(position, ["value", "notional"])),
          estimatedPnl: num(pick(position, ["estimated_pnl", "estimatedPnl", "pnl"])),
          marginUsed: num(pick(position, ["margin_used", "marginUsed", "margin"])),
          unrealizedFunding: num(pick(position, ["unrealized_funding", "unrealizedFunding", "funding"])),
          estimatedLiquidationPrice: num(pick(position, ["estimated_liquidation_price", "estimatedLiquidationPrice", "liq_price"])),
          tpTriggerPrice: num(pick(position, ["tp_trigger_price", "tpTriggerPrice"])),
          slTriggerPrice: num(pick(position, ["sl_trigger_price", "slTriggerPrice"])),
          transactionVersion: bigint(pick(position, ["transaction_version", "version"])),
          raw: safeJson(position),
        },
      });
    }
  } else {
    await recordError(`positions:${subaccount}`, positions.__error);
  }

  if (!openOrders.__error) {
    await prisma.decibelOpenOrder.deleteMany({ where: { network, subaccount } });
    const items = Array.isArray(openOrders?.items) ? openOrders.items : Array.isArray(openOrders) ? openOrders : [];
    for (const order of items) {
      const orderId = str(pick(order, ["order_id", "orderId", "id"]));
      if (!orderId) continue;
      await prisma.decibelOpenOrder.create({
        data: {
          network,
          subaccount,
          marketAddress: str(pick(order, ["market", "market_addr", "marketAddress"])),
          marketName: str(pick(order, ["market_name", "marketName"])),
          orderId,
          clientOrderId: str(pick(order, ["client_order_id", "clientOrderId"])),
          side: pick(order, ["is_buy", "isBuy"]) === true ? "Buy" : pick(order, ["is_buy", "isBuy"]) === false ? "Sell" : str(pick(order, ["side"])),
          price: num(pick(order, ["price", "px"])),
          originalSize: num(pick(order, ["orig_size", "origSize", "size"])),
          remainingSize: num(pick(order, ["remaining_size", "remainingSize"])),
          orderType: str(pick(order, ["details", "order_type", "orderType"])),
          status: "Open",
          transactionVersion: bigint(pick(order, ["transaction_version", "version"])),
          timestampUnixMs: bigint(pick(order, ["unix_ms", "timestamp"])),
          raw: safeJson(order),
        },
      });
    }
  } else {
    await recordError(`open-orders:${subaccount}`, openOrders.__error);
  }

  if (!orderHistory.__error) {
    const items = Array.isArray(orderHistory?.items) ? orderHistory.items : Array.isArray(orderHistory) ? orderHistory : [];
    for (const order of items) {
      const orderId = str(pick(order, ["order_id", "orderId", "id"]));
      const version = bigint(pick(order, ["transaction_version", "version"]));
      const timestamp = bigint(pick(order, ["unix_ms", "timestamp", "transaction_unix_ms"]));
      const eventKey = `${subaccount}:${orderId || ""}:${version || timestamp || Date.now()}`;
      await prisma.decibelOrderEvent.upsert({
        where: { network_eventKey: { network, eventKey } },
        update: {},
        create: {
          network,
          eventKey,
          subaccount,
          marketAddress: str(pick(order, ["market", "market_addr", "marketAddress"])),
          marketName: str(pick(order, ["market_name", "marketName"])),
          orderId,
          clientOrderId: str(pick(order, ["client_order_id", "clientOrderId"])),
          side: pick(order, ["is_buy", "isBuy"]) === true ? "Buy" : pick(order, ["is_buy", "isBuy"]) === false ? "Sell" : str(pick(order, ["side"])),
          price: num(pick(order, ["price", "px"])),
          originalSize: num(pick(order, ["orig_size", "origSize", "size"])),
          remainingSize: num(pick(order, ["remaining_size", "remainingSize"])),
          orderType: str(pick(order, ["details", "order_type", "orderType"])),
          status: str(pick(order, ["status", "state"])),
          transactionVersion: version,
          timestampUnixMs: timestamp,
          raw: safeJson(order),
        },
      });
    }
  } else {
    await recordError(`order-history:${subaccount}`, orderHistory.__error);
  }

  await checkpoint(`account:${subaccount}`, { lastUnixMs: BigInt(Date.now()) });
}

async function refreshAccounts() {
  const subaccounts = await watchedSubaccounts();
  await Promise.allSettled(
    subaccounts.map((subaccount) => indexAccount(subaccount))
  );
  await checkpoint("account-watch", { lastUnixMs: BigInt(Date.now()) });
}

async function tickMarkets() {
  const markets = await indexMarkets();
  await indexMarketPrices();
  await indexMarketTrades(markets);
}

async function main() {
  if (!enabled) {
    console.log("[decibel-indexer] disabled by DECIBEL_INDEXER_ENABLED=false");
    return;
  }

  console.log(`[decibel-indexer] starting network=${network} instance=${instanceId}`);
  await checkpoint(`instance:${instanceId}`, { status: "starting", lastUnixMs: BigInt(Date.now()) });

  await tickMarkets().catch((error) => recordError("market-tick", error));
  await refreshAccounts().catch((error) => recordError("account-tick", error));

  if (runOnce) {
    await checkpoint(`instance:${instanceId}`, { status: "once-complete", lastUnixMs: BigInt(Date.now()) });
    await prisma.$disconnect();
    return;
  }

  setInterval(() => {
    tickMarkets().catch((error) => recordError("market-tick", error));
  }, backfillIntervalMs);

  setInterval(() => {
    refreshAccounts().catch((error) => recordError("account-tick", error));
  }, accountRefreshMs);

  await checkpoint(`instance:${instanceId}`, { status: "running", lastUnixMs: BigInt(Date.now()) });
}

process.on("SIGINT", async () => {
  await checkpoint(`instance:${instanceId}`, { status: "stopped", lastUnixMs: BigInt(Date.now()) }).catch(() => {});
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await checkpoint(`instance:${instanceId}`, { status: "stopped", lastUnixMs: BigInt(Date.now()) }).catch(() => {});
  await prisma.$disconnect();
  process.exit(0);
});

main().catch(async (error) => {
  await recordError(`instance:${instanceId}`, error).catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
