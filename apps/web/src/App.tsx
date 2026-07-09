import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  Suspense,
  useCallback,
  useEffect,
  useDeferredValue,
  lazy,
  useMemo,
  useState,
  useTransition,
} from "react";
import type {
  Bookmark,
  BookmarkListView,
  Folder,
  PrivateVaultSummary,
  QualityGrade,
  Tag,
} from "@keeppage/domain";
import {
  ApiError,
  type BookmarkDetailResult,
} from "./api";
import {
  type ArchivePreviewState,
  type ArchiveViewMode,
  resolvePreviewSelection,
} from "./app/archive-preview";
import { AppShell } from "./app/app-shell";
import {
  buildAppUrl,
  copyTextToClipboard,
} from "./app/browser-utils";
import {
  ContextMenu,
  type ContextMenuGroup,
  type ContextMenuState,
} from "./app/context-menu";
import {
  LocalArchiveDialog,
  type LocalArchiveDialogState,
} from "./app/local-archive-dialog";
import {
  isManagerDialogOpen,
  ManagerDialog,
  type ManagerDialogState,
} from "./app/manager-dialog";
import {
  buildDetailHash,
  buildPrivateDetailHash,
  goToApiTokens,
  goToExtensionDevices,
  goToImportList,
  goToImportNew,
  goToList,
  goToPrivateMode,
  goToShares,
  openBookmark,
  openImportTask,
  openPrivateBookmark,
  parsePublicShareToken,
  parseRoute,
  type ViewRoute,
} from "./app/routes";
import {
  clearStoredToken,
  getStoredToken,
  setStoredToken,
  type SessionState,
  toErrorMessage,
} from "./app/session";
import {
  getStoredListUiVersion,
  setStoredListUiVersion,
  type ListUiVersion,
} from "./app/list-ui-preference";
import type { ImportPanelAdapter } from "./features/imports";
import { BookmarksListRoute } from "./features/bookmarks/list";
import { useDebouncedValue } from "./hooks/use-debounced-value";
import {
  readCachedBookmarkList,
  writeCachedBookmarkList,
} from "./lib/bookmark-list-cache";
import { type AppDataSource, useAppDataSource } from "./data-sources/use-app-data-source";
import { Icon } from "./components/Icon";

const BookmarkDetailRoute = lazy(async () => {
  const module = await import("./features/bookmarks/detail");
  return { default: module.BookmarkDetailRoute };
});

const ImportNewPanel = lazy(async () => {
  const module = await import("./features/imports");
  return { default: module.ImportNewPanel };
});

const ImportHistoryPanel = lazy(async () => {
  const module = await import("./features/imports");
  return { default: module.ImportHistoryPanel };
});

const ImportDetailPanel = lazy(async () => {
  const module = await import("./features/imports");
  return { default: module.ImportDetailPanel };
});

const PrivateModePage = lazy(async () => {
  const module = await import("./features/private");
  return { default: module.PrivateModePage };
});

const PrivateDetailPage = lazy(async () => {
  const module = await import("./features/private");
  return { default: module.PrivateDetailPage };
});

const ApiTokensPanel = lazy(async () => {
  const module = await import("./features/api-tokens");
  return { default: module.ApiTokensPanel };
});

const ExtensionDevicesPanel = lazy(async () => {
  const module = await import("./features/extension-devices");
  return { default: module.ExtensionDevicesPanel };
});

const ExtensionConnectPage = lazy(async () => {
  const module = await import("./features/extension-connect");
  return { default: module.ExtensionConnectPage };
});

const SharesPanel = lazy(async () => {
  const module = await import("./features/shares");
  return { default: module.SharesPanel };
});

const CreateShareDialog = lazy(async () => {
  const module = await import("./features/shares");
  return { default: module.CreateShareDialog };
});

const PublicSharePage = lazy(async () => {
  const module = await import("./features/shares");
  return { default: module.PublicSharePage };
});

type QualityFilter = "all" | QualityGrade;
type LoadState = "idle" | "loading" | "ready" | "error";
type DetailLoadState = "idle" | "loading" | "ready" | "not-found" | "error";
type AuthMode = "login" | "register";

type InlineFeedback = {
  kind: "success" | "error";
  message: string;
};

const BOOKMARKS_PAGE_SIZE = 24;

function AuthPanel({
  isDemoMode,
  mode,
  name,
  email,
  password,
  submitting,
  error,
  onModeChange,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: {
  isDemoMode: boolean;
  mode: AuthMode;
  name: string;
  email: string;
  password: string;
  submitting: boolean;
  error: string | null;
  onModeChange: (mode: AuthMode) => void;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isRegister = mode === "register";
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>{isRegister ? "创建账号" : "登录"}</h1>

        <div className="auth-switch">
          <button
            className={mode === "login" ? "auth-switch-btn is-active" : "auth-switch-btn"}
            type="button"
            onClick={() => onModeChange("login")}
          >
            登录
          </button>
          <button
            className={mode === "register" ? "auth-switch-btn is-active" : "auth-switch-btn"}
            type="button"
            onClick={() => onModeChange("register")}
          >
            注册
          </button>
        </div>

        <form className="auth-form" onSubmit={onSubmit}>
          {isRegister ? (
            <label className="field">
              <input
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="昵称（可选）"
              />
            </label>
          ) : null}
          <label className="field">
            <input
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder={isDemoMode ? "邮箱（演示模式可留空）" : "邮箱"}
              autoComplete="email"
              required={!isDemoMode}
            />
          </label>
          <label className="field">
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder={isDemoMode ? "密码（演示模式不校验）" : isRegister ? "密码（至少 8 位）" : "密码"}
              autoComplete={isRegister ? "new-password" : "current-password"}
              required={!isDemoMode}
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="primary-button auth-submit" type="submit" disabled={submitting}>
            {submitting ? "提交中..." : isRegister ? "注册" : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}

export function App({
  dataSourceKind = "live",
}: {
  dataSourceKind?: "live" | "demo";
}) {
  const publicShareToken = useMemo(
    () => parsePublicShareToken(window.location.pathname),
    [],
  );
  const appDataSource = useAppDataSource(dataSourceKind);
  const isDemoMode = appDataSource.kind === "demo";
  const [route, setRoute] = useState<ViewRoute>(() => parseRoute(window.location.hash));
  const [session, setSession] = useState<SessionState>({
    status: "booting",
    token: null,
    user: null,
    error: null,
  });
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [bookmarkView, setBookmarkView] = useState<BookmarkListView>("all");
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [selectedTagId, setSelectedTagId] = useState("");
  const [items, setItems] = useState<Bookmark[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [sidebarFolderCounts, setSidebarFolderCounts] = useState<Record<string, number>>({});
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [listError, setListError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detail, setDetail] = useState<BookmarkDetailResult | null>(null);
  const [detailLoadState, setDetailLoadState] = useState<DetailLoadState>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [archivePreview, setArchivePreview] = useState<ArchivePreviewState>({
    status: "idle",
  });
  const [preferredPreviewMode, setPreferredPreviewMode] = useState<ArchiveViewMode>("reader");
  const [privateSummary, setPrivateSummary] = useState<PrivateVaultSummary | null>(null);
  const [privateToken, setPrivateToken] = useState<string | null>(null);
  const [privateItems, setPrivateItems] = useState<Bookmark[]>([]);
  const [privateLoadState, setPrivateLoadState] = useState<LoadState>("idle");
  const [privateError, setPrivateError] = useState<string | null>(null);
  const [privateSetupPassword, setPrivateSetupPassword] = useState("");
  const [privateSetupConfirm, setPrivateSetupConfirm] = useState("");
  const [privateUnlockPassword, setPrivateUnlockPassword] = useState("");
  const [privatePasswordChangeLogin, setPrivatePasswordChangeLogin] = useState("");
  const [privatePasswordChangeNew, setPrivatePasswordChangeNew] = useState("");
  const [privatePasswordChangeConfirm, setPrivatePasswordChangeConfirm] = useState("");
  const [privatePasswordChangeMessage, setPrivatePasswordChangeMessage] = useState<string | null>(null);
  const [privateBusy, setPrivateBusy] = useState(false);
  const [privateDetail, setPrivateDetail] = useState<BookmarkDetailResult | null>(null);
  const [privateDetailLoadState, setPrivateDetailLoadState] = useState<DetailLoadState>("idle");
  const [privateDetailError, setPrivateDetailError] = useState<string | null>(null);
  const [privateArchivePreview, setPrivateArchivePreview] = useState<ArchivePreviewState>({
    status: "idle",
  });
  const [privatePreferredPreviewMode, setPrivatePreferredPreviewMode] = useState<ArchiveViewMode>("reader");
  const [managerBusy, setManagerBusy] = useState(false);
  const [managerFeedback, setManagerFeedback] = useState<InlineFeedback | null>(null);
  const [managerDialog, setManagerDialog] = useState<ManagerDialogState>({ kind: "closed" });
  const [managerDialogName, setManagerDialogName] = useState("");
  const [managerDialogPath, setManagerDialogPath] = useState("");
  const [managerDialogColor, setManagerDialogColor] = useState("");
  const [managerDialogError, setManagerDialogError] = useState<string | null>(null);
  const [metadataNote, setMetadataNote] = useState("");
  const [metadataIsFavorite, setMetadataIsFavorite] = useState(false);
  const [metadataFolderId, setMetadataFolderId] = useState("");
  const [metadataTagIds, setMetadataTagIds] = useState<string[]>([]);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataFeedback, setMetadataFeedback] = useState<InlineFeedback | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ kind: "closed" });
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Survives list filters so share create keeps full multi-select set. */
  const [selectionCatalog, setSelectionCatalog] = useState<
    Map<string, { id: string; title: string; domain: string; sourceUrl: string }>
  >(() => new Map());
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [batchDropdown, setBatchDropdown] = useState<"closed" | "folder" | "tag">("closed");
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [localArchiveDialog, setLocalArchiveDialog] = useState<LocalArchiveDialogState>({ step: "closed" });
  const [localArchiveBusy, setLocalArchiveBusy] = useState(false);
  const [localArchiveError, setLocalArchiveError] = useState<string | null>(null);
  const [listUiVersion, setListUiVersion] = useState<ListUiVersion>(() => {
    if (typeof window === "undefined") {
      return "brand";
    }
    return getStoredListUiVersion();
  });
  const [isPending, startTransition] = useTransition();

  const handleListUiVersionChange = useCallback((version: ListUiVersion) => {
    setListUiVersion(version);
    setStoredListUiVersion(version);
  }, []);

  const debouncedSearch = useDebouncedValue(searchInput, 200);
  const deferredSearch = useDeferredValue(debouncedSearch);
  const authToken = session.status === "authenticated" ? session.token : null;
  const logoutLabel = appDataSource.logoutLabel;
  const isManagerDialogVisible = isManagerDialogOpen(managerDialog);
  const activeBookmarkContextId = contextMenu.kind === "bookmark" ? contextMenu.bookmark.id : null;
  const activeFolderContextId = contextMenu.kind === "folder" ? contextMenu.folder.id : null;
  const activeTagContextId = contextMenu.kind === "tag" ? contextMenu.tag.id : null;
  const hasMoreItems = items.length < listTotal;
  const importAdapter = appDataSource.importAdapter;

  function clearPrivateState() {
    setPrivateToken(null);
    setPrivateSummary(null);
    setPrivateItems([]);
    setPrivateLoadState("idle");
    setPrivateError(null);
    setPrivateSetupPassword("");
    setPrivateSetupConfirm("");
    setPrivateUnlockPassword("");
    setPrivateBusy(false);
    setPrivateDetail(null);
    setPrivateDetailLoadState("idle");
    setPrivateDetailError(null);
    setPrivateArchivePreview({ status: "idle" });
    setPrivatePreferredPreviewMode("reader");
  }

  function logout(message?: string) {
    if (isDemoMode) {
      const nextSession = appDataSource.resetSession();
      goToList();
      startTransition(() => {
        if (!nextSession) {
          return;
        }
        setSession({
          status: "authenticated",
          token: nextSession.token,
          user: nextSession.user,
          error: null,
        });
        setSearchInput("");
        setBookmarkView("all");
        setQualityFilter("all");
        setSelectedFolderId("");
        setSelectedTagId("");
        setDetail(null);
        setLoadState("idle");
        setListError(null);
        setDetailLoadState("idle");
        setDetailError(null);
        setArchivePreview({ status: "idle" });
        clearPrivateState();
        setManagerFeedback({
          kind: "success",
          message: "Mock 数据已重置到初始状态。",
        });
        setManagerDialog({ kind: "closed" });
        setContextMenu({ kind: "closed" });
        setManagerDialogError(null);
        setMetadataFeedback(null);
      });
      return;
    }

    clearStoredToken();
    goToList();
    startTransition(() => {
      setSession({
        status: "anonymous",
        token: null,
        user: null,
        error: message ?? null,
      });
      setItems([]);
      setSidebarFolderCounts({});
      setFolders([]);
      setTags([]);
      setBookmarkView("all");
      setSelectedFolderId("");
      setSelectedTagId("");
      setDetail(null);
      setLoadState("idle");
      setListError(null);
      setDetailLoadState("idle");
      setDetailError(null);
      setArchivePreview({ status: "idle" });
      clearPrivateState();
      setManagerFeedback(null);
      setManagerDialog({ kind: "closed" });
      setContextMenu({ kind: "closed" });
      setManagerDialogError(null);
      setMetadataFeedback(null);
    });
  }

  function closeManagerDialog() {
    setManagerDialog({ kind: "closed" });
    setManagerDialogError(null);
  }

  function closeContextMenu() {
    setContextMenu({ kind: "closed" });
  }

  function rememberSelectionCatalog(bookmarks: Bookmark[]) {
    setSelectionCatalog((prev) => {
      const next = new Map(prev);
      for (const bookmark of bookmarks) {
        next.set(bookmark.id, {
          id: bookmark.id,
          title: bookmark.title,
          domain: bookmark.domain.replace(/^www\./i, ""),
          sourceUrl: bookmark.sourceUrl,
        });
      }
      return next;
    });
  }

  function enterSelectionMode(bookmarkId?: string) {
    setSelectionMode(true);
    setBatchDropdown("closed");
    if (bookmarkId) {
      setSelectedIds(new Set([bookmarkId]));
      const bookmark = items.find((item) => item.id === bookmarkId);
      if (bookmark) {
        rememberSelectionCatalog([bookmark]);
      }
    } else {
      setSelectedIds(new Set());
      setSelectionCatalog(new Map());
    }
    closeContextMenu();
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setSelectionCatalog(new Map());
    setBatchDropdown("closed");
  }

  const toggleSelected = useCallback((bookmarkId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookmarkId)) {
        next.delete(bookmarkId);
      } else {
        next.add(bookmarkId);
      }
      return next;
    });
    setSelectionCatalog((prev) => {
      const next = new Map(prev);
      if (next.has(bookmarkId)) {
        // Keep catalog entry even if deselected so re-selecting still has title/domain.
        // Entries are pruned on exitSelectionMode.
        return next;
      }
      const bookmark = items.find((item) => item.id === bookmarkId);
      if (bookmark) {
        next.set(bookmark.id, {
          id: bookmark.id,
          title: bookmark.title,
          domain: bookmark.domain.replace(/^www\./i, ""),
          sourceUrl: bookmark.sourceUrl,
        });
      }
      return next;
    });
  }, [items]);

  function selectAllBookmarks() {
    setSelectedIds(new Set(items.map((b) => b.id)));
    rememberSelectionCatalog(items);
  }

  function deselectAllBookmarks() {
    setSelectedIds(new Set());
  }

  function openLocalArchiveDialog(bookmarks: Bookmark[]) {
    setLocalArchiveError(null);
    setLocalArchiveBusy(false);
    setLocalArchiveDialog({
      step: "confirm",
      bookmarks,
    });
  }

  function closeLocalArchiveDialog() {
    if (localArchiveBusy) {
      return;
    }
    setLocalArchiveDialog({ step: "closed" });
    setLocalArchiveError(null);
  }

  function openManagerDialog(nextState: ManagerDialogState) {
    setManagerDialog(nextState);
    setManagerDialogError(null);
  }

  const openBookmarkContextMenuAt = useCallback((bookmark: Bookmark, x: number, y: number) => {
    setContextMenu({
      kind: "bookmark",
      bookmark,
      x,
      y,
    });
  }, []);

  const openBookmarkContextMenu = useCallback((bookmark: Bookmark, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    openBookmarkContextMenuAt(bookmark, event.clientX, event.clientY);
  }, [openBookmarkContextMenuAt]);

  function openFolderContextMenu(folder: Folder, event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: "folder",
      folder,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function openTagContextMenu(tag: Tag, event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: "tag",
      tag,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function pushHomeFeedback(kind: InlineFeedback["kind"], message: string) {
    setManagerFeedback({ kind, message });
  }

  async function handleCopySuccess(value: string, successMessage: string) {
    try {
      await copyTextToClipboard(value);
      pushHomeFeedback("success", successMessage);
    } catch (error) {
      pushHomeFeedback("error", toErrorMessage(error));
    }
  }

  function handleProtectedApiError(error: unknown) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      logout(error.message);
      return true;
    }
    return false;
  }

  function handlePrivateModeApiError(error: unknown) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403) &&
      /(私密|密码|PrivateMode|locked)/i.test(error.message)
    ) {
      setPrivateToken(null);
      setPrivateItems([]);
      setPrivateDetail(null);
      setPrivateArchivePreview({ status: "idle" });
      setPrivateError("私密模式已锁定或会话已失效，请重新输入密码。");
      if (route.page === "private-detail") {
        goToPrivateMode();
      }
      return true;
    }
    return handleProtectedApiError(error);
  }

  function applyWorkspaceBootstrap(
    payload: Awaited<ReturnType<AppDataSource["fetchWorkspaceBootstrap"]>>,
  ) {
    setFolders(payload.folders);
    setTags(payload.tags);
    setSidebarFolderCounts(payload.folderCounts.reduce<Record<string, number>>((accumulator, item) => {
      accumulator[item.folderId] = item.count;
      return accumulator;
    }, {}));
    setSelectedFolderId((current) => (
      current && !payload.folders.some((folder) => folder.id === current) ? "" : current
    ));
    setSelectedTagId((current) => (
      current && !payload.tags.some((tag) => tag.id === current) ? "" : current
    ));
  }

  useEffect(() => {
    closeContextMenu();
  }, [route]);

  useEffect(() => {
    if (isManagerDialogVisible) {
      closeContextMenu();
    }
  }, [isManagerDialogVisible]);

  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = "#/";
    }

    const handleHashChange = () => {
      setRoute(parseRoute(window.location.hash));
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    appDataSource.restoreSession(getStoredToken())
      .then((nextSession) => {
        if (cancelled) {
          return;
        }
        if (nextSession.status === "anonymous") {
          clearStoredToken();
        }
        setSession(nextSession);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        clearStoredToken();
        setSession({
          status: "anonymous",
          token: null,
          user: null,
          error: toErrorMessage(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [appDataSource]);

  useEffect(() => {
    if (!authToken) {
      setPrivateSummary(null);
      setPrivateToken(null);
      setPrivateItems([]);
      setPrivateLoadState("idle");
      setPrivateError(null);
      return;
    }

    let cancelled = false;
    appDataSource.fetchPrivateModeStatus(authToken, privateToken ?? undefined)
      .then((summary) => {
        if (cancelled) {
          return;
        }
        setPrivateSummary(summary);
        if (!summary.unlocked) {
          setPrivateToken(null);
        }
      })
      .catch((error) => {
        if (cancelled || handleProtectedApiError(error)) {
          return;
        }
        setPrivateSummary(null);
        setPrivateError(toErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [appDataSource, authToken, privateToken]);

  useEffect(() => {
    if (!authToken) {
      setFolders([]);
      setTags([]);
      setSidebarFolderCounts({});
      setManagerFeedback(null);
      return;
    }

    let cancelled = false;
    appDataSource.fetchWorkspaceBootstrap(authToken)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        applyWorkspaceBootstrap(payload);
      })
      .catch((error) => {
        if (cancelled || handleProtectedApiError(error)) {
          return;
        }
        setManagerFeedback({
          kind: "error",
          message: toErrorMessage(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [appDataSource, authToken]);

  useEffect(() => {
    if (!authToken) {
      setItems([]);
      setListTotal(0);
      setLoadState("idle");
      setListError(null);
      setLoadMoreError(null);
      setLoadingMore(false);
      return;
    }

    let cancelled = false;
    setListError(null);
    setLoadMoreError(null);
    setLoadingMore(false);

    const query = {
      search: deferredSearch,
      quality: qualityFilter,
      view: bookmarkView,
      folderId: selectedFolderId || undefined,
      tagId: selectedTagId || undefined,
      limit: BOOKMARKS_PAGE_SIZE,
      offset: 0,
    };
    const cached = appDataSource.kind === "live" ? readCachedBookmarkList(query) : null;
    if (cached) {
      setItems(cached.items);
      setListTotal(cached.total);
      setLoadState("ready");
    } else {
      setLoadState("loading");
    }

    appDataSource.searchBookmarks(query, authToken)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (appDataSource.kind === "live") {
          writeCachedBookmarkList(query, result);
        }
        startTransition(() => {
          setItems(result.items);
          setListTotal(result.total);
          setLoadState("ready");
        });
      })
      .catch((error) => {
        if (cancelled || handleProtectedApiError(error)) {
          return;
        }
        startTransition(() => {
          setItems([]);
          setListTotal(0);
          setLoadState("error");
          setListError(toErrorMessage(error));
        });
      });

    return () => {
      cancelled = true;
    };
  }, [appDataSource, authToken, bookmarkView, deferredSearch, qualityFilter, selectedFolderId, selectedTagId]);

  useEffect(() => {
    if (!authToken || route.page !== "detail") {
      setDetailLoadState("idle");
      setDetailError(null);
      setDetail(null);
      return;
    }

    let cancelled = false;
    setDetailLoadState("loading");
    setDetailError(null);

    appDataSource.fetchBookmarkDetail(route.bookmarkId, authToken)
      .then((result) => {
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setDetail(result);
          setDetailLoadState(result ? "ready" : "not-found");
        });
      })
      .catch((error) => {
        if (cancelled || handleProtectedApiError(error)) {
          return;
        }
        startTransition(() => {
          setDetail(null);
          setDetailLoadState("error");
          setDetailError(toErrorMessage(error));
        });
      });

    return () => {
      cancelled = true;
    };
  }, [appDataSource, authToken, route]);

  useEffect(() => {
    if (!authToken || route.page !== "private-mode" || !privateToken) {
      setPrivateLoadState("idle");
      setPrivateError((current) => (
        route.page === "private-detail" ? current : null
      ));
      if (route.page !== "private-mode") {
        setPrivateItems([]);
      }
      return;
    }

    let cancelled = false;
    setPrivateLoadState("loading");
    setPrivateError(null);

    appDataSource.searchPrivateBookmarks(
      {
        search: deferredSearch,
        quality: qualityFilter,
        view: bookmarkView,
        limit: BOOKMARKS_PAGE_SIZE,
        offset: 0,
      },
      authToken,
      privateToken,
    )
      .then((result) => {
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setPrivateItems(result.items);
          setPrivateLoadState("ready");
        });
      })
      .catch((error) => {
        if (cancelled || handlePrivateModeApiError(error)) {
          return;
        }
        startTransition(() => {
          setPrivateItems([]);
          setPrivateLoadState("error");
          setPrivateError(toErrorMessage(error));
        });
      });

    return () => {
      cancelled = true;
    };
  }, [appDataSource, authToken, bookmarkView, deferredSearch, privateToken, qualityFilter, route.page]);

  useEffect(() => {
    if (!authToken || route.page !== "private-detail" || !privateToken) {
      setPrivateDetailLoadState("idle");
      setPrivateDetailError(null);
      setPrivateDetail(null);
      return;
    }

    let cancelled = false;
    setPrivateDetailLoadState("loading");
    setPrivateDetailError(null);

    appDataSource.fetchPrivateBookmarkDetail(route.bookmarkId, authToken, privateToken)
      .then((result) => {
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setPrivateDetail(result);
          setPrivateDetailLoadState(result ? "ready" : "not-found");
        });
      })
      .catch((error) => {
        if (cancelled || handlePrivateModeApiError(error)) {
          return;
        }
        startTransition(() => {
          setPrivateDetail(null);
          setPrivateDetailLoadState("error");
          setPrivateDetailError(toErrorMessage(error));
        });
      });

    return () => {
      cancelled = true;
    };
  }, [appDataSource, authToken, privateToken, route]);

  useEffect(() => {
    if (!detail) {
      setMetadataNote("");
      setMetadataIsFavorite(false);
      setMetadataFolderId("");
      setMetadataTagIds([]);
      setMetadataFeedback(null);
      return;
    }
    setMetadataNote(detail.bookmark.note);
    setMetadataIsFavorite(detail.bookmark.isFavorite);
    setMetadataFolderId(detail.bookmark.folder?.id ?? "");
    setMetadataTagIds(detail.bookmark.tags.map((tag) => tag.id));
    setMetadataFeedback(null);
  }, [detail]);

  useEffect(() => {
    setManagerDialogError(null);
    if (managerDialog.kind === "create-folder") {
      setManagerDialogName("");
      setManagerDialogPath("");
      setManagerDialogColor("");
      return;
    }
    if (managerDialog.kind === "edit-folder") {
      setManagerDialogName("");
      setManagerDialogPath(managerDialog.folder.path);
      setManagerDialogColor("");
      return;
    }
    if (managerDialog.kind === "create-tag") {
      setManagerDialogName("");
      setManagerDialogPath("");
      setManagerDialogColor("");
      return;
    }
    if (managerDialog.kind === "edit-tag") {
      setManagerDialogName(managerDialog.tag.name);
      setManagerDialogPath("");
      setManagerDialogColor(managerDialog.tag.color ?? "");
      return;
    }
    setManagerDialogName("");
    setManagerDialogPath("");
    setManagerDialogColor("");
  }, [managerDialog]);

  useEffect(() => {
    if (!isManagerDialogVisible) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !managerBusy) {
        closeManagerDialog();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [isManagerDialogVisible, managerBusy]);

  useEffect(() => {
    if (!selectionMode) {
      return;
    }
    const handleSelectionKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !selectionBusy) {
        exitSelectionMode();
      }
    };
    window.addEventListener("keydown", handleSelectionKeyDown);
    return () => {
      window.removeEventListener("keydown", handleSelectionKeyDown);
    };
  }, [selectionMode, selectionBusy]);

  const selectedVersion = useMemo(() => {
    if (!detail || route.page !== "detail") {
      return null;
    }

    return (
      detail.versions.find((version) => version.id === route.versionId) ??
      detail.versions.find((version) => version.id === detail.bookmark.latestVersionId) ??
      detail.versions[0] ??
      null
    );
  }, [detail, route]);

  const selectedPrivateVersion = useMemo(() => {
    if (!privateDetail || route.page !== "private-detail") {
      return null;
    }

    return (
      privateDetail.versions.find((version) => version.id === route.versionId) ??
      privateDetail.versions.find((version) => version.id === privateDetail.bookmark.latestVersionId) ??
      privateDetail.versions[0] ??
      null
    );
  }, [privateDetail, route]);

  const previewSourceUrl = detail
    ? (detail.bookmark.canonicalUrl ?? detail.bookmark.sourceUrl)
    : null;
  const previewSelection = useMemo(
    () => resolvePreviewSelection(selectedVersion, preferredPreviewMode),
    [preferredPreviewMode, selectedVersion],
  );
  const privatePreviewSourceUrl = privateDetail
    ? (privateDetail.bookmark.canonicalUrl ?? privateDetail.bookmark.sourceUrl)
    : null;
  const privatePreviewSelection = useMemo(
    () => resolvePreviewSelection(selectedPrivateVersion, privatePreferredPreviewMode),
    [privatePreferredPreviewMode, selectedPrivateVersion],
  );

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;

    if (!authToken || !previewSelection?.objectKey || !previewSourceUrl) {
      setArchivePreview({ status: "idle" });
      return;
    }

    setArchivePreview({ status: "loading" });

    appDataSource.createArchivePreviewUrl(
      selectedVersion?.id ?? null,
      previewSelection?.objectKey ?? null,
      previewSourceUrl,
      authToken,
    )
      .then((url) => {
        if (!url) {
          setArchivePreview({ status: "idle" });
          return;
        }
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revokedUrl = url;
        setArchivePreview({
          status: "ready",
          url,
        });
      })
      .catch((error) => {
        if (cancelled || handleProtectedApiError(error)) {
          return;
        }
        if (
          error instanceof ApiError &&
          error.status === 404 &&
          previewSelection?.mode === "reader" &&
          selectedVersion?.archiveAvailable
        ) {
          setPreferredPreviewMode("original");
          return;
        }
        setArchivePreview({
          status: "error",
          error: toErrorMessage(error),
        });
      });

    return () => {
      cancelled = true;
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
    };
  }, [
    appDataSource,
    authToken,
    previewSelection?.objectKey,
    previewSelection?.mode,
    previewSourceUrl,
    selectedVersion?.id,
  ]);

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;

    if (!authToken || !privateToken || !privatePreviewSelection?.objectKey || !privatePreviewSourceUrl) {
      setPrivateArchivePreview({ status: "idle" });
      return;
    }

    setPrivateArchivePreview({ status: "loading" });

    appDataSource.createArchivePreviewUrl(
      selectedPrivateVersion?.id ?? null,
      privatePreviewSelection?.objectKey ?? null,
      privatePreviewSourceUrl,
      authToken,
      privateToken,
    )
      .then((url) => {
        if (!url) {
          setPrivateArchivePreview({ status: "idle" });
          return;
        }
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revokedUrl = url;
        setPrivateArchivePreview({
          status: "ready",
          url,
        });
      })
      .catch((error) => {
        if (cancelled || handlePrivateModeApiError(error)) {
          return;
        }
        if (
          error instanceof ApiError &&
          error.status === 404 &&
          privatePreviewSelection?.mode === "reader" &&
          selectedPrivateVersion?.archiveAvailable
        ) {
          setPrivatePreferredPreviewMode("original");
          return;
        }
        setPrivateArchivePreview({
          status: "error",
          error: toErrorMessage(error),
        });
      });

    return () => {
      cancelled = true;
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
    };
  }, [
    appDataSource,
    authToken,
    privatePreviewSelection?.objectKey,
    privatePreviewSelection?.mode,
    privatePreviewSourceUrl,
    privateToken,
    selectedPrivateVersion?.id,
  ]);

  async function refreshSidebarFolderCounts(currentToken: string) {
    const nextCounts = await appDataSource.fetchBookmarkFolderCounts(currentToken);
    setSidebarFolderCounts(nextCounts);
  }

  async function refreshCatalogs(currentToken: string) {
    const [nextFolders, nextTags] = await Promise.all([
      appDataSource.fetchFolders(currentToken),
      appDataSource.fetchTags(currentToken),
    ]);
    setFolders(nextFolders);
    setTags(nextTags);
    setSelectedFolderId((current) => (
      current && !nextFolders.some((folder) => folder.id === current) ? "" : current
    ));
    setSelectedTagId((current) => (
      current && !nextTags.some((tag) => tag.id === current) ? "" : current
    ));
  }

  async function refreshBookmarksList(currentToken: string) {
    const limit = Math.max(items.length, BOOKMARKS_PAGE_SIZE);
    const result = await appDataSource.searchBookmarks(
      {
        search: deferredSearch,
        quality: qualityFilter,
        view: bookmarkView,
        folderId: selectedFolderId || undefined,
        tagId: selectedTagId || undefined,
        limit,
        offset: 0,
      },
      currentToken,
    );
    setListError(null);
    setLoadMoreError(null);
    setItems(result.items);
    setListTotal(result.total);
    setLoadingMore(false);
    setLoadState("ready");
  }

  async function loadMoreBookmarks() {
    if (loadingMore || loadState !== "ready" || !hasMoreItems) {
      return;
    }

    setLoadMoreError(null);
    setLoadingMore(true);

    if (!authToken) {
      setLoadingMore(false);
      return;
    }

    try {
      const result = await appDataSource.searchBookmarks(
        {
          search: deferredSearch,
          quality: qualityFilter,
          view: bookmarkView,
          folderId: selectedFolderId || undefined,
          tagId: selectedTagId || undefined,
          limit: BOOKMARKS_PAGE_SIZE,
          offset: items.length,
        },
        authToken,
      );
      setItems((current) => {
        const existingIds = new Set(current.map((item) => item.id));
        const nextItems = result.items.filter((item) => !existingIds.has(item.id));
        return [...current, ...nextItems];
      });
      setListTotal(result.total);
    } catch (error) {
      if (!handleProtectedApiError(error)) {
        setLoadMoreError(toErrorMessage(error));
      }
    } finally {
      setLoadingMore(false);
    }
  }

  async function refreshBookmarkDetail(currentToken: string, bookmarkId: string) {
    const result = await appDataSource.fetchBookmarkDetail(bookmarkId, currentToken);
    setDetailError(null);
    setDetail(result);
    setDetailLoadState(result ? "ready" : "not-found");
  }

  async function refreshPrivateSummary(currentToken: string, currentPrivateToken?: string | null) {
    const summary = await appDataSource.fetchPrivateModeStatus(currentToken, currentPrivateToken ?? undefined);
    setPrivateSummary(summary);
    if (!summary.unlocked) {
      setPrivateToken(null);
    }
    return summary;
  }

  async function refreshPrivateBookmarksList(currentToken: string, currentPrivateToken: string) {
    const limit = Math.max(privateItems.length, BOOKMARKS_PAGE_SIZE);
    const result = await appDataSource.searchPrivateBookmarks(
      {
        search: deferredSearch,
        quality: qualityFilter,
        view: bookmarkView,
        limit,
        offset: 0,
      },
      currentToken,
      currentPrivateToken,
    );
    setPrivateItems(result.items);
    setPrivateLoadState("ready");
    setPrivateError(null);
  }

  async function refreshPrivateBookmarkDetail(
    currentToken: string,
    currentPrivateToken: string,
    bookmarkId: string,
  ) {
    const result = await appDataSource.fetchPrivateBookmarkDetail(bookmarkId, currentToken, currentPrivateToken);
    setPrivateDetail(result);
    setPrivateDetailLoadState(result ? "ready" : "not-found");
    setPrivateDetailError(null);
  }

  async function handleSetupPrivateMode() {
    if (!authToken) {
      return;
    }
    const password = privateSetupPassword.trim();
    if (password.length < 8) {
      setPrivateError("私密密码至少需要 8 位。");
      return;
    }
    if (password !== privateSetupConfirm) {
      setPrivateError("两次输入的私密密码不一致。");
      return;
    }

    setPrivateBusy(true);
    setPrivateError(null);
    try {
      const result = await appDataSource.setupPrivateMode(password, authToken);
      setPrivateSummary(result.summary);
      setPrivateToken(result.privateToken);
      setPrivateSetupPassword("");
      setPrivateSetupConfirm("");
      setPrivateUnlockPassword("");
      setPrivatePasswordChangeMessage(null);
      await refreshPrivateBookmarksList(authToken, result.privateToken);
    } catch (error) {
      if (handleProtectedApiError(error)) {
        return;
      }
      setPrivateError(toErrorMessage(error));
    } finally {
      setPrivateBusy(false);
    }
  }

  async function handleUnlockPrivateMode() {
    if (!authToken) {
      return;
    }
    if (!privateUnlockPassword) {
      setPrivateError("请输入私密密码。");
      return;
    }

    setPrivateBusy(true);
    setPrivateError(null);
    try {
      const result = await appDataSource.unlockPrivateMode(privateUnlockPassword, authToken);
      setPrivateSummary(result.summary);
      setPrivateToken(result.privateToken);
      setPrivateUnlockPassword("");
      setPrivatePasswordChangeMessage(null);
      await refreshPrivateBookmarksList(authToken, result.privateToken);
    } catch (error) {
      if (handleProtectedApiError(error)) {
        return;
      }
      setPrivateError(toErrorMessage(error));
    } finally {
      setPrivateBusy(false);
    }
  }

  async function handleLockPrivateMode() {
    if (!authToken) {
      return;
    }

    setPrivateBusy(true);
    setPrivateError(null);
    try {
      const summary = await appDataSource.lockPrivateMode(authToken);
      setPrivateSummary(summary);
      setPrivateToken(null);
      setPrivateItems([]);
      setPrivateDetail(null);
      setPrivateArchivePreview({ status: "idle" });
      setPrivateDetailLoadState("idle");
      setPrivateDetailError(null);
      setPrivateUnlockPassword("");
      setPrivatePasswordChangeLogin("");
      setPrivatePasswordChangeNew("");
      setPrivatePasswordChangeConfirm("");
      setPrivatePasswordChangeMessage(null);
      if (route.page === "private-detail") {
        goToPrivateMode();
      }
    } catch (error) {
      if (handleProtectedApiError(error)) {
        return;
      }
      setPrivateError(toErrorMessage(error));
    } finally {
      setPrivateBusy(false);
    }
  }

  async function handleChangePrivatePassword() {
    if (!authToken) {
      return;
    }
    const nextPassword = privatePasswordChangeNew.trim();
    if (!privatePasswordChangeLogin) {
      setPrivateError("请输入当前账号登录密码。");
      return;
    }
    if (nextPassword.length < 8) {
      setPrivateError("新的私密密码至少需要 8 位。");
      return;
    }
    if (nextPassword !== privatePasswordChangeConfirm) {
      setPrivateError("两次输入的新私密密码不一致。");
      return;
    }

    setPrivateBusy(true);
    setPrivateError(null);
    setPrivatePasswordChangeMessage(null);
    try {
      const result = await appDataSource.changePrivateModePassword({
        loginPassword: privatePasswordChangeLogin,
        newPassword: nextPassword,
      }, authToken);
      setPrivateSummary(result.summary);
      setPrivateToken(result.privateToken);
      setPrivatePasswordChangeLogin("");
      setPrivatePasswordChangeNew("");
      setPrivatePasswordChangeConfirm("");
      setPrivateUnlockPassword("");
      setPrivatePasswordChangeMessage("私密密码已更新。");
      await refreshPrivateBookmarksList(authToken, result.privateToken);
    } catch (error) {
      if (handleProtectedApiError(error)) {
        return;
      }
      setPrivateError(toErrorMessage(error));
    } finally {
      setPrivateBusy(false);
    }
  }

  async function runManagerAction(action: () => Promise<string>) {
    if (!authToken) {
      throw new Error("当前未登录，暂时无法执行这个操作。");
    }
    setManagerBusy(true);
    setManagerFeedback(null);
    try {
      const message = await action();
      await refreshCatalogs(authToken);
      await refreshSidebarFolderCounts(authToken);
      await refreshBookmarksList(authToken);
      if (route.page === "detail") {
        await refreshBookmarkDetail(authToken, route.bookmarkId);
      }
      setManagerFeedback({
        kind: "success",
        message,
      });
    } catch (error) {
      if (handleProtectedApiError(error)) {
        throw error;
      }
      const message = toErrorMessage(error);
      setManagerFeedback({
        kind: "error",
        message,
      });
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setManagerBusy(false);
    }
  }

  async function handleDeleteBookmark(bookmark: Bookmark) {
    await runManagerAction(async () => {
      await appDataSource.deleteBookmark(bookmark.id, authToken!);
      if (route.page === "detail" && route.bookmarkId === bookmark.id) {
        goToList();
      }
      return `已删除书签：${bookmark.title}`;
    });
  }

  async function handleBatchDelete(ids: Set<string>) {
    if (ids.size === 0) return;
    setSelectionBusy(true);
    setManagerFeedback(null);
    try {
      const results = await Promise.allSettled(
        [...ids].map((id) => appDataSource.deleteBookmark(id, authToken!)),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        setManagerFeedback({
          kind: "error",
          message: `批量删除完成，但有 ${failed} 条失败。`,
        });
        await refreshSidebarFolderCounts(authToken!);
        await refreshBookmarksList(authToken!);
        exitSelectionMode();
        return;
      }
      await refreshSidebarFolderCounts(authToken!);
      await refreshBookmarksList(authToken!);
      setManagerFeedback({
        kind: "success",
        message: `已删除 ${ids.size} 个书签。`,
      });
      exitSelectionMode();
    } catch (error) {
      if (handleProtectedApiError(error)) return;
      setManagerFeedback({ kind: "error", message: toErrorMessage(error) });
    } finally {
      setSelectionBusy(false);
    }
  }

  async function handleBatchToggleFavorite(ids: Set<string>, isFavorite: boolean) {
    if (ids.size === 0) return;
    setSelectionBusy(true);
    setManagerFeedback(null);
    try {
      await Promise.allSettled(
        [...ids].map((id) => appDataSource.updateBookmarkMetadata(id, { isFavorite }, authToken!)),
      );
      await refreshSidebarFolderCounts(authToken!);
      await refreshBookmarksList(authToken!);
      setManagerFeedback({
        kind: "success",
        message: isFavorite
          ? `已将 ${ids.size} 个书签加入收藏。`
          : `已取消 ${ids.size} 个书签的收藏。`,
      });
      exitSelectionMode();
    } catch (error) {
      if (handleProtectedApiError(error)) return;
      setManagerFeedback({ kind: "error", message: toErrorMessage(error) });
    } finally {
      setSelectionBusy(false);
    }
  }

  function handleBatchLocalArchive(ids: Set<string>) {
    if (ids.size === 0) return;
    const selectedBookmarks = items.filter((bookmark) => ids.has(bookmark.id));
    openLocalArchiveDialog(selectedBookmarks);
  }

  async function confirmLocalArchiveDialog() {
    if (localArchiveDialog.step !== "confirm") {
      return;
    }
    setLocalArchiveBusy(true);
    setLocalArchiveError(null);
    try {
      if (!authToken) {
        throw new Error("当前未登录，无法发送本地存档任务。");
      }
      const result = await appDataSource.enqueueLocalArchive(localArchiveDialog.bookmarks);
      setLocalArchiveDialog({
        step: "done",
        totalCount: localArchiveDialog.bookmarks.length,
        acceptedCount: result.acceptedCount,
        skippedCount: result.skippedCount,
        queueSize: result.queueSize,
      });
      exitSelectionMode();
    } catch (error) {
      setLocalArchiveError(toErrorMessage(error));
    } finally {
      setLocalArchiveBusy(false);
    }
  }

  async function handleBatchMoveTo(ids: Set<string>, folderId: string | null) {
    if (ids.size === 0) return;
    setSelectionBusy(true);
    setManagerFeedback(null);
    try {
      await Promise.allSettled(
        [...ids].map((id) => appDataSource.updateBookmarkMetadata(id, { folderId }, authToken!)),
      );
      await refreshSidebarFolderCounts(authToken!);
      await refreshBookmarksList(authToken!);
      const folderName = folderId
        ? (folders.find((f) => f.id === folderId)?.name ?? "指定收藏夹")
        : "未归类";
      setManagerFeedback({
        kind: "success",
        message: `已将 ${ids.size} 个书签移动到「${folderName}」。`,
      });
      exitSelectionMode();
    } catch (error) {
      if (handleProtectedApiError(error)) return;
      setManagerFeedback({ kind: "error", message: toErrorMessage(error) });
    } finally {
      setSelectionBusy(false);
    }
  }

  async function handleBatchSetTags(ids: Set<string>, tagIds: string[]) {
    if (ids.size === 0) return;
    setSelectionBusy(true);
    setManagerFeedback(null);
    try {
      await Promise.allSettled(
        [...ids].map((id) => appDataSource.updateBookmarkMetadata(id, { tagIds }, authToken!)),
      );
      await refreshSidebarFolderCounts(authToken!);
      await refreshBookmarksList(authToken!);
      const tagName = tags.find((t) => t.id === tagIds[0])?.name ?? "标签";
      setManagerFeedback({
        kind: "success",
        message: `已为 ${ids.size} 个书签设置标签「${tagName}」。`,
      });
      exitSelectionMode();
    } catch (error) {
      if (handleProtectedApiError(error)) return;
      setManagerFeedback({ kind: "error", message: toErrorMessage(error) });
    } finally {
      setSelectionBusy(false);
    }
  }

  async function handleCreateFolder(name: string, parent?: Folder) {
    const trimmedName = name.trim();
    await runManagerAction(async () => {
      const folder = await appDataSource.createFolder({
        name: trimmedName,
        parentId: parent?.id ?? null,
      }, authToken!);
      return `已创建收藏夹：${folder.path}`;
    });
  }

  async function handleEditFolderPath(folder: Folder, nextPathInput: string) {
    const nextPath = nextPathInput
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);

    const nextName = nextPath[nextPath.length - 1] ?? folder.name;
    const parentPath = nextPath.slice(0, -1).join("/");
    const parent = parentPath ? folders.find((item) => item.path === parentPath) : undefined;
    if (parentPath && !parent) {
      throw new Error(`未找到父收藏夹路径：${parentPath}`);
    }

    await runManagerAction(async () => {
      const updated = await appDataSource.updateFolder(folder.id, {
        name: nextName,
        parentId: parent?.id ?? null,
      }, authToken!);
      return `已更新收藏夹路径：${updated.path}`;
    });
  }

  async function handleDeleteFolder(folder: Folder) {
    await runManagerAction(async () => {
      await appDataSource.deleteFolder(folder.id, authToken!);
      return `已删除收藏夹：${folder.path}`;
    });
  }

  async function handleCreateTag(name: string, color?: string) {
    const trimmedName = name.trim();
    await runManagerAction(async () => {
      const tag = await appDataSource.createTag({
        name: trimmedName,
        color,
      }, authToken!);
      return `已创建标签：#${tag.name}`;
    });
  }

  async function handleEditTag(tag: Tag, nextName: string, nextColorRaw: string) {
    await runManagerAction(async () => {
      const updated = await appDataSource.updateTag(tag.id, {
        name: nextName.trim(),
        color: nextColorRaw.trim() || null,
      }, authToken!);
      return `已更新标签：#${updated.name}`;
    });
  }

  async function handleDeleteTag(tag: Tag) {
    await runManagerAction(async () => {
      await appDataSource.deleteTag(tag.id, authToken!);
      return `已删除标签：#${tag.name}`;
    });
  }

  async function handleManagerDialogSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setManagerDialogError(null);

    try {
      if (managerDialog.kind === "create-folder") {
        const trimmedName = managerDialogName.trim();
        if (!trimmedName) {
          setManagerDialogError("收藏夹名称不能为空。");
          return;
        }
        if (trimmedName.includes("/")) {
          setManagerDialogError("收藏夹名称里不能包含 / 。");
          return;
        }
        await handleCreateFolder(trimmedName, managerDialog.parent);
        closeManagerDialog();
        return;
      }

      if (managerDialog.kind === "edit-folder") {
        const trimmedPath = managerDialogPath.trim();
        if (!trimmedPath) {
          setManagerDialogError("完整路径不能为空。");
          return;
        }
        if (trimmedPath.split("/").map((segment) => segment.trim()).filter(Boolean).length === 0) {
          setManagerDialogError("请输入至少一层有效路径。");
          return;
        }
        await handleEditFolderPath(managerDialog.folder, trimmedPath);
        closeManagerDialog();
        return;
      }

      if (managerDialog.kind === "create-tag") {
        const trimmedName = managerDialogName.trim();
        if (!trimmedName) {
          setManagerDialogError("标签名称不能为空。");
          return;
        }
        await handleCreateTag(trimmedName, managerDialogColor.trim() || undefined);
        closeManagerDialog();
        return;
      }

      if (managerDialog.kind === "edit-tag") {
        const trimmedName = managerDialogName.trim();
        if (!trimmedName) {
          setManagerDialogError("标签名称不能为空。");
          return;
        }
        await handleEditTag(managerDialog.tag, trimmedName, managerDialogColor);
        closeManagerDialog();
      }
    } catch (error) {
      setManagerDialogError(toErrorMessage(error));
    }
  }

  async function handleManagerDialogDelete() {
    setManagerDialogError(null);
    try {
      if (managerDialog.kind === "delete-bookmark") {
        await handleDeleteBookmark(managerDialog.bookmark);
        closeManagerDialog();
        return;
      }
      if (managerDialog.kind === "delete-bookmarks-batch") {
        await handleBatchDelete(new Set(managerDialog.bookmarkIds));
        closeManagerDialog();
        return;
      }
      if (managerDialog.kind === "delete-folder") {
        await handleDeleteFolder(managerDialog.folder);
        closeManagerDialog();
        return;
      }
      if (managerDialog.kind === "delete-tag") {
        await handleDeleteTag(managerDialog.tag);
        closeManagerDialog();
      }
    } catch (error) {
      setManagerDialogError(toErrorMessage(error));
    }
  }

  async function handleSaveMetadata() {
    if (!authToken || route.page !== "detail") {
      return;
    }

    setMetadataSaving(true);
    setMetadataFeedback(null);

    try {
      const updated = await appDataSource.updateBookmarkMetadata(
        route.bookmarkId,
        {
          note: metadataNote,
          isFavorite: metadataIsFavorite,
          folderId: metadataFolderId || null,
          tagIds: metadataTagIds,
        },
        authToken,
      );
      await refreshSidebarFolderCounts(authToken);
      await refreshBookmarksList(authToken);
      await refreshBookmarkDetail(authToken, updated.id);
      setMetadataFeedback({
        kind: "success",
        message: "书签的收藏状态、收藏夹、标签和备注已经保存。",
      });
    } catch (error) {
      if (handleProtectedApiError(error)) {
        return;
      }
      setMetadataFeedback({
        kind: "error",
        message: toErrorMessage(error),
      });
    } finally {
      setMetadataSaving(false);
    }
  }

  async function handleToggleFavorite(bookmark: Bookmark, isFavorite: boolean) {
    if (!authToken) {
      return;
    }

    setManagerBusy(true);
    setManagerFeedback(null);
    try {
      await appDataSource.updateBookmarkMetadata(bookmark.id, { isFavorite }, authToken);
      await refreshSidebarFolderCounts(authToken);
      await refreshBookmarksList(authToken);
      if (route.page === "detail" && route.bookmarkId === bookmark.id) {
        await refreshBookmarkDetail(authToken, bookmark.id);
      }

      setManagerFeedback({
        kind: "success",
        message: isFavorite ? "已加入收藏。" : "已取消收藏。",
      });
      closeContextMenu();
    } catch (error) {
      if (handleProtectedApiError(error)) {
        return;
      }
      setManagerFeedback({
        kind: "error",
        message: toErrorMessage(error),
      });
    } finally {
      setManagerBusy(false);
    }
  }

  const contextMenuGroups = useMemo<ContextMenuGroup[]>(() => {
    if (contextMenu.kind === "closed") {
      return [];
    }

    if (contextMenu.kind === "bookmark") {
      const bookmark = contextMenu.bookmark;
      const detailHash = buildDetailHash(bookmark.id);
      const detailUrl = buildAppUrl(detailHash);
      return [
        {
          label: "书签",
          items: [
            {
              id: "open-original",
              label: "打开原网页",
              icon: "GO",
              shortcut: "Enter",
              onSelect: () => {
                window.open(bookmark.sourceUrl, "_blank", "noopener,noreferrer");
              },
            },
            {
              id: "open-original-new-tab",
              label: "新标签打开原网页",
              icon: "NT",
              onSelect: () => {
                window.open(bookmark.sourceUrl, "_blank", "noopener,noreferrer");
              },
            },
            {
              id: "open-archive",
              label: "打开归档",
              icon: "AR",
              onSelect: () => openBookmark(bookmark.id),
            },
            {
              id: "open-archive-new-tab",
              label: "新标签打开归档",
              icon: "KA",
              onSelect: () => window.open(detailUrl, "_blank", "noopener,noreferrer"),
            },
          ],
        },
        {
          label: "快速操作",
          items: [
            {
              id: "toggle-favorite",
              label: bookmark.isFavorite ? "取消收藏" : "加入收藏",
              icon: "FV",
              disabled: managerBusy,
              onSelect: () => void handleToggleFavorite(bookmark, !bookmark.isFavorite),
            },
            {
              id: "copy-original-link",
              label: "复制原链接",
              icon: "CP",
              onSelect: () => void handleCopySuccess(bookmark.sourceUrl, "已复制原网页链接。"),
            },
            {
              id: "copy-archive-link",
              label: "复制归档链接",
              icon: "LK",
              onSelect: () => void handleCopySuccess(detailUrl, "已复制归档详情链接。"),
            },
            {
              id: "edit-metadata",
              label: "前往详情编辑",
              icon: "ED",
              onSelect: () => openBookmark(bookmark.id),
            },
            {
              id: "delete-bookmark",
              label: "删除书签",
              icon: "DL",
              danger: true,
              disabled: managerBusy,
              onSelect: () => openManagerDialog({ kind: "delete-bookmark", bookmark }),
            },
          ],
        },
        {
          items: [
            {
              id: "select-bookmark",
              label: "选择",
              icon: "SL",
              onSelect: () => enterSelectionMode(bookmark.id),
            },
          ],
        },
      ];
    }

    if (contextMenu.kind === "tag") {
      const tag = contextMenu.tag;
      return [
        {
          label: "标签",
          items: [
            {
              id: "filter-tag",
              label: selectedTagId === tag.id ? "取消筛选" : "筛选这个标签",
              icon: "FL",
              onSelect: () => {
                setBookmarkView("all");
                setSelectedFolderId("");
                setSelectedTagId((current) => current === tag.id ? "" : tag.id);
              },
            },
            {
              id: "rename-tag",
              label: "重命名标签",
              icon: "RN",
              disabled: managerBusy,
              onSelect: () => openManagerDialog({ kind: "edit-tag", tag }),
            },
          ],
        },
        {
          items: [
            {
              id: "delete-tag",
              label: "删除标签",
              icon: "DL",
              danger: true,
              disabled: managerBusy,
              onSelect: () => openManagerDialog({ kind: "delete-tag", tag }),
            },
          ],
        },
      ];
    }

    const folder = contextMenu.folder;
    return [
      {
        label: "收藏夹",
        items: [
          {
            id: "filter-folder",
            label: selectedFolderId === folder.id ? "取消筛选" : "筛选这个收藏夹",
            icon: "FL",
            onSelect: () => {
              setBookmarkView("all");
              setSelectedTagId("");
              setSelectedFolderId((current) => current === folder.id ? "" : folder.id);
            },
          },
          {
            id: "create-child-folder",
            label: "新建子收藏夹",
            icon: "NW",
            disabled: managerBusy,
            onSelect: () => openManagerDialog({ kind: "create-folder", parent: folder }),
          },
          {
            id: "rename-folder",
            label: "重命名收藏夹",
            icon: "RN",
            disabled: managerBusy,
            onSelect: () => openManagerDialog({ kind: "edit-folder", folder }),
          },
        ],
      },
      {
        items: [
          {
            id: "delete-folder",
            label: "删除收藏夹",
            icon: "DL",
            danger: true,
            disabled: managerBusy,
            onSelect: () => openManagerDialog({ kind: "delete-folder", folder }),
          },
        ],
      },
    ];
  }, [
    contextMenu,
    managerBusy,
    selectedFolderId,
    selectedTagId,
  ]);

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthSubmitting(true);
    setAuthError(null);

    try {
      const sessionResult = authMode === "register"
        ? await appDataSource.register({
            name: authName.trim() || undefined,
            email: authEmail.trim(),
            password: authPassword,
          })
        : await appDataSource.login({
            email: authEmail.trim(),
            password: authPassword,
          });

      setStoredToken(sessionResult.token);
      setSession({
        status: "authenticated",
        token: sessionResult.token,
        user: sessionResult.user,
        error: null,
      });
      setAuthPassword("");
      if (route.page !== "extension-connect") {
        goToList();
      }
    } catch (error) {
      clearStoredToken();
      setAuthError(toErrorMessage(error));
    } finally {
      setAuthSubmitting(false);
    }
  }

  const selectedDraftsForShare = useMemo(() => {
    return [...selectedIds]
      .map((id) => {
        const cached = selectionCatalog.get(id);
        if (cached) {
          return cached;
        }
        const live = items.find((item) => item.id === id);
        if (!live) {
          return null;
        }
        return {
          id: live.id,
          title: live.title,
          domain: live.domain.replace(/^www\./i, ""),
          sourceUrl: live.sourceUrl,
        };
      })
      .filter((item): item is { id: string; title: string; domain: string; sourceUrl: string } => Boolean(item));
  }, [items, selectedIds, selectionCatalog]);

  if (publicShareToken) {
    return (
      <Suspense fallback={<main className="public-share-page"><div className="public-share-state"><div className="public-share-state-card"><p>正在打开分享...</p></div></div></main>}>
        <PublicSharePage token={publicShareToken} />
      </Suspense>
    );
  }

  if (session.status !== "authenticated") {
    return session.status === "booting" ? (
      <main className="auth-shell">
        <section className="loading auth-loading">正在恢复登录状态...</section>
      </main>
    ) : (
      <AuthPanel
        isDemoMode={isDemoMode}
        mode={authMode}
        name={authName}
        email={authEmail}
        password={authPassword}
        submitting={authSubmitting}
        error={authError ?? session.error}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setAuthError(null);
        }}
        onNameChange={setAuthName}
        onEmailChange={setAuthEmail}
        onPasswordChange={setAuthPassword}
        onSubmit={handleAuthSubmit}
      />
    );
  }

  return (
    <>
      <AppShell
        user={session.user}
        items={items}
        folderItemCounts={sidebarFolderCounts}
        folders={folders}
        tags={tags}
        privateModeSummary={privateSummary}
        privateModeUnlocked={Boolean(privateToken)}
        routePage={route.page}
        bookmarkView={bookmarkView}
        selectedFolderId={selectedFolderId}
        selectedTagId={selectedTagId}
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        managerBusy={managerBusy}
        onSelectBookmarkView={setBookmarkView}
        onSelectFolder={setSelectedFolderId}
        onSelectTag={setSelectedTagId}
        onGoHome={goToList}
        onCreateRootFolder={() => openManagerDialog({ kind: "create-folder" })}
        onCreateTag={() => openManagerDialog({ kind: "create-tag" })}
        onOpenPrivateMode={goToPrivateMode}
        onOpenApiTokens={goToApiTokens}
        onOpenShares={goToShares}
        onOpenExtensionDevices={goToExtensionDevices}
        onOpenImportNew={goToImportNew}
        onOpenImportHistory={goToImportList}
        listUiVersion={listUiVersion}
        onListUiVersionChange={handleListUiVersionChange}
        onLogout={() => logout()}
        contextMenuFolderId={activeFolderContextId}
        onFolderContextMenu={openFolderContextMenu}
        contextMenuTagId={activeTagContextId}
        onTagContextMenu={openTagContextMenu}
        logoutLabel={logoutLabel}
      >
        {route.page === "extension-connect" ? (
          <Suspense fallback={<section className="loading preview-empty">正在连接插件...</section>}>
            <ExtensionConnectPage
              token={session.token}
              dataSource={appDataSource}
              onApiError={handleProtectedApiError}
              onDone={goToList}
            />
          </Suspense>
        ) : route.page === "list" ? (
          <BookmarksListRoute
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            selectionBusy={selectionBusy}
            items={items}
            totalItems={listTotal}
            bookmarkView={bookmarkView}
            listUiVersion={listUiVersion}
            loadState={loadState}
            listError={listError}
            loadMoreError={loadMoreError}
            hasActiveFilters={Boolean(
              searchInput.trim()
              || bookmarkView !== "all"
              || qualityFilter !== "all"
              || selectedFolderId
              || selectedTagId
            )}
            hasMoreItems={hasMoreItems}
            loadingMore={loadingMore}
            managerFeedback={managerFeedback}
            contextMenuBookmarkId={activeBookmarkContextId}
            folders={folders}
            tags={tags}
            batchDropdown={batchDropdown}
            onBatchDropdownChange={setBatchDropdown}
            onSelectAll={selectAllBookmarks}
            onDeselectAll={deselectAllBookmarks}
            onBatchFavorite={(fav) => void handleBatchToggleFavorite(selectedIds, fav)}
            onBatchLocalArchive={() => void handleBatchLocalArchive(selectedIds)}
            onBatchMoveTo={(folderId) => void handleBatchMoveTo(selectedIds, folderId)}
            onBatchSetTags={(tagIds) => void handleBatchSetTags(selectedIds, tagIds)}
            onBatchShare={() => {
              if (selectedIds.size === 0) {
                return;
              }
              rememberSelectionCatalog(items.filter((item) => selectedIds.has(item.id)));
              setShareDialogOpen(true);
            }}
            onBatchDelete={() => openManagerDialog({ kind: "delete-bookmarks-batch", bookmarkIds: [...selectedIds], count: selectedIds.size })}
            onExitSelection={exitSelectionMode}
            onToggleFavorite={(bookmark) => void handleToggleFavorite(bookmark, !bookmark.isFavorite)}
            onLoadMore={() => void loadMoreBookmarks()}
            onBookmarkContextMenu={openBookmarkContextMenu}
            onOpenBookmarkContextMenuAt={openBookmarkContextMenuAt}
            onOpenArchive={(bookmark) => openBookmark(bookmark.id)}
            onToggleSelect={toggleSelected}
          />
        ) : route.page === "private-mode" ? (
          <Suspense fallback={<section className="loading preview-empty">正在加载私密模式...</section>}>
            <PrivateModePage
              summary={privateSummary}
              privateToken={privateToken}
              items={privateItems}
              loadState={privateLoadState}
              error={privateError}
              setupPassword={privateSetupPassword}
              setupConfirm={privateSetupConfirm}
              unlockPassword={privateUnlockPassword}
              passwordChangeLogin={privatePasswordChangeLogin}
              passwordChangeNew={privatePasswordChangeNew}
              passwordChangeConfirm={privatePasswordChangeConfirm}
              passwordChangeMessage={privatePasswordChangeMessage}
              busy={privateBusy}
              onSetupPasswordChange={setPrivateSetupPassword}
              onSetupConfirmChange={setPrivateSetupConfirm}
              onUnlockPasswordChange={setPrivateUnlockPassword}
              onPasswordChangeLoginChange={(value) => {
                setPrivatePasswordChangeLogin(value);
                setPrivatePasswordChangeMessage(null);
              }}
              onPasswordChangeNewChange={(value) => {
                setPrivatePasswordChangeNew(value);
                setPrivatePasswordChangeMessage(null);
              }}
              onPasswordChangeConfirmChange={(value) => {
                setPrivatePasswordChangeConfirm(value);
                setPrivatePasswordChangeMessage(null);
              }}
              onSetup={() => void handleSetupPrivateMode()}
              onUnlock={() => void handleUnlockPrivateMode()}
              onChangePassword={() => void handleChangePrivatePassword()}
              onLock={() => void handleLockPrivateMode()}
              onOpenBookmark={(bookmarkId) => openPrivateBookmark(bookmarkId)}
            />
          </Suspense>
        ) : route.page === "private-detail" ? (
          privateToken && privateDetail && selectedPrivateVersion ? (
            <Suspense fallback={<section className="loading preview-empty">正在加载私密详情...</section>}>
              <PrivateDetailPage
                detail={privateDetail}
                selectedVersion={selectedPrivateVersion}
                previewState={privateArchivePreview}
                preferredPreviewMode={privatePreferredPreviewMode}
                activePreviewMode={privatePreviewSelection?.mode ?? null}
                onGoBack={goToPrivateMode}
                onSelectVersion={openPrivateBookmark}
                onPreviewModeChange={setPrivatePreferredPreviewMode}
              />
            </Suspense>
          ) : privateToken && privateDetailLoadState === "loading" ? (
            <section className="detail-shell">
              <section className="loading preview-empty">正在加载私密详情...</section>
            </section>
          ) : privateToken && privateDetailLoadState === "not-found" ? (
            <section className="detail-shell">
              <section className="empty-state preview-empty">
                <h2>私密内容不存在</h2>
                <p>这条私密内容可能已被删除，或当前会话没有权限查看。</p>
              </section>
            </section>
          ) : (
            <Suspense fallback={<section className="loading preview-empty">正在加载私密模式...</section>}>
              <PrivateModePage
                summary={privateSummary}
                privateToken={privateToken}
                items={privateItems}
                loadState={privateLoadState}
                error={privateDetailError ?? privateError}
                setupPassword={privateSetupPassword}
                setupConfirm={privateSetupConfirm}
                unlockPassword={privateUnlockPassword}
                passwordChangeLogin={privatePasswordChangeLogin}
                passwordChangeNew={privatePasswordChangeNew}
                passwordChangeConfirm={privatePasswordChangeConfirm}
                passwordChangeMessage={privatePasswordChangeMessage}
                busy={privateBusy}
                onSetupPasswordChange={setPrivateSetupPassword}
                onSetupConfirmChange={setPrivateSetupConfirm}
                onUnlockPasswordChange={setPrivateUnlockPassword}
                onPasswordChangeLoginChange={(value) => {
                  setPrivatePasswordChangeLogin(value);
                  setPrivatePasswordChangeMessage(null);
                }}
                onPasswordChangeNewChange={(value) => {
                  setPrivatePasswordChangeNew(value);
                  setPrivatePasswordChangeMessage(null);
                }}
                onPasswordChangeConfirmChange={(value) => {
                  setPrivatePasswordChangeConfirm(value);
                  setPrivatePasswordChangeMessage(null);
                }}
                onSetup={() => void handleSetupPrivateMode()}
                onUnlock={() => void handleUnlockPrivateMode()}
                onChangePassword={() => void handleChangePrivatePassword()}
                onLock={() => void handleLockPrivateMode()}
                onOpenBookmark={(bookmarkId) => openPrivateBookmark(bookmarkId)}
              />
            </Suspense>
          )
        ) : route.page === "detail" ? (
          <Suspense fallback={<section className="loading preview-empty">正在加载详情视图...</section>}>
            <BookmarkDetailRoute
              detailLoadState={detailLoadState}
              detailError={detailError}
              detail={detail}
              selectedVersion={selectedVersion}
              previewState={archivePreview}
              preferredPreviewMode={preferredPreviewMode}
              activePreviewMode={previewSelection?.mode ?? null}
              folders={folders}
              tags={tags}
              metadataNote={metadataNote}
              metadataFolderId={metadataFolderId}
              metadataTagIds={metadataTagIds}
              metadataSaving={metadataSaving}
              metadataFeedback={metadataFeedback}
              isPending={isPending}
              onGoBack={goToList}
              onSelectVersion={openBookmark}
              onMetadataNoteChange={setMetadataNote}
              onMetadataFolderChange={setMetadataFolderId}
              onMetadataTagToggle={(tagId) => {
                setMetadataTagIds((current) => (
                  current.includes(tagId)
                    ? current.filter((item) => item !== tagId)
                    : [...current, tagId]
                ));
              }}
              onPreviewModeChange={setPreferredPreviewMode}
              onMetadataSave={() => void handleSaveMetadata()}
            />
          </Suspense>
        ) : route.page === "imports-new" ? (
          <Suspense fallback={<section className="loading preview-empty">正在加载导入向导...</section>}>
            <ImportNewPanel
              token={session.token}
              onApiError={handleProtectedApiError}
              adapter={importAdapter}
              onOpenHistory={goToImportList}
              onOpenTask={openImportTask}
            />
          </Suspense>
        ) : route.page === "imports-list" ? (
          <Suspense fallback={<section className="loading preview-empty">正在加载导入历史...</section>}>
            <ImportHistoryPanel
              token={session.token}
              onApiError={handleProtectedApiError}
              adapter={importAdapter}
              onOpenTask={openImportTask}
              onOpenNew={goToImportNew}
            />
          </Suspense>
        ) : route.page === "imports-detail" ? (
          <Suspense fallback={<section className="loading preview-empty">正在加载导入任务...</section>}>
            <ImportDetailPanel
              token={session.token}
              taskId={route.taskId}
              onApiError={handleProtectedApiError}
              adapter={importAdapter}
              onOpenHistory={goToImportList}
              onOpenBookmark={(bookmarkId) => openBookmark(bookmarkId)}
            />
          </Suspense>
        ) : route.page === "settings-api-tokens" ? (
          <Suspense fallback={<section className="loading preview-empty">正在加载 API 密钥...</section>}>
            <ApiTokensPanel
              token={session.token}
              userId={session.user.id}
              dataSource={appDataSource}
              onApiError={handleProtectedApiError}
              onBack={goToList}
            />
          </Suspense>
        ) : route.page === "settings-shares" ? (
          <Suspense fallback={<section className="loading preview-empty">正在加载我的分享...</section>}>
            <SharesPanel
              token={session.token}
              onApiError={handleProtectedApiError}
              onBack={goToList}
            />
          </Suspense>
        ) : route.page === "settings-extension-devices" ? (
          <Suspense fallback={<section className="loading preview-empty">正在加载插件设备...</section>}>
            <ExtensionDevicesPanel
              token={session.token}
              dataSource={appDataSource}
              onApiError={handleProtectedApiError}
              onBack={goToList}
            />
          </Suspense>
        ) : null}
      </AppShell>
      <ManagerDialog
        state={managerDialog}
        busy={managerBusy}
        error={managerDialogError}
        nameValue={managerDialogName}
        pathValue={managerDialogPath}
        colorValue={managerDialogColor}
        onClose={closeManagerDialog}
        onSubmit={(event) => void handleManagerDialogSubmit(event)}
        onConfirmDelete={() => void handleManagerDialogDelete()}
        onNameChange={setManagerDialogName}
        onPathChange={setManagerDialogPath}
        onColorChange={setManagerDialogColor}
      />
      <LocalArchiveDialog
        state={localArchiveDialog}
        busy={localArchiveBusy}
        error={localArchiveError}
        onConfirm={() => void confirmLocalArchiveDialog()}
        onClose={closeLocalArchiveDialog}
      />
      {shareDialogOpen ? (
        <Suspense fallback={null}>
          <CreateShareDialog
            token={session.token}
            selectedDrafts={selectedDraftsForShare}
            onClose={() => setShareDialogOpen(false)}
            onCreated={() => {
              setSelectionMode(false);
              setSelectedIds(new Set());
              setSelectionCatalog(new Map());
              setBatchDropdown("closed");
            }}
          />
        </Suspense>
      ) : null}
      {contextMenu.kind !== "closed" ? (
        <ContextMenu state={contextMenu} groups={contextMenuGroups} onClose={closeContextMenu} />
      ) : null}
    </>
  );
}
