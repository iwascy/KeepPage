import type { AuthUser } from "@keeppage/domain";
import { clearBookmarkListCache } from "../lib/bookmark-list-cache";
import { ApiError, clearApiResponseCache } from "../api";
import { removeStoredToken } from "./token-storage";
export { getStoredToken, setStoredToken } from "./token-storage";

export type SessionState =
  | { status: "unavailable"; token: null; user: null; error: string }
  | { status: "booting"; token: null; user: null; error: string | null }
  | { status: "anonymous"; token: null; user: null; error: string | null }
  | { status: "authenticated"; token: string; user: AuthUser; error: null };

export function clearStoredToken() {
  clearBookmarkListCache();
  clearApiResponseCache();
  removeStoredToken();
}

export function toErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "请求超时，请检查网络后重试。";
  }
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
    return "暂时无法连接服务，请检查网络后重试。";
  }
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
}
