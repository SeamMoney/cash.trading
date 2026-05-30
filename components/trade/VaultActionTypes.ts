export type VaultActionMode = "create" | "deposit" | "delegate" | "status";

export type VaultIndicatorInfo = {
  id?: string | number;
  name: string;
  symbol?: string;
  description?: string;
};

export type VaultActionResult = {
  mode: VaultActionMode;
  hash?: string;
  payload?: unknown;
  response?: unknown;
};

export type SignAndSubmitTransaction = (payload: unknown) => Promise<{
  hash?: string;
}>;
