"use client";

export const DECIBEL_TRADE_CONFIRMED_EVENT = "cash:decibel-trade-confirmed";

export interface DecibelTradeConfirmedDetail {
  marketAddress?: string;
  marketName: string;
  price: number;
  size: number;
  side: "buy" | "sell";
  timestamp: number;
  txRef: string;
}

export function emitDecibelTradeConfirmed(detail: DecibelTradeConfirmedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DECIBEL_TRADE_CONFIRMED_EVENT, { detail }));
}

export function onDecibelTradeConfirmed(
  callback: (detail: DecibelTradeConfirmedDetail) => void,
) {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    callback((event as CustomEvent<DecibelTradeConfirmedDetail>).detail);
  };
  window.addEventListener(DECIBEL_TRADE_CONFIRMED_EVENT, handler);
  return () => window.removeEventListener(DECIBEL_TRADE_CONFIRMED_EVENT, handler);
}
