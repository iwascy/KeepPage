import type { AuthUser } from "@keeppage/domain";
import { clearBookmarkListCache } from "../lib/bookmark-list-cache";
import { ApiError, clearApiResponseCache } from "../api";

const AUTH_TOKEN_STORAGE_KEY = "keeppage.auth-token";

export type SessionState =
  | { status: "booting"; token: null; user: null; error: string | null }
  | { status: "anonymous"; token: null; user: null; error: string | null }
  | { status: "authenticated"; token: string; user: AuthUser; error: null };

export function getStoredToken() {
  const stored = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim();
  return stored || null;
}

export function setStoredToken(token: string) {
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}

export function clearStoredToken() {
  clearBookmarkListCache();
  clearApiResponseCache();
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

export function toErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
}
