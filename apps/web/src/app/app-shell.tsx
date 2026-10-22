import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AuthUser,
  Bookmark,
  BookmarkListView,
  Folder,
  PrivateVaultSummary,
  Tag,
} from "@keeppage/domain";
import { useDialogFocus } from "./use-dialog-focus";
import { Icon } from "../components/Icon";
import type { ViewRoute, WorkspaceScope } from "./routes";
import { displayUserName, userInitials } from "./user-format";

export function AppShell({
  user,
  items,
  folderItemCounts,
  folders,
  tags,
  privateModeSummary,
  privateModeUnlocked,
  workspaceScope,
  workspaceLocked,
  onSwitchWorkspaceScope,
  routePage,
  bookmarkView,
  selectedFolderId,
  selectedTagId,
  searchInput,
  onSearchChange,
  managerBusy,
  onSelectBookmarkView,
  onSelectFolder,
  onPrefetchFolder,
  onCancelPrefetchFolder,
  onSelectTag,
  onGoHome,
  onReturnToList,
  onCreateRootFolder,
  onCreateTag,
  onOpenPrivateMode,
  onOpenApiTokens,
  onOpenAIOrganize,
  onOpenShares,
  onOpenExtensionDevices,
  onOpenImportNew,
  onOpenImportHistory,
  onLogout,
  contextMenuFolderId,
  onFolderContextMenu,
  contextMenuTagId,
  onTagContextMenu,
  children,
  logoutLabel = "退出登录",
}: {
  user: AuthUser;
  items: Bookmark[];
  folderItemCounts: Record<string, number>;
  folders: Folder[];
  tags: Tag[];
  privateModeSummary: PrivateVaultSummary | null;
  privateModeUnlocked: boolean;
  workspaceScope: WorkspaceScope;
  /** The private workspace is selected but the vault is locked. */
  workspaceLocked: boolean;
  onSwitchWorkspaceScope: (scope: WorkspaceScope) => void;
  routePage: ViewRoute["page"];
  bookmarkView: BookmarkListView;
  selectedFolderId: string;
  selectedTagId: string;
  searchInput: string;
  onSearchChange: (value: string) => void;
  managerBusy: boolean;
  onSelectBookmarkView: (view: BookmarkListView) => void;
  onSelectFolder: (folderId: string) => void;
  onPrefetchFolder?: (folderId: string) => void;
  onCancelPrefetchFolder?: () => void;
  onSelectTag: (tagId: string) => void;
  onGoHome: () => void;
  onReturnToList: () => void;
  onCreateRootFolder: () => void;
  onCreateTag: () => void;
  onOpenPrivateMode: () => void;
  onOpenApiTokens: () => void;
  onOpenAIOrganize: () => void;
  onOpenShares: () => void;
  onOpenExtensionDevices: () => void;
  onOpenImportNew: () => void;
  onOpenImportHistory: () => void;
  onLogout: () => void;
  contextMenuFolderId: string | null;
  onFolderContextMenu: (folder: Folder, event: ReactMouseEvent<HTMLElement>) => void;
  contextMenuTagId: string | null;
  onTagContextMenu: (tag: Tag, event: ReactMouseEvent<HTMLElement>) => void;
  children: ReactNode;
  logoutLabel?: string;
}) {
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set());
  const isSettingsPage = routePage.startsWith("settings-") || routePage.startsWith("imports-") || routePage === "private-mode" || routePage === "extension-connect";
  const [sidebarView, setSidebarView] = useState<"main" | "settings">(isSettingsPage ? "settings" : "main");
  useEffect(() => { setSidebarView(isSettingsPage ? "settings" : "main"); }, [routePage, isSettingsPage]);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [folderSearch, setFolderSearch] = useState("");
  const sidebarRef = useDialogFocus<HTMLElement>(mobileSidebarOpen, () => setMobileSidebarOpen(false));
  const folderListRef = useRef<HTMLDivElement | null>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const activeNav = selectedFolderId || selectedTagId ? null : bookmarkView;
  const sortedFolders = useMemo(
    () => [...folders].sort((left, right) => left.path.localeCompare(right.path, "zh-CN")),
    [folders],
  );

  const childrenByParent = useMemo(() => {
    const mapping = new Map<string | null, Folder[]>();
    for (const folder of sortedFolders) {
      const key = folder.parentId ?? null;
      const current = mapping.get(key) ?? [];
      current.push(folder);
      mapping.set(key, current);
    }
    return mapping;
  }, [sortedFolders]);

  const visibleFolderRows = useMemo(() => {
    if (folderSearch.trim()) {
      return sortedFolders.filter((folder) => folder.path.toLocaleLowerCase().includes(folderSearch.trim().toLocaleLowerCase())).map((folder) => ({ folder, depth: 0, hasChildren: false }));
    }
    const rows: Array<{ folder: Folder; depth: number; hasChildren: boolean }> = [];

    function append(folder: Folder, depth: number) {
      const folderChildren = childrenByParent.get(folder.id) ?? [];
      rows.push({
        folder,
        depth,
        hasChildren: folderChildren.length > 0,
      });
      if (!expandedFolderIds.has(folder.id)) {
        return;
      }
      for (const child of folderChildren) {
        append(child, depth + 1);
      }
    }

    for (const folder of childrenByParent.get(null) ?? []) {
      append(folder, 0);
    }

    return rows;
  }, [childrenByParent, expandedFolderIds, folderSearch, sortedFolders]);

  const folderCounts = useMemo(() => {
    const mapping = new Map<string, number>();
    function visit(folderId: string): number {
      const directCount = folderItemCounts[folderId] ?? 0;
      const nestedCount = (childrenByParent.get(folderId) ?? [])
        .reduce((sum, child) => sum + visit(child.id), 0);
      const total = directCount + nestedCount;
      mapping.set(folderId, total);
      return total;
    }

    for (const folder of childrenByParent.get(null) ?? []) {
      visit(folder.id);
    }
    return mapping;
  }, [childrenByParent, folderItemCounts]);

  useEffect(() => {
    setExpandedFolderIds((current) => {
      const next = new Set(
        [...current].filter((folderId) => sortedFolders.some((folder) => folder.id === folderId)),
      );
      if (next.size === current.size) {
        let changed = false;
        for (const folderId of next) {
          if (!current.has(folderId)) {
            changed = true;
            break;
          }
        }
        if (!changed) {
          return current;
        }
      }
      return next;
    });
  }, [sortedFolders]);

  useEffect(() => {
    if (!selectedFolderId) return;
    const frame = requestAnimationFrame(() => folderListRef.current?.querySelector<HTMLElement>(".is-active")?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [selectedFolderId]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1080px)");
    const update = () => {
      if (sidebarRef.current) sidebarRef.current.inert = media.matches && !mobileSidebarOpen;
      if (!media.matches && mobileSidebarOpen) setMobileSidebarOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [mobileSidebarOpen]);

  const displayName = displayUserName(user);
  const privateModeStateLabel = !privateModeSummary
    ? "读取中"
    : !privateModeSummary.enabled
      ? "未启用"
      : privateModeUnlocked
        ? "已进入"
        : "已锁定";

  useEffect(() => {
    if (!mobileSearchOpen) {
      return;
    }

    const timer = window.setTimeout(() => {
      mobileSearchInputRef.current?.focus();
      mobileSearchInputRef.current?.select();
    }, 120);

    return () => window.clearTimeout(timer);
  }, [mobileSearchOpen]);

  useEffect(() => {
    setMobileSidebarOpen(false);
    setMobileSearchOpen(false);
  }, [routePage]);

  function handleSelectQuickNav(nextNav: BookmarkListView) {
    setSidebarView("main");
    setMobileSidebarOpen(false);
    setMobileSearchOpen(false);
    onSelectBookmarkView(nextNav);
  }

  function handleSelectFolderFilter(nextFolderId: string) {
    setSidebarView("main");
    setMobileSidebarOpen(false);
    setMobileSearchOpen(false);
    onSelectFolder(nextFolderId);
  }

  function handleSelectTagFilter(nextTagId: string) {
    setSidebarView("main");
    setMobileSidebarOpen(false);
    setMobileSearchOpen(false);
    onSelectTag(nextTagId);
  }

  function handleToggleFolder(folder: Folder) {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folder.id)) {
        next.delete(folder.id);
        return next;
      }

      next.add(folder.id);
      return next;
    });
  }

  return (
    <main className={`home-page${isSettingsPage ? " settings-workspace" : ""}${workspaceScope === "private" ? " is-private-scope" : ""}`}>
      <button
        className={mobileSidebarOpen ? "home-mobile-sidebar-backdrop is-visible" : "home-mobile-sidebar-backdrop"}
        type="button"
        aria-label="关闭移动端侧边栏"
        tabIndex={mobileSidebarOpen ? 0 : -1}
        aria-hidden={!mobileSidebarOpen}
        onClick={() => setMobileSidebarOpen(false)}
      />
      <aside ref={sidebarRef} role={mobileSidebarOpen ? "dialog" : undefined} aria-modal={mobileSidebarOpen || undefined} aria-label="收藏夹与设置导航" tabIndex={-1} className={mobileSidebarOpen ? "home-sidebar is-mobile-open" : "home-sidebar"}>
        {sidebarView === "settings" ? (
          <div className="home-settings-panel">
            <div className="settings-nav-top">
            <button
              className="home-settings-back"
              type="button"
              onClick={() => { setSidebarView("main"); setMobileSidebarOpen(false); onReturnToList(); }}
              aria-label="返回书签"
            >
              <Icon name="arrow_back" />
              <span>返回书签</span>
            </button>
            <button type="button" className="settings-icon-button settings-nav-close" aria-label="关闭设置分类" onClick={() => setMobileSidebarOpen(false)}><Icon name="close" /></button>
            </div>
            <div className="settings-nav-heading"><span>KeepPage</span><h2>设置</h2><p>让资料库更适合你</p></div>

            <nav className="home-settings-list" aria-label="设置分类">
              <p className="settings-nav-group">资料库</p>
              <button
                aria-current={routePage === "private-mode" ? "page" : undefined}
                className={routePage === "private-mode"
                  ? "home-settings-item is-active"
                  : "home-settings-item"}
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  onOpenPrivateMode();
                }}
              >
                <Icon name="lock" />
                <span>私密模式</span>
                <small className="home-settings-status">{privateModeStateLabel}</small>
              </button>
              <button
                aria-current={routePage === "settings-ai-organize" ? "page" : undefined}
                className={routePage === "settings-ai-organize" ? "home-settings-item is-active" : "home-settings-item"}
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  onOpenAIOrganize();
                }}
              >
                <Icon name="auto_awesome" />
                <span>AI 整理</span>
              </button>
              <p className="settings-nav-group">连接与分享</p>
              <button
                aria-current={routePage === "settings-api-tokens" ? "page" : undefined}
                className={routePage === "settings-api-tokens" ? "home-settings-item is-active" : "home-settings-item"}
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  onOpenApiTokens();
                }}
              >
                <Icon name="vpn_key" />
                <span>API 密钥</span>
              </button>
              <button
                aria-current={routePage === "settings-shares" ? "page" : undefined}
                className={routePage === "settings-shares" ? "home-settings-item is-active" : "home-settings-item"}
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  onOpenShares();
                }}
              >
                <Icon name="share" />
                <span>我的分享</span>
              </button>
              <button
                aria-current={routePage === "settings-extension-devices" || routePage === "extension-connect" ? "page" : undefined}
                className={routePage === "settings-extension-devices" || routePage === "extension-connect"
                  ? "home-settings-item is-active"
                  : "home-settings-item"}
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  onOpenExtensionDevices();
                }}
              >
                <Icon name="link" />
                <span>插件设备</span>
              </button>
              <p className="settings-nav-group">数据管理</p>
              <button
                className={routePage === "imports-new" ? "home-settings-item is-active" : "home-settings-item"}
                aria-current={routePage === "imports-new" ? "page" : undefined}
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  onOpenImportNew();
                }}
              >
                <Icon name="add" />
                <span>新建导入</span>
              </button>
              <button
                className={routePage === "imports-list" || routePage === "imports-detail" ? "home-settings-item is-active" : "home-settings-item"}
                aria-current={routePage === "imports-list" || routePage === "imports-detail" ? "page" : undefined}
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  onOpenImportHistory();
                }}
              >
                <Icon name="history" />
                <span>导入历史</span>
              </button>
              <div className="home-settings-divider" aria-hidden="true" />
              <button
                className="home-settings-item is-danger"
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  setSidebarView("main");
                  onLogout();
                }}
              >
                <Icon name="logout" />
                <span>{logoutLabel}</span>
              </button>
            </nav>
          </div>
        ) : (
          <>
            <div className="home-brand">
              <button className="home-brand-home" type="button" onClick={onGoHome} aria-label="返回主页">
                <span className="home-brand-title">KeepPage</span>
              </button>
              <button
                className="home-brand-action"
                type="button"
                onClick={() => setSidebarView("settings")}
                aria-label="打开设置"
              >
                <Icon name="more_horiz" />
              </button>
            </div>

            <label className="home-search">
              <Icon className="home-search-icon" name="search" />
              <input
                className="home-search-input"
                type="search"
                value={searchInput}
                onChange={(event) => onSearchChange(event.target.value)}
                aria-label={workspaceScope === "private" ? "搜索私密书签" : "搜索书签"}
                placeholder={workspaceScope === "private" ? "搜索私密书签..." : "搜索标题、域名、标签..."}
              />
            </label>

            {privateModeSummary?.enabled || workspaceScope === "private" ? (
              <div className="home-scope-switch" role="group" aria-label="内容模式">
                {(["standard", "private"] as const).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    className={workspaceScope === scope ? "home-scope-option is-active" : "home-scope-option"}
                    aria-pressed={workspaceScope === scope}
                    onClick={() => {
                      setMobileSidebarOpen(false);
                      onSwitchWorkspaceScope(scope);
                    }}
                  >
                    {scope === "private" ? <Icon name={privateModeUnlocked ? "lock_open" : "lock"} /> : <Icon name="bookmark" />}
                    <span>{scope === "private" ? "私密" : "书签"}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <nav className="home-quick-nav" aria-label="快捷导航">
              <button
                className={activeNav === "all" ? "home-quick-nav-item is-active" : "home-quick-nav-item"}
                type="button"
                onClick={() => handleSelectQuickNav("all")}
              >
                <Icon name="bookmark" />
                <span>全部书签</span>
              </button>
              <button
                className={activeNav === "recent" ? "home-quick-nav-item is-active" : "home-quick-nav-item"}
                type="button"
                onClick={() => handleSelectQuickNav("recent")}
              >
                <Icon name="schedule" />
                <span>最近更新</span>
              </button>
              <button
                className={activeNav === "favorites" ? "home-quick-nav-item is-active" : "home-quick-nav-item"}
                type="button"
                onClick={() => handleSelectQuickNav("favorites")}
              >
                <Icon name="star" />
                <span>星标收藏</span>
              </button>
            </nav>

            <div className="home-sidebar-scroll">
              <section className="home-sidebar-section">
                <header className="home-sidebar-section-head">
                  <span>收藏夹</span>
                  <button
                    className="home-section-action"
                    type="button"
                    onClick={() => { setMobileSidebarOpen(false); onCreateRootFolder(); }}
                    disabled={managerBusy || workspaceLocked}
                    aria-label="新建收藏夹"
                    title="新建收藏夹"
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </header>
                <input className="home-folder-search" type="search" aria-label="查找收藏夹" placeholder="查找收藏夹…" value={folderSearch} onChange={(event) => setFolderSearch(event.target.value)} />
                <div className="home-folder-list" ref={folderListRef}>
                  {visibleFolderRows.length === 0 ? <p className="home-folder-empty">{workspaceLocked ? "解锁后显示私密收藏夹" : "没有匹配的收藏夹"}</p> : null}
                  {visibleFolderRows.map(({ folder, depth, hasChildren }) => (
                    <div
                      className="home-folder-row"
                      key={folder.id}
                      onContextMenuCapture={(event) => onFolderContextMenu(folder, event)}
                      onContextMenu={(event) => onFolderContextMenu(folder, event)}
                    >
                      <button
                        className={[
                          "home-folder-main",
                          selectedFolderId === folder.id ? "is-active" : "",
                          depth > 0 ? "is-child" : "",
                          contextMenuFolderId === folder.id ? "is-context-open" : "",
                        ].filter(Boolean).join(" ")}
                        type="button"
                        aria-current={selectedFolderId === folder.id ? "page" : undefined}
                        title={folder.path}
                        onPointerEnter={() => onPrefetchFolder?.(folder.id)}
                        onFocus={() => onPrefetchFolder?.(folder.id)}
                        onPointerLeave={onCancelPrefetchFolder}
                        onBlur={onCancelPrefetchFolder}
                        style={{ paddingLeft: `${12 + depth * 14}px` }}
                        onContextMenuCapture={(event) => onFolderContextMenu(folder, event)}
                        onClick={() => handleSelectFolderFilter(folder.id)}
                      >
                        <span className="home-folder-label">
                          <Icon className="home-folder-icon" name="folder_open" />
                          <span className="home-folder-name">{folderSearch.trim() ? folder.path : folder.name}</span>
                        </span>
                        <span className="home-folder-count">{folderCounts.get(folder.id) ?? 0}</span>
                      </button>
                      {hasChildren ? (
                        <button
                          className={[
                            "home-folder-toggle",
                            expandedFolderIds.has(folder.id) ? "is-expanded" : "",
                            contextMenuFolderId === folder.id ? "is-context-open" : "",
                          ].filter(Boolean).join(" ")}
                          type="button"
                          onContextMenuCapture={(event) => onFolderContextMenu(folder, event)}
                          onClick={() => handleToggleFolder(folder)}
                          aria-expanded={expandedFolderIds.has(folder.id)}
                          aria-label={`${expandedFolderIds.has(folder.id) ? "收起" : "展开"} ${folder.name}`}
                        >
                          <Icon name="keyboard_arrow_right" />
                        </button>
                      ) : (
                        <span className="home-folder-toggle-spacer" aria-hidden="true" />
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className="home-sidebar-section">
                <header className="home-sidebar-section-head">
                  <span>标签</span>
                  <button
                    className="home-section-action"
                    type="button"
                    onClick={() => { setMobileSidebarOpen(false); onCreateTag(); }}
                    disabled={managerBusy || workspaceLocked}
                    aria-label="新建标签"
                    title="新建标签"
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </header>
                <div className="home-tag-list">
                  {tags.map((tag) => {
                    const active = selectedTagId === tag.id;
                    const contextOpen = contextMenuTagId === tag.id;
                    return (
                      <button
                        key={tag.id}
                        className={[
                          "home-tag-chip",
                          active ? "is-active" : "",
                          contextOpen ? "is-context-open" : "",
                        ].filter(Boolean).join(" ")}
                        type="button"
                        onClick={() => handleSelectTagFilter(active ? "" : tag.id)}
                        onContextMenu={(event) => onTagContextMenu(tag, event)}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="home-sidebar-footer">
              {/* Imports always land in the standard library, so hide the entry inside the vault. */}
              {workspaceScope === "private" ? null : (
                <button className="home-add-new-btn" type="button" onClick={onOpenImportNew}>
                  <Icon name="add" />
                  <span>导入书签</span>
                </button>
              )}

              <div className="home-user-profile">
                <div className="home-avatar">{userInitials(user)}</div>
                <div className="home-user-info">
                  <span className="home-user-name">{displayName}</span>
                  <span className="home-user-plan">个人资料库</span>
                </div>
                <button
                  className="home-settings-btn"
                  type="button"
                  onClick={() => setSidebarView("settings")}
                  aria-label="打开设置"
                >
                  <Icon name="settings" />
                </button>
              </div>
            </div>
          </>
        )}
      </aside>

      <div className={routePage === "list" ? "home-shell has-mobile-list-chrome" : "home-shell"}>
        {routePage === "list" ? (
          <section className="home-mobile-bar home-mobile-bar--list" aria-label="移动端顶栏">
            <div className="home-mobile-topbar">
              <button
                className={mobileSidebarOpen && sidebarView === "main" ? "home-mobile-icon-button is-active" : "home-mobile-icon-button"}
                type="button"
                onClick={() => {
                  setMobileSearchOpen(false);
                  setSidebarView("main");
                  setMobileSidebarOpen((current) => (sidebarView === "main" ? !current : true));
                }}
                aria-label="打开筛选与收藏夹"
              >
                <Icon name="menu" />
              </button>

              <button className="home-mobile-title-wrap" type="button" onClick={onGoHome} aria-label="返回归档首页">
                <span className="home-mobile-title">KeepPage</span>
              </button>

              <button
                className={mobileSearchOpen || searchInput.trim() ? "home-mobile-icon-button is-active" : "home-mobile-icon-button"}
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  setSidebarView("main");
                  setMobileSearchOpen((current) => !current);
                }}
                aria-label="打开搜索"
                aria-expanded={mobileSearchOpen}
              >
                <Icon name="search" />
              </button>
            </div>

            <div
              className={mobileSearchOpen || searchInput.trim() ? "home-mobile-search-panel is-open" : "home-mobile-search-panel"}
              aria-hidden={!mobileSearchOpen && !searchInput.trim()}
            >
              <label className="home-search">
                <Icon className="home-search-icon" name="search" />
                <input
                  ref={mobileSearchInputRef}
                  tabIndex={mobileSearchOpen || searchInput.trim() ? 0 : -1}
                  className="home-search-input"
                  type="search"
                  value={searchInput}
                  onChange={(event) => onSearchChange(event.target.value)}
                  aria-label="搜索书签"
                placeholder="搜索标题、域名、标签..."
                />
              </label>
            </div>
          </section>
        ) : (
          <section className="home-mobile-bar home-mobile-bar--default">
            <div className="home-mobile-header">
              <button className="home-brand-home" type="button" onClick={onGoHome} aria-label="返回主页">
                <span className="home-brand-title">KeepPage</span>
              </button>
              <div className="home-mobile-actions">
                <button
                  className={mobileSidebarOpen && sidebarView === "main" ? "home-mobile-action is-active" : "home-mobile-action"}
                  type="button"
                  onClick={() => {
                    setMobileSearchOpen(false);
                    setSidebarView("main");
                    setMobileSidebarOpen((current) => (sidebarView === "main" ? !current : true));
                  }}
                  aria-label="打开筛选与收藏夹"
                >
                  <Icon name="tune" />
                </button>
                {workspaceScope === "private" ? null : (
                  <button className="home-mobile-cta" type="button" onClick={onOpenImportNew}>
                    <Icon name="add" />
                    <span>导入书签</span>
                  </button>
                )}
                <button
                  className={mobileSidebarOpen && sidebarView === "settings" ? "home-mobile-action is-active" : "home-mobile-action"}
                  type="button"
                  onClick={() => {
                    setMobileSearchOpen(false);
                    setSidebarView("settings");
                    setMobileSidebarOpen((current) => (sidebarView === "settings" ? !current : true));
                  }}
                  aria-label="打开设置"
                >
                  <Icon name={isSettingsPage ? "menu" : "settings"} />
                  {isSettingsPage ? <span>设置分类</span> : null}
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="home-content">
          {children}
        </section>

        {routePage === "list" ? (
          <>
            {workspaceScope === "private" ? null : (
              <button className="home-mobile-fab" type="button" onClick={onOpenImportNew} aria-label="新建归档导入">
                <Icon name="add" />
              </button>
            )}

            <nav className="home-mobile-bottom-nav" aria-label="移动端主导航">
              <button
                className={activeNav === "all" ? "home-mobile-bottom-nav-item is-active" : "home-mobile-bottom-nav-item"}
                type="button"
                onClick={() => handleSelectQuickNav("all")}
              >
                <Icon name="bookmarks" />
                <span>全部</span>
              </button>
              <button
                className={activeNav === "recent" ? "home-mobile-bottom-nav-item is-active" : "home-mobile-bottom-nav-item"}
                type="button"
                onClick={() => handleSelectQuickNav("recent")}
              >
                <Icon name="schedule" />
                <span>最近</span>
              </button>
              <button
                className={activeNav === "favorites" ? "home-mobile-bottom-nav-item is-active" : "home-mobile-bottom-nav-item"}
                type="button"
                onClick={() => handleSelectQuickNav("favorites")}
              >
                <Icon name="star" />
                <span>星标</span>
              </button>
              <button
                className={selectedFolderId || selectedTagId || (mobileSidebarOpen && sidebarView === "main") ? "home-mobile-bottom-nav-item is-active" : "home-mobile-bottom-nav-item"}
                type="button"
                onClick={() => {
                  setMobileSearchOpen(false);
                  setSidebarView("main");
                  setMobileSidebarOpen((current) => !current);
                }}
              >
                <Icon name="folder_open" />
                <span>收藏夹</span>
              </button>
            </nav>
          </>
        ) : null}
      </div>
    </main>
  );
}
