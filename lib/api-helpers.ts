/**
 * API Response Helpers
 *
 * Utilities for handling Decibel API responses that may be in either:
 * - Array format (legacy): [item1, item2, ...]
 * - Paginated format (new): { items: [...], total: number }
 *
 * Updated Feb 3, 2026: Decibel API changed response schema for
 * trades, funding_rate_history, twap_history, user_trade_history
 */

/**
 * Normalize an API response that may be an array or paginated object
 * @param response - Either an array or { items: T[], total: number }
 * @returns Always returns an array
 */
export function normalizeArrayResponse<T>(
  response: T[] | { items: T[]; total: number } | null | undefined
): T[] {
  if (!response) return []
  if (Array.isArray(response)) return response
  return response.items || []
}

/**
 * Extract the total count from a paginated response
 * @param response - Either an array or { items: T[], total: number }
 * @returns The total count, or undefined for array responses
 */
export function extractTotal(
  response: unknown[] | { items: unknown[]; total: number } | null | undefined
): number | undefined {
  if (!response || Array.isArray(response)) return undefined
  return response.total
}

/**
 * Type guard to check if a response is paginated
 */
export function isPaginatedResponse<T>(
  response: T[] | { items: T[]; total: number }
): response is { items: T[]; total: number } {
  return !Array.isArray(response) && 'items' in response
}

/**
 * Paginated API request helper
 * Fetches all pages of a paginated API endpoint
 *
 * @param fetchPage - Function that fetches a single page given offset/limit
 * @param pageSize - Number of items per page (default 100)
 * @returns All items from all pages
 */
export async function fetchAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ items: T[]; total: number } | T[]>,
  pageSize = 100
): Promise<T[]> {
  const firstPage = await fetchPage(0, pageSize)

  // If it's an array (legacy format), return as-is
  if (Array.isArray(firstPage)) {
    return firstPage
  }

  const allItems = [...firstPage.items]
  const total = firstPage.total

  // If we have more pages, fetch them
  while (allItems.length < total) {
    const nextPage = await fetchPage(allItems.length, pageSize)
    const items = Array.isArray(nextPage) ? nextPage : nextPage.items
    if (items.length === 0) break
    allItems.push(...items)
  }

  return allItems
}
