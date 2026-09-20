import assert from "node:assert/strict";
import { test } from "node:test";
import type { Bookmark } from "@keeppage/domain";
// @ts-expect-error Native Node TypeScript tests require explicit .ts extensions.
import { fetchBookmarkWindow } from "./bookmark-window.ts";

test("revalidates >100 loaded rows using bounded pages", async () => {
  const calls: number[] = [];
  const result = await fetchBookmarkWindow(async (query) => {
    calls.push(query.limit!);
    return { total: 250, source: "api", items: Array.from({ length: query.limit! }, (_, index) => ({ id: String(query.offset! + index) } as Bookmark)) };
  }, { search: "", quality: "all", view: "all" }, "token", 144);
  assert.deepEqual(calls, [100, 44]);
  assert.equal(result.items.length, 144);
});

test("cancelled query never fetches the next page or returns obsolete data", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(fetchBookmarkWindow(async () => {
    calls += 1;
    controller.abort();
    return { total: 250, source: "api", items: [{ id: "old-folder" } as Bookmark] };
  }, { search: "", quality: "all", view: "all" }, "token", 144, controller.signal), { name: "AbortError" });
  assert.equal(calls, 1);
});
