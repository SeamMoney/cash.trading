# PineScript-to-Move Edge Cases

These cases document the current boundary for the launchpad V3 compiler.

## `na()` and `nz()`

Supported:

```pine
fast = ta.sma(close, 5)
buy = not na(fast) and close > nz(fast[1], close)
```

Expected Move lowering:

```move
!((state.fast == 0))
if ((prev_fast == 0)) { price } else { prev_fast }
```

The compiler uses `0` as the on-chain `na` sentinel for TA values.

## `ta.supertrend(factor, atrPeriod)`

Supported:

```pine
[st, direction] = ta.supertrend(3.0, 10)
```

Expected compiler output:

```move
let st_atr = compute_sma(&buf.prices, 10);
let band_offset = ((st_atr as u128) * (30 as u128) / 10) as u64;
let direction: u64 = if (price > upper_band) { 1 } else ...
state.direction = direction;
state.st = st_atr;
```

The first tuple target is the SuperTrend line, the second is direction. Direction is encoded as `1` for up and `2` for down because Move has no signed integer type.

## Dynamic History Indexes

Rejected:

```pine
len = input.int(2)
lagged = close[len]
```

Expected behavior:

```text
errors[] includes "dynamic history indexing"
moveSource starts with "// PineScript-to-Move transpilation rejected."
```

Use a literal offset such as `close[1]` when compiling to Move.

## Inline ta.* calls inside expressions (hard reject)

```pine
bear_div = ta.pivothigh(tci, 5, 5) < prevPivot
```

Expected behavior:

```text
errors[] includes "ta.pivothigh used inline inside a larger expression"
```

The inline-ta fallback in pine-ir emits `ta_<fn>(...)` calls, but every emitted
helper is named `compute_*`, so the Move could never compile. Assigning the call
to its own variable works — with a caveat:

## Pivot/TA source argument is silently price (known gap)

`ph = ta.pivothigh(tci, 5, 5)` compiles, but `compute_pivothigh` always reads
`&buf.prices` — the `tci` source argument is dropped (pine-ir.ts taCalls step).
Pivots over a *computed series* would need per-series history buffers. Until
then this is semantically wrong for non-price sources; the inline reject above
keeps the worst case (silent wrong strategy in a published vault) out, but the
statement form still mis-binds. Flagged for a future series-buffer pass.

## OHLC composite sources (hard reject)

```pine
ap = hlc3
```

Expected behavior:

```text
errors[] includes "Unsupported source `hlc3`"
```

The on-chain feed is close-only; `hlc3`/`hl2`/`ohlc4`/`hlcc4`/`volume` would
become undeclared state fields. (`high`/`low`/`open` currently alias to the
close price in convertExpr — a separate honesty gap, warned via `needsOHLC`.)
