import type { AuthUser } from "@keeppage/domain";
import { authUserSchema } from "./domain-runtime";

export async function getStoredAuthToken() {
  const result = await chrome.storage.local.get("authToken");
  const token = typeof result.authToken === "string" ? result.authToken.trim() : "";
  return token.startsWith("kp_") ? "" : token;
}

export async function getStoredSyncToken() {
  const result = await chrome.storage.local.get(["authApiToken", "authToken"]);
  const authApiToken = typeof result.authApiToken === "string" ? result.authApiToken.trim() : "";
  if (authApiToken) {
    return authApiToken;
  }

  const authToken = typeof result.authToken === "string" ? result.authToken.trim() : "";
  return authToken;
}

export async function getStoredAuthUser(): Promise<AuthUser | null> {
  const result = await chrome.storage.local.get("authUser");
  const parsed = authUserSchema.safeParse(result.authUser);
  return parsed.success ? parsed.data : null;
}
