import type {
  Folder,
  FolderCreateRequest,
  FolderUpdateRequest,
  Tag,
  TagCreateRequest,
  TagUpdateRequest,
} from "@keeppage/domain";
import type { PostgresRepositoryCore } from "./core";

export function listFolders(core: PostgresRepositoryCore, userId: string): Promise<Folder[]> {
  return core.listFolders(userId);
}

export function createFolder(
  core: PostgresRepositoryCore,
  userId: string,
  input: FolderCreateRequest,
): Promise<Folder> {
  return core.createFolder(userId, input);
}

export function updateFolder(
  core: PostgresRepositoryCore,
  userId: string,
  folderId: string,
  input: FolderUpdateRequest,
): Promise<Folder | null> {
  return core.updateFolder(userId, folderId, input);
}

export function deleteFolder(
  core: PostgresRepositoryCore,
  userId: string,
  folderId: string,
): Promise<boolean> {
  return core.deleteFolder(userId, folderId);
}

export function listTags(core: PostgresRepositoryCore, userId: string): Promise<Tag[]> {
  return core.listTags(userId);
}

export function createTag(
  core: PostgresRepositoryCore,
  userId: string,
  input: TagCreateRequest,
): Promise<Tag> {
  return core.createTag(userId, input);
}

export function updateTag(
  core: PostgresRepositoryCore,
  userId: string,
  tagId: string,
  input: TagUpdateRequest,
): Promise<Tag | null> {
  return core.updateTag(userId, tagId, input);
}

export function deleteTag(core: PostgresRepositoryCore, userId: string, tagId: string): Promise<boolean> {
  return core.deleteTag(userId, tagId);
}
