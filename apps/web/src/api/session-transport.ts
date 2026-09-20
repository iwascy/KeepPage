import type { AuthSession } from "@keeppage/domain";
// @ts-expect-error Native Node TypeScript tests require explicit .ts extensions.
import { ApiError } from "./errors.ts";

type Dependencies = {
  fetch: typeof fetch;
  readToken(): string | null;
  writeToken(token: string): void;
  clearToken(): void;
  parseSession(value: unknown): AuthSession;
  withLock<T>(action: () => Promise<T>): Promise<T>;
};

type Claims = { sub: string; sid?: string; exp: number };
function claims(token: string): Claims | null {
  try {
    const value = JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof value.sub === "string" && typeof value.exp === "number" ? value : null;
  } catch { return null; }
}
export function sessionIdentity(token: string) {
  const value = claims(token);
  return value?.sid ? `${value.sub}:${value.sid}` : token;
}
const cancelled = () => new DOMException("登录会话已改变，请重试。", "AbortError");

export function createSessionTransport(deps: Dependencies) {
  let refreshing: Promise<string> | null = null;
  let pending: Promise<unknown> = Promise.resolve();
  function exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = pending.catch(() => {}).then(() => deps.withLock(action));
    pending = next;
    return next;
  }

  function currentToken(original: string) {
    const current = deps.readToken();
    if (!current || sessionIdentity(current) !== sessionIdentity(original)) throw cancelled();
    return current;
  }

  async function checked(response: Response) {
    if (response.ok || response.status === 304) return response;
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(response.status, payload?.message || `请求失败（${response.status}）`, payload?.details, payload?.code ?? payload?.error);
  }

  async function refresh(base: string, original: string, force = false) {
    if (!refreshing) {
      const operation = exclusive(async () => {
        const token = currentToken(original);
        const payload = claims(token);
        if (!payload?.sid) return token; // Legacy clients keep their original expiry.
        if ((!force || token !== original) && payload.exp * 1000 > Date.now() + 30_000) return token;
        const result = await deps.fetch(`${base}/auth/refresh`, {
          method: "POST", credentials: "include", headers: { "X-KeepPage-Session": "web" },
          signal: AbortSignal.timeout(15_000),
        });
        currentToken(original);
        const response = await checked(result);
        const session = deps.parseSession(await response.json());
        currentToken(original); // Never resurrect a session cleared while the request was pending.
        if (sessionIdentity(session.token) !== sessionIdentity(original)) throw cancelled();
        deps.writeToken(session.token);
        return session.token;
      });
      refreshing = operation;
      void operation.finally(() => { if (refreshing === operation) refreshing = null; }).catch(() => {});
    }
    try { await refreshing; }
    catch (error) { currentToken(original); throw error; }
    return currentToken(original);
  }

  return {
    async fetch(base: string, path: string, init: RequestInit, original?: string): Promise<Response> {
      if (init.signal?.aborted) throw init.signal.reason ?? new DOMException("Aborted", "AbortError");
      let token = original ? currentToken(original) : undefined;
      if (token && claims(token)?.sid && claims(token)!.exp * 1000 <= Date.now() + 30_000) {
        token = await refresh(base, token);
      }
      const send = async () => {
        const headers = new Headers(init.headers);
        if (token) headers.set("authorization", `Bearer ${token}`);
        const response = await deps.fetch(`${base}${path}`, {
          ...init, headers, credentials: "include",
          signal: init.signal ?? (path === "/auth/me" ? AbortSignal.timeout(15_000) : undefined),
        });
        if (original) currentToken(original);
        return response;
      };
      let response = await send();
      if (response.status === 401 && token && claims(token)?.sid) {
        const error = await response.clone().json().catch(() => ({}));
        if ((error?.code ?? error?.error) === "TokenExpired") {
          token = await refresh(base, token, true);
          response = await send(); // Retry at most once; the first attempt failed authentication.
        }
      }
      try { return await checked(response); }
      catch (error) { if (original) currentToken(original); throw error; }
    },
    async login(base: string, path: string, body: unknown) {
      return exclusive(async () => {
        const response = await checked(await deps.fetch(`${base}${path}`, {
          method: "POST", credentials: "include",
          headers: { "content-type": "application/json", "X-KeepPage-Session": "web" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        }));
        const session = deps.parseSession(await response.json());
        deps.writeToken(session.token);
        return session;
      });
    },
    async logout(base: string) {
      return exclusive(async () => {
        const response = await deps.fetch(`${base}/auth/logout`, {
          method: "POST", credentials: "include", headers: { "X-KeepPage-Session": "web" },
          signal: AbortSignal.timeout(15_000),
        });
        // Retained TS rollback backend has no refresh cookies or logout route.
        if (response.status !== 404 || claims(deps.readToken() || "")?.sid) await checked(response);
        deps.clearToken();
      });
    },
  };
}
