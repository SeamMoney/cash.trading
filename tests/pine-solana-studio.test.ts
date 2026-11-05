import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compilePineToSolana } from "../lib/pine-solana/compiler";
import type { Bar } from "../lib/pine-solana/ir";
import { aggregateCandles, DEMO_CANDLES, packageProject, replayCompiled, STUDIO_EXAMPLES } from "../lib/pine-solana/studio-model";

function compiled(index = 0) {
  const result = compilePineToSolana(STUDIO_EXAMPLES[index].source);
  assert.ok(result.ok && result.ir, JSON.stringify(result.diagnostics));
  return { ...result, ir: result.ir! };
}

test("studio fixtures preserve the tested source and explicitly synthetic candle history", () => {
  const fileNames = ["ema-cross", "rsi", "macd"];
  STUDIO_EXAMPLES.forEach((example, index) => {
    assert.equal(example.source, readFileSync(`examples/pine-solana/${fileNames[index]}.pine`, "utf8"));
    const result = compiled(index);
    for (const selection of example.displaySeries) {
      assert.ok(Object.hasOwn(result.ir.outputs, selection.output));
      assert.equal(result.ir.nodes[result.ir.outputs[selection.output]].type, "number");
    }
  });
  assert.deepEqual(DEMO_CANDLES, JSON.parse(readFileSync("examples/pine-solana/candles.json", "utf8")));
  assert.equal(DEMO_CANDLES.length, 240);
  assert.ok(Object.isFrozen(DEMO_CANDLES) && DEMO_CANDLES.every(Object.isFrozen));
});

test("sample aggregation preserves exact OHLCV and the original origin without mutation", () => {
  const input = DEMO_CANDLES.map((bar) => ({ ...bar }));
  const before = structuredClone(input);
  for (const minutes of [1, 5, 15] as const) {
    const aggregated = aggregateCandles(input, minutes);
    assert.equal(aggregated.length, 240 / minutes);
    aggregated.forEach((bar, index) => {
      const window = input.slice(index * minutes, (index + 1) * minutes);
      assert.deepEqual(bar, {
        time: window[0].time,
        open: window[0].open,
        high: Math.max(...window.map((source) => source.high)),
        low: Math.min(...window.map((source) => source.low)),
        close: window.at(-1)!.close,
        volume: window.reduce((sum, source) => sum + source.volume, 0),
      });
    });
    assert.notEqual(aggregated[0], input[0]);
  }
  assert.deepEqual(input, before);
});

test("sample aggregation omits unclosed final windows and rejects fabricated gaps or malformed bars", () => {
  assert.equal(aggregateCandles(DEMO_CANDLES.slice(0, 7), 5).length, 1);
  assert.equal(aggregateCandles(DEMO_CANDLES.slice(0, 7), 15).length, 0);
  assert.deepEqual(aggregateCandles([], 1), []);
  assert.throws(() => aggregateCandles(DEMO_CANDLES, 2 as 1), /timeframe/);
  assert.throws(() => aggregateCandles([DEMO_CANDLES[0], DEMO_CANDLES[2]], 5), /consecutive/);
  for (const change of [{ close: NaN }, { volume: -1 }, { high: 0 }, { time: 1.5 }]) {
    assert.throws(() => aggregateCandles([{ ...DEMO_CANDLES[0], ...change }], 1), /Invalid sample/);
  }
  const excessive = DEMO_CANDLES.slice(0, 5).map((bar) => ({ ...bar, volume: Number.MAX_VALUE }));
  assert.throws(() => aggregateCandles(excessive, 5), /overflow/);
});

test("studio replay uses the real graph, retains 12 EMA intents, and selects explicit plot outputs", () => {
  const result = compiled();
  const replay = replayCompiled(result.ir, DEMO_CANDLES);
  assert.equal(replay.bars.length, 240);
  assert.equal(replay.evaluations.length, 240);
  assert.equal(replay.intents.length, 12);
  assert.equal(replay.latest, replay.evaluations.at(-1));
  assert.deepEqual(replay.series.map((series) => series.output), ["fast", "slow"]);
  assert.equal(replay.series[0].values[0], 100);
  assert.equal(replay.series[1].values[0], 100);
  for (const intent of replay.intents) {
    assert.equal(intent.time, DEMO_CANDLES[intent.barIndex].time);
    assert.equal(intent.quantity, 1);
    assert.equal(intent.kind, "entry");
    assert.ok(replay.evaluations[intent.barIndex].intents.includes(intent));
  }
  assert.deepEqual(replayCompiled(result.ir, DEMO_CANDLES), replay, "Each replay must begin with fresh state");
  assert.notEqual(replay.bars[0], DEMO_CANDLES[0]);
});

test("studio replay preserves warmup gaps and does not invent plots from unplotted calculations", () => {
  const rsi = replayCompiled(compiled(1).ir, DEMO_CANDLES);
  assert.deepEqual(rsi.series.map((series) => series.output), ["rsiValue"]);
  assert.deepEqual(rsi.series[0].values.slice(0, 14), Array(14).fill(null));
  assert.equal(typeof rsi.series[0].values[14], "number");
  const macd = replayCompiled(compiled(2).ir, DEMO_CANDLES);
  assert.deepEqual(macd.series.map((series) => series.output), ["histogram"]);
  const empty = replayCompiled(compiled().ir, []);
  assert.equal(empty.latest, null);
  assert.deepEqual(empty.intents, []);
  assert.ok(empty.series.every((series) => series.values.length === 0));
});

test("studio replay exposes invalid sample failures instead of returning a successful partial preview", () => {
  const bars: Bar[] = DEMO_CANDLES.slice(0, 3).map((bar) => ({ ...bar }));
  bars[2].volume = -1;
  assert.throws(() => replayCompiled(compiled().ir, bars), /Invalid OHLCV/);
});

/** Read standard ZIP directory/local records independently of the packaging writer. */
function readStoredZip(bytes: Uint8Array) {
  const archive = Buffer.from(bytes);
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50);
  assert.equal(archive.readUInt16LE(end + 4), 0);
  assert.equal(archive.readUInt16LE(end + 6), 0);
  const count = archive.readUInt16LE(end + 10);
  assert.equal(archive.readUInt16LE(end + 8), count);
  let cursor = archive.readUInt32LE(end + 16);
  const centralEnd = cursor + archive.readUInt32LE(end + 12);
  assert.equal(centralEnd, end);
  const files: Record<string, string> = Object.create(null);
  const checksums: Record<string, number> = Object.create(null);
  for (let i = 0; i < count; i++) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50);
    assert.equal(archive.readUInt16LE(cursor + 8), 0x0800);
    assert.equal(archive.readUInt16LE(cursor + 10), 0);
    const length = archive.readUInt32LE(cursor + 24);
    assert.equal(archive.readUInt32LE(cursor + 20), length);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const path = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const local = archive.readUInt32LE(cursor + 42);
    assert.equal(archive.readUInt32LE(local), 0x04034b50);
    assert.equal(archive.readUInt16LE(local + 6), 0x0800);
    assert.equal(archive.readUInt16LE(local + 8), 0);
    assert.equal(archive.readUInt32LE(local + 18), length);
    assert.equal(archive.readUInt32LE(local + 22), length);
    assert.equal(archive.readUInt32LE(local + 14), archive.readUInt32LE(cursor + 16));
    const localNameLength = archive.readUInt16LE(local + 26);
    assert.equal(localNameLength, nameLength);
    assert.equal(archive.subarray(local + 30, local + 30 + localNameLength).toString("utf8"), path);
    const dataStart = local + 30 + localNameLength + archive.readUInt16LE(local + 28);
    files[path] = archive.subarray(dataStart, dataStart + length).toString("utf8");
    checksums[path] = archive.readUInt32LE(cursor + 16);
    cursor += 46 + nameLength + archive.readUInt16LE(cursor + 30) + archive.readUInt16LE(cursor + 32);
  }
  assert.equal(cursor, centralEnd);
  return { files: { ...files }, checksums };
}

test("project ZIP preserves all generated files, Unicode, empty files, and canonical CRC32", () => {
  const result = compiled();
  assert.equal(Object.keys(result.files).length, 13);
  const files = { ...result.files, "unicode/戦略-💹.pine": "// стратегия · 💹\n", "empty.txt": "", "crc.txt": "123456789" };
  const archive = packageProject(files);
  const decoded = readStoredZip(archive);
  assert.deepEqual(decoded.files, files);
  assert.equal(decoded.checksums["crc.txt"], 0xcbf43926);
  assert.equal(decoded.checksums["empty.txt"], 0);
  assert.deepEqual(packageProject(Object.fromEntries(Object.entries(files).reverse())), archive);
  assert.ok(archive.buffer instanceof ArrayBuffer);
});

test("project ZIP rejects unsafe paths and oversized or empty exports", () => {
  for (const path of ["../secret", "/absolute", "a/../b", "a\\b", "a//b", "a/", "C:/file", "bad\0name"]) {
    assert.throws(() => packageProject({ [path]: "test" }), /Unsafe project path/);
  }
  assert.throws(() => packageProject({}), /between 1 and/);
  assert.throws(() => packageProject({ "oversized.txt": "x".repeat(16 * 1024 * 1024) }), /exceeds/);
});
