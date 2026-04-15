import type {
  Folder,
  FolderCreateRequest,
  FolderUpdateRequest,
  Tag,
  TagCreateRequest,
  TagUpdateRequest,
} from "@keeppage/domain";
import type { InMemoryRepositoryCore } from "./core";

export function listFolders(core: InMemoryRepositoryCore, userId: string): Promise<Folder[]> {
  return core.listFolders(userId);
}

export function createFolder(
  core: InMemoryRepositoryCore,
  userId: string,
  input: FolderCreateRequest,
): Promise<Folder> {
  return core.createFolder(userId, input);
}

export function updateFolder(
  core: InMemoryRepositoryCore,
  userId: string,
  folderId: string,
  input: FolderUpdateRequest,
): Promise<Folder | null> {
  return core.updateFolder(userId, folderId, input);
}

export function deleteFolder(
  core: InMemoryRepositoryCore,
  userId: string,
  folderId: string,
): Promise<boolean> {
  return core.deleteFolder(userId, folderId);
}

export function listTags(core: InMemoryRepositoryCore, userId: string): Promise<Tag[]> {
  return core.listTags(userId);
}

export function createTag(
  core: InMemoryRepositoryCore,
  userId: string,
  input: TagCreateRequest,
): Promise<Tag> {
  return core.createTag(userId, input);
}

export function updateTag(
  core: InMemoryRepositoryCore,
  userId: string,
  tagId: string,
  input: TagUpdateRequest,
): Promise<Tag | null> {
  return core.updateTag(userId, tagId, input);
}

export function deleteTag(core: InMemoryRepositoryCore, userId: string, tagId: string): Promise<boolean> {
  return core.deleteTag(userId, tagId);
}
