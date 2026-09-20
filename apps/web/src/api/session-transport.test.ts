import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthSession, AuthUser } from "@keeppage/domain";
// @ts-expect-error Native Node TypeScript tests require explicit .ts extensions.
import { createSessionTransport } from "./session-transport.ts";
// @ts-expect-error Native Node TypeScript tests require explicit .ts extensions.
import { ApiError, isSessionInvalid } from "./errors.ts";
// @ts-expect-error Native Node TypeScript tests require explicit .ts extensions.
import { restoreStoredSession } from "../app/restore-session.ts";

const user = { id: "u1", email: "test@example.com" } as AuthUser;
const token = (exp: number, sid = "s1") => `${btoa(JSON.stringify({ sub: user.id, sid, exp }))}.test-signature`;
const expired = () => token(Math.floor(Date.now() / 1000) - 1);
const fresh = () => token(Math.floor(Date.now() / 1000) + 1200);
function setup(initial: string, handler: (url: string, init: RequestInit) => Promise<Response>) {
  let stored: string | null = initial;
  const transport = createSessionTransport({
    fetch: ((url: string | URL | Request, init?: RequestInit) => handler(String(url), init ?? {})) as typeof fetch,
    readToken: () => stored,
    writeToken: (value: string) => { stored = value; },
    clearToken: () => { stored = null; },
    parseSession: (value: unknown) => value as AuthSession,
    withLock: async <T>(action: () => Promise<T>) => action(),
  });
  return { transport, read: () => stored, write: (value: string | null) => { stored = value; } };
}

test("parallel requests refresh once and use the new bearer, including archive reads", async () => {
  const original = expired(); const next = fresh(); let refreshes = 0; let requests = 0;
  const env = setup(original, async (url, init) => {
    if (url.endsWith("/auth/refresh")) { refreshes++; return Response.json({ token: next, user }); }
    requests++;
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${next}`);
    return Response.json({ ok: true });
  });
  await Promise.all(Array.from({ length: 10 }, () => env.transport.fetch("/api", "/objects", {}, original)));
  assert.equal(refreshes, 1); assert.equal(requests, 10); assert.equal(env.read(), next);
});

test("transient restore failures and 403 preserve credentials; only account 401 invalidates", async () => {
  for (const error of [new TypeError("offline"), new ApiError(500, "server"), new ApiError(403, "forbidden"), new ApiError(401, "locked", undefined, "PrivateModeLocked")]) {
    await assert.rejects(restoreStoredSession("saved", async () => { throw error; }, () => "saved"), (actual) => actual === error);
    assert.equal(isSessionInvalid(error), false);
  }
  const session = await restoreStoredSession("saved", async () => { throw new ApiError(401, "expired", undefined, "SessionExpired"); }, () => "saved");
  assert.equal(session.status, "anonymous");
});

test("refresh outage leaves the saved token intact and a later retry succeeds", async () => {
  let failing = true; const original = expired();
  const env = setup(original, async (url) => {
    if (url.endsWith("/auth/refresh")) return failing ? Response.json({ error: "InternalServerError" }, { status: 500 }) : Response.json({ token: fresh(), user });
    return Response.json(user);
  });
  await assert.rejects(env.transport.fetch("/api", "/auth/me", {}, original), { status: 500 });
  assert.equal(env.read(), original);
  failing = false;
  await env.transport.fetch("/api", "/auth/me", {}, original);
});

test("expired response retries once, private errors and permissions never trigger refresh", async () => {
  const original = fresh(); let refreshes = 0; let attempts = 0;
  const env = setup(original, async (url) => {
    if (url.endsWith("/auth/refresh")) { refreshes++; return Response.json({ token: fresh(), user }); }
    attempts++; return Response.json({ error: "TokenExpired" }, { status: 401 });
  });
  await assert.rejects(env.transport.fetch("/api", "/bookmarks", {}, original), { status: 401, code: "TokenExpired" });
  assert.equal(refreshes, 1); assert.equal(attempts, 2);
  for (const [status, code] of [[403, "InsufficientScope"], [401, "PrivateModeLocked"]] as const) {
    const denied = setup(original, async (url) => { assert.ok(!url.endsWith("/auth/refresh")); return Response.json({ error: code }, { status }); });
    await assert.rejects(denied.transport.fetch("/api", "/private/bookmarks", {}, original), { status, code });
  }
});

test("logout serializes after pending refresh and never restores the local token", async () => {
  const original = expired(); let release!: () => void; let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const calls: string[] = [];
  const env = setup(original, async (url) => {
    calls.push(url);
    if (url.endsWith("/auth/refresh")) { entered(); await wait; return Response.json({ token: fresh(), user }); }
    return new Response(null, { status: 204 });
  });
  const request = env.transport.fetch("/api", "/bookmarks", {}, original).catch((error: Error) => { assert.equal(error.name, "AbortError"); });
  await started;
  const logout = env.transport.logout("/api"); release();
  await Promise.all([request, logout]);
  assert.equal(env.read(), null);
  assert.ok(calls.indexOf("/api/auth/logout") > calls.indexOf("/api/auth/refresh"));
});

test("a refresh completing after another tab signs out cannot resurrect the session", async () => {
  const original = expired(); let release!: () => void; let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const env = setup(original, async () => { entered(); await wait; return Response.json({ token: fresh(), user }); });
  const request = env.transport.fetch("/api", "/auth/me", {}, original);
  await started; env.write(null); release();
  await assert.rejects(request, { name: "AbortError" }); assert.equal(env.read(), null);
});

test("stale requests cannot execute with another session's bearer", async () => {
  const original = fresh(); const env = setup(original, async () => { throw new Error("must not fetch"); });
  env.write(token(Math.floor(Date.now() / 1000) + 1200, "different"));
  await assert.rejects(env.transport.fetch("/api", "/bookmarks", {}, original), { name: "AbortError" });
});

test("failed logout keeps credentials so the user can retry revocation", async () => {
  const original = fresh(); const env = setup(original, async () => Response.json({ error: "InternalServerError" }, { status: 500 }));
  await assert.rejects(env.transport.logout("/api"), { status: 500 }); assert.equal(env.read(), original);
});
