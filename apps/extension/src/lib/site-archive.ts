import { readerSiteRules } from "./sites";
import type { ReaderExtractionOptions } from "./sites/legacy-reader";

export function extractReaderArchiveHtml(options: ReaderExtractionOptions) {
  const archiveHtml = options.archiveHtml.trim();
  if (!archiveHtml) {
    return null;
  }

  let currentUrl: URL;
  try {
    currentUrl = new URL(options.sourceUrl);
  } catch {
    return null;
  }

  const archivedDocument = new DOMParser().parseFromString(archiveHtml, "text/html");
  for (const rule of readerSiteRules) {
    if (!rule.match(currentUrl)) {
      continue;
    }

    const built = rule.buildReaderArchive({
      archivedDocument,
      liveDocument: options.liveDocument,
      currentUrl,
    });
    if (built) {
      return built;
    }
  }

  return null;
}
