/**
 * Rate Limiter for Decibel/Geomi API
 *
 * Geomi enforces rate limits:
 * - DecibelHttpApi: 200 requests per 30 seconds
 * - Total compute units: 10,000,000 per 5 minutes
 *
 * This implements a token bucket algorithm for request throttling.
 *
 * Updated Feb 3, 2026: Added rate limiting for Geomi API key requirements
 */

/**
 * Token bucket rate limiter
 */
class TokenBucketRateLimiter {
  private tokens: number
  private lastRefill: number
  private queue: Array<{
    resolve: () => void
    reject: (error: Error) => void
  }> = []
  private refillInterval: NodeJS.Timeout | null = null

  constructor(
    private readonly maxTokens: number,
    private readonly windowMs: number
  ) {
    this.tokens = maxTokens
    this.lastRefill = Date.now()
    this.startRefillTimer()
  }

  private startRefillTimer() {
    // Refill tokens at regular intervals
    this.refillInterval = setInterval(() => {
      this.refill()
      this.processQueue()
    }, 1000) // Check every second

    // Ensure timer doesn't prevent process from exiting
    if (this.refillInterval.unref) {
      this.refillInterval.unref()
    }
  }

  private refill() {
    const now = Date.now()
    const elapsed = now - this.lastRefill

    if (elapsed >= this.windowMs) {
      // Full refill after window expires
      this.tokens = this.maxTokens
      this.lastRefill = now
    } else {
      // Partial refill based on time elapsed
      const tokensToAdd = Math.floor((elapsed / this.windowMs) * this.maxTokens)
      if (tokensToAdd > 0) {
        this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd)
        this.lastRefill = now
      }
    }
  }

  private processQueue() {
    while (this.tokens > 0 && this.queue.length > 0) {
      this.tokens--
      const { resolve } = this.queue.shift()!
      resolve()
    }
  }

  /**
   * Acquire a token before making a request
   * Blocks if no tokens are available
   */
  async acquire(): Promise<void> {
    this.refill()

    if (this.tokens > 0) {
      this.tokens--
      return
    }

    // Wait for a token to become available
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject })

      // Timeout after 30 seconds to prevent indefinite waiting
      const timeout = setTimeout(() => {
        const index = this.queue.findIndex((q) => q.resolve === resolve)
        if (index !== -1) {
          this.queue.splice(index, 1)
          reject(new Error('Rate limit timeout - too many queued requests'))
        }
      }, 30000)

      // Clean up timeout when resolved
      const originalResolve = resolve
      const wrappedResolve = () => {
        clearTimeout(timeout)
        originalResolve()
      }
      const index = this.queue.findIndex((q) => q.resolve === resolve)
      if (index !== -1) {
        this.queue[index].resolve = wrappedResolve
      }
    })
  }

  /**
   * Try to acquire a token without blocking
   * Returns false if no tokens available
   */
  tryAcquire(): boolean {
    this.refill()
    if (this.tokens > 0) {
      this.tokens--
      return true
    }
    return false
  }

  /**
   * Get current number of available tokens
   */
  getAvailableTokens(): number {
    this.refill()
    return this.tokens
  }

  /**
   * Get number of queued requests
   */
  getQueueLength(): number {
    return this.queue.length
  }

  /**
   * Clean up timer on shutdown
   */
  destroy() {
    if (this.refillInterval) {
      clearInterval(this.refillInterval)
      this.refillInterval = null
    }
    // Reject all queued requests
    while (this.queue.length > 0) {
      const { reject } = this.queue.shift()!
      reject(new Error('Rate limiter destroyed'))
    }
  }
}

// Geomi rate limit: 200 requests per 30 seconds for DecibelHttpApi
const DECIBEL_RATE_LIMIT = 200
const DECIBEL_WINDOW_MS = 30000

/**
 * Shared rate limiter instance for Decibel API requests
 *
 * Usage:
 * ```typescript
 * import { decibelRateLimiter } from './rate-limiter'
 *
 * async function makeApiCall() {
 *   await decibelRateLimiter.acquire()
 *   const response = await fetch('...')
 *   return response.json()
 * }
 * ```
 */
export const decibelRateLimiter = new TokenBucketRateLimiter(
  DECIBEL_RATE_LIMIT,
  DECIBEL_WINDOW_MS
)

/**
 * Rate-limited fetch wrapper
 * Automatically acquires a token before making the request
 */
export async function rateLimitedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  await decibelRateLimiter.acquire()
  return fetch(input, init)
}

/**
 * Create a rate limiter with custom limits
 */
export function createRateLimiter(
  maxRequests: number,
  windowMs: number
): TokenBucketRateLimiter {
  return new TokenBucketRateLimiter(maxRequests, windowMs)
}
