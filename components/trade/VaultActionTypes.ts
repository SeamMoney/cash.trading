export type VaultActionMode = "create" | "deposit" | "delegate" | "status";

export type VaultIndicatorInfo = {
  id?: string | number;
  name: string;
  symbol?: string;
  description?: string;
  assets?: string[];
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
