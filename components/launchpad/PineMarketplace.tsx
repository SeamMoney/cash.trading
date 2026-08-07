"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  X,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { CodeBlock } from "@/components/ui/agent";
import type { TradingViewPopularScript } from "@/lib/launchpad/tradingview-popular";
import type {
  TradingViewSourceMeta,
  TradingViewSourceResponse,
} from "@/lib/launchpad/tradingview-source";
import { cn } from "@/lib/utils";

export interface PineMarketplaceSelection {
  source: string;
  title: string;
  url: string;
  author: string;
}

interface Props {
  disabled?: boolean;
  market: string;
  onUse: (selection: PineMarketplaceSelection) => void;
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
    <article className="group min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <span className="relative block aspect-video overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#080808]">
          {item.imageUrl ? (
            // TradingView serves these public preview assets from its own image host.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt={`${item.title} chart preview`}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.015] group-hover:opacity-90"
            />
          ) : (
            <span className="flex h-full items-center justify-center text-zinc-700">
              <CandlestickChart className="h-8 w-8" aria-hidden />
            </span>
          )}
          <span className="absolute right-2 top-2 rounded-[6px] border border-white/10 bg-black/75 px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-200 backdrop-blur">
            {item.scriptType}
          </span>
        </span>
        <span className="mt-2.5 block font-display text-[14px] font-semibold leading-snug text-white group-hover:text-accent">
          {item.title}
        </span>
        {!compact && (
          <span className="mt-1 line-clamp-2 block text-[12px] leading-relaxed text-zinc-400">
            {item.description}
          </span>
        )}
      </button>
      <div className="mt-2 flex min-w-0 items-center justify-between gap-3 font-mono text-[10px] text-zinc-600">
        <a
          href={item.authorUrl ?? item.url}
          target="_blank"
          rel="noreferrer"
          className="truncate hover:text-zinc-300"
        >
          by {item.author}
        </a>
        <span className="flex shrink-0 items-center gap-2.5">
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3 w-3" aria-hidden />
            {item.comments}
          </span>
          <span className="inline-flex items-center gap-1">
            <Rocket className="h-3 w-3" aria-hidden />
            {item.boosts.toLocaleString()}
          </span>
        </span>
      </div>
    </article>
  );
}

export function PineMarketplace({ disabled, market, onUse }: Props) {
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
    onUse({ source, title: selected.title, url: selected.url, author: selected.author });
    setOpen(false);
  }, [onUse, selected, source]);

  const featured = items.slice(0, 3);

  return (
    <>
      <section className="mb-4 overflow-hidden rounded-[16px] border border-white/[0.06] bg-[#101010]">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_12px_rgba(57,255,20,0.5)]" />
              <h2 className="font-display text-[15px] font-semibold text-white">Popular Pine scripts</h2>
            </div>
            <p className="mt-1 text-[12px] text-zinc-500">Live from TradingView · source stays credited to its author</p>
          </div>
          <button
            type="button"
            onClick={showGallery}
            disabled={disabled || items.length === 0}
            className="rounded-[10px] border border-white/[0.1] bg-white/[0.04] px-3 py-2 font-display text-[12px] font-semibold text-zinc-200 hover:border-white/20 hover:bg-white/[0.07] disabled:opacity-40"
          >
            Browse all {items.length || ""}
          </button>
        </div>

        {items.length > 0 && (
          <div className="relative border-b border-white/[0.06]">
            <div className="flex gap-1.5 overflow-x-auto overscroll-x-contain px-4 py-2.5 pr-16">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => openScript(item)}
                  className="shrink-0 rounded-full border border-white/[0.08] bg-[#171717] px-3 py-1.5 font-display text-[11px] font-semibold text-zinc-300 hover:border-accent/35 hover:text-white disabled:opacity-40"
                >
                  {item.title}
                </button>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-y-0 right-0 w-14 bg-gradient-to-l from-[#101010] to-transparent" />
          </div>
        )}

        {loadingFeed ? (
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <div key={key} className="aspect-video animate-pulse rounded-[12px] bg-white/[0.04]" />
            ))}
          </div>
        ) : feedError ? (
          <p className="px-4 py-3 font-mono text-[11px] text-amber-300/80">{feedError}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
            {featured.map((item) => (
              <PopularCard key={item.id} item={item} onOpen={() => openScript(item)} compact />
            ))}
          </div>
        )}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="!block h-[100dvh] w-screen max-w-none overflow-hidden rounded-none border-white/[0.1] bg-[#090909] !p-0 shadow-2xl sm:h-[calc(100dvh-32px)] sm:w-[calc(100vw-32px)] sm:max-w-none sm:rounded-[18px] 2xl:max-w-[1560px]"
        >
          <DialogTitle className="sr-only">
            {selected?.title ?? "Popular TradingView scripts"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Browse public Pine scripts, inspect their source, and adapt one for a cash.trading vault.
          </DialogDescription>

          {!selected ? (
            <div className="flex h-full min-h-0 flex-col">
              <header className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-4 sm:px-7 sm:py-5">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">TradingView community</p>
                  <h2 className="mt-1 font-display text-[24px] font-semibold tracking-tight text-white sm:text-[34px]">Indicators and strategies</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close script marketplace"
                  className="rounded-full p-3 text-zinc-400 hover:bg-white/[0.06] hover:text-white"
                >
                  <X className="h-6 w-6" aria-hidden />
                </button>
              </header>
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3 sm:px-7">
                <span className="rounded-full bg-white px-4 py-2 font-display text-[12px] font-semibold text-black">Popular</span>
                <span className="rounded-[10px] border border-white/[0.12] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-300">Public scripts</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-7 sm:py-7">
                <div className="grid grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((item) => (
                    <PopularCard key={item.id} item={item} onOpen={() => openScript(item)} />
                  ))}
                </div>
                <div className="h-8" aria-hidden />
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <header className="shrink-0 border-b border-white/[0.08] px-3 pt-3 sm:px-6 sm:pt-4">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    aria-label="Back to popular scripts"
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.08] text-zinc-400 hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
                  >
                    <ArrowLeft className="h-5 w-5" aria-hidden />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-sky-300">Public Pine script · {relativeDate(selected.publishedAt)}</p>
                    <h2 className="mt-1 max-w-5xl break-words font-display text-[20px] font-semibold leading-tight text-white sm:text-[28px]">{selected.title}</h2>
                    <a
                      href={selected.authorUrl ?? selected.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block font-mono text-[10px] text-zinc-500 hover:text-zinc-300"
                    >
                      by {selected.author}
                    </a>
                  </div>
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open this script on TradingView"
                    className="flex h-9 shrink-0 items-center gap-2 rounded-[10px] border border-white/[0.1] px-2.5 text-[12px] text-zinc-300 hover:border-white/20 hover:text-white sm:px-3"
                  >
                    <span className="hidden sm:inline">TradingView</span>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close script"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-white/[0.06] hover:text-white"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.06] py-2.5">
                  <div role="tablist" aria-label="Script details" className="grid min-w-0 flex-1 grid-cols-3 rounded-[11px] bg-white/[0.06] p-1 sm:max-w-[330px]">
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
                          "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[8px] px-2 py-2 font-display text-[11px] font-semibold",
                          tab === value ? "bg-white text-black" : "text-zinc-400 hover:text-white",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="hidden items-center gap-2 sm:flex">
                    <button
                      type="button"
                      onClick={checkCompatibility}
                      disabled={!source || compatibility.state === "checking"}
                      className="h-9 rounded-[10px] border border-white/[0.1] px-3 font-display text-[12px] font-semibold text-zinc-200 hover:border-white/20 disabled:opacity-40"
                    >
                      {compatibility.state === "checking" ? "Checking…" : "Check vault compatibility"}
                    </button>
                    <button
                      type="button"
                      onClick={useSelected}
                      disabled={!source || loadingSource || disabled}
                      className="h-9 rounded-[10px] bg-accent px-4 font-display text-[12px] font-semibold text-black hover:brightness-95 disabled:opacity-40"
                    >
                      Use in editor
                    </button>
                  </div>
                </div>
              </header>

              <div className={cn(
                "min-h-0 flex-1 overscroll-contain",
                tab === "chart" ? "overflow-y-auto p-3 sm:p-5" : "overflow-hidden p-3 sm:p-5",
              )}>
                {tab === "chart" && (
                  <div role="tabpanel" className="mx-auto flex min-h-full w-full max-w-[1480px] flex-col gap-4">
                    <section className="overflow-hidden rounded-[14px] border border-white/[0.08] bg-black">
                      <div className="flex h-[42dvh] min-h-[240px] max-h-[360px] w-full items-center justify-center bg-black sm:h-[58dvh] sm:min-h-[420px] sm:max-h-[680px]">
                        {selected.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={selected.imageUrl}
                            alt={`${selected.title} TradingView chart`}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <CandlestickChart className="h-12 w-12 text-zinc-700" aria-hidden />
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] bg-[#0d0d0d] px-3 py-2.5 sm:px-4">
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

                    <section className="grid gap-5 border-t border-white/[0.08] pb-5 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.42fr)]">
                      <div className="min-w-0">
                        <span className="rounded-[6px] bg-sky-500/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-sky-300">{selected.scriptType}</span>
                        <p className="mt-3 max-w-4xl text-[13px] leading-relaxed text-zinc-300 sm:text-[14px]">{selected.description}</p>
                      </div>
                      <aside className="min-w-0 lg:border-l lg:border-white/[0.08] lg:pl-5">
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
                          <div className="mt-4 border-t border-white/[0.06] pt-3">
                            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">Detected features</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {features.map((feature) => (
                                <span key={feature.label} className="rounded-full border border-white/[0.08] px-2.5 py-1 font-mono text-[9px] text-zinc-400">{feature.label}</span>
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
                      <div className="rounded-[14px] border border-amber-500/20 bg-amber-500/[0.06] p-4 text-[13px] leading-relaxed text-amber-200/80">{sourceError}</div>
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
                  <div role="tabpanel" className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0d]">
                    <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
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

              <div className="flex shrink-0 gap-2 border-t border-white/[0.08] bg-[#0b0b0b] p-3 sm:hidden">
                <button
                  type="button"
                  onClick={() => { setTab("logs"); void checkCompatibility(); }}
                  disabled={!source || compatibility.state === "checking"}
                  className="flex-1 rounded-[10px] border border-white/[0.1] px-3 py-2.5 font-display text-[12px] font-semibold text-zinc-200 disabled:opacity-40"
                >
                  Check
                </button>
                <button
                  type="button"
                  onClick={useSelected}
                  disabled={!source || loadingSource || disabled}
                  className="flex-[1.4] rounded-[10px] bg-accent px-3 py-2.5 font-display text-[12px] font-semibold text-black disabled:opacity-40"
                >
                  Use in editor
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
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
    <div className="grid grid-cols-[62px_76px_minmax(0,1fr)] gap-2 border-b border-white/[0.04] py-2 last:border-0">
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
