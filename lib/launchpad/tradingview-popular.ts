/**
 * Public metadata exposed by TradingView's popular scripts page.
 *
 * This deliberately contains links and presentation metadata only. Pine source is fetched
 * through the existing single-script importer after a user opens a script. That keeps the
 * popular feed light and preserves the author's attribution beside every preview.
 */
export interface TradingViewPopularScript {
  id: string;
  title: string;
  description: string;
  url: string;
  imageUrl: string | null;
  author: string;
  authorUrl: string | null;
  publishedAt: string | null;
  scriptType: "Indicator" | "Strategy" | "Library" | "Script";
  comments: number;
  boosts: number;
}

const MAX_ITEMS = 30;
const MAX_DESCRIPTION_CHARS = 420;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x2014;/g, "—")
    .replace(/&#x2013;/g, "–")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

function plainText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function safeTradingViewUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, "https://www.tradingview.com");
    if (url.protocol !== "https:" || !["www.tradingview.com", "tradingview.com"].includes(url.hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function safePreviewUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(decodeEntities(raw));
    if (url.protocol !== "https:" || url.hostname !== "s3.tradingview.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function integerFromAria(article: string, label: string): number {
  const match = article.match(new RegExp(`aria-label=["']([0-9,]+)\\s+${label}s?["']`, "i"));
  return match ? Number(match[1].replace(/,/g, "")) : 0;
}

/** Parse the server-rendered cards without evaluating any TradingView JavaScript. */
export function parseTradingViewPopularPage(html: string): TradingViewPopularScript[] {
  const articles = html.match(/<article\b[\s\S]*?<\/article>/gi) ?? [];
  const items: TradingViewPopularScript[] = [];

  for (const article of articles.slice(0, MAX_ITEMS)) {
    const titleMatch = article.match(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*data-qa-id=["']ui-lib-card-link-title["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!titleMatch) continue;

    const url = safeTradingViewUrl(titleMatch[1]);
    if (!url || !new URL(url).pathname.startsWith("/script/")) continue;
    const pathParts = new URL(url).pathname.split("/").filter(Boolean);
    const id = pathParts[1] ?? "";
    if (!/^[A-Za-z0-9_-]{4,180}$/.test(id)) continue;

    const descriptionMatch = article.match(
      /data-qa-id=["']ui-lib-card-link-paragraph["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    const authorMatch = article.match(
      /data-qa-id=["']ui-lib-card-link-author["'][\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<span\b[^>]*>([\s\S]*?)<\/span>/i,
    );
    const publishedMatch = article.match(/<time\b[^>]*dateTime=["']([^"']+)["']/i);
    const typeMatch = article.match(
      /corner-top-right[^>]*>[\s\S]*?<span\b[^>]*class=["'][^"']*content-[^"']*["'][^>]*>([^<]+)<\/span>/i,
    );
    const imageMatch = article.match(/<source\b[^>]*srcSet=["']([^"']+)["'][^>]*type=["']image\/webp["']/i)
      ?? article.match(/<img\b[^>]*src=["']([^"']+)["']/i);

    const rawType = plainText(typeMatch?.[1] ?? "Script");
    const scriptType: TradingViewPopularScript["scriptType"] =
      rawType === "Indicator" || rawType === "Strategy" || rawType === "Library"
        ? rawType
        : "Script";
    const description = plainText(descriptionMatch?.[1] ?? "");
    const author = plainText(authorMatch?.[2] ?? "").replace(/^by\s+/i, "") || "TradingView author";

    items.push({
      id,
      title: plainText(titleMatch[2]),
      description: description.length > MAX_DESCRIPTION_CHARS
        ? `${description.slice(0, MAX_DESCRIPTION_CHARS).trimEnd()}…`
        : description,
      url,
      imageUrl: safePreviewUrl(imageMatch?.[1]),
      author,
      authorUrl: safeTradingViewUrl(authorMatch?.[1]),
      publishedAt: publishedMatch?.[1] ?? null,
      scriptType,
      comments: integerFromAria(article, "comment"),
      boosts: integerFromAria(article, "boost"),
    });
  }

  return items;
}

