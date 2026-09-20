import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Native Node TypeScript tests require explicit .ts extensions.
import { toImportApiRequest } from "./import-request.ts";
import type { ImportPreviewRequest } from "./index";

const input: ImportPreviewRequest = {
  sourceType: "url_list",
  rawInput: "https://example.org/reading/design\nhttps://example.org/reading/performance",
  mode: "links_only",
  dedupeStrategy: "merge",
  titleStrategy: "prefer_input",
  targetFolderMode: "keep_source",
};

test("URL import uses the strict API envelope without unknown top-level form fields", () => {
  const payload = toImportApiRequest(input);
  assert.deepEqual(Object.keys(payload).sort(), ["content", "options", "sourceType"]);
  assert.equal(payload.content, input.rawInput);
  assert.deepEqual(payload.options, {
    mode: "links_only", dedupeStrategy: "merge", titleStrategy: "prefer_import_title",
    targetFolderMode: "preserve", tagStrategy: "keep_source_tags",
  });
});

test("non-default import policies survive conversion instead of silently falling back", () => {
  const payload = toImportApiRequest({ ...input, dedupeStrategy: "update_meta", titleStrategy: "prefer_web", targetFolderMode: "specific_folder", targetFolderPath: " 工作/设计 ", mode: "archive_now" });
  assert.deepEqual(payload.options, {
    mode: "start_archive", dedupeStrategy: "update_metadata", titleStrategy: "prefer_page_title",
    targetFolderMode: "specific", targetFolderPath: "工作/设计", tagStrategy: "keep_source_tags",
  });
});

test("file formats retain their parser instead of defaulting to URL text", () => {
  for (const [fileName, source] of [["bookmarks.CSV", "csv_file"], ["notes.md", "markdown_file"], ["links.txt", "text_file"]]) {
    assert.equal(toImportApiRequest({ ...input, sourceType: "csv_txt", fileName }).sourceType, source);
  }
  assert.equal(toImportApiRequest({ ...input, sourceType: "browser_html" }).sourceType, "bookmark_html");
  assert.equal(toImportApiRequest({ ...input, sourceType: "browser_extension" }).sourceType, "browser_bookmarks");
});
