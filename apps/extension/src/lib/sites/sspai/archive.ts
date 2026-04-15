import {
  buildSspaiArticleArchive,
  isSspaiPostPage,
} from "../legacy-reader";
import type { SiteReaderRule } from "../types";

export const sspaiReaderSiteRule: SiteReaderRule = {
  id: "sspai-live-fallback",
  match: isSspaiPostPage,
  buildReaderArchive(context) {
    if (!context.liveDocument) {
      return null;
    }
    return buildSspaiArticleArchive(context.liveDocument, context.currentUrl);
  },
};
