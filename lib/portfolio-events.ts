"use client";

export const PORTFOLIO_ACTIVITY_EVENT = "cash:portfolio-activity";

export interface PortfolioActivityDetail {
  amount: number;
  hash?: string;
  market?: string;
  type: string;
}

export function dispatchPortfolioActivity(detail: PortfolioActivityDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PORTFOLIO_ACTIVITY_EVENT, { detail }));
}

// ── Yield sync: vault tells the sheet what deposit/APY to track ──
export const YIELD_SYNC_EVENT = "cash:yield-sync";
export interface YieldSyncDetail {
  depositAmount: number;
  apy: number;
  startTime: number;
}
export function dispatchYieldSync(detail: YieldSyncDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(YIELD_SYNC_EVENT, { detail }));
}

// ── Yield claim: vault tells the sheet to bump balance and reset counter ──
export const YIELD_CLAIM_EVENT = "cash:yield-claim";
export interface YieldClaimDetail {
  claimed: number;
}
export function dispatchYieldClaim(detail: YieldClaimDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(YIELD_CLAIM_EVENT, { detail }));
}

// ── Balance update: adjusts the portfolio sheet balance (e.g. realized PnL) ──
export const BALANCE_UPDATE_EVENT = "cash:balance-update";
export interface BalanceUpdateDetail {
  delta: number;
}
export function dispatchBalanceUpdate(detail: BalanceUpdateDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BALANCE_UPDATE_EVENT, { detail }));
}
