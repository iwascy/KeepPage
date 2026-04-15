export type ReaderSiteBuildContext = {
  archivedDocument: Document;
  liveDocument?: Document | null;
  currentUrl: URL;
};

export type SiteArchiveOptimizationContext = {
  document: Document;
  currentUrl: URL;
};

export type SiteArchiveOptimizationDecision = {
  optimized: boolean;
  rule?: string;
};

export type SiteReaderRule = {
  id: string;
  match: (url: URL) => boolean;
  buildReaderArchive: (context: ReaderSiteBuildContext) => string | null;
};

export type SiteArchiveOptimizationRule = {
  id: string;
  match: (url: URL) => boolean;
  optimizeArchiveHtml: (context: SiteArchiveOptimizationContext) => SiteArchiveOptimizationDecision;
};
