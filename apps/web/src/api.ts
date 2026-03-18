import {
  type Bookmark,
  bookmarkSchema,
  bookmarkSearchResponseSchema,
  type QualityGrade,
} from "@keeppage/domain";
import { mockBookmarks } from "./mockData";

type DataSource = "api" | "mock";

export type BookmarkQuery = {
  search: string;
  quality: "all" | QualityGrade;
};

export type BookmarkResult = {
  items: Bookmark[];
  source: DataSource;
};

function applyLocalFilter(items: Bookmark[], query: BookmarkQuery) {
  const searchNeedle = query.search.trim().toLowerCase();
  return items.filter((item) => {
    const gradePass = query.quality === "all" || item.latestQuality?.grade === query.quality;
    if (!gradePass) {
      return false;
    }
    if (!searchNeedle) {
      return true;
    }
    const textToSearch = [
      item.title,
      item.sourceUrl,
      item.domain,
      item.note,
      item.folder?.path ?? "",
      ...item.tags.map((tag) => tag.name),
    ]
      .join(" ")
      .toLowerCase();
    return textToSearch.includes(searchNeedle);
  });
}

function normalizeBookmarks(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => bookmarkSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data);
}

export async function fetchBookmarks(query: BookmarkQuery): Promise<BookmarkResult> {
  const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
  const params = new URLSearchParams();
  if (query.search.trim()) {
    params.set("q", query.search.trim());
  }
  if (query.quality !== "all") {
    params.set("quality", query.quality);
  }
  const apiUrl = `${apiBase.replace(/\/$/, "")}/bookmarks${params.toString() ? `?${params.toString()}` : ""}`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`API response ${response.status}`);
    }
    const json = (await response.json()) as unknown;
    const parsed = bookmarkSearchResponseSchema.safeParse(json);
    if (parsed.success) {
      return {
        items: applyLocalFilter(parsed.data.items, query),
        source: "api",
      };
    }

    // Compatibility branch for a simple array response.
    const fallbackArray = normalizeBookmarks(json);
    if (fallbackArray.length > 0) {
      return {
        items: applyLocalFilter(fallbackArray, query),
        source: "api",
      };
    }
    throw new Error("Invalid API payload format");
  } catch {
    return {
      items: applyLocalFilter(mockBookmarks, query),
      source: "mock",
    };
  }
}
