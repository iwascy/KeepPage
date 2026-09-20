import { useEffect, useMemo, useState } from "react";
import type { Bookmark } from "@keeppage/domain";

const simpleIconSlugByHostname: Record<string, string> = {
  "card.weibo.com": "sinaweibo",
  "github.com": "github",
  "m.weibo.cn": "sinaweibo",
  "s.weibo.com": "sinaweibo",
  "weibo.com": "sinaweibo",
  "xiaohongshu.com": "xiaohongshu",
};

export function buildBookmarkSiteIconCandidates(
  bookmark: Pick<Bookmark, "domain" | "faviconUrl">,
  _size: number,
) {
  const fallbackDomain = bookmark.domain.trim();
  const simpleIconUrl = buildSimpleIconUrl(fallbackDomain);
  return Array.from(
    new Set(
      [
        normalizeDisplayableIconUrl(bookmark.faviconUrl),
        simpleIconUrl,
      ].filter(Boolean),
    ),
  );
}

function buildSimpleIconUrl(domain: string) {
  const slug = resolveSimpleIconSlug(domain);
  return slug
    ? `/api/public/objects?key=${encodeURIComponent(`assets/site-icons/simple-icons/${slug}.svg`)}`
    : "";
}

function resolveSimpleIconSlug(domain: string) {
  const normalizedDomain = domain.trim().toLowerCase().replace(/^www\./, "");
  if (!normalizedDomain) {
    return "";
  }
  return simpleIconSlugByHostname[normalizedDomain]
    ?? simpleIconSlugByHostname[findParentHostname(normalizedDomain) ?? ""]
    ?? "";
}

function findParentHostname(domain: string) {
  return Object.keys(simpleIconSlugByHostname)
    .filter((hostname) => domain.endsWith(`.${hostname}`))
    .sort((left, right) => right.length - left.length)[0];
}

function normalizeDisplayableIconUrl(rawUrl?: string) {
  const value = rawUrl?.trim();
  if (!value || isKnownFallbackIconUrl(value)) {
    return "";
  }
  return value;
}

function isKnownFallbackIconUrl(rawUrl: string) {
  if (/^(?:data|blob|chrome|chrome-extension):/i.test(rawUrl)) {
    return true;
  }

  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return (
      hostname === "google.com" && url.pathname.startsWith("/s2/favicons")
    )
      || hostname.endsWith("gstatic.com") && url.pathname.startsWith("/favicon")
      || hostname === "favicon.im"
      || hostname === "icon.horse";
  } catch {
    return false;
  }
}

function isDisplayableIconUrl(rawUrl: string) {
  return Boolean(rawUrl.trim()) && !isKnownFallbackIconUrl(rawUrl);
}

// Validation happens on the lazy rendered image, never through eager Image probes.
// Cards from the same domain reuse the successful candidate and known failures.
const iconChoices = new Map<string, number>();
const failedIcons = new Set<string>();

export function useBookmarkSiteIcon(
  bookmark: Pick<Bookmark, "id" | "domain" | "faviconUrl">,
  size: number,
) {
  const candidates = useMemo(
    () => buildBookmarkSiteIconCandidates(bookmark, size),
    [bookmark.domain, bookmark.faviconUrl, size],
  );
  const key = `${bookmark.domain.toLowerCase()}:${candidates.join("|")}`;
  const firstAvailable = () => iconChoices.get(key) ?? candidates.findIndex((candidate) => !failedIcons.has(candidate));
  const [choice, setChoice] = useState(() => ({ key, index: firstAvailable() }));
  const candidateIndex = choice.key === key ? choice.index : firstAvailable();
  const siteIconSrc = candidates[candidateIndex] ?? null;

  useEffect(() => {
    setChoice({ key, index: firstAvailable() });
  }, [key]);

  const advanceCandidate = () => {
    if (siteIconSrc) failedIcons.add(siteIconSrc);
    iconChoices.delete(key);
    const index = candidates.findIndex((candidate, index) => index > candidateIndex && !failedIcons.has(candidate));
    setChoice({ key, index });
    // Bound process-wide caches during long browsing sessions.
    if (failedIcons.size > 512) failedIcons.clear();
  };

  return {
    siteIconSrc,
    useDefaultSiteIcon: !siteIconSrc,
    handleSiteIconError: advanceCandidate,
    handleSiteIconLoad: (image: HTMLImageElement) => {
      if (!isDisplayableIconUrl(image.currentSrc || image.src) || image.naturalWidth < 16 || image.naturalHeight < 16) {
        advanceCandidate();
        return;
      }
      if (iconChoices.size > 512) iconChoices.clear();
      iconChoices.set(key, candidateIndex);
    },
  };
}
