import { useMemo, useState } from "react";
import type { AuthSession, Bookmark, Folder, Tag } from "@keeppage/domain";
import type { ApiTokenItem } from "../api";
import type { AppDataSource } from "./use-app-data-source";
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

function buildFolderCountRecord(bookmarks: Bookmark[]) {
  return bookmarks.reduce<Record<string, number>>((accumulator, bookmark) => {
    const folderId = bookmark.folder?.id;
    if (!folderId) {
      return accumulator;
    }
    accumulator[folderId] = (accumulator[folderId] ?? 0) + 1;
    return accumulator;
  }, {});
}

export function useDemoDataSource(): AppDataSource {
  const kind = "demo";
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
        async fetchBookmarkFolderCounts() {
          return buildFolderCountRecord(demoState.bookmarks);
        },
        async fetchWorkspaceBootstrap() {
          return {
            folders: demoState.folders,
            tags: demoState.tags,
            folderCounts: Object.entries(buildFolderCountRecord(demoState.bookmarks)).map(([folderId, count]) => ({
              folderId,
              count,
            })),
          };
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
        async fetchPrivateModeStatus() {
          return {
            enabled: false,
            unlocked: false,
            autoLock: "browser",
            totalItems: 0,
            pendingSyncCount: 0,
            syncEnabled: true,
          };
        },
        async setupPrivateMode() {
          throw new Error("Mock 模式暂不支持私密模式。");
        },
        async unlockPrivateMode() {
          throw new Error("Mock 模式暂不支持私密模式。");
        },
        async changePrivateModePassword() {
          throw new Error("Mock 模式暂不支持私密模式。");
        },
        async lockPrivateMode() {
          return {
            enabled: false,
            unlocked: false,
            autoLock: "browser",
            totalItems: 0,
            pendingSyncCount: 0,
            syncEnabled: true,
          };
        },
        async searchPrivateBookmarks() {
          return {
            items: [],
            total: 0,
            source: "api" as const,
          };
        },
        async fetchPrivateBookmarkDetail() {
          return null;
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
        async createExtensionConnectCode() {
          return {
            code: `demo-${crypto.randomUUID()}`,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          };
        },
        async fetchExtensionDevices() {
          return [];
        },
        async revokeExtensionDevice() {
          return;
        },
        async enqueueLocalArchive() {
          throw new Error("Mock 模式暂不支持本地插件批量存档。");
        },
      };
    }

    throw new Error("Invalid demo source");
  }, [demoApiTokens, demoState, importAdapter, kind]);
}
