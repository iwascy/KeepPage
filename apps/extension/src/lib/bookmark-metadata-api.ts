import {
  bookmarkDetailResponseSchema,
  ingestBookmarkRequestSchema,
  ingestBookmarkResponseSchema,
  bookmarkMetadataUpdateRequestSchema,
  bookmarkSchema,
  bookmarkStatusResponseSchema,
  folderListResponseSchema,
  tagListResponseSchema,
  type Bookmark,
  type BookmarkMetadataUpdateRequest,
  type IngestBookmarkResponse,
  type BookmarkStatusResponse,
  type Folder,
  type Tag,
} from "@keeppage/domain";
import { getStoredSyncToken } from "./auth-storage";
import {
  confirmAuthSessionRejected,
  getConfiguredApiBaseUrl,
  recoverUnauthorizedSession,
} from "./auth-flow";
import { clearPrivateSessionToken, getPrivateSessionToken } from "./private-vault";

export const PRIVATE_MODE_LOCKED_MESSAGE = "私密模式已锁定，请先解锁。";

class ExtensionApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ExtensionApiError";
    this.status = status;
  }
}

export class PrivateModeLockedError extends Error {
  constructor() {
    super(PRIVATE_MODE_LOCKED_MESSAGE);
    this.name = "PrivateModeLockedError";
  }
}

type RequestOptions = {
  // Attach the private session token and treat PrivateModeLocked as a vault
  // lock (not a login expiry).
  private?: boolean;
};

export async function fetchBookmark(bookmarkId: string): Promise<Bookmark> {
  const payload = await requestJson(
    `/bookmarks/${encodeURIComponent(bookmarkId)}`,
    bookmarkDetailResponseSchema,
  );
  return payload.bookmark;
}

export async function fetchBookmarkStatus(url: string): Promise<BookmarkStatusResponse> {
  return requestJson(
    `/bookmarks/status?url=${encodeURIComponent(url)}`,
    bookmarkStatusResponseSchema,
  );
}

export async function createLinkBookmark(
  url: string,
  title?: string,
): Promise<IngestBookmarkResponse> {
  const payload = ingestBookmarkRequestSchema.parse({
    url,
    title: title?.trim() || undefined,
    dedupeStrategy: "merge",
  });
  return requestJson("/bookmarks", ingestBookmarkResponseSchema, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteBookmark(bookmarkId: string): Promise<void> {
  await request(`/bookmarks/${encodeURIComponent(bookmarkId)}`, {
    method: "DELETE",
  });
}

export async function fetchFolders(): Promise<Folder[]> {
  const payload = await requestJson("/folders", folderListResponseSchema);
  return payload.items;
}

export async function fetchTags(): Promise<Tag[]> {
  const payload = await requestJson("/tags", tagListResponseSchema);
  return payload.items;
}

export async function updateBookmarkMetadata(
  bookmarkId: string,
  input: BookmarkMetadataUpdateRequest,
): Promise<Bookmark> {
  const payload = bookmarkMetadataUpdateRequestSchema.parse(input);
  return requestJson(
    `/bookmarks/${encodeURIComponent(bookmarkId)}/metadata`,
    bookmarkSchema,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export async function fetchPrivateBookmark(bookmarkId: string): Promise<Bookmark> {
  const payload = await requestJson(
    `/private/bookmarks/${encodeURIComponent(bookmarkId)}`,
    bookmarkDetailResponseSchema,
    {},
    { private: true },
  );
  return payload.bookmark;
}

export async function fetchPrivateFolders(): Promise<Folder[]> {
  const payload = await requestJson("/private/folders", folderListResponseSchema, {}, { private: true });
  return payload.items;
}

export async function fetchPrivateTags(): Promise<Tag[]> {
  const payload = await requestJson("/private/tags", tagListResponseSchema, {}, { private: true });
  return payload.items;
}

export async function updatePrivateBookmarkMetadata(
  bookmarkId: string,
  input: BookmarkMetadataUpdateRequest,
): Promise<Bookmark> {
  const payload = bookmarkMetadataUpdateRequestSchema.parse(input);
  return requestJson(
    `/private/bookmarks/${encodeURIComponent(bookmarkId)}/metadata`,
    bookmarkSchema,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    { private: true },
  );
}

async function requestJson<T>(
  path: string,
  schema: { parse: (input: unknown) => T },
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const response = await request(path, init, options);
  return schema.parse(await response.json());
}

async function request(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<Response> {
  const [apiBaseUrl, token, privateToken] = await Promise.all([
    getConfiguredApiBaseUrl(),
    getStoredSyncToken(),
    options.private ? getPrivateSessionToken() : Promise.resolve(null),
  ]);
  if (!token) {
    throw new Error("未登录 KeepPage，请先登录。");
  }
  if (options.private && !privateToken) {
    throw new PrivateModeLockedError();
  }

  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  if (privateToken) {
    headers.set("x-keeppage-private-token", privateToken);
  }
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    if (options.private && isPrivateModeLockedResponse(response.status, body)) {
      // A locked vault is not an expired login: drop the stale private token
      // and never trigger the auth-session recovery flow.
      await clearPrivateSessionToken();
      throw new PrivateModeLockedError();
    }
    const message = readApiErrorMessage(response.status, body);
    // Only a confirmed 401 means the device authorization is gone. 403 is a
    // route-level rejection and must not reopen the web authorization flow.
    if (response.status === 401 && await confirmAuthSessionRejected()) {
      await recoverUnauthorizedSession("popup-metadata");
    }
    throw new ExtensionApiError(response.status, message);
  }

  return response;
}

function isPrivateModeLockedResponse(status: number, body: string) {
  if (status !== 401 && status !== 403) {
    return false;
  }
  try {
    const payload = JSON.parse(body) as { error?: unknown };
    return payload.error === "PrivateModeLocked";
  } catch {
    return false;
  }
}

function readApiErrorMessage(status: number, text: string) {
  if (!text) {
    return `请求失败（${status}）`;
  }

  try {
    const payload = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // Ignore JSON parse failure and fall back to raw text.
  }

  return text;
}
