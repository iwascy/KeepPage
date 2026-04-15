import type { ApiTokenScope, BookmarkVersion } from "@keeppage/domain";

export function deduplicateScopes(scopes: ApiTokenScope[]) {
  return [...new Set(scopes)];
}

export function deriveHtmlObjectKeyFromMediaObjectKey(objectKey: string) {
  const matched = objectKey.match(/^(.*)\.assets\/[^/]+$/i);
  return matched?.[1] ? `${matched[1]}.html` : null;
}

export function mergeBookmarkMediaFiles(
  existing: BookmarkVersion["mediaFiles"],
  incoming?: BookmarkVersion["mediaFiles"],
) {
  const merged = new Map<string, NonNullable<BookmarkVersion["mediaFiles"]>[number]>();
  for (const item of existing ?? []) {
    merged.set(item.objectKey, item);
  }
  for (const item of incoming ?? []) {
    merged.set(item.objectKey, item);
  }
  return [...merged.values()];
}
