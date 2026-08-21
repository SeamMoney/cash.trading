/**
 * ux-lint — deterministic UX consistency report for cash.trading.
 *
 *   pnpm exec tsx scripts/ux-lint.ts            human-readable report (top 25)
 *   pnpm exec tsx scripts/ux-lint.ts --top 15   change how many offenders print
 *   pnpm exec tsx scripts/ux-lint.ts --json     full machine-readable output
 *
 * Parse-free: scans the raw text of components/**\/*.tsx and app/**\/*.tsx with
 * regexes (no TS/JSX parser), skips node_modules and .next, and ALWAYS exits 0.
 * It is a report, not a gate — the grading rubric that consumes it lives in
 * docs/UX-GRADING.md (see "House style" and "Baseline").
 *
 * What it measures per file and in aggregate:
 *   - border-radius utilities used (rounded-*, rounded-[Npx], rounded-[var(..)])
 *   - font-size utilities used (text-xs…text-7xl, text-[Npx], text-[Nrem])
 *   - any text below the 11px floor
 *   - hard-coded hex colours outside app/globals.css
 *   - distinct gap / padding values (the spacing rhythm)
 *   - a ranked "inconsistency score" — how far the file drifts from the
 *     canonical sets below.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// ---------------------------------------------------------------------------
// Canonical sets — MUST stay in sync with docs/UX-GRADING.md § "House style".
// Derived from lib/surface.ts, components/ui/product-surface.tsx and the
// .cash-trade-theme tokens in app/globals.css (16 / 10 / 6 px + pill).
// ---------------------------------------------------------------------------

/** Radius utilities a feature file is allowed to use. */
export const CANONICAL_RADIUS = new Set<string>([
  "rounded-[var(--radius)]", // 16px — page panels, cards, modals, sheets
  "rounded-[var(--radius-sm)]", // 10px — buttons, inputs, selector rows, segmented controls
  "rounded-[var(--radius-xs)]", // 6px  — badges, chips, inline tags, row highlights
  "rounded-full", // pills, dots, avatars, switches
]);

/** Literal pixel forms of the tokens. Tolerated but should migrate to the var() form. */
export const RADIUS_ALIASES: Record<string, string> = {
  "rounded-[16px]": "rounded-[var(--radius)]",
  "rounded-[10px]": "rounded-[var(--radius-sm)]",
  "rounded-[6px]": "rounded-[var(--radius-xs)]",
};

/** Radius utilities that carry no opinion (resetting a corner, inheriting). */
export const RADIUS_NEUTRAL = new Set<string>(["rounded-none", "rounded-[inherit]"]);

/**
 * Type scale — 7 sizes app-wide, ≤ 5 visible on any one screen.
 * 11 caption · 12 secondary · 13 dense body · 14 body/buttons/nav · 16 inputs &
 * section titles · 18 panel headline numbers · 24 page hero number ·
 * 30 (text-3xl) is reserved for a single hero stat.
 */
export const CANONICAL_TYPE = new Set<string>([
  "text-[11px]",
  "text-xs", // 12px
  "text-[13px]",
  "text-sm", // 14px
  "text-base", // 16px
  "text-lg", // 18px
  "text-2xl", // 24px
  "text-3xl", // 30px — hero stat only
]);

/** Arbitrary values that duplicate a named size. Tolerated, should migrate. */
export const TYPE_ALIASES: Record<string, string> = {
  "text-[12px]": "text-xs",
  "text-[14px]": "text-sm",
  "text-[16px]": "text-base",
  "text-[18px]": "text-lg",
  "text-[24px]": "text-2xl",
  "text-[30px]": "text-3xl",
};

/** Nothing a user has to read may be smaller than this. */
export const MIN_FONT_PX = 11;

/** Spacing rhythm: the 4px grid (Tailwind scale) up to 12, plus the half steps. */
export const CANONICAL_SPACING = new Set<string>([
  "0",
  "0.5",
  "1",
  "1.5",
  "2",
  "2.5",
  "3",
  "3.5",
  "4",
  "5",
  "6",
  "8",
  "10",
  "12",
]);

/** Per-screen budgets from the rubric (a file approximates a screen). */
export const MAX_TYPE_SIZES_PER_FILE = 5;
export const MAX_RADII_PER_FILE = 3;
export const MAX_SPACING_PER_FILE = 8;

/** Files that legitimately cannot use CSS variables (satori-rendered images). */
export const HEX_ALLOWLIST = new Set<string>(["app/opengraph-image.tsx", "app/twitter-image.tsx"]);

/** Score weights. Distinct off-scale tokens cost more than repeats of one. */
const WEIGHTS = {
  radiusOffDistinct: 3,
  radiusOffOccurrence: 0.25,
  radiusAliasDistinct: 1,
  typeOffDistinct: 3,
  typeOffOccurrence: 0.25,
  typeAliasDistinct: 1,
  tinyDistinct: 5,
  tinyOccurrence: 0.5,
  hexDistinct: 2,
  hexOccurrence: 0.25,
  spacingOffDistinct: 1,
  overTypeBudget: 2, // per size beyond MAX_TYPE_SIZES_PER_FILE
  overRadiusBudget: 2, // per radius beyond MAX_RADII_PER_FILE
  overSpacingBudget: 1, // per value beyond MAX_SPACING_PER_FILE
} as const;

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const SCAN_DIRS = ["components", "app"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build"]);

const RADIUS_RE =
  /(?<![A-Za-z0-9_-])rounded(?:-(?:t|b|l|r|tl|tr|bl|br|s|e|ss|se|ee|es))?(?:-(?:none|xs|sm|md|lg|xl|2xl|3xl|4xl|full)|-\[[^\]]+\])?(?![A-Za-z0-9_-])/g;
const RADIUS_SIDE_RE = /^rounded-(?:t|b|l|r|tl|tr|bl|br|s|e|ss|se|ee|es)(?=-|$)/;

const TYPE_RE =
  /(?<![A-Za-z0-9_-])text-(xs|sm|base|lg|xl|[2-9]xl|\[(\d*\.?\d+)(px|rem|em)\])(?![A-Za-z0-9_-])/g;
const NAMED_TYPE_PX: Record<string, number> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 48,
  "6xl": 60,
  "7xl": 72,
  "8xl": 96,
  "9xl": 128,
};

const SPACING_RE =
  /(?<![A-Za-z0-9_-])(?:gap|gap-x|gap-y|space-x|space-y|p|px|py|pt|pb|pl|pr|ps|pe)-(\d*\.?\d+|\[[^\]]+\]|px)(?![A-Za-z0-9_-])/g;

// 3/4/6/8-digit hex, not an HTML entity (&#8203;), not followed by more word chars.
const HEX_RE = /(?<!&)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9A-Za-z])/g;

type Counter = Map<string, number>;

export interface FileReport {
  file: string;
  lines: number;
  radius: Record<string, number>;
  radiusOff: string[];
  radiusAlias: string[];
  type: Record<string, number>;
  typeOff: string[];
  typeAlias: string[];
  tiny: Record<string, number>;
  tinyOccurrences: number;
  hex: Record<string, number>;
  hexOccurrences: number;
  spacing: Record<string, number>;
  spacingOff: string[];
  score: number;
  reasons: string[];
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  entries.sort();
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith(".tsx") && !name.endsWith(".d.tsx")) out.push(full);
  }
}

function bump(counter: Counter, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function toRecord(counter: Counter): Record<string, number> {
  return Object.fromEntries([...counter.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function typePx(token: string): number | null {
  const m = /^text-(?:(xs|sm|base|lg|xl|[2-9]xl)|\[(\d*\.?\d+)(px|rem|em)\])$/.exec(token);
  if (!m) return null;
  if (m[1]) return NAMED_TYPE_PX[m[1]] ?? null;
  const n = Number.parseFloat(m[2]);
  if (!Number.isFinite(n)) return null;
  return m[3] === "px" ? n : n * 16;
}

function normalizeRadius(token: string): string {
  return token.replace(RADIUS_SIDE_RE, "rounded");
}

function analyze(abs: string): FileReport {
  const file = relative(ROOT, abs).split(sep).join("/");
  const src = readFileSync(abs, "utf8");
  const lines = src.split("\n").length;

  const radius: Counter = new Map();
  for (const m of src.matchAll(RADIUS_RE)) bump(radius, normalizeRadius(m[0]));

  const type: Counter = new Map();
  for (const m of src.matchAll(TYPE_RE)) bump(type, m[0]);

  const spacing: Counter = new Map();
  for (const m of src.matchAll(SPACING_RE)) bump(spacing, m[1]);

  const hex: Counter = new Map();
  if (!HEX_ALLOWLIST.has(file)) {
    for (const m of src.matchAll(HEX_RE)) bump(hex, m[0].toLowerCase());
  }

  const radiusOff: string[] = [];
  const radiusAlias: string[] = [];
  let radiusOffOcc = 0;
  for (const [token, n] of radius) {
    if (CANONICAL_RADIUS.has(token) || RADIUS_NEUTRAL.has(token)) continue;
    if (token in RADIUS_ALIASES) radiusAlias.push(token);
    else {
      radiusOff.push(token);
      radiusOffOcc += n;
    }
  }

  const typeOff: string[] = [];
  const typeAlias: string[] = [];
  const tiny: Counter = new Map();
  let typeOffOcc = 0;
  let tinyOccurrences = 0;
  for (const [token, n] of type) {
    const px = typePx(token);
    if (px !== null && px < MIN_FONT_PX) {
      tiny.set(token, n);
      tinyOccurrences += n;
      continue; // counted as tiny, not double-counted as off-scale
    }
    if (CANONICAL_TYPE.has(token)) continue;
    if (token in TYPE_ALIASES) typeAlias.push(token);
    else {
      typeOff.push(token);
      typeOffOcc += n;
    }
  }

  const spacingOff = [...spacing.keys()].filter((v) => !CANONICAL_SPACING.has(v));
  const hexOccurrences = [...hex.values()].reduce((a, b) => a + b, 0);

  const sortTok = (a: string, b: string) => (radius.get(b) ?? type.get(b) ?? 0) - (radius.get(a) ?? type.get(a) ?? 0) || a.localeCompare(b);
  radiusOff.sort(sortTok);
  radiusAlias.sort(sortTok);
  typeOff.sort(sortTok);
  typeAlias.sort(sortTok);
  spacingOff.sort((a, b) => (spacing.get(b) ?? 0) - (spacing.get(a) ?? 0) || a.localeCompare(b));

  const overType = Math.max(0, type.size - MAX_TYPE_SIZES_PER_FILE);
  const overRadius = Math.max(0, [...radius.keys()].filter((t) => !RADIUS_NEUTRAL.has(t)).length - MAX_RADII_PER_FILE);
  const overSpacing = Math.max(0, spacing.size - MAX_SPACING_PER_FILE);

  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    if (points <= 0) return;
    score += points;
    reasons.push(`${reason} (+${round(points)})`);
  };

  add(
    radiusOff.length * WEIGHTS.radiusOffDistinct + radiusOffOcc * WEIGHTS.radiusOffOccurrence,
    `off-scale radius: ${radiusOff.map((t) => `${t}×${radius.get(t)}`).join(", ")}`,
  );
  add(radiusAlias.length * WEIGHTS.radiusAliasDistinct, `literal radius alias: ${radiusAlias.join(", ")}`);
  add(
    tiny.size * WEIGHTS.tinyDistinct + tinyOccurrences * WEIGHTS.tinyOccurrence,
    `text under ${MIN_FONT_PX}px: ${[...tiny.entries()].map(([t, n]) => `${t}×${n}`).join(", ")}`,
  );
  add(
    typeOff.length * WEIGHTS.typeOffDistinct + typeOffOcc * WEIGHTS.typeOffOccurrence,
    `off-scale type: ${typeOff.map((t) => `${t}×${type.get(t)}`).join(", ")}`,
  );
  add(typeAlias.length * WEIGHTS.typeAliasDistinct, `arbitrary alias of a named size: ${typeAlias.join(", ")}`);
  add(
    hex.size * WEIGHTS.hexDistinct + hexOccurrences * WEIGHTS.hexOccurrence,
    `hard-coded hex: ${hex.size} distinct / ${hexOccurrences} uses (${[...hex.keys()].slice(0, 4).join(", ")}${hex.size > 4 ? ", …" : ""})`,
  );
  add(spacingOff.length * WEIGHTS.spacingOffDistinct, `off-grid spacing: ${spacingOff.join(", ")}`);
  add(overType * WEIGHTS.overTypeBudget, `${type.size} type sizes in one file (budget ${MAX_TYPE_SIZES_PER_FILE})`);
  add(overRadius * WEIGHTS.overRadiusBudget, `${radius.size} radii in one file (budget ${MAX_RADII_PER_FILE})`);
  add(overSpacing * WEIGHTS.overSpacingBudget, `${spacing.size} spacing values in one file (budget ${MAX_SPACING_PER_FILE})`);

  return {
    file,
    lines,
    radius: toRecord(radius),
    radiusOff,
    radiusAlias,
    type: toRecord(type),
    typeOff,
    typeAlias,
    tiny: toRecord(tiny),
    tinyOccurrences,
    hex: toRecord(hex),
    hexOccurrences,
    spacing: toRecord(spacing),
    spacingOff,
    score: round(score),
    reasons,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Aggregate + output
// ---------------------------------------------------------------------------

function merge(into: Counter, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) into.set(k, (into.get(k) ?? 0) + v);
}

function classifyRadius(token: string): string {
  if (CANONICAL_RADIUS.has(token)) return "";
  if (RADIUS_NEUTRAL.has(token)) return " (neutral)";
  if (token in RADIUS_ALIASES) return ` (alias → ${RADIUS_ALIASES[token]})`;
  return " [off-scale]";
}

function classifyType(token: string): string {
  const px = typePx(token);
  if (px !== null && px < MIN_FONT_PX) return ` [under ${MIN_FONT_PX}px]`;
  if (CANONICAL_TYPE.has(token)) return "";
  if (token in TYPE_ALIASES) return ` (alias → ${TYPE_ALIASES[token]})`;
  return " [off-scale]";
}

function fmtCounter(rec: Record<string, number>, classify: (t: string) => string, limit = 40): string {
  // Re-sort: JS objects enumerate integer-like keys ("0", "2", "24") numerically first.
  const entries = Object.entries(rec)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
  return entries.map(([t, n]) => `    ${String(n).padStart(4)}  ${t}${classify(t)}`).join("\n");
}

function pad(s: string | number, n: number, left = false): string {
  const str = String(s);
  return left ? str.padStart(n) : str.padEnd(n);
}

function main(): void {
  const started = performance.now();
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const topIdx = args.indexOf("--top");
  const top = topIdx >= 0 ? Math.max(1, Number.parseInt(args[topIdx + 1] ?? "25", 10) || 25) : 25;

  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
  files.sort();

  const reports = files.map(analyze);
  const ranked = [...reports].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

  const aggRadius: Counter = new Map();
  const aggType: Counter = new Map();
  const aggSpacing: Counter = new Map();
  const aggHex: Counter = new Map();
  let tinyOcc = 0;
  let tinyFiles = 0;
  let hexOcc = 0;
  let hexFiles = 0;
  for (const r of reports) {
    merge(aggRadius, r.radius);
    merge(aggType, r.type);
    merge(aggSpacing, r.spacing);
    merge(aggHex, r.hex);
    if (r.tinyOccurrences > 0) {
      tinyFiles++;
      tinyOcc += r.tinyOccurrences;
    }
    if (r.hexOccurrences > 0) {
      hexFiles++;
      hexOcc += r.hexOccurrences;
    }
  }
  const elapsedMs = Math.round(performance.now() - started);

  const aggregate = {
    filesScanned: files.length,
    elapsedMs,
    radius: toRecord(aggRadius),
    type: toRecord(aggType),
    spacing: toRecord(aggSpacing),
    tinyText: { occurrences: tinyOcc, files: tinyFiles },
    hex: { occurrences: hexOcc, distinct: aggHex.size, files: hexFiles, top: Object.entries(toRecord(aggHex)).slice(0, 15) },
    filesOverTypeBudget: reports.filter((r) => Object.keys(r.type).length > MAX_TYPE_SIZES_PER_FILE).length,
    filesOverRadiusBudget: reports.filter((r) => Object.keys(r.radius).filter((t) => !RADIUS_NEUTRAL.has(t)).length > MAX_RADII_PER_FILE).length,
    filesWithOffScaleRadius: reports.filter((r) => r.radiusOff.length > 0).length,
    filesWithOffScaleType: reports.filter((r) => r.typeOff.length > 0).length,
    filesClean: reports.filter((r) => r.score === 0).length,
  };

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          canonical: {
            radius: [...CANONICAL_RADIUS],
            radiusAliases: RADIUS_ALIASES,
            type: [...CANONICAL_TYPE],
            typeAliases: TYPE_ALIASES,
            minFontPx: MIN_FONT_PX,
            spacing: [...CANONICAL_SPACING],
            budgets: { MAX_TYPE_SIZES_PER_FILE, MAX_RADII_PER_FILE, MAX_SPACING_PER_FILE },
          },
          aggregate,
          top: ranked.slice(0, top).map((r) => r.file),
          files: ranked,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const out: string[] = [];
  out.push(`ux-lint — ${files.length} files scanned in ${elapsedMs}ms (report only, exit 0)`);
  out.push(`canonical sets: docs/UX-GRADING.md § House style`);
  out.push(`  radius   ${[...CANONICAL_RADIUS].join("  ")}`);
  out.push(`  type     ${[...CANONICAL_TYPE].join("  ")}   (floor ${MIN_FONT_PX}px, ≤${MAX_TYPE_SIZES_PER_FILE} per screen)`);
  out.push(`  spacing  ${[...CANONICAL_SPACING].join(" ")}   (≤${MAX_SPACING_PER_FILE} per screen)`);
  out.push("");
  out.push("AGGREGATE");
  out.push(`  files with off-scale radius: ${aggregate.filesWithOffScaleRadius}   over radius budget: ${aggregate.filesOverRadiusBudget}`);
  out.push(`  files with off-scale type:   ${aggregate.filesWithOffScaleType}   over type budget:   ${aggregate.filesOverTypeBudget}`);
  out.push(`  text under ${MIN_FONT_PX}px:           ${tinyOcc} occurrences in ${tinyFiles} files`);
  out.push(`  hard-coded hex (non-globals): ${hexOcc} occurrences, ${aggHex.size} distinct, in ${hexFiles} files`);
  out.push(`  clean files (score 0):       ${aggregate.filesClean}`);
  out.push("");
  out.push("  radius utilities:");
  out.push(fmtCounter(aggregate.radius, classifyRadius));
  out.push("  type sizes:");
  out.push(fmtCounter(aggregate.type, classifyType));
  out.push("  spacing values (gap/p/px/py/…):");
  out.push(fmtCounter(aggregate.spacing, (t) => (CANONICAL_SPACING.has(t) ? "" : " [off-grid]"), 30));
  out.push("  most used hex:");
  out.push(aggregate.hex.top.map(([h, n]) => `    ${String(n).padStart(4)}  ${h}`).join("\n"));
  out.push("");
  out.push(`TOP ${Math.min(top, ranked.length)} OFFENDERS (inconsistency score, higher = worse)`);
  out.push(
    `  ${pad("#", 3)} ${pad("score", 7, true)}  ${pad("file", 54)} ${pad("lines", 5, true)} ${pad("radii", 5, true)} ${pad("sizes", 5, true)} ${pad("tiny", 5, true)} ${pad("hex", 4, true)} ${pad("space", 5, true)}`,
  );
  ranked.slice(0, top).forEach((r, i) => {
    out.push(
      `  ${pad(i + 1, 3)} ${pad(r.score.toFixed(1), 7, true)}  ${pad(r.file, 54)} ${pad(r.lines, 5, true)} ${pad(Object.keys(r.radius).length, 5, true)} ${pad(Object.keys(r.type).length, 5, true)} ${pad(r.tinyOccurrences, 5, true)} ${pad(r.hexOccurrences, 4, true)} ${pad(Object.keys(r.spacing).length, 5, true)}`,
    );
    for (const reason of r.reasons) out.push(`        - ${reason}`);
  });
  out.push("");
  out.push("columns: radii/sizes/space = distinct utilities in the file · tiny = uses of text < 11px · hex = hard-coded colour uses");
  process.stdout.write(out.join("\n") + "\n");
}

main();
process.exitCode = 0;
