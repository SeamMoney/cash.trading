import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = process.env.VERCEL
  ? join("/tmp", "cash-trading-data")
  : join(process.cwd(), ".data");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function loadState<T>(key: string, fallback: T): T {
  try {
    ensureDir();
    const path = join(DATA_DIR, `${key}.json`);
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8")) as T;
    }
  } catch { /* corrupted file, use fallback */ }
  return fallback;
}

export function saveState<T>(key: string, data: T): void {
  try {
    ensureDir();
    const path = join(DATA_DIR, `${key}.json`);
    writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn(`[persist] Failed to save ${key}:`, err);
  }
}
