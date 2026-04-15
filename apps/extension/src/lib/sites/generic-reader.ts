import {
  buildGenericReaderArchive,
  parseReadableArticle,
} from "./legacy-reader";
import type { SiteReaderRule } from "./types";

export const genericReaderSiteRule: SiteReaderRule = {
  id: "generic-reader",
  match: () => true,
  buildReaderArchive(context) {
    const article = parseReadableArticle(context.archivedDocument);
    if (!article) {
      return null;
    }
    return buildGenericReaderArchive(article, context.currentUrl);
  },
};
