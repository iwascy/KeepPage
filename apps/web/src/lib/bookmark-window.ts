import type { BookmarkQuery, BookmarkResult } from "../api";

/** Revalidate the visible window without exceeding the API's 100-row page limit. */
export async function fetchBookmarkWindow(
  search: (query: BookmarkQuery, token: string, signal?: AbortSignal) => Promise<BookmarkResult>,
  query: BookmarkQuery,
  token: string,
  targetCount: number,
  signal?: AbortSignal,
): Promise<BookmarkResult> {
  const items: BookmarkResult["items"] = [];
  let total = Infinity;
  let offset = 0;
  const target = Math.max(24, targetCount);
  while (offset < Math.min(target, total)) {
    signal?.throwIfAborted();
    const page = await search({ ...query, offset, limit: Math.min(100, target - offset) }, token, signal);
    signal?.throwIfAborted();
    total = page.total;
    if (!page.items.length) break;
    offset += page.items.length;
    items.push(...page.items);
  }
  const seen = new Set<string>();
  return { source: "api", total: Number.isFinite(total) ? total : 0, items: items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id); return true;
  }) };
}
