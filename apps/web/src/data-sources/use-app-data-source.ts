import { useMemo, useState } from "react";
import type {
  ApiTokenCreateResponse,
  AuthSession,
  AuthUser,
  Bookmark,
  BookmarkMetadataUpdateRequest,
  CloudArchiveRequest,
  Folder,
  FolderCreateRequest,
  FolderUpdateRequest,
  Tag,
  TagCreateRequest,
  TagUpdateRequest,
} from "@keeppage/domain";
import {
  createApiToken,
  createArchiveObjectUrl,
  createFolder,
  createTag,
  deleteBookmark,
  deleteFolder,
  deleteTag,
  fetchApiTokens,
  fetchBookmarkDetail,
  fetchBookmarks,
  fetchCloudArchiveTask,
  fetchCurrentUser,
  fetchFolders,
  fetchTags,
  loginAccount,
  registerAccount,
  revokeApiToken,
  submitCloudArchive,
  updateBookmarkMetadata,
  updateFolder,
  updateTag,
  type ApiTokenItem,
  type BookmarkDetailResult,
  type BookmarkQuery,
  type BookmarkResult,
  type BookmarkViewerVersion,
} from "../api";
import {
  createDemoFolder,
  createDemoImportTask,
  createDemoTag,
  createDemoWorkspace,
  deleteDemoBookmark,
  deleteDemoFolder,
  deleteDemoTag,
  filterDemoBookmarks,
  getDemoArchiveHtml,
  getDemoBookmarkDetail,
  getDemoImportTaskDetail,
  listDemoImportTasks,
  previewDemoImport,
  updateDemoBookmarkMetadata,
  updateDemoFolder,
  updateDemoTag,
  type DemoWorkspace,
} from "../features/demo";
import type { ImportPanelAdapter } from "../features/imports";
import { enqueueBookmarksToLocalExtension } from "../local-archive-bridge";

const DEMO_TOKEN = "demo-token";

function createInitialDemoApiTokens(): ApiTokenItem[] {
  const now = Date.now();
  return [
    {
      id: "demo-token-active",
      name: "Raycast Inbox",
      tokenPreview: "kp_demo-rayc.3f28ab",
      scopes: ["bookmark:create"],
      lastUsedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      expiresAt: undefined,
      revokedAt: undefined,
      createdAt: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "demo-token-revoked",
      name: "Zapier Legacy",
      tokenPreview: "kp_demo-zapi.8b91c4",
      scopes: ["bookmark:create"],
      lastUsedAt: new Date(now - 12 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: undefined,
      revokedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date(now - 24 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

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
  searchBookmarks(query: BookmarkQuery, token: string): Promise<BookmarkResult>;
  fetchBookmarkDetail(bookmarkId: string, token: string): Promise<BookmarkDetailResult | null>;
  createArchivePreviewUrl(
    versionId: string | null,
    objectKey: string | null,
    sourceUrl: string | null,
    token: string,
  ): Promise<string | null>;
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
  submitCloudArchive(input: CloudArchiveRequest, token: string): Promise<Awaited<ReturnType<typeof submitCloudArchive>>>;
  fetchCloudArchiveTask(taskId: string, token: string): Promise<Awaited<ReturnType<typeof fetchCloudArchiveTask>>>;
  enqueueLocalArchive(bookmarks: Bookmark[]): Promise<Awaited<ReturnType<typeof enqueueBookmarksToLocalExtension>>>;
};

export function useAppDataSource(kind: AppDataSourceKind): AppDataSource {
  const [demoState, setDemoState] = useState<DemoWorkspace>(() => createDemoWorkspace());
  const [demoApiTokens, setDemoApiTokens] = useState<ApiTokenItem[]>(() => createInitialDemoApiTokens());

  const importAdapter = useMemo<ImportPanelAdapter | undefined>(() => {
    if (kind !== "demo") {
      return undefined;
    }

    return {
      previewImport: async (input) => previewDemoImport(demoState, input),
      createImportTask: async (input) => {
        let taskId = "";
        setDemoState((current) => {
          const result = createDemoImportTask(current, input);
          taskId = result.taskId;
          return result.workspace;
        });
        return { taskId };
      },
      fetchImportTasks: async () => listDemoImportTasks(demoState),
      fetchImportTaskDetail: async (taskId) => getDemoImportTaskDetail(demoState, taskId),
    };
  }, [demoState, kind]);

  return useMemo<AppDataSource>(() => {
    if (kind === "demo") {
      return {
        kind: "demo",
        logoutLabel: "重置 Mock 数据",
        importAdapter,
        async restoreSession() {
          return {
            status: "authenticated",
            token: DEMO_TOKEN,
            user: demoState.user,
            error: null,
          };
        },
        resetSession() {
          let nextSession: AuthSession | null = null;
          setDemoState(() => {
            const nextWorkspace = createDemoWorkspace();
            nextSession = {
              token: DEMO_TOKEN,
              user: nextWorkspace.user,
            };
            return nextWorkspace;
          });
          setDemoApiTokens(createInitialDemoApiTokens());
          return nextSession;
        },
        async login() {
          return {
            token: DEMO_TOKEN,
            user: demoState.user,
          };
        },
        async register() {
          return {
            token: DEMO_TOKEN,
            user: demoState.user,
          };
        },
        async fetchFolders() {
          return demoState.folders;
        },
        async fetchTags() {
          return demoState.tags;
        },
        async searchBookmarks(query) {
          const filtered = filterDemoBookmarks(demoState, query);
          const offset = query.offset ?? 0;
          const limit = query.limit ?? filtered.length;
          return {
            items: filtered.slice(offset, offset + limit),
            total: filtered.length,
            source: "api" as const,
          };
        },
        async fetchBookmarkDetail(bookmarkId) {
          return getDemoBookmarkDetail(demoState, bookmarkId);
        },
        async createArchivePreviewUrl(versionId, objectKey, sourceUrl) {
          if (!versionId || !objectKey || !sourceUrl) {
            return null;
          }
          const html = getDemoArchiveHtml(demoState, versionId);
          if (!html) {
            return null;
          }
          return URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
        },
        async deleteBookmark(bookmarkId) {
          setDemoState((current) => deleteDemoBookmark(current, bookmarkId));
        },
        async updateBookmarkMetadata(bookmarkId, input) {
          let bookmark: Bookmark | null = null;
          setDemoState((current) => {
            const result = updateDemoBookmarkMetadata(current, bookmarkId, input);
            bookmark = result.bookmark;
            return result.workspace;
          });
          if (!bookmark) {
            throw new Error("未找到要更新的书签。");
          }
          return bookmark;
        },
        async createFolder(input) {
          let folder: Folder | null = null;
          setDemoState((current) => {
            const result = createDemoFolder(current, {
              ...input,
              parentId: input.parentId ?? null,
            });
            folder = result.folder;
            return result.workspace;
          });
          if (!folder) {
            throw new Error("创建收藏夹失败。");
          }
          return folder;
        },
        async updateFolder(folderId, input) {
          let folder: Folder | null = null;
          setDemoState((current) => {
            const result = updateDemoFolder(current, folderId, input);
            folder = result.folder;
            return result.workspace;
          });
          if (!folder) {
            throw new Error("更新收藏夹失败。");
          }
          return folder;
        },
        async deleteFolder(folderId) {
          setDemoState((current) => deleteDemoFolder(current, folderId));
        },
        async createTag(input) {
          let tag: Tag | null = null;
          setDemoState((current) => {
            const result = createDemoTag(current, input);
            tag = result.tag;
            return result.workspace;
          });
          if (!tag) {
            throw new Error("创建标签失败。");
          }
          return tag;
        },
        async updateTag(tagId, input) {
          let tag: Tag | null = null;
          setDemoState((current) => {
            const result = updateDemoTag(current, tagId, input);
            tag = result.tag;
            return result.workspace;
          });
          if (!tag) {
            throw new Error("更新标签失败。");
          }
          return tag;
        },
        async deleteTag(tagId) {
          setDemoState((current) => deleteDemoTag(current, tagId));
        },
        async fetchApiTokens() {
          return demoApiTokens;
        },
        async createApiToken(input) {
          const now = new Date().toISOString();
          const secret = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
          const token = `kp_${crypto.randomUUID()}.${secret}`;
          const item: ApiTokenItem = {
            id: crypto.randomUUID(),
            name: input.name,
            tokenPreview: token.slice(0, 18),
            scopes: input.scopes,
            lastUsedAt: undefined,
            expiresAt: input.expiresAt,
            revokedAt: undefined,
            createdAt: now,
          };
          setDemoApiTokens((current) => [item, ...current]);
          return {
            item,
            token,
          };
        },
        async revokeApiToken(tokenId) {
          const revokedAt = new Date().toISOString();
          setDemoApiTokens((current) => current.map((item) => (
            item.id === tokenId
              ? { ...item, revokedAt }
              : item
          )));
        },
        async submitCloudArchive() {
          throw new Error("Mock 模式暂不支持云端存档，请切换到真实 API 环境后使用。");
        },
        async fetchCloudArchiveTask() {
          throw new Error("Mock 模式暂不支持云端存档。");
        },
        async enqueueLocalArchive() {
          throw new Error("Mock 模式暂不支持本地插件批量存档。");
        },
      };
    }

    return {
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
      searchBookmarks: fetchBookmarks,
      fetchBookmarkDetail,
      async createArchivePreviewUrl(_versionId, objectKey, sourceUrl, token) {
        if (!objectKey || !sourceUrl) {
          return null;
        }
        return createArchiveObjectUrl(token, objectKey, sourceUrl);
      },
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
      submitCloudArchive,
      fetchCloudArchiveTask,
      enqueueLocalArchive: enqueueBookmarksToLocalExtension,
    };
  }, [demoApiTokens, demoState, importAdapter, kind]);
}
