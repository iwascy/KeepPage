export const LIST_UI_VERSIONS = ["classic", "brand"] as const;

export type ListUiVersion = (typeof LIST_UI_VERSIONS)[number];

export const LIST_UI_VERSION_STORAGE_KEY = "keeppage.list-ui-version";

export const DEFAULT_LIST_UI_VERSION: ListUiVersion = "brand";

export function isListUiVersion(value: unknown): value is ListUiVersion {
  return value === "classic" || value === "brand";
}

export function getStoredListUiVersion(): ListUiVersion {
  try {
    const raw = window.localStorage.getItem(LIST_UI_VERSION_STORAGE_KEY)?.trim();
    if (isListUiVersion(raw)) {
      return raw;
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_LIST_UI_VERSION;
}

export function setStoredListUiVersion(version: ListUiVersion) {
  window.localStorage.setItem(LIST_UI_VERSION_STORAGE_KEY, version);
}

export function listUiVersionLabel(version: ListUiVersion) {
  return version === "brand" ? "新版（品牌磁贴）" : "旧版（横向图标）";
}
