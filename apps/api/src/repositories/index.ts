import type { ApiConfig } from "../config";
import type { ObjectStorage } from "../storage/object-storage";
import type { BookmarkRepository } from "./bookmark-repository";
import { InMemoryBookmarkRepository } from "./memory-bookmark-repository";
import { PostgresBookmarkRepository } from "./postgres-bookmark-repository";

export function createRepository(
  config: ApiConfig,
  objectStorage: ObjectStorage,
): BookmarkRepository {
  if (config.STORAGE_DRIVER === "postgres") {
    if (!config.DATABASE_URL) {
      throw new Error("DATABASE_URL is required when STORAGE_DRIVER=postgres.");
    }
    return new PostgresBookmarkRepository({
      databaseUrl: config.DATABASE_URL,
      objectStorage,
    });
  }
  return new InMemoryBookmarkRepository({ objectStorage });
}

export type {
  ApiTokenRepository,
  AuthRepository,
  BookmarkReadRepository,
  BookmarkRepository,
  BookmarkWriteRepository,
  CaptureRepository,
  ImportRepository,
  IngestRepository,
  ObjectAccessRepository,
  TaxonomyRepository,
} from "./bookmark-repository";
