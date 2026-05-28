const isTestnet = process.env.NEXT_PUBLIC_APTOS_NETWORK !== "mainnet";

// Network-aware Fungible Asset addresses
export const TOKENS = {
  USDT: {
    name: "Tether USD",
    symbol: "USDT",
    decimals: 6,
    faAddress: isTestnet
      ? "0xd5d0d561493ea2b9410f67da804653ae44e793c2423707d4f11edb2e38192050"
      : "0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b",
  },
  USDC: {
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    faAddress: isTestnet
      ? "0x69091fbab5f7d635ee7ac5098cf0c1efbe31d68fec0f2cd565e8d168daf52832"
      : "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b",
  },
  APT: {
    name: "Aptos Coin",
    symbol: "APT",
    decimals: 8,
    faAddress: "0xa",
  },
} as const;

export type TokenSymbol = keyof typeof TOKENS;

export function formatTokenAmount(
  amount: bigint | number,
  decimals: number
): string {
  const num = Number(amount) / 10 ** decimals;
  if (num < 0.01 && num > 0) return num.toFixed(6);
  if (num < 1) return num.toFixed(4);
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseTokenAmount(amount: string, decimals: number): bigint {
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole + frac);
}
