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
  size: number,
) {
  const fallbackDomain = bookmark.domain.trim();
  const simpleIconUrl = buildSimpleIconUrl(fallbackDomain);
  const googleIconSizes = fallbackDomain
    ? Array.from(new Set([Math.max(size, 256), size, 128, 64]))
    : [];
  return Array.from(
    new Set(
      [
        bookmark.faviconUrl?.trim() || "",
        simpleIconUrl,
        ...googleIconSizes.map((iconSize) => (
          `https://www.google.com/s2/favicons?domain=${encodeURIComponent(fallbackDomain)}&sz=${iconSize}`
        )),
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

export function useBookmarkSiteIcon(
  bookmark: Pick<Bookmark, "id" | "domain" | "faviconUrl">,
  size: number,
) {
  const candidates = useMemo(
    () => buildBookmarkSiteIconCandidates(bookmark, size),
    [bookmark.domain, bookmark.faviconUrl, size],
  );
  const [candidateIndex, setCandidateIndex] = useState(0);
  const minimumNaturalSize = Math.min(96, Math.max(48, Math.round(size / 2)));

  useEffect(() => {
    setCandidateIndex(0);
  }, [bookmark.id, bookmark.domain, bookmark.faviconUrl, size]);

  const advanceCandidate = () => {
    setCandidateIndex((current) => Math.min(current + 1, candidates.length));
  };

  return {
    siteIconSrc: candidates[candidateIndex] ?? null,
    handleSiteIconError: advanceCandidate,
    handleSiteIconLoad: (image: HTMLImageElement) => {
      const naturalSize = Math.min(image.naturalWidth, image.naturalHeight);
      if (naturalSize > 0 && naturalSize < minimumNaturalSize) {
        advanceCandidate();
      }
    },
  };
}
