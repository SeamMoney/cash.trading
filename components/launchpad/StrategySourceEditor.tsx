"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BeforeMount } from "@monaco-editor/react";
import { Check, Copy, ExternalLink, Pencil, RotateCcw } from "lucide-react";

import { transpileV3 } from "@/lib/launchpad/transpiler-v3";
import { cn } from "@/lib/utils";
import { PRODUCT_PRESSABLE_CLASS } from "@/components/ui/product-surface";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((module) => module.default),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-full min-h-[360px] animate-pulse bg-[#0d0d0d] sm:min-h-[440px] lg:min-h-[520px]"
        aria-label="Loading source editor"
      />
    ),
  },
);

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
    colors: {
      "editor.background": "#0d0d0d",
      "editor.foreground": "#d4d4d8",
      "editorLineNumber.foreground": "#48484f",
      "editorLineNumber.activeForeground": "#a1a1aa",
      "editorCursor.foreground": "#76ff45",
      "editor.selectionBackground": "#294B2C",
      "editor.inactiveSelectionBackground": "#1D3220",
      "editor.lineHighlightBackground": "#141414",
      "editorGutter.background": "#0d0d0d",
      "editorIndentGuide.background1": "#202024",
      "editorIndentGuide.activeBackground1": "#35353a",
      "editorWidget.background": "#171717",
      "editorWidget.border": "#2b2b2f",
      "scrollbarSlider.background": "#3f3f4666",
      "scrollbarSlider.hoverBackground": "#52525b88",
      "scrollbarSlider.activeBackground": "#71717aaa",
    },
  });
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
      className="flex min-h-[430px] min-w-0 flex-col overflow-hidden rounded-[var(--radius-sm)] border border-card-border bg-[#0d0d0d] sm:min-h-[510px] lg:min-h-[560px]"
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
                  "relative flex min-w-0 shrink-0 items-center gap-2 border-r border-card-border px-3 font-mono text-[10px] transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60",
                  PRODUCT_PRESSABLE_CLASS,
                  active
                    ? "bg-[#0d0d0d] text-foreground"
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
                "flex h-8 items-center gap-1.5 rounded-[var(--radius-xs)] px-2 font-display text-[10px] font-semibold text-muted-foreground hover:bg-card-hover hover:text-foreground disabled:opacity-40",
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
          <p className="min-w-0 text-[10px] leading-4 text-foreground-secondary">
            Generated vault module for the approved Decibel market. This is the code bound to the strategy commitment.
          </p>
          <span className={cn("shrink-0 font-mono text-[9px] uppercase tracking-[0.12em]", moveErrors.length > 0 ? "text-red-400" : "text-sky-400")}>
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
          beforeMount={configureMonaco}
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

      <footer className="flex min-h-7 shrink-0 items-center justify-between gap-3 border-t border-card-border bg-background-tertiary px-3 font-mono text-[9px] text-muted-foreground">
        <span>{activeTab === "pine" ? "PineScript" : "Move"}</span>
        <span className="tabular-nums">
          {activeTab === "pine" ? `${pineLineCount.toLocaleString()} lines · ${pineScript.length.toLocaleString()} chars` : `${activeLineCount.toLocaleString()} lines · read only`}
        </span>
      </footer>
    </section>
  );
}
