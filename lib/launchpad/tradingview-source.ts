export type TradingViewSourceIntegrity = "full" | "extracted";

export type TradingViewSourceProvider =
  | "pine-facade"
  | "next-data"
  | "embedded-json"
  | "preformatted-html"
  | "code-html";

export interface TradingViewSourceMeta {
  integrity: TradingViewSourceIntegrity;
  provider: TradingViewSourceProvider;
  lineCount: number;
  characterCount: number;
  publicId?: string;
}

export interface TradingViewSourceResponse {
  source: string;
  title: string;
  sourceMeta: TradingViewSourceMeta;
}

export function getPineSourceStats(source: string) {
  return {
    lineCount: source ? source.replace(/\n$/, "").split("\n").length : 0,
    characterCount: source.length,
  };
}
