import assert from "node:assert/strict";
import test from "node:test";
import { compilePineToSolana } from "../lib/pine-solana/compiler";
import type { ProgramIR } from "../lib/pine-solana/ir";
import { validateReferenceBudget } from "../lib/pine-solana/reference-budget";
import { importReferenceCsv } from "../lib/pine-solana/reference-csv";
import type { ReferenceCsvMapping } from "../lib/pine-solana/reference-csv";
import { parseReferenceTimestamp } from "../lib/pine-solana/reference-time";
import { verifyReferenceTrace } from "../lib/pine-solana/validation";

// Hand-calculated fixtures, not captured TradingView exports. Expected values
// below come from arithmetic/history on these four bars, never our evaluator.
const source = `//@version=6
strategy("CSV reference test")
half = close / 2
previous = close[1]
up = close > open
stamp = time
strategy.entry("L", strategy.long)`;
const compiled = compilePineToSolana(source);
assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
const ir = compiled.ir!;
const headers = ["time", "open", "high", "low", "close", "Volume", 'Half, "price"', "Previous", "Up", "Timestamp"];
const data = [
  ["1700000000", "0", "0", "0", "0", "0", "0", "", "0", "1700000000000"],
  ["1700000060", "1", "2", "1", "2", "10", "1", "0", "1", "1700000060000"],
  ["1700000120", "4", "5", "4", "4", "20", "2", "2", "false", "1700000120000"],
  ["1700000180", "1", "2", "1", "2", "0", "1", "4", "true", "1700000180000"],
];
const quote = (value: string) => /[,"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
const csv = (rows = data, names = headers) => [names, ...rows].map(row => row.map(quote).join(",")).join("\n");
const provenance = (program = ir): ReferenceCsvMapping["provenance"] => ({
  origin: "hand-calculated", sourceHash: program.sourceHash, configHash: program.configHash,
  symbol: "TEST:CSV", timeframe: "1", capturedAt: "2026-11-06T00:00:00Z",
  notes: "Synthetic, hand-calculated CSV fixture; not a TradingView capture.",
});
const mapping = (): ReferenceCsvMapping => ({
  schemaVersion: 1, provenance: provenance(), timeFormat: "unix-seconds",
  columns: { time: "time", open: "open", high: "high", low: "low", close: "close", volume: "Volume" },
  outputs: { half: 'Half, "price"', previous: "Previous", up: "Up", stamp: "Timestamp" },
});

test("imports quoted plot headers, BOM and CRLF without replacing supplied expectations", () => {
  const reference = importReferenceCsv(ir, "\uFEFF" + csv().replace(/\n/g, "\r\n") + "\r\n", mapping());
  assert.equal(reference.provenance.origin, "hand-calculated");
  assert.deepEqual(reference.bars.map(bar => bar.time), [1700000000000, 1700000060000, 1700000120000, 1700000180000]);
  assert.deepEqual(reference.outputs.map(row => [row.half, row.previous, row.up]), [[0, null, false], [1, 0, true], [2, 2, false], [1, 4, true]]);
  assert.equal(verifyReferenceTrace(ir, reference).checkedValues, 16);
  assert.equal(verifyReferenceTrace(ir, reference).ok, true);

  const changed = data.map(row => [...row]); changed[2][6] = "123";
  const mismatch = verifyReferenceTrace(ir, importReferenceCsv(ir, csv(changed), mapping()));
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.mismatchCount, 1);
  assert.deepEqual(mismatch.mismatches.map(({ bar, name, expected, actual }) => ({ bar, name, expected, actual })), [{ bar: 2, name: "half", expected: 123, actual: 2 }]);
});

test("quoted multiline headers/cells and explicit column order preserve record boundaries", () => {
  const names = [...headers]; names[6] = 'Half\n"quoted", price';
  const map = mapping(); map.outputs.half = names[6];
  const allQuoted = [names, ...data].map(row => row.map(value => `"${value.replace(/"/g, '""')}"`).join(",")).join("\r\n");
  assert.equal(verifyReferenceTrace(ir, importReferenceCsv(ir, allQuoted, map)).ok, true);
  assert.equal(verifyReferenceTrace(ir, importReferenceCsv(ir, csv(data.map(row => [...row].reverse()), [...headers].reverse()), mapping())).ok, true);
});

test("a final empty output cell is retained with or without a final line ending", () => {
  const row = [...data[0]]; row[row.length - 1] = "";
  const map = mapping(); map.outputs = { previous: "Timestamp" };
  for (const ending of ["", "\n", "\r\n"]) {
    const reference = importReferenceCsv(ir, csv([row]) + ending, map);
    assert.equal(reference.outputs[0].previous, null);
    assert.equal(verifyReferenceTrace(ir, reference).ok, true);
  }
});

test("CSV output keys cannot alter object prototypes", () => {
  const result = compilePineToSolana('//@version=6\nstrategy("Prototype output")\n__proto__ = close\nstrategy.entry("L", strategy.long)');
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const program = result.ir!;
  const map = { ...mapping(), provenance: provenance(program), outputs: JSON.parse('{"__proto__":"close"}') };
  const reference = importReferenceCsv(program, csv([data[0]]), map);
  assert.equal(Object.getPrototypeOf(reference.outputs[0]), null);
  assert.equal(reference.outputs[0].__proto__, 0);
  assert.equal(verifyReferenceTrace(program, reference).ok, true);
});

test("missing output masks preserve zero and false while missing candle fields fail", () => {
  for (const missing of ["", "na", "NaN", "  "]) {
    const row = [...data[0]]; row[7] = missing;
    const reference = importReferenceCsv(ir, csv([row]), mapping());
    assert.equal(reference.outputs[0].previous, null);
    assert.equal(reference.outputs[0].half, 0);
    assert.equal(reference.outputs[0].up, false);
    for (let index = 0; index <= 5; index++) {
      const bad = [...data[0]]; bad[index] = missing;
      assert.throws(() => importReferenceCsv(ir, csv([bad]), mapping()), /time|finite decimal/);
    }
  }
  const row = [...data[1]]; row[6] = "+1.0e0"; row[5] = "1.e1";
  assert.equal(importReferenceCsv(ir, csv([row]), mapping()).outputs[0].half, 1);
});

test("numeric and Boolean columns reject coercion, nonfinite values and trailing junk", () => {
  for (const value of ["1junk", "0x10", "Infinity", "-Infinity", "1e309", "1,000", "true", "--1", "1e"]) {
    for (const index of [1, 6]) {
      const row = [...data[0]]; row[index] = value;
      assert.throws(() => importReferenceCsv(ir, csv([row]), mapping()), /finite decimal/);
    }
  }
  for (const value of ["2", "-1", "1.0", "TRUE", "False", "yes", "null"]) {
    const row = [...data[0]]; row[8] = value;
    assert.throws(() => importReferenceCsv(ir, csv([row]), mapping()), /requires 0, 1, false, true/);
  }
});

test("time units are explicit and never guessed from the magnitude", () => {
  const seconds = importReferenceCsv(ir, csv(), mapping());
  const map = mapping(); map.timeFormat = "unix-milliseconds";
  const milliseconds = importReferenceCsv(ir, csv(), map);
  assert.equal(seconds.bars[0].time, 1000 * milliseconds.bars[0].time);
  const mismatch = verifyReferenceTrace(ir, milliseconds);
  assert.equal(mismatch.ok, false, "the supplied millisecond time plot reveals an incorrectly declared CSV time unit");
  assert.equal(mismatch.series.stamp.mismatches, 4);
  const correct = data.map(row => [row[9], ...row.slice(1)]);
  assert.equal(verifyReferenceTrace(ir, importReferenceCsv(ir, csv(correct), map)).ok, true);
});

test("fractional Unix seconds convert to exact milliseconds without rounding", () => {
  for (const [value, expected] of [["0.001", 1], ["1.234", 1234], ["1.2340e1", 12340], ["9e-3", 9], ["9007199254740.991", Number.MAX_SAFE_INTEGER]] as const) {
    const row = [...data[0]]; row[0] = value;
    assert.equal(importReferenceCsv(ir, csv([row]), mapping()).bars[0].time, expected);
  }
  for (const value of ["0.0001", "9007199254740.992", "-1", "1e9999", "1e-9999", "1ms", "0x10", "NaN"]) {
    const row = [...data[0]]; row[0] = value;
    assert.throws(() => importReferenceCsv(ir, csv([row]), mapping()), /time/);
  }
  const map = mapping(); map.timeFormat = "unix-milliseconds";
  for (const value of ["0.1", "9007199254740992"]) {
    const row = [...data[0]]; row[0] = value;
    assert.throws(() => importReferenceCsv(ir, csv([row]), map), /integer milliseconds/);
  }
});

test("ISO timestamps require a timezone and a real calendar date", () => {
  const map = mapping(); map.timeFormat = "iso8601";
  const row = [...data[0]]; row[0] = "2024-02-29T12:34:56.123+02:30";
  assert.equal(importReferenceCsv(ir, csv([row]), map).bars[0].time, Date.UTC(2024, 1, 29, 10, 4, 56, 123));
  assert.equal(parseReferenceTimestamp("1969-12-31T23:00:00-01:00"), 0);
  assert.equal(parseReferenceTimestamp("2000-02-29T00:00:00Z"), Date.UTC(2000, 1, 29));
  for (const value of ["2024-02-29T00:00:00", "2023-02-29T00:00:00Z", "2100-02-29T00:00:00Z", "2024-04-31T00:00:00Z", "2024-00-01T00:00:00Z", "2024-13-01T00:00:00Z", "2024-01-00T00:00:00Z", "2024-01-01T24:00:00Z", "2024-01-01T00:60:00Z", "2024-01-01T00:00:60Z", "2024-01-01T00:00:00+24:00", "2024-01-01T00:00:00+01:60", "2024-01-01T00:00:00.0001Z", "1969-12-31T23:59:59Z"]) {
    row[0] = value;
    assert.throws(() => importReferenceCsv(ir, csv([row]), map), /time/);
  }
});

test("missing or ambiguous schema is rejected instead of inferring columns or provenance", () => {
  const changes: Array<(map: Record<string, any>) => void> = [
    map => { map.unknown = true; }, map => { delete map.timeFormat; }, map => { map.timeFormat = "auto"; },
    map => { delete map.provenance; }, map => { map.provenance.sourceHash = "0".repeat(64); }, map => { map.provenance.configHash = "0".repeat(64); },
    map => { delete map.columns.volume; }, map => { map.columns.extra = "Volume"; }, map => { map.columns.volume = null; },
    map => { map.columns.high = "close"; }, map => { map.columns.volume = "volume"; },
    map => { map.outputs = {}; }, map => { map.outputs = []; }, map => { map.outputs.half = 3; },
    map => { map.outputs.half = "Missing plot"; }, map => { map.outputs.missingOutput = "Up"; },
  ];
  for (const change of changes) {
    const map = structuredClone(mapping()); change(map);
    assert.throws(() => importReferenceCsv(ir, csv(), map));
  }
  assert.throws(() => importReferenceCsv(ir, csv(data, [...headers.slice(0, -1), "close"]), mapping()), /duplicate/);
  assert.throws(() => importReferenceCsv(ir, csv(data, [...headers.slice(0, -1), ""]), mapping()), /nonempty/);
  assert.throws(() => importReferenceCsv(ir, "", mapping()), /headers/);
  assert.throws(() => importReferenceCsv(ir, csv([]), mapping()), /at least one data row/);
});

test("malformed quoting, blank records and width changes never drop data", () => {
  const header = csv([]), line = data[0].join(",");
  for (const malformed of [
    `${header}\n"${line}`, `${header}\n${line}"`, `${header}\n"1700000000"x,${data[0].slice(1).join(",")}`,
    `${header}\n"1700000000" ,${data[0].slice(1).join(",")}`, `${header}\r${line}`,
    `${header}\n${line}\n\n${data[1].join(",")}`, `${header}\n${line}\n\n`,
    `${header}\n${line},extra`, `${header}\n${data[0].slice(0, -1).join(",")}`,
  ]) assert.throws(() => importReferenceCsv(ir, malformed, mapping()), /CSV/);
});

test("candle envelopes and ordered timestamps are validated without executing the strategy", () => {
  for (const [index, value] of [[1, "1"], [2, "-1"], [3, "1"], [5, "-1"]] as const) {
    const row = [...data[0]]; row[index] = value;
    assert.throws(() => importReferenceCsv(ir, csv([row]), mapping()), /invalid OHLCV/);
  }
  assert.throws(() => importReferenceCsv(ir, csv([data[0], data[0]]), mapping()), /strictly increasing/);
  assert.throws(() => importReferenceCsv(ir, csv([...data].reverse()), mapping()), /strictly increasing/);

  const failsAtRuntime = compilePineToSolana('//@version=6\nstrategy("Import only")\nvalue = close\nstrategy.entry("L", strategy.long, qty=close)');
  assert.equal(failsAtRuntime.ok, true);
  const other = failsAtRuntime.ir!;
  const map: ReferenceCsvMapping = { ...mapping(), provenance: provenance(other), outputs: { value: "close" } };
  const reference = importReferenceCsv(other, csv([data[0]]), map);
  assert.equal(reference.outputs[0].value, 0);
  assert.throws(() => verifyReferenceTrace(other, reference), /quantity/, "Import must succeed even when replay would trigger an invalid order");
});

test("CSV input, column, row and cell limits are enforced", () => {
  assert.throws(() => importReferenceCsv(ir, "é".repeat(8 * 1024 * 1024 + 1), mapping()), /UTF-8 bytes/);
  assert.throws(() => importReferenceCsv(ir, csv([], Array.from({ length: 513 }, (_, i) => `column${i}`)), mapping()), /512 columns/);
  const map = mapping(); map.outputs = { half: 'Half, "price"' };
  const names = [...headers, ...Array.from({ length: 502 }, (_, i) => `unused${i}`)];
  const row = [...data[0], ...Array(502).fill("0")];
  const body = Array.from({ length: 3906 }, (_, i) => [String(i), ...row.slice(1)].join(",")).join("\n");
  assert.throws(() => importReferenceCsv(ir, csv([], names) + "\n" + body, map), /2000000 cells/);
  const manyRows = Array.from({ length: 100001 }, (_, i) => [String(i), ...data[0].slice(1)].join(",")).join("\n");
  assert.throws(() => importReferenceCsv(ir, csv([]) + "\n" + manyRows, map), /100000 data rows/);
});

test("many mappings to one CSV column cannot amplify reference memory without a bound", () => {
  const result = compilePineToSolana('//@version=6\nstrategy("Mapping budget")\nbase = close\n' + Array.from({ length: 254 }, (_, i) => `alias${i} = base`).join("\n") + '\nstrategy.entry("L", strategy.long)');
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const program: ProgramIR = result.ir!;
  const map: ReferenceCsvMapping = { ...mapping(), provenance: provenance(program), outputs: Object.fromEntries(Object.keys(program.outputs).map(name => [name, "close"])) };
  const body = Array.from({ length: 8000 }, (_, i) => [String(i), ...data[0].slice(1)].join(",")).join("\n");
  assert.throws(() => importReferenceCsv(program, csv([]) + "\n" + body, map), /Mapped reference exceeds 2000000 values/);
});

test("a small CSV cannot expand a 100 KB output name into hundreds of megabytes of JSON", () => {
  const name = "x".repeat(100_000);
  const result = compilePineToSolana(`//@version=6\nstrategy("Long output name")\n${name} = close\nstrategy.entry("L", strategy.long)`);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const program = result.ir!;
  const map: ReferenceCsvMapping = { ...mapping(), provenance: provenance(program), outputs: { [name]: "close" } };
  const body = Array.from({ length: 2000 }, (_, i) => [String(i), ...data[0].slice(1)].join(",")).join("\n");
  assert.ok(Buffer.byteLength(body) < 100_000, "Small source CSV must not be enough to create a huge reference export");
  assert.throws(() => importReferenceCsv(program, csv([]) + "\n" + body, map), /128 MiB serialized-reference budget/);
});

test("CSV import validates the committed source graph without evaluating it", () => {
  const invalid = structuredClone(ir);
  invalid.nodes[0].a = invalid.nodes.length;
  assert.throws(() => importReferenceCsv(invalid, csv(), mapping()), /Invalid Pine IR/);
  const mismatched = structuredClone(ir);
  mismatched.configHash = "0".repeat(64);
  assert.throws(() => importReferenceCsv(mismatched, csv(), { ...mapping(), provenance: provenance(mismatched) }), /commitment|config.*hash/i);
});

test("reference serialization budgeting counts UTF-8 and JSON-escaped keys", () => {
  assert.doesNotThrow(() => validateReferenceBudget(["x".repeat(100_000)], 1000));
  assert.throws(() => validateReferenceBudget(["é".repeat(100_000)], 1000), /128 MiB/);
  assert.doesNotThrow(() => validateReferenceBudget(["x".repeat(100_000)], 250));
  assert.throws(() => validateReferenceBudget(["\u0000".repeat(100_000)], 250), /128 MiB/);
});
