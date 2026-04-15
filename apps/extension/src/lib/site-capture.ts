import { archiveOptimizationSiteRules } from "./sites";

type SiteArchiveOptimizationOptions = {
  archiveHtml: string;
  sourceUrl: string;
};

type SiteArchiveOptimizationResult = {
  archiveHtml: string;
  optimized: boolean;
  rule?: string;
};

export function optimizeSiteArchiveHtml(
  options: SiteArchiveOptimizationOptions,
): SiteArchiveOptimizationResult {
  const archiveHtml = options.archiveHtml.trim();
  if (!archiveHtml) {
    return {
      archiveHtml: options.archiveHtml,
      optimized: false,
    };
  }

  let currentUrl: URL;
  try {
    currentUrl = new URL(options.sourceUrl);
  } catch {
    return {
      archiveHtml: options.archiveHtml,
      optimized: false,
    };
  }

  const document = new DOMParser().parseFromString(archiveHtml, "text/html");
  for (const rule of archiveOptimizationSiteRules) {
    if (!rule.match(currentUrl)) {
      continue;
    }

    const decision = rule.optimizeArchiveHtml({
      document,
      currentUrl,
    });
    if (!decision.optimized) {
      continue;
    }

    return {
      archiveHtml: serializeDocument(document),
      optimized: true,
      rule: decision.rule ?? rule.id,
    };
  }

  return {
    archiveHtml: options.archiveHtml,
    optimized: false,
  };
}

function serializeDocument(document: Document) {
  return `${serializeDoctype(document.doctype)}\n${document.documentElement.outerHTML}`;
}

function serializeDoctype(doctype: DocumentType | null) {
  if (!doctype) {
    return "<!DOCTYPE html>";
  }

  if (doctype.publicId) {
    const systemId = doctype.systemId ? ` "${doctype.systemId}"` : "";
    return `<!DOCTYPE ${doctype.name} PUBLIC "${doctype.publicId}"${systemId}>`;
  }
  if (doctype.systemId) {
    return `<!DOCTYPE ${doctype.name} SYSTEM "${doctype.systemId}">`;
  }
  return `<!DOCTYPE ${doctype.name}>`;
}
