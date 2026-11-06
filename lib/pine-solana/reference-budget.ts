const MAX_REFERENCE_BYTES = 128 * 1024 * 1024;
// Provenance permits three 256-character fields, 4096 note characters and two
// hashes. This allowance covers their worst-case JSON escaping and framing.
const METADATA_BYTES = 64 * 1024;
const BAR_NAMES = ["time", "open", "high", "low", "close", "volume"];

/**
 * Conservative capacity for compact or two-space-indented reference JSON.
 * Every scalar gets 32 bytes; each field gets 10 bytes for punctuation and
 * indentation. Keys are counted after JSON escaping and UTF-8 encoding.
 * Calculate once when streaming so long names are not encoded on every row.
 */
export function referenceRowCapacity(names: string[]): number {
  if (!Array.isArray(names) || !names.length || names.some(name => typeof name !== "string")) throw new Error("Reference budget requires output names");
  let rowBytes = 32; // Both the bar and output objects, including row separators.
  for (const name of [...BAR_NAMES, ...names]) rowBytes += Buffer.byteLength(JSON.stringify(name), "utf8") + 32 + 10;
  return Math.floor((MAX_REFERENCE_BYTES - METADATA_BYTES) / rowBytes);
}

/** Enforce before allocating or serializing the reference's rows. */
export function validateReferenceBudget(names: string[], rows: number): void {
  if (!Number.isSafeInteger(rows) || rows < 0) throw new Error("Reference row count must be a nonnegative safe integer");
  if (rows > referenceRowCapacity(names)) throw new Error("Reference exceeds the 128 MiB serialized-reference budget");
}
