function normalizeBaseUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return sourceUrl;
  }
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function ensureArchiveBaseHref(html: string, sourceUrl: string) {
  if (!html.trim() || !sourceUrl.trim() || /<base\b[^>]*href=/i.test(html)) {
    return html;
  }

  const normalizedBaseUrl = escapeHtmlAttribute(normalizeBaseUrl(sourceUrl));
  const baseTag = `<base href="${normalizedBaseUrl}" />`;

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}\n    ${baseTag}`);
  }

  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(
      /<html\b[^>]*>/i,
      (match) => `${match}\n  <head>\n    <meta charset="UTF-8" />\n    ${baseTag}\n  </head>`,
    );
  }

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    ${baseTag}
  </head>
  <body>
${html}
  </body>
</html>`;
}
