import type {
  ApiTokenCreateResponse,
  AuthSession,
  AuthUser,
  Bookmark,
  BookmarkMetadataUpdateRequest,
  Folder,
  FolderCreateRequest,
  FolderUpdateRequest,
  PrivateModeUnlockResponse,
  PrivateVaultSummary,
  Tag,
  TagCreateRequest,
  TagUpdateRequest,
} from "@keeppage/domain";
import {
  createApiToken,
  createArchiveObjectUrl,
  createExtensionConnectCode,
  createFolder,
  createTag,
  changePrivateModePassword,
  deleteBookmark,
  deleteFolder,
  deleteTag,
  fetchApiTokens,
  fetchExtensionDevices,
  fetchBookmarkDetail,
  fetchBookmarkFolderCounts,
  fetchBookmarks,
  fetchPrivateBookmarkDetail,
  fetchPrivateBookmarks,
  fetchPrivateModeStatus,
  fetchCurrentUser,
  fetchFolders,
  fetchTags,
  fetchWorkspaceBootstrap,
  lockPrivateMode,
  loginAccount,
  registerAccount,
  revokeApiToken,
  revokeExtensionDevice,
  setupPrivateMode,
  unlockPrivateMode,
  updateBookmarkMetadata,
  updateFolder,
  updateTag,
  type ApiTokenItem,
  type BookmarkDetailResult,
  type BookmarkQuery,
  type BookmarkResult,
  type BookmarkViewerVersion,
  type WorkspaceBootstrapResult,
  type ExtensionDeviceItem,
} from "../api";
import type { ImportPanelAdapter } from "../features/imports";
import { enqueueBookmarksToLocalExtension } from "../local-archive-bridge";

export type RestoredSessionState =
  | { status: "anonymous"; token: null; user: null; error: string | null }
  | { status: "authenticated"; token: string; user: AuthUser; error: null };

export type AppDataSourceKind = "live" | "demo";

export type AppDataSource = {
  kind: AppDataSourceKind;
  logoutLabel: string;
  importAdapter?: ImportPanelAdapter;
  restoreSession(storedToken: string | null): Promise<RestoredSessionState>;
  resetSession(): AuthSession | null;
  login(input: { email: string; password: string }): Promise<AuthSession>;
  register(input: { name?: string; email: string; password: string }): Promise<AuthSession>;
  fetchFolders(token: string): Promise<Folder[]>;
  fetchTags(token: string): Promise<Tag[]>;
  fetchBookmarkFolderCounts(token: string): Promise<Record<string, number>>;
  fetchWorkspaceBootstrap(token: string): Promise<WorkspaceBootstrapResult>;
  searchBookmarks(query: BookmarkQuery, token: string, signal?: AbortSignal): Promise<BookmarkResult>;
  fetchBookmarkDetail(bookmarkId: string, token: string): Promise<BookmarkDetailResult | null>;
  createArchivePreviewUrl(
    versionId: string | null,
    objectKey: string | null,
    sourceUrl: string | null,
    token: string,
    privateToken?: string,
  ): Promise<string | null>;
  fetchPrivateModeStatus(token: string, privateToken?: string): Promise<PrivateVaultSummary>;
  setupPrivateMode(password: string, token: string): Promise<PrivateModeUnlockResponse>;
  unlockPrivateMode(password: string, token: string): Promise<PrivateModeUnlockResponse>;
  changePrivateModePassword(
    input: { loginPassword: string; newPassword: string },
    token: string,
  ): Promise<PrivateModeUnlockResponse>;
  lockPrivateMode(token: string): Promise<PrivateVaultSummary>;
  searchPrivateBookmarks(query: BookmarkQuery, token: string, privateToken: string, signal?: AbortSignal): Promise<BookmarkResult>;
  fetchPrivateBookmarkDetail(
    bookmarkId: string,
    token: string,
    privateToken: string,
  ): Promise<BookmarkDetailResult | null>;
  deleteBookmark(bookmarkId: string, token: string): Promise<void>;
  updateBookmarkMetadata(
    bookmarkId: string,
    input: BookmarkMetadataUpdateRequest,
    token: string,
  ): Promise<Bookmark>;
  createFolder(input: FolderCreateRequest, token: string): Promise<Folder>;
  updateFolder(folderId: string, input: FolderUpdateRequest, token: string): Promise<Folder>;
  deleteFolder(folderId: string, token: string): Promise<void>;
  createTag(input: TagCreateRequest, token: string): Promise<Tag>;
  updateTag(tagId: string, input: TagUpdateRequest, token: string): Promise<Tag>;
  deleteTag(tagId: string, token: string): Promise<void>;
  fetchApiTokens(token: string): Promise<ApiTokenItem[]>;
  createApiToken(
    input: Parameters<typeof createApiToken>[0],
    token: string,
  ): Promise<ApiTokenCreateResponse>;
  revokeApiToken(tokenId: string, token: string): Promise<void>;
  createExtensionConnectCode(
    input: Parameters<typeof createExtensionConnectCode>[0],
    token: string,
  ): Promise<Awaited<ReturnType<typeof createExtensionConnectCode>>>;
  fetchExtensionDevices(token: string): Promise<ExtensionDeviceItem[]>;
  revokeExtensionDevice(deviceId: string, token: string): Promise<void>;
  enqueueLocalArchive(bookmarks: Bookmark[]): Promise<Awaited<ReturnType<typeof enqueueBookmarksToLocalExtension>>>;
};

const liveDataSource: AppDataSource = {
      kind: "live",
      logoutLabel: "退出登录",
      importAdapter: undefined,
      async restoreSession(storedToken) {
        if (!storedToken) {
          return {
            status: "anonymous",
            token: null,
            user: null,
            error: null,
          };
        }

        try {
          const user = await fetchCurrentUser(storedToken);
          return {
            status: "authenticated",
            token: storedToken,
            user,
            error: null,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "请求失败，请稍后重试。";
          return {
            status: "anonymous",
            token: null,
            user: null,
            error: message,
          };
        }
      },
      resetSession() {
        return null;
      },
      login: loginAccount,
      register: registerAccount,
      fetchFolders,
      fetchTags,
      fetchBookmarkFolderCounts,
      fetchWorkspaceBootstrap,
      searchBookmarks: fetchBookmarks,
      fetchBookmarkDetail,
      async createArchivePreviewUrl(_versionId, objectKey, sourceUrl, token, privateToken) {
        if (!objectKey || !sourceUrl) {
          return null;
        }
        return createArchiveObjectUrl(token, objectKey, sourceUrl, privateToken);
      },
      fetchPrivateModeStatus,
      setupPrivateMode,
      unlockPrivateMode,
      changePrivateModePassword,
      lockPrivateMode,
      searchPrivateBookmarks: fetchPrivateBookmarks,
      fetchPrivateBookmarkDetail,
      async deleteBookmark(bookmarkId, token) {
        await deleteBookmark(bookmarkId, token);
      },
      updateBookmarkMetadata,
      createFolder,
      updateFolder,
      async deleteFolder(folderId, token) {
        await deleteFolder(folderId, token);
      },
      createTag,
      updateTag,
      async deleteTag(tagId, token) {
        await deleteTag(tagId, token);
      },
      fetchApiTokens,
      createApiToken,
      async revokeApiToken(tokenId, token) {
        await revokeApiToken(tokenId, token);
      },
      createExtensionConnectCode,
      fetchExtensionDevices,
      async revokeExtensionDevice(deviceId, token) {
        await revokeExtensionDevice(deviceId, token);
      },
      enqueueLocalArchive: enqueueBookmarksToLocalExtension,
    };

let demoHook: (() => AppDataSource) | undefined;

export async function loadDemoDataSource() {
  const module = await import("./use-demo-data-source");
  demoHook = module.useDemoDataSource;
}

// Entrypoints load the selected source before mounting; kind stays fixed for this mount.
export function useAppDataSource(kind: AppDataSourceKind): AppDataSource {
  if (kind === "live") return liveDataSource;
  if (!demoHook) throw new Error("Demo data source has not been loaded.");
  return demoHook();
}
