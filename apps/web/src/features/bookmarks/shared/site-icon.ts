import { useEffect, useMemo, useState } from "react";
import type { Bookmark } from "@keeppage/domain";

export function buildBookmarkSiteIconCandidates(
  bookmark: Pick<Bookmark, "domain" | "faviconUrl">,
  size: number,
) {
  const fallbackDomain = bookmark.domain.trim();
  return Array.from(
    new Set(
      [
        bookmark.faviconUrl?.trim() || "",
        fallbackDomain
          ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(fallbackDomain)}&sz=${size}`
          : "",
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

  useEffect(() => {
    setCandidateIndex(0);
  }, [bookmark.id, bookmark.domain, bookmark.faviconUrl, size]);

  return {
    siteIconSrc: candidates[candidateIndex] ?? null,
    handleSiteIconError: () => {
      setCandidateIndex((current) => Math.min(current + 1, candidates.length));
    },
  };
}
