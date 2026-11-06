import type { Bar, ProgramIR } from "./ir";
import { referenceRowCapacity, validateReferenceBudget } from "./reference-budget";
import { parseReferenceTimestamp } from "./reference-time";
import { validateProgramIR } from "./validate-ir";
import { validateReferenceProvenance } from "./validation";
import type { ReferenceTrace } from "./validation";

export interface ReferenceCsvMapping {
  schemaVersion: 1;
  provenance: ReferenceTrace["provenance"];
  timeFormat: "unix-seconds" | "unix-milliseconds" | "iso8601";
  columns: { time: string; open: string; high: string; low: string; close: string; volume: string };
  /** Compiled output name -> exact CSV column header. */
  outputs: Record<string, string>;
}

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ROWS = 100_000;
const MAX_COLUMNS = 512;
const MAX_CELLS = 2_000_000;
const BAR_FIELDS = ["time", "open", "high", "low", "close", "volume"] as const;
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function exactObject(value: unknown, names: readonly string[], label: string): Record<string, unknown> {
  if (!record(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!names.includes(key)) throw new Error(`Unknown ${label} field ${key}`);
  for (const key of names) if (!own(value, key)) throw new Error(`${label} requires ${key}`);
  return value;
}

/** RFC 4180 comma fields; LF and CRLF records, quoted newlines, and doubled quotes. */
function* rows(csv: string): Generator<string[]> {
  let offset = csv.startsWith("\uFEFF") ? 1 : 0, cells = 0;
  let row: string[] = [];
  while (offset < csv.length || row.length) {
    let cell: string;
    if (csv[offset] === '"') {
      const start = ++offset;
      while (offset < csv.length) {
        if (csv[offset] !== '"') { offset++; continue; }
        if (csv[offset + 1] === '"') { offset += 2; continue; }
        break;
      }
      if (offset === csv.length) throw new Error("CSV contains an unterminated quoted field");
      cell = csv.slice(start, offset++).replace(/""/g, '"');
      if (offset < csv.length && ![",", "\r", "\n"].includes(csv[offset])) throw new Error("CSV quoted field has characters after its closing quote");
    } else {
      const start = offset;
      while (offset < csv.length && ![",", "\r", "\n"].includes(csv[offset])) {
        if (csv[offset] === '"') throw new Error("CSV quote must start a field or escape another quote inside a quoted field");
        offset++;
      }
      cell = csv.slice(start, offset);
    }
    row.push(cell);
    if (row.length > MAX_COLUMNS) throw new Error(`CSV exceeds ${MAX_COLUMNS} columns`);
    if (++cells > MAX_CELLS) throw new Error(`CSV exceeds ${MAX_CELLS} cells including its header`);
    if (offset === csv.length) { yield row; return; }
    const separator = csv[offset++];
    if (separator === ",") continue;
    if (separator === "\r" && csv[offset++] !== "\n") throw new Error("CSV record endings must use LF or CRLF");
    yield row;
    row = [];
  }
}

function finiteNumber(value: string, label: string): number {
  const text = value.trim();
  if (!DECIMAL.test(text)) throw new Error(`${label} must contain a finite decimal number`);
  const number = Number(text);
  if (!Number.isFinite(number)) throw new Error(`${label} must contain a finite decimal number`);
  return number;
}

/** Convert decimal seconds exactly, including fractional seconds, before using JS numbers. */
function unixMilliseconds(value: string, seconds: boolean): number {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) throw new Error("Unix timestamp must be a decimal number in the declared units");
  const fraction = match[3] ?? match[4] ?? "";
  let digits = ((match[2] ?? "") + fraction).replace(/^0+/, "");
  if (!digits) return 0;
  if (match[1] === "-") throw new Error("Unix timestamp must be nonnegative");
  const shift = Number(match[5] ?? 0) - fraction.length + (seconds ? 3 : 0);
  if (shift < 0) {
    const length = digits.length + shift;
    if (length <= 0 || /[1-9]/.test(digits.slice(length))) throw new Error("Unix timestamp must resolve to integer milliseconds without rounding");
    digits = digits.slice(0, length);
  } else {
    if (digits.length + shift > 16) throw new Error("Unix timestamp exceeds safe integer milliseconds");
    digits += "0".repeat(shift);
  }
  const time = Number(digits);
  if (!Number.isSafeInteger(time)) throw new Error("Unix timestamp exceeds safe integer milliseconds");
  return time;
}

/**
 * Import supplied chart/plot values; this never runs the strategy to generate
 * expectations or guesses an export's source, inputs, time units, or volume.
 * Provenance is caller supplied and checked for consistency, not authenticated.
 */
export function importReferenceCsv(ir: ProgramIR, csv: string, mapping: unknown): ReferenceTrace {
  validateProgramIR(ir);
  if (typeof csv !== "string" || csv.length > MAX_BYTES || Buffer.byteLength(csv, "utf8") > MAX_BYTES) throw new Error(`CSV input must be a string of at most ${MAX_BYTES} UTF-8 bytes`);
  const config = exactObject(mapping, ["schemaVersion", "provenance", "timeFormat", "columns", "outputs"], "CSV mapping");
  if (config.schemaVersion !== 1) throw new Error("CSV mapping schemaVersion must be 1");
  if (!["unix-seconds", "unix-milliseconds", "iso8601"].includes(config.timeFormat as string)) throw new Error("CSV mapping must declare timeFormat as unix-seconds, unix-milliseconds, or iso8601");
  const provenance = validateReferenceProvenance(ir, config.provenance);
  const columns = exactObject(config.columns, BAR_FIELDS, "CSV columns");
  if (!record(config.outputs) || !Object.keys(config.outputs).length || Object.keys(config.outputs).length > MAX_COLUMNS) throw new Error(`CSV output mapping must name 1 to ${MAX_COLUMNS} compiled outputs`);
  const outputEntries = Object.entries(config.outputs);
  for (const [name, column] of [...Object.entries(columns), ...outputEntries]) {
    if (typeof column !== "string" || !column.trim()) throw new Error(`CSV mapping for ${name} requires a nonempty column name`);
  }
  if (new Set(Object.values(columns)).size !== BAR_FIELDS.length) throw new Error("CSV time and OHLCV fields require six distinct columns");
  for (const [name] of outputEntries) if (!own(ir.outputs, name)) throw new Error(`CSV mapping names unknown compiled output ${name}`);

  const iterator = rows(csv);
  const first = iterator.next();
  if (first.done || first.value.some(header => !header.trim())) throw new Error("CSV requires nonempty column headers");
  const headers = first.value;
  if (new Set(headers).size !== headers.length) throw new Error("CSV contains duplicate column headers; assign unique plot titles before exporting");
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const indexOf = (header: unknown): number => {
    const index = headerIndex.get(header as string);
    if (index === undefined) throw new Error(`CSV is missing explicitly mapped column ${String(header)}`);
    return index;
  };
  const indices = Object.fromEntries(BAR_FIELDS.map(field => [field, indexOf(columns[field])])) as Record<typeof BAR_FIELDS[number], number>;
  const expectedColumns = outputEntries.map(([name, header]) => {
    const type = ir.nodes[ir.outputs[name]]?.type;
    if (type !== "number" && type !== "bool") throw new Error(`Compiled output ${name} has no supported value type`);
    return { name, index: indexOf(header), type };
  });
  const outputNames = expectedColumns.map(column => column.name);
  const referenceCapacity = referenceRowCapacity(outputNames);
  const bars: Bar[] = [], outputs: ReferenceTrace["outputs"] = [];
  for (const row of iterator) {
    const number = bars.length + 2;
    if (row.length === 1 && !row[0].trim()) throw new Error(`CSV row ${number} is blank; rows are never dropped`);
    if (row.length !== headers.length) throw new Error(`CSV row ${number} has ${row.length} cells; expected ${headers.length}`);
    if (bars.length >= MAX_ROWS) throw new Error(`CSV exceeds ${MAX_ROWS} data rows`);
    if ((bars.length + 1) * (BAR_FIELDS.length + expectedColumns.length) > MAX_CELLS) throw new Error(`Mapped reference exceeds ${MAX_CELLS} values`);
    if (bars.length >= referenceCapacity) validateReferenceBudget(outputNames, bars.length + 1);
    let time: number;
    try {
      const value = row[indices.time].trim();
      time = config.timeFormat === "iso8601" ? parseReferenceTimestamp(value) : unixMilliseconds(value, config.timeFormat === "unix-seconds");
    } catch (error) {
      throw new Error(`CSV row ${number} time: ${error instanceof Error ? error.message : "invalid timestamp"}`);
    }
    if (bars.length && time <= bars[bars.length - 1].time) throw new Error(`CSV row ${number} time must be strictly increasing`);
    const bar = { time } as Bar;
    for (const field of BAR_FIELDS.slice(1) as Array<Exclude<typeof BAR_FIELDS[number], "time">>) bar[field] = finiteNumber(row[indices[field]], `CSV row ${number} ${field}`);
    if (bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) || bar.high < bar.low || bar.volume < 0) throw new Error(`CSV row ${number} has invalid OHLCV values`);
    const expected: Record<string, number | boolean | null> = Object.create(null);
    for (const { name, index, type } of expectedColumns) {
      const value = row[index].trim();
      if (value === "" || value === "na" || value === "NaN") expected[name] = null;
      else if (type === "bool") {
        if (!["0", "1", "false", "true"].includes(value)) throw new Error(`CSV row ${number} output ${name} requires 0, 1, false, true, or a missing value`);
        expected[name] = value === "1" || value === "true";
      } else expected[name] = finiteNumber(value, `CSV row ${number} output ${name}`);
    }
    bars.push(bar); outputs.push(expected);
  }
  if (!bars.length) throw new Error("CSV requires at least one data row");
  return { schemaVersion: 1, provenance: { ...provenance }, bars, outputs };
}
