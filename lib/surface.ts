/**
 * Surface tokens — the canonical borders, radii and fills.
 *
 * Derived by auditing components/trade/, which is the design reference for the
 * whole app. The values remain owned by `.cash-trade-theme` rather than being
 * copied into feature components:
 *
 *   radius   --radius panels/cards · --radius-sm controls · full pills
 *   border   --card-border, with --border-strong for hover
 *   fill     --background-secondary / --background-tertiary / --card
 *
 * Measured from the running trade page (computed styles on every element
 * >= 240x60px), not inferred from grep — counting class occurrences over-weights
 * small controls. The named Tailwind scale (`rounded-lg`, `rounded-2xl`) now
 * snaps to the same three values in globals.css, but the var() form below is
 * still the one to write: it says which role a surface plays.
 *
 * `pnpm test:reliability` fails if product workflows bypass these semantic
 * tokens with their own private palette or modal grammar.
 */

/** Outer panel — the biggest containers on a page. */
export const SURFACE_PANEL =
  "rounded-[var(--radius)] border border-card-border bg-background-secondary";

/** Card sitting inside a panel, or a standalone content block. Same 16px as a
 *  panel: the trade page renders everything >= 240x60 at 16px, so a smaller
 *  radius on a block of that size is what reads as "bolted on". */
export const SURFACE_CARD =
  "rounded-[var(--radius)] border border-card-border bg-card";

/** A solid card where translucency would muddy nested content (e.g. code). */
export const SURFACE_CARD_SOLID =
  "rounded-[var(--radius)] border border-card-border bg-card-solid";

/** Inputs, buttons, list rows — anything interactive inside a card. */
export const SURFACE_CONTROL =
  "rounded-[var(--radius-sm)] border border-card-border bg-background-secondary";

/** Direct-manipulation feedback shared by buttons, cards and selector rows. */
export const PRESSABLE_CONTROL =
  "select-none transition-[background-color,border-color,color,opacity,filter,transform] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] active:duration-150 motion-reduce:!scale-100 motion-reduce:transform-none motion-reduce:transition-none";

/** Inset region: a header strip or footer inside a card. */
export const SURFACE_INSET = "border-card-border bg-card";

/** Keyboard focus for anything that opts out of the global outline
 *  (globals.css gives button/a/input a 2px --ring outline by default). Use
 *  this when a control needs `outline-none` for its own hover/active styling. */
export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Radii alone, when the border/fill differ (e.g. tonal banners). */
export const RADIUS = {
  panel: "rounded-[var(--radius)]",
  card: "rounded-[var(--radius)]",
  control: "rounded-[var(--radius-sm)]",
  chip: "rounded-[var(--radius-xs)]",
  pill: "rounded-full",
} as const;

/** Border alone. */
export const BORDER = {
  panel: "border-card-border",
  inner: "border-card-border",
  hover: "hover:border-border-strong",
  active: "border-accent/50",
} as const;
