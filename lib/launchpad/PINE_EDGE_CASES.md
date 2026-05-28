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
