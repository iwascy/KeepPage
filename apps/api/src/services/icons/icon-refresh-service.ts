import type {
  BookmarkIcon,
  BookmarkIconCandidate,
  BookmarkIconRefreshRequest,
  BookmarkIconRefreshResponse,
  BookmarkIconSourceType,
} from "@keeppage/domain";
import type { BookmarkRepository } from "../../repositories";

type IconRefreshServiceOptions = {
  repository: BookmarkRepository;
};

type ResolvedIconCandidate = BookmarkIconCandidate & {
  hostname: string;
};

const FETCH_TIMEOUT_MS = 6_000;
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;

export class IconRefreshService {
  private readonly repository: BookmarkRepository;

  constructor(options: IconRefreshServiceOptions) {
    this.repository = options.repository;
  }

  async refreshForCapture(input: {
    userId: string;
    domain: string;
    sourceUrl: string;
    candidates?: BookmarkIconCandidate[];
  }): Promise<BookmarkIcon | null> {
    const hostname = normalizeHostname(input.domain || input.sourceUrl);
    if (!hostname) {
      return null;
    }
    return this.refreshHostname({
      hostname,
      sourceUrl: input.sourceUrl,
      candidates: input.candidates ?? [],
    });
  }

  async refreshOne(userId: string, input: BookmarkIconRefreshRequest): Promise<BookmarkIconRefreshResponse> {
    const target = input.bookmarkId
      ? await this.repository.getBookmarkIconRefreshTarget(userId, input.bookmarkId)
      : null;
    const hostname = normalizeHostname(input.domain ?? input.sourceUrl ?? target?.hostname ?? "");
    const sourceUrl = input.sourceUrl ?? target?.sourceUrl ?? (hostname ? `https://${hostname}/` : undefined);
    const candidates = [
      ...(input.candidates ?? []),
      ...(target?.candidates ?? []),
    ];
    if (!hostname || !sourceUrl) {
      return { refreshed: 0, skipped: 1, icons: [] };
    }
    const icon = await this.refreshHostname({ hostname, sourceUrl, candidates });
    return {
      refreshed: icon ? 1 : 0,
      skipped: icon ? 0 : 1,
      icons: icon ? [icon] : [],
    };
  }

  async refreshAll(userId: string): Promise<BookmarkIconRefreshResponse> {
    const targets = await this.repository.listBookmarkIconRefreshTargets(userId);
    const icons: BookmarkIcon[] = [];
    let skipped = 0;
    for (const target of targets) {
      const icon = await this.refreshHostname(target);
      if (icon) {
        icons.push(icon);
      } else {
        skipped += 1;
      }
    }
    return {
      refreshed: icons.length,
      skipped,
      icons,
    };
  }

  private async refreshHostname(target: {
    hostname: string;
    sourceUrl?: string;
    candidates: BookmarkIconCandidate[];
  }) {
    const hostname = normalizeHostname(target.hostname || target.sourceUrl || "");
    if (!hostname || isUnsafeHostname(hostname)) {
      return null;
    }
    const candidates = await expandManifestCandidates(buildCandidateList({
      hostname,
      sourceUrl: target.sourceUrl,
      candidates: target.candidates,
    }));

    for (const candidate of candidates) {
      const inspected = await inspectIconCandidate(candidate);
      if (!inspected) {
        continue;
      }
      return this.repository.upsertBookmarkIcon({
        hostname,
        iconUrl: inspected.url,
        sourceUrl: inspected.sourceUrl,
        sourceType: inspected.sourceType,
        width: inspected.width,
        height: inspected.height,
        format: inspected.format,
      });
    }

    return null;
  }
}

function buildCandidateList(input: {
  hostname: string;
  sourceUrl?: string;
  candidates: BookmarkIconCandidate[];
}): ResolvedIconCandidate[] {
  const pageUrl = input.sourceUrl ?? `https://${input.hostname}/`;
  const defaults: BookmarkIconCandidate[] = [
    { url: `https://${input.hostname}/favicon.svg`, source: "default-path", type: "image/svg+xml" },
    { url: `https://${input.hostname}/apple-touch-icon.png`, source: "apple-touch-icon", type: "image/png" },
    { url: `https://${input.hostname}/favicon.ico`, source: "favicon-ico", type: "image/x-icon" },
    { url: `https://${input.hostname}/site.webmanifest`, source: "manifest", type: "application/manifest+json" },
    { url: `https://${input.hostname}/manifest.json`, source: "manifest", type: "application/json" },
    { url: `https://favicon.im/${input.hostname}?larger=true`, source: "favicon-api" },
    { url: `https://icon.horse/icon/${input.hostname}`, source: "favicon-api" },
    { url: `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(input.hostname)}&sz=256`, source: "google-s2" },
  ];
  return dedupeIconCandidates([...input.candidates, ...defaults])
    .map((candidate) => {
      try {
        return {
          ...candidate,
          url: new URL(candidate.url, pageUrl).toString(),
          hostname: input.hostname,
        };
      } catch {
        return null;
      }
    })
    .filter((candidate): candidate is ResolvedIconCandidate => Boolean(candidate))
    .sort((left, right) => scoreCandidate(right) - scoreCandidate(left));
}

async function expandManifestCandidates(candidates: ResolvedIconCandidate[]) {
  const expanded: ResolvedIconCandidate[] = [];
  for (const candidate of candidates) {
    if (!isManifestDocumentCandidate(candidate)) {
      expanded.push(candidate);
      continue;
    }
    expanded.push(...await fetchManifestIconCandidates(candidate));
  }
  return dedupeResolvedIconCandidates(expanded).sort((left, right) => scoreCandidate(right) - scoreCandidate(left));
}

function isManifestDocumentCandidate(candidate: BookmarkIconCandidate) {
  const type = candidate.type?.toLowerCase() ?? "";
  const url = candidate.url.toLowerCase();
  return candidate.source === "manifest"
    && (
      type.includes("manifest")
      || type.includes("json")
      || url.endsWith(".webmanifest")
      || url.endsWith("/manifest.json")
      || url.endsWith("/site.webmanifest")
    );
}

async function fetchManifestIconCandidates(candidate: ResolvedIconCandidate): Promise<ResolvedIconCandidate[]> {
  if (!isSafeHttpUrl(candidate.url)) {
    return [];
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(candidate.url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/manifest+json,application/json,text/plain;q=0.8,*/*;q=0.5",
        "user-agent": "KeepPageIconBot/0.1",
      },
    });
    if (!response.ok || !isSafeHttpUrl(response.url || candidate.url)) {
      return [];
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_MANIFEST_BYTES) {
      return [];
    }
    const text = await response.text();
    if (!text || text.length > MAX_MANIFEST_BYTES) {
      return [];
    }
    const manifest = JSON.parse(text) as { icons?: Array<Partial<BookmarkIconCandidate> & { src?: string }> };
    const iconCandidates: Array<ResolvedIconCandidate | null> = (manifest.icons ?? [])
      .filter((icon) => typeof icon.src === "string" && icon.src.trim())
      .slice(0, 32)
      .map((icon) => {
        try {
          return {
            url: new URL(icon.src!, response.url || candidate.url).toString(),
            source: "manifest" as const,
            sizes: icon.sizes,
            type: icon.type,
            width: icon.width,
            height: icon.height,
            hostname: candidate.hostname,
          };
        } catch {
          return null;
        }
      });
    return iconCandidates.filter((icon): icon is ResolvedIconCandidate => Boolean(icon));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectIconCandidate(candidate: ResolvedIconCandidate) {
  if (!isSafeHttpUrl(candidate.url)) {
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(candidate.url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "image/avif,image/webp,image/svg+xml,image/png,image/jpeg,image/x-icon,*/*;q=0.8",
        "user-agent": "KeepPageIconBot/0.1",
      },
    });
    if (!response.ok) {
      return null;
    }
    const finalUrl = response.url || candidate.url;
    if (!isSafeHttpUrl(finalUrl)) {
      return null;
    }
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_ICON_BYTES) {
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ICON_BYTES) {
      return null;
    }
    const detected = detectImage(bytes, contentType, candidate);
    if (!detected) {
      return null;
    }
    return {
      url: finalUrl,
      sourceUrl: candidate.url,
      sourceType: candidate.source,
      ...detected,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function detectImage(bytes: Uint8Array, contentType: string | undefined, candidate: BookmarkIconCandidate) {
  const declaredSize = parseDeclaredSize(candidate.sizes) ?? parseDeclaredDimensions(candidate);
  if (contentType?.includes("svg") || looksLikeSvg(bytes) || candidate.type?.includes("svg")) {
    return {
      format: "svg",
      width: declaredSize?.width,
      height: declaredSize?.height,
    };
  }
  const png = readPngSize(bytes);
  if (png) {
    return { format: "png", ...png };
  }
  const ico = readIcoSize(bytes);
  if (ico) {
    return { format: "ico", ...ico };
  }
  const jpeg = readJpegSize(bytes);
  if (jpeg) {
    return { format: "jpeg", ...jpeg };
  }
  const webp = readWebpSize(bytes);
  if (webp) {
    return { format: "webp", ...webp };
  }
  return null;
}

function scoreCandidate(candidate: BookmarkIconCandidate) {
  let score = 0;
  if (candidate.type?.includes("svg") || candidate.url.toLowerCase().endsWith(".svg")) {
    score += 1_000;
  }
  const size = parseDeclaredSize(candidate.sizes) ?? parseDeclaredDimensions(candidate);
  if (size) {
    score += Math.min(size.width, size.height);
    if (size.width === size.height) {
      score += 80;
    }
  }
  const sourceScore: Record<BookmarkIconSourceType, number> = {
    "simple-icons": 900,
    iconify: 850,
    manifest: 760,
    "apple-touch-icon": 720,
    "rel-icon": 680,
    "favicon-ico": 460,
    "default-path": 440,
    "favicon-api": 360,
    "google-s2": 320,
    manual: 800,
    unknown: 0,
  };
  return score + sourceScore[candidate.source];
}

function parseDeclaredSize(value?: string) {
  const first = value?.split(/\s+/).find((part) => /^\d+x\d+$/i.test(part));
  if (!first) {
    return undefined;
  }
  const [width, height] = first.toLowerCase().split("x").map(Number);
  return width && height ? { width, height } : undefined;
}

function parseDeclaredDimensions(candidate: BookmarkIconCandidate) {
  return candidate.width && candidate.height
    ? { width: candidate.width, height: candidate.height }
    : undefined;
}

function readPngSize(bytes: Uint8Array) {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    return null;
  }
  return {
    width: readUInt32BE(bytes, 16),
    height: readUInt32BE(bytes, 20),
  };
}

function readIcoSize(bytes: Uint8Array) {
  if (bytes.length < 22 || bytes[0] !== 0 || bytes[1] !== 0 || bytes[2] !== 1 || bytes[3] !== 0) {
    return null;
  }
  let best = { width: 0, height: 0 };
  const count = bytes[4] | (bytes[5] << 8);
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    if (offset + 1 >= bytes.length) {
      break;
    }
    const width = bytes[offset] || 256;
    const height = bytes[offset + 1] || 256;
    if (width * height > best.width * best.height) {
      best = { width, height };
    }
  }
  return best.width ? best : null;
}

function readJpegSize(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      break;
    }
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: (bytes[offset + 5] << 8) + bytes[offset + 6],
        width: (bytes[offset + 7] << 8) + bytes[offset + 8],
      };
    }
    offset += 2 + length;
  }
  return null;
}

function readWebpSize(bytes: Uint8Array) {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WEBP") {
    return null;
  }
  if (ascii(bytes, 12, 16) === "VP8X") {
    return {
      width: 1 + readUInt24LE(bytes, 24),
      height: 1 + readUInt24LE(bytes, 27),
    };
  }
  return null;
}

function looksLikeSvg(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes.slice(0, 512)).toLowerCase().includes("<svg");
}

function isSafeHttpUrl(input: string) {
  try {
    const url = new URL(input);
    return ["http:", "https:"].includes(url.protocol) && !isUnsafeHostname(url.hostname);
  } catch {
    return false;
  }
}

function isUnsafeHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "0.0.0.0"
    || normalized.startsWith("127.")
    || normalized.startsWith("10.")
    || normalized.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
    || normalized.startsWith("169.254.")
    || normalized === "::1"
    || normalized.startsWith("[::1]");
}

function normalizeHostname(input: string) {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^www\./, "");
  }
}

function dedupeIconCandidates(candidates: BookmarkIconCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.url.trim();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeResolvedIconCandidates(candidates: ResolvedIconCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.url.trim();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function readUInt32BE(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function readUInt24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}
