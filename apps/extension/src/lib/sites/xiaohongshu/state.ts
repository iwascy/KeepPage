function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
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

export function parseXiaohongshuInitialState(doc: Document) {
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

export function readXiaohongshuNoteRecord(state: unknown) {
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
