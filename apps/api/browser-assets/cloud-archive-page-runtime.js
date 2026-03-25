(() => {
  const MIN_COVER_IMAGE_WIDTH = 240;
  const MIN_COVER_IMAGE_HEIGHT = 135;
  const MIN_COVER_IMAGE_AREA = 48_000;
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

  function collectPageCaptureArtifacts() {
    const currentUrl = safeUrl(location.href);
    const sourcePatch = collectSourcePatch();
    const liveSignals = collectLiveSignals();
    const archiveHtml = buildArchiveHtml(currentUrl);
    const readerHtml = extractReaderArchiveHtml({
      archiveHtml,
      sourceUrl: currentUrl.toString(),
      liveDocument: document,
    }) || undefined;

    return {
      title: normalizeText(document.title) || currentUrl.hostname || currentUrl.toString(),
      sourcePatch,
      liveSignals,
      archiveHtml,
      readerHtml,
    };
  }

  function collectSourcePatch() {
    return {
      canonicalUrl: readCanonicalUrl(),
      coverImageUrl: readCoverImageUrl(document.body ?? document.documentElement),
      referrer: document.referrer || undefined,
      captureScope: "page",
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      savedAt: new Date().toISOString(),
    };
  }

  function collectLiveSignals() {
    return {
      textLength: normalizeText(document.body?.innerText ?? "").length,
      imageCount: document.images.length,
      iframeCount: document.querySelectorAll("iframe").length,
      scrollHeight: Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
      ),
      renderHeight: window.innerHeight,
      hasCanvas: document.querySelector("canvas") !== null,
      hasVideo: document.querySelector("video") !== null,
      previewable: true,
      screenshotGenerated: false,
    };
  }

  function buildArchiveHtml(currentUrl) {
    const workingDocument = document.cloneNode(true);
    if (workingDocument && workingDocument.documentElement && isETwitterHost(currentUrl)) {
      optimizeETwitterArchive(workingDocument);
    }
    return serializeDocument(workingDocument && workingDocument.documentElement ? workingDocument : document);
  }

  function readCanonicalUrl() {
    const canonicalElement = document.querySelector('link[rel="canonical"]');
    return canonicalElement?.href || location.href;
  }

  function readCoverImageUrl(root) {
    const metaCover = readMetaCoverImageUrl();
    if (metaCover) {
      return metaCover;
    }

    const images = root instanceof HTMLElement
      ? [
          ...(root.matches("img") ? [root] : []),
          ...Array.from(root.querySelectorAll("img")),
        ]
      : Array.from(document.images);
    const firstMeaningfulImage = images.find((image) => isQualifiedCoverImage(image));
    return resolveCoverCandidateUrl(firstMeaningfulImage);
  }

  function readMetaCoverImageUrl() {
    const selectors = [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[property="twitter:image"]',
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const content = element?.getAttribute("content");
      const normalized = normalizeCoverImageUrl(content);
      if (normalized) {
        return normalized;
      }
    }
    return undefined;
  }

  function isQualifiedCoverImage(image) {
    const url = resolveCoverCandidateUrl(image);
    if (!url) {
      return false;
    }

    const width = image.naturalWidth || image.width || image.clientWidth;
    const height = image.naturalHeight || image.height || image.clientHeight;
    if (width < MIN_COVER_IMAGE_WIDTH || height < MIN_COVER_IMAGE_HEIGHT) {
      return false;
    }

    return width * height >= MIN_COVER_IMAGE_AREA;
  }

  function resolveCoverCandidateUrl(image) {
    if (!image) {
      return undefined;
    }

    const candidates = [
      image.currentSrc,
      image.src,
      image.getAttribute("src"),
      image.getAttribute("data-src"),
    ];
    for (const candidate of candidates) {
      const normalized = normalizeCoverImageUrl(candidate);
      if (normalized) {
        return normalized;
      }
    }
    return undefined;
  }

  function normalizeCoverImageUrl(rawUrl) {
    const value = rawUrl?.trim();
    if (!value) {
      return undefined;
    }

    try {
      const normalized = new URL(value, location.href);
      if (normalized.protocol !== "http:" && normalized.protocol !== "https:") {
        return undefined;
      }
      return normalized.href;
    } catch {
      return undefined;
    }
  }

  function extractReaderArchiveHtml(options) {
    const archiveHtml = options.archiveHtml.trim();
    if (!archiveHtml || typeof Readability !== "function") {
      return null;
    }

    let currentUrl;
    try {
      currentUrl = new URL(options.sourceUrl);
    } catch {
      return null;
    }

    const parsedDocument = new DOMParser().parseFromString(archiveHtml, "text/html");
    const readerArticle = parseReadableArticle(parsedDocument);
    if (!readerArticle) {
      return null;
    }

    return buildGenericReaderArchive(readerArticle, currentUrl);
  }

  function parseReadableArticle(documentRef) {
    const workingDocument = documentRef.cloneNode(true);
    sanitizeDocumentForReadability(workingDocument);

    const article = new Readability(workingDocument).parse();
    if (!article?.content) {
      return null;
    }

    const contentDocument = new DOMParser().parseFromString(article.content, "text/html");
    const textContent = normalizeText(contentDocument.body?.textContent);
    if (textContent.length < 200) {
      return null;
    }

    return {
      title: normalizeText(article.title) || "未命名文章",
      byline: normalizeText(article.byline),
      excerpt: normalizeText(article.excerpt),
      siteName: normalizeText(article.siteName),
      dir: normalizeText(article.dir),
      lang: normalizeText(article.lang),
      contentHtml: article.content,
      textContent,
    };
  }

  function sanitizeDocumentForReadability(documentRef) {
    for (const node of documentRef.querySelectorAll("script, noscript, template")) {
      node.remove();
    }
  }

  function buildGenericReaderArchive(article, currentUrl) {
    const lang = article.lang || "zh-CN";
    const textDirection = article.dir === "rtl" ? "rtl" : "ltr";
    const siteLabel = article.siteName || currentUrl.hostname;

    return `<!DOCTYPE html>
<html lang="${escapeHtmlAttribute(lang)}" dir="${escapeHtmlAttribute(textDirection)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base href="${escapeHtmlAttribute(currentUrl.toString())}" />
    <title>${escapeHtml(article.title)}</title>
    ${article.excerpt ? `<meta name="description" content="${escapeHtmlAttribute(article.excerpt)}" />` : ""}
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f3ee;
        --surface: rgba(255, 255, 255, 0.94);
        --text: #231d17;
        --muted: #6d665d;
        --border: rgba(110, 92, 66, 0.14);
        --accent: #0f5d78;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        background:
          radial-gradient(circle at top left, rgba(249, 214, 154, 0.28), transparent 34%),
          radial-gradient(circle at bottom right, rgba(160, 210, 235, 0.24), transparent 36%),
          var(--bg);
        color: var(--text);
      }
      body {
        padding: clamp(12px, 3vw, 28px);
        font-family: "Iowan Old Style", "Palatino Linotype", "Noto Serif SC", serif;
      }
      .reader-shell {
        max-width: 860px;
        margin: 0 auto;
        border: 1px solid var(--border);
        border-radius: 28px;
        background: var(--surface);
        box-shadow:
          0 30px 90px rgba(35, 29, 23, 0.08),
          inset 0 1px 0 rgba(255, 255, 255, 0.86);
        overflow: hidden;
      }
      .reader-header {
        padding: clamp(22px, 5vw, 44px) clamp(18px, 5vw, 46px) 0;
      }
      .reader-kicker {
        margin: 0 0 10px;
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      h1 {
        margin: 0;
        font-size: clamp(28px, 4.8vw, 48px);
        line-height: 1.12;
        letter-spacing: -0.03em;
      }
      .reader-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 14px;
        margin-top: 18px;
        color: var(--muted);
        font-size: 14px;
      }
      .reader-summary {
        margin: 18px 0 0;
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid var(--border);
        color: #463f36;
        background: rgba(255, 255, 255, 0.7);
        font-size: 15px;
        line-height: 1.75;
      }
      .reader-body {
        padding: 28px clamp(18px, 5vw, 46px) clamp(26px, 5vw, 48px);
        font-size: 17px;
        line-height: 1.9;
      }
      .reader-body > :first-child { margin-top: 0; }
      .reader-body > :last-child { margin-bottom: 0; }
      .reader-body a { color: var(--accent); }
      .reader-body img,
      .reader-body video {
        display: block;
        max-width: 100%;
        height: auto;
        border-radius: 18px;
      }
      .reader-body pre {
        overflow: auto;
        padding: 16px;
        border-radius: 16px;
        background: #1f2430;
        color: #f3f5f7;
      }
      @media (max-width: 640px) {
        body { padding: 10px; }
        .reader-shell { border-radius: 20px; }
        .reader-body {
          font-size: 16px;
          line-height: 1.82;
        }
      }
    </style>
  </head>
  <body>
    <main class="reader-shell">
      <header class="reader-header">
        <p class="reader-kicker">KeepPage Reading View</p>
        <h1>${escapeHtml(article.title)}</h1>
        <div class="reader-meta">
          ${article.byline ? `<span>${escapeHtml(article.byline)}</span>` : ""}
          <span>${escapeHtml(siteLabel)}</span>
          <span>${escapeHtml(currentUrl.hostname)}</span>
        </div>
        ${article.excerpt ? `<p class="reader-summary">${escapeHtml(article.excerpt)}</p>` : ""}
      </header>
      <article class="reader-body">
        ${article.contentHtml}
      </article>
    </main>
  </body>
</html>`;
  }

  function optimizeETwitterArchive(documentRef) {
    let changed = false;

    const focusColumn = documentRef.querySelector('[data-testid="primaryColumn"]')
      ?? documentRef.querySelector('main[role="main"]');

    if (!focusColumn) {
      return false;
    }

    changed = keepOnlyFocusBranch(documentRef, focusColumn) || changed;
    changed = removeMatchingSelectors(documentRef, [
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
    changed = ensureXFocusOverrideStyle(documentRef) || changed;

    return changed;
  }

  function keepOnlyFocusBranch(documentRef, focusColumn) {
    let changed = false;
    let current = focusColumn;

    while (current?.parentElement) {
      const container = current.parentElement;
      for (const sibling of [...container.children]) {
        if (sibling === current) {
          continue;
        }
        sibling.remove();
        changed = true;
      }
      if (container === documentRef.body) {
        break;
      }
      current = container;
    }

    return changed;
  }

  function removeMatchingSelectors(root, selectors) {
    let changed = false;

    for (const selector of selectors) {
      for (const element of root.querySelectorAll(selector)) {
        element.remove();
        changed = true;
      }
    }

    return changed;
  }

  function removeUnwantedXSections(focusColumn) {
    let changed = false;
    const candidates = [
      ...focusColumn.querySelectorAll(
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

      const removable = candidate.closest(
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

  function readCandidateSignalText(element) {
    const parts = new Set();
    const ariaLabel = normalizeText(element.getAttribute("aria-label"));
    if (ariaLabel) {
      parts.add(ariaLabel);
    }

    const headings = element.querySelectorAll("h1, h2, h3, h4, [role='heading']");
    for (const heading of [...headings].slice(0, 4)) {
      const text = normalizeText(heading.textContent);
      if (text) {
        parts.add(text);
      }
    }

    return [...parts].join(" | ");
  }

  function matchesAnyPattern(text, patterns) {
    if (!text) {
      return false;
    }
    return patterns.some((pattern) => pattern.test(text));
  }

  function markFocusPath(focusColumn) {
    let changed = false;
    let current = focusColumn;

    while (current) {
      if (current.getAttribute("data-keeppage-x-focus-path") !== "true") {
        current.setAttribute("data-keeppage-x-focus-path", "true");
        changed = true;
      }
      current = current.parentElement;
    }

    return changed;
  }

  function ensureXFocusOverrideStyle(documentRef) {
    if (!documentRef.head || !documentRef.body) {
      return false;
    }
    if (documentRef.getElementById("keeppage-x-archive-override")) {
      return false;
    }

    documentRef.body.setAttribute("data-keeppage-site", "x");

    const style = documentRef.createElement("style");
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
    documentRef.head.append(style);
    return true;
  }

  function isETwitterHost(url) {
    return X_HOST_PATTERN.test(url.hostname);
  }

  function serializeDocument(documentRef) {
    return `${serializeDoctype(documentRef.doctype)}\n${documentRef.documentElement.outerHTML}`;
  }

  function serializeDoctype(doctype) {
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

  function escapeHtml(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeHtmlAttribute(text) {
    return escapeHtml(text).replaceAll("`", "&#096;");
  }

  function normalizeText(text) {
    return String(text ?? "").replaceAll(/\s+/g, " ").trim();
  }

  function safeUrl(rawUrl) {
    try {
      return new URL(rawUrl);
    } catch {
      return new URL("https://invalid.local");
    }
  }

  globalThis.__KEEPPAGE_CLOUD_ARCHIVE__ = {
    collectPageCaptureArtifacts,
  };
})();
