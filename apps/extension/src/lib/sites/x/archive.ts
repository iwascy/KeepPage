import {
  buildXPostArchive,
  isXPostPage,
} from "../legacy-reader";
import type { SiteReaderRule } from "../types";

export const xReaderSiteRule: SiteReaderRule = {
  id: "x-post",
  match: isXPostPage,
  buildReaderArchive(context) {
    return buildXPostArchive({
      archivedDocument: context.archivedDocument,
      liveDocument: context.liveDocument,
      currentUrl: context.currentUrl,
    });
  },
};
