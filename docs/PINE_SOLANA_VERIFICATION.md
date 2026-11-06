# Pine-to-Solana verification record

Date: **2026-11-06**. Compiler: **0.2.0**, numeric profile: `f64-confirmed-bar-experimental-v2`. This record describes the experimental confirmed-bar order-intent compiler and the exact local fixtures exercised. It is not a universal Pine compatibility certificate, a TradingView broker-emulation result, or a network deployment.

Machine-readable measurements, verified implementation-file hashes and binary hashes are in [PINE_SOLANA_VERIFICATION.json](PINE_SOLANA_VERIFICATION.json). Source and configuration hashes in that record identify each fixture. Later compiler/runtime changes require fresh verification.

## Results

| Check | Result |
| --- | --- |
| Core TypeScript compiler/parser/runtime/API/reference/CLI/code-generation suite | **226/226 passed** |
| Strict TypeScript subset typecheck | Passed |
| Embedded Rust source and dependency lock synchronization | Passed |
| Native Rust runtime, generated graph and differential tests | **60/60 passed**: 17 runtime and 43 generated tests |
| TypeScript/native Rust differential coverage | 21 fixtures, 1,658 successful bars, 4 expected atomic rejections, 58,761 graph values and 26,441 persisted state cells; 6 fixtures use exact f64-bit comparisons |
| Generated Anchor native compilation | Passed for the EMA project |
| Actual SBF v3 compilation | **3/3 binaries built**: EMA, resource boundary and semantic boundaries, using locked dependencies |
| Actual SBF transaction execution in LiteSVM | **7/7 passed** across three binaries |
| SBF versus TypeScript replay | 720 bars, **4,292 ordered intents** and **218,160 persisted state cells** compared |
| CSV import and verification | Hand-calculated fixtures, malformed/resource tests and actual CLI success/mismatch/error paths passed |
| Independent TradingView-export certification | Not performed; no independent export corpus supplied |
| Full existing Next.js application build and unrelated Aptos tests | Not run as part of this compiler verification |
| Network deployment or real trading | Not performed |

The TypeScript/Rust and TypeScript/SBF differential expectations are generated from the TypeScript evaluator. They catch backend disagreement, but cannot reveal a compiler semantic mistake shared by both sides. The separate hand-calculated fixtures cover selected numerical and state transitions, not every Pine built-in or execution condition. Synthetic CSV fixtures are labeled hand-calculated; they are not TradingView captures.

## Local SBF measurements

Each program replayed the repository's **240 synthetic OHLCV candles**, used the default **32 KiB heap**, and requested a **1,400,000-CU transaction limit**. The harness loads the actual `.so` into LiteSVM; it does not substitute the host evaluator.

| Measurement | EMA crossover | Resource boundary | Semantic boundaries |
| --- | ---: | ---: | ---: |
| Graph nodes | 34 | 256 | 68 |
| Numeric state cells | 2 | 900 | 7 |
| Numeric state bytes | 16 | 7,200 | 56 |
| Total strategy account bytes | 214 | 7,398 | 254 |
| Compiled order sites | 2 | 16 | 3 |
| Intent events over 240 bars | 12 | 3,840 | 440 |
| Maximum compute units per bar | **22,092** | **295,541** | **34,407** |
| Mean compute units per bar | 21,323.558 | 256,777.375 | 34,055.888 |
| SBF binary bytes | 236,112 | 255,552 | 238,872 |

The resource fixture reaches the graph, state and order-site caps simultaneously, uses 64-byte order identifiers, and emits all 16 intents on each bar. Its successful execution exercises the allocation pressure that previously required removing an extra state-buffer copy. Heap allocation was not instrumented; success establishes that this binary and fixture ran without requesting a larger heap. It is not a proof that every accepted graph fits every transaction budget.

The resource fixture's 295,541-CU peak must be considered when setting a transaction compute budget; the recorded test limit is explicit. The semantic fixture covers tiny casts, large odd-integer rounding, static lookback selection, persistent/history values, integer `ta.change`, and all three supported intent kinds. Integer-valued state, ring metadata, booleans and rounded values are compared exactly where identified by their IR operations; other stored floats use a small explicit tolerance and exact missing masks.

The VM tests verify:

- Feed signatures and immutable feed identity; unauthorized or unsigned submissions fail.
- Market, timeframe, expected sequence and exact timestamp checks.
- Rejection of an unclosed candle and malformed OHLCV.
- Owner-only pause/resume and rejection while paused.
- Replay rejection and continued successful processing after rejected transactions.
- Unchanged strategy-account data on each rejected transaction.
- Fixed account size across the complete replay.
- Every persisted numeric cell and its missing mask after each replayed bar.
- Complete intent order and fields: kind, identifier, side, optional quantity, account/market/source/configuration bindings, bar index and timestamp.
- An integer delta outside the exact supported range rejects atomically, and a valid retry of the same candle slot succeeds from the original history.

The event wire format uses a quantity-presence flag plus a fixed u64 numeric-bit payload. Close events have an absent quantity and zero payload bits. The harness verifies both fields rather than treating the payload as a variable-width `Option<f64>`.

The setup uses fresh local keypairs and VM airdrops. Recorded initialization compute can vary with PDA derivation; the JSON preserves the measured value for the recorded run. These tests do not establish truthful exchange prices, real fills, custody safety or DEX integration.

## Reproduce

Install the repository's Node/pnpm dependencies, Rust **1.99.1**, and `cargo-build-sbf` **4.5.0**. The recorded execution environment used Node **24.22.1**, TypeScript **5.9.3**, `tsx` **4.20.6**, and SBF platform tools **v1.57** / Rust **1.95.0-dev**. The existing repository targets Node **22.x** in CI. LiteSVM dependencies are isolated and locked under `tests/solana-vm`.

```bash
pnpm typecheck:pine-solana
pnpm test:pine-solana
pnpm pine:solana:sync-runtime --check

pnpm pine:solana:parity
cargo +1.99.1 test --manifest-path build/pine-solana-parity/Cargo.toml --locked

cargo build-sbf --install-only --tools-version v1.57

pnpm pine:solana compile examples/pine-solana/ema-cross.pine --out build/ema-cross
cargo build-sbf --manifest-path build/ema-cross/programs/pine_strategy/Cargo.toml \
  --arch v3 --tools-version v1.57 -- --locked
npm ci --prefix tests/solana-vm
pnpm pine:solana:sbf-reference build/ema-cross
node --test tests/solana-vm/runtime.test.mjs

pnpm pine:solana compile tests/solana-vm/resource-boundary.pine --out build/resource-boundary
cargo build-sbf --manifest-path build/resource-boundary/programs/pine_strategy/Cargo.toml \
  --arch v3 --tools-version v1.57 -- --locked
pnpm pine:solana:sbf-reference build/resource-boundary
PINE_SOLANA_PROJECT=build/resource-boundary node --test tests/solana-vm/runtime.test.mjs

pnpm pine:solana compile tests/solana-vm/semantic-edge.pine --out build/semantic-edge
cargo build-sbf --manifest-path build/semantic-edge/programs/pine_strategy/Cargo.toml \
  --arch v3 --tools-version v1.57 -- --locked
pnpm pine:solana:sbf-reference build/semantic-edge
PINE_SOLANA_PROJECT=build/semantic-edge node --test tests/solana-vm/runtime.test.mjs
```

Each VM replay writes `svm-report.json` under its generated project. `svm-reference.json` binds expectations to source/configuration and candle-file hashes. The native harness requires explicit expected rejection indices; unexpected evaluator failures cannot silently reduce coverage. Generated programs include `Cargo.lock`; source generation alone does not invoke Cargo, create a network account or deploy anything. The default development program ID supports local inspection and VM testing. Preparing a real deployment requires a proper program keypair/ID and an explicitly reviewed execution and market-data integration.

The separate **Pine to Solana core** workflow runs core TypeScript/reference tests, source synchronization and native differential checks independently of unrelated Aptos selftests. The SBF/VM checks above are reproducible local commands, not an automated deployment job. Anchor 0.31.1 emits an account-reallocation deprecation warning; all three SBF builds completed successfully.

## Regression guards added during review

The tests cover complete lexical consumption and branches, final committed series history, independent function-call state, missing values versus zero, v5/v6 boolean/integer boundaries, rejection of conditional stateful evaluation and unsupported broker/data features, atomic numerical failure, Unicode order identifiers, source/IR escaping, and configuration-bound runtime snapshots.

The public compilation path also rejects excessive source, tokens, syntax depth, graph size, state, order count, input declarations and resolved input metadata. Input aliases cannot amplify a small source into an unbounded response. Constant evaluation memoizes graph nodes per call so a compact shared expression graph does not cause exponential traversal. A separate runtime period limit of 1,024 permits long EMA/RMA periods without confusing their small state requirement with the independent 900-cell cap.

See the [compatibility contract](PINE_SOLANA_COMPATIBILITY.md) for the exact accepted language and explicit rejections.

The [0.2.0 core change record](PINE_SOLANA_CORE_CHANGES.md) covers the new numeric, guard, syntax, state-integrity and reference-verification regressions. Compiler/configuration commitments changed: recompile source and replay its intended history when migrating from 0.1.0 instead of reusing old snapshots.
