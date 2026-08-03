/**
 * Surface tokens — the canonical borders, radii and fills.
 *
 * Derived by auditing components/trade/, which is the design reference for the
 * whole app. The dominant values there are:
 *
 *   radius   rounded-[16px] every block >= 240x60 (panels AND cards)
 *            rounded-[10px] controls · rounded-full pills
 *   border   border-white/[0.06] throughout
 *   fill     bg-white/[0.03]–[0.04] translucent · #141414 / #111 solid
 *
 * Measured from the running trade page (computed styles on every element
 * >= 240x60px), not inferred from grep — counting class occurrences over-weights
 * small controls. Tailwind's named scale does NOT match: with
 * `--radius: 0.75rem`, `rounded-2xl` is 20px against the trade page's 16px. Use these constants rather than the named scale so the launchpad
 * and the trade page stay identical.
 *
 * `pnpm test:reliability` fails if the sealed/agent/interaction components
 * reintroduce the named scale or the old hard `#2a2a2a` border.
 */

/** Outer panel — the biggest containers on a page. */
export const SURFACE_PANEL = "rounded-[16px] border border-white/[0.06] bg-[#111]";

/** Card sitting inside a panel, or a standalone content block. Same 16px as a
 *  panel: the trade page renders everything >= 240x60 at 16px, so a smaller
 *  radius on a block of that size is what reads as "bolted on". */
export const SURFACE_CARD = "rounded-[16px] border border-white/[0.06] bg-white/[0.03]";

/** A solid card where translucency would muddy nested content (e.g. code). */
export const SURFACE_CARD_SOLID = "rounded-[16px] border border-white/[0.06] bg-[#141414]";

/** Inputs, buttons, list rows — anything interactive inside a card. */
export const SURFACE_CONTROL = "rounded-[10px] border border-white/[0.06] bg-[#0d0d0d]";

/** Inset region: a header strip or footer inside a card. */
export const SURFACE_INSET = "border-white/[0.06] bg-white/[0.03]";

/** Radii alone, when the border/fill differ (e.g. tonal banners). */
export const RADIUS = {
  panel: "rounded-[16px]",
  card: "rounded-[16px]",
  control: "rounded-[10px]",
  pill: "rounded-full",
} as const;

/** Border alone. */
export const BORDER = {
  panel: "border-white/[0.06]",
  inner: "border-white/[0.06]",
  hover: "hover:border-white/20",
  active: "border-accent/50",
} as const;
