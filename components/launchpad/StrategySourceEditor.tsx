"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BeforeMount } from "@monaco-editor/react";
import { Check, Copy, ExternalLink, Pencil, RotateCcw } from "lucide-react";

import { transpileV3 } from "@/lib/launchpad/transpiler-v3";
import { cn } from "@/lib/utils";
import { PRODUCT_PRESSABLE_CLASS } from "@/components/ui/product-surface";
import { useThemeName } from "@/components/layout/theme-toggle";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((module) => module.default),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-full min-h-[360px] animate-pulse bg-background-secondary sm:min-h-[440px] lg:min-h-[520px]"
        aria-label="Loading source editor"
      />
    ),
  },
);

/**
 * Monaco's theme API only takes literal colours, which is why the editor chrome
 * used to be fourteen hard-coded hex values — and why it stayed dark on a white
 * page. Reading the same `.cash-trade-theme` custom properties the rest of the
 * app renders from keeps one source of truth and follows the light theme.
 */
function readThemeColor(host: Element, name: string, alphaOver?: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  const styles = getComputedStyle(host);
  const raw = styles.getPropertyValue(name).trim();
  if (!raw) return undefined;
  const hex = raw.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hex) return raw.length === 4 ? `#${[...hex[1]].map((c) => c + c).join("")}` : raw;
  const rgba = raw.match(/^rgba?\(([^)]+)\)$/);
  if (!rgba) return undefined;
  const parts = rgba[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  const [r, g, b, a = 1] = parts;
  if (![r, g, b].every(Number.isFinite)) return undefined;
  const pair = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  // Monaco composites its own alpha unpredictably behind the editor surface, so
  // translucent tokens (--card-border) are flattened over the surface they sit on.
  if (alphaOver && Number.isFinite(a) && a < 1) {
    const base = readThemeColor(host, alphaOver);
    if (base && /^#[0-9a-fA-F]{6}$/.test(base)) {
      const mix = (i: number) => parts[i] * a + parseInt(base.slice(1 + i * 2, 3 + i * 2), 16) * (1 - a);
      return `#${pair(mix(0))}${pair(mix(1))}${pair(mix(2))}`;
    }
  }
  return `#${pair(r)}${pair(g)}${pair(b)}${Number.isFinite(a) && a < 1 ? pair(a * 255) : ""}`;
}

/** Drops the keys whose token did not resolve, so Monaco falls back to its own
 *  base theme rather than rendering `undefined`. `host` is the editor's own
 *  element: `.cash-trade-theme` sits on wrapper divs, never on <html>, so the
 *  document root would hand back the wrong (or no) value. */
function themeColors(host: Element): Record<string, string> {
  const read = (name: string, over?: string) => readThemeColor(host, name, over);
  const entries: Array<[string, string | undefined]> = [
    ["editor.background", read("--background-secondary")],
    ["editor.foreground", read("--foreground")],
    ["editorLineNumber.foreground", read("--muted")],
    ["editorLineNumber.activeForeground", read("--foreground-secondary")],
    ["editorCursor.foreground", read("--accent")],
    ["editor.selectionBackground", read("--border-accent", "--background-secondary")],
    ["editor.inactiveSelectionBackground", read("--chart-segment-background", "--background-secondary")],
    ["editor.lineHighlightBackground", read("--background-tertiary")],
    ["editorGutter.background", read("--background-secondary")],
    ["editorIndentGuide.background1", read("--card-border", "--background-secondary")],
    ["editorIndentGuide.activeBackground1", read("--border-strong", "--background-secondary")],
    ["editorWidget.background", read("--background-tertiary")],
    ["editorWidget.border", read("--border-strong", "--background-tertiary")],
    ["scrollbarSlider.background", read("--card-border", "--background-secondary")],
    ["scrollbarSlider.hoverBackground", read("--card-hover", "--background-secondary")],
    ["scrollbarSlider.activeBackground", read("--border-strong", "--background-secondary")],
  ];
  return Object.fromEntries(entries.filter((e): e is [string, string] => Boolean(e[1])));
}

type SourceTab = "pine" | "move";

interface StrategySourceEditorProps {
  pineScript: string;
  sourceName: string;
  originalUrl?: string;
  editing: boolean;
  canReset?: boolean;
  disabled?: boolean;
  creatorAddress?: string;
  marketAddress?: string;
  onEditingChange: (editing: boolean) => void;
  onPineChange: (source: string) => void;
  onReset?: () => void;
}

function safeFileStem(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "strategy";
}

type Monaco = Parameters<BeforeMount>[0];

function defineSourceTheme(monaco: Monaco, host: Element | null) {
  const colors = host ? themeColors(host) : {};
  monaco.editor.defineTheme("cash-source", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "64815D" },
      { token: "keyword", foreground: "79A7FF" },
      { token: "type", foreground: "70D6C0" },
      { token: "type.identifier", foreground: "93BE7A" },
      { token: "function", foreground: "B7A1E8" },
      { token: "string", foreground: "C89B7C" },
      { token: "number", foreground: "9EC4FF" },
      { token: "number.float", foreground: "9EC4FF" },
      { token: "number.hex", foreground: "9EC4FF" },
      { token: "annotation", foreground: "D5B45B" },
      { token: "operator", foreground: "B8BAC2" },
    ],
    colors,
  });
}

const configureMonaco: BeforeMount = (monaco) => {
  if (!monaco.languages.getLanguages().some((language: { id: string }) => language.id === "pine")) {
    monaco.languages.register({ id: "pine", extensions: [".pine"] });
    monaco.languages.setMonarchTokensProvider("pine", {
      defaultToken: "",
      keywords: [
        "and", "as", "break", "by", "continue", "else", "export", "false", "for",
        "if", "import", "in", "method", "not", "or", "return", "switch", "true",
        "type", "var", "varip", "while",
      ],
      builtins: [
        "alert", "alertcondition", "array", "bar_index", "barstate", "box", "chart",
        "close", "color", "dayofmonth", "dayofweek", "fill", "high", "hline", "hour",
        "indicator", "input", "label", "library", "line", "linefill", "log", "low",
        "map", "math", "matrix", "minute", "month", "na", "open", "plot", "plotarrow",
        "plotbar", "plotcandle", "plotchar", "plotshape", "polyline", "request", "runtime",
        "second", "strategy", "str", "syminfo", "ta", "table", "text", "time", "timeframe",
        "timestamp", "volume", "weekofyear", "year",
      ],
      typeKeywords: ["bool", "float", "int", "string"],
      operators: [
        "+", "-", "*", "/", "%", "=", ":=", "==", "!=", "<", ">", "<=", ">=",
        "?", ":", "=>", "+=", "-=", "*=", "/=", "%=",
      ],
      tokenizer: {
        root: [
          [/\/\/.*$/, "comment"],
          [/\b(?:ta|math|str|array|matrix|map|color|line|label|box|table|strategy|request|input|timeframe|syminfo|barstate|log)\.[a-zA-Z_]\w*/, "function"],
          [/[a-zA-Z_]\w*/, {
            cases: {
              "@keywords": "keyword",
              "@builtins": "type.identifier",
              "@typeKeywords": "type",
              "@default": "identifier",
            },
          }],
          [/0x[0-9a-fA-F]+/, "number.hex"],
          [/(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?/, "number.float"],
          [/\d+(?:[eE][+-]?\d+)?/, "number"],
          [/"([^"\\]|\\.)*$/, "string.invalid"],
          [/"/, "string", "@string"],
          [/[{}()[\]]/, "@brackets"],
          [/[;,.]/, "delimiter"],
          [/[+\-*\/%=:?<>!]+/, "operator"],
        ],
        string: [
          [/[^\\"]+/, "string"],
          [/\\./, "string.escape.invalid"],
          [/"/, "string", "@pop"],
        ],
      },
    });
  }

  if (!monaco.languages.getLanguages().some((language: { id: string }) => language.id === "move")) {
    monaco.languages.register({ id: "move", extensions: [".move"] });
    monaco.languages.setMonarchTokensProvider("move", {
      defaultToken: "",
      keywords: [
        "abort", "acquires", "as", "break", "const", "continue", "copy", "drop", "else",
        "entry", "false", "friend", "fun", "has", "if", "let", "loop", "module", "move",
        "native", "public", "return", "spec", "store", "struct", "true", "use", "while",
      ],
      typeKeywords: [
        "address", "bool", "Object", "option", "signer", "String", "Table", "u8", "u16",
        "u32", "u64", "u128", "u256", "vector",
      ],
      tokenizer: {
        root: [
          [/#\[[\w\s(),=]+\]/, "annotation"],
          [/\/\/.*$/, "comment"],
          [/\/\*/, "comment", "@comment"],
          [/b?"([^"\\]|\\.)*"/, "string"],
          [/@?0x[0-9a-fA-F_]+/, "number.hex"],
          [/[0-9][0-9_]*/, "number"],
          [/[a-zA-Z_]\w*/, {
            cases: {
              "@keywords": "keyword",
              "@typeKeywords": "type",
              "@default": "identifier",
            },
          }],
          [/[{}()[\]]/, "@brackets"],
          [/[;,.]/, "delimiter"],
          [/::/, "delimiter"],
          [/[+\-*\/%=&|!<>]+/, "operator"],
        ],
        comment: [
          [/[^/*]+/, "comment"],
          [/\*\//, "comment", "@pop"],
          [/[/*]/, "comment"],
        ],
      },
    });
  }

};

export function StrategySourceEditor({
  pineScript,
  sourceName,
  originalUrl,
  editing,
  canReset = false,
  disabled = false,
  creatorAddress,
  marketAddress,
  onEditingChange,
  onPineChange,
  onReset,
}: StrategySourceEditorProps) {
  const [activeTab, setActiveTab] = useState<SourceTab>("pine");
  const [moveSource, setMoveSource] = useState("// Open the Move tab to generate the vault module.");
  const [moveErrors, setMoveErrors] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const hostRef = useRef<HTMLElement>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const themeName = useThemeName();

  // Monaco bakes its colours in at defineTheme time, so the editor would keep the
  // dark chrome after a theme switch until a full reload. Re-defining under the
  // same name repaints the live instance.
  useEffect(() => {
    if (monacoRef.current) defineSourceTheme(monacoRef.current, hostRef.current);
  }, [themeName]);

  const fileStem = useMemo(() => safeFileStem(sourceName), [sourceName]);
  const pineLineCount = useMemo(
    () => (pineScript.length === 0 ? 0 : pineScript.replace(/\n$/, "").split("\n").length),
    [pineScript],
  );

  useEffect(() => {
    if (activeTab !== "move") return;
    if (!pineScript.trim()) {
      setMoveSource("// Add PineScript before generating the Move vault module.");
      setMoveErrors([]);
      return;
    }

    try {
      const result = transpileV3(
        pineScript,
        creatorAddress || "0xcreator",
        marketAddress ? { target: "vault", marketAddr: marketAddress } : {},
      );
      setMoveSource(result.moveSource);
      setMoveErrors(result.errors);
    } catch (error) {
      setMoveSource("// Transpilation failed. Fix the PineScript errors and try again.");
      setMoveErrors([error instanceof Error ? error.message : "Unknown transpilation error"]);
    }
  }, [activeTab, creatorAddress, marketAddress, pineScript]);

  useEffect(() => {
    setCopied(false);
  }, [activeTab, pineScript, moveSource]);

  const activeSource = activeTab === "pine" ? pineScript : moveSource;
  const activeLineCount = activeSource.length === 0
    ? 0
    : activeSource.replace(/\n$/, "").split("\n").length;

  const copySource = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(activeSource);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      setCopied(false);
    }
  }, [activeSource]);

  return (
    <section
      ref={hostRef}
      className="flex min-h-[430px] min-w-0 flex-col overflow-hidden rounded-[var(--radius-sm)] border border-card-border bg-background-secondary sm:min-h-[510px] lg:min-h-[560px]"
      aria-label="Strategy source editor"
    >
      <div className="flex min-h-10 shrink-0 items-stretch justify-between border-b border-card-border bg-background-tertiary">
        <div className="flex min-w-0 flex-1 overflow-x-auto overscroll-x-contain" role="tablist" aria-label="Strategy source files">
          {(["pine", "move"] as const).map((tab) => {
            const active = activeTab === tab;
            const label = tab === "pine" ? `${fileStem}.pine` : `${fileStem}.move`;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={label}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "relative flex min-w-0 shrink-0 items-center gap-2 border-r border-card-border px-3 font-mono text-[11px] transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60",
                  PRODUCT_PRESSABLE_CLASS,
                  active
                    ? "bg-background-secondary text-foreground"
                    : "bg-background-tertiary text-muted-foreground hover:bg-card-hover hover:text-foreground-secondary",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    tab === "pine" ? "bg-accent" : "bg-sky-400",
                  )}
                  aria-hidden="true"
                />
                <span className="sm:hidden">{tab === "pine" ? "Pine" : "Move"}</span>
                <span className="hidden max-w-[220px] truncate sm:inline">{label}</span>
                {active && <span className="absolute inset-x-0 bottom-0 h-px bg-accent" aria-hidden="true" />}
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 border-l border-card-border bg-background-tertiary px-1">
          {originalUrl && (
            <a
              href={originalUrl}
              target="_blank"
              rel="noreferrer"
              className={cn("hidden size-8 items-center justify-center rounded-[var(--radius-xs)] text-muted-foreground hover:bg-card-hover hover:text-foreground sm:flex", PRODUCT_PRESSABLE_CLASS)}
              aria-label="Open original PineScript source"
              title="Original source"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
          {activeTab === "pine" && (
            <button
              type="button"
              onClick={() => onEditingChange(!editing)}
              disabled={disabled}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-[var(--radius-xs)] px-2 font-display text-[11px] font-semibold text-muted-foreground hover:bg-card-hover hover:text-foreground disabled:opacity-40",
                PRODUCT_PRESSABLE_CLASS,
              )}
              aria-label={editing ? "Finish editing PineScript" : "Edit PineScript"}
            >
              {editing ? <Check className="size-3.5" aria-hidden="true" /> : <Pencil className="size-3.5" aria-hidden="true" />}
              <span className="hidden sm:inline">{editing ? "Done" : "Edit"}</span>
            </button>
          )}
          {canReset && onReset && (
            <button
              type="button"
              onClick={onReset}
              disabled={disabled}
              className={cn("flex size-8 items-center justify-center rounded-[var(--radius-xs)] text-muted-foreground hover:bg-card-hover hover:text-foreground disabled:opacity-40", PRODUCT_PRESSABLE_CLASS)}
              aria-label="Use default strategy source"
              title="Use default"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={copySource}
            disabled={!activeSource}
            className={cn("flex size-8 items-center justify-center rounded-[var(--radius-xs)] text-muted-foreground hover:bg-card-hover hover:text-foreground disabled:opacity-40", PRODUCT_PRESSABLE_CLASS)}
            aria-label={`Copy ${activeTab === "pine" ? "PineScript" : "Move"} source`}
          >
            {copied ? <Check className="size-3.5 text-accent" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {activeTab === "move" && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-card-border bg-sky-400/[0.035] px-3 py-2">
          <p className="min-w-0 text-[11px] leading-4 text-foreground-secondary">
            Generated vault module for the approved Decibel market. This is the code bound to the strategy commitment.
          </p>
          <span className={cn("shrink-0 font-mono text-[11px] uppercase tracking-[0.12em]", moveErrors.length > 0 ? "text-danger" : "text-sky-400")}>
            {moveErrors.length > 0 ? `${moveErrors.length} blocked` : "generated"}
          </span>
        </div>
      )}

      <div className="h-[360px] min-h-0 flex-1 sm:h-[440px] lg:h-[520px]">
        <MonacoEditor
          key={activeTab}
          height="100%"
          path={`${fileStem}.${activeTab === "pine" ? "pine" : "move"}`}
          language={activeTab}
          theme="cash-source"
          value={activeSource}
          beforeMount={(monaco) => {
            monacoRef.current = monaco;
            configureMonaco(monaco);
            defineSourceTheme(monaco, hostRef.current);
          }}
          onChange={(value) => {
            if (activeTab === "pine" && editing && !disabled) onPineChange(value ?? "");
          }}
          options={{
            ariaLabel: activeTab === "pine" ? "PineScript editor" : "Generated Move source",
            automaticLayout: true,
            bracketPairColorization: { enabled: true },
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            domReadOnly: activeTab === "move" || !editing || disabled,
            folding: true,
            fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontLigatures: true,
            fontSize: 12,
            glyphMargin: false,
            guides: { bracketPairs: true, indentation: true },
            hideCursorInOverviewRuler: true,
            lineHeight: 20,
            lineNumbers: "on",
            lineNumbersMinChars: 3,
            minimap: { enabled: false },
            mouseWheelZoom: false,
            overviewRulerBorder: false,
            overviewRulerLanes: 0,
            padding: { top: 12, bottom: 12 },
            readOnly: activeTab === "move" || !editing || disabled,
            renderLineHighlight: "gutter",
            renderWhitespace: "selection",
            scrollBeyondLastLine: false,
            scrollbar: {
              alwaysConsumeMouseWheel: false,
              horizontalScrollbarSize: 9,
              verticalScrollbarSize: 9,
            },
            smoothScrolling: true,
            stickyScroll: { enabled: false },
            tabSize: 4,
            wordWrap: "off",
          }}
        />
      </div>

      <footer className="flex min-h-7 shrink-0 items-center justify-between gap-3 border-t border-card-border bg-background-tertiary px-3 font-mono text-[11px] text-muted-foreground">
        <span>{activeTab === "pine" ? "PineScript" : "Move"}</span>
        <span className="tabular-nums">
          {activeTab === "pine" ? `${pineLineCount.toLocaleString()} lines · ${pineScript.length.toLocaleString()} chars` : `${activeLineCount.toLocaleString()} lines · read only`}
        </span>
      </footer>
    </section>
  );
}
