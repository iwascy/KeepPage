const AUTH_TOKEN_STORAGE_KEY = "keeppage.auth-token";

export function getStoredToken() {
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim() || null;
}

export function setStoredToken(token: string) {
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}

export function removeStoredToken() {
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

export function isAuthStorageEvent(event: StorageEvent) {
  return event.storageArea === window.localStorage && (event.key === AUTH_TOKEN_STORAGE_KEY || event.key === null);
}
