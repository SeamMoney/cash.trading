# Decibel Design System

A comprehensive styling guide for the Decibrrr application, based on [bklit-ui](https://github.com/bklit/bklit-ui) patterns adapted for the Decibel brand.

## Core Principles

1. **Dark-first** - Pure black backgrounds with high-contrast elements
2. **Typography-driven** - Let numbers and text carry the design
3. **Minimal chrome** - Avoid unnecessary borders and boxes
4. **Purposeful color** - Yellow primary, semantic accents
5. **Data-focused** - Optimize for reading numbers and charts

---

## Color System

### Primary Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--primary` | Electric Yellow | CTAs, highlights, emphasis |
| `--background` | Pure Black | Page backgrounds |
| `--foreground` | Pure White | Primary text |
| `--muted-foreground` | Gray | Secondary text, labels |

### Semantic Colors

| Token | Color | Usage |
|-------|-------|-------|
| `--success` | Green | Positive values, confirmations |
| `--warning` | Orange | Warnings, caution states |
| `--info` | Blue | Informational, secondary data |
| `--destructive` | Red | Errors, negative values |

### Chart Colors

```css
--chart-1: yellow   /* Primary metric */
--chart-2: purple   /* Secondary metric */
--chart-3: blue     /* Tertiary metric */
--chart-4: green    /* Positive/success */
--chart-5: orange   /* Warning/attention */
```

---

## Typography

### Font Stack

```css
--font-sans: "Inter", system-ui, sans-serif;
--font-mono: "JetBrains Mono", monospace;
```

### Usage Guidelines

| Element | Font | Weight | Size |
|---------|------|--------|------|
| Headlines | Mono | Bold (700) | text-2xl to text-5xl |
| Body | Sans | Normal (400) | text-sm to text-base |
| Labels | Mono | Normal (400) | text-xs uppercase |
| Data/Numbers | Mono | Bold (700) | text-xl to text-7xl |

### Text Classes

```tsx
// Large stat display
<p className="text-5xl font-mono font-bold tabular-nums text-primary">
  1,234
</p>

// Label
<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
  Total Points
</span>

// Body text
<p className="text-sm text-foreground">
  Description text here
</p>
```

---

## Spacing

Use the Tailwind spacing scale. Prefer multiples of 4:

| Size | Value | Common Use |
|------|-------|------------|
| 1 | 4px | Tight gaps |
| 2 | 8px | Icon padding |
| 3 | 12px | Small sections |
| 4 | 16px | Standard padding |
| 6 | 24px | Section gaps |
| 8 | 32px | Major sections |

---

## Component Patterns

### Stat Display

For showing metrics and numbers. No borders, pure typography.

```tsx
<div>
  <p className="stat-label">Total Locked</p>
  <p className="stat-value text-primary">$1.2M</p>
</div>

// Or with Tailwind directly:
<div>
  <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
    Total Locked
  </p>
  <p className="text-4xl font-mono font-bold tabular-nums text-primary glow-text">
    $1.2M
  </p>
</div>
```

### Level Bar

Thin progress indicator, no box.

```tsx
<div className="level-bar">
  <div className="level-bar-fill" style={{ width: '65%' }} />
</div>

// Or with Tailwind:
<div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
  <div className="h-full bg-primary rounded-full" style={{ width: '65%' }} />
</div>
```

### Divider

Gradient fade divider between sections.

```tsx
<div className="divider" />

// Or:
<div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
```

### Glass Panel

Frosted glass effect for overlays.

```tsx
<div className="glass rounded-xl p-4">
  Content here
</div>

// Or:
<div className="backdrop-blur-md bg-zinc-900/80 rounded-xl p-4">
  Content here
</div>
```

### Expandable Section

Minimal expand/collapse with icon rotation.

```tsx
<button className="w-full flex items-center justify-between py-3 group">
  <div className="flex items-center gap-3">
    <Icon className="w-4 h-4 text-purple-400" />
    <span className="text-sm font-mono text-zinc-400 group-hover:text-white">
      Section Title
    </span>
  </div>
  <ChevronRight className={`w-4 h-4 text-zinc-600 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
</button>
```

### CTA Button

Rounded pill with glow.

```tsx
<button className="w-full bg-primary hover:bg-yellow-400 text-black font-mono font-bold text-sm uppercase tracking-wider py-4 rounded-full transition-colors">
  Take Action
</button>
```

---

## Layout Patterns

### Two-Column Stats

```tsx
<div className="grid grid-cols-2 gap-8 px-2">
  <div>
    <p className="stat-label">Metric One</p>
    <p className="text-3xl font-mono font-bold text-white tabular-nums">123</p>
  </div>
  <div>
    <p className="stat-label">Metric Two</p>
    <p className="text-3xl font-mono font-bold text-green-400 tabular-nums">456</p>
  </div>
</div>
```

### Horizontal Stats Row

```tsx
<div className="flex justify-between gap-4">
  <div className="flex-1">
    <p className="stat-label">Deposited</p>
    <p className="text-xl font-mono font-bold text-white">$1,234</p>
  </div>
  <div className="w-px bg-zinc-800" />
  <div className="flex-1">
    <p className="stat-label">DLP</p>
    <p className="text-xl font-mono font-bold text-blue-400">$567</p>
  </div>
</div>
```

---

## Animation

### Framer Motion Presets

```tsx
// Fade in from bottom
initial={{ opacity: 0, y: 20 }}
animate={{ opacity: 1, y: 0 }}
transition={{ duration: 0.4 }}

// Scale bounce
initial={{ scale: 0.9, opacity: 0 }}
animate={{ scale: 1, opacity: 1 }}
transition={{ type: "spring", stiffness: 300, damping: 30 }}

// Staggered children
transition={{ delay: index * 0.1 }}
```

### CSS Animations

```css
/* Pulse glow */
.pulse-glow {
  animation: pulse-glow 2s ease-in-out infinite;
}

/* Animate in */
.animate-in {
  animation: animate-in 250ms ease-out;
}
```

---

## Charts (bklit-ui)

Charts use dedicated CSS variables for theming:

```css
--chart-background: /* Chart area background */
--chart-grid: /* Grid lines */
--chart-line-primary: /* Primary data line */
--chart-line-secondary: /* Secondary data line */
--chart-crosshair: /* Hover crosshair */
--chart-tooltip-background: /* Tooltip bg */
--chart-area-fill: /* Area under line */
```

### Chart Component Integration

```tsx
import { CurvedLineChart } from '@/components/charts/curved-line-chart'

<CurvedLineChart
  showGrid={true}
  animationDuration={1500}
  markers={[
    { date: '2024-01-15', label: 'Launch' }
  ]}
/>
```

---

## Anti-Patterns (What NOT to Do)

### Avoid

1. **Box around everything** - Don't wrap every element in a bordered container
2. **Excessive borders** - Use spacing and color instead of lines
3. **Too many shadows** - Reserve shadows for floating elements
4. **Gradient abuse** - Use gradients sparingly for dividers/accents
5. **Icon overload** - Let text and numbers speak

### Instead

1. Use **typography hierarchy** to create visual separation
2. Use **spacing** (padding/margins) to group related elements
3. Use **color** to indicate importance and state
4. Use **thin level bars** instead of boxed progress indicators
5. Use **gradient dividers** instead of solid borders

---

## File Structure

```
app/
  globals.css          # Design tokens and base styles
components/
  ui/                  # shadcn components (button, dialog, etc.)
  charts/              # bklit-ui chart components
    curved-line-chart.tsx
    chart-grid.tsx
    chart-tooltip.tsx
```

---

## Quick Reference

### Colors (Tailwind)

```
bg-background          # Black
bg-card                # Elevated surface
bg-primary             # Yellow
text-foreground        # White
text-muted-foreground  # Gray
text-primary           # Yellow
border-border          # Dark gray
```

### Radius

```
rounded-sm    # 8px
rounded-md    # 10px
rounded-lg    # 12px
rounded-xl    # 16px
rounded-2xl   # 20px
rounded-full  # Pill
```

### Common Patterns

```tsx
// Glowing number
className="text-5xl font-mono font-bold tabular-nums text-primary"
style={{ textShadow: '0 0 30px var(--primary)' }}

// Muted label
className="text-xs font-mono uppercase tracking-wider text-muted-foreground"

// Gradient divider
className="h-px bg-gradient-to-r from-transparent via-border to-transparent"

// Level bar
className="h-1 bg-zinc-800 rounded-full overflow-hidden"
```
