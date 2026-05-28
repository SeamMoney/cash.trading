export type TradeSide = "long" | "short";

export function getEstimatedLiquidationPrice(
  entryPrice: number,
  side: TradeSide,
  leverage: number,
) {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;

  const distance = entryPrice / leverage;
  return side === "long"
    ? Math.max(0, entryPrice - distance)
    : entryPrice + distance;
}

export function getPositionPnl({
  collateral,
  leverage,
  entryPrice,
  currentPrice,
  side,
}: {
  collateral: number;
  leverage: number;
  entryPrice: number;
  currentPrice: number;
  side: TradeSide;
}) {
  if (
    !Number.isFinite(collateral) ||
    !Number.isFinite(leverage) ||
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(currentPrice) ||
    collateral <= 0 ||
    leverage <= 0 ||
    entryPrice <= 0 ||
    currentPrice <= 0
  ) {
    return 0;
  }

  return (
    collateral *
    leverage *
    (side === "long"
      ? (currentPrice - entryPrice) / entryPrice
      : (entryPrice - currentPrice) / entryPrice)
  );
}

export function isPositionLiquidated({
  currentPrice,
  liquidationPrice,
  side,
}: {
  currentPrice: number;
  liquidationPrice: number;
  side: TradeSide;
}) {
  if (
    !Number.isFinite(currentPrice) ||
    !Number.isFinite(liquidationPrice) ||
    currentPrice <= 0 ||
    liquidationPrice <= 0
  ) {
    return false;
  }

  return side === "long"
    ? currentPrice <= liquidationPrice
    : currentPrice >= liquidationPrice;
}
