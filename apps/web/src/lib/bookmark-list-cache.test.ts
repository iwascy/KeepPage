import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Native Node TypeScript tests require explicit .ts extensions.
import { buildBookmarkListCacheKey, clearBookmarkListCache, readCachedBookmarkList, writeCachedBookmarkList } from "./bookmark-list-cache.ts";
// @ts-expect-error Native Node TypeScript tests require explicit .ts extensions.
import { buildListHash, parseListFilters } from "../app/routes.ts";

const query = { search: "gorm", quality: "all", view: "all", folderId: "go", limit: 24, offset: 0 } as const;

test("list cache isolates accounts and complete query and clears only the target account", () => {
  const storage: Record<string, string | ((...args: string[]) => unknown)> = {};
  Object.defineProperties(storage, {
    getItem: { value: (key: string) => storage[key] ?? null },
    setItem: { value: (key: string, value: string) => { storage[key] = value; } },
    removeItem: { value: (key: string) => { delete storage[key]; } },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage } });
  const result = { items: [], total: 5, source: "api" as const };
  writeCachedBookmarkList(query, result, "alice");
  assert.equal(readCachedBookmarkList(query, "bob"), null);
  assert.equal(readCachedBookmarkList({ ...query, folderId: "other" }, "alice"), null);
  assert.notEqual(buildBookmarkListCacheKey(query, "alice"), buildBookmarkListCacheKey({ ...query, sort: "updated" }, "alice"));
  writeCachedBookmarkList(query, result, "bob");
  clearBookmarkListCache("alice");
  assert.equal(readCachedBookmarkList(query, "alice"), null);
  assert.equal(readCachedBookmarkList(query, "bob")?.total, 5);
  clearBookmarkListCache();
  assert.equal(readCachedBookmarkList(query, "bob"), null);
});

test("URL round trips folder, query, tag, quality, view and sorting", () => {
  const filters = { search: "go & 中文", view: "favorites", quality: "high", folderId: "f/1", tagId: "t 1", sort: "relevance" } as const;
  assert.deepEqual(parseListFilters(buildListHash(filters)), filters);
  assert.equal(parseListFilters("#/?sort=invalid&quality=unknown&view=bad").sort, "created");
});
