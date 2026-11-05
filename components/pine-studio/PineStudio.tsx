"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Bookmark, Check, CheckCircle2, ChevronDown, ChevronRight, Code2, Copy, Download, FileCode2, Info, Layers3, Link2, LoaderCircle, Maximize2, Pause, Play, Plus, RotateCcw, Search, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";
import type { Bar, CompileOptions, CompileResult, Diagnostic } from "../../lib/pine-solana/ir";
import { aggregateCandles, DEMO_CANDLES, packageProject, replayCompiled, STUDIO_EXAMPLES } from "../../lib/pine-solana/studio-model";
import { tokenizePineLine } from "../../lib/launchpad/pine-highlight";
import { PineChart } from "./PineChart";
import "./pine-studio.css";

type Tab = "chart" | "scripts" | "build";
type Sheet = "editor" | "settings" | "files" | "about" | null;
type Script = { id: string; name: string; source: string; options: CompileOptions; exampleId?: string; updatedAt: number };
const STORAGE_KEY = "cash-pine-studio-scripts-v1";
const INITIAL = STUDIO_EXAMPLES[0];
const initialScript: Script = { id: "example-ema", name: INITIAL.name, source: INITIAL.source, options: {}, exampleId: INITIAL.id, updatedAt: 0 };
const shortName = (value: string) => value.replace(/\s*[—–-]\s*Solana$/i, "");
const niceName = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
const money = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const optionsKey = (value: CompileOptions) => JSON.stringify(value);
// These IDs only identify local drafts. HTTP development previews may not expose
// randomUUID; they must still be able to save a new script.
const scriptId = () => globalThis.crypto?.randomUUID?.() ?? `script-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function SolanaMark({ className = "" }: { className?: string }) {
  return <svg className={className} width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h16l-4 4H2l4-4Zm-4 6h16l4 4H6l-4-4Zm4 6h16l-4 4H2l4-4Z" /></svg>;
}

function CodeText({ source, numbered = false }: { source: string; numbered?: boolean }) {
  return <>{source.split("\n").map((line, index) => <span className="source-line" key={index}>{numbered && <span className="source-line-number">{index + 1}</span>}<span>{tokenizePineLine(line).map((token, n) => <span className={`pine-token-${token.kind}`} key={n}>{token.text}</span>)}{!line && " "}</span>{"\n"}</span>)}</>;
}

function SheetDialog({ open, onClose, title, className = "", children, notice }: { open: boolean; onClose: () => void; title: string; className?: string; children: ReactNode; notice?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const startY = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const update = () => {
      const viewport = window.visualViewport;
      dialog.style.setProperty("--viewport-height", `${viewport?.height ?? window.innerHeight}px`);
      dialog.style.setProperty("--keyboard-inset", `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`);
    };
    update();
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      document.body.style.overflow = previous;
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [open]);
  return <dialog ref={ref} className={`studio-sheet ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }} style={{ transform: drag ? `translateY(${drag}px)` : undefined }}>
    <div className="sheet-grab" aria-hidden="true" onPointerDown={event => { startY.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (startY.current !== null) setDrag(Math.max(0, event.clientY - startY.current)); }} onPointerUp={() => { if (drag > 90) onClose(); startY.current = null; setDrag(0); }} onPointerCancel={() => { startY.current = null; setDrag(0); }}><span /></div>
    <div className="sheet-heading"><h2>{title}</h2><button className="icon-button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={21} /></button></div>
    {notice}
    {children}
  </dialog>;
}

function MiniWave({ variant = 0 }: { variant?: number }) {
  const paths = ["M2 29C12 29 10 9 21 12S29 36 39 23 43 9 54 15 65 29 76 8", "M2 21 13 21 20 8 29 33 38 14 49 26 60 9 67 21 77 21", "M2 30C16 30 13 8 27 13S41 34 52 21 66 5 77 12"];
  return <svg className="mini-wave" viewBox="0 0 80 40" fill="none" aria-hidden="true"><path d={paths[variant % paths.length]} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function Oscillator({ name, values, color }: { name: string; values: readonly (number | null)[]; color: string }) {
  const samples = values.slice(-70);
  const finite = samples.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!finite.length) return null;
  const low = Math.min(...finite), high = Math.max(...finite), range = high - low || 1;
  let line = "", connected = false;
  samples.forEach((value, index) => { if (value === null) { connected = false; return; } line += `${connected ? "L" : "M"}${index * 340 / Math.max(1, samples.length - 1)},${47 - (value - low) / range * 35} `; connected = true; });
  return <div className="oscillator"><div><span>{name}</span><strong style={{ color }}>{finite.at(-1)?.toFixed(2)}</strong></div><svg viewBox="0 0 340 55" preserveAspectRatio="none" role="img" aria-label={`${name} on sample bars`}><path d="M0 27H340" stroke="currentColor" strokeDasharray="3 5" opacity=".18" /><path d={line} fill="none" stroke={color} strokeWidth="1.7" vectorEffect="non-scaling-stroke" /></svg></div>;
}

export function PineStudio({ initialCompile }: { initialCompile: CompileResult }) {
  const [tab, setTab] = useState<Tab>("chart");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [active, setActive] = useState<Script>(initialScript);
  const [compiled, setCompiled] = useState(initialCompile);
  const [saved, setSaved] = useState<Script[]>([]);
  const [draft, setDraft] = useState<Script | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [busy, setBusy] = useState(false);
  const [editorMode, setEditorMode] = useState<"code" | "link">("code");
  const [link, setLink] = useState("");
  const [signalRules, setSignalRules] = useState(false);
  const [fullEditor, setFullEditor] = useState(false);
  const [timeframe, setTimeframe] = useState<1 | 5 | 15>(1);
  const [cursor, setCursor] = useState(240);
  const [playing, setPlaying] = useState(false);
  const [inspected, setInspected] = useState<Bar | null>(null);
  const [inspectionKey, setInspectionKey] = useState(0);
  const [hiddenSeries, setHiddenSeries] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState("programs/pine_strategy/src/lib.rs");
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const request = useRef<AbortController | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const highlighted = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const clearInspection = () => { setInspected(null); setInspectionKey(value => value + 1); };

  useEffect(() => {
    try {
      const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      if (Array.isArray(data)) setSaved(data.filter((item): item is Script => !!item && typeof item === "object" && typeof item.id === "string" && typeof item.name === "string" && typeof item.source === "string" && item.source.length <= 128_000 && !!item.options && typeof item.options === "object").slice(0, 24));
    } catch { /* A browser with storage disabled still supports the workspace. */ }
    return () => request.current?.abort();
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, [tab]);
  const storeScripts = (next: Script[]) => {
    setSaved(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); return true; } catch { setToast({ text: "Preview is ready. Browser storage is full; download your source to keep it." }); return false; }
  };
  const bars = useMemo(() => aggregateCandles(DEMO_CANDLES, timeframe), [timeframe]);
  const replay = useMemo(() => {
    if (!compiled.ir) return { result: null, error: "Add a script to start previewing." };
    try { return { result: replayCompiled(compiled.ir, bars), error: null }; }
    catch (error) { return { result: null, error: error instanceof Error ? error.message : "The script could not evaluate this history." }; }
  }, [compiled, bars]);
  const visibleCount = Math.min(cursor, bars.length);
  const visibleBars = bars.slice(0, visibleCount);
  const intents = (replay.result?.intents ?? []).filter(intent => intent.barIndex < visibleCount);
  const last = inspected ?? visibleBars.at(-1) ?? bars[0];
  const first = bars[0];
  const delta = last.close - first.open, percent = delta / first.open * 100;
  const hasEdits = !!draft && draft.id === active.id && (draft.source !== active.source || optionsKey(draft.options) !== optionsKey(active.options));
  const canExport = compiled.ok && !!compiled.ir && !hasEdits;
  const currentExample = STUDIO_EXAMPLES.find(example => example.id === active.exampleId && example.source === active.source);
  const series = useMemo(() => {
    if (!replay.result) return [];
    const description = currentExample?.displaySeries ?? replay.result.series.slice(0, 2).map((item, index) => ({ name: item.name, output: item.output, color: ["#ff865e", "#b4b5a9"][index], pane: /overlay\s*=\s*true/.test(active.source) ? "price" as const : "oscillator" as const, style: "line" as const }));
    return description.filter(item => Object.hasOwn(compiled.ir?.outputs ?? {}, item.output)).map(item => ({ ...item, values: replay.result!.evaluations.slice(0, visibleCount).map(row => typeof row.outputs[item.output] === "number" ? row.outputs[item.output] as number : null) }));
  }, [replay.result, currentExample, active.source, compiled.ir, visibleCount]);
  useEffect(() => {
    if (!playing) return;
    if (cursor >= bars.length) { setPlaying(false); return; }
    const timer = setTimeout(() => setCursor(value => Math.min(value + 1, bars.length)), 280);
    return () => clearTimeout(timer);
  }, [playing, bars.length, cursor]);

  const changeDraft = (next: Script) => { request.current?.abort(); setBusy(false); setDraft(next); setDiagnostics([]); };
  const editActive = (destination: Sheet = "editor") => {
    request.current?.abort(); setBusy(false);
    if (!draft || draft.id !== active.id) setDraft({ ...active, options: { ...active.options } });
    setEditorMode("code"); setDiagnostics([]); setSignalRules(!!active.options.signals); setFullEditor(false); setSheet(destination);
  };
  const addScript = () => { request.current?.abort(); setBusy(false); setDraft(previous => previous && previous.id.startsWith("draft-") ? previous : { id: `draft-${Date.now()}`, name: "Untitled script", source: "", options: {}, updatedAt: Date.now() }); setDiagnostics([]); setSignalRules(false); setEditorMode("code"); setFullEditor(false); setSheet("editor"); };
  const showToast = (text: string) => setToast({ text });
  const compile = async (script: Script, save = true) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setDiagnostics([]);
    try {
      const response = await fetch("/api/launchpad/compile-solana", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pineScript: script.source, options: script.options }), signal: controller.signal });
      const result = await response.json() as CompileResult & { error?: string };
      if (controller.signal.aborted) return;
      if (!result.ok || !result.ir) {
        const errors = result.diagnostics?.filter(d => d.severity === "error") ?? [{ severity: "error" as const, code: "REQUEST", message: result.error ?? "Could not check your script. Please try again.", line: 1, column: 1 }];
        setDiagnostics(errors); setDraft(script); setSheet("editor");
        if (errors.some(error => error.code === "NO_TRADING_INTENT")) setSignalRules(true);
        return;
      }
      const next = { ...script, id: script.id.startsWith("draft-") ? scriptId() : script.id, name: shortName(result.ir.title), updatedAt: Date.now() };
      setCompiled(result); setActive(next); setDraft(null); setSheet(null); setTab("chart"); setCursor(bars.length); setPlaying(false); clearInspection(); setHiddenSeries([]);
      if (save) {
        const nextSaved = [next, ...saved.filter(item => item.id !== next.id)].slice(0, 24);
        if (storeScripts(nextSaved)) showToast("Script checked. Preview updated.");
      } else showToast(`${next.name} is on your chart.`);
    } catch (error) {
      if (!controller.signal.aborted) { setDraft(script); setDiagnostics([{ severity: "error", code: "NETWORK", message: "The compiler could not be reached. Your code is still here—try again.", line: 1, column: 1 }]); setSheet("editor"); }
    } finally { if (request.current === controller) setBusy(false); }
  };
  const chooseExample = (id: string) => {
    const example = STUDIO_EXAMPLES.find(item => item.id === id);
    if (example) void compile({ id: `example-${example.id}`, name: example.name, source: example.source, options: {}, exampleId: example.id, updatedAt: 0 }, false);
  };
  const importLink = async () => {
    let url: URL;
    try { url = new URL(link); if (url.protocol !== "https:" || !["www.tradingview.com", "tradingview.com"].includes(url.hostname) || !url.pathname.startsWith("/script/")) throw new Error(); }
    catch { setDiagnostics([{ severity: "error", code: "LINK", message: "Use a public tradingview.com/script/… link, or paste the Pine code.", line: 1, column: 1 }]); return; }
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setBusy(true); setDiagnostics([]);
    try {
      const response = await fetch(`/api/launchpad/tv-import?url=${encodeURIComponent(url.href)}`, { signal: controller.signal });
      const data = await response.json() as { source?: string; error?: string; sourceMeta?: { integrity?: string } };
      if (controller.signal.aborted) return;
      if (!response.ok || !data.source) throw new Error("Source unavailable");
      setDraft(previous => previous ? { ...previous, source: data.source!, exampleId: undefined } : previous); setEditorMode("code");
      showToast(data.sourceMeta?.integrity === "full" ? "Source imported. Review it, then preview." : "Source extracted. Check it matches the original before previewing.");
    } catch { if (!controller.signal.aborted) setDiagnostics([{ severity: "error", code: "IMPORT", message: "This source could not be imported. Copy the open-source Pine code from TradingView and paste it here.", line: 1, column: 1 }]); }
    finally { if (request.current === controller) setBusy(false); }
  };
  const download = (content: BlobPart, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadProject = () => {
    if (!canExport) return;
    try { download(packageProject(compiled.files), `${active.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-solana.zip`, "application/zip"); showToast("Download started. Build instructions are inside."); }
    catch { showToast("The project could not be packaged. Please preview your script again."); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); showToast("Copied to clipboard."); } catch { showToast("Clipboard access is unavailable. You can select and copy the code."); } };
  const jumpToError = () => {
    const line = diagnostics[0]?.line ?? 1; const text = draft?.source ?? "";
    const start = text.split("\n").slice(0, line - 1).reduce((sum, value) => sum + value.length + 1, 0);
    editor.current?.focus(); editor.current?.setSelectionRange(start, text.indexOf("\n", start) < 0 ? text.length : text.indexOf("\n", start));
    if (editor.current) { editor.current.scrollTop = Math.max(0, (line - 3) * 26); syncEditorScroll(); }
  };
  const syncEditorScroll = () => {
    if (!editor.current) return;
    if (highlighted.current) highlighted.current.style.transform = `translate(${-editor.current.scrollLeft}px, ${-editor.current.scrollTop}px)`;
    if (gutter.current) gutter.current.style.transform = `translateY(${-editor.current.scrollTop}px)`;
  };
  const onInspect = useCallback((bar: Bar | null) => setInspected(bar), []);
  const longs = intents.filter(intent => intent.kind === "entry" && intent.side === 1).length;
  const shorts = intents.filter(intent => intent.kind === "entry" && intent.side === -1).length;
  const filteredSaved = saved.filter(script => script.name.toLowerCase().includes(query.toLowerCase()));
  const sourceLines = (draft?.source ?? "").split("\n").length;
  const detectedTitle = draft?.source.match(/(?:strategy|indicator|study)\s*\(\s*(?:title\s*=\s*)?["']([^"']+)["']/)?.[1];
  const files = Object.keys(compiled.files);
  const sheetNotice = toast ? <div className="sheet-notice" role="status"><span>{toast.text}</span><button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={14} /></button></div> : null;

  return <main className="pine-studio">
    <div className="studio-shell">
      <header className="studio-header">
        <button className="studio-brand" onClick={() => setTab("chart")} aria-label="Cash studio home">cash<span>.</span><i /> <small>studio</small></button>
        <nav className="desktop-tabs" aria-label="Workspace">{(["chart", "scripts", "build"] as const).map(item => <button className={tab === item ? "selected" : ""} onClick={() => setTab(item)} key={item}>{niceName(item)}</button>)}</nav>
        <div className="header-tools"><span className="network-badge"><SolanaMark /><span>Solana</span></span><button className="icon-button" onClick={() => setSheet("about")} aria-label="About this workspace"><Info size={18} /></button></div>
      </header>

      <div className="studio-content">
        {tab === "chart" && <div className="chart-layout page-enter">
          <section className="chart-workspace" aria-label="Strategy chart">
            <div className="market-heading"><div className="market-name"><span className="asset-icon"><SolanaMark /></span><span>SOL <span className="market-quote">/ USD</span></span></div><button className="sample-badge" onClick={() => setSheet("about")}><span />Sample data</button></div>
            <div className="price-heading"><h1><span>$</span>{money(last.close)}</h1><span className={`price-change ${delta >= 0 ? "positive" : "negative"}`}>{delta >= 0 ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />}{Math.abs(percent).toFixed(2)}%</span></div>
            <div className="price-caption"><span>{inspected ? new Date(inspected.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC · selected bar" : "Synthetic market · sample session"}</span>{inspected && <button onClick={clearInspection}>Reset</button>}</div>
            <div className="chart-legends">{series.filter(item => item.pane === "price").map(item => <button key={item.output} style={{ opacity: hiddenSeries.includes(item.output) ? .35 : 1 }} onClick={() => setHiddenSeries(value => value.includes(item.output) ? value.filter(output => output !== item.output) : [...value, item.output])} aria-pressed={!hiddenSeries.includes(item.output)}><i style={{ background: item.color }} />{item.name}<span>{item.values.at(-1)?.toFixed(2) ?? "—"}</span></button>)}</div>
            <PineChart inspectionKey={inspectionKey} bars={visibleBars} overlays={series.filter(item => item.pane === "price" && !hiddenSeries.includes(item.output))} intents={intents} onInspect={onInspect} />
            {series.filter(item => item.pane === "oscillator").slice(0, 2).map(item => <Oscillator key={item.output} name={item.name} values={item.values} color={item.color} />)}
            <div className="chart-toolbar"><div className="timeframe-control" aria-label="Candle timeframe">{([1, 5, 15] as const).map(value => <button className={timeframe === value ? "active" : ""} aria-pressed={timeframe === value} onClick={() => { setTimeframe(value); setCursor(240); setPlaying(false); clearInspection(); }} key={value}>{value}m</button>)}</div><button className={`replay-button ${playing ? "active" : ""}`} onClick={() => { if (cursor >= bars.length) setCursor(Math.min(24, Math.max(1, Math.floor(bars.length / 4)))); clearInspection(); setPlaying(!playing); }} disabled={!!replay.error}>{playing ? <Pause size={14} /> : <Play size={14} />} {playing ? "Pause" : "Replay"}</button></div>
            {(playing || visibleCount < bars.length) && <div className="replay-timeline"><input type="range" aria-label="Replay position" min="1" max={bars.length} value={visibleCount} onChange={event => { setCursor(Number(event.target.value)); clearInspection(); }} /><span>{visibleCount}/{bars.length}</span><button className="icon-button" aria-label="Return to full history" onClick={() => { setCursor(bars.length); setPlaying(false); clearInspection(); }}><RotateCcw size={15} /></button></div>}
            <div className="active-strategy"><span className="strategy-glyph"><Layers3 size={20} /></span><button className="strategy-name" onClick={() => editActive()}><strong>{active.name}</strong><span>{hasEdits ? <><i className="dot orange" />Unapplied edits</> : <><i className="dot" />{intents.length} signals <b>·</b> {visibleCount} candles</>}</span></button><button className="icon-button" aria-label="Edit script" onClick={() => editActive()}><Code2 size={19} /></button><button className="icon-button" aria-label="Strategy inputs" onClick={() => editActive("settings")}><SlidersHorizontal size={18} /></button></div>
            {replay.error ? <p className="inline-error" role="alert">{replay.error}</p> : <div className="signal-summary"><span><ArrowUpRight size={14} />{longs} long</span><span><ArrowDownRight size={14} />{shorts} short</span><span>Signals, not fills <Info size={12} /></span></div>}
            <div className="chart-primary"><button className="primary-button" onClick={() => setTab("build")}><span>Review Solana project</span><ArrowRight size={19} /></button><button className="text-button add-another" onClick={addScript}><Plus size={15} />Add a different script</button></div>
          </section>
          <aside className="desktop-source" aria-label="Active source"><div className="source-panel-heading"><span><Code2 size={16} />Your script</span><span className="version-tag">PINE V{compiled.ir?.pineVersion ?? 6}</span></div><div className="source-panel-title"><h2>{active.name}</h2><button className="icon-button" aria-label="Expand source editor" onClick={() => editActive()}><Maximize2 size={17} /></button></div><pre><code><CodeText source={active.source} numbered /></code></pre><div className="source-panel-footer"><span><Check size={14} />Source checked</span><button className="text-button" onClick={() => editActive()}>Edit source <ArrowUpRight size={15} /></button></div><div className="desktop-tip"><span>YOUR IDEAS. YOUR CODE.</span><p>A little Pine.<br />A new possibility.</p><button onClick={addScript}>Start with your own script <ArrowRight size={16} /></button></div></aside>
        </div>}

        {tab === "scripts" && <section className="scripts-page page-enter">
          <div className="page-heading"><div><span className="eyebrow">THE WORKSPACE</span><h1>Your scripts<span>.</span></h1></div><button className="round-add" aria-label="Add a script" onClick={addScript}><Plus size={24} /></button></div>
          <div className="search-field"><Search size={18} /><input aria-label="Search your scripts" placeholder="Find a script…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery("")}><X size={16} /></button>}</div>
          <div className="section-label"><span>SAVED ON THIS DEVICE</span><span>{saved.length.toString().padStart(2, "0")}</span></div>
          {filteredSaved.length ? <div className="saved-list">{filteredSaved.map(script => <div className="script-row" key={script.id}><button className="script-row-main" onClick={() => void compile(script, false)} disabled={busy}><span className="script-icon"><FileCode2 size={21} /></span><span><strong>{script.name}</strong><small>Pine v{script.source.match(/@version\s*=\s*(\d)/)?.[1] ?? "?"} <b>·</b> {script.source.split("\n").length} lines {script.id === active.id && <em>On chart</em>}</small></span><ChevronRight size={18} /></button><button className="icon-button remove-script" aria-label={`Delete ${script.name}`} onClick={() => { const previous = saved; storeScripts(saved.filter(item => item.id !== script.id)); setToast({ text: "Script removed.", undo: () => { storeScripts(previous); setToast(null); } }); }}><Trash2 size={15} /></button></div>)}</div> : <div className="scripts-empty"><Bookmark size={23} /><p>{query ? "No scripts match that name." : "Make room for your next idea."}</p><span>{query ? "Try another search." : "Your scripts appear here after you preview them."}</span>{!query && <button className="text-button" onClick={addScript}>Add your script <ArrowRight size={15} /></button>}</div>}
          <div className="section-label examples-label"><span>A GOOD PLACE TO START</span><span>03</span></div>
          <div className="examples-list">{STUDIO_EXAMPLES.map((example, index) => <button className="example-row" key={example.id} onClick={() => chooseExample(example.id)} disabled={busy}><span className="example-number">0{index + 1}</span><span className="example-copy"><strong>{example.name}</strong><small>{example.description}</small></span><MiniWave variant={index} /><ArrowUpRight size={18} /></button>)}</div>
          <p className="quiet-note">Built-in examples. Real Pine. Ready to make your own.</p>
        </section>}

        {tab === "build" && <section className="build-page page-enter">
          <div className="page-heading"><div><span className="eyebrow">PINE → SOLANA</span><h1>Your next<br />build<span>.</span></h1></div><span className="build-orbit"><SolanaMark /></span></div>
          <div className="build-status"><span className={canExport ? "status-check" : "status-edited"}>{canExport ? <Check size={20} /> : <Code2 size={20} />}</span><div><strong>{hasEdits ? "Preview your latest edits" : "Your project is ready"}</strong><p>{hasEdits ? "Update the preview before downloading." : "Checked source. Generated Solana project."}</p></div></div>
          <div className="build-script"><span className="file-tile"><FileCode2 size={27} /><small>.pine</small></span><div><h2>{active.name}</h2><span>Pine v{compiled.ir?.pineVersion ?? 6}<b>→</b>Rust + Anchor</span></div></div>
          <div className="build-steps"><div><span>01</span><p>Check the script<small>Supported syntax and inputs</small></p><Check size={17} /></div><div><span>02</span><p>Preview the signals<small>{replay.result ? `${replay.result.intents.length} signals across ${bars.length} sample candles` : "Sample replay requires attention"}</small></p>{replay.result ? <Check size={17} /> : <Info size={17} />}</div><div><span>03</span><p>Generate the project<small>{files.length} source and configuration files</small></p><Check size={17} /></div></div>
          <button className="file-browser-row" onClick={() => setSheet("files")}><span><Code2 size={17} />Explore generated files</span><span>{files.length}<ChevronRight size={17} /></span></button>
          <details className="build-details"><summary>Build details<ChevronDown size={16} /></summary><dl><div><dt>Source</dt><dd><button onClick={() => void copy(compiled.ir?.sourceHash ?? "")}>{compiled.ir?.sourceHash.slice(0, 12)}… <Copy size={12} /></button></dd></div><div><dt>Configuration</dt><dd><button onClick={() => void copy(compiled.ir?.configHash ?? "")}>{compiled.ir?.configHash.slice(0, 12)}… <Copy size={12} /></button></dd></div><div><dt>Strategy graph</dt><dd>{compiled.ir?.nodes.length} nodes</dd></div><div><dt>Numeric state</dt><dd>{(compiled.ir?.stateCells ?? 0) * 8} bytes</dd></div><div><dt>Execution</dt><dd>Confirmed-bar signals</dd></div></dl></details>
          <div className="build-primary"><button className="primary-button" onClick={hasEdits ? () => editActive() : downloadProject} disabled={!compiled.ok}><span>{hasEdits ? "Preview changes" : "Download project"}</span>{hasEdits ? <ArrowRight size={19} /> : <Download size={19} />}</button><p>Source files only. No funds moved or trades placed.</p></div>
        </section>}
      </div>

      <nav className="mobile-tabs" aria-label="Workspace navigation">{([{ id: "chart", name: "Chart", Icon: Layers3 }, { id: "scripts", name: "Scripts", Icon: Code2 }, { id: "build", name: "Build", Icon: SolanaMark }] as const).map(({ id, name, Icon }) => <button key={id} className={tab === id ? "selected" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><Icon /><span>{name}</span>{tab === id && <i />}</button>)}</nav>
      <footer className="desktop-footer"><span>Pine in. Possibilities out.</span><span>Experimental compiler <i /> Sample data</span></footer>
    </div>

    <SheetDialog open={sheet === "editor"} notice={sheet === "editor" ? sheetNotice : null} title={draft?.id.startsWith("draft-") ? "Add a script" : "Edit script"} onClose={() => { setSheet(null); setFullEditor(false); }} className={`editor-sheet ${fullEditor ? "expanded" : ""}`}>
      <div className="editor-modes"><div className="segmented-control"><button className={editorMode === "code" ? "active" : ""} onClick={() => { setEditorMode("code"); setDiagnostics([]); }}><Code2 size={15} />Pine code</button><button className={editorMode === "link" ? "active" : ""} onClick={() => { setEditorMode("link"); setDiagnostics([]); }}><Link2 size={14} />TradingView link</button></div><button className="icon-button" aria-label={fullEditor ? "Collapse editor" : "Expand editor"} onClick={() => setFullEditor(!fullEditor)}><Maximize2 size={16} /></button></div>
      {editorMode === "code" ? <>
        <div className="editor-caption"><span>{detectedTitle ? shortName(detectedTitle) : "Your next idea starts here"}</span><span>{draft?.source.match(/@version\s*=\s*(\d)/)?.[1] ? `PINE V${draft.source.match(/@version\s*=\s*(\d)/)?.[1]}` : ".PINE"}</span></div>
        <div className={`code-editor ${!draft?.source ? "empty" : ""}`}><div className="editor-gutter" aria-hidden="true"><div ref={gutter}>{Array.from({ length: Math.max(9, sourceLines) }, (_, index) => <span className={diagnostics.some(error => error.line === index + 1) ? "error-line" : ""} key={index}>{index + 1}</span>)}</div></div><div className="editor-code-layer"><pre ref={highlighted} aria-hidden="true"><CodeText source={draft?.source ?? ""} /></pre><textarea ref={editor} aria-label="Pine source code" placeholder={"// Paste your Pine Script here\n// or start with an example below"} value={draft?.source ?? ""} onChange={event => draft && changeDraft({ ...draft, source: event.target.value })} onScroll={syncEditorScroll} wrap="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" maxLength={128_000} /></div></div>
        <div className="editor-utilities"><span>{sourceLines} {sourceLines === 1 ? "line" : "lines"}<i />{draft?.source.trim() ? "Draft" : "Pine v4–v6"}</span><button onClick={() => fileInput.current?.click()}><Upload size={14} />Open .pine</button><input ref={fileInput} type="file" accept=".pine,.txt,text/plain" hidden onChange={async event => { const file = event.target.files?.[0]; if (file && draft) { if (file.size > 128_000) showToast("Choose a Pine file smaller than 128 KB."); else changeDraft({ ...draft, source: await file.text(), exampleId: undefined }); } event.target.value = ""; }} /></div>
        {!draft?.source.trim() && <div className="quick-examples"><span>Start with</span>{STUDIO_EXAMPLES.map(example => <button key={example.id} onClick={() => draft && changeDraft({ ...draft, source: example.source, exampleId: example.id, options: {} })}>{example.name.replace(" crossover", "").replace(" momentum", "")}<ArrowUpRight size={12} /></button>)}</div>}
        <details className="signal-rules" open={signalRules} onToggle={event => setSignalRules(event.currentTarget.open)}><summary>Trading rules for indicators<ChevronDown size={14} /></summary><p>Choose your own conditions. Plots never become trades automatically.</p><div className="rule-fields">{(["long", "short", "close"] as const).map(key => <label key={key}>{key === "long" ? "Long when" : key === "short" ? "Short when" : "Close when"}<input placeholder={key === "long" ? "buySignal" : key === "short" ? "sellSignal" : "Optional"} value={draft?.options.signals?.[key] ?? ""} spellCheck={false} onChange={event => { if (!draft) return; const signals = { ...draft.options.signals }; if (event.target.value.trim()) signals[key] = event.target.value; else delete signals[key]; const options = { ...draft.options }; if (signals.long || signals.short || signals.close) options.signals = signals; else delete options.signals; changeDraft({ ...draft, options }); }} /></label>)}</div></details>
      </> : <div className="link-import"><span className="link-import-icon"><Link2 size={26} /></span><h3>Bring your script over.</h3><p>Paste a public, open-source TradingView script link.</p><input type="url" aria-label="TradingView script URL" placeholder="https://tradingview.com/script/…" value={link} onChange={event => { request.current?.abort(); setBusy(false); setLink(event.target.value); setDiagnostics([]); }} /><span>Protected scripts need source code from their author.</span></div>}
      {diagnostics.length > 0 && <div className="editor-error" role="alert"><div><span className="error-symbol">!</span><strong>{diagnostics[0].code === "NO_TRADING_INTENT" ? "Choose your trading signals" : "One thing to fix"}</strong><button onClick={jumpToError}>Line {diagnostics[0].line}<ArrowUpRight size={13} /></button></div><p>{diagnostics[0].message}</p>{diagnostics.length > 1 && <details><summary>{diagnostics.length - 1} more {diagnostics.length === 2 ? "issue" : "issues"}</summary>{diagnostics.slice(1).map((issue, index) => <p key={index}>Line {issue.line}: {issue.message}</p>)}</details>}</div>}
      <div className="sheet-action"><button className="primary-button" disabled={busy || (editorMode === "code" ? !draft?.source.trim() : !link.trim())} onClick={() => editorMode === "link" ? void importLink() : draft && void compile(draft)}><span>{busy ? editorMode === "link" ? "Importing source…" : "Checking your script…" : editorMode === "link" ? "Import source" : "Preview script"}</span>{busy ? <LoaderCircle className="spin" size={19} /> : <ArrowRight size={19} />}</button><p>{editorMode === "code" ? "Check it, save it, see it on the chart." : "You can review the code before using it."}</p></div>
    </SheetDialog>

    <SheetDialog open={sheet === "settings"} notice={sheet === "settings" ? sheetNotice : null} title="Strategy inputs" onClose={() => setSheet(null)} className="settings-sheet">
      <p className="sheet-subtitle">A small adjustment. A different perspective.</p>
      <div className="settings-fields">{Object.entries(compiled.ir?.inputs ?? {}).length ? Object.entries(compiled.ir?.inputs ?? {}).map(([key, value]) => <label key={key}><span>{niceName(key)}</span>{typeof value === "boolean" ? <input type="checkbox" checked={Boolean(draft?.options.inputs?.[key] ?? value)} onChange={event => draft && changeDraft({ ...draft, options: { ...draft.options, inputs: { ...draft.options.inputs, [key]: event.target.checked } } })} /> : <input type={typeof value === "number" ? "number" : "text"} step="any" value={String(draft?.options.inputs?.[key] ?? value)} onChange={event => draft && changeDraft({ ...draft, options: { ...draft.options, inputs: { ...draft.options.inputs, [key]: typeof value === "number" ? Number(event.target.value) : event.target.value } } })} />}</label>) : <div className="settings-empty"><Code2 size={24} /><p>This script has no configurable inputs.</p><button className="text-button" onClick={() => setSheet("editor")}>Edit the source <ArrowRight size={15} /></button></div>}</div>
      <div className="sheet-action"><button className="primary-button" disabled={busy || !draft} onClick={() => draft && void compile(draft)}><span>{busy ? "Checking changes…" : "Update preview"}</span>{busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}</button></div>
    </SheetDialog>

    <SheetDialog open={sheet === "files"} notice={sheet === "files" ? sheetNotice : null} title="Project files" onClose={() => setSheet(null)} className="files-sheet">
      {hasEdits && <p className="stale-file-note">These files belong to the last checked version. Preview your edits to update them.</p>}
      <div className="file-select"><FileCode2 size={17} /><select aria-label="Generated file" value={selectedFile} onChange={event => setSelectedFile(event.target.value)}>{files.map(file => <option key={file} value={file}>{file}</option>)}</select><button className="icon-button" aria-label="Copy selected file" onClick={() => void copy(compiled.files[selectedFile] ?? "")}><Copy size={16} /></button></div>
      <pre className="generated-code" tabIndex={0}>{compiled.files[selectedFile] ?? ""}</pre><div className="sheet-action"><button className="primary-button" disabled={!canExport} onClick={downloadProject}><span>Download all {files.length} files</span><Download size={18} /></button></div>
    </SheetDialog>

    <SheetDialog open={sheet === "about"} notice={sheet === "about" ? sheetNotice : null} title="A little context" onClose={() => setSheet(null)} className="about-sheet">
      <div className="about-intro"><span className="studio-brand">cash<span>.</span><i /><small>studio</small></span><p>Your Pine ideas,<br />one step closer to Solana.</p></div>
      <div className="about-row"><Layers3 size={20} /><div><strong>A sample, not a live feed</strong><p>The chart uses 240 synthetic candles. Prices, changes and signals are computed from this sample.</p></div></div><div className="about-row"><Code2 size={20} /><div><strong>Real source generation</strong><p>The compiler creates Rust and Anchor source. It supports a Pine subset and reports what it cannot compile.</p></div></div><div className="about-row"><SolanaMark /><div><strong>You stay in control</strong><p>No wallet connection, network deployment or trade execution. Scripts are saved in this browser.</p></div></div>
      <a className="about-docs" href="https://github.com/SeamMoney/cash.trading/blob/feat/pine-solana-transpiler/docs/PINE_SOLANA_COMPATIBILITY.md" target="_blank" rel="noreferrer">Read the compatibility guide<ArrowUpRight size={16} /></a>
    </SheetDialog>

    {toast && !sheet && <div className="studio-toast" role="status"><CheckCircle2 size={17} /><span>{toast.text}</span>{toast.undo && <button onClick={toast.undo}>Undo</button>}<button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={14} /></button></div>}
    {busy && sheet === null && <div className="background-progress" role="status"><LoaderCircle className="spin" size={16} />Checking script…</div>}
  </main>;
}
