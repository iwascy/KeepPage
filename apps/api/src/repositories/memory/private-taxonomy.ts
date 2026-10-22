import type {
  Folder,
  FolderCreateRequest,
  FolderUpdateRequest,
  Tag,
  TagCreateRequest,
  TagUpdateRequest,
} from "@keeppage/domain";
import type { InMemoryRepositoryCore } from "./core";

export function listPrivateFolders(core: InMemoryRepositoryCore, userId: string): Promise<Folder[]> {
  return core.listPrivateFolders(userId);
}

export function createPrivateFolder(
  core: InMemoryRepositoryCore,
  userId: string,
  input: FolderCreateRequest,
): Promise<Folder> {
  return core.createPrivateFolder(userId, input);
}

export function updatePrivateFolder(
  core: InMemoryRepositoryCore,
  userId: string,
  folderId: string,
  input: FolderUpdateRequest,
): Promise<Folder | null> {
  return core.updatePrivateFolder(userId, folderId, input);
}

export function deletePrivateFolder(
  core: InMemoryRepositoryCore,
  userId: string,
  folderId: string,
): Promise<boolean> {
  return core.deletePrivateFolder(userId, folderId);
}

export function listPrivateTags(core: InMemoryRepositoryCore, userId: string): Promise<Tag[]> {
  return core.listPrivateTags(userId);
}

export function createPrivateTag(
  core: InMemoryRepositoryCore,
  userId: string,
  input: TagCreateRequest,
): Promise<Tag> {
  return core.createPrivateTag(userId, input);
}

export function updatePrivateTag(
  core: InMemoryRepositoryCore,
  userId: string,
  tagId: string,
  input: TagUpdateRequest,
): Promise<Tag | null> {
  return core.updatePrivateTag(userId, tagId, input);
}

export function deletePrivateTag(core: InMemoryRepositoryCore, userId: string, tagId: string): Promise<boolean> {
  return core.deletePrivateTag(userId, tagId);
}
