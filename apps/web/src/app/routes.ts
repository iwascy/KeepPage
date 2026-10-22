import type { BookmarkListView, QualityGrade } from "@keeppage/domain";

export type WorkspaceScope = "standard" | "private";

export type ListFilters = {
  scope: WorkspaceScope;
  search: string;
  view: BookmarkListView;
  quality: "all" | QualityGrade;
  folderId: string;
  tagId: string;
  sort: "created" | "updated" | "title" | "relevance";
};

function parseHashPath(hash: string) {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathPart, queryString = ""] = normalized.split("?");
  return { path: pathPart.replace(/\/+$/, ""), queryString };
}

export function parseListFilters(hash: string): ListFilters {
  const { path, queryString } = parseHashPath(hash);
  const params = new URLSearchParams(queryString);
  const scope: WorkspaceScope = path === "/private" ? "private" : "standard";
  const view = params.get("view");
  const quality = params.get("quality");
  const sort = params.get("sort");
  return {
    scope,
    // Private keywords never enter the URL, so they cannot leak into browser history.
    search: scope === "private" ? "" : params.get("q") ?? "",
    view: view === "favorites" || view === "recent" ? view : "all",
    quality: quality === "high" || quality === "medium" || quality === "low" ? quality : "all",
    folderId: params.get("folder") ?? "",
    tagId: params.get("tag") ?? "",
    sort: sort === "updated" || sort === "title" || sort === "relevance" ? sort : "created",
  };
}

export function buildListHash(filters: ListFilters) {
  const params = new URLSearchParams();
  if (filters.search && filters.scope !== "private") params.set("q", filters.search);
  if (filters.view !== "all") params.set("view", filters.view);
  if (filters.quality !== "all") params.set("quality", filters.quality);
  if (filters.folderId) params.set("folder", filters.folderId);
  if (filters.tagId) params.set("tag", filters.tagId);
  if (filters.sort !== "created") params.set("sort", filters.sort);
  const base = filters.scope === "private" ? "#/private" : "#/";
  return `${base}${params.size ? `?${params}` : ""}`;
}

export type ViewRoute =
  | { page: "list"; scope: WorkspaceScope }
  | { page: "detail"; scope: WorkspaceScope; bookmarkId: string; versionId?: string }
  | { page: "private-mode" }
  | { page: "imports-new" }
  | { page: "imports-list" }
  | { page: "imports-detail"; taskId: string }
  | { page: "settings-api-tokens" }
  | { page: "settings-ai-organize" }
  | { page: "settings-extension-devices" }
  | { page: "settings-shares" }
  | { page: "extension-connect" };

export function parseRoute(hash: string): ViewRoute {
  const { path, queryString } = parseHashPath(hash);
  if (!path) {
    return { page: "list", scope: "standard" };
  }
  if (path === "/private") {
    return { page: "list", scope: "private" };
  }
  if (path === "/imports/new") {
    return { page: "imports-new" };
  }
  if (path === "/imports") {
    return { page: "imports-list" };
  }
  if (path === "/settings/private-mode") {
    return { page: "private-mode" };
  }
  if (path === "/settings/api-tokens") {
    return { page: "settings-api-tokens" };
  }
  if (path === "/settings/ai-organize") {
    return { page: "settings-ai-organize" };
  }
  if (path === "/settings/shares") {
    return { page: "settings-shares" };
  }
  if (path === "/settings/extension-devices") {
    return { page: "settings-extension-devices" };
  }
  if (path === "/extension/connect") {
    return { page: "extension-connect" };
  }
  if (path.startsWith("/imports/")) {
    const taskId = decodeURIComponent(path.slice("/imports/".length));
    if (!taskId) {
      return { page: "imports-list" };
    }
    return {
      page: "imports-detail",
      taskId,
    };
  }

  const scope: WorkspaceScope = path.startsWith("/private/bookmarks/") ? "private" : "standard";
  const detailPrefix = scope === "private" ? "/private/bookmarks/" : "/bookmarks/";
  if (!path.startsWith(detailPrefix)) {
    return { page: "list", scope: "standard" };
  }
  const bookmarkId = decodeURIComponent(path.slice(detailPrefix.length));
  if (!bookmarkId) {
    return { page: "list", scope };
  }

  const versionId = new URLSearchParams(queryString).get("version") ?? undefined;
  return {
    page: "detail",
    scope,
    bookmarkId,
    versionId,
  };
}

export function buildDetailHash(bookmarkId: string, versionId?: string, scope: WorkspaceScope = "standard") {
  const params = new URLSearchParams();
  if (versionId) {
    params.set("version", versionId);
  }
  const base = scope === "private" ? "#/private/bookmarks/" : "#/bookmarks/";
  return `${base}${encodeURIComponent(bookmarkId)}${params.toString() ? `?${params.toString()}` : ""}`;
}

export function goToList() {
  window.location.hash = "#/";
}

export function goToImportNew() {
  window.location.hash = "#/imports/new";
}

export function goToImportList() {
  window.location.hash = "#/imports";
}

export function goToApiTokens() {
  window.location.hash = "#/settings/api-tokens";
}

export function goToAIOrganize() {
  window.location.hash = "#/settings/ai-organize";
}

export function goToShares() {
  window.location.hash = "#/settings/shares";
}

export function goToExtensionDevices() {
  window.location.hash = "#/settings/extension-devices";
}

/** Parse pathname public share token, e.g. `/s/abc123`. */
export function parsePublicShareToken(pathname: string): string | null {
  const match = pathname.match(/^\/s\/([^/]+)\/?$/);
  if (!match?.[1]) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function goToPrivateMode() {
  window.location.hash = "#/settings/private-mode";
}

export function openImportTask(taskId: string) {
  window.location.hash = `#/imports/${encodeURIComponent(taskId)}`;
}

export function openBookmark(bookmarkId: string, versionId?: string, scope: WorkspaceScope = "standard") {
  window.location.hash = buildDetailHash(bookmarkId, versionId, scope);
}
