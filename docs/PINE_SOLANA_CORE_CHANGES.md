# Pine-to-Solana core changes — 0.2.0

This revision focuses on compiler and execution correctness. It includes no mobile UI changes. The compiler remains an experimental, bounded confirmed-bar order-intent target; the exact compatibility boundary is in [PINE_SOLANA_COMPATIBILITY.md](PINE_SOLANA_COMPATIBILITY.md).

## Language semantics

The new regression cases exposed accepted source with observably wrong behavior:

| Case | Correction |
| --- | --- |
| `bool(1e-10)` and `int(-1e-10)` | Exact numeric truth and sign-aware truncation; rounded float comparisons no longer erase tiny nonzero values. |
| `length = 1.0000000001 == 1.0 ? 1 : 2` | Compile-time folding and runtime comparison use the same nine-decimal rule. Previously the emitted output said 1 while the compiled SMA used period 2. |
| Rounding immediately below a half and at large odd integers | Correct nearest-integer rounding with ties toward positive infinity, without the extra addition rounding in `floor(x + 0.5)`. |
| Constant nonfinite results | Missing-value normalization happens at every operation, matching the emitted runtime before static branches or metadata are resolved. |
| Computed integers, integer inputs and conversions outside the exact range | Compile-time diagnostics or guarded runtime failure; no silently rounded integer execution. Checks preserve skipped branches and one-time initialization. |
| `ta.change(intSource)` in v5/v6 | Preserve the integer overload and reject out-of-range differences atomically. A valid retry retains the previous committed history. |
| Integer modulo near the range boundary | Avoid a rounded intermediate product; `-9007199254740991 % 3` now produces 2. |
| Legacy missing `if` predicates | A missing condition takes the `else` branch for both variable values and order intents. |
| Legacy integer division and input defaults | Preserve `const`, `input`, `simple` and `series` qualifications through supported operations. `na`/`nz` do not acquire an invalid `const` qualifier. |
| v4 `rsi(close, 3.0)` | Reject the unimplemented ratio overload instead of silently substituting Wilder RSI. |
| Float periods/history indices | Require an integer-typed expression, including an explicit `int()` conversion where appropriate. |
| Loop bounds and mutations | Count bounded iterations with exact integer arithmetic. Reject counter mutation that native unrolling cannot faithfully execute; preserve nested lexical scopes. |
| Function globals and `_` | Capture only globals declared above the function. `_` discards values and cannot be read. |
| Invalid line wrapping, reserved names and repeated history operators | Reject invalid source with targeted diagnostics; preserve valid neighboring syntax and version differences. |

Regression fixtures include separately calculated expected values and negative cases. They do not relabel outputs from this compiler as independent TradingView evidence.

## Runtime and artifact integrity

The TypeScript interpreter and Rust source generator now reject invalid operations, types, current-bar dependency cycles, impossible history requirements, overlapping layouts, wrong auxiliary sizes, malformed orders, and excessive metadata. Positive history/persistent edges can still reference the final value of a later node from the preceding bar.

Configuration hashes are recomputed from a canonical, versioned commitment to the executable graph, source identity, resolved inputs, outputs, layouts and bounds. A caller cannot modify an exported graph while retaining its old hash. Runtime instances detach themselves from caller-owned graph arrays. Hash consistency does not authenticate the source or attest to a deployed executable.

Snapshots validate ring heads/counts, sample occupancy, boolean history, recursive-average seed state and timestamp consistency. Invalid state and failed evaluation leave prior committed state intact. Source/configuration commitments changed in compiler 0.2.0; recompile source and replay history instead of reusing 0.1.0 graphs or snapshots.

## Independent-reference workflow

`import-reference` converts an explicitly mapped TradingView-style CSV to the source/configuration-bound reference format. It preserves supplied values, missing masks and timestamps. It requires declared time units, real ISO calendar dates, all OHLCV fields, unique column titles, consistent rows and bounded data. Expected outputs are never obtained by running the strategy during import.

Reference reports now retain the total mismatch count even when examples are truncated, expose per-series coverage and missing-value counts, and compare extreme finite values without an overflow false pass. Serialization budgeting includes repeated long output names, closing a small-file-to-large-output amplification path.

## Verification

The native harness compares intermediate values, every persisted state cell and complete ordered intent fields. Numerical boundary fixtures use exact comparisons where an ordinary relative tolerance could hide an integer error.

The local VM harness executes actual SBF binaries, verifies authorization and atomic rejection, and compares persisted account state plus all ordered `entry`, `close` and `close_all` events. A semantic-edge fixture exercises tiny numeric casts, rounding, static lookback selection, persistent history and close events in addition to EMA and maximum-resource fixtures.

[PINE_SOLANA_VERIFICATION.md](PINE_SOLANA_VERIFICATION.md) and its JSON record identify the final checked revision's results, toolchains and binary hashes. The separate **Pine to Solana core** CI workflow runs compiler/reference tests and native parity without depending on unrelated Aptos selftests. SBF/VM commands are documented as local verification and do not deploy to a network.
