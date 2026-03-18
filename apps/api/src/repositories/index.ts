import type { ApiConfig } from "../config";
import type { BookmarkRepository } from "./bookmark-repository";
import { InMemoryBookmarkRepository } from "./memory-bookmark-repository";
import { PostgresBookmarkRepository } from "./postgres-bookmark-repository";

export function createRepository(config: ApiConfig): BookmarkRepository {
  if (config.STORAGE_DRIVER === "postgres") {
    if (!config.DATABASE_URL) {
      throw new Error("DATABASE_URL is required when STORAGE_DRIVER=postgres.");
    }
    return new PostgresBookmarkRepository({ databaseUrl: config.DATABASE_URL });
  }
  return new InMemoryBookmarkRepository();
}

export type { BookmarkRepository } from "./bookmark-repository";
