import type { ImportPreviewRequest as ImportApiRequest } from "@keeppage/domain";
import type { ImportPreviewRequest } from "./index";

/** Translate the form vocabulary into the shared Go/TypeScript API contract. */
export function toImportApiRequest(input: ImportPreviewRequest): ImportApiRequest {
  const fileName = input.fileName?.trim();
  const extension = fileName?.toLowerCase() ?? "";
  const sourceType: ImportApiRequest["sourceType"] = input.sourceType === "browser_html"
    ? "bookmark_html"
    : input.sourceType === "browser_extension"
      ? "browser_bookmarks"
      : input.sourceType === "csv_txt"
        ? extension.endsWith(".csv") ? "csv_file" : extension.endsWith(".md") ? "markdown_file" : "text_file"
        : "url_list";
  return {
    sourceType,
    content: input.rawInput,
    ...(fileName ? { fileName } : {}),
    options: {
      mode: input.mode === "archive_now" ? "start_archive" : input.mode,
      dedupeStrategy: input.dedupeStrategy === "update_meta" ? "update_metadata" : input.dedupeStrategy,
      titleStrategy: input.titleStrategy === "prefer_input" ? "prefer_import_title" : input.titleStrategy === "prefer_web" ? "prefer_page_title" : "update_later",
      targetFolderMode: input.targetFolderMode === "keep_source" ? "preserve" : input.targetFolderMode === "specific_folder" ? "specific" : "flatten",
      ...(input.targetFolderPath?.trim() ? { targetFolderPath: input.targetFolderPath.trim() } : {}),
      tagStrategy: "keep_source_tags",
    },
  };
}
