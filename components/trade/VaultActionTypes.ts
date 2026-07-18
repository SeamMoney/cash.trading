export type VaultActionMode = "create" | "deposit" | "withdraw" | "delegate" | "status";

export type VaultIndicatorInfo = {
  id?: string | number;
  name: string;
  symbol?: string;
  description?: string;
  assets?: string[];
  /** Which Aptos network the strategy's vault lives on — shown so depositors
   *  aren't misled when a live strategy is testnet-only. */
  network?: "testnet" | "mainnet";
};

export type VaultActionResult = {
  mode: VaultActionMode;
  hash?: string;
  vaultAddress?: string;
  payload?: unknown;
  response?: unknown;
  extractResponse?: unknown;
};

export type SignAndSubmitTransaction = (payload: unknown) => Promise<{
  hash?: string;
}>;
