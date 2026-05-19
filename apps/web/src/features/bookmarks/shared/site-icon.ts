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

export function useBookmarkSiteIcon(
  bookmark: Pick<Bookmark, "id" | "domain" | "faviconUrl">,
  size: number,
) {
  const candidates = useMemo(
    () => buildBookmarkSiteIconCandidates(bookmark, size),
    [bookmark.domain, bookmark.faviconUrl, size],
  );
  const [candidateIndex, setCandidateIndex] = useState(candidates.length);
  const [validatedSiteIconSrc, setValidatedSiteIconSrc] = useState<string | null>(null);
  const minimumNaturalSize = Math.max(64, size);

  useEffect(() => {
    setValidatedSiteIconSrc(null);
    setCandidateIndex(0);
  }, [bookmark.id, bookmark.domain, bookmark.faviconUrl, size]);

  useEffect(() => {
    if (candidateIndex >= candidates.length) {
      setValidatedSiteIconSrc(null);
      return undefined;
    }

    const candidate = candidates[candidateIndex];
    let cancelled = false;
    const image = new Image();

    image.decoding = "async";
    image.onload = () => {
      if (cancelled) {
        return;
      }

      const naturalSize = Math.min(image.naturalWidth, image.naturalHeight);
      if (naturalSize > 0 && naturalSize < minimumNaturalSize) {
        setCandidateIndex((current) => (
          current === candidateIndex ? Math.min(current + 1, candidates.length) : current
        ));
        return;
      }

      setValidatedSiteIconSrc(candidate);
    };
    image.onerror = () => {
      if (!cancelled) {
        setCandidateIndex((current) => (
          current === candidateIndex ? Math.min(current + 1, candidates.length) : current
        ));
      }
    };
    image.src = candidate;

    return () => {
      cancelled = true;
    };
  }, [candidateIndex, candidates, minimumNaturalSize]);

  const advanceCandidate = (failedSrc?: string) => {
    if (failedSrc && failedSrc !== validatedSiteIconSrc) {
      return;
    }

    setValidatedSiteIconSrc(null);
    setCandidateIndex((current) => Math.min(current + 1, candidates.length));
  };

  return {
    siteIconSrc: validatedSiteIconSrc,
    useDefaultSiteIcon: !validatedSiteIconSrc,
    handleSiteIconError: () => advanceCandidate(),
    handleSiteIconLoad: (image: HTMLImageElement) => {
      const naturalSize = Math.min(image.naturalWidth, image.naturalHeight);
      if (naturalSize > 0 && naturalSize < minimumNaturalSize) {
        advanceCandidate(image.currentSrc || image.src);
      }
    },
  };
}
