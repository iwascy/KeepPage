export type CoverImageVariant = {
  width: number;
  url: string;
};

const DEFAULT_COVER_WIDTHS = [400, 800, 1200] as const;
const DEFAULT_OSS_PROCESS_TEMPLATE = "image/resize,w_{width}/format,webp/quality,q_75";

export function buildCoverImageVariants(
  sourceUrl: string | undefined,
  widths: readonly number[] = DEFAULT_COVER_WIDTHS,
): CoverImageVariant[] {
  if (!sourceUrl) {
    return [];
  }

  return widths.map((width) => ({
    width,
    url: buildProcessedCoverImageUrl(sourceUrl, width),
  }));
}

export function buildCoverImageSrcSet(variants: readonly CoverImageVariant[]) {
  return variants.map((variant) => `${variant.url} ${variant.width}w`).join(", ");
}

export function getLargestCoverImageUrl(variants: readonly CoverImageVariant[], fallbackUrl: string) {
  return variants.at(-1)?.url ?? fallbackUrl;
}

export function getCoverImagePreconnectUrl() {
  const rawUrl = import.meta.env.VITE_COVER_IMAGE_ORIGIN?.trim();
  if (!rawUrl) {
    return null;
  }

  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

function buildProcessedCoverImageUrl(sourceUrl: string, width: number) {
  const processValue = resolveProcessTemplate(width);
  try {
    const url = new URL(sourceUrl);
    url.searchParams.set("x-oss-process", processValue);
    return url.toString();
  } catch {
    return sourceUrl;
  }
}

function resolveProcessTemplate(width: number) {
  const template = import.meta.env.VITE_COVER_IMAGE_PROCESS_TEMPLATE?.trim() || DEFAULT_OSS_PROCESS_TEMPLATE;
  return template.replaceAll("{width}", String(width));
}
