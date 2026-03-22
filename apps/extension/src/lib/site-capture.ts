type SiteArchiveOptimizationOptions = {
  archiveHtml: string;
  sourceUrl: string;
};

type SiteArchiveOptimizationResult = {
  archiveHtml: string;
  optimized: boolean;
  rule?: string;
};

const X_HOST_PATTERN = /(^|\.)((x|twitter)\.com)$/i;
const X_UNWANTED_SECTION_PATTERNS = [
  /timeline:\s*(trending|what['’]s happening|who to follow|discover more|relevant people|relevant posts|live on x|topics to follow|communities to join)/i,
  /trends?\s+for\s+you/i,
  /what['’]s happening/i,
  /who to follow/i,
  /discover more/i,
  /relevant people/i,
  /relevant posts/i,
  /you might like/i,
  /subscribe to premium/i,
  /sign up to get more from x/i,
  /more posts/i,
  /热点/i,
  /趋势/i,
  /发现更多/i,
  /相关人物/i,
  /相关帖子/i,
  /关注谁/i,
  /你可能喜欢/i,
  /你可能感兴趣/i,
  /为你推荐/i,
  /推荐帖子/i,
  /推荐用户/i,
  /相关用户/i,
  /更多帖子/i,
  /正在发生/i,
  /热门话题/i,
  /社区推荐/i,
];

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

  if (!isETwitterHost(currentUrl)) {
    return {
      archiveHtml: options.archiveHtml,
      optimized: false,
    };
  }

  const document = new DOMParser().parseFromString(archiveHtml, "text/html");
  const optimized = optimizeETwitterArchive(document);
  if (!optimized) {
    return {
      archiveHtml: options.archiveHtml,
      optimized: false,
    };
  }

  return {
    archiveHtml: serializeDocument(document),
    optimized: true,
    rule: "x.com-focused-column",
  };
}

function optimizeETwitterArchive(document: Document) {
  let changed = false;

  const focusColumn = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]')
    ?? document.querySelector<HTMLElement>('main[role="main"]');

  if (!focusColumn) {
    return false;
  }

  changed = keepOnlyFocusBranch(document, focusColumn) || changed;
  changed = removeMatchingSelectors(document, [
    '[data-testid="sidebarColumn"]',
    '[data-testid="sheetDialog"]',
    '[data-testid="BottomBar"]',
    '[data-testid="DMDrawer"]',
    '[aria-modal="true"]',
    'div[role="dialog"]',
    'aside[role="complementary"]',
  ]) || changed;
  changed = removeUnwantedXSections(focusColumn) || changed;
  changed = markFocusPath(focusColumn) || changed;
  changed = ensureXFocusOverrideStyle(document) || changed;

  return changed;
}

function keepOnlyFocusBranch(document: Document, focusColumn: HTMLElement) {
  let changed = false;
  let current: Element | null = focusColumn;

  while (current?.parentElement) {
    const container: HTMLElement = current.parentElement;
    for (const sibling of [...container.children]) {
      if (sibling === current) {
        continue;
      }
      sibling.remove();
      changed = true;
    }
    if (container === document.body) {
      break;
    }
    current = container;
  }

  return changed;
}

function removeMatchingSelectors(root: ParentNode, selectors: string[]) {
  let changed = false;

  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      element.remove();
      changed = true;
    }
  }

  return changed;
}

function removeUnwantedXSections(focusColumn: HTMLElement) {
  let changed = false;
  const candidates = [
    ...focusColumn.querySelectorAll<HTMLElement>(
      '[aria-label], [role="region"], section, aside, [data-testid="cellInnerDiv"]',
    ),
  ];

  for (const candidate of candidates) {
    if (candidate === focusColumn || !candidate.isConnected) {
      continue;
    }

    const signalText = readCandidateSignalText(candidate);
    if (!matchesAnyPattern(signalText, X_UNWANTED_SECTION_PATTERNS)) {
      continue;
    }

    const removable = candidate.closest<HTMLElement>(
      '[aria-label^="Timeline:"], [role="region"], section, aside, [data-testid="cellInnerDiv"]',
    ) ?? candidate;

    if (removable === focusColumn || !removable.isConnected) {
      continue;
    }

    removable.remove();
    changed = true;
  }

  return changed;
}

function readCandidateSignalText(element: HTMLElement) {
  const parts = new Set<string>();
  const ariaLabel = normalizeText(element.getAttribute("aria-label"));
  if (ariaLabel) {
    parts.add(ariaLabel);
  }

  const headings = element.querySelectorAll<HTMLElement>("h1, h2, h3, h4, [role='heading']");
  for (const heading of [...headings].slice(0, 4)) {
    const text = normalizeText(heading.textContent);
    if (text) {
      parts.add(text);
    }
  }

  return [...parts].join(" | ");
}

function matchesAnyPattern(text: string, patterns: RegExp[]) {
  if (!text) {
    return false;
  }
  return patterns.some((pattern) => pattern.test(text));
}

function markFocusPath(focusColumn: HTMLElement) {
  let changed = false;
  let current: HTMLElement | null = focusColumn;

  while (current) {
    if (current.getAttribute("data-keeppage-x-focus-path") !== "true") {
      current.setAttribute("data-keeppage-x-focus-path", "true");
      changed = true;
    }
    current = current.parentElement;
  }

  return changed;
}

function ensureXFocusOverrideStyle(document: Document) {
  if (!document.head || !document.body) {
    return false;
  }
  if (document.getElementById("keeppage-x-archive-override")) {
    return false;
  }

  document.body.setAttribute("data-keeppage-site", "x");

  const style = document.createElement("style");
  style.id = "keeppage-x-archive-override";
  style.textContent = `
    body[data-keeppage-site="x"] {
      min-width: 0 !important;
      overflow-x: auto !important;
    }

    body[data-keeppage-site="x"] [data-keeppage-x-focus-path="true"] {
      min-width: 0 !important;
      max-width: none !important;
    }

    body[data-keeppage-site="x"] [data-testid="primaryColumn"],
    body[data-keeppage-site="x"] main[role="main"] {
      width: min(920px, 100%) !important;
      max-width: min(920px, 100%) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }
  `;
  document.head.append(style);
  return true;
}

function isETwitterHost(url: URL) {
  return X_HOST_PATTERN.test(url.hostname);
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

function normalizeText(text: string | null | undefined) {
  return (text ?? "").replaceAll(/\s+/g, " ").trim();
}
