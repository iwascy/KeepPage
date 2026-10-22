import { sessionIdentity } from "./api/session-transport";
import { isAuthStorageEvent } from "./app/token-storage";
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
  useRef,
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
  isSessionInvalid,
  logoutAccount,
  clearApiResponseCache,
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
  buildListHash,
  parseListFilters,
  type ListFilters,
  type WorkspaceScope,
  goToApiTokens,
  goToAIOrganize,
  goToExtensionDevices,
  goToImportList,
  goToImportNew,
  goToList,
  goToPrivateMode,
  goToShares,
  openBookmark,
  openImportTask,
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
import type { ImportPanelAdapter } from "./features/imports";
import { BookmarksListRoute } from "./features/bookmarks/list";
import { useDebouncedValue } from "./hooks/use-debounced-value";
import {
  readCachedBookmarkList,
  clearBookmarkListCache,
  buildBookmarkListCacheKey,
  writeCachedBookmarkList,
} from "./lib/bookmark-list-cache";
import { type AppDataSource, type WorkspaceSource, useAppDataSource } from "./data-sources/use-app-data-source";
import { fetchBookmarkWindow } from "./lib/bookmark-window";
import { runBoundedBatch, mergeTagIds } from "./lib/batch-actions";
import { Icon } from "./components/Icon";
import { AuthDialog, LandingPage, type AuthMode } from "./features/landing";

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

const PrivateWorkspaceGate = lazy(async () => {
  const module = await import("./features/private");
  return { default: module.PrivateWorkspaceGate };
});

const ApiTokensPanel = lazy(async () => {
  const module = await import("./features/api-tokens");
  return { default: module.ApiTokensPanel };
});

const AIOrganizePanel = lazy(async () => {
  const module = await import("./features/ai-organize");
  return { default: module.AIOrganizePanel };
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
type InlineFeedback = {
  kind: "success" | "error";
  message: string;
};

const BOOKMARKS_PAGE_SIZE = 24;

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
  // Deep links such as extension authorization skip the landing page and open sign-in directly.
  const [authDialogOpen, setAuthDialogOpen] = useState(() => parseRoute(window.location.hash).page !== "list");
  const initialFilters = useMemo(() => parseListFilters(window.location.hash), []);
  const [searchInput, setSearchInput] = useState(initialFilters.search);
  const [sort, setSort] = useState<ListFilters["sort"]>(initialFilters.sort);
  const [bookmarkView, setBookmarkView] = useState<BookmarkListView>(initialFilters.view);
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>(initialFilters.quality);
  const [selectedFolderId, setSelectedFolderId] = useState(initialFilters.folderId);
  const [selectedTagId, setSelectedTagId] = useState(initialFilters.tagId);
  const [items, setItems] = useState<Bookmark[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [sidebarFolderCounts, setSidebarFolderCounts] = useState<Record<string, number>>({});
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [listError, setListError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dataRevision, setDataRevision] = useState(0);
  const [detail, setDetail] = useState<BookmarkDetailResult | null>(null);
  const [detailLoadState, setDetailLoadState] = useState<DetailLoadState>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [archivePreview, setArchivePreview] = useState<ArchivePreviewState>({
    status: "idle",
  });
  const [preferredPreviewMode, setPreferredPreviewMode] = useState<ArchiveViewMode>("reader");
  const [privateStatusRevision, setPrivateStatusRevision] = useState(0);
  const [privateSummary, setPrivateSummary] = useState<PrivateVaultSummary | null>(null);
  const [privateToken, setPrivateToken] = useState<string | null>(null);
  const [privateError, setPrivateError] = useState<string | null>(null);
  const [privateSetupPassword, setPrivateSetupPassword] = useState("");
  const [privateSetupConfirm, setPrivateSetupConfirm] = useState("");
  const [privateUnlockPassword, setPrivateUnlockPassword] = useState("");
  const [privatePasswordChangeLogin, setPrivatePasswordChangeLogin] = useState("");
  const [privatePasswordChangeNew, setPrivatePasswordChangeNew] = useState("");
  const [privatePasswordChangeConfirm, setPrivatePasswordChangeConfirm] = useState("");
  const [privatePasswordChangeMessage, setPrivatePasswordChangeMessage] = useState<string | null>(null);
  const [privateBusy, setPrivateBusy] = useState(false);
  const [managerBusy, setManagerBusy] = useState(false);
  const [managerFeedback, setManagerFeedback] = useState<InlineFeedback | null>(null);
  const [managerDialog, setManagerDialog] = useState<ManagerDialogState>({ kind: "closed" });
  const [managerDialogName, setManagerDialogName] = useState("");
  const [managerDialogParentId, setManagerDialogParentId] = useState("");
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
    Map<string, Bookmark>
  >(() => new Map());
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [batchDropdown, setBatchDropdown] = useState<"closed" | "folder" | "tag">("closed");
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [localArchiveDialog, setLocalArchiveDialog] = useState<LocalArchiveDialogState>({ step: "closed" });
  const [localArchiveBusy, setLocalArchiveBusy] = useState(false);
  const [localArchiveError, setLocalArchiveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const debouncedSearch = useDebouncedValue(searchInput, 200);
  const deferredSearch = useDeferredValue(debouncedSearch);
  const authToken = session.status === "authenticated" ? session.token : null;
  const activeToken = useRef(authToken);
  activeToken.current = authToken;
  // Settings pages keep the last browsed workspace so the sidebar and search stay in place.
  const lastWorkspaceScope = useRef<WorkspaceScope>(initialFilters.scope);
  if (route.page === "list" || route.page === "detail") lastWorkspaceScope.current = route.scope;
  // AI organization only works on the standard library, so it never sees private taxonomy.
  else if (route.page === "settings-ai-organize") lastWorkspaceScope.current = "standard";
  const workspaceScope = lastWorkspaceScope.current;
  const isPrivateScope = workspaceScope === "private";
  const workspace = useMemo<WorkspaceSource | null>(() => {
    if (!isPrivateScope) return appDataSource;
    return privateToken ? appDataSource.privateWorkspace(privateToken) : null;
  }, [appDataSource, isPrivateScope, privateToken]);
  // Private lists stay in memory only; they are never written to sessionStorage.
  const persistListCache = appDataSource.kind === "live" && !isPrivateScope;
  const logoutLabel = appDataSource.logoutLabel;
  const isManagerDialogVisible = isManagerDialogOpen(managerDialog);
  const activeBookmarkContextId = contextMenu.kind === "bookmark" ? contextMenu.bookmark.id : null;
  const activeFolderContextId = contextMenu.kind === "folder" ? contextMenu.folder.id : null;
  const activeTagContextId = contextMenu.kind === "tag" ? contextMenu.tag.id : null;
  const hasMoreItems = items.length < listTotal;
  const importAdapter = appDataSource.importAdapter;
  const accountId = `${session.user?.id ?? "anonymous"}${isPrivateScope ? ":private" : ""}`;
  const query = useMemo(() => ({ search: deferredSearch, quality: qualityFilter, view: bookmarkView,
    folderId: selectedFolderId || undefined, tagId: selectedTagId || undefined,
    sort, limit: BOOKMARKS_PAGE_SIZE, offset: 0 }),
  [deferredSearch, qualityFilter, bookmarkView, selectedFolderId, selectedTagId, sort]);
  const queryKey = buildBookmarkListCacheKey(query, accountId);
  const activeQueryKey = useRef(queryKey);
  activeQueryKey.current = queryKey;
  const [loadedQueryKey, setLoadedQueryKey] = useState("");
  const [showSkeleton, setShowSkeleton] = useState(false);
  const listController = useRef<AbortController | null>(null);
  const pageController = useRef<AbortController | null>(null);
  const favoritePending = useRef(new Set<string>());
  const prefetchRequests = useRef(new Map<string, AbortController>());
  const prefetchTimer = useRef<number | undefined>(undefined);
  const prefetchLastStarted = useRef(0);
  const [retryFailed, setRetryFailed] = useState<(() => void) | null>(null);
  const listScrollPositions = useRef(new Map<string, number>());
  const listSnapshots = useRef(new Map<string, { items: Bookmark[]; total: number; source: "api"; storedAt: number }>());
  const restoreScroll = useRef<number | null>(null);
  const listHash = buildListHash({ scope: workspaceScope, search: searchInput, view: bookmarkView, quality: qualityFilter,
    folderId: selectedFolderId, tagId: selectedTagId, sort });
  const lastListHash = useRef(listHash);
  if (route.page === "list") lastListHash.current = listHash;

  function navigateList(changes: Partial<ListFilters> = {}, replace = false) {
    const next = { scope: workspaceScope, search: searchInput, view: bookmarkView, quality: qualityFilter,
      folderId: selectedFolderId, tagId: selectedTagId, sort, ...changes };
    if (!next.search.trim() && next.sort === "relevance") next.sort = "created";
    const hash = buildListHash(next);
    setSearchInput(next.search); setBookmarkView(next.view); setQualityFilter(next.quality);
    setSelectedFolderId(next.folderId); setSelectedTagId(next.tagId); setSort(next.sort);
    lastWorkspaceScope.current = next.scope;
    setRoute({ page: "list", scope: next.scope });
    if (replace) window.history.replaceState(null, "", hash);
    else if (window.location.hash !== hash) window.location.hash = hash;
  }
  function cancelPrefetchIntent() {
    window.clearTimeout(prefetchTimer.current);
  }
  function invalidateLists() {
    clearBookmarkListCache(accountId);
    listSnapshots.current.clear();
    cancelPrefetchIntent();
    for (const controller of prefetchRequests.current.values()) controller.abort();
    prefetchRequests.current.clear();
  }
  function switchWorkspaceScope(scope: WorkspaceScope) {
    if (scope === workspaceScope && route.page === "list") return;
    exitSelectionMode();
    navigateList({ scope, search: "", view: "all", quality: "all", folderId: "", tagId: "" });
  }
  function requireWorkspace() {
    if (!workspace) throw new Error("私密模式已锁定，请先解锁。");
    return workspace;
  }
  function prefetchFolder(folderId: string) {
    cancelPrefetchIntent();
    if (!authToken || !workspace || !persistListCache) return;
    const prefetchQuery = { ...query, folderId: folderId || undefined, view: "all" as const };
    const key = buildBookmarkListCacheKey(prefetchQuery, accountId);
    if (readCachedBookmarkList(prefetchQuery, accountId) || prefetchRequests.current.has(key)) return;
    prefetchTimer.current = window.setTimeout(() => {
      if (prefetchRequests.current.size >= 2 || Date.now() - prefetchLastStarted.current < 500) return;
      prefetchLastStarted.current = Date.now();
      const controller = new AbortController();
      prefetchRequests.current.set(key, controller);
      void workspace.searchBookmarks(prefetchQuery, authToken, controller.signal).then((result) => {
        if (!controller.signal.aborted && activeToken.current === authToken) writeCachedBookmarkList(prefetchQuery, result, accountId);
      }).catch(() => { /* Navigation owns visible errors; prefetch is best effort. */ }).finally(() => {
        if (prefetchRequests.current.get(key) === controller) prefetchRequests.current.delete(key);
      });
    }, 180);
  }
  useEffect(() => () => {
    window.clearTimeout(prefetchTimer.current);
    for (const controller of prefetchRequests.current.values()) controller.abort();
    prefetchRequests.current.clear();
  }, [authToken, queryKey]);

  function returnToList() {
    window.location.hash = lastListHash.current;
  }


  function forgetPrivateData() {
    clearApiResponseCache();
    for (const key of listSnapshots.current.keys()) {
      if (key.includes(":private")) listSnapshots.current.delete(key);
    }
  }

  function clearPrivateState() {
    forgetPrivateData();
    setPrivateToken(null);
    setPrivateSummary(null);
    setPrivateError(null);
    setPrivateSetupPassword("");
    setPrivateSetupConfirm("");
    setPrivateUnlockPassword("");
    setPrivateBusy(false);
  }

  async function logout(message?: string) {
    if (!isDemoMode && !message) {
      try { await logoutAccount(); }
      catch (error) { pushHomeFeedback("error", `退出失败：${toErrorMessage(error)}，请重试。`); return; }
    }
    activeToken.current = null;
    clearBookmarkListCache();
    listSnapshots.current.clear();
    exitSelectionMode();
    setSelectionBusy(false);
    setRetryFailed(null);
    listController.current?.abort();
    pageController.current?.abort();
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
        next.set(bookmark.id, bookmark);
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
        next.set(bookmark.id, bookmark);
      }
      return next;
    });
  }, [items]);

  function selectAllBookmarks() {
    setSelectedIds((current) => new Set([...current, ...items.map((b) => b.id)]));
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
    if (handlePrivateModeLocked(error)) {
      return true;
    }
    if (isSessionInvalid(error)) {
      void logout(toErrorMessage(error));
      return true;
    }
    return false;
  }

  function handlePrivateModeApiError(error: unknown) {
    // Password checks can fail while the account session remains valid.
    if (
      error instanceof ApiError &&
      (error.code === "PrivateModeInvalidPassword" || error.code === "InvalidCredentials")
    ) {
      return false;
    }
    return handleProtectedApiError(error);
  }

  // A locked vault only hides private content; the account session stays valid.
  function handlePrivateModeLocked(error: unknown) {
    if (
      !(error instanceof ApiError) ||
      (error.status !== 401 && error.status !== 403) ||
      error.code !== "PrivateModeLocked"
    ) {
      return false;
    }
    forgetPrivateData();
    setPrivateToken(null);
    setPrivateError("私密模式已锁定或会话已失效，请重新输入密码。");
    return true;
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
    exitSelectionMode();
  }, [workspaceScope]);

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
      const next = parseRoute(window.location.hash);
      const previousScope = lastWorkspaceScope.current;
      setRoute(next);
      if (next.page === "list") {
        const filters = parseListFilters(window.location.hash);
        // Private keywords live only in memory, so keep them while browsing inside the vault.
        setSearchInput((current) => (filters.scope === "private" && previousScope === "private" ? current : filters.search));
        setBookmarkView(filters.view); setQualityFilter(filters.quality);
        setSelectedFolderId(filters.folderId); setSelectedTagId(filters.tagId); setSort(filters.sort);
        restoreScroll.current = listScrollPositions.current.get(window.location.hash) ?? 0;
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (route.page !== "list") return;
    const remember = () => listScrollPositions.current.set(listHash, window.scrollY);
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, [route.page, listHash]);

  useEffect(() => {
    if (route.page !== "list" || loadState !== "ready" || loadedQueryKey !== queryKey || restoreScroll.current === null) return;
    const top = restoreScroll.current;
    const frame = requestAnimationFrame(() => { window.scrollTo({ top }); restoreScroll.current = null; });
    return () => cancelAnimationFrame(frame);
  }, [route.page, loadState, loadedQueryKey, queryKey]);

  const [sessionRetry, setSessionRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSession({ status: "booting", token: null, user: null, error: null });
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
        setSession({
          status: "unavailable",
          token: null,
          user: null,
          error: toErrorMessage(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [appDataSource, sessionRetry]);

  useEffect(() => {
    if (isDemoMode) return;
    const onStorage = (event: StorageEvent) => {
      if (!isAuthStorageEvent(event)) return;
      const token = getStoredToken();
      if (!token) void logout("已在其他页面退出登录。");
      // A different account/session must be restored before showing its data.
      else if (!event.oldValue || sessionIdentity(event.oldValue) !== sessionIdentity(token)) {
        activeToken.current = null;
        clearApiResponseCache();
        clearBookmarkListCache();
        listSnapshots.current.clear();
        listController.current?.abort();
        pageController.current?.abort();
        clearPrivateState();
        setItems([]);
        setDetail(null);
        setFolders([]);
        setTags([]);
        setSidebarFolderCounts({});
        setSessionRetry((value) => value + 1);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [isDemoMode]);

  useEffect(() => {
    if (!authToken) {
      setPrivateSummary(null);
      setPrivateToken(null);
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
  }, [appDataSource, authToken, privateToken, privateStatusRevision]);

  const bootstrappedWorkspace = useRef("");
  const workspaceKey = `${workspaceScope}:${workspace ? "open" : "locked"}`;
  useEffect(() => {
    if (bootstrappedWorkspace.current !== workspaceKey) {
      // Never show one workspace's taxonomy while the other one loads.
      bootstrappedWorkspace.current = workspaceKey;
      setFolders([]);
      setTags([]);
      setSidebarFolderCounts({});
    }
    if (!authToken || !workspace) {
      setFolders([]);
      setTags([]);
      setSidebarFolderCounts({});
      if (!authToken) setManagerFeedback(null);
      return;
    }

    let cancelled = false;
    workspace.fetchWorkspaceBootstrap(authToken)
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
  }, [workspace, authToken, dataRevision]);

  useEffect(() => {
    if (loadedQueryKey === queryKey && loadState === "ready") {
      listSnapshots.current.set(queryKey, { items, total: listTotal, source: "api", storedAt: Date.now() });
      if (listSnapshots.current.size > 30) listSnapshots.current.delete(listSnapshots.current.keys().next().value!);
    }
  }, [items, listTotal, loadedQueryKey, queryKey, loadState]);

  useEffect(() => {
    listController.current?.abort();
    pageController.current?.abort();
    pageController.current = null;
    if (!authToken || !workspace) {
      setItems([]); setListTotal(0); setLoadState("idle"); setLoadedQueryKey("");
      return;
    }
    const controller = new AbortController();
    listController.current = controller;
    setListError(null); setLoadMoreError(null); setLoadingMore(false); setShowSkeleton(false);
    const snapshot = listSnapshots.current.get(queryKey);
    const cached = snapshot && Date.now() - snapshot.storedAt < 5 * 60 * 1000 ? snapshot
      : persistListCache ? readCachedBookmarkList(query, accountId) : null;
    const sameQuery = loadedQueryKey === queryKey;
    if (cached) {
      setItems(cached.items); setListTotal(cached.total); setLoadState("ready"); setLoadedQueryKey(queryKey);
    } else if (!sameQuery || loadState !== "ready") {
      setItems([]); setListTotal(0); setLoadState("loading"); setLoadedQueryKey(queryKey);
    }
    const skeletonTimer = window.setTimeout(() => setShowSkeleton(true), 180);
    fetchBookmarkWindow(workspace.searchBookmarks, query, authToken, cached?.items.length ?? BOOKMARKS_PAGE_SIZE, controller.signal).then((result) => {
      if (controller.signal.aborted || activeQueryKey.current !== queryKey) return;
      if (persistListCache) writeCachedBookmarkList(query, result, accountId);
      setItems(result.items); setListTotal(result.total); setLoadState("ready"); setLoadedQueryKey(queryKey);
    }).catch((error) => {
      if (controller.signal.aborted || activeQueryKey.current !== queryKey || handleProtectedApiError(error)) return;
      setLoadState(cached || (sameQuery && loadState === "ready") ? "ready" : "error");
      setListError(toErrorMessage(error));
    });
    return () => { controller.abort(); window.clearTimeout(skeletonTimer); };
  }, [workspace, authToken, queryKey, dataRevision]);

  useEffect(() => {
    if (!authToken || route.page !== "detail" || !workspace) {
      setDetailLoadState("idle");
      setDetailError(null);
      setDetail(null);
      return;
    }

    let cancelled = false;
    setDetailLoadState("loading");
    setDetailError(null);

    workspace.fetchBookmarkDetail(route.bookmarkId, authToken)
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
  }, [workspace, authToken, route]);

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
      setManagerDialogParentId("");
      setManagerDialogColor("");
      return;
    }
    if (managerDialog.kind === "edit-folder") {
      setManagerDialogName(managerDialog.folder.name);
      setManagerDialogParentId("");
      setManagerDialogColor("");
      return;
    }
    if (managerDialog.kind === "move-folder") {
      setManagerDialogName("");
      setManagerDialogParentId(managerDialog.folder.parentId ?? "");
      setManagerDialogColor("");
      return;
    }
    if (managerDialog.kind === "create-tag") {
      setManagerDialogName("");
      setManagerDialogParentId("");
      setManagerDialogColor("");
      return;
    }
    if (managerDialog.kind === "edit-tag") {
      setManagerDialogName(managerDialog.tag.name);
      setManagerDialogParentId("");
      setManagerDialogColor(managerDialog.tag.color ?? "");
      return;
    }
    setManagerDialogName("");
    setManagerDialogParentId("");
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

  const previewSourceUrl = detail
    ? (detail.bookmark.canonicalUrl ?? detail.bookmark.sourceUrl)
    : null;
  const previewSelection = useMemo(
    () => resolvePreviewSelection(selectedVersion, preferredPreviewMode),
    [preferredPreviewMode, selectedVersion],
  );

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;

    if (!authToken || !workspace || !previewSelection?.objectKey || !previewSourceUrl) {
      setArchivePreview({ status: "idle" });
      return;
    }

    setArchivePreview({ status: "loading" });

    workspace.createArchivePreviewUrl(
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
    workspace,
    authToken,
    previewSelection?.objectKey,
    previewSelection?.mode,
    previewSourceUrl,
    selectedVersion?.id,
  ]);

  async function refreshSidebarFolderCounts(currentToken: string) {
    const nextCounts = await requireWorkspace().fetchBookmarkFolderCounts(currentToken);
    setSidebarFolderCounts(nextCounts);
  }

  async function refreshCatalogs(currentToken: string) {
    const source = requireWorkspace();
    const [nextFolders, nextTags] = await Promise.all([
      source.fetchFolders(currentToken),
      source.fetchTags(currentToken),
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
    invalidateLists();
    if (activeQueryKey.current !== queryKey) {
      setDataRevision((revision) => revision + 1);
      return;
    }
    listController.current?.abort(); pageController.current?.abort();
    pageController.current = null; setLoadingMore(false);
    const controller = new AbortController();
    listController.current = controller;
    const requestedKey = queryKey;
    try {
      const result = await fetchBookmarkWindow(requireWorkspace().searchBookmarks, query, currentToken, items.length, controller.signal);
      if (controller.signal.aborted || activeQueryKey.current !== requestedKey) return;
      setListError(null); setLoadMoreError(null); setItems(result.items); setListTotal(result.total);
      setLoadedQueryKey(requestedKey); setLoadingMore(false); setLoadState("ready");
      if (persistListCache) writeCachedBookmarkList(query, { ...result, items: result.items.slice(0, BOOKMARKS_PAGE_SIZE) }, accountId);
    } catch (error) {
      if (controller.signal.aborted || activeQueryKey.current !== requestedKey) return;
      if (!handleProtectedApiError(error)) setListError(`更新失败，已保留当前内容。${toErrorMessage(error)}`);
    }
  }

  async function loadMoreBookmarks() {
    if (pageController.current || loadingMore || loadState !== "ready" || !hasMoreItems || !authToken) return;
    const requestedKey = queryKey;
    const controller = new AbortController(); pageController.current = controller;
    setLoadMoreError(null); setLoadingMore(true);
    try {
      const result = await requireWorkspace().searchBookmarks({ ...query, offset: items.length }, authToken, controller.signal);
      if (controller.signal.aborted || activeQueryKey.current !== requestedKey) return;
      setItems((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...result.items.filter((item) => !existing.has(item.id))];
      });
      setListTotal(result.total);
    } catch (error) {
      if (!controller.signal.aborted && activeQueryKey.current === requestedKey && !handleProtectedApiError(error)) setLoadMoreError(toErrorMessage(error));
    } finally {
      if (pageController.current === controller) pageController.current = null;
      if (activeQueryKey.current === requestedKey) setLoadingMore(false);
    }
  }

  async function selectAllResults() {
    if (!authToken || selectionBusy) return;
    const requestedKey = queryKey;
    setSelectionBusy(true);
    try {
      const all: Bookmark[] = [];
      let total = Infinity;
      while (all.length < total) {
        const result = await requireWorkspace().searchBookmarks({ ...query, offset: all.length, limit: 100 }, authToken);
        if (activeQueryKey.current !== requestedKey) return;
        total = result.total;
        if (!result.items.length) break;
        all.push(...result.items);
      }
      rememberSelectionCatalog(all);
      setSelectedIds((current) => new Set([...current, ...all.map((bookmark) => bookmark.id)]));
    } catch (error) { if (!handleProtectedApiError(error)) pushHomeFeedback("error", toErrorMessage(error)); }
    finally { setSelectionBusy(false); }
  }

  async function refreshBookmarkDetail(currentToken: string, bookmarkId: string) {
    const result = await requireWorkspace().fetchBookmarkDetail(bookmarkId, currentToken);
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
    } catch (error) {
      if (handlePrivateModeApiError(error)) {
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
    } catch (error) {
      if (handlePrivateModeApiError(error)) {
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
      forgetPrivateData();
      setPrivateSummary(summary);
      setPrivateToken(null);
      setPrivateUnlockPassword("");
      setPrivatePasswordChangeLogin("");
      setPrivatePasswordChangeNew("");
      setPrivatePasswordChangeConfirm("");
      setPrivatePasswordChangeMessage(null);
      if (isPrivateScope && (route.page === "list" || route.page === "detail")) {
        switchWorkspaceScope("standard");
      }
    } catch (error) {
      if (handlePrivateModeApiError(error)) {
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
    } catch (error) {
      if (handlePrivateModeApiError(error)) {
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
      invalidateLists();
      await Promise.all([refreshCatalogs(authToken), refreshSidebarFolderCounts(authToken), refreshBookmarksList(authToken)]);
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
      await requireWorkspace().deleteBookmark(bookmark.id, authToken!);
      if (route.page === "detail" && route.bookmarkId === bookmark.id) {
        goToList();
      }
      return `已删除书签：${bookmark.title}`;
    });
  }

  async function runBatch(ids: Set<string>, label: string, action: (id: string) => Promise<unknown>, refreshCounts = false) {
    if (!ids.size || !authToken || selectionBusy) return;
    setSelectionBusy(true); setManagerFeedback(null); setRetryFailed(null);
    const targets = [...ids];
    const result = await runBoundedBatch(targets, action);
    if (activeToken.current !== authToken) return;
    for (const error of result.failures.values()) {
      if (handleProtectedApiError(error)) return;
    }
    const failed = new Set(result.failures.keys());
    invalidateLists();
    await Promise.allSettled([
      refreshBookmarksList(authToken),
      ...(refreshCounts ? [refreshSidebarFolderCounts(authToken)] : []),
    ]);
    if (activeToken.current !== authToken) return;
    if (activeQueryKey.current !== queryKey) setDataRevision((revision) => revision + 1);
    setSelectedIds(failed);
    setSelectionMode(failed.size > 0);
    setBatchDropdown("closed");
    setSelectionBusy(false);
    setManagerFeedback({ kind: failed.size ? "error" : "success",
      message: `${label}：成功 ${targets.length - failed.size} 条${failed.size ? `，失败 ${failed.size} 条。失败项已保留，可重试。` : "。"}` });
    if (failed.size) setRetryFailed(() => () => void runBatch(failed, label, action, refreshCounts));
    else setSelectionCatalog(new Map());
  }

  async function handleBatchDelete(ids: Set<string>) {
    await runBatch(ids, "删除", (id) => requireWorkspace().deleteBookmark(id, authToken!), true);
  }

  async function handleBatchToggleFavorite(ids: Set<string>, isFavorite: boolean) {
    await runBatch(ids, isFavorite ? "加入星标" : "取消星标",
      (id) => requireWorkspace().updateBookmarkMetadata(id, { isFavorite }, authToken!));
  }

  function handleBatchLocalArchive(ids: Set<string>) {
    if (!ids.size) return;
    const selected = [...ids].map((id) => selectionCatalog.get(id) ?? items.find((item) => item.id === id))
      .filter((bookmark): bookmark is Bookmark => Boolean(bookmark));
    if (selected.length !== ids.size) { pushHomeFeedback("error", "部分选择已失效，请重新选择后存档。"); return; }
    openLocalArchiveDialog(selected);
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
    await runBatch(ids, "移动收藏夹", (id) => requireWorkspace().updateBookmarkMetadata(id, { folderId }, authToken!), true);
  }

  async function handleBatchSetTags(ids: Set<string>, tagIds: string[], mode: "append" | "remove" | "replace") {
    await runBatch(ids, mode === "append" ? "追加标签" : mode === "remove" ? "移除标签" : "替换标签", async (id) => {
      // Fetch current metadata so appending never replaces tags from stale selections.
      const current = await requireWorkspace().fetchBookmarkDetail(id, authToken!);
      if (!current) throw new Error("书签不存在");
      const existing = current.bookmark.tags.map((tag) => tag.id);
      const nextTags = mergeTagIds(existing, tagIds, mode);
      return requireWorkspace().updateBookmarkMetadata(id, { tagIds: nextTags }, authToken!);
    });
  }

  async function handleCreateFolder(name: string, parent?: Folder) {
    const trimmedName = name.trim();
    await runManagerAction(async () => {
      const folder = await requireWorkspace().createFolder({
        name: trimmedName,
        parentId: parent?.id ?? null,
      }, authToken!);
      return `已创建收藏夹：${folder.path}`;
    });
  }

  async function handleRenameFolder(folder: Folder, name: string) {
    await runManagerAction(async () => {
      const updated = await requireWorkspace().updateFolder(folder.id, { name }, authToken!);
      return `已重命名收藏夹：${updated.path}`;
    });
  }

  async function handleMoveFolder(folder: Folder, parentId: string | null) {
    if (parentId) {
      const parent = folders.find((item) => item.id === parentId);
      if (!parent) {
        throw new Error("目标收藏夹不存在，请重新选择。");
      }
      if (parent.id === folder.id || parent.path.startsWith(`${folder.path}/`)) {
        throw new Error("不能移动到自身或子收藏夹中。");
      }
    }
    await runManagerAction(async () => {
      const updated = await requireWorkspace().updateFolder(folder.id, { parentId }, authToken!);
      return `已移动收藏夹：${updated.path}`;
    });
  }

  async function handleDeleteFolder(folder: Folder) {
    await runManagerAction(async () => {
      await requireWorkspace().deleteFolder(folder.id, authToken!);
      return `已删除收藏夹：${folder.path}`;
    });
  }

  async function handleCreateTag(name: string, color?: string) {
    const trimmedName = name.trim();
    await runManagerAction(async () => {
      const tag = await requireWorkspace().createTag({
        name: trimmedName,
        color,
      }, authToken!);
      return `已创建标签：#${tag.name}`;
    });
  }

  async function handleEditTag(tag: Tag, nextName: string, nextColorRaw: string) {
    await runManagerAction(async () => {
      const updated = await requireWorkspace().updateTag(tag.id, {
        name: nextName.trim(),
        color: nextColorRaw.trim() || null,
      }, authToken!);
      return `已更新标签：#${updated.name}`;
    });
  }

  async function handleDeleteTag(tag: Tag) {
    await runManagerAction(async () => {
      await requireWorkspace().deleteTag(tag.id, authToken!);
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
        const trimmedName = managerDialogName.trim();
        if (!trimmedName) {
          setManagerDialogError("收藏夹名称不能为空。");
          return;
        }
        if (trimmedName.includes("/")) {
          setManagerDialogError("收藏夹名称里不能包含 / 。");
          return;
        }
        await handleRenameFolder(managerDialog.folder, trimmedName);
        closeManagerDialog();
        return;
      }

      if (managerDialog.kind === "move-folder") {
        await handleMoveFolder(managerDialog.folder, managerDialogParentId || null);
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
      const updated = await requireWorkspace().updateBookmarkMetadata(
        route.bookmarkId,
        {
          note: metadataNote,
          isFavorite: metadataIsFavorite,
          folderId: metadataFolderId || null,
          tagIds: metadataTagIds,
        },
        authToken,
      );
      invalidateLists();
      await Promise.all([refreshSidebarFolderCounts(authToken), refreshBookmarksList(authToken), refreshBookmarkDetail(authToken, updated.id)]);
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
    if (!authToken || favoritePending.current.has(bookmark.id)) return;
    favoritePending.current.add(bookmark.id);
    const requestedKey = queryKey;
    listController.current?.abort();
    pageController.current?.abort();
    pageController.current = null;
    setLoadingMore(false);
    invalidateLists();
    setItems((current) => current.map((item) => item.id === bookmark.id ? { ...item, isFavorite } : item));
    setManagerFeedback(null); closeContextMenu();
    try {
      const updated = await requireWorkspace().updateBookmarkMetadata(bookmark.id, { isFavorite }, authToken);
      invalidateLists();
      if (activeQueryKey.current === requestedKey) {
        setItems((current) => bookmarkView === "favorites" && !isFavorite
          ? current.filter((item) => item.id !== bookmark.id)
          : current.map((item) => item.id === bookmark.id ? { ...item, ...updated } : item));
        if (bookmarkView === "favorites" && !isFavorite) setListTotal((total) => Math.max(0, total - 1));
      }
      if (activeQueryKey.current !== requestedKey) setDataRevision((revision) => revision + 1);
      if (route.page === "detail" && route.bookmarkId === bookmark.id) await refreshBookmarkDetail(authToken, bookmark.id);
    } catch (error) {
      if (activeQueryKey.current === requestedKey) setItems((current) => current.map((item) => item.id === bookmark.id ? { ...item, isFavorite: bookmark.isFavorite } : item));
      if (!handleProtectedApiError(error)) setManagerFeedback({ kind: "error", message: `星标修改失败，已恢复。${toErrorMessage(error)}` });
    } finally { favoritePending.current.delete(bookmark.id); }
  }

  const contextMenuGroups = useMemo<ContextMenuGroup[]>(() => {
    if (contextMenu.kind === "closed") {
      return [];
    }

    if (contextMenu.kind === "bookmark") {
      const bookmark = contextMenu.bookmark;
      const detailHash = buildDetailHash(bookmark.id, undefined, workspaceScope);
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
              onSelect: () => openBookmark(bookmark.id, undefined, workspaceScope),
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
              onSelect: () => openBookmark(bookmark.id, undefined, workspaceScope),
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
          {
            id: "move-folder",
            label: "移动收藏夹",
            icon: "MV",
            disabled: managerBusy,
            onSelect: () => openManagerDialog({ kind: "move-folder", folder }),
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
    workspaceScope,
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
      setAuthDialogOpen(false);
      if (route.page !== "extension-connect") {
        goToList();
      }
    } catch (error) {
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
    return session.status === "unavailable" ? (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>暂时无法恢复登录</h1>
          <p role="alert">{session.error}</p>
          <p>登录凭据已保留，请检查网络后重试。</p>
          <button type="button" className="primary-button" onClick={() => setSessionRetry((value) => value + 1)}>重试</button>
        </section>
      </main>
    ) : session.status === "booting" ? (
      <main className="auth-shell">
        <section className="auth-card auth-loading" role="status" aria-live="polite" aria-busy="true">
          <div className="auth-brand"><span className="auth-brand-mark" aria-hidden="true"><Icon name="bookmark" /></span><span>KeepPage</span></div>
          <span className="auth-spinner" aria-hidden="true" />
          <h1>正在恢复登录状态</h1>
          <p>稍候，正在打开你的资料库。</p>
        </section>
      </main>
    ) : (
      <>
        <LandingPage
          onOpenAuth={(mode) => {
            setAuthMode(mode);
            setAuthError(null);
            setAuthDialogOpen(true);
          }}
        />
        {authDialogOpen || session.error ? (
          <AuthDialog
            isDemoMode={isDemoMode}
            mode={authMode}
            name={authName}
            email={authEmail}
            password={authPassword}
            submitting={authSubmitting}
            error={authError ?? session.error}
            onClose={() => {
              setAuthDialogOpen(false);
              setAuthError(null);
              if (session.error) setSession({ ...session, error: null });
            }}
            onModeChange={(mode) => {
              setAuthMode(mode);
              setAuthError(null);
            }}
            onNameChange={setAuthName}
            onEmailChange={setAuthEmail}
            onPasswordChange={setAuthPassword}
            onSubmit={handleAuthSubmit}
          />
        ) : null}
      </>
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
        workspaceScope={workspaceScope}
        workspaceLocked={!workspace}
        onSwitchWorkspaceScope={switchWorkspaceScope}
        routePage={route.page}
        bookmarkView={bookmarkView}
        selectedFolderId={selectedFolderId}
        selectedTagId={selectedTagId}
        searchInput={searchInput}
        onSearchChange={(search) => navigateList({ search }, true)}
        managerBusy={managerBusy}
        onSelectBookmarkView={(view) => navigateList({ view, folderId: "", tagId: "" })}
        onSelectFolder={(folderId) => navigateList({ folderId, view: "all" })}
        onPrefetchFolder={prefetchFolder}
        onCancelPrefetchFolder={cancelPrefetchIntent}
        onSelectTag={(tagId) => navigateList({ tagId })}
        onReturnToList={returnToList}
        onGoHome={() => navigateList({ search: "", view: "all", folderId: "", tagId: "", quality: "all" })}
        onCreateRootFolder={() => openManagerDialog({ kind: "create-folder" })}
        onCreateTag={() => openManagerDialog({ kind: "create-tag" })}
        onOpenPrivateMode={goToPrivateMode}
        onOpenApiTokens={goToApiTokens}
        onOpenAIOrganize={goToAIOrganize}
        onOpenShares={goToShares}
        onOpenExtensionDevices={goToExtensionDevices}
        onOpenImportNew={goToImportNew}
        onOpenImportHistory={goToImportList}
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
        ) : (route.page === "list" || route.page === "detail") && !workspace ? (
          <Suspense fallback={<section className="loading preview-empty">正在加载私密模式...</section>}>
            <PrivateWorkspaceGate
              summary={privateSummary}
              error={privateError}
              unlockPassword={privateUnlockPassword}
              busy={privateBusy}
              onUnlockPasswordChange={setPrivateUnlockPassword}
              onUnlock={() => void handleUnlockPrivateMode()}
              onOpenSettings={goToPrivateMode}
              onBack={() => switchWorkspaceScope("standard")}
            />
          </Suspense>
        ) : route.page === "list" ? (
          <BookmarksListRoute
            isPrivate={isPrivateScope}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            selectionBusy={selectionBusy}
            items={loadedQueryKey === queryKey ? items : []}
            totalItems={loadedQueryKey === queryKey ? listTotal : 0}
            title={selectedFolderId ? (folders.find((folder) => folder.id === selectedFolderId)?.path ?? "收藏夹") : bookmarkView === "favorites" ? "星标书签" : bookmarkView === "recent" ? "最近更新" : isPrivateScope ? "全部私密书签" : "全部书签"}
            searchInput={searchInput}
            selectedFolderId={selectedFolderId}
            selectedTagId={selectedTagId}
            sort={sort}
            onSortChange={(sort) => navigateList({ sort })}
            onClearFilters={() => navigateList({ search: "", tagId: "", quality: "all" })}
            onClearTag={() => navigateList({ tagId: "" })}
            onClearSearch={() => navigateList({ search: "" })}
            onSearchGlobally={() => navigateList({ folderId: "", tagId: "", view: "all" })}
            onRetry={() => setDataRevision((revision) => revision + 1)}
            showSkeleton={showSkeleton && loadedQueryKey === queryKey}
            onSelectAllResults={() => void selectAllResults()}
            onRetryFailed={retryFailed ?? undefined}
            onEnterSelection={() => enterSelectionMode()}
            onCreateArchive={isPrivateScope ? undefined : (bookmark) => openLocalArchiveDialog([bookmark])}
            bookmarkView={bookmarkView}
            loadState={loadedQueryKey === queryKey ? loadState : "loading"}
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
            onBatchLocalArchive={isPrivateScope ? undefined : () => void handleBatchLocalArchive(selectedIds)}
            onBatchMoveTo={(folderId) => void handleBatchMoveTo(selectedIds, folderId)}
            onBatchSetTags={(tagIds, mode) => void handleBatchSetTags(selectedIds, tagIds, mode ?? "append")}
            onBatchShare={isPrivateScope ? undefined : () => {
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
            onOpenArchive={(bookmark) => openBookmark(bookmark.id, undefined, workspaceScope)}
            onToggleSelect={toggleSelected}
          />
        ) : route.page === "private-mode" ? (
          <Suspense fallback={<section className="loading preview-empty">正在加载私密模式...</section>}>
            <PrivateModePage
              onRetryStatus={() => { setPrivateError(null); setPrivateStatusRevision((value) => value + 1); }}
              summary={privateSummary}
              privateToken={privateToken}
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
              onOpenWorkspace={() => switchWorkspaceScope("private")}
            />
          </Suspense>
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
              onGoBack={returnToList}
              onSelectVersion={(bookmarkId, versionId) => openBookmark(bookmarkId, versionId, workspaceScope)}
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
              onBack={returnToList}
            />
          </Suspense>
        ) : route.page === "settings-ai-organize" ? (
          <Suspense fallback={<section className="loading preview-empty">正在加载 AI 整理...</section>}>
            <AIOrganizePanel
              token={session.token}
              folders={folders}
              tags={tags}
              onApiError={handleProtectedApiError}
              onBack={returnToList}
              onOrganized={() => {
                setDataRevision((current) => current + 1);
              }}
            />
          </Suspense>
        ) : route.page === "settings-shares" ? (
          <Suspense fallback={<section className="loading preview-empty">正在加载我的分享...</section>}>
            <SharesPanel
              token={session.token}
              onApiError={handleProtectedApiError}
              onBack={returnToList}
            />
          </Suspense>
        ) : route.page === "settings-extension-devices" ? (
          <Suspense fallback={<section className="loading preview-empty">正在加载插件设备...</section>}>
            <ExtensionDevicesPanel
              token={session.token}
              dataSource={appDataSource}
              onApiError={handleProtectedApiError}
              onBack={returnToList}
            />
          </Suspense>
        ) : null}
      </AppShell>
      <ManagerDialog
        state={managerDialog}
        busy={managerBusy}
        error={managerDialogError}
        nameValue={managerDialogName}
        parentIdValue={managerDialogParentId}
        folders={folders}
        colorValue={managerDialogColor}
        onClose={closeManagerDialog}
        onSubmit={(event) => void handleManagerDialogSubmit(event)}
        onConfirmDelete={() => void handleManagerDialogDelete()}
        onNameChange={setManagerDialogName}
        onParentIdChange={setManagerDialogParentId}
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
