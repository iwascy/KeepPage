import {
  authSessionSchema,
  authUserSchema,
  bookmarkDetailResponseSchema,
  bookmarkSearchResponseSchema,
  ensureArchiveBaseHref,
  type AuthLoginRequest,
  type AuthRegisterRequest,
  type AuthSession,
  type AuthUser,
  type Bookmark,
  type BookmarkDetailVersion,
  type QualityGrade,
} from "@keeppage/domain";
import type { ZodType } from "zod";

type DataSource = "api";

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export type BookmarkQuery = {
  search: string;
  quality: "all" | QualityGrade;
};

export type BookmarkResult = {
  items: Bookmark[];
  source: DataSource;
};

export type BookmarkViewerVersion = BookmarkDetailVersion;

export type BookmarkDetailResult = {
  bookmark: Bookmark;
  versions: BookmarkViewerVersion[];
  source: DataSource;
};

type RequestOptions = {
  method?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

function resolveApiBase() {
  return (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
}

async function request(path: string, options: RequestOptions = {}) {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...options.headers,
  };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(`${resolveApiBase()}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorPayload = await readErrorPayload(response);
    throw new ApiError(response.status, errorPayload.message, errorPayload.details);
  }

  return response;
}

async function requestJson<T>(
  path: string,
  schema: ZodType<T>,
  options: RequestOptions = {},
) {
  const response = await request(path, options);
  const payload = await response.json();
  return schema.parse(payload);
}

async function readErrorPayload(response: Response) {
  try {
    const payload = await response.json() as {
      message?: string;
      details?: unknown;
    };
    return {
      message: payload.message ?? `API ${response.status}`,
      details: payload.details,
    };
  } catch {
    const text = await response.text();
    return {
      message: text || `API ${response.status}`,
      details: undefined,
    };
  }
}

export async function registerAccount(input: AuthRegisterRequest): Promise<AuthSession> {
  return requestJson("/auth/register", authSessionSchema, {
    method: "POST",
    body: input,
  });
}

export async function loginAccount(input: AuthLoginRequest): Promise<AuthSession> {
  return requestJson("/auth/login", authSessionSchema, {
    method: "POST",
    body: input,
  });
}

export async function fetchCurrentUser(token: string): Promise<AuthUser> {
  return requestJson("/auth/me", authUserSchema, {
    token,
  });
}

export async function fetchBookmarks(query: BookmarkQuery, token: string): Promise<BookmarkResult> {
  const params = new URLSearchParams();
  if (query.search.trim()) {
    params.set("q", query.search.trim());
  }
  if (query.quality !== "all") {
    params.set("quality", query.quality);
  }
  const path = `/bookmarks${params.toString() ? `?${params.toString()}` : ""}`;
  const payload = await requestJson(path, bookmarkSearchResponseSchema, {
    token,
  });
  return {
    items: payload.items,
    source: "api",
  };
}

export async function fetchBookmarkDetail(
  bookmarkId: string,
  token: string,
): Promise<BookmarkDetailResult | null> {
  try {
    const payload = await requestJson(
      `/bookmarks/${encodeURIComponent(bookmarkId)}`,
      bookmarkDetailResponseSchema,
      {
        token,
      },
    );
    return {
      bookmark: payload.bookmark,
      versions: payload.versions,
      source: "api",
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function createArchiveObjectUrl(token: string, objectKey: string, sourceUrl: string) {
  const response = await fetch(
    `${resolveApiBase()}/objects/${encodeURIComponent(objectKey)}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok) {
    const errorPayload = await readErrorPayload(response);
    throw new ApiError(response.status, errorPayload.message, errorPayload.details);
  }
  const html = ensureArchiveBaseHref(await response.text(), sourceUrl);
  const blob = new Blob([html], {
    type: response.headers.get("content-type") ?? "text/html;charset=utf-8",
  });
  return URL.createObjectURL(blob);
}
