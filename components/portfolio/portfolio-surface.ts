/**
 * The one set of surface recipes /portfolio renders.
 *
 * Portfolio is the shell Points and Launchpad were rebuilt from, so it may not
 * carry a private palette: every value below resolves to a `.cash-trade-theme`
 * token (docs/UX-GRADING.md § 4). Before this file the page mixed
 * `rounded-[4px]`/`rounded-[3px]` with `#1a1a1a`/`#242424`/`#141414`/`#050505`
 * borders and fills, which the light theme could only rescue through the
 * literal-hex allow-list in globals.css — one new hex and the surface stayed
 * dark on a white page.
 *
 * Both stat grids (page header, CASH rewards) share STAT_*; both tables share
 * TABLE_*; both mobile lists share CARD_ROW_*. Adding a fourth shape is the
 * thing this file exists to stop.
 */

import { FOCUS_RING, PRESSABLE_CONTROL, SURFACE_CONTROL } from "@/lib/surface";

/**
 * PANEL and BUTTON_PRIMARY are defined in lib/surface.ts — the two files used
 * to carry their own copy of the same recipe, which is how the app ended up
 * with two live surface libraries for one role. Re-exported, not redefined, so
 * every call site that already imports them from here keeps working while
 * there is only one string to change.
 */
export { BUTTON_PRIMARY, PANEL } from "@/lib/surface";

/* ── Sections ───────────────────────────────────────────────────────────── */

/** Gap between top-level sections on the page. One value, not mt-4/8/10. */
export const SECTION_GAP = "mt-6";

/**
 * Page-level section heading — the sans face, sized by role rather than by
 * tag. (globals.css no longer sets a font-family on h1-h6: it was rendering
 * every page title in JetBrains Mono next to identically-sized <p> text in
 * Inter.) Now the single source for all four page titles: Portfolio, Points,
 * Vaults and Leaderboard all render this string, so one change moves them
 * together — do not re-inline `text-[18px] font-semibold text-zinc-200`.
 */
export const SECTION_TITLE = "text-balance text-lg font-semibold text-zinc-200";

/** Panel header strip. */
export const PANEL_TITLE = "text-[13px] font-semibold text-foreground";

/* ── Stat grid ──────────────────────────────────────────────────────────── */

/**
 * Hairline-separated tiles. The 1px gaps are the card-border token showing
 * through, so the rule colour tracks the theme instead of a literal grey.
 */
export const STAT_GRID = "grid gap-px bg-card-border";
/** The same grid when it is the outermost surface rather than inside a panel. */
export const STAT_GRID_PANEL = `overflow-hidden rounded-[var(--radius)] border border-card-border ${STAT_GRID}`;
export const STAT_TILE = "bg-background-secondary px-4 py-4";
export const STAT_LABEL = "text-[11px] uppercase tracking-wide text-muted-foreground";
export const STAT_VALUE =
  "mt-2 block font-mono text-2xl font-semibold tabular-nums text-foreground";
export const STAT_NOTE = "mt-2 text-[11px] text-muted-foreground";

/* ── Controls ───────────────────────────────────────────────────────────── */

/** Everything that sits next to the primary action. Same shell as any other
 *  control, so it is composed from SURFACE_CONTROL rather than restating it. */
export const BUTTON_NEUTRAL = `inline-flex h-10 items-center justify-center ${SURFACE_CONTROL} px-4 text-sm font-medium text-foreground hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40 ${PRESSABLE_CONTROL} ${FOCUS_RING}`;

/** A real action that must not compete with the page's one accent fill. */
export const BUTTON_ACCENT_OUTLINE = `inline-flex h-10 w-full items-center justify-center rounded-[var(--radius-sm)] border border-accent/30 px-4 text-[13px] font-semibold text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:border-card-border disabled:text-muted-foreground disabled:hover:bg-transparent ${PRESSABLE_CONTROL} ${FOCUS_RING}`;

/** Inline action inside a row (Close, Cancel). 44px tall on a phone. */
export const ROW_ACTION = `inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-xs)] text-[13px] underline underline-offset-4 hover:text-foreground disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40 md:min-h-0 ${FOCUS_RING}`;

/** 2–5 equal options (chart metric, chart range). */
export const SEGMENTED =
  "flex items-center gap-1 rounded-[var(--radius-sm)] border border-card-border bg-background-tertiary p-1";
export const SEGMENTED_ITEM = `inline-flex min-h-11 items-center rounded-[var(--radius-xs)] px-2.5 text-xs text-muted-foreground hover:text-foreground sm:min-h-8 ${PRESSABLE_CONTROL} ${FOCUS_RING}`;
export const SEGMENTED_ITEM_ACTIVE = "bg-card text-foreground";

/** In-panel content tabs (Positions / Open orders / Balances). */
export const TAB = `inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-[13px] text-muted-foreground hover:text-foreground ${PRESSABLE_CONTROL} ${FOCUS_RING}`;
export const TAB_ACTIVE = "border-foreground text-foreground";

/** Text input inside a dialog. 16px on mobile so iOS does not zoom. */
export const INPUT = `mt-1 w-full rounded-[var(--radius-sm)] border border-card-border bg-background px-3 py-2 font-mono text-base text-foreground placeholder:text-muted-foreground focus-visible:border-border-strong disabled:opacity-40 sm:text-sm ${FOCUS_RING}`;
export const INPUT_LABEL = "text-[11px] uppercase tracking-wide text-muted-foreground";

/* ── Tables and their mobile card equivalents ───────────────────────────── */

export const TABLE = "w-full text-left text-[13px]";
export const TABLE_HEAD =
  "[&>th]:px-4 [&>th]:py-3 [&>th]:text-[11px] [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted-foreground";
export const TABLE_ROW =
  "border-t border-card-border text-foreground [&>td]:px-4 [&>td]:py-3";
export const TABLE_EMPTY = "px-4 py-12 text-center text-[13px] text-muted-foreground";

export const CARD_ROW = "border-t border-card-border px-4 py-4 text-[13px] text-foreground";
export const CARD_ROW_GRID = "mt-3 grid grid-cols-2 gap-x-4 gap-y-3";
export const CARD_ROW_LABEL = "text-[11px] uppercase tracking-wide text-muted-foreground";
export const CARD_ROW_VALUE = "mt-0.5 font-mono text-xs tabular-nums";

/* ── Semantics ──────────────────────────────────────────────────────────── */

/**
 * Gain / loss / unknown, from the one success–danger pair. Colour is never the
 * only carrier of direction here: every caller renders a signed number.
 */
export function signTone(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "text-muted-foreground";
  return value >= 0 ? "text-success" : "text-danger";
}
