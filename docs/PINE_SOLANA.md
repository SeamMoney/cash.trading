# Pine Script to Solana

This repository now has an experimental, source-checked Pine-to-Rust compiler next to its existing Aptos/Move compiler. The new compiler generates a standalone Rust/Anchor project for a **confirmed-bar signal program**. It computes supported indicators and emits ordered trade intents from authenticated OHLCV candles. It does not implement TradingView's broker emulator or execute swaps/perpetual orders.

The compiler does **not** claim universal Pine compatibility. Supported source produces a typed graph and Rust/Anchor source artifacts; unsupported source returns diagnostics and no generated project. Unsupported syntax, external data dependencies, unsupported orders, and excessive state do not silently become another strategy. Compiler acceptance is not certification that a script matches every TradingView execution detail.

See [the compatibility specification](PINE_SOLANA_COMPATIBILITY.md) for the implemented feature set and the boundary of the claim.

Compiler **0.2.0** hardens language semantics, integer ranges, serialized graphs, and saved state. Its configuration commitment is incompatible with 0.1.0. Recompile the original Pine source and replay the intended history when migrating; old graphs and snapshots are rejected rather than silently interpreted under new rules. [The core change record](PINE_SOLANA_CORE_CHANGES.md) explains the fixes and their regression coverage.

## What was found in cash.trading

The starting repository commit was `350802de52894b7c14b7c84ad9694f8fe9993227`.

| Existing file | Role in the Aptos implementation |
| --- | --- |
| `lib/launchpad/pine-parser.ts` | Legacy Pine syntax parser and indicator/strategy metadata extraction |
| `lib/launchpad/pine-ir.ts` | Move-oriented intermediate representation |
| `lib/launchpad/transpiler-v3.ts` | Pine subset compatibility checks and Move compilation |
| `lib/launchpad/move-codegen.ts` | Move module and strategy-vault source emission |
| `lib/launchpad/pine-runtime.ts` | Chart-preview execution |
| `lib/strategy-equivalence.ts` | Existing evaluator comparisons |
| `lib/move-compile-service.ts` | Isolated Aptos compilation service |
| `scripts/transpiler-honesty-selftest.ts` | Tests that reject silent algorithm substitutions |

The Solana implementation preserves the architectural separation between parsing, lowering, evaluation, and code generation. It uses a new strict parser and new IR because the legacy parser and Move representation have different target and execution assumptions. In particular, unknown tokens must not disappear, zero is not a missing-value sentinel, conditional blocks must retain all statements, and computed-series history must remain distinct from market closes. The existing compiler and deployed contracts are not modified by this addition.

## Try it

The repository declares Node 22.x, pnpm 10.19.0, `tsx` and TypeScript. Run these commands from the repository root with those dependencies installed.

```bash
pnpm install

pnpm pine:solana analyze examples/pine-solana/ema-cross.pine

pnpm pine:solana compile examples/pine-solana/ema-cross.pine \
  --out build/ema-cross

pnpm pine:solana simulate examples/pine-solana/ema-cross.pine \
  --bars examples/pine-solana/candles.json \
  --out build/ema-cross/trace.json
```

The generated directory includes the canonical Pine source, `program.ir.json`, `manifest.json`, and a Cargo/Anchor project with embedded indicator logic, its runtime, and a Cargo lockfile. Source generation does not install toolchains, deploy a program, create a wallet, or spend funds. The new integration is available through the CLI and HTTP endpoint; this addition does not replace the existing launchpad's Move workflow.

To use an ordinary indicator, explicitly map its boolean series to orders:

```bash
pnpm pine:solana compile examples/pine-solana/indicator.pine \
  --options examples/pine-solana/indicator-options.json \
  --out build/indicator
```

```json
{
  "signals": {
    "long": "buy",
    "short": "sell",
    "quantity": 1
  }
}
```

There is no guessing from plot colors, names, detected indicator patterns, or alert titles. An indicator with no mapping returns `NO_TRADING_INTENT`.

Inputs are bound into the program and its configuration hash:

```json
{
  "inputs": { "fastLength": 5, "slowLength": 13 },
  "maxHistory": 128,
  "maxStateBytes": 7200
}
```

Omit `programId` for initial source inspection. When preparing a deployment, add `programId` with your actual base58-encoded 32-byte program public key and verify that Anchor's declared ID matches the build keypair. Input changes require a new compiled configuration, not a mutable on-chain override of the committed strategy. Unsupported input types and `options` lists are rejected; overrides do not bypass validation of the original default or input metadata.

## Compiler API

```ts
import { compilePineToSolana } from "./lib/pine-solana/compiler";
import { createPineRuntime } from "./lib/pine-solana/runtime";

const result = compilePineToSolana(pineSource, {
  inputs: { fastLength: 5, slowLength: 13 },
});

if (!result.ok) {
  console.error(result.diagnostics);
} else {
  // Source artifacts only; no deployment side effects.
  console.log(result.files["manifest.json"]);
  const runtime = createPineRuntime(result.ir!);
  const resultForOneBar = runtime.push({
    time: 1700000040000,
    open: 100, high: 103, low: 99, close: 102, volume: 500,
  });
  console.log(resultForOneBar.outputs, resultForOneBar.intents);
}
```

`POST /api/launchpad/compile-solana` accepts `{ "pineScript": "...", "options": { ... } }`. It returns generated files, the IR, diagnostics, and manifest. Unsupported source returns HTTP 422 with an empty file map. Malformed requests return 400. The HTTP body limit is 160,000 bytes and exceeding it returns 413; the separate Pine source limit is 128,000 UTF-8 bytes and exceeding that limit produces a compiler rejection. The route does no RPC, publishing, database writes, or wallet operations. Application code accepting untrusted option objects should call `validateCompileOptions()` before invoking the typed compiler API, as the route and CLI do.

## Runtime and contracts

The confirmed-bar program has a deliberately explicit trust boundary:

1. A configured **trusted candle publisher** signs bar submissions. This makes inputs authenticated; it does not make exchange prices or volumes independently proven.
2. The generated program evaluates the embedded graph against persisted series history. Missing values remain distinct from zero. State and calculations are bounded.
3. Trade intent records retain the source's instruction order and explicit side/quantity. They are not fills, positions, P&L, or custody instructions.
4. A future venue adapter must consume intents, apply execution policy, submit venue-specific instructions, and reconcile real fills. No generic adapter is silently generated.

The generated Anchor layer binds the strategy source/configuration, owner, feed authority, market, and timeframe. Initialization also fixes `origin_ms`. Bar `n` must have `time = origin_ms + n * timeframe_ms`, the submitted expected bar index must match account state, and the complete candle interval must have elapsed according to the Solana clock. Invalid authority, malformed candles, wrong market/timeframe, replay, skipped intervals, future/open bars and paused execution are rejected. Only the owner can pause or resume; feed rotation and reinitialization are not implemented.

The TypeScript simulator only requires strictly increasing timestamps. It does not authenticate a publisher or check a chain clock, fixed interval, or exchange session. A successful local replay therefore does not prove that the same timestamps meet the Anchor adapter's scheduling rules. Session gaps, irregular bars and omitted feed bars need a deliberately specified data adapter; do not silently fabricate replacement candles.

Pine uses TradingView's own data contexts and execution schedule. Solana programs require transactions. A keeper is therefore needed to submit each finalized candle. The trusted candle authority is the principal data dependency; strategy hashes alone do not prove candle accuracy.

Source/configuration hashes commit to the source and graph configuration, not the deployed SBF bytes or a program's upgrade authority. Consumers of intent logs must verify the emitting program and instance and accept events only from successful transactions at their required confirmation level. No program has been deployed to a network as part of this implementation.

## Numeric profile and history

The experimental native profile uses f64 arithmetic, explicit missing values, bounded per-series rings, and per-call rolling state. Computed Pine integers are restricted to the exact range from `-9007199254740991` through `9007199254740991`: known violations reject compilation and executed dynamic violations reject the entire bar. Floating-point calculations are not represented by arbitrary unsigned token amounts. Rust storage serializes numeric bits as integers so missing values can be persisted without relying on a serializer accepting NaN floats.

Loading exported IR verifies the current compiler version, operation types and dependency order, history/auxiliary storage, nonoverlapping state ranges, order structure, bounded metadata, and a recomputed SHA-256 configuration commitment. The simulator copies the validated graph so later caller mutation cannot change execution. Snapshot validation also checks ring counts/heads, sample occupancy, boolean history, and recursive-average seed state. These checks establish structural integrity; they do not authenticate a snapshot's claimed candle history or prove that an arbitrary graph was derived from its claimed source.

The compiler permits at most 256 graph nodes, 128 input declarations, 16 order sites, 64 UTF-8 bytes per order identifier, 7,200 bytes of numeric state, and 32 iterations per statically unrolled loop. Resolved input names, string/source values and presentation text share a 65,536-byte UTF-8 budget, including repeated use of aliases. Its default history/period bound is 128; the maximum configurable bound is 1,024, still subject to the state limit. Pine v6 loops that change a dependency of their end bound are rejected. These are compiler bounds, not measured Solana compute-unit estimates. The Pine declaration's `max_bars_back` presentation/configuration argument does not override the compiler's `maxHistory` option.

These limits cannot establish transaction feasibility on their own. Measure the actual generated SBF binary, stack, heap, account allocation and compute consumption. The manifest records compute units as unmeasured rather than fabricating a gas estimate.

## Conformance and verification

```bash
pnpm test:pine-solana
pnpm typecheck:pine-solana
pnpm pine:solana corpus examples/pine-solana --out build/coverage.json

pnpm pine:solana:parity build/pine-solana-parity
cargo test --locked --manifest-path build/pine-solana-parity/Cargo.toml

cargo check --locked --manifest-path build/ema-cross/Cargo.toml -p pine-strategy
```

The corpus command visits `.pine` files under the supplied directory, skipping hidden entries and `node_modules`, `target` and `build` directories. It bounds the scan to 10,000 files and 20 directory levels. The report records acceptance status and diagnostic codes for the scanned corpus; it does not claim that the examples represent TradingView's entire public library. The same options apply to every file in a corpus run, so an indicator without its explicit signal mapping is expected to be rejected.

Native differential tests compare graph values, every persisted state cell and its missing-value mask, and ordered intent kinds/identifiers/sides/quantities. Selected numerical boundary fixtures require exact f64 agreement. These checks describe TypeScript/Rust consistency for the supplied fixture set; they are not results from an independent Pine oracle. [The verification record](PINE_SOLANA_VERIFICATION.md) contains the current pass counts, coverage, binary hashes and SBF/VM measurements.

The native run used Rust 1.99.1. The generated EMA example also completed an **SBF v3 build** using `cargo-build-sbf` 4.5.0 with platform tools v1.57, whose compiler reports Rust 1.95. Reproduce the SBF build and then run the local VM harness separately:

```bash
cargo build-sbf \
  --manifest-path build/ema-cross/programs/pine_strategy/Cargo.toml \
  --arch v3 \
  --tools-version v1.57

npm ci --prefix tests/solana-vm
pnpm pine:solana:sbf-reference build/ema-cross
node --test tests/solana-vm/runtime.test.mjs
```

The VM harness loads `build/ema-cross/target/deploy/pine_strategy.so` into local LiteSVM. It compares persisted state and the complete ordered event stream against source/configuration/dataset-bound expectations generated by `pine:solana:sbf-reference`. This remains backend parity, not independent Pine conformance. Its isolated dependencies pin LiteSVM 1.6.2, `@solana/web3.js` 1.98.4 and `@solana/kit` 8.6.0. A successful replay writes the binary hash, fixture-specific compute measurements and account size to `build/ema-cross/svm-report.json`. These local commands do not deploy to a network. An SBF v3 artifact requires a compatible target runtime; successful compilation alone establishes neither transaction success nor compatibility with every cluster configuration.

There are different levels of evidence:

| Evidence | What it establishes |
| --- | --- |
| Parser/adversarial tests | Supported syntax is preserved; rejected syntax does not produce artifacts |
| Hand-calculated series fixtures | Specific documented numeric and state transitions |
| TypeScript/Rust agreement | Two implementations of this IR agree on the supplied trace |
| Native Rust/Anchor build | The emitted host code builds; this alone is not an SBF deployment test |
| SBF build | The specified graph and locked dependencies compile for the selected SBF architecture |
| Local SBF transaction simulation | Authorization, state transitions and resource behavior actually exercised for that binary and fixture |
| Independent TradingView exports | Specific series match Pine on the exact source, configuration and dataset |

The new runtime is **not** used as an independent Pine oracle. An identical mistake in two evaluators will pass internal agreement tests. TradingView parity remains uncertified until independently exported fixtures are supplied and checked.

### Verify an external reference

`pnpm pine:solana verify strategy.pine --reference reference.json` compares named output series on an exact source/config-bound dataset. Pass the same `--options options.json` used for the reference compilation when inputs or indicator signal mappings were supplied. A reference has this form:

```json
{
  "schemaVersion": 1,
  "provenance": {
    "origin": "tradingview-export",
    "sourceHash": "SHA256_FROM_MANIFEST",
    "configHash": "SHA256_FROM_MANIFEST",
    "symbol": "EXCHANGE:SOLUSD",
    "timeframe": "1",
    "capturedAt": "2026-11-05T00:00:00Z",
    "notes": "Same session, chart type, inputs and history window."
  },
  "bars": [
    { "time": 1700000040000, "open": 100, "high": 103, "low": 99, "close": 102, "volume": 500 }
  ],
  "outputs": [ { "fast": 102, "slow": 102 } ]
}
```

Replace the example with actual independently obtained data; it is a schema illustration, not a captured TradingView export. The verifier validates the provenance fields but does not independently authenticate their claimed origin. Preserve enough earlier history to reproduce initialization. Default numeric comparison tolerances are 1e-8 absolute plus 1e-8 relative; booleans and missing-value masks must match exactly. The comparison avoids overflow at extreme finite values. Reports include source/configuration identities, the full mismatch count, up to 100 examples, and per-series checked/missing/mismatch counts. This command compares named outputs, not broker fills or every emitted intent. A passing result applies only to the named series and supplied dataset, not all Pine programs.

### Import a TradingView CSV reference

TradingView's chart export includes time, OHLC and plotted series. Plot titles become column headers, and `plotshape()` can export boolean conditions as 0/1. Use an explicit mapping so duplicate titles, guessed timestamp units, or absent volume cannot silently change the dataset. [TradingView export documentation](https://www.tradingview.com/pine-script-docs/faq/indicators/#is-it-possible-to-export-indicator-data-to-a-file)

Create a mapping like this, replacing the hash placeholders with the manifest identities for the exact source and inputs used when capturing the export. The timestamp below is illustrative; record the real capture time.

```json
{
  "schemaVersion": 1,
  "provenance": {
    "origin": "tradingview-export",
    "sourceHash": "COPY_SOURCE_HASH_FROM_CAPTURE_CONFIGURATION",
    "configHash": "COPY_CONFIG_HASH_FROM_CAPTURE_CONFIGURATION",
    "symbol": "EXCHANGE:SOLUSD",
    "timeframe": "1",
    "capturedAt": "2026-11-06T00:00:00Z"
  },
  "timeFormat": "unix-seconds",
  "columns": {
    "time": "time", "open": "open", "high": "high",
    "low": "low", "close": "close", "volume": "Volume"
  },
  "outputs": { "fast": "Fast EMA", "slow": "Slow EMA" }
}
```

```bash
pnpm pine:solana import-reference examples/pine-solana/ema-cross.pine \
  --csv chart.csv --mapping mapping.json --out build/reference.json

pnpm pine:solana verify examples/pine-solana/ema-cross.pine \
  --reference build/reference.json --out build/reference-report.json
```

Supply the same `--options` file to both commands when using input overrides. `outputs` maps compiled variable names to exact CSV column headers; it does not infer names from plots. Map an exported volume series explicitly. If the CSV lacks volume, capture it from the same dataset; the importer does not fill it with zero. Supported time formats are `unix-seconds`, `unix-milliseconds` and `iso8601`. ISO values require a timezone; numeric timestamps must convert to exact integer milliseconds. The importer follows the declared units and does not guess based on magnitude.

Blank, `na`, and `NaN` **output** cells become missing values. Missing candle fields, invalid OHLCV, duplicate timestamps, malformed quoting, duplicate headers, and changing row widths reject the import. No row is dropped or replaced. Input is bounded to 16 MiB, 512 columns, 100,000 data rows and two million cells/mapped values; imported and directly supplied references also have a conservative 128 MiB serialization budget that includes repeated output names. Expected outputs come only from the supplied file; import does not run the strategy to manufacture them.

Retain the dataset start and initialization history. A visible-window export whose indicators were seeded on earlier, omitted bars can legitimately mismatch. The verifier does not hide that mismatch by discarding warmup, shifting timestamps, or retuning inputs. Synthetic CSV tests in this repository are labeled hand-calculated; they are not TradingView captures.

CLI exit codes are `0` for success, `1` for malformed invocation/input or another thrown error, `2` for compilation rejection, and `3` for a completed reference comparison with mismatches. A corpus report may contain rejected scripts while the report command itself succeeds.

## Completing broader Pine coverage

The required next implementations are concrete: a venue-specific order/fill state machine; authenticated multi-symbol/timeframe data and `request.*` alignment; tick-level rollback and `varip`; bounded collection/object semantics; imported library resolution; and a broader independent Pine conformance corpus. Each feature needs syntax/type support, execution semantics, emitted runtime behavior, resource accounting and external reference traces. A regex replacement or an LLM-generated translation cannot replace those gates.

### Primary references

- [TradingView execution model](https://www.tradingview.com/pine-script-docs/language/execution-model/)
- [TradingView type system](https://www.tradingview.com/pine-script-docs/language/type-system/)
- [TradingView strategies and broker emulator](https://www.tradingview.com/pine-script-docs/concepts/strategies/)
- [TradingView other timeframes and datasets](https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/)
- [Pine v6 migration changes](https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/)
- [Solana program limitations](https://solana.com/docs/programs/limitations)
- [Anchor account constraints](https://www.anchor-lang.com/docs/references/account-constraints)
