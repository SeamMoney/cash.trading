"use client";

export type CollateralToken = "USDC" | "USDT";

export const COLLATERAL_TOKENS: { symbol: CollateralToken; name: string }[] = [
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "USDT", name: "Tether" },
];

const TOKEN_LOGOS: Record<CollateralToken, string> = {
  USDC: "/tokens/usdc.png",
  USDT: "/tokens/usdt.png",
};

export function TokenLogo({
  token,
  size = 24,
}: {
  token: CollateralToken;
  size?: number;
}) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={TOKEN_LOGOS[token]}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full object-contain"
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    />
  );
}
