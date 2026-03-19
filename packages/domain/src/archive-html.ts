function normalizeBaseUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return sourceUrl;
  }
}

function rewriteRelativeUrl(value: string, sourceUrl: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue || trimmedValue.startsWith("#")) {
    return value;
  }

  if (/^(?:[a-z][a-z0-9+.-]*:|data:|blob:|mailto:|tel:|javascript:)/i.test(trimmedValue)) {
    return value;
  }

  try {
    return new URL(trimmedValue, sourceUrl).toString();
  } catch {
    return value;
  }
}

function rewriteCssUrls(css: string, sourceUrl: string) {
  return css
    .replace(/url\(\s*(['"]?)([^)"']+)\1\s*\)/gi, (match, quote: string, url: string) => {
      const rewrittenUrl = rewriteRelativeUrl(url, sourceUrl);
      if (rewrittenUrl === url) {
        return match;
      }
      return `url(${quote}${rewrittenUrl}${quote})`;
    })
    .replace(/@import\s+(url\(\s*)?(['"])([^"']+)\2(\s*\))?/gi, (match, urlPrefix: string | undefined, quote: string, url: string, urlSuffix: string | undefined) => {
      const rewrittenUrl = rewriteRelativeUrl(url, sourceUrl);
      if (rewrittenUrl === url) {
        return match;
      }
      return `@import ${urlPrefix ?? ""}${quote}${rewrittenUrl}${quote}${urlSuffix ?? ""}`;
    });
}

export function ensureArchiveBaseHref(html: string, sourceUrl: string) {
  if (!html.trim() || !sourceUrl.trim()) {
    return html;
  }

  const normalizedBaseUrl = normalizeBaseUrl(sourceUrl);
  const preservedScripts: string[] = [];
  const htmlWithoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (match) => {
    const placeholder = `__KEEPPAGE_SCRIPT_${preservedScripts.length}__`;
    preservedScripts.push(match);
    return placeholder;
  });

  const rewrittenHtml = htmlWithoutScripts
    .replace(
      /\b(href|src|poster)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
      (match, attributeName: string, attributeValue: string, doubleQuoted: string | undefined, singleQuoted: string | undefined, unquoted: string | undefined) => {
        const rawValue = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
        const rewrittenValue = rewriteRelativeUrl(rawValue, normalizedBaseUrl);
        if (rewrittenValue === rawValue) {
          return match;
        }

        const quote = attributeValue.startsWith("\"")
          ? "\""
          : attributeValue.startsWith("'")
            ? "'"
            : "";

        return quote
          ? `${attributeName}=${quote}${rewrittenValue}${quote}`
          : `${attributeName}=${rewrittenValue}`;
      },
    )
    .replace(
      /\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi,
      (match, attributeValue: string, doubleQuoted: string | undefined, singleQuoted: string | undefined) => {
        const rawValue = doubleQuoted ?? singleQuoted ?? "";
        const rewrittenValue = rawValue
          .split(",")
          .map((candidate) => {
            const trimmedCandidate = candidate.trim();
            if (!trimmedCandidate) {
              return candidate;
            }

            const [url, ...descriptors] = trimmedCandidate.split(/\s+/);
            const rewrittenUrl = rewriteRelativeUrl(url, normalizedBaseUrl);
            return [rewrittenUrl, ...descriptors].filter(Boolean).join(" ");
          })
          .join(", ");

        if (rewrittenValue === rawValue) {
          return match;
        }

        const quote = attributeValue.startsWith("\"") ? "\"" : "'";
        return `srcset=${quote}${rewrittenValue}${quote}`;
      },
    )
    .replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (match, attributes: string, styleContent: string) => {
      const rewrittenStyleContent = rewriteCssUrls(styleContent, normalizedBaseUrl);
      if (rewrittenStyleContent === styleContent) {
        return match;
      }
      return `<style${attributes}>${rewrittenStyleContent}</style>`;
    })
    .replace(
      /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi,
      (match, attributeValue: string, doubleQuoted: string | undefined, singleQuoted: string | undefined) => {
        const rawValue = doubleQuoted ?? singleQuoted ?? "";
        const rewrittenValue = rewriteCssUrls(rawValue, normalizedBaseUrl);
        if (rewrittenValue === rawValue) {
          return match;
        }

        const quote = attributeValue.startsWith("\"") ? "\"" : "'";
        return `style=${quote}${rewrittenValue}${quote}`;
      },
    );

  return rewrittenHtml.replace(/__KEEPPAGE_SCRIPT_(\d+)__/g, (match, indexText: string) => {
    const index = Number(indexText);
    return preservedScripts[index] ?? match;
  });
}
