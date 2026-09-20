import type { AuthUser } from "@keeppage/domain";
// @ts-expect-error Native Node TypeScript tests require explicit .ts extensions.
import { isSessionInvalid } from "../api/errors.ts";

export type RestoredSessionState =
  | { status: "anonymous"; token: null; user: null; error: string | null }
  | { status: "authenticated"; token: string; user: AuthUser; error: null };

export async function restoreStoredSession(
  token: string | null,
  fetchUser: (token: string) => Promise<AuthUser>,
  readToken: () => string | null,
): Promise<RestoredSessionState> {
  if (!token) return { status: "anonymous", token: null, user: null, error: null };
  try {
    const user = await fetchUser(token);
    return { status: "authenticated", token: readToken() ?? token, user, error: null };
  } catch (error) {
    // Network, server and permission failures are retryable without deleting credentials.
    if (!isSessionInvalid(error)) throw error;
    return { status: "anonymous", token: null, user: null, error: error instanceof Error ? error.message : "请重新登录。" };
  }
}
