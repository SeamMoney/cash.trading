# Pine-to-Solana verification record

Date: **2026-11-05**. This record describes the experimental confirmed-bar order-intent compiler and the exact local fixtures exercised. It is not a universal Pine compatibility certificate, a TradingView broker-emulation result, or a network deployment.

Machine-readable measurements and binary hashes are in [PINE_SOLANA_VERIFICATION.json](PINE_SOLANA_VERIFICATION.json). Source and configuration hashes in that record identify each fixture. Later compiler/runtime changes require fresh verification.

## Results

| Check | Result |
| --- | --- |
| TypeScript compiler/parser/runtime/API/code-generation suite | **152/152 passed** |
| Strict TypeScript subset typecheck | Passed |
| Embedded Rust source and dependency lock synchronization | Passed |
| Native Rust runtime, generated graph and differential tests | **38/38 passed**: 9 runtime and 29 generated tests |
| TypeScript/native Rust differential coverage | 14 fixtures, 1,627 successful bar evaluations, 57,316 intermediate graph values; atomic overflow rejection also checked |
| Generated Anchor native compilation | Passed for the EMA project |
| Actual SBF v3 compilation | Passed for EMA and the resource-boundary fixture, using locked dependencies |
| Actual SBF transaction execution in LiteSVM | **4/4 passed**: two tests for each of the two compiled binaries |
| Independent TradingView-export certification | Not performed; no independent export corpus supplied |
| Full existing Next.js application build and unrelated Aptos tests | Not run as part of this compiler verification |
| Network deployment or real trading | Not performed |

The TypeScript/Rust differential expectations are generated from the TypeScript evaluator. They catch backend disagreement, but cannot reveal a compiler semantic mistake shared by both runtimes. The separate hand-calculated fixtures cover selected numerical and state transitions, not every Pine built-in or execution condition.

## Local SBF measurements

Both programs replayed the repository's **240 synthetic OHLCV candles**, used the default **32 KiB heap**, and requested a **1,400,000-CU transaction limit**. The harness loads the actual `.so` into LiteSVM; it does not substitute the host evaluator.

| Measurement | EMA crossover | Resource boundary |
| --- | ---: | ---: |
| Graph nodes | 34 | 256 |
| Numeric state cells | 2 | 900 |
| Numeric state bytes | 16 | 7,200 |
| Total strategy account bytes | 214 | 7,398 |
| Compiled order sites | 2 | 16 |
| Intent events over 240 bars | 12 | 3,840 |
| Maximum compute units per bar | **15,668** | **220,535** |
| Mean compute units per bar | 14,917.029 | 182,335.075 |
| SBF binary bytes | 226,536 | 245,976 |

The resource fixture reaches the graph, state and order-site caps simultaneously, uses 64-byte order identifiers, and emits all 16 intents on each bar. Its successful execution exercises the allocation pressure that previously required removing an extra state-buffer copy. Heap allocation was not instrumented; success establishes that this binary and fixture ran without requesting a larger heap. It is not a proof that every accepted graph fits every transaction budget.

The VM tests verify:

- Feed signatures and immutable feed identity; unauthorized or unsigned submissions fail.
- Market, timeframe, expected sequence and exact timestamp checks.
- Rejection of an unclosed candle and malformed OHLCV.
- Owner-only pause/resume and rejection while paused.
- Replay rejection and continued successful processing after rejected transactions.
- Unchanged strategy-account data on each rejected transaction.
- Fixed account size across the complete replay.
- Intent-event discriminator, account/market/source/configuration bindings, bar index, timestamp, order identifier, side and constant quantity.

The setup uses fresh local keypairs and fake VM airdrops. Recorded initialization compute can vary with PDA derivation; the JSON preserves the measured value for the recorded run. These tests do not establish truthful exchange prices, real fills, custody safety or DEX integration.

## Reproduce

Install the repository's Node/pnpm dependencies, a Rust toolchain, and `cargo-build-sbf` **4.5.0**. The recorded execution environment used Node **24.22.1**, TypeScript **5.9.3**, `tsx` **4.20.6**, native Rust **1.99.1**, and SBF platform tools **v1.57** / Rust **1.95.0**. The existing repository targets Node **22.x** in CI. LiteSVM dependencies are isolated and locked under `tests/solana-vm`.

```bash
pnpm typecheck:pine-solana
pnpm test:pine-solana
pnpm pine:solana:sync-runtime --check

pnpm pine:solana:parity
cargo test --manifest-path build/pine-solana-parity/Cargo.toml --locked

pnpm pine:solana compile examples/pine-solana/ema-cross.pine --out build/ema-cross
cargo build-sbf --manifest-path build/ema-cross/programs/pine_strategy/Cargo.toml \
  --arch v3 --tools-version v1.57 -- --locked
npm ci --prefix tests/solana-vm
node --test tests/solana-vm/runtime.test.mjs

pnpm pine:solana compile tests/solana-vm/resource-boundary.pine --out build/resource-boundary
cargo build-sbf --manifest-path build/resource-boundary/programs/pine_strategy/Cargo.toml \
  --arch v3 --tools-version v1.57 -- --locked
PINE_SOLANA_PROJECT=build/resource-boundary node --test tests/solana-vm/runtime.test.mjs
```

Each VM replay writes `svm-report.json` under its generated project. Generated programs include `Cargo.lock`; source generation alone does not invoke Cargo, create a network account or deploy anything. The default development program ID supports local inspection and VM testing. Preparing a real deployment requires a proper program keypair/ID and an explicitly reviewed execution and market-data integration.

The new frontend, source synchronization and native differential tests are added to the existing GitHub Actions web job. The SBF/VM checks above are reproducible local commands, not an additional automated CI deployment job. The pinned Anchor dependency currently emits a deprecation warning for its account reallocation macro; both SBF builds completed successfully.

## Regression guards added during review

The tests cover complete lexical consumption and branches, final committed series history, independent function-call state, missing values versus zero, v5/v6 boolean/integer boundaries, rejection of conditional stateful evaluation and unsupported broker/data features, atomic numerical failure, Unicode order identifiers, source/IR escaping, and configuration-bound runtime snapshots.

The public compilation path also rejects excessive source, tokens, syntax depth, graph size, state, order count, input declarations and resolved input metadata. Input aliases cannot amplify a small source into an unbounded response. Constant evaluation memoizes graph nodes per call so a compact shared expression graph does not cause exponential traversal. A separate runtime period limit of 1,024 permits long EMA/RMA periods without confusing their small state requirement with the independent 900-cell cap.

See the [compatibility contract](PINE_SOLANA_COMPATIBILITY.md) for the exact accepted language and explicit rejections.
