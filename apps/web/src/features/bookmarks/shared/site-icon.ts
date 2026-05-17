import { useEffect, useMemo, useState } from "react";
import type { Bookmark } from "@keeppage/domain";

export function buildBookmarkSiteIconCandidates(
  bookmark: Pick<Bookmark, "domain" | "faviconUrl">,
  size: number,
) {
  const fallbackDomain = bookmark.domain.trim();
  const googleIconSizes = fallbackDomain
    ? Array.from(new Set([Math.max(size, 256), size, 128, 64]))
    : [];
  return Array.from(
    new Set(
      [
        ...googleIconSizes.map((iconSize) => (
          `https://www.google.com/s2/favicons?domain=${encodeURIComponent(fallbackDomain)}&sz=${iconSize}`
        )),
        bookmark.faviconUrl?.trim() || "",
      ].filter(Boolean),
    ),
  );
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
