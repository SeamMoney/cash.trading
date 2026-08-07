"use client";

/**
 * Agent-surface UI kit.
 *
 * The component vocabulary from aicss.dev (code block, thinking state, task
 * list, diff, streaming text, data table) rendered in cash.trading's own
 * tokens rather than copied wholesale — the trade page's look is a hard
 * requirement, so these use `--accent`, the `#0d0d0d`/`#141414`/`#2a2a2a`
 * surface ramp and the display/mono type pairing used everywhere else.
 *
 * Motion follows interior.dev's rules: every transition is short (≤ 200ms),
 * eased with a single curve, and disabled under `prefers-reduced-motion`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronRight, Copy, Loader2, X } from "lucide-react";

import { tokenizePineLine, type PineTokenKind } from "@/lib/launchpad/pine-highlight";
import { cn } from "@/lib/utils";

/** One easing curve across the whole kit — interior.dev's core discipline is
 *  that inconsistent easing reads as jank even when each piece is fine. */
export const EASE = [0.16, 1, 0.3, 1] as const;
export const DUR = 0.18;

// ─── Code block ──────────────────────────────────────────────────────────────

const PINE_TOKEN_CLASS: Record<PineTokenKind, string> = {
  plain: "text-zinc-300",
  comment: "text-[#6f9f72]",
  string: "text-[#a5cf7c]",
  number: "text-[#d7a36e]",
  keyword: "text-[#78a9f4]",
  type: "text-[#58c4c7]",
  builtin: "text-[#c49ae8]",
  function: "text-[#e4cf83]",
  operator: "text-[#8fb7e8]",
};

export function CodeBlock({
  code,
  language = "pinescript",
  filename,
  maxHeight = 320,
  lineNumbers = true,
  actions,
}: {
  code: string;
  language?: string;
  filename?: string;
  maxHeight?: number | string;
  lineNumbers?: boolean;
  actions?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ top: false, right: false, bottom: false, left: false });
  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  }, [code]);

  const isPine = language === "pine" || language === "pinescript";
  const lines = useMemo(() => code.replace(/\n$/, "").split("\n").map((line) => ({
    line,
    tokens: isPine && line ? tokenizePineLine(line) : null,
  })), [code, isPine]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const update = () => {
      const next = {
        top: viewport.scrollTop > 2,
        right: viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 2,
        bottom: viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 2,
        left: viewport.scrollLeft > 2,
      };
      setScrollEdges((current) => (
        current.top === next.top && current.right === next.right
        && current.bottom === next.bottom && current.left === next.left
          ? current
          : next
      ));
    };

    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [code, maxHeight]);

  return (
    <div className="overflow-hidden rounded-[16px] border border-white/[0.06] bg-[#0d0d0d]">
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#141414] px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-zinc-400">
            {language}
          </span>
          {filename && (
            <span className="truncate font-mono text-[11px] text-zinc-500">{filename}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={copy}
            aria-label="Copy code"
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <AnimatePresence mode="wait" initial={false}>
              {copied ? (
                <motion.span
                  key="ok"
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.7, opacity: 0 }}
                  transition={{ duration: DUR, ease: EASE }}
                  className="block text-accent"
                >
                  <Check className="h-3.5 w-3.5" />
                </motion.span>
              ) : (
                <motion.span
                  key="copy"
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.7, opacity: 0 }}
                  transition={{ duration: DUR, ease: EASE }}
                  className="block"
                >
                  <Copy className="h-3.5 w-3.5" />
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
      </div>
      <div className="relative">
        <div
          ref={viewportRef}
          tabIndex={0}
          aria-label={filename ? `${filename} source code` : `${language} source code`}
          className="overflow-auto overscroll-contain outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/20"
          style={{ maxHeight }}
        >
          <pre className="min-w-full w-max p-3 pb-5 font-mono text-[11px] leading-[1.65] text-zinc-300">
            <code>
              {lines.map(({ line, tokens }, lineIndex) => (
                <div key={lineIndex} className="flex min-h-[1.65em]">
                  {lineNumbers && (
                    <span className="mr-4 w-8 shrink-0 select-none text-right text-zinc-700 tabular-nums">
                      {lineIndex + 1}
                    </span>
                  )}
                  <span className="whitespace-pre pr-5">
                    {line
                      ? tokens
                        ? tokens.map((token, tokenIndex) => (
                            <span key={`${lineIndex}-${tokenIndex}`} className={PINE_TOKEN_CLASS[token.kind]}>
                              {token.text}
                            </span>
                          ))
                        : line
                      : " "}
                  </span>
                </div>
              ))}
            </code>
          </pre>
        </div>
        {scrollEdges.top && <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-[#0d0d0d] to-transparent" />}
        {scrollEdges.right && <div className="pointer-events-none absolute inset-y-0 right-0 w-7 bg-gradient-to-l from-[#0d0d0d] to-transparent" />}
        {scrollEdges.bottom && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-[#0d0d0d] to-transparent" />}
        {scrollEdges.left && <div className="pointer-events-none absolute inset-y-0 left-0 w-7 bg-gradient-to-r from-[#0d0d0d] to-transparent" />}
      </div>
    </div>
  );
}

// ─── Thinking state ──────────────────────────────────────────────────────────

/** Shown while the transpiler works. The reasoning lines are real steps, not
 *  decoration — an empty `steps` renders just the shimmer. */
export function ThinkingState({
  label = "Working…",
  steps = [],
  done = false,
}: {
  label?: string;
  steps?: string[];
  done?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="rounded-[16px] border border-white/[0.06] bg-[#141414] p-3.5">
      <div className="flex items-center gap-2">
        {done ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
        ) : (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-500" aria-hidden />
        )}
        <span
          className={cn(
            "font-display text-[12px] font-semibold",
            done ? "text-white" : "bg-clip-text text-transparent",
          )}
          style={
            done || reduced
              ? undefined
              : {
                  backgroundImage:
                    "linear-gradient(90deg,#6b7280 0%,#e5e7eb 45%,#6b7280 90%)",
                  backgroundSize: "200% 100%",
                  animation: "agent-shimmer 1.6s linear infinite",
                }
          }
        >
          {label}
        </span>
      </div>
      {steps.length > 0 && (
        <ul className="mt-2.5 space-y-1 border-l border-white/[0.06] pl-3">
          {steps.map((s, i) => (
            <motion.li
              key={s}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: DUR, ease: EASE, delay: reduced ? 0 : i * 0.04 }}
              className="text-[11px] leading-snug text-zinc-500"
            >
              {s}
            </motion.li>
          ))}
        </ul>
      )}
      <style>{`@keyframes agent-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
    </div>
  );
}

// ─── Task list ───────────────────────────────────────────────────────────────

export type TaskState = "pending" | "active" | "done" | "failed";
export interface AgentTask {
  id: string;
  label: string;
  detail?: string;
  state: TaskState;
}

/** The deploy pipeline as a live checklist. */
export function TaskList({ tasks }: { tasks: AgentTask[] }) {
  return (
    <ol className="space-y-1.5">
      {tasks.map((t) => (
        <motion.li
          key={t.id}
          layout
          transition={{ duration: DUR, ease: EASE }}
          className={cn(
            "flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 transition-colors",
            t.state === "done" && "border-accent/30 bg-accent/[0.04]",
            t.state === "active" && "border-white/20 bg-white/[0.03]",
            t.state === "failed" && "border-red-500/40 bg-red-500/[0.04]",
            t.state === "pending" && "border-white/[0.06] bg-[#141414]",
          )}
        >
          <span className="mt-0.5 shrink-0">
            {t.state === "done" && <Check className="h-3.5 w-3.5 text-accent" aria-hidden />}
            {t.state === "active" && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-white" aria-hidden />
            )}
            {t.state === "failed" && <X className="h-3.5 w-3.5 text-red-400" aria-hidden />}
            {t.state === "pending" && (
              <ChevronRight className="h-3.5 w-3.5 text-zinc-700" aria-hidden />
            )}
          </span>
          <span className="min-w-0">
            <span
              className={cn(
                "block font-display text-[12px] font-semibold",
                t.state === "pending" ? "text-zinc-500" : "text-white",
              )}
            >
              {t.label}
            </span>
            {t.detail && (
              <span className="mt-0.5 block break-all text-[10px] leading-snug text-zinc-500">
                {t.detail}
              </span>
            )}
          </span>
        </motion.li>
      ))}
    </ol>
  );
}

// ─── Diff ────────────────────────────────────────────────────────────────────

/** Side-by-side source → compiled view. Used for Pine → Move. */
export function DiffView({
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  left: string;
  right: string;
  leftLabel: string;
  rightLabel: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      <CodeBlock code={left} language="pinescript" filename={leftLabel} maxHeight={280} />
      <CodeBlock code={right} language="move" filename={rightLabel} maxHeight={280} />
    </div>
  );
}

// ─── Data table ──────────────────────────────────────────────────────────────

export function DataTable({
  columns,
  rows,
  caption,
}: {
  columns: string[];
  rows: Array<Array<React.ReactNode>>;
  caption?: string;
}) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-white/[0.06] bg-[#141414]">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {columns.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className="px-3 py-2 text-[9px] uppercase tracking-wide text-zinc-600"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i > 0 ? "border-t border-white/[0.06]" : undefined}>
                {r.map((cell, j) => (
                  <td
                    key={j}
                    className={cn(
                      "px-3 py-2 text-[11px]",
                      j === 0 ? "text-zinc-300" : "font-mono tabular-nums text-zinc-400",
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption && (
        <p className="border-t border-white/[0.06] px-3 py-2 text-[10px] leading-snug text-zinc-600">
          {caption}
        </p>
      )}
    </div>
  );
}

// ─── Streaming text ──────────────────────────────────────────────────────────

/** Types a status line out. Respects reduced motion by rendering instantly. */
export function StreamingText({ text, className }: { text: string; className?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? text : "");
  const raf = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (reduced) {
      setShown(text);
      return;
    }
    setShown("");
    let i = 0;
    const step = () => {
      i += 2;
      setShown(text.slice(0, i));
      if (i < text.length) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [text, reduced]);

  return (
    <span className={className}>
      {shown}
      {!reduced && shown.length < text.length && (
        <span className="ml-0.5 inline-block h-3 w-1.5 translate-y-px animate-pulse bg-accent" />
      )}
    </span>
  );
}

// ─── Inline citation / reference chip ────────────────────────────────────────

export function RefChip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="mx-0.5 inline-flex items-center rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
    >
      {children}
    </span>
  );
}
