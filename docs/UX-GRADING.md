# UX Grading Framework — cash.trading

How every page gets driven to an A+ **from the user's point of view**. Grade a page, fix the
lowest dimension first, re-grade. The companion lint (`pnpm exec tsx scripts/ux-lint.ts`) is a
deterministic signal for dimensions 1, 3, 6 and 9; everything else is graded by a human looking at
the page at 320px, 390px, 768px and 1440px in both themes.

Pages in scope: `/` (trade), `/portfolio`, `/launchpad`, `/points`, `/automation`, `/swap`,
`/explainer`, plus the shared shells (`components/layout/Header.tsx`, modals/sheets in
`components/ui/*`).

---

## 1. Scoring

Ten dimensions, each 0–10. Score against the **observable criteria** below, not against a feeling.
Pick the highest band whose criteria are *all* met; if a page meets most of a band but breaks one
criterion, score one point below that band's anchor (e.g. 9 or 6).

| Letter | Rule |
|---|---|
| **A+** | total ≥ 95 **and** no dimension < 9 |
| **A** | total ≥ 90 |
| **B** | total ≥ 80 |
| **C** | total ≥ 70 |
| **D** | total ≥ 55 |
| **F** | below 55, or any dimension ≤ 2 (a broken page is not a C) |

A dimension scored 0 means the property is absent or actively harmful (e.g. no error state at all,
or a fake "LIVE" badge on cached data).

---

## 2. The ten dimensions

### D1 — Visual consistency with the rest of the app

Measured against § 4 "House style". The lint reports the raw material (radii, type sizes, spacing,
hex) per file.

| Score | Observable criteria |
|---|---|
| **10** | Only the 4 canonical radii are visible (16 / 10 / 6 / pill); every panel, control and chip matches its twin on the trade page pixel for pixel; no hard-coded hex colour in the page's components; every surface uses `SURFACE_*` / `PRODUCT_*` or the `--card-border` / `--background-*` tokens; fonts are Inter for words and JetBrains Mono for numbers/addresses only; the lint score for every file the page renders is < 10. |
| **7** | ≤ 3 distinct radii on screen, at most one of them off-scale; ≤ 3 hex colours, all in chart/canvas code; one component visibly "imported from elsewhere" (different border alpha, different panel fill) but the layout grid matches the app. |
| **4** | 4–5 radii visible at once; panel borders differ in alpha across the page (`#2a2a2a` next to `white/[0.08]` next to `--card-border`); buttons on the page use two different shapes for the same role; mono and sans swapped for body text. |
| **1** | The page has its own dialect: its own greys, its own radius (e.g. 4px everywhere), its own button, its own tab shape. A user would assume it is a different product. |

### D2 — Hierarchy & primary-action clarity

| Score | Observable criteria |
|---|---|
| **10** | Exactly one primary action per screen and it is the single most prominent element (largest filled control, accent fill, ≥ 40px tall, above the fold at 390px); secondary actions are outline/ghost; the page's headline number or title is the largest text; reading order (DOM order) matches visual order; no two filled accent buttons visible at once. |
| **7** | One primary action, but a secondary element competes (a badge or a banner using the accent colour); headline is clear but one sub-section has its own competing title scale. |
| **4** | Two or more accent-filled buttons at once; the primary action is below the fold on mobile; titles and values share the same size/weight so the eye has no entry point. |
| **1** | No discernible primary action; everything is the same weight; decorative elements (blobs, gradients, glows) are the most prominent thing on the page. |

### D3 — Density & whitespace discipline

| Score | Observable criteria |
|---|---|
| **10** | Surface nesting is page > panel > row, never panel-in-panel-in-panel (max 2 bordered ancestors for any control); ≤ 6 distinct gap/padding values on screen, all on the 4px grid; rows in a list share one height; column gutters equal on both sides; no element touches the viewport edge except full-bleed charts; ≤ 5 type sizes visible. |
| **7** | One triple-nested surface; 7–8 spacing values; one list with ragged row heights. |
| **4** | Cards inside cards inside cards; mixed `p-3` / `p-4` / `p-5` on sibling panels; large dead zones next to cramped clusters; 9+ spacing values. |
| **1** | Wall of equally-spaced boxes with no grouping, or a single panel stuffed with 30 controls with no section breaks. |

### D4 — State completeness (loading / empty / error / disabled / success)

Every async surface = every place that shows data from the chain, the indexer, the DB or a wallet.

| Score | Observable criteria |
|---|---|
| **10** | For **every** async surface all five states are present and designed: loading = skeleton shaped like the final content (not a spinner), empty = one sentence + one action, error = plain-language cause + retry, disabled = explains why (tooltip or helper text), success = confirmation with the resulting value/tx link. No state causes layout shift > 8px. Wallet-disconnected state exists for every wallet-gated element. |
| **7** | All surfaces have loading + error; one surface is missing a designed empty state (shows a blank panel); one disabled control does not say why. |
| **4** | Spinners instead of skeletons; at least one surface can render `undefined`, `NaN`, `$0.00` or `—` while loading; errors surface only as a toast or console log. |
| **1** | A failed fetch leaves the page blank or permanently spinning; no empty states; disconnected wallet shows a broken UI. |

### D5 — Mobile behaviour (320–430px)

| Score | Observable criteria |
|---|---|
| **10** | No horizontal scroll at 320, 360, 390 and 430px (`document.documentElement.scrollWidth === clientWidth`); every interactive control ≥ 44×44px hit area; primary action reachable with one thumb (bottom 40% of the viewport or sticky); tables collapse to rows/cards, not shrink; inputs are ≥ 16px so iOS does not zoom; sheets respect `env(safe-area-inset-bottom)`; sticky header ≤ 56px. |
| **7** | All breakpoints clean except 320px (≤ 16px overflow); one row of controls at 36–40px; one table needs horizontal scroll inside its own container (acceptable if the container scrolls, not the page). |
| **4** | Horizontal page scroll at 390px; controls at 28–32px; a 4-column stat grid that becomes 4 columns of 80px; text truncation hides the value the user came for. |
| **1** | Desktop layout scaled down; modals taller than the viewport with no scroll; fixed-width panels. |

### D6 — Accessibility (contrast, focus, labels, touch targets)

| Score | Observable criteria |
|---|---|
| **10** | Text contrast ≥ 4.5:1 (≥ 3:1 for ≥ 18px bold) in **both** themes; no text under 11px; every interactive element is keyboard reachable and shows a visible `focus-visible` ring (the `ring-ring` 2px ring); every icon-only button has `aria-label`; live-updating numbers (price, PnL) are in `aria-live="polite"` regions or explicitly excluded; every input has a `<label>` or `aria-label`; colour is never the only carrier of up/down (sign or arrow present); segmented controls use `role="tablist"`/`aria-pressed`. |
| **7** | One icon button without a label; one 10px label; focus ring present but default browser outline in one spot. |
| **4** | Raw `<button>`s with no `focus-visible` styling (outline removed globally); text at 9–10px in tables; light theme has at least one text colour under 3:1; `div onClick` rows. |
| **1** | Unreachable controls by keyboard; neon text on white; no labels on inputs; `outline-none` everywhere with nothing replacing it. |

### D7 — Copy clarity

| Score | Observable criteria |
|---|---|
| **10** | Every label ≤ 3 words; every helper sentence ≤ 14 words; no paragraph over 2 lines on mobile except on `/explainer`; no jargon the user did not ask for (no "ABI", "lot size", "subaccount", "builder code" without a one-line plain explanation on hover/tap); numbers carry units and sign (`+$12.40`, `−0.8%`, `2.5× lev`); error copy says what happened and what to do next; buttons are verbs ("Deposit 100 USDC", not "Submit"); no ALL-CAPS sentences, only ALL-CAPS 11px labels. |
| **7** | One jargon term unexplained; one helper over 20 words; one "Submit"/"OK" button. |
| **4** | Internal names leaking (`market_id`, `stale-oracle-denied`); paragraphs of 4+ lines inside a trade panel; mixed "You"/"User"/"Account" voice. |
| **1** | Raw error strings from the SDK shown to users; walls of text; lorem-like placeholder copy. |

### D8 — Motion & feedback

| Score | Observable criteria |
|---|---|
| **10** | Every pressable control has hover (colour) and press (`active:scale-[0.98]`, transform-only, 100ms) feedback via `PRESSABLE_CONTROL`; transitions are ≤ 200ms for controls and ≤ 300ms for sheets/modals; no `transition-all`; only spinners and a single "connected" dot loop; `prefers-reduced-motion` disables every non-essential animation (verified with the OS toggle); no animation runs on first paint except a ≤ 200ms fade; nothing animates layout (height/width) on a trading surface. |
| **7** | One decorative loop (pulsing badge, ambient blob) that stops under reduced motion; one 300–500ms transition on a control. |
| **4** | `transition-all` on controls; glow/pulse animations that keep running; motion that ignores reduced-motion; press feedback missing on the primary action. |
| **1** | Entrance animations on every panel; parallax/blob backgrounds that cost frames on mobile; content that jumps while animating in. |

### D9 — Trust & honesty

| Score | Observable criteria |
|---|---|
| **10** | Every "Live"/"LIVE" indicator is bound to a real socket/heartbeat and turns off within 5s of disconnect; every number has a source and a freshness (timestamp or "updated Ns ago") where staleness matters (prices, PnL, TVL, points); no placeholder or sample data reachable in production; fees, slippage and worst-case outcome shown before confirm; tx hashes link to the explorer; "estimated" values are labelled estimated; empty states say "No positions" not "$0.00 PnL". |
| **7** | One number shown without freshness; one estimate not labelled; explorer links present but only on success. |
| **4** | "LIVE" label on polled data with no disconnect state; mock/demo data paths compiled into the page; rounding that hides a loss (`$0.00` for `−$0.004`). |
| **1** | Fabricated or hard-coded numbers; animated "live" pulses with no data source; rewards or APY shown without basis. |

### D10 — Performance feel

| Score | Observable criteria |
|---|---|
| **10** | CLS < 0.05 on load and on every state transition (skeleton dimensions = final dimensions, images/charts have reserved height); first contentful paint shows the page frame + skeletons, never a full-page spinner; no "spinner wall" (≥ 3 spinners at once); charts render under 1s on a mid-range phone; fonts are preloaded (no FOUT flash); interactions respond < 100ms; no `backdrop-blur` stacking (≤ 1 blurred layer on screen). |
| **7** | CLS 0.05–0.1; one late-arriving panel pushes content down; one blurred layer over another. |
| **4** | Full-page spinner before anything renders; visible font swap; stat tiles that resize when numbers arrive; 3+ backdrop-blur layers on mobile. |
| **1** | Blank page for > 2s; layout thrash as each fetch resolves; janky scroll on a phone. |

---

## 3. Per-page scorecard template

Copy one per page into the PR that touches it. Re-grade after the fix.

```markdown
### Scorecard — /<route>   (date · grader · commit)

Viewports checked: 320 · 390 · 430 · 768 · 1440   Themes: dark · light   Reduced motion: yes/no
Lint: `pnpm exec tsx scripts/ux-lint.ts` — worst file rendered by this page: <file> (score <n>)

| # | Dimension                         | Score | Evidence (what you saw, file:line if code) | Fix (one line) |
|---|-----------------------------------|:-----:|--------------------------------------------|----------------|
| 1 | Visual consistency                |       |                                            |                |
| 2 | Hierarchy & primary action        |       |                                            |                |
| 3 | Density & whitespace              |       |                                            |                |
| 4 | State completeness                |       |                                            |                |
| 5 | Mobile 320–430                    |       |                                            |                |
| 6 | Accessibility                     |       |                                            |                |
| 7 | Copy clarity                      |       |                                            |                |
| 8 | Motion & feedback                 |       |                                            |                |
| 9 | Trust & honesty                   |       |                                            |                |
| 10| Performance feel                  |       |                                            |                |
|   | **Total / Letter**                | **/100** | lowest dimension: D_ → fix first        |                |
```

Grading order that converges fastest: D9 → D4 → D5 → D6 → D2 → D1 → D3 → D7 → D8 → D10.
Honesty and states are where users lose trust; consistency is where they lose confidence.

---

## 4. House style (derived from the code)

Everything below was read from the repo, not invented. Where the code disagrees with itself the
**canonical** choice is stated and the alternatives are listed under § 5 "Outliers".

### 4.1 Token sources

| Layer | File | Notes |
|---|---|---|
| App-wide shadcn tokens | `app/globals.css:17-130` (`:root`), `:177` (`.dark`) | `--radius: 0.75rem` (12px) and the `--radius-sm…3xl` scale the named Tailwind `rounded-*` utilities read from (`@theme inline`, `:273-279`). |
| Product theme | `app/globals.css:463-552` (`.cash-trade-theme`) | The real app. `--radius: 16px`, `--radius-sm: 10px`, `--radius-xs: 6px`, `--card-border: rgba(255,255,255,.08)`, `--border-strong: .18`, `--background: #0a0a0a`, `--background-secondary: #0f0f0f`, `--background-tertiary: #161616`, `--card: rgba(255,255,255,.04)`, `--accent/--primary/--success: #39ff14`. Resets font to Inter + `tabular-nums`. |
| Light theme | `app/globals.css:845-1160` (`:root[data-theme="light"]`) | Inverts the zinc scale (`:937-950`, with contrast ratios in comments), flips `--color-white` (`:935`) so `white/[N]` borders survive, darkens brand green for text (`--lt-green-ink`, `:864`), and remaps 17 literal hex backgrounds by class name (`:1140-1156`). |
| Surface constants | `lib/surface.ts` | `SURFACE_PANEL`, `SURFACE_CARD`, `SURFACE_CONTROL`, `PRESSABLE_CONTROL`, `RADIUS`, `BORDER`. The header comment records that the canonical radii were **measured from the running trade page**, and that Tailwind's named scale does not match (`rounded-2xl` = 20px vs the 16px panel). |
| Product primitives | `components/ui/product-surface.tsx` | `ProductPanel`, `ProductSection`, `ProductSelectorButton`, `ProductSegmented`, `ProductBadge` on top of frosted-ui. |
| shadcn primitives | `components/ui/*.tsx` | Button, Card, Tabs, Dialog, Input, Badge, Skeleton, Empty… Several have had their radius stripped (see § 5). |

**Scope rule:** a surface is only "in the app's theme" if it is inside `.cash-trade-theme`. Applied
by `app/page.tsx:16`, `app/swap/page.tsx:13`, `components/dashboard/dashboard-layout.tsx:12`
(`/points`, `/automation`), `components/launchpad/launchpad-theme.tsx`,
`components/portfolio/PortfolioPageClient.tsx`, `components/ui/responsive-modal-sheet.tsx:122`.
`/explainer` and the root `<body>` are **outside** it and fall back to the 12px shadcn scale and
`font-mono` body text (`app/layout.tsx:101`).

### 4.2 Radii — canonical set (4 values)

| Role | Utility | px | Used by |
|---|---|---|---|
| Panel / card / modal / sheet | `rounded-[var(--radius)]` | 16 | `SURFACE_PANEL`, `SURFACE_CARD`, `ProductPanel` |
| Control: button, input, selector row, segmented | `rounded-[var(--radius-sm)]` | 10 | `SURFACE_CONTROL`, `ProductSegmented`, `responsive-modal-sheet.tsx:150`, Header buttons (`rounded-[10px]`, `Header.tsx:265,275,293`) |
| Badge / chip / row highlight | `rounded-[var(--radius-xs)]` | 6 | `ProductBadge`, OrderBook segmented (`rounded-[6px]`, `OrderBook.tsx:829`) |
| Pill / dot / avatar / switch | `rounded-full` | — | 155 uses, the most common radius in the tree |

Everything else is off-scale. In particular the named Tailwind scale is a trap here: `rounded-md`
= 10px, `rounded-lg` = 12px, `rounded-xl` = 16px, `rounded-2xl` = 20px (from `:root --radius`,
*not* from `.cash-trade-theme`), and bare `rounded` is Tailwind's 4px default. They look "almost"
right, which is exactly how the drift happened. Literal `rounded-[16px]` / `[10px]` / `[6px]` are
tolerated aliases; migrate them to the `var()` form so a token change moves everything.

Budget: **≤ 3 radii visible on one screen** (panel, control, pill). Use `rounded-none` freely for
nested/inset edges.

### 4.3 Type — canonical scale (7 sizes, ≤ 5 per screen)

| Size | Utility | Role | Evidence |
|---|---|---|---|
| 11px | `text-[11px]` | caption, meta, table header, helper | `ProductSection` description (`product-surface.tsx:78`), OrderBook rows (`:516`), TradePanel notices (`:573,854`) — 219 uses |
| 12px | `text-xs` | secondary text, dense table body | 237 uses (+141 as the alias `text-[12px]`) |
| 13px | `text-[13px]` | dense body, section titles, modal headers | `ProductSection` title (`:73`), `ProductSelectorButton` value (`:115`), modal header (`responsive-modal-sheet.tsx:127`), OrderBook `sm:text-[13px]` |
| 14px | `text-sm` | body, buttons, nav | `button.tsx:8`, Header nav (`text-[14px]`, `Header.tsx:243`) |
| 16px | `text-base` | inputs on mobile (iOS no-zoom), section headings | `input.tsx` (`text-base md:text-sm`) |
| 18px | `text-lg` | panel headline number | TradePageClient stat `dd` (`text-[18px]`, `:362`) |
| 24px | `text-2xl` | page hero number | 24 uses |

`text-3xl` (30px) is reserved for a single hero stat. **Floor: nothing under 11px.** The house
pairing is `font-display text-[13px] font-semibold` for titles and `font-mono tabular-nums` for
every number/address. Uppercase labels are 11px with `tracking-wide`, never 9px.

### 4.4 Surfaces, borders, nesting

```
page   bg-background                         (#0a0a0a · light: --lt-surface-1)
panel  SURFACE_PANEL   = rounded-[var(--radius)] border border-card-border bg-background-secondary
card   SURFACE_CARD    = rounded-[var(--radius)] border border-card-border bg-card       (4% white)
control SURFACE_CONTROL= rounded-[var(--radius-sm)] border border-card-border bg-background-secondary
inset  SURFACE_INSET   = border-card-border bg-card                                      (header/footer strips)
hover  hover:border-border-strong   active: border-accent/50
```

- Panel header strip: `flex items-center justify-between border-b border-card-border px-4 py-3`
  with a `font-display text-[13px] font-semibold` title (`ProductSection`). The OrderBook
  (`OrderBook.tsx:822`) and the mobile sheet (`mobile-modal-sheet.tsx:505`) follow the same
  strip grammar.
- Sections inside a panel are separated by a 1px `border-card-border` rule, **not** by nested
  cards (`ProductPanel` does this automatically via `[data-slot=product-section]+[data-slot=product-section]:border-t`).
- Maximum nesting: page > panel > row. A control may sit in a row; a row never gets its own border
  plus a bordered parent plus a bordered grand-parent.
- Glass (`.surface-1/2/3`, `globals.css:611-630`, 24–40px backdrop-blur) is legacy; do not add new
  uses, and never stack it on top of a solid hex background (OrderBook does both, `:821`).

### 4.5 Spacing rhythm (4px grid)

Observed distribution: `gap-2` 287, `px-3` 190, `px-4` 182, `py-2` 168, `px-2` 141, `gap-3` 129,
`py-3` 99, `py-1.5` 85, `p-3` 84, `gap-1` 82, `gap-1.5` 77, `gap-4` 65, `p-4` 61.

| Where | Value |
|---|---|
| Page gutter | `px-4` mobile → `md:px-6` (dashboard shell uses `px-2 … md:p-6 lg:p-8`, `dashboard-layout.tsx:15`; trade header `px-5 sm:px-8`, `TradePageClient.tsx:249`) |
| Panel section padding | `px-4 py-3.5` (`ProductSection`, `product-surface.tsx:66`) |
| Control padding | `px-3 py-2` (Header, TradePanel, OrderBook header strips) |
| Chip / badge | `px-2 py-0.5` (`badge.tsx`, `ProductBadge` uses `px-2 py-1`) |
| Inside a row | `gap-2`; between controls `gap-3`; between blocks `gap-4`; between panels `gap-6` |
| Control heights | `h-10` (40px) primary controls (`ProductSelectorButton`, wallet button), `h-9` compact desktop (`button.tsx`, `input.tsx`), **`min-h-11` on mobile rows** then `sm:min-h-7` (`OrderBook.tsx:516,855`) |

Budget: **≤ 6 distinct spacing values visible on one screen.** Arbitrary `p-[Npx]` only for
safe-area maths.

### 4.6 Buttons

Five roles. The shape is always `rounded-[var(--radius-sm)]` + `PRESSABLE_CONTROL`.

| Role | Recipe | Source |
|---|---|---|
| Primary (one per screen) | `h-10 px-4 bg-accent text-accent-foreground text-sm font-semibold hover:brightness-95` | `PortfolioPageClient.tsx:1066`, `.btn-cash` (`globals.css:650`) |
| Secondary / outline | `border border-accent/30 text-accent hover:bg-accent/10` | `Header.tsx:293` |
| Neutral | `bg-white/[0.06] border border-white/[0.08] text-foreground hover:bg-white/[0.1]` | `Header.tsx:275` |
| Ghost / selector | `ProductSelectorButton` — transparent, border on hover, `focus-visible:ring-2 ring-accent/60` | `product-surface.tsx:96-135` |
| Destructive | `bg-destructive text-white` (shadcn variant) | `button.tsx:14` |

Feedback contract (`lib/surface.ts` `PRESSABLE_CONTROL`): transition only
`background-color,border-color,color,opacity,filter,transform`, 100ms, `active:scale-[0.98]`,
`motion-reduce:transform-none`. Disabled = `opacity-40/50 pointer-events-none` **plus** a reason.

### 4.7 Tabs & segmented controls

Three grammars exist today; the canonical mapping is:

| Use | Grammar | Source |
|---|---|---|
| Top-level page nav | text links `px-3.5 py-1.5 text-sm font-medium`, active `text-white`, inactive `text-zinc-500 hover:text-zinc-300` | `Header.tsx:236-252` (mobile: `py-3 text-[15px]` rows, `:318`) |
| In-panel mode switch (2–4 equal options: Buy/Sell, Market/Limit, timeframe) | `ProductSegmented` = `rounded-[var(--radius-sm)] border border-card-border bg-background-tertiary p-1 gap-1`, active child `bg-card text-foreground`, inactive `text-muted-foreground` | `product-surface.tsx:139-152`; OrderBook's `rounded-[6px] p-0.5` strip is the compact form (`OrderBook.tsx:829-855`) |
| In-panel content tabs (Positions / Orders / History) | text tabs in a `border-b border-card-border` strip, `min-h-11 px-3 text-sm font-medium`, active = `text-foreground` + 2px bottom `bg-accent` bar, inactive `text-muted-foreground` | strip pattern at `PortfolioPageClient.tsx:1287`; needs `role="tablist"` |

`components/ui/tabs.tsx` (shadcn, `bg-muted h-9 p-[3px]`, **no radius**) is used only by
`app/automation/page.tsx` and should be restyled to `ProductSegmented` or retired.

### 4.8 Modals & sheets

- Desktop: `PRODUCT_MODAL_CLASS` = `border-card-border bg-background-secondary p-0`, radius
  `rounded-[var(--radius)]`, max width `sm:max-w-lg` (forms) or `sm:!max-w-[900px]` (review
  flows, `responsive-modal-sheet.tsx:57`). Header strip `px-5 py-3 font-mono text-[13px]
  font-semibold` with a status dot (`:127-134`). Close button 44px hit area, `focus-visible:ring-2
  ring-ring`.
- Mobile (< 768px): bottom sheet via `ResponsiveModalSheet` → `MobileModalSheet`, grab handle
  `h-1 w-9 rounded-full bg-white/[0.15]`, spring drag-to-dismiss that honours
  `prefers-reduced-motion` (`mobile-modal-sheet.tsx`). Canonical top radius is the panel radius
  (`rounded-t-[var(--radius)]`, 16px); today it is 20px (`:467`).
- Overlay: `bg-black/50`, 200ms fade, `motion-reduce:!animate-none` (`dialog.tsx:41,65`).

### 4.9 Colour semantics

| Meaning | Token | Light-theme behaviour |
|---|---|---|
| Brand / primary action | `bg-accent` (= `--primary`, #39ff14) with `text-accent-foreground` | stays neon as a fill, becomes `--lt-green-ink` as text (`globals.css:1076-1084`) |
| Positive / long / up | `text-success` | remapped to `--lt-green-ink` (5.47:1) |
| Negative / short / down | `text-destructive` | `--lt-danger` #d01414 (5.4:1) |
| Warning | `text-warning` (#f5a623) | `--lt-warning` |
| Muted text | `text-muted-foreground` / `text-zinc-500` | zinc scale inverted with ratios documented (`:937-950`) |
| Borders | `border-card-border`, hover `border-border-strong` | resolved per theme |

Do not use `text-green-400` / `text-red-400` / `#e8774f` / `#ff5000` / `#ef4444` for PnL
(see § 5). Colour is never the only carrier of direction: always pair with a sign or arrow.

### 4.10 Fonts

Inter (`--font-inter`, display + body) and JetBrains Mono (`--font-jetbrains-mono`), loaded via
`next/font` in `app/layout.tsx:3-18`. Inside `.cash-trade-theme` the body is Inter with
`font-variant-numeric: tabular-nums` (`globals.css:532-534`); headings have `letter-spacing: 0`.
Mono is for numbers, addresses, tx hashes, code, and 11px uppercase labels. Never for sentences.

### 4.11 Motion

Durations: 100ms press, 150ms hover colour, 200ms overlay, ≤ 300ms sheet. Easing
`cubic-bezier(0.23,1,0.32,1)` (`PRESSABLE_CONTROL`). Allowed loops: `animate-spin` on an in-flight
action, one `animate-pulse` skeleton set, one 8px "connected" dot. Everything else is static.
Every animation must be disabled by `motion-reduce:` or a `prefers-reduced-motion` check.

---

## 5. Outliers recorded while reading

Concrete, file-cited; each one is a D1/D6/D8/D9 deduction until fixed.

1. **Two radius dialects.** `lib/surface.ts` says 16/10/6, but `PortfolioPageClient.tsx` is built
   on `rounded-[4px]` (×11) and `rounded-[3px]` segmented triggers (`:1081,1186-1213,1286`), with
   literal `#242424` / `#1a1a1a` / `#141414` / `#1d1d1d` borders and fills. The OrderBook mixes
   `rounded-[16px]` panel with `[2px]`/`[4px]`/`[5px]`/`[6px]` inner radii (`OrderBook.tsx:410-855`).
   TradePanel has `rounded-md`, `rounded-[14px]`, `rounded-[9px]`, `rounded-[10px]`, `rounded-[6px]`
   and `rounded-full` in one file.
2. **The design-reference page is the worst hex offender.** `TradePageClient.tsx` carries 74 hex
   uses / 18 distinct (`#2a2a2a` borders, `#202020` header strips, `#888` header text, `#111`,
   `#160e1a`, …) — none of them tokens. `LaunchpadPage.tsx` 58, `BTCChart.tsx` 39,
   `app/explainer/page.tsx` 33. App-wide: 523 hex uses, 139 distinct colours, in 48 files.
3. **Sub-floor type is the house default.** `text-[10px]` is the single most-used size in the app
   (312), plus `text-[9px]` (138) and `text-[8px]` (14): 464 sub-11px occurrences in 67 files.
   `DeployForm.tsx` alone has 52. Even the shared primitive `ProductBadge` and
   `ProductSelectorButton` detail use `text-[9px]` (`product-surface.tsx:131,170`), and the
   Header wallet badge is 9px (`Header.tsx:282`).
4. **Five different reds for "loss".** `text-red-400` (103), `text-red-500` (20), `#e8774f`
   salmon (Portfolio ×13), `#ff5000` (OrderBook), `#F21A1A` (TradePanel), `#ef4444` (12) — versus
   `text-destructive` (18). Greens: `text-green-400` (84) vs `text-success` (19). The light theme
   rescues the named classes (`--color-green-400/500 → --lt-green-ink`, `globals.css:1059-1060`;
   `--color-red-400: #e7000b`, `:970`) but the literal hexes (`#e8774f`, `#ff5000`, `#F21A1A`,
   `#ef4444`) stay exactly as written on a white page.
5. **Three modal radii.** `DialogContent` has **no** radius (square, `dialog.tsx:65`),
   `ResponsiveModalSheet` is `rounded-[12px]` (`:122`), `MobileModalSheet` is `rounded-t-[20px]`
   (`:467`), wallet dialog is square `bg-black border-primary/14` (`wallet-button.tsx:116`). None is
   the 16px panel radius.
6. **shadcn primitives had their radius stripped, not retokenised.** `button.tsx`, `tabs.tsx`,
   `dialog.tsx`, `table.tsx` have zero `rounded-*`; `card.tsx` is `rounded-xl`, `badge.tsx`/
   `input.tsx`/`skeleton.tsx` are `rounded-md`, `empty.tsx` `rounded-lg`, `checkbox.tsx`
   `rounded-[4px]`, `tooltip.tsx` `rounded-[2px]`. The primitives disagree with each other and
   with `lib/surface.ts`.
7. **Legacy yellow brand still wired in.** `button.tsx:12` default variant glows
   `rgba(255,246,0,0.4)` (yellow) and `.dark --primary` is `oklch(0.95 0.2 102)` (yellow,
   `globals.css:184`) while the product brand is neon green `#39ff14`. Any shadcn `<Button>` outside
   `.cash-trade-theme` renders yellow.
8. **Body text defaults to monospace.** `<body className="font-mono">` (`app/layout.tsx:101`);
   only `.cash-trade-theme` switches to Inter. `/explainer` (not wrapped) renders prose in
   JetBrains Mono, and the dashboard shell's header row renders before the wrapper.
9. **Focus styling is missing on raw buttons in 30 files**, including `TradePanel.tsx`,
   `Header.tsx`, `Positions.tsx`, `TradePageClient.tsx`, `SealedLaunch.tsx`, `DeployForm.tsx`
   (`<button` present, no `focus-visible:` anywhere in the file). `button.tsx` itself sets
   `focus-visible:outline-none` with no ring replacement.
10. **Reduced motion is opt-in, not global.** 30 files import framer-motion; 12 files use
    `motion-reduce:`; 2 check `prefers-reduced-motion` (`mobile-modal-sheet.tsx`,
    `ui/agent/index.tsx`). `globals.css` has no `@media (prefers-reduced-motion)` rule.
    `transition-all` appears 67 times; `duration-300…1000` 37 times; `backdrop-blur` 49 times.
11. **Touch targets.** `min-h-11` appears in only 10 files (24 of 33 uses are the OrderBook's
    `min-h-11 sm:min-h-7` pattern — the right idea, applied once). Control rows elsewhere are
    `py-1.5`/`py-2` at 11–13px text, i.e. 28–34px tall.
12. **Dead component folders still shape the numbers.** `components/uitripled/*` and
    `components/navigation/bottom-nav.tsx` are imported by nothing; `components/dashboard/*`
    ships `mock` data paths (`portfolio-view.tsx`, `history-table.tsx`) and is the shell for
    `/points` and `/automation`. Delete or quarantine before grading those routes for D9.
13. **Live labels with three meanings.** "LIVE" is a chart timeframe (`ProCandleChart.tsx:78`,
    `BtcPerpsChart.tsx:92`), a graduation status (`IndicatorCard.tsx:325`, `LaunchpadPage.tsx:410`)
    and a vault running state (`SealedVaultFeed.tsx:272`). Reserve the word for a connected data
    stream with a disconnect state; call the others "1m", "Graduated", "Running".
14. **Light theme depends on a literal-hex allow-list.** `globals.css:1140-1156` remaps exactly 17
    `bg-[#…]` classes. Any new hex background (there are 139 distinct hex values in the tree)
    silently stays dark-on-light. This is the structural reason for the "no hex outside
    globals.css" rule.
15. **State coverage is thin on the core surfaces.** Grep-level check: `TradePanel.tsx`,
    `OrderBook.tsx`, `points-view.tsx` and `CashSpotSwap.tsx` contain no skeleton and no
    designed empty string; `TradePageClient.tsx` has one skeleton for 1270 lines and no error
    render. Loading is a spinner (`animate-spin` in 28 files) far more often than a skeleton
    (`Skeleton`/`animate-pulse` in 26, many of them badges).

---

## 6. The lint

```
pnpm exec tsx scripts/ux-lint.ts            # human report, top 25 offenders
pnpm exec tsx scripts/ux-lint.ts --top 15   # shorter
pnpm exec tsx scripts/ux-lint.ts --json     # everything, for dashboards/CI annotations
```

Scans `components/**/*.tsx` and `app/**/*.tsx` with regexes (no parser), skips `node_modules` /
`.next`, runs in well under a second and always exits 0. Canonical sets are constants at the top of
the script (`CANONICAL_RADIUS`, `CANONICAL_TYPE`, `CANONICAL_SPACING`, `MIN_FONT_PX`, budgets) and
must match § 4.

Per file it reports the radius set, type-size set, sub-11px text, hex colours, spacing set, and an
**inconsistency score**: 3 per distinct off-scale radius/type utility (+0.25 per repeat), 1 per
literal alias, 5 per distinct sub-11px size (+0.5 per use), 2 per distinct hex (+0.25 per use),
1 per off-grid spacing value, and 2/2/1 per unit over the per-file budgets of 5 type sizes /
3 radii / 8 spacing values. Score 0 = the file is silent on all five axes. A page cannot be
graded A+ on D1 while any file it renders scores ≥ 10.

What the lint cannot see (grade by hand): hierarchy, states, mobile overflow, contrast in the
light theme, copy, motion timing, data honesty, layout shift.

---

## 7. Baseline

Output of `pnpm exec tsx scripts/ux-lint.ts --top 15` on the tree at the time this document was
written. Re-run and replace when the canonical sets change.

```text
ux-lint — 197 files scanned in 32ms (report only, exit 0)
canonical sets: docs/UX-GRADING.md § House style
  radius   rounded-[var(--radius)]  rounded-[var(--radius-sm)]  rounded-[var(--radius-xs)]  rounded-full
  type     text-[11px]  text-xs  text-[13px]  text-sm  text-base  text-lg  text-2xl  text-3xl   (floor 11px, ≤5 per screen)
  spacing  0 0.5 1 1.5 2 2.5 3 3.5 4 5 6 8 10 12   (≤8 per screen)

AGGREGATE
  files with off-scale radius: 91   over radius budget: 26
  files with off-scale type:   33   over type budget:   32
  text under 11px:           464 occurrences in 67 files
  hard-coded hex (non-globals): 523 occurrences, 139 distinct, in 48 files
  clean files (score 0):       67

  radius utilities:
     155  rounded-full
      96  rounded-md [off-scale]
      67  rounded-lg [off-scale]
      57  rounded-[var(--radius-sm)]
      52  rounded [off-scale]
      38  rounded-[10px] (alias → rounded-[var(--radius-sm)])
      26  rounded-[var(--radius)]
      24  rounded-none (neutral)
      21  rounded-[4px] [off-scale]
      21  rounded-xl [off-scale]
      20  rounded-[8px] [off-scale]
      20  rounded-[var(--radius-xs)]
      19  rounded-sm [off-scale]
      18  rounded-2xl [off-scale]
      14  rounded-[16px] (alias → rounded-[var(--radius)])
      11  rounded-[12px] [off-scale]
       7  rounded-[6px] (alias → rounded-[var(--radius-xs)])
       5  rounded-[2px] [off-scale]
       5  rounded-[5px] [off-scale]
       4  rounded-[14px] [off-scale]
       4  rounded-xs [off-scale]
       3  rounded-[7px] [off-scale]
       3  rounded-[calc(var(--radius)-5px)] [off-scale]
       3  rounded-3xl [off-scale]
       2  rounded-[20px] [off-scale]
       2  rounded-[3px] [off-scale]
       2  rounded-[calc(var(--radius-sm)-2px)] [off-scale]
       2  rounded-[calc(var(--radius)-7px)] [off-scale]
       1  rounded-[9px] [off-scale]
       1  rounded-[inherit] (neutral)
  type sizes:
     312  text-[10px] [under 11px]
     237  text-xs
     219  text-[11px]
     189  text-sm
     141  text-[12px] (alias → text-xs)
     138  text-[9px] [under 11px]
      90  text-[13px]
      41  text-lg
      38  text-[14px] (alias → text-sm)
      24  text-2xl
      19  text-[15px] [off-scale]
      18  text-base
      14  text-[8px] [under 11px]
      12  text-xl [off-scale]
      10  text-3xl
       8  text-[22px] [off-scale]
       8  text-4xl [off-scale]
       6  text-[18px] (alias → text-lg)
       5  text-[17px] [off-scale]
       5  text-[24px] (alias → text-2xl)
       5  text-5xl [off-scale]
       4  text-[16px] (alias → text-base)
       4  text-[20px] [off-scale]
       4  text-[28px] [off-scale]
       2  text-[0.8rem] [off-scale]
       2  text-[26px] [off-scale]
       2  text-[36px] [off-scale]
       2  text-6xl [off-scale]
       1  text-[52px] [off-scale]
       1  text-7xl [off-scale]
  spacing values (gap/p/px/py/…):
     710  2
     587  3
     405  4
     252  1
     220  1.5
     140  2.5
     105  0.5
     104  6
      79  5
      66  8
      41  0
      27  3.5
      14  px [off-grid]
      11  12
      10  7 [off-grid]
       6  24 [off-grid]
       5  10
       3  [env(safe-area-inset-bottom)] [off-grid]
       3  16 [off-grid]
       3  32 [off-grid]
       2  [18px] [off-grid]
       2  [3px] [off-grid]
       1  [10px] [off-grid]
       1  [22px] [off-grid]
       1  [2px] [off-grid]
       1  [calc(0.75rem+env(safe-area-inset-bottom))] [off-grid]
       1  [max(0.75rem,env(safe-area-inset-bottom))] [off-grid]
       1  14 [off-grid]
       1  28 [off-grid]
  most used hex:
      52  #2a2a2a
      24  #0d0d0d
      21  #141414
      19  #111
      15  #1a1a1a
      15  #888
      14  #181818
      14  #39ff14
      13  #8a8a8a
      13  #e8774f
      12  #101010
      12  #a1a1a1
      12  #ef4444
      11  #1e1e1e
      11  #242424

TOP 15 OFFENDERS (inconsistency score, higher = worse)
  #     score  file                                                   lines radii sizes  tiny  hex space
  1     131.5  components/trade/TradePageClient.tsx                    1270     6    11    19   74    14
        - off-scale radius: rounded×6, rounded-[8px]×5, rounded-2xl×2, rounded-lg×2 (+15.75)
        - literal radius alias: rounded-[10px] (+1)
        - text under 11px: text-[9px]×9, text-[10px]×9, text-[8px]×1 (+24.5)
        - off-scale type: text-[15px]×2, text-[22px]×1 (+6.75)
        - arbitrary alias of a named size: text-[12px], text-[14px], text-[18px] (+3)
        - hard-coded hex: 18 distinct / 74 uses (#2a2a2a, #888, #202020, #111, …) (+54.5)
        - off-grid spacing: [18px], 24 (+2)
        - 11 type sizes in one file (budget 5) (+12)
        - 6 radii in one file (budget 3) (+6)
        - 14 spacing values in one file (budget 8) (+6)
  2     125.8  components/trade/BTCChart.tsx                           1399     9     9    23   39     9
        - off-scale radius: rounded-md×5, rounded×1, rounded-[5px]×1, rounded-[8px]×1, rounded-lg×1 (+17.25)
        - literal radius alias: rounded-[6px], rounded-[10px], rounded-[16px] (+3)
        - text under 11px: text-[9px]×6, text-[10px]×16, text-[8px]×1 (+26.5)
        - off-scale type: text-[15px]×1 (+3.25)
        - arbitrary alias of a named size: text-[12px] (+1)
        - hard-coded hex: 22 distinct / 39 uses (#39ff14, #f7931a, #f3ba2f, #c2a633, …) (+53.75)
        - 9 type sizes in one file (budget 5) (+8)
        - 9 radii in one file (budget 3) (+12)
        - 9 spacing values in one file (budget 8) (+1)
  3     121.5  components/launchpad/LaunchpadPage.tsx                   993     6    15     9   58    16
        - off-scale radius: rounded-[calc(var(--radius-sm)-2px)]×2, rounded-[calc(var(--radius)-7px)]×2 (+7)
        - text under 11px: text-[10px]×7, text-[9px]×2 (+14.5)
        - off-scale type: text-[15px]×2, text-[22px]×2, text-[20px]×1, text-[26px]×1 (+13.5)
        - arbitrary alias of a named size: text-[12px], text-[14px], text-[18px], text-[24px] (+4)
        - hard-coded hex: 15 distinct / 58 uses (#a1a1a1, #2a2a2a, #888, #0f0f0f, …) (+44.5)
        - off-grid spacing: [22px], 16, 24, 7 (+4)
        - 15 type sizes in one file (budget 5) (+20)
        - 6 radii in one file (budget 3) (+6)
        - 16 spacing values in one file (budget 8) (+8)
  4     107.8  app/explainer/page.tsx                                   763     5     9     2   33    16
        - off-scale radius: rounded-2xl×7, rounded-lg×6, rounded-xl×5, rounded×1 (+16.75)
        - text under 11px: text-[10px]×2 (+6)
        - off-scale type: text-[52px]×1, text-4xl×1, text-xl×1 (+9.75)
        - hard-coded hex: 21 distinct / 33 uses (#39ff14, #f7931a, #627eea, #9945ff, …) (+50.25)
        - off-grid spacing: 7, 24, 28, 32, px (+5)
        - 9 type sizes in one file (budget 5) (+8)
        - 5 radii in one file (budget 3) (+4)
        - 16 spacing values in one file (budget 8) (+8)
  5      98.5  components/launchpad/DeployForm.tsx                     2151     6     7    52   28    11
        - off-scale radius: rounded-lg×12, rounded×11, rounded-2xl×2, rounded-xl×1 (+18.5)
        - literal radius alias: rounded-[10px] (+1)
        - text under 11px: text-[10px]×31, text-[9px]×19, text-[8px]×2 (+41)
        - hard-coded hex: 9 distinct / 28 uses (#1e1e1e, #39ff14, #f21a1a, #00c9a7, …) (+25)
        - 7 type sizes in one file (budget 5) (+4)
        - 6 radii in one file (budget 3) (+6)
        - 11 spacing values in one file (budget 8) (+3)
  6      53.3  components/portfolio/PortfolioPageClient.tsx            1650     2     7     0   34    12
        - off-scale radius: rounded-[4px]×11, rounded-[3px]×2 (+9.25)
        - off-scale type: text-[26px]×1, text-[28px]×1 (+6.5)
        - arbitrary alias of a named size: text-[12px], text-[18px] (+2)
        - hard-coded hex: 9 distinct / 34 uses (#e8774f, #1a1a1a, #050505, #1d1d1d, …) (+26.5)
        - off-grid spacing: px (+1)
        - 7 type sizes in one file (budget 5) (+4)
        - 12 spacing values in one file (budget 8) (+4)
  7      51.8  components/launchpad/OnChainChart.tsx                    749     4     2    11   17     6
        - off-scale radius: rounded×6, rounded-lg×1, rounded-xl×1 (+11)
        - text under 11px: text-[10px]×11 (+10.5)
        - hard-coded hex: 12 distinct / 17 uses (#1a1a1a, #2a2a2a, #22c55e, #ffb020, …) (+28.25)
        - 4 radii in one file (budget 3) (+2)
  8      51.0  components/ui/agent/index.tsx                            442     3     4     5   23     8
        - off-scale radius: rounded×3 (+3.75)
        - literal radius alias: rounded-[16px], rounded-[10px] (+2)
        - text under 11px: text-[9px]×2, text-[10px]×3 (+12.5)
        - arbitrary alias of a named size: text-[12px] (+1)
        - hard-coded hex: 13 distinct / 23 uses (#0d0d0d, #141414, #2a2a2a, #6f9f72, …) (+31.75)
  9      49.8  components/trade/TradePanel.tsx                          916     7     5     5   10     7
        - off-scale radius: rounded-md×3, rounded-[14px]×2, rounded×1, rounded-[9px]×1 (+13.75)
        - literal radius alias: rounded-[10px], rounded-[6px] (+2)
        - text under 11px: text-[10px]×5 (+7.5)
        - arbitrary alias of a named size: text-[14px], text-[12px] (+2)
        - hard-coded hex: 7 distinct / 10 uses (#0e0e0e, #141414, #181818, #888, …) (+16.5)
        - 7 radii in one file (budget 3) (+8)
  10     47.3  components/launchpad/StrategySourceEditor.tsx            412     3     2     5   19     5
        - text under 11px: text-[10px]×3, text-[9px]×2 (+12.5)
        - hard-coded hex: 15 distinct / 19 uses (#0d0d0d, #d4d4d8, #48484f, #a1a1aa, …) (+34.75)
  11     47.3  components/trade/OrderBook.tsx                           921     5     5     4    7     6
        - off-scale radius: rounded-[4px]×3, rounded-[2px]×2, rounded-[5px]×1 (+10.5)
        - literal radius alias: rounded-[16px], rounded-[6px] (+2)
        - text under 11px: text-[9px]×2, text-[10px]×2 (+12)
        - arbitrary alias of a named size: text-[12px] (+1)
        - hard-coded hex: 7 distinct / 7 uses (#00d20c, #ff5000, #1f1f22, #ffffff, …) (+15.75)
        - off-grid spacing: [10px], [2px] (+2)
        - 5 radii in one file (budget 3) (+4)
  12     44.3  components/portfolio/CashRewardsPanel.tsx                645     2     7     4   15    10
        - off-scale radius: rounded-[4px]×5 (+4.25)
        - text under 11px: text-[10px]×3, text-[9px]×1 (+12)
        - off-scale type: text-[15px]×1 (+3.25)
        - arbitrary alias of a named size: text-[12px], text-[24px] (+2)
        - hard-coded hex: 6 distinct / 15 uses (#1a1a1a, #050505, #0a0a0a, #252525, …) (+15.75)
        - off-grid spacing: px (+1)
        - 7 type sizes in one file (budget 5) (+4)
        - 10 spacing values in one file (budget 8) (+2)
  13     43.5  components/trade/DecibelAccountManager.tsx              1878     4     8    13    0     7
        - off-scale radius: rounded-md×15, rounded×1 (+10)
        - literal radius alias: rounded-[10px] (+1)
        - text under 11px: text-[8px]×1, text-[9px]×1, text-[10px]×11 (+21.5)
        - arbitrary alias of a named size: text-[12px], text-[14px], text-[16px] (+3)
        - 8 type sizes in one file (budget 5) (+6)
        - 4 radii in one file (budget 3) (+2)
  14     42.0  components/launchpad/BotDashboard.tsx                    356     4     6     5   11     8
        - off-scale radius: rounded-xl×3, rounded-2xl×2, rounded-lg×2 (+10.75)
        - text under 11px: text-[9px]×1, text-[10px]×4 (+12.5)
        - arbitrary alias of a named size: text-[12px], text-[14px], text-[16px] (+3)
        - hard-coded hex: 4 distinct / 11 uses (#181818, #2a2a2a, #111, #202020) (+10.75)
        - off-grid spacing: 16 (+1)
        - 6 type sizes in one file (budget 5) (+2)
        - 4 radii in one file (budget 3) (+2)
  15     41.8  components/bot/bot-status-monitor.tsx                   1234     0     7    39    0     7
        - text under 11px: text-[10px]×27, text-[9px]×10, text-[8px]×2 (+34.5)
        - off-scale type: text-xl×1 (+3.25)
        - 7 type sizes in one file (budget 5) (+4)

columns: radii/sizes/space = distinct utilities in the file · tiny = uses of text < 11px · hex = hard-coded colour uses
```
