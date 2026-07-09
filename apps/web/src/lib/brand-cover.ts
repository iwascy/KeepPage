/** Stable brand-tile palette (not random per render). */
export const BRAND_COVER_TONES = [
  "peach",
  "mist",
  "sand",
  "sky",
  "mint",
  "rose",
  "slate",
  "lavender",
] as const;

export type BrandCoverTone = (typeof BRAND_COVER_TONES)[number];

export function hashDomain(domain: string) {
  let hash = 0;
  const normalized = domain.trim().toLowerCase();
  for (const char of normalized) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

/** Same domain always maps to the same tone. */
export function brandCoverTone(domain: string): BrandCoverTone {
  return BRAND_COVER_TONES[hashDomain(domain) % BRAND_COVER_TONES.length]!;
}

export function formatDisplayDomain(domain: string) {
  return domain.replace(/^www\./i, "");
}

/** Two-letter monogram from hostname for L3 fallback. */
export function domainMonogram(domain: string) {
  const host = formatDisplayDomain(domain).split(".")[0] || domain;
  const segments = host.split(/[-_]+/).filter(Boolean);
  if (segments.length >= 2) {
    const a = segments[0]?.[0] ?? "";
    const b = segments[1]?.[0] ?? "";
    return `${a}${b}`.toUpperCase() || host.slice(0, 2).toUpperCase();
  }
  if (host.length <= 2) {
    return host.toUpperCase();
  }
  return host.slice(0, 2).toUpperCase();
}

export function isUsableCoverImageUrl(url: string | undefined | null): url is string {
  if (!url?.trim()) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
