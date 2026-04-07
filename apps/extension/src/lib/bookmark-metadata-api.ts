import {
  bookmarkDetailResponseSchema,
  bookmarkMetadataUpdateRequestSchema,
  bookmarkSchema,
  folderListResponseSchema,
  tagListResponseSchema,
  type Bookmark,
  type BookmarkMetadataUpdateRequest,
  type Folder,
  type Tag,
} from "@keeppage/domain";
import { getStoredAuthToken } from "./auth-storage";
import { getConfiguredApiBaseUrl, recoverUnauthorizedSession } from "./auth-flow";

class ExtensionApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ExtensionApiError";
    this.status = status;
  }
}

export async function fetchBookmark(bookmarkId: string): Promise<Bookmark> {
  const payload = await requestJson(
    `/bookmarks/${encodeURIComponent(bookmarkId)}`,
    bookmarkDetailResponseSchema,
  );
  return payload.bookmark;
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

async function requestJson<T>(
  path: string,
  schema: { parse: (input: unknown) => T },
  init: RequestInit = {},
): Promise<T> {
  const [apiBaseUrl, token] = await Promise.all([
    getConfiguredApiBaseUrl(),
    getStoredAuthToken(),
  ]);
  if (!token) {
    throw new Error("未登录 KeepPage，请先登录。");
  }

  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const message = await readApiErrorMessage(response);
    if (response.status === 401 || response.status === 403) {
      await recoverUnauthorizedSession("popup-metadata");
    }
    throw new ExtensionApiError(response.status, message);
  }

  return schema.parse(await response.json());
}

async function readApiErrorMessage(response: Response) {
  const text = await response.text();
  if (!text) {
    return `请求失败（${response.status}）`;
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
