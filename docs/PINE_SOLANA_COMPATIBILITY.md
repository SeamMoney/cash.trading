# Pine Script to Solana: compatibility contract

## Current status

The native compiler in `lib/pine-solana/` is an experimental, bounded **confirmed-bar order-intent compiler**. It accepts a documented subset of Pine Script v4, v5 and v6, produces a versioned numeric graph and Rust/Anchor project, and includes a TypeScript evaluator for replaying that graph. Unsupported execution semantics return source diagnostics and no generated project.

This is not a universal Pine interpreter or a certified implementation of TradingView. The project does not currently reproduce TradingView's broker emulator, execute swaps, submit transactions to a DEX, obtain market data automatically, or establish that a reported bar is economically correct. The generated program relies on its configured candle authority. A caller can supply fabricated prices if that authority is compromised or misconfigured.

The manifest records `executionModel: "confirmed-bar-signal"`, `tradingViewEquivalence: "not-certified"`, `brokerEmulator: false`, `dexAdapter: null` and `deployment: "not-deployed"`. The distinction is observable behavior: an entry intent contains an order identifier, side, quantity and source bar. It has no fill price, actual position, account balance, commission, slippage or P&L. Source generation, native tests and local VM execution do not deploy a program to a network.

“Handle any Pine Script” is the long-term compatibility objective. At this stage, handling an unsupported script means diagnosing it without substituting an unrelated indicator, inventing entry rules, silently dropping an executable branch, or pretending an external dataset is the current close.

## Relationship to the existing repository

The repository already contains a substantial Pine-to-contract effort, principally for **Move/Aptos**:

| Existing code | What it contributes to this implementation |
| --- | --- |
| `lib/launchpad/pine-parser.ts` | Lessons about lexical parsing, input discovery and the consequences of incomplete indentation tracking. |
| `lib/launchpad/pine-ir.ts` | Architecture lessons about a separate IR, state allocation, unsupported TA detection and distinguishing explicit from inferred signals. |
| `lib/launchpad/move-codegen.ts` | A precedent for generating a contract project from an intermediate representation. |
| `lib/launchpad/pine-runtime.ts` and `pinets-runner.ts` | Existing preview/replay context; neither is an independent TradingView conformance oracle. |

The Solana frontend is a **new strict parser and typed graph**, not a claim of direct reuse of the legacy AST or Move runtime. The legacy code has preview-oriented recovery, strategy inference paths and historical substitution concerns that are inappropriate as an implicit native execution contract. Those files remain useful research and migration references. Existing legacy UI success does not imply native Solana compatibility.

## Execution profile

The TypeScript evaluator receives one OHLCV bar per `push()`. A bar has finite `open`, `high`, `low`, `close`, `volume` and a nonnegative safe integer `time` in milliseconds. Times must strictly increase, volume must be nonnegative, and OHLC bounds must be consistent. The runtime assigns `bar_index` from the number of accepted bars, beginning at zero.

One invocation evaluates globally scheduled graph nodes, produces the ordered intents selected by that bar's guards, and commits persistent state. Integer range checks respect their actual source execution guards. Invalid candles, executed out-of-range integer operations, invalid triggered quantities and invalid indicator seed state fail atomically. The runtime does not advance its bar counter or any indicator state after a rejected push. Snapshots identify the compiler configuration hash and can resume the same series state after structural validation; they are not authenticated proofs of their contents.

The generated Anchor adapter imposes additional conditions: the immutable feed authority signs; market and timeframe match the account; the supplied expected bar index matches state; and `time` is exactly `origin_ms + bar_index * timeframe_ms`. The candle's close (`time + timeframe_ms`) must be no later than the Solana clock. These conditions reject replay and skipped intervals. The owner can pause and resume, but cannot rotate the feed or change the initialized source/configuration through the generated interface. This version has no exchange-session calendar or irregular-bar adapter, so a dataset with missing intervals cannot be submitted unchanged.

The caller must supply the intended finalized bars and the correct dataset start. TypeScript replay does not enforce a chain clock or authenticate a market-data source. The Anchor clock check proves that an interval has elapsed, not that its prices are truthful or its aggregation policy matches TradingView. An EMA started at a different historical point can produce different output. Chart `barstate.isconfirmed` is always true in this execution profile; `barstate.isfirst` corresponds to the first accepted bar. Other realtime/bar-state flags are rejected.

TradingView can execute repeatedly on an open bar, roll ordinary state back between updates, and preserve `varip` state across those updates. Reproducing that behavior requires a different execution profile with explicit tick data and commit/rollback semantics. This implementation rejects `varip` and settings that request tick or fill recalculation. [TradingView execution model](https://www.tradingview.com/pine-script-docs/language/execution-model/)

## Accepted language and data

| Feature | Supported profile |
| --- | --- |
| Version | An explicit `//@version=4`, `5` or `6`; omitted, duplicated and unknown versions are errors. Acceptance does not establish complete language-version compatibility. |
| Script declarations | Exactly one global `strategy()`, `indicator()` or legacy `study()` before executable statements. Only recognized configuration options are allowed. |
| Literals and expressions | Finite numeric literals, booleans, compile-time strings, numeric `na`, arithmetic, comparisons, boolean operations, unary operators and matching numeric/boolean ternary branches. Color literals are accepted only as display metadata, never as executable strings or numbers. |
| Market series | `open`, `high`, `low`, `close`, `volume`, `time`, `bar_index`, `hl2`, `hlc3`, `ohlc4` and `hlcc4` from the supplied bars. |
| Declarations | Ordinary scalar variables, supported scalar type annotations, global scalar `var`, reassignment and arithmetic compound assignment. Persistent strings and stateful TA/history inside a `var` initializer are unsupported. |
| Control flow | Nested `if`/`else`; constant-bound, inclusive `for` loops of at most 32 iterations with positive integer steps and exact integer bounds. Descending loops are supported. Counter reassignment is rejected because native unrolling does not implement it. In v6, mutation of an end-bound dependency is rejected, including dependencies captured by called functions. |
| History | Numeric and boolean series with constant integer nonnegative offsets within the configured history bound. The stored value is the final value committed for that series on the prior bar. Computed expression history is supported; literal history is rejected in v6. Repeated indexing on the same value, such as `close[1][2]`, is rejected. |
| Functions | Global untyped-parameter functions containing pure local declarations and one scalar return expression. Only globals declared above a function are visible to it. Separate written calls expand to separate indicator state. `_` discards values. No recursion, overloads, persistent function locals, side effects or general return control flow. |
| Tuples | Tuple declarations from literal tuples and the implemented tuple-returning TA functions; general user-defined tuple returns are not implemented. |
| Inputs | Compile-time `input`, `input.int`, `input.float`, `input.bool`, `input.string` and restricted `input.source`; overrides are keyed by the declaration's variable name. Defaults and metadata are validated even when overridden. Integer/range/type constraints are checked. `options` lists are rejected. The selected input values participate in the configuration hash. |

Stateful TA and history inside conditional execution contexts are rejected. This includes conditional branches, ternaries, loop bodies, `var` initializers and the right side of Pine v6 lazy `and`/`or` when they contain such operations. The compiler also conservatively rejects these operations directly in order arguments; precomputed global series can be referenced there. Hoisting a call in the source is an explicit source change: the compiler does not silently move it and claim equivalent behavior. Pine functions have independent histories at written call sites, so a future conditional-call implementation must preserve call scheduling as well as values. [TradingView user-defined functions](https://www.tradingview.com/pine-script-docs/language/user-defined-functions/)

Pine v6 differs from v5 in boolean missing values, implicit numeric-to-boolean conversion, lazy evaluation, constant integer division, allowed history expressions and the removed strategy `when` argument. The tests cover selected boundaries; they are not a complete version-migration suite. [TradingView migration to v6](https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/)

## Implemented numeric functions

The implemented native function families are deliberately enumerated:

- Missing-value handling and conversion: `na`, `nz`, `bool`, `float`, `int`, within their accepted scalar types.
- Arithmetic helpers: `math.abs`, `math.min`, `math.max`, `math.floor`, `math.ceil`, `math.round` without precision, `math.sqrt`, `math.sign`.
- Averages and dispersion: `ta.sma`, `ta.ema`, `ta.rma`, `ta.wma`, `ta.stdev`, `ta.variance`; only population/biased variance is supported.
- Windows and changes: `ta.highest`, `ta.lowest`, `math.sum` and accepted legacy sum spelling, `ta.change`, `ta.mom`, `ta.roc`.
- Crossing predicates: `ta.crossover`, `ta.crossunder`, `ta.cross`.
- Composite indicators: `ta.rsi`, `ta.atr`, `ta.tr(...)`, `ta.stoch`, tuple `ta.macd` and tuple `ta.bb`.

Applicable v4 global function spellings are normalized by the compiler. This is not a claim that every v4 overload exists: the float/series-int ratio overload of v4 `rsi()` is rejected instead of becoming Wilder RSI. Use `math.sum` in v5/v6 or `sum` in v4; `ta.sum` is rejected. `ta.tr` requires an explicit compile-time boolean `handle_na` argument, `ta.roc` and `ta.mom` require explicit lengths, and `ta.variance`/`ta.stdev` reject `biased=false`. Periods must resolve to bounded compile-time integer-typed expressions, including supported input values; a whole-valued float such as `3.0` is not an integer type. A valid Pine function outside this list is still unsupported here: for example, `ta.hma` is rejected rather than approximated with an SMA.

The local fixtures distinguish SMA warmup, EMA's first-sample seed, Wilder RMA's average seed, RSI's first missing delta, MACD's signal recurrence and signed histogram, weighted averages, and missing samples. Edge cases requiring additional independent TradingView evidence include all-flat RSI, sparse-source RSI, numerical overflow, long recurrence drift and version-specific overloads. A formula's familiar name is not sufficient proof of exact built-in equivalence.

## Orders, visuals and alerts

`strategy.entry` supports explicit constant identifiers of at most 64 UTF-8 bytes, `strategy.long` or `strategy.short`, and positive finite quantities in fixed asset units. Omitting quantity uses the supported fixed default. Quantity may reference a precomputed numeric series; if a triggered entry has a nonpositive or missing quantity, the bar fails atomically. `strategy.close` and `strategy.close_all` emit close intents. Partial-close sizing is unsupported. Nested conditions determine which intents occur; source order determines their order. In v4/v5, supported `when` arguments contribute a guard. In v6, the removed `when` argument is rejected.

These commands are an explicit **intent interpretation** of strategy source. They do not implement reversal sizing, pyramiding suppression, pending orders, position matching, next-bar-open fills, stop/limit triggers, commissions or an order book. Strategies that read `strategy.position_size`, trade history or similar broker state fail because there is no real fill adapter. Nondefault broker settings are rejected when they would otherwise be silently lost.

TradingView's broker emulator models order creation and filling as distinct operations and normally fills a newly created market order on a later available tick. Its results depend on strategy settings and available intrabar data. Matching that engine requires a separately specified and tested broker implementation. [TradingView strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/)

An indicator needs explicit `signals.long`, `signals.short` or `signals.close` boolean expressions in the compile options. An RSI plot does not imply buying below 30 or selling above 70. An alert is not implicitly an order. A script without explicit trading intent fails with `NO_TRADING_INTENT`.

Recognized standalone chart-only calls produce informational diagnostics and do not create on-chain graphics. Numeric `plot()` series may appear in replay outputs. Plot/hline handles stored in variables are not implemented. Argument expressions still need validation; chart-only context is not an escape hatch for unsupported external-data calls. The compiler is not a complete TradingView checker for every presentation-only signature or qualifier. General drawing objects, object getters, tables, string processing and visualization-dependent logic are outside the native profile.

Recognized declaration metadata, including `max_bars_back`, does not increase compiler storage. Use the `maxHistory` and `maxStateBytes` compile options to configure those bounds. Optional order comments/alert metadata are checked but do not deliver alerts or change venue execution.

## Explicitly unsupported families

| Family | What is missing |
| --- | --- |
| Realtime/ticks | `varip`, open-bar recalculation, rollback, historical/realtime discrimination, tick-triggered alerts. |
| Multiple data contexts | Every `request.*` family, other symbols/timeframes, lower-timeframe arrays, corporate actions, fundamentals, economic series, currency conversion and external datasets. |
| Market metadata | General `syminfo`, `timeframe`, sessions, calendar functions, exchange timezones and synthetic-chart data. |
| Broker/venue execution | Broker state and getters; stop, limit and trailing orders; cancellation; risk rules; commissions, slippage, margin, balances and actual fills. |
| Reference types | Arrays, maps, matrices, user-defined objects, enums, methods, reference aliasing and object history. |
| Language extensions | Imports/exports, libraries, overloads, typed/defaulted function parameters, general tuple-returning functions, `switch`, unbounded loops, `break` and `continue`. |
| Dynamic scheduling | Conditional stateful calls/history, local `var`, variable-length TA, dynamic history indices and runtime loop bounds. |
| Display and side effects | Chart rendering, general drawing handles and getters, tables, dynamic strings, logging and alert delivery. |
| Unimplemented built-ins | Any numeric, statistical or TA function without an explicit lowering implementation. |

`request.security` cannot be replaced by chart OHLC. Its expression runs in another data context and merges results according to timing/gap/lookahead rules. Confirmed chart bars can still contain unconfirmed higher-timeframe values. A future adapter must identify the dataset, publish availability, and reproduce those merge semantics without introducing future information. [TradingView other timeframes and data](https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/)

## Numeric profile and resource bounds

The numeric profile is `f64-confirmed-bar-experimental-v2`. Runtime missing numbers use a distinct missing representation and serialize as JSON `null`; zero remains zero. Pine v6 nonexistent boolean history is false. Constant folding and runtime comparisons use the same nine-decimal rounding rule, avoiding scaling where it would lose representable information. Numeric truth uses exact nonzero conversion, and integer truncation uses the actual sign rather than a rounded comparison to zero. Ordinary non-finite floating arithmetic output becomes missing. Invalid persistent calculation state, such as an overflowing RMA seed accumulator, rejects the whole bar instead.

Integer literals, input overrides, conversions and computed integer values are bounded to `[-9007199254740991, 9007199254740991]`. Known violations produce `INTEGER_RANGE` or the frontend's literal-range diagnostic. Dynamic checks reject the whole bar without committing state, and respect conditional execution and one-time initializers. This is an explicitly bounded integer profile, not Pine's full integer domain or arbitrary-precision arithmetic. Floating-point values are not restricted to this integer range.

Compiler 0.2.0 changes the configuration commitment. Both the simulator and generator validate the serialized graph before using it and recompute its canonical SHA-256 commitment. Old compiler versions, tampered graph/hash pairs, impossible dependency/type/layout combinations and malformed order/state data reject. The simulator detaches its graph from the caller's mutable objects. Snapshot validation includes ring headers/occupancy and boolean/recursive state invariants. Structural validity and hash consistency are not evidence of authentic market history or correct source provenance.

This is not bit-for-bit certification of TradingView arithmetic. Pine's documented precision and comparison rules are a baseline, not a substitute for numerical testing of built-ins, ties, negative values, large magnitudes and accumulated error. [TradingView type system](https://www.tradingview.com/pine-script-docs/language/type-system/)

| Bound | Current limit |
| --- | --- |
| Compiler input | 128,000 UTF-8 bytes. |
| Frontend | 50,000 tokens, 20,000 syntax nodes and nesting depth 96. |
| Expanded numeric graph | 256 nodes. |
| Declared inputs | 128 input declarations. |
| Resolved input metadata | 65,536 combined UTF-8 bytes across names, resolved string/source values and input presentation text (`title`, `tooltip`, `inline`, `group`). Reusing a string alias counts each resolved occurrence. |
| Order instructions | 16 per compiled graph. |
| Order identifier | 64 UTF-8 bytes. |
| Constant loop | 32 iterations. |
| Function expansion | No recursion; at most 8 nested calls. |
| Expression lowering | 10,000 expression visits. |
| Default maximum history/period | 128. |
| Configurable history ceiling | 1,024, subject to the state budget. |
| Series storage | At most 7,200 bytes / 900 eight-byte cells; configured budgets may range from 8 through 7,200 bytes. |
| HTTP request body | 160,000 bytes, including JSON overhead; separate from the Pine source limit. |
| CLI simulation/reference dataset | 100,000 bars. |
| CSV reference import | 16 MiB UTF-8 input, 512 columns, two million source cells/mapped values, explicit time/OHLCV/output columns. |
| Reference serialization | Conservative 128 MiB budget, including repeated JSON-escaped output names and scalar/framing overhead. |

Series-state size is computed during compilation and remains bounded as bars accumulate. The state budget does not include every byte of Anchor account metadata, instruction serialization, emitted events or transaction overhead. The current generated account allocation is `198 + 8 * stateCells` bytes, up to 7,398 bytes. Account size is not a heap-usage or compute-unit estimate.

Solana executes under a finite compute budget, has bounded call stacks and provides limited/software floating-point support. A native Rust test therefore does not establish successful SBF compilation or adequate transaction compute. Deployment validation must use the actual Solana toolchain and transaction execution environment. [Solana program limitations](https://solana.com/docs/programs/limitations)

## What verification establishes

`tests/pine-solana-parser.test.ts` exercises syntax preservation, complete token consumption, diagnostics and parser resource limits. `tests/pine-solana-conformance.test.ts` exercises compilation, deterministic artifacts, unsupported-feature rejection, missing values, series history, persistent updates, independent call state, hand-calculated numerical traces, input overrides, explicit intents, bounded state, snapshots and atomic failures. The audit suite adds regressions for type preservation, mutable v6 loop bounds, metadata bypasses, numerical overflow and snapshot integrity. API and code-generation suites check public request handling, reference validation, artifact escaping and that generated runtime/lockfile contents match the checked-in sources.

The differential fixture suite compares intermediate values, persisted state/missing masks and ordered intent fields between TypeScript and generated native Rust. Selected numerical boundaries use exact comparisons so a relative tolerance cannot hide an integer error. Expected rejection bars are explicit; an unexpected evaluator failure fails the harness instead of silently shortening coverage. This demonstrates backend consistency for those cases; it is not a TradingView-export comparison. [The verification record](PINE_SOLANA_VERIFICATION.md) is authoritative for pass counts, binary-specific SBF/VM evidence and remaining validation limits. See [the usage guide](PINE_SOLANA.md#conformance-and-verification) for reproduction commands.

Hand-calculated fixtures and TypeScript-versus-Rust comparison establish useful local correctness properties. Both runtimes share the same compiler and IR, so agreement between them cannot detect a semantic mistake shared by both. **No independent TradingView-exported fixture suite currently certifies this implementation.**

The next certification gate is a reproducible fixture corpus exported from TradingView. Each fixture should preserve:

1. Exact source and Pine version, source/configuration hashes, all input values, and strategy settings.
2. Symbol, chart type, timeframe, exchange session/timezone, dataset start and every OHLCV timestamp used.
3. Per-bar intermediate plots, `na` masks, boolean outputs and explicitly selected signal conditions, without inferring fills from signals.
4. Documented tolerances and mismatch policy; order predicates and missing-value boundaries need exact agreement, not only visually similar curves.
5. Warmup, zero/negative values, equality boundaries, long streams, gaps, flat RSI, sparse sources, separate function call sites and reassigned histories.

Validation reports must distinguish syntax tests, TypeScript execution, native Rust compilation/replay, SBF compilation, local-validator transactions and deployment. Do not describe a generated Anchor project as a deployed or fully verified trading contract. Actual venue integration additionally needs authenticated market-data handling, confirmed fill state, custody/risk limits and a specified relationship between Pine order intents and venue instructions.

Source/configuration hashes do not prove that a deployed executable matches the generated Rust or that its upgrade authority has been removed. The source-only manifest remains `not-deployed`; any separate build or VM report must identify the actual binary and the fixture it exercised. An external reference file's `origin` label is a provenance claim supplied by its author, not independent authentication by the verifier.
