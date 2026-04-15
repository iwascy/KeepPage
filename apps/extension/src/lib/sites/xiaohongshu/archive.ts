import {
  buildXiaohongshuNoteArchive,
  isXiaohongshuNotePage,
} from "../legacy-reader";
import type { SiteReaderRule } from "../types";

export const xiaohongshuReaderSiteRule: SiteReaderRule = {
  id: "xiaohongshu-note",
  match: isXiaohongshuNotePage,
  buildReaderArchive(context) {
    return buildXiaohongshuNoteArchive({
      archivedDocument: context.archivedDocument,
      liveDocument: context.liveDocument,
      currentUrl: context.currentUrl,
    });
  },
};
