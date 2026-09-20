import type { Bookmark, QualityGrade } from "@keeppage/domain";
import type { BookmarkListView } from "@keeppage/domain";
import type { BookmarkQuery, BookmarkResult } from "../api";

const CACHE_PREFIX = "keeppage:bookmark-list:v3:";
const CACHE_TTL_MS = 5 * 60 * 1000;

type CachedBookmarkList = {
  storedAt: number;
  items: Bookmark[];
  total: number;
};

export function readCachedBookmarkList(query: BookmarkQuery, accountId: string): BookmarkResult | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(buildBookmarkListCacheKey(query, accountId));
    if (!rawValue) {
      return null;
    }
    const cached = JSON.parse(rawValue) as Partial<CachedBookmarkList>;
    if (
      typeof cached.storedAt !== "number"
      || Date.now() - cached.storedAt > CACHE_TTL_MS
      || !Array.isArray(cached.items)
      || typeof cached.total !== "number"
    ) {
      return null;
    }
    return {
      items: cached.items,
      total: cached.total,
      source: "api",
    };
  } catch {
    return null;
  }
}

export function writeCachedBookmarkList(query: BookmarkQuery, result: BookmarkResult, accountId: string) {
  if (typeof window === "undefined" || (query.offset ?? 0) !== 0) {
    return;
  }

  try {
    window.sessionStorage.setItem(
      buildBookmarkListCacheKey(query, accountId),
      JSON.stringify({
        storedAt: Date.now(),
        items: result.items,
        total: result.total,
      } satisfies CachedBookmarkList),
    );
  } catch {
    return;
  }
}

export function buildBookmarkListCacheKey(query: BookmarkQuery, accountId: string) {
  const normalized = {
    accountId,
    sort: query.sort ?? "created",
    search: query.search.trim(),
    quality: query.quality as "all" | QualityGrade,
    view: query.view as BookmarkListView,
    folderId: query.folderId ?? "",
    tagId: query.tagId ?? "",
    limit: query.limit ?? 0,
    offset: query.offset ?? 0,
  };
  return `${CACHE_PREFIX}${JSON.stringify(normalized)}`;
}

export function clearBookmarkListCache(accountId?: string) {
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(window.sessionStorage).filter((key) => {
      if (!key.startsWith("keeppage:bookmark-list:")) return false;
      if (!accountId || !key.startsWith(CACHE_PREFIX)) return true;
      try { return JSON.parse(key.slice(CACHE_PREFIX.length)).accountId === accountId; }
      catch { return true; }
    });
    for (const key of keys) window.sessionStorage.removeItem(key);
  } catch { /* Storage can be disabled; caching is optional. */ }
}
