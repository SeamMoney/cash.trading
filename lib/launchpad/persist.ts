import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), ".data");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function loadState<T>(key: string, fallback: T): T {
  ensureDir();
  const path = join(DATA_DIR, `${key}.json`);
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8")) as T;
    }
  } catch { /* corrupted file, use fallback */ }
  return fallback;
}

export function saveState<T>(key: string, data: T): void {
  ensureDir();
  const path = join(DATA_DIR, `${key}.json`);
  try {
    writeFileSync(path, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn(`[persist] Failed to save ${key}:`, err);
  }
}
