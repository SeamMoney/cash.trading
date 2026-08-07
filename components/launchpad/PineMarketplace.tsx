"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CandlestickChart,
  CheckCircle2,
  Code2,
  ExternalLink,
  Loader2,
  MessageSquare,
  Rocket,
  Terminal,
} from "lucide-react";

import { CodeBlock } from "@/components/ui/agent";
import { ResponsiveModalSheet } from "@/components/ui/responsive-modal-sheet";
import {
  PRODUCT_CONTROL_CLASS,
  ProductBadge,
  ProductPanel,
  ProductSegmented,
  ProductSelectorButton,
} from "@/components/ui/product-surface";
import type { TradingViewPopularScript } from "@/lib/launchpad/tradingview-popular";
import type {
  TradingViewSourceMeta,
  TradingViewSourceResponse,
} from "@/lib/launchpad/tradingview-source";
import { cn } from "@/lib/utils";
import { PineVisualPreview } from "./PineVisualPreview";

export interface PineMarketplaceSelection {
  source: string;
  title: string;
  url: string;
  author: string;
}

interface Props {
  activeSelection?: PineMarketplaceSelection | null;
  disabled?: boolean;
  market: string;
  marketControl?: ReactNode;
  onUse: (selection: PineMarketplaceSelection) => void;
  preview?: ReactNode;
}

type DetailTab = "chart" | "source" | "logs";
type Compatibility =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ready"; warnings: string[] }
  | { state: "rejected"; errors: string[] };

interface SourceFeature {
  label: string;
  detail: string;
  blocksVault?: boolean;
}

interface CachedSource {
  source: string;
  sourceMeta: TradingViewSourceMeta | null;
}

function featureReport(source: string): SourceFeature[] {
  const features: SourceFeature[] = [];
  const add = (pattern: RegExp, label: string, detail: string, blocksVault = false) => {
    if (pattern.test(source)) features.push({ label, detail, blocksVault });
  };

  add(/\btype\s+[A-Za-z_]\w*/m, "Custom types", "Persistent Pine objects need a runtime adapter.", true);
  add(/\barray\.(?:new|push|get|set|shift|remove|size)/, "Arrays", "The script keeps mutable collections between bars.", true);
  add(/\b(?:box|table|linefill)\./, "Rich drawings", "Boxes, tables, and fills are visual Pine objects.");
  add(/\b(?:open|high|low|volume)\b/, "OHLCV", "The strategy reads candle fields beyond the close price.", true);
  add(/\brequest\./, "External series", "The script requests another symbol or timeframe.", true);
  add(/\b(?:for|while)\b/, "Loops", "The script evaluates bounded iterative logic.");
  add(/\blog\.(?:info|warning|error)\s*\(/, "Pine logs", "Runtime messages appear in the Logs tab.");
  add(/\balertcondition\s*\(/, "Alerts", "The source declares alert conditions.");
  add(/\bstrategy\.(?:entry|order)\s*\(/, "Trade orders", "The source contains executable strategy orders.");

  return features;
}

function relativeDate(value: string | null): string {
  if (!value) return "Popular now";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Popular now";
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SourceStatus({
  meta,
  loading,
  error,
  compact = false,
}: {
  meta: TradingViewSourceMeta | null;
  loading: boolean;
  error: string | null;
  compact?: boolean;
}) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Fetching source
      </span>
    );
  }
  if (error) {
    return <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-amber-400">Source unavailable</span>;
  }
  if (!meta) return null;

  const full = meta.integrity === "full";
  return (
    <span
      title={full
        ? `Complete public source from TradingView (${meta.publicId ?? "public script"})`
        : `Source extracted from ${meta.provider}; compare it with TradingView before use`}
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em]",
        full ? "text-accent" : "text-amber-300",
      )}
    >
      {full ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <Code2 className="h-3 w-3" aria-hidden />}
      {full ? "Full public source" : "Extracted source"}
      {!compact && <span className="font-normal text-zinc-600">· {meta.lineCount.toLocaleString()} lines</span>}
    </span>
  );
}

function PopularCard({
  item,
  onOpen,
  compact = false,
}: {
  item: TradingViewPopularScript;
  onOpen: () => void;
  compact?: boolean;
}) {
  return (
    <article className={cn(PRODUCT_CONTROL_CLASS, "group min-w-0 transition-colors hover:border-border-strong hover:bg-card-hover")}>
      <button
        type="button"
        onClick={onOpen}
        className="block w-full rounded-[var(--radius-sm)] p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block font-display text-[14px] font-semibold leading-snug text-white group-hover:text-accent">
              {item.title}
            </span>
            <span className="mt-1 block truncate font-mono text-[10px] text-zinc-600">by {item.author}</span>
          </span>
          <ProductBadge>{item.scriptType}</ProductBadge>
        </span>
        <span className={cn("mt-3 block text-[12px] leading-relaxed text-zinc-400", compact ? "line-clamp-2" : "line-clamp-3")}>
          {item.description}
        </span>
        <span className="mt-3 flex min-w-0 items-center gap-4 border-t border-card-border pt-2.5 font-mono text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" aria-hidden />{item.comments}</span>
          <span className="inline-flex items-center gap-1"><Rocket className="h-3 w-3" aria-hidden />{item.boosts.toLocaleString()}</span>
          <span className="ml-auto text-zinc-400 group-hover:text-white">Open →</span>
        </span>
      </button>
    </article>
  );
}

export function PineMarketplace({
  activeSelection,
  disabled,
  market,
  marketControl,
  onUse,
  preview,
}: Props) {
  const [items, setItems] = useState<TradingViewPopularScript[]>([]);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TradingViewPopularScript | null>(null);
  const [tab, setTab] = useState<DetailTab>("chart");
  const [source, setSource] = useState("");
  const [sourceMeta, setSourceMeta] = useState<TradingViewSourceMeta | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);
  const [compatibility, setCompatibility] = useState<Compatibility>({ state: "idle" });
  const sourceCache = useRef(new Map<string, CachedSource>());
  const activeSourceUrl = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingFeed(true);
    fetch("/api/launchpad/tv-popular", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { items?: TradingViewPopularScript[]; error?: string };
        if (!response.ok || !Array.isArray(payload.items)) {
          throw new Error(payload.error ?? "Could not load popular scripts");
        }
        setItems(payload.items);
        setFeedError(null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFeedError(error instanceof Error ? error.message : "Could not load popular scripts");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingFeed(false);
      });
    return () => controller.abort();
  }, []);

  const loadSource = useCallback(async (item: TradingViewPopularScript) => {
    activeSourceUrl.current = item.url;
    setSourceError(null);
    const cached = sourceCache.current.get(item.url);
    if (cached) {
      setSource(cached.source);
      setSourceMeta(cached.sourceMeta);
      setLoadingSource(false);
      return;
    }
    setLoadingSource(true);
    setSource("");
    setSourceMeta(null);
    try {
      const response = await fetch(`/api/launchpad/tv-import?url=${encodeURIComponent(item.url)}`);
      const payload = await response.json() as Partial<TradingViewSourceResponse> & {
        script?: string;
        error?: string;
      };
      const nextSource = payload.source ?? payload.script;
      if (!response.ok || !nextSource) throw new Error(payload.error ?? "Source is unavailable");
      const cachedSource = { source: nextSource, sourceMeta: payload.sourceMeta ?? null };
      sourceCache.current.set(item.url, cachedSource);
      if (activeSourceUrl.current === item.url) {
        setSource(nextSource);
        setSourceMeta(cachedSource.sourceMeta);
      }
    } catch (error) {
      if (activeSourceUrl.current === item.url) {
        setSourceError(error instanceof Error ? error.message : "Source is unavailable");
      }
    } finally {
      if (activeSourceUrl.current === item.url) setLoadingSource(false);
    }
  }, []);

  const openScript = useCallback((item: TradingViewPopularScript) => {
    setSelected(item);
    setTab("chart");
    setCompatibility({ state: "idle" });
    setOpen(true);
    void loadSource(item);
  }, [loadSource]);

  const showGallery = useCallback(() => {
    setSelected(null);
    setTab("chart");
    setOpen(true);
  }, []);

  const features = useMemo(() => featureReport(source), [source]);
  const lineCount = sourceMeta?.lineCount ?? (source ? source.replace(/\n$/, "").split("\n").length : 0);
  const logCalls = source.match(/\blog\.(?:info|warning|error)\s*\(/g)?.length ?? 0;

  const checkCompatibility = useCallback(async () => {
    if (!source) return;
    setCompatibility({ state: "checking" });
    try {
      const response = await fetch("/api/sealed/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pineScript: source, market }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        errors?: string[];
        warnings?: string[];
      };
      if (response.ok && payload.ok) {
        setCompatibility({ state: "ready", warnings: payload.warnings ?? [] });
      } else {
        setCompatibility({
          state: "rejected",
          errors: payload.errors?.length ? payload.errors : [payload.error ?? "Compatibility check failed"],
        });
      }
    } catch (error) {
      setCompatibility({
        state: "rejected",
        errors: [error instanceof Error ? error.message : "Compatibility check failed"],
      });
    }
  }, [market, source]);

  const useSelected = useCallback(() => {
    if (!selected || !source) return;
    setOpen(false);
    // Radix restores the document scroll lock after the dialog closes. Hand the selection
    // back on the next frame so the Launchpad can scroll to the workbench instead of trying
    // while the page is still fixed in place on mobile Safari.
    requestAnimationFrame(() => {
      onUse({ source, title: selected.title, url: selected.url, author: selected.author });
    });
  }, [onUse, selected, source]);

  return (
    <>
      <ProductPanel className="overflow-hidden">
        <div className="flex min-w-0 items-center justify-between gap-2 border-b border-card-border p-2 sm:px-3">
          <ProductSelectorButton
            onClick={showGallery}
            disabled={disabled || items.length === 0}
            aria-label="Browse indicator library"
            className="min-w-0 flex-1 sm:max-w-[520px]"
            icon={(
              <span className="flex size-7 items-center justify-center rounded-[6px] bg-accent/10 text-accent">
                <CandlestickChart className="size-3.5" aria-hidden="true" />
              </span>
            )}
            label="Indicator library"
            value={activeSelection?.title ?? "Choose indicator"}
            detail={activeSelection ? "Loaded" : `${items.length || "Popular"} scripts`}
          />
          {marketControl}
        </div>
        {preview ?? (
          <div className="flex h-[300px] items-center justify-center font-mono text-[11px] text-zinc-600">
            {loadingFeed ? "Loading public scripts…" : feedError ?? "Choose an indicator to preview it"}
          </div>
        )}
      </ProductPanel>

      <ResponsiveModalSheet
        badge={selected?.scriptType ?? "Public scripts"}
        desktopClassName="h-[min(760px,calc(100dvh-2rem))]"
        desktopContentClassName="flex min-h-0 flex-1 overflow-hidden p-0"
        desktopMaxWidthClassName="sm:!max-w-[1040px]"
        mobileContentClassName="overflow-hidden px-0 pb-[env(safe-area-inset-bottom)]"
        onClose={() => setOpen(false)}
        open={open}
        title={selected?.title ?? "Select indicator"}
        description={selected ? `by ${selected.author} · Public Pine script` : "Popular public Pine scripts"}
        titleId="pine-marketplace-title"
      >
          {!selected ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-card-border px-4 py-2.5">
                <span className="font-display text-[12px] font-semibold text-foreground">Popular</span>
                <ProductBadge className="text-accent">Public source</ProductBadge>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {items.map((item) => (
                    <PopularCard compact key={item.id} item={item} onOpen={() => openScript(item)} />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <header className="shrink-0 border-b border-card-border px-3 pt-3 sm:px-4">
                <div className="flex items-center gap-2 pb-2.5">
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    aria-label="Back to popular scripts"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-card-border bg-background-tertiary text-muted-foreground transition-colors hover:border-border-strong hover:bg-card-hover hover:text-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                  </button>
                  <span className="min-w-0 flex-1 truncate font-mono text-[9px] uppercase text-muted-foreground">
                    Public script · {relativeDate(selected.publishedAt)} · {sourceMeta ? `${sourceMeta.lineCount.toLocaleString()} lines` : "Loading source"}
                  </span>
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open this script on TradingView"
                    className={cn(PRODUCT_CONTROL_CLASS, "flex h-9 shrink-0 items-center gap-2 px-2.5 text-[12px] text-foreground-secondary transition-colors hover:border-border-strong hover:bg-card-hover hover:text-foreground sm:px-3")}
                  >
                    <span className="hidden sm:inline">TradingView</span>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-card-border py-2.5">
                  <ProductSegmented role="tablist" aria-label="Script details" className="grid min-w-0 flex-1 grid-cols-3 sm:max-w-[330px]">
                    {([
                      ["chart", "Chart", CandlestickChart],
                      ["source", "Source code", Code2],
                      ["logs", "Logs", Terminal],
                    ] as const).map(([value, label, Icon]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setTab(value)}
                        role="tab"
                        aria-selected={tab === value}
                        className={cn(
                          "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[var(--radius-xs)] px-2 py-2 font-display text-[11px] font-semibold",
                          tab === value ? "bg-card-hover text-foreground" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{label}</span>
                      </button>
                    ))}
                  </ProductSegmented>
                  <div className="hidden items-center gap-2 sm:flex">
                    <button
                      type="button"
                      onClick={checkCompatibility}
                      disabled={!source || compatibility.state === "checking"}
                      className={cn(PRODUCT_CONTROL_CLASS, "h-9 px-3 font-display text-[12px] font-semibold text-foreground-secondary hover:border-border-strong hover:text-foreground disabled:opacity-40")}
                    >
                      {compatibility.state === "checking" ? "Checking…" : "Check vault compatibility"}
                    </button>
                    <button
                      type="button"
                      onClick={useSelected}
                      disabled={!source || loadingSource || disabled}
                      className="h-9 rounded-[var(--radius-sm)] bg-accent px-4 font-display text-[12px] font-semibold text-accent-foreground hover:brightness-95 disabled:cursor-wait disabled:bg-card disabled:text-muted-foreground"
                    >
                      {loadingSource ? "Loading full source…" : "Use in editor"}
                    </button>
                  </div>
                </div>
              </header>

              <div className={cn(
                "min-h-0 flex-1 overscroll-contain",
                tab === "chart" ? "overflow-y-auto p-3 sm:p-4" : "overflow-hidden p-3 sm:p-4",
              )}>
                {tab === "chart" && (
                  <div role="tabpanel" className="mx-auto flex min-h-full w-full flex-col gap-3">
                    <section className="overflow-hidden rounded-[var(--radius)] border border-card-border bg-background">
                      <div className="w-full bg-black">
                        {source ? (
                          <PineVisualPreview asset={market} embedded pineScript={source} title={selected.title} />
                        ) : (
                          <div className="flex h-[300px] items-center justify-center gap-2 font-mono text-[11px] text-zinc-600 sm:h-[480px]">
                            {loadingSource && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                            {sourceError ?? "Loading full Pine source…"}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-card-border bg-background-secondary px-3 py-2.5 sm:px-4">
                        <SourceStatus meta={sourceMeta} loading={loadingSource} error={sourceError} />
                        <button
                          type="button"
                          onClick={() => setTab("source")}
                          disabled={!source}
                          className="font-mono text-[10px] text-zinc-400 hover:text-white disabled:opacity-40"
                        >
                          View source →
                        </button>
                      </div>
                    </section>

                    <section className="grid gap-4 border-t border-card-border pb-3 pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.42fr)]">
                      <div className="min-w-0">
                        <ProductBadge>{selected.scriptType}</ProductBadge>
                        <p className="mt-3 max-w-4xl text-[13px] leading-relaxed text-zinc-300 sm:text-[14px]">{selected.description}</p>
                      </div>
                      <aside className="min-w-0 lg:border-l lg:border-card-border lg:pl-5">
                        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 font-mono text-[10px]">
                          <div>
                            <dt className="uppercase tracking-[0.12em] text-zinc-600">Author</dt>
                            <dd className="mt-1 truncate text-zinc-300">{selected.author}</dd>
                          </div>
                          <div>
                            <dt className="uppercase tracking-[0.12em] text-zinc-600">Source</dt>
                            <dd className="mt-1 text-zinc-300">{lineCount ? `${lineCount.toLocaleString()} lines` : "Loading"}</dd>
                          </div>
                        </dl>
                        {features.length > 0 && (
                          <div className="mt-4 border-t border-card-border pt-3">
                            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">Detected features</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {features.map((feature) => (
                                <ProductBadge key={feature.label}>{feature.label}</ProductBadge>
                              ))}
                            </div>
                          </div>
                        )}
                      </aside>
                    </section>
                  </div>
                )}

                {tab === "source" && (
                  <div role="tabpanel" className="mx-auto h-full min-h-0 w-full max-w-[1480px]">
                    {loadingSource ? (
                      <div className="flex h-full min-h-[280px] items-center justify-center gap-2 text-zinc-500">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        <span className="font-mono text-[11px]">Loading public Pine source…</span>
                      </div>
                    ) : sourceError ? (
                      <div className="rounded-[var(--radius-sm)] border border-amber-500/20 bg-amber-500/[0.06] p-4 text-[13px] leading-relaxed text-amber-200/80">{sourceError}</div>
                    ) : (
                      <div className="flex h-full min-h-0 flex-col gap-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                          <SourceStatus meta={sourceMeta} loading={false} error={null} />
                          <span className="font-mono text-[9px] text-zinc-600">
                            {sourceMeta ? `${sourceMeta.characterCount.toLocaleString()} characters` : `${lineCount.toLocaleString()} lines`}
                          </span>
                        </div>
                        <CodeBlock
                          code={source}
                          filename={`${selected.id}.pine`}
                          maxHeight="calc(100dvh - 300px)"
                          actions={<span className="mr-1 font-mono text-[9px] text-zinc-600">{lineCount.toLocaleString()} lines</span>}
                        />
                      </div>
                    )}
                  </div>
                )}

                {tab === "logs" && (
                  <div role="tabpanel" className="mx-auto flex h-full w-full flex-col overflow-hidden rounded-[var(--radius)] border border-card-border bg-background-secondary">
                    <div className="flex items-center justify-between border-b border-card-border px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Terminal className="h-4 w-4 text-zinc-500" aria-hidden />
                        <span className="font-display text-[13px] font-semibold text-white">Pine logs and compatibility</span>
                      </div>
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-600">{market}</span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 font-mono text-[11px] leading-relaxed">
                      <LogRow level="info" label="marketplace" text={`Loaded ${selected.title} by ${selected.author}.`} />
                      {source ? (
                        <LogRow
                          level={sourceMeta?.integrity === "full" ? "success" : "warning"}
                          label="source"
                          text={sourceMeta?.integrity === "full"
                            ? `Verified ${lineCount.toLocaleString()} lines of complete public Pine source from TradingView.`
                            : `Extracted ${lineCount.toLocaleString()} lines from page markup; compare with TradingView before using it.`}
                        />
                      ) : loadingSource ? (
                        <LogRow level="info" label="source" text="Fetching public source…" />
                      ) : (
                        <LogRow level="error" label="source" text={sourceError ?? "Source is unavailable."} />
                      )}
                      {features.map((feature) => (
                        <LogRow
                          key={feature.label}
                          level={feature.blocksVault ? "warning" : "info"}
                          label="detect"
                          text={`${feature.label}: ${feature.detail}`}
                        />
                      ))}
                      {logCalls > 0 && <LogRow level="info" label="runtime" text={`${logCalls} Pine log call${logCalls === 1 ? "" : "s"} will stream into the chart preview console.`} />}
                      {compatibility.state === "idle" && (
                        <LogRow level="info" label="vault" text="Run the compatibility check to test this exact source against the on-chain evaluator." />
                      )}
                      {compatibility.state === "checking" && (
                        <LogRow level="info" label="vault" text="Compiling and checking two-way signal liveness…" />
                      )}
                      {compatibility.state === "ready" && (
                        <>
                          <LogRow level="success" label="vault" text="This exact source passes the vault compiler and liveness check." />
                          {compatibility.warnings.map((warning) => <LogRow key={warning} level="warning" label="compiler" text={warning} />)}
                        </>
                      )}
                      {compatibility.state === "rejected" && compatibility.errors.map((error) => (
                        <LogRow key={error} level="error" label="compiler" text={error} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex shrink-0 gap-2 border-t border-card-border bg-background-secondary p-3 sm:hidden">
                <button
                  type="button"
                  onClick={() => { setTab("logs"); void checkCompatibility(); }}
                  disabled={!source || compatibility.state === "checking"}
                  className={cn(PRODUCT_CONTROL_CLASS, "flex-1 px-3 py-2.5 font-display text-[12px] font-semibold text-foreground-secondary disabled:opacity-40")}
                >
                  Check
                </button>
                <button
                  type="button"
                  onClick={useSelected}
                  disabled={!source || loadingSource || disabled}
                  className="flex-[1.4] rounded-[var(--radius-sm)] bg-accent px-3 py-2.5 font-display text-[12px] font-semibold text-accent-foreground disabled:cursor-wait disabled:bg-card disabled:text-muted-foreground"
                >
                  {loadingSource ? "Loading full source…" : "Use in editor"}
                </button>
              </div>
            </div>
          )}
      </ResponsiveModalSheet>
    </>
  );
}

function LogRow({
  level,
  label,
  text,
}: {
  level: "info" | "warning" | "error" | "success";
  label: string;
  text: string;
}) {
  return (
    <div className="grid grid-cols-[62px_76px_minmax(0,1fr)] gap-2 border-b border-card-border py-2 last:border-0">
      <span className="text-zinc-700">{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      <span className={cn(
        level === "error" && "text-red-400",
        level === "warning" && "text-amber-400",
        level === "success" && "text-accent",
        level === "info" && "text-sky-400",
      )}>
        {label}
      </span>
      <span className="break-words text-zinc-300">{text}</span>
    </div>
  );
}
