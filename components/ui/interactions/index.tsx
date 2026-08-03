"use client";

/**
 * Micro-interaction primitives, following interior.dev's ten categories.
 *
 * interior.dev's thesis is that these are not hard components — that's exactly
 * why they get done badly. The rules it encodes, which this file follows:
 *   · one easing curve everywhere; mixed easing reads as jank
 *   · short durations (≤ 200ms) for feedback, slightly longer for entrances
 *   · every animation has a reduced-motion path that is not "no feedback"
 *   · feedback is tied to real state, never fired optimistically
 *
 * Built on `motion`, already a dependency. Numeric transitions reuse
 * `@number-flow/react`, also already present.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { AlertTriangle, Check, Info, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";

export const EASE = [0.16, 1, 0.3, 1] as const;
export const FAST = 0.16;
export const MED = 0.22;

// ─── 1. Action feedback ──────────────────────────────────────────────────────

/** A button that morphs through idle → pending → success/failure and settles
 *  back. The label never jumps: states cross-fade in a fixed-height box. */
export function ActionButton({
  onClick,
  state = "idle",
  children,
  successLabel = "Done",
  errorLabel = "Failed",
  disabled,
  variant = "primary",
  className,
}: {
  onClick?: () => void;
  state?: "idle" | "pending" | "success" | "error";
  children: React.ReactNode;
  successLabel?: string;
  errorLabel?: string;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const reduced = useReducedMotion();
  const content =
    state === "pending" ? (
      <span className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {children}
      </span>
    ) : state === "success" ? (
      <span className="flex items-center gap-2">
        <Check className="h-4 w-4" aria-hidden /> {successLabel}
      </span>
    ) : state === "error" ? (
      <span className="flex items-center gap-2">
        <X className="h-4 w-4" aria-hidden /> {errorLabel}
      </span>
    ) : (
      children
    );

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled || state === "pending"}
      whileTap={reduced || disabled ? undefined : { scale: 0.985 }}
      transition={{ duration: FAST, ease: EASE }}
      aria-busy={state === "pending"}
      className={cn(
        "relative flex w-full items-center justify-center rounded-xl px-5 py-3.5 font-display text-[14px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary"
          ? "bg-accent text-accent-foreground hover:opacity-90"
          : "border border-[#2a2a2a] bg-[#1a1a1a] text-white hover:border-accent/50",
        state === "error" && "bg-red-500 text-white",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, y: reduced ? 0 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduced ? 0 : -4 }}
          transition={{ duration: FAST, ease: EASE }}
        >
          {content}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

// ─── 2. Input feedback ───────────────────────────────────────────────────────

/** Field with inline validation that appears on blur, not on every keystroke —
 *  validating mid-typing is the classic way this gets done badly. */
export function ValidatedField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  validate,
  disabled,
  id,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  validate?: (v: string) => string | null;
  disabled?: boolean;
  id?: string;
}) {
  const [touched, setTouched] = useState(false);
  const reduced = useReducedMotion();
  const err = touched && validate ? validate(value) : null;
  const fieldId = id ?? label.toLowerCase().replace(/\W+/g, "-");

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor={fieldId} className="font-display text-[13px] font-semibold text-white">
          {label}
        </label>
        {hint && <span className="text-[10px] text-zinc-600">{hint}</span>}
      </div>
      <motion.input
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={Boolean(err)}
        aria-describedby={err ? `${fieldId}-err` : undefined}
        animate={err && !reduced ? { x: [0, -3, 3, -2, 0] } : { x: 0 }}
        transition={{ duration: 0.24, ease: EASE }}
        className={cn(
          "w-full rounded-lg border bg-[#0d0d0d] px-3 py-2.5 text-[13px] text-white placeholder:text-zinc-600 focus:outline-none disabled:opacity-50",
          err ? "border-red-500/60" : "border-[#2a2a2a] focus:border-accent/40",
        )}
      />
      <AnimatePresence>
        {err && (
          <motion.p
            id={`${fieldId}-err`}
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: FAST, ease: EASE }}
            className="mt-1 text-[11px] text-red-400"
          >
            {err}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 3. Async ────────────────────────────────────────────────────────────────

/** Skeleton that holds the final layout so content swap causes no reflow. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-lg border border-[#2a2a2a] bg-[#141414]", className)}
    />
  );
}

/** Content-state wrapper: loading → error → empty → content, cross-faded. */
export function ContentState({
  loading,
  error,
  empty,
  skeleton,
  emptyState,
  children,
}: {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  skeleton?: React.ReactNode;
  emptyState?: React.ReactNode;
  children: React.ReactNode;
}) {
  const key = loading ? "loading" : error ? "error" : empty ? "empty" : "content";
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={key}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: MED, ease: EASE }}
      >
        {loading
          ? (skeleton ?? <Skeleton className="h-32 w-full" />)
          : error
            ? (
              <div
                role="alert"
                className="rounded-xl border border-red-500/40 bg-red-500/5 px-5 py-6 text-center"
              >
                <p className="text-[12px] text-red-400">{error}</p>
              </div>
            )
            : empty
              ? emptyState
              : children}
      </motion.div>
    </AnimatePresence>
  );
}

// ─── 4. Notification ─────────────────────────────────────────────────────────

export function Banner({
  tone = "info",
  children,
  onDismiss,
}: {
  tone?: "info" | "success" | "warn" | "error";
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const Icon = tone === "success" ? Check : tone === "warn" ? AlertTriangle : tone === "error" ? X : Info;
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: MED, ease: EASE }}
      role={tone === "error" || tone === "warn" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border p-3.5",
        tone === "info" && "border-[#2a2a2a] bg-[#141414]",
        tone === "success" && "border-accent/40 bg-accent/5",
        tone === "warn" && "border-amber-500/30 bg-amber-500/5",
        tone === "error" && "border-red-500/40 bg-red-500/5",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          tone === "success" && "text-accent",
          tone === "warn" && "text-amber-400",
          tone === "error" && "text-red-400",
          tone === "info" && "text-zinc-500",
        )}
        aria-hidden
      />
      <div
        className={cn(
          "min-w-0 flex-1 text-[12px] leading-snug",
          tone === "success" && "text-accent",
          tone === "warn" && "text-amber-400/90",
          tone === "error" && "text-red-400",
          tone === "info" && "text-zinc-400",
        )}
      >
        {children}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 text-zinc-600 transition-colors hover:text-white"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </motion.div>
  );
}

// ─── 5. Overlay ──────────────────────────────────────────────────────────────

/** Modal with focus restore and escape-to-close. Backdrop and panel animate on
 *  separate curves so the panel doesn't feel glued to the fade. */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const restoreTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      restoreTo.current = document.activeElement as HTMLElement;
      const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("keydown", onKey);
        restoreTo.current?.focus?.();
      };
    }
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: FAST, ease: EASE }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: MED, ease: EASE }}
            className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#111] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#2a2a2a] px-4 py-3">
              <h2 className="font-display text-[14px] font-bold text-white">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded p-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── 6. Data — numeric change ────────────────────────────────────────────────

/** Animated number. Uses @number-flow/react so digits roll instead of jumping. */
export function AnimatedNumber({
  value,
  prefix,
  suffix,
  decimals = 0,
  className,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}) {
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {prefix}
      <NumberFlow
        value={value}
        format={{ minimumFractionDigits: decimals, maximumFractionDigits: decimals }}
      />
      {suffix}
    </span>
  );
}

// ─── 7. Content — reveal ─────────────────────────────────────────────────────

/** Staggered entrance for a list. `index` drives the delay. */
export function Reveal({
  index = 0,
  children,
  className,
}: {
  index?: number;
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: reduced ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MED, ease: EASE, delay: reduced ? 0 : Math.min(index * 0.035, 0.25) }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── 8. Gesture — pressable ──────────────────────────────────────────────────

export function Pressable({
  onClick,
  children,
  className,
  disabled,
  ariaPressed,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  ariaPressed?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={ariaPressed}
      whileTap={reduced || disabled ? undefined : { scale: 0.99 }}
      transition={{ duration: FAST, ease: EASE }}
      className={className}
    >
      {children}
    </motion.button>
  );
}
