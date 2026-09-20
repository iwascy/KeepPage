/** Run all requested actions with bounded concurrency and retain exact failed IDs. */
export async function runBoundedBatch(
  ids: Iterable<string>,
  action: (id: string) => Promise<unknown>,
  concurrency = 5,
) {
  const targets = [...new Set(ids)];
  const failures = new Map<string, unknown>();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), targets.length) }, async () => {
    while (next < targets.length) {
      const id = targets[next++];
      try { await action(id); } catch (error) { failures.set(id, error); }
    }
  }));
  return { succeeded: targets.length - failures.size, failures };
}

export function mergeTagIds(existing: string[], incoming: string[], mode: "append" | "remove" | "replace") {
  if (mode === "replace") return [...new Set(incoming)];
  if (mode === "append") return [...new Set([...existing, ...incoming])];
  return existing.filter((id) => !incoming.includes(id));
}
