import { createHash } from "node:crypto";

export function normalizeSourceUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }

  if (url.pathname.endsWith("/") && url.pathname !== "/") {
    url.pathname = url.pathname.slice(0, -1);
  }

  const sortedParams = [...url.searchParams.entries()].sort(([keyA, valueA], [keyB, valueB]) => {
    if (keyA === keyB) {
      return valueA.localeCompare(valueB);
    }
    return keyA.localeCompare(keyB);
  });
  url.search = "";
  for (const [key, value] of sortedParams) {
    url.searchParams.append(key, value);
  }

  return url.toString();
}

export function hashNormalizedUrl(normalizedUrl: string) {
  return createHash("sha256").update(normalizedUrl).digest("hex");
}
