import type { NextRequest } from "next/server";

/**
 * Sliding-window rate limiter for the public data routes (the ones that proxy
 * our Geomi key upstream). In-memory and therefore per-serverless-instance —
 * a determined distributed caller can exceed the global rate, but per-instance
 * caps still stop the common failure mode (one hot agent loop hammering a
 * route). Swap for a shared store if/when that's no longer enough.
 */

const buckets = new Map<string, number[]>();
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterS?: number;
}

export function clientKeyFor(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export function checkApiRateLimit(
  req: NextRequest,
  route: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const key = `${route}:${clientKeyFor(req)}`;
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => t > now - windowMs);
  if (hits.length >= limit) {
    return { allowed: false, retryAfterS: Math.ceil((hits[0] + windowMs - now) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);

  // Bound memory: drop oldest keys when the map grows past the cap.
  if (buckets.size > MAX_TRACKED_KEYS) {
    const excess = buckets.size - MAX_TRACKED_KEYS;
    let dropped = 0;
    for (const k of buckets.keys()) {
      buckets.delete(k);
      if (++dropped >= excess) break;
    }
  }
  return { allowed: true };
}
