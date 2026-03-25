import { Readability } from "@mozilla/readability";

type ReaderExtractionOptions = {
  archiveHtml: string;
  sourceUrl: string;
  liveDocument?: Document | null;
};

type ReaderArticle = {
  title: string;
  byline?: string;
  excerpt?: string;
  siteName?: string;
  dir?: string;
  lang?: string;
  contentHtml: string;
  textContent: string;
};

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

  const parsedDocument = new DOMParser().parseFromString(archiveHtml, "text/html");

  if (isXiaohongshuNotePage(currentUrl)) {
    const xiaohongshuArchive = buildXiaohongshuNoteArchive({
      archivedDocument: parsedDocument,
      liveDocument: options.liveDocument,
      currentUrl,
    });
    if (xiaohongshuArchive) {
      return xiaohongshuArchive;
    }
  }

  const readerArticle = parseReadableArticle(parsedDocument);
  if (readerArticle) {
    return buildGenericReaderArchive(readerArticle, currentUrl);
  }

  if (options.liveDocument && isSspaiPostPage(currentUrl)) {
    return buildSspaiArticleArchive(options.liveDocument, currentUrl);
  }

  return null;
}

function parseReadableArticle(document: Document): ReaderArticle | null {
  const workingDocument = document.cloneNode(true) as Document;
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

function sanitizeDocumentForReadability(document: Document) {
  for (const node of document.querySelectorAll("script, noscript, template")) {
    node.remove();
  }
}

function buildGenericReaderArchive(article: ReaderArticle, currentUrl: URL) {
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
        --surface: rgba(255, 255, 255, 0.92);
        --surface-soft: #f2ede4;
        --text: #231d17;
        --muted: #6d665d;
        --border: rgba(110, 92, 66, 0.14);
        --accent: #0f5d78;
        --quote: rgba(15, 93, 120, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
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

      .reader-meta span {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .reader-meta span::before {
        content: "";
        width: 5px;
        height: 5px;
        border-radius: 999px;
        background: rgba(109, 102, 93, 0.55);
      }

      .reader-summary {
        margin: 18px 0 0;
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid var(--border);
        background: var(--surface-soft);
        color: #463f36;
        font-size: 15px;
        line-height: 1.75;
      }

      .reader-body {
        padding: 28px clamp(18px, 5vw, 46px) clamp(26px, 5vw, 48px);
        font-size: 17px;
        line-height: 1.9;
      }

      .reader-body > :first-child {
        margin-top: 0;
      }

      .reader-body > :last-child {
        margin-bottom: 0;
      }

      .reader-body p,
      .reader-body ul,
      .reader-body ol,
      .reader-body blockquote,
      .reader-body pre,
      .reader-body figure,
      .reader-body table,
      .reader-body hr {
        margin: 1.2em 0;
      }

      .reader-body h2,
      .reader-body h3,
      .reader-body h4 {
        margin: 2.1em 0 0.8em;
        line-height: 1.28;
      }

      .reader-body h2 {
        font-size: 1.56em;
      }

      .reader-body h3 {
        font-size: 1.3em;
      }

      .reader-body a {
        color: var(--accent);
      }

      .reader-body img,
      .reader-body video {
        display: block;
        width: auto;
        max-width: 100%;
        height: auto;
        border-radius: 18px;
        background: rgba(35, 29, 23, 0.04);
      }

      .reader-body figure {
        margin-left: 0;
        margin-right: 0;
      }

      .reader-body figure img {
        width: 100%;
      }

      .reader-body figcaption {
        margin-top: 10px;
        color: var(--muted);
        font-size: 13px;
        text-align: center;
      }

      .reader-body blockquote {
        padding: 14px 18px;
        border-left: 3px solid rgba(15, 93, 120, 0.35);
        background: var(--quote);
        border-radius: 0 16px 16px 0;
        color: #494138;
      }

      .reader-body pre {
        overflow: auto;
        padding: 16px;
        border-radius: 16px;
        background: #1f2430;
        color: #f3f5f7;
        font-size: 14px;
        line-height: 1.7;
      }

      .reader-body code {
        font-family: "SFMono-Regular", "Cascadia Code", "JetBrains Mono", monospace;
      }

      .reader-body :not(pre) > code {
        padding: 0.16em 0.38em;
        border-radius: 6px;
        background: rgba(15, 93, 120, 0.08);
        color: #17485b;
        font-size: 0.92em;
      }

      .reader-body table {
        width: 100%;
        border-collapse: collapse;
        overflow: hidden;
        border-radius: 16px;
        border-style: hidden;
        box-shadow: 0 0 0 1px var(--border);
      }

      .reader-body th,
      .reader-body td {
        padding: 10px 12px;
        border: 1px solid var(--border);
        text-align: left;
        vertical-align: top;
      }

      .reader-body hr {
        border: 0;
        border-top: 1px solid var(--border);
      }

      @media (max-width: 640px) {
        body {
          padding: 10px;
        }

        .reader-shell {
          border-radius: 20px;
        }

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

type XiaohongshuMediaItem = {
  src: string;
  alt: string;
  aspectRatio: string;
};

type XiaohongshuStateImage = {
  src: string;
  width?: number;
  height?: number;
};

function isXiaohongshuNotePage(url: URL) {
  const hostname = url.hostname.replace(/^www\./i, "");
  return hostname === "xiaohongshu.com" && /^\/explore\/[a-z0-9]+\/?$/i.test(url.pathname);
}

function buildXiaohongshuNoteArchive(input: {
  archivedDocument: Document;
  liveDocument?: Document | null;
  currentUrl: URL;
}) {
  const { archivedDocument, liveDocument, currentUrl } = input;
  const title = normalizeText(
    readXiaohongshuText(
      archivedDocument,
      liveDocument,
      "#detail-title",
    )
      ?? readXiaohongshuMetaContent(
        archivedDocument,
        liveDocument,
        'meta[property="og:title"]',
      )
      ?? stripXiaohongshuTitleSuffix(archivedDocument.title || liveDocument?.title || ""),
  );
  const descriptionSource = readXiaohongshuElement(
    archivedDocument,
    liveDocument,
    "#detail-desc",
  );
  if (!title || !descriptionSource) {
    return null;
  }

  const body = descriptionSource.cloneNode(true) as HTMLElement;
  sanitizeXiaohongshuBody(body, currentUrl);
  const bodyText = normalizeText(body.textContent);
  const mediaItems = collectXiaohongshuMediaItems({
    archivedDocument,
    liveDocument,
    currentUrl,
    title,
  });
  if (bodyText.length < 40 && mediaItems.length === 0) {
    return null;
  }

  const author = normalizeText(
    readXiaohongshuText(
      archivedDocument,
      liveDocument,
      ".author-container .username, .author-wrapper .username",
    ),
  );
  const avatarUrl = readImageUrl(
    readXiaohongshuElement<HTMLImageElement>(
      archivedDocument,
      liveDocument,
      ".author-container img.avatar-item, .author-wrapper img.avatar-item",
    ),
    currentUrl,
  );
  const publishedMeta = normalizeText(
    readXiaohongshuText(
      archivedDocument,
      liveDocument,
      ".bottom-container .date, .note-content .date",
    ),
  );

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base href="${escapeHtmlAttribute(currentUrl.toString())}" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f1ee;
        --surface: rgba(255, 255, 255, 0.92);
        --surface-strong: #fffaf7;
        --border: rgba(37, 20, 17, 0.08);
        --text: #221b19;
        --muted: #766761;
        --accent: #e34f6f;
        --accent-soft: rgba(227, 79, 111, 0.12);
        --shadow: 0 28px 70px rgba(37, 20, 17, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        background:
          radial-gradient(circle at top left, rgba(255, 215, 218, 0.58), transparent 28%),
          radial-gradient(circle at bottom right, rgba(255, 240, 221, 0.72), transparent 34%),
          var(--bg);
        color: var(--text);
      }

      body {
        padding: clamp(12px, 2.4vw, 28px);
        font-family: "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif;
      }

      .note-shell {
        max-width: 920px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }

      .media-panel,
      .content-panel {
        border: 1px solid var(--border);
        border-radius: 30px;
        background: var(--surface);
        box-shadow: var(--shadow);
        overflow: hidden;
      }

      .media-panel {
        padding: clamp(16px, 2vw, 22px);
      }

      .media-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 14px;
      }

      .media-kicker {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .media-count {
        padding: 8px 12px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
      }

      .media-track {
        display: grid;
        grid-template-columns: 1fr;
        gap: 14px;
      }

      .media-card {
        border-radius: 24px;
        overflow: hidden;
        background: #efe7df;
        border: 1px solid rgba(34, 27, 25, 0.08);
      }

      .media-card img {
        display: block;
        width: 100%;
        height: auto;
        aspect-ratio: var(--aspect-ratio, 4 / 5);
        object-fit: cover;
      }

      .content-panel {
        padding: clamp(22px, 3vw, 30px);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(255, 250, 247, 0.94));
      }

      .author-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 18px;
      }

      .author-avatar {
        width: 48px;
        height: 48px;
        border-radius: 999px;
        flex: 0 0 auto;
        object-fit: cover;
        background: rgba(34, 27, 25, 0.08);
      }

      .author-meta {
        min-width: 0;
      }

      .author-name {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
      }

      .author-subtitle {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 13px;
      }

      h1 {
        margin: 0;
        font-size: clamp(28px, 4vw, 40px);
        line-height: 1.14;
        letter-spacing: -0.03em;
      }

      .meta-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 10px;
        margin-top: 16px;
      }

      .meta-pill {
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid rgba(34, 27, 25, 0.08);
        background: var(--surface-strong);
        color: var(--muted);
        font-size: 12px;
      }

      .note-body {
        margin-top: 24px;
        font-size: 16px;
        line-height: 1.95;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .note-body > :first-child {
        margin-top: 0;
      }

      .note-body > :last-child {
        margin-bottom: 0;
      }

      .note-body a {
        color: var(--accent);
        text-decoration: none;
        font-weight: 600;
      }

      .source-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-top: 22px;
        padding: 12px 16px;
        border-radius: 14px;
        background: #221b19;
        color: #fff;
        text-decoration: none;
        font-size: 14px;
        font-weight: 700;
      }

      @media (max-width: 900px) {
        .note-shell {
          gap: 14px;
        }
      }
    </style>
  </head>
  <body>
    <main class="note-shell">
      <section class="media-panel">
        <div class="media-header">
          <p class="media-kicker">KeepPage XiaoHongShu View</p>
          ${mediaItems.length > 0 ? `<span class="media-count">${mediaItems.length} 张图</span>` : ""}
        </div>
        ${
          mediaItems.length > 0
            ? `<div class="media-track">${mediaItems.map((item) => `
              <figure class="media-card" style="--aspect-ratio: ${escapeHtmlAttribute(item.aspectRatio)};">
                <img src="${escapeHtmlAttribute(item.src)}" alt="${escapeHtmlAttribute(item.alt)}" loading="lazy" />
              </figure>
            `).join("")}</div>`
            : `<div class="media-track"><div class="media-card"><div style="padding: 28px; color: #766761;">这条笔记没有可直接归档的图片。</div></div></div>`
        }
      </section>
      <article class="content-panel">
        <div class="author-row">
          ${avatarUrl ? `<img class="author-avatar" src="${escapeHtmlAttribute(avatarUrl)}" alt="${escapeHtmlAttribute(author || "作者头像")}" />` : ""}
          <div class="author-meta">
            <p class="author-name">${escapeHtml(author || "小红书作者")}</p>
            <p class="author-subtitle">小红书笔记归档</p>
          </div>
        </div>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta-row">
          ${publishedMeta ? `<span class="meta-pill">${escapeHtml(publishedMeta)}</span>` : ""}
          <span class="meta-pill">${escapeHtml(currentUrl.hostname)}</span>
        </div>
        <div class="note-body">${body.innerHTML}</div>
        <a class="source-link" href="${escapeHtmlAttribute(currentUrl.toString())}" target="_blank" rel="noreferrer noopener">打开原始笔记</a>
      </article>
    </main>
  </body>
</html>`;
}

function sanitizeXiaohongshuBody(root: HTMLElement, currentUrl: URL) {
  for (const removable of root.querySelectorAll("button")) {
    removable.remove();
  }

  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    if (!(element instanceof HTMLAnchorElement)) {
      element.removeAttribute("class");
    }
    element.removeAttribute("style");

    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-") || attribute.name.startsWith("aria-")) {
        element.removeAttribute(attribute.name);
      }
    }

    if (element instanceof HTMLAnchorElement) {
      const resolvedHref = resolveUrl(element.getAttribute("href"), currentUrl);
      if (resolvedHref) {
        element.setAttribute("href", resolvedHref);
      }
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noreferrer noopener");
      element.setAttribute("class", "note-tag");
    }
  }
}

function collectXiaohongshuMediaItems(input: {
  archivedDocument: Document;
  liveDocument?: Document | null;
  currentUrl: URL;
  title: string;
}) {
  const { archivedDocument, liveDocument, currentUrl, title } = input;
  const stateImages = dedupeXiaohongshuStateImages([
    ...readXiaohongshuStateImages(archivedDocument, currentUrl),
    ...(liveDocument ? readXiaohongshuStateImages(liveDocument, currentUrl) : []),
  ]);
  const archivedMediaImages = queryXiaohongshuMediaImages(archivedDocument);
  const liveMediaImages = liveDocument ? queryXiaohongshuMediaImages(liveDocument) : [];
  const seen = new Set<string>();
  const items: XiaohongshuMediaItem[] = [];

  for (const stateImage of stateImages) {
    const key = normalizeXiaohongshuMediaKey(stateImage.src, currentUrl);
    if (!key || seen.has(key)) {
      continue;
    }

    const matchingLiveImage = [...liveMediaImages, ...archivedMediaImages].find((image) => {
      const imageKey = normalizeXiaohongshuMediaKey(readImageCandidateUrl(image), currentUrl);
      return imageKey === key;
    });

    const src = readReaderImageSource(matchingLiveImage, currentUrl) || stateImage.src;
    if (!src) {
      continue;
    }

    seen.add(key);
    const width = stateImage.width
      ?? matchingLiveImage?.naturalWidth
      ?? matchingLiveImage?.width
      ?? 4;
    const height = stateImage.height
      ?? matchingLiveImage?.naturalHeight
      ?? matchingLiveImage?.height
      ?? 5;
    items.push({
      src,
      alt: `${title} - 第 ${items.length + 1} 张图`,
      aspectRatio: `${width} / ${height}`,
    });
  }

  if (items.length > 0) {
    return items;
  }

  const candidates = [
    ...archivedMediaImages,
    ...liveMediaImages,
  ];
  for (const image of candidates) {
    const key = normalizeXiaohongshuMediaKey(readImageCandidateUrl(image), currentUrl);
    if (key && seen.has(key)) {
      continue;
    }
    const src = readReaderImageSource(image, currentUrl);
    if (!src) {
      continue;
    }

    if (key) {
      seen.add(key);
    }
    const width = image.naturalWidth || Number(image.getAttribute("width")) || 4;
    const height = image.naturalHeight || Number(image.getAttribute("height")) || 5;
    const aspectRatio = `${width} / ${height}`;
    items.push({
      src,
      alt: `${title} - 第 ${items.length + 1} 张图`,
      aspectRatio,
    });
  }

  return items;
}

function queryXiaohongshuMediaImages(doc: Document) {
  return [
    ...doc.querySelectorAll<HTMLImageElement>(".note-slider .swiper-slide img"),
    ...doc.querySelectorAll<HTMLImageElement>(".media-container .img-container img"),
  ];
}

function readImageCandidateUrl(image: HTMLImageElement | null | undefined) {
  if (!image) {
    return "";
  }

  return image.currentSrc
    || image.getAttribute("src")
    || image.getAttribute("data-src")
    || image.getAttribute("data-original")
    || "";
}

function readReaderImageSource(image: HTMLImageElement | null | undefined, currentUrl: URL) {
  if (!image) {
    return "";
  }

  const canvasDataUrl = convertImageToDataUrl(image);
  if (canvasDataUrl) {
    return canvasDataUrl;
  }

  return resolveUrl(readImageCandidateUrl(image), currentUrl);
}

function convertImageToDataUrl(image: HTMLImageElement) {
  const width = image.naturalWidth || image.width || image.clientWidth;
  const height = image.naturalHeight || image.height || image.clientHeight;
  if (width <= 0 || height <= 0) {
    return "";
  }

  try {
    const canvas = image.ownerDocument.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return "";
    }
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

function normalizeXiaohongshuMediaKey(rawUrl: string | null | undefined, currentUrl: URL) {
  const resolved = resolveUrl(rawUrl, currentUrl);
  if (!resolved) {
    return "";
  }

  try {
    const normalized = new URL(resolved);
    if (normalized.protocol === "http:") {
      normalized.protocol = "https:";
    }
    normalized.hash = "";
    return normalized.toString();
  } catch {
    return resolved.replace(/^http:\/\//iu, "https://");
  }
}

function dedupeXiaohongshuStateImages(images: XiaohongshuStateImage[]) {
  const seen = new Set<string>();
  return images.filter((image) => {
    if (!image.src || seen.has(image.src)) {
      return false;
    }
    seen.add(image.src);
    return true;
  });
}

function readXiaohongshuStateImages(doc: Document, currentUrl: URL) {
  const state = parseXiaohongshuInitialState(doc);
  const note = readXiaohongshuNoteRecord(state);
  const imageList = Array.isArray(note?.imageList) ? note.imageList : [];
  const images: XiaohongshuStateImage[] = [];

  for (const item of imageList) {
    const record = isRecord(item) ? item : null;
    if (!record) {
      continue;
    }

    const src = normalizeXiaohongshuMediaKey(
      readXiaohongshuStateImageUrl(record),
      currentUrl,
    );
    if (!src) {
      continue;
    }

    images.push({
      src,
      width: typeof record.width === "number" ? record.width : undefined,
      height: typeof record.height === "number" ? record.height : undefined,
    });
  }

  return images;
}

function readXiaohongshuStateImageUrl(record: Record<string, unknown>) {
  const infoList = Array.isArray(record.infoList) ? record.infoList : [];
  const preferredInfo = infoList.find((entry) => {
    if (!isRecord(entry)) {
      return false;
    }
    return entry.imageScene === "WB_DFT" && typeof entry.url === "string";
  });
  if (isRecord(preferredInfo) && typeof preferredInfo.url === "string") {
    return preferredInfo.url;
  }

  const fallbackInfo = infoList.find((entry) => isRecord(entry) && typeof entry.url === "string");
  if (isRecord(fallbackInfo) && typeof fallbackInfo.url === "string") {
    return fallbackInfo.url;
  }

  const directCandidates = [record.urlDefault, record.urlPre, record.url];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return "";
}

function parseXiaohongshuInitialState(doc: Document) {
  const script = Array.from(doc.querySelectorAll("script"))
    .map((node) => node.textContent ?? "")
    .find((text) => text.includes("window.__INITIAL_STATE__="));

  if (!script) {
    return null;
  }

  const jsonText = extractAssignedJsonText(script, "window.__INITIAL_STATE__=");
  if (!jsonText) {
    return null;
  }

  return safeJsonParse(jsonText);
}

function extractAssignedJsonText(scriptText: string, assignmentPrefix: string) {
  const startIndex = scriptText.indexOf(assignmentPrefix);
  if (startIndex < 0) {
    return "";
  }

  const objectStart = scriptText.indexOf("{", startIndex + assignmentPrefix.length);
  if (objectStart < 0) {
    return "";
  }

  let depth = 0;
  let quote: "\"" | "'" | "" = "";
  let escaped = false;

  for (let index = objectStart; index < scriptText.length; index += 1) {
    const char = scriptText[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return scriptText.slice(objectStart, index + 1);
      }
    }
  }

  return "";
}

function readXiaohongshuNoteRecord(state: unknown) {
  if (!isRecord(state) || !isRecord(state.note)) {
    return null;
  }

  const noteState = state.note;
  const noteDetailMap = isRecord(noteState.noteDetailMap) ? noteState.noteDetailMap : null;
  const currentNoteId = typeof noteState.currentNoteId === "string"
    ? noteState.currentNoteId
    : typeof noteState.firstNoteId === "string"
      ? noteState.firstNoteId
      : noteDetailMap
        ? Object.keys(noteDetailMap)[0]
        : "";

  if (currentNoteId && noteDetailMap && isRecord(noteDetailMap[currentNoteId])) {
    const detail = noteDetailMap[currentNoteId];
    if (isRecord(detail.note)) {
      return detail.note;
    }
  }

  return isRecord(noteState.note) ? noteState.note : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readXiaohongshuElement<T extends Element>(
  archivedDocument: Document,
  liveDocument: Document | null | undefined,
  selector: string,
) {
  return archivedDocument.querySelector<T>(selector)
    ?? liveDocument?.querySelector<T>(selector)
    ?? null;
}

function readXiaohongshuText(
  archivedDocument: Document,
  liveDocument: Document | null | undefined,
  selector: string,
) {
  return readXiaohongshuElement<HTMLElement>(archivedDocument, liveDocument, selector)?.textContent;
}

function readXiaohongshuMetaContent(
  archivedDocument: Document,
  liveDocument: Document | null | undefined,
  selector: string,
) {
  return readXiaohongshuElement<HTMLMetaElement>(archivedDocument, liveDocument, selector)?.content;
}

function stripXiaohongshuTitleSuffix(title: string) {
  return normalizeText(title.replace(/\s*-\s*小红书$/u, ""));
}

function isSspaiPostPage(url: URL) {
  const hostname = url.hostname.replace(/^www\./i, "");
  return hostname === "sspai.com" && /^\/post\/\d+\/?$/i.test(url.pathname);
}

function buildSspaiArticleArchive(doc: Document, currentUrl: URL) {
  const title = normalizeText(
    doc.querySelector<HTMLElement>("#article-title")?.textContent
      ?? doc.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content
      ?? doc.title,
  );
  const bodySource = doc.querySelector<HTMLElement>(".article__main__content.wangEditor-txt");
  if (!title || !bodySource) {
    return null;
  }

  const body = bodySource.cloneNode(true) as HTMLElement;
  sanitizeArticleBody(body, currentUrl);
  const textLength = normalizeText(body.textContent ?? "").length;
  if (textLength < 400) {
    return null;
  }

  const heroImageUrl = readImageUrl(
    doc.querySelector<HTMLImageElement>(".article-banner img.banner"),
    currentUrl,
  );
  const description = normalizeText(
    doc.querySelector<HTMLMetaElement>('meta[name="description"]')?.content,
  );
  const metadata = readArticleMetadata(doc);
  const publishedAt = formatPublishedAt(
    metadata.datePublished,
    normalizeText(doc.querySelector<HTMLElement>(".article-header .timer")?.textContent),
  );

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base href="${escapeHtmlAttribute(currentUrl.toString())}" />
    <title>${escapeHtml(title)}</title>
    ${description ? `<meta name="description" content="${escapeHtmlAttribute(description)}" />` : ""}
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f2e9;
        --surface: rgba(255, 253, 249, 0.96);
        --surface-strong: #f0e7d7;
        --text: #221d16;
        --muted: #70675b;
        --border: rgba(133, 108, 71, 0.16);
        --accent: #0f5d78;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        background:
          radial-gradient(circle at top left, rgba(255, 223, 168, 0.28), transparent 36%),
          radial-gradient(circle at bottom right, rgba(129, 192, 220, 0.26), transparent 34%),
          var(--bg);
        color: var(--text);
        font-family: "Iowan Old Style", "Palatino Linotype", "Noto Serif SC", serif;
      }

      body {
        padding: clamp(18px, 3vw, 28px);
      }

      .page {
        max-width: 860px;
        margin: 0 auto;
        border: 1px solid var(--border);
        border-radius: 28px;
        overflow: hidden;
        background: var(--surface);
        box-shadow:
          0 30px 90px rgba(34, 29, 22, 0.08),
          inset 0 1px 0 rgba(255, 255, 255, 0.85);
      }

      .hero {
        background: linear-gradient(180deg, rgba(34, 29, 22, 0.06), rgba(34, 29, 22, 0));
      }

      .hero img {
        display: block;
        width: 100%;
        height: auto;
      }

      .content {
        padding: clamp(22px, 5vw, 44px);
      }

      .source {
        margin: 0 0 12px;
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-size: clamp(30px, 5vw, 46px);
        line-height: 1.15;
        letter-spacing: -0.03em;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 14px;
        align-items: center;
        margin: 18px 0 0;
        color: var(--muted);
        font-size: 14px;
      }

      .meta span {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .meta span::before {
        content: "";
        width: 5px;
        height: 5px;
        border-radius: 999px;
        background: rgba(112, 103, 91, 0.55);
      }

      .summary {
        margin: 20px 0 0;
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid rgba(133, 108, 71, 0.12);
        background: var(--surface-strong);
        color: #4a4137;
        font-size: 15px;
        line-height: 1.75;
      }

      .article-body {
        margin-top: 28px;
        font-size: 17px;
        line-height: 1.95;
      }

      .article-body > :first-child {
        margin-top: 0;
      }

      .article-body > :last-child {
        margin-bottom: 0;
      }

      .article-body p,
      .article-body ul,
      .article-body ol,
      .article-body blockquote,
      .article-body pre,
      .article-body figure,
      .article-body hr {
        margin: 1.15em 0;
      }

      .article-body h2,
      .article-body h3,
      .article-body h4 {
        margin: 2.2em 0 0.8em;
        line-height: 1.28;
      }

      .article-body h2 {
        font-size: 1.58em;
      }

      .article-body h3 {
        font-size: 1.32em;
      }

      .article-body a {
        color: var(--accent);
      }

      .article-body img {
        display: block;
        max-width: 100%;
        width: 100%;
        height: auto;
        border-radius: 18px;
        background: rgba(34, 29, 22, 0.04);
      }

      .article-body figure.image,
      .article-body figure.ss-imgRows {
        margin-left: 0;
        margin-right: 0;
      }

      .article-body figure.ss-imgRows {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }

      .article-body figure.ss-imgRows figcaption {
        grid-column: 1 / -1;
      }

      .article-body figcaption {
        margin-top: 10px;
        color: var(--muted);
        font-size: 13px;
        text-align: center;
      }

      .article-body blockquote {
        padding: 14px 18px;
        border-left: 3px solid rgba(15, 93, 120, 0.35);
        background: rgba(15, 93, 120, 0.06);
        border-radius: 0 16px 16px 0;
        color: #474038;
      }

      .article-body pre {
        overflow: auto;
        padding: 16px;
        border-radius: 16px;
        background: #1f2430;
        color: #f3f5f7;
        font-size: 14px;
        line-height: 1.7;
      }

      .article-body code {
        font-family: "SFMono-Regular", "Cascadia Code", "JetBrains Mono", monospace;
      }

      .article-body :not(pre) > code {
        padding: 0.16em 0.38em;
        border-radius: 6px;
        background: rgba(15, 93, 120, 0.08);
        color: #17485b;
        font-size: 0.92em;
      }

      .article-body hr {
        border: 0;
        border-top: 1px solid rgba(133, 108, 71, 0.16);
      }

      @media (max-width: 640px) {
        body {
          padding: 12px;
        }

        .page {
          border-radius: 20px;
        }

        .content {
          padding: 18px 16px 24px;
        }

        .article-body {
          font-size: 16px;
          line-height: 1.85;
        }

        .article-body figure.ss-imgRows {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      ${heroImageUrl ? `<div class="hero"><img src="${escapeHtmlAttribute(heroImageUrl)}" alt="${escapeHtmlAttribute(title)}" /></div>` : ""}
      <div class="content">
        <p class="source">KeepPage 阅读归档</p>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">
          ${metadata.author ? `<span>${escapeHtml(metadata.author)}</span>` : ""}
          ${publishedAt ? `<span>${escapeHtml(publishedAt)}</span>` : ""}
          <span>${escapeHtml(currentUrl.hostname)}</span>
        </div>
        ${description ? `<p class="summary">${escapeHtml(description)}</p>` : ""}
        <article class="article-body">
          ${body.innerHTML}
        </article>
      </div>
    </main>
  </body>
</html>`;
}

function sanitizeArticleBody(root: HTMLElement, currentUrl: URL) {
  for (const paragraph of root.querySelectorAll("p")) {
    if (isSspaiPromoParagraph(paragraph)) {
      paragraph.remove();
    }
  }

  for (const figure of root.querySelectorAll<HTMLElement>("figure.ss-imgRows")) {
    const caption = normalizeText(figure.getAttribute("figcaption"));
    if (caption && !figure.querySelector("figcaption")) {
      const figcaption = root.ownerDocument.createElement("figcaption");
      figcaption.textContent = caption;
      figure.append(figcaption);
    }
    figure.removeAttribute("figcaption");
  }

  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    const deferredImageSrc = element instanceof HTMLImageElement
      ? element.getAttribute("data-original")
      : null;

    element.removeAttribute("style");
    element.removeAttribute("contenteditable");
    element.removeAttribute("spellcheck");

    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-") || attribute.name.startsWith("aria-")) {
        element.removeAttribute(attribute.name);
      }
    }

    if (element instanceof HTMLImageElement) {
      const preferredSrc = element.getAttribute("src")
        ?? deferredImageSrc
        ?? element.currentSrc;
      const resolvedSrc = resolveUrl(preferredSrc, currentUrl);
      if (resolvedSrc) {
        element.setAttribute("src", resolvedSrc);
      }
      element.removeAttribute("width");
      element.removeAttribute("height");
      if (!element.getAttribute("alt")) {
        element.setAttribute("alt", "");
      }
    }

    if (element instanceof HTMLAnchorElement) {
      const resolvedHref = resolveUrl(element.getAttribute("href"), currentUrl);
      if (resolvedHref) {
        element.setAttribute("href", resolvedHref);
      }
      if (element.target === "_blank") {
        element.setAttribute("rel", "noreferrer noopener");
      }
    }
  }

  for (const emptyParagraph of root.querySelectorAll("p")) {
    if (!normalizeText(emptyParagraph.textContent)) {
      emptyParagraph.remove();
    }
  }
}

function readArticleMetadata(doc: Document) {
  const scripts = Array.from(
    doc.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
  );

  for (const script of scripts) {
    const parsed = safeJsonParse(script.textContent ?? "");
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") {
        continue;
      }

      const record = candidate as {
        ["@type"]?: unknown;
        author?: unknown;
        datePublished?: unknown;
      };
      if (record["@type"] !== "Article") {
        continue;
      }

      return {
        author: readAuthorName(record.author),
        datePublished: typeof record.datePublished === "string" ? record.datePublished : undefined,
      };
    }
  }

  return {
    author: normalizeText(
      doc.querySelector<HTMLElement>(".article-header .nickname span")?.textContent,
    ),
    datePublished: undefined,
  };
}

function readAuthorName(author: unknown): string {
  if (typeof author === "string") {
    return normalizeText(author);
  }
  if (Array.isArray(author)) {
    return normalizeText(
      author
        .map((entry) => readAuthorName(entry))
        .filter(Boolean)
        .join(" / "),
    );
  }
  if (!author || typeof author !== "object") {
    return "";
  }
  const record = author as { name?: unknown };
  return typeof record.name === "string" ? normalizeText(record.name) : "";
}

function formatPublishedAt(datePublished?: string, fallbackText?: string) {
  if (datePublished) {
    const parsed = new Date(datePublished);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(parsed);
    }
  }

  return fallbackText ?? "";
}

function readImageUrl(image: HTMLImageElement | null, currentUrl: URL) {
  if (!image) {
    return "";
  }

  return resolveUrl(
    image.getAttribute("src")
      ?? image.getAttribute("data-original")
      ?? image.currentSrc,
    currentUrl,
  );
}

function resolveUrl(rawUrl: string | null | undefined, currentUrl: URL) {
  const value = rawUrl?.trim();
  if (!value || value.startsWith("javascript:")) {
    return "";
  }

  try {
    return new URL(value, currentUrl).toString();
  } catch {
    return value;
  }
}

function safeJsonParse(input: string) {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

function isSspaiPromoParagraph(paragraph: HTMLParagraphElement) {
  const text = normalizeText(paragraph.textContent);
  return text.includes("关注 少数派小红书") || text.includes("实用、好用的 正版软件");
}

function normalizeText(text: string | null | undefined) {
  return (text ?? "").replaceAll(/\s+/g, " ").trim();
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeHtmlAttribute(text: string) {
  return escapeHtml(text);
}
