import type { AuthUser } from "@keeppage/domain";
import { authUserSchema } from "./domain-runtime";

export async function getStoredAuthToken() {
  const result = await chrome.storage.local.get("authToken");
  return typeof result.authToken === "string" ? result.authToken.trim() : "";
}

export async function getStoredAuthUser(): Promise<AuthUser | null> {
  const result = await chrome.storage.local.get("authUser");
  const parsed = authUserSchema.safeParse(result.authUser);
  return parsed.success ? parsed.data : null;
}
