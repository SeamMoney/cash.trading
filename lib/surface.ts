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

/**
 * The `<main>` element's class — the page shell.
 *
 * The app shipped FIVE of these (900 on /points and /launchpad, max-w-7xl on
 * /automation, 1536 on /portfolio, 1800 on /trade and /swap), so the content's
 * left edge moved ~230px as you changed tabs. Two tiers, not five:
 *
 *   PAGE_SHELL       reading pages — a list, a leaderboard, a form. A row has
 *                    to read as a row: at 1536 the /points leaderboard stretched
 *                    to 1368px around ~570px of content, putting a rank 470px
 *                    from its AMPs.
 *   PAGE_SHELL_WIDE  the dense pages — /portfolio, /trade, /swap — where three
 *                    columns (chart + book + ticket) genuinely need the width.
 *                    1536 is /portfolio's existing value; adopting it on /trade
 *                    and /swap is what makes those three agree.
 *
 * Both carry the same gutters, so on any viewport below the narrow tier's
 * max-width every page in the app starts its content at exactly the same x.
 *
 * A page that needs a tighter vertical rhythm than py-8 (the trade page runs
 * py-3/4/5 so the chart clears the fold) overrides it through `cn`, which is
 * tailwind-merge: `cn(PAGE_SHELL_WIDE, "py-3 sm:py-4 lg:py-5")`. Override the
 * padding, never the width — the width is the thing being made consistent.
 */
export const PAGE_SHELL = "mx-auto w-full max-w-[900px] px-4 py-8 sm:px-8";

/** @see PAGE_SHELL — the dense tier. */
export const PAGE_SHELL_WIDE = "mx-auto w-full max-w-[1536px] px-4 py-8 sm:px-8";

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

/**
 * A panel that clips its own content — the shape every page-level container on
 * /portfolio, /points, /launchpad and /automation renders.
 *
 * It is the same surface as SURFACE_PANEL plus the clip, so it is composed from
 * it rather than restating the recipe: the app used to ship two live copies of
 * this string (here and in components/portfolio/portfolio-surface.ts), which is
 * how a border token can change in one half of the product and not the other.
 * portfolio-surface.ts re-exports this name, so both import paths resolve to
 * this one definition.
 */
export const PANEL = `overflow-hidden ${SURFACE_PANEL}`;

/**
 * The one primary action per screen. The accent fill is what makes it primary.
 *
 * Sized so no page has to shrink to adopt it: 44px on a phone (D5 wants a 44px
 * hit area) and the canonical 40px control height from `sm` up (§ 4.5) — the
 * same `min-h-11 … sm:` idiom the OrderBook rows use. Lived in
 * portfolio-surface.ts until the trade-side swap flows started importing it
 * across the folder boundary; it belongs with the other shared surfaces.
 *
 * Still to adopt it: TradePanel.tsx's submit button, and any 4px-radius
 * primary left on /points — the radius is the control token, never `rounded`.
 */
export const BUTTON_PRIMARY = `inline-flex min-h-11 items-center justify-center rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-semibold text-accent-foreground hover:brightness-95 disabled:pointer-events-none disabled:opacity-40 sm:h-10 sm:min-h-0 ${PRESSABLE_CONTROL} ${FOCUS_RING}`;

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
