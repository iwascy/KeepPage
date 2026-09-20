import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Native Node TypeScript tests require explicit .ts extensions.
import { runBoundedBatch, mergeTagIds } from "./batch-actions.ts";

test("partial failure preserves only failed IDs and respects concurrency", async () => {
  let running = 0;
  let peak = 0;
  const result = await runBoundedBatch(["a", "b", "c", "d", "a"], async (id) => {
    running += 1; peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 2));
    running -= 1;
    if (id === "b" || id === "d") throw new Error("offline");
  }, 2);
  assert.equal(peak, 2);
  assert.equal(result.succeeded, 2);
  assert.deepEqual([...result.failures.keys()].sort(), ["b", "d"]);
  const retried: string[] = [];
  await runBoundedBatch(result.failures.keys(), async (id) => { retried.push(id); });
  assert.deepEqual(retried.sort(), ["b", "d"]);
});

test("tag append/remove preserves unrelated tags; replacement is explicit", () => {
  assert.deepEqual(mergeTagIds(["a", "b"], ["b", "c"], "append"), ["a", "b", "c"]);
  assert.deepEqual(mergeTagIds(["a", "b"], ["b"], "remove"), ["a"]);
  assert.deepEqual(mergeTagIds(["a", "b"], ["c"], "replace"), ["c"]);
});
