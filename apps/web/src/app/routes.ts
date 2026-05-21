export type ViewRoute =
  | { page: "list" }
  | { page: "detail"; bookmarkId: string; versionId?: string }
  | { page: "private-mode" }
  | { page: "private-detail"; bookmarkId: string; versionId?: string }
  | { page: "imports-new" }
  | { page: "imports-list" }
  | { page: "imports-detail"; taskId: string }
  | { page: "settings-api-tokens" }
  | { page: "settings-extension-devices" }
  | { page: "extension-connect" };

export function parseRoute(hash: string): ViewRoute {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!normalized) {
    return { page: "list" };
  }

  const [pathPart, queryString = ""] = normalized.split("?");
  const path = pathPart.replace(/\/+$/, "");
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
  if (!path.startsWith("/bookmarks/")) {
    if (path.startsWith("/private/bookmarks/")) {
      const bookmarkId = decodeURIComponent(path.slice("/private/bookmarks/".length));
      if (!bookmarkId) {
        return { page: "private-mode" };
      }
      const versionId = new URLSearchParams(queryString).get("version") ?? undefined;
      return {
        page: "private-detail",
        bookmarkId,
        versionId,
      };
    }
    return { page: "list" };
  }

  const bookmarkId = decodeURIComponent(path.slice("/bookmarks/".length));
  if (!bookmarkId) {
    return { page: "list" };
  }

  const versionId = new URLSearchParams(queryString).get("version") ?? undefined;
  return {
    page: "detail",
    bookmarkId,
    versionId,
  };
}

export function buildDetailHash(bookmarkId: string, versionId?: string) {
  const params = new URLSearchParams();
  if (versionId) {
    params.set("version", versionId);
  }
  return `#/bookmarks/${encodeURIComponent(bookmarkId)}${params.toString() ? `?${params.toString()}` : ""}`;
}

export function buildPrivateDetailHash(bookmarkId: string, versionId?: string) {
  const params = new URLSearchParams();
  if (versionId) {
    params.set("version", versionId);
  }
  return `#/private/bookmarks/${encodeURIComponent(bookmarkId)}${params.toString() ? `?${params.toString()}` : ""}`;
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

export function goToExtensionDevices() {
  window.location.hash = "#/settings/extension-devices";
}

export function goToPrivateMode() {
  window.location.hash = "#/settings/private-mode";
}

export function openImportTask(taskId: string) {
  window.location.hash = `#/imports/${encodeURIComponent(taskId)}`;
}

export function openBookmark(bookmarkId: string, versionId?: string) {
  window.location.hash = buildDetailHash(bookmarkId, versionId);
}

export function openPrivateBookmark(bookmarkId: string, versionId?: string) {
  window.location.hash = buildPrivateDetailHash(bookmarkId, versionId);
}
