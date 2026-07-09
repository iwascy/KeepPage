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
import { Icon } from "../components/Icon";
import type { ViewRoute } from "./routes";
import { displayUserName, userInitials } from "./user-format";

export function AppShell({
  user,
  items,
  folderItemCounts,
  folders,
  tags,
  privateModeSummary,
  privateModeUnlocked,
  routePage,
  bookmarkView,
  selectedFolderId,
  selectedTagId,
  searchInput,
  onSearchChange,
  managerBusy,
  onSelectBookmarkView,
  onSelectFolder,
  onSelectTag,
  onGoHome,
  onCreateRootFolder,
  onCreateTag,
  onOpenPrivateMode,
  onOpenApiTokens,
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
  routePage: ViewRoute["page"];
  bookmarkView: BookmarkListView;
  selectedFolderId: string;
  selectedTagId: string;
  searchInput: string;
  onSearchChange: (value: string) => void;
  managerBusy: boolean;
  onSelectBookmarkView: (view: BookmarkListView) => void;
  onSelectFolder: (folderId: string) => void;
  onSelectTag: (tagId: string) => void;
  onGoHome: () => void;
  onCreateRootFolder: () => void;
  onCreateTag: () => void;
  onOpenPrivateMode: () => void;
  onOpenApiTokens: () => void;
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
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const [sidebarView, setSidebarView] = useState<"main" | "settings">("main");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const activeNav = selectedFolderId || selectedTagId ? null : bookmarkView;
  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) ?? null,
    [folders, selectedFolderId],
  );
  const selectedTag = useMemo(
    () => tags.find((tag) => tag.id === selectedTagId) ?? null,
    [selectedTagId, tags],
  );

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

  const descendantIdsByFolder = useMemo(() => {
    const mapping = new Map<string, string[]>();

    function visit(folder: Folder): string[] {
      const childIds = (childrenByParent.get(folder.id) ?? []).flatMap(visit);
      const ids = [folder.id, ...childIds];
      mapping.set(folder.id, ids);
      return ids;
    }

    for (const folder of childrenByParent.get(null) ?? []) {
      visit(folder);
    }

    return mapping;
  }, [childrenByParent]);

  const visibleFolderRows = useMemo(() => {
    const rows: Array<{ folder: Folder; depth: number; hasChildren: boolean }> = [];

    function append(folder: Folder, depth: number) {
      const folderChildren = childrenByParent.get(folder.id) ?? [];
      rows.push({
        folder,
        depth,
        hasChildren: folderChildren.length > 0,
      });
      if (collapsedFolderIds.has(folder.id)) {
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
  }, [childrenByParent, collapsedFolderIds]);

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
    setCollapsedFolderIds((current) => {
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

  const displayName = displayUserName(user);
  const mobileListTitle = selectedFolder?.name
    ?? (selectedTag ? `#${selectedTag.name}` : bookmarkView === "favorites" ? "星标" : bookmarkView === "recent" ? "最近" : "归档");
  const mobileListSubtitle = selectedFolder
    ? "当前收藏夹"
    : selectedTag
      ? "当前标签"
      : bookmarkView === "favorites"
        ? "Favorite Archive"
        : bookmarkView === "recent"
          ? "Recent Updates"
          : "KeepPage Archive";
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
    setSidebarView("main");
  }, [routePage]);

  function handleSelectQuickNav(nextNav: BookmarkListView) {
    setSidebarView("main");
    setMobileSidebarOpen(false);
    setMobileSearchOpen(false);
    onSelectBookmarkView(nextNav);
    onSelectFolder("");
    onSelectTag("");
  }

  function handleSelectFolderFilter(nextFolderId: string) {
    setSidebarView("main");
    setMobileSidebarOpen(false);
    setMobileSearchOpen(false);
    onSelectBookmarkView("all");
    onSelectTag("");
    onSelectFolder(nextFolderId);
  }

  function handleSelectTagFilter(nextTagId: string) {
    setSidebarView("main");
    setMobileSidebarOpen(false);
    setMobileSearchOpen(false);
    onSelectBookmarkView("all");
    onSelectFolder("");
    onSelectTag(nextTagId);
  }

  function handleToggleFolder(folder: Folder) {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folder.id)) {
        next.delete(folder.id);
        return next;
      }

      const descendantIds = descendantIdsByFolder.get(folder.id) ?? [folder.id];
      if (selectedFolderId && selectedFolderId !== folder.id && descendantIds.includes(selectedFolderId)) {
        onSelectFolder(folder.id);
      }
      next.add(folder.id);
      return next;
    });
  }

  return (
    <main className="home-page">
      <button
        className={mobileSidebarOpen ? "home-mobile-sidebar-backdrop is-visible" : "home-mobile-sidebar-backdrop"}
        type="button"
        aria-label="关闭移动端侧边栏"
        onClick={() => {
          setMobileSidebarOpen(false);
          setSidebarView("main");
        }}
      />
      <aside className={mobileSidebarOpen ? "home-sidebar is-mobile-open" : "home-sidebar"}>
        {sidebarView === "settings" ? (
          <div className="home-settings-panel">
            <button
              className="home-settings-back"
              type="button"
              onClick={() => setSidebarView("main")}
              aria-label="返回侧边栏"
            >
              <Icon name="arrow_back" />
              <span>设置</span>
            </button>

            <div className="home-settings-list">
              <button
                className={routePage === "private-mode" || routePage === "private-detail"
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
              <button
                className="home-settings-item"
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  setSidebarView("main");
                  onOpenImportNew();
                }}
              >
                <Icon name="add" />
                <span>新建导入</span>
              </button>
              <button
                className="home-settings-item"
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  setSidebarView("main");
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
            </div>
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
                placeholder="搜索标题、域名、标签..."
              />
            </label>

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
                  <span>Collections</span>
                  <button
                    className="home-section-action"
                    type="button"
                    onClick={onCreateRootFolder}
                    disabled={managerBusy}
                    aria-label="新建收藏夹"
                    title="新建收藏夹"
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </header>
                <div className="home-folder-list">
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
                        style={{ paddingLeft: `${12 + depth * 14}px` }}
                        onContextMenuCapture={(event) => onFolderContextMenu(folder, event)}
                        onClick={() => handleSelectFolderFilter(selectedFolderId === folder.id ? "" : folder.id)}
                      >
                        <span className="home-folder-label">
                          <Icon className="home-folder-icon" name="folder_open" />
                          <span className="home-folder-name">{folder.name}</span>
                        </span>
                        <span className="home-folder-count">{folderCounts.get(folder.id) ?? 0}</span>
                      </button>
                      {hasChildren ? (
                        <button
                          className={[
                            "home-folder-toggle",
                            collapsedFolderIds.has(folder.id) ? "" : "is-expanded",
                            contextMenuFolderId === folder.id ? "is-context-open" : "",
                          ].filter(Boolean).join(" ")}
                          type="button"
                          onContextMenuCapture={(event) => onFolderContextMenu(folder, event)}
                          onClick={() => handleToggleFolder(folder)}
                          aria-label={`${collapsedFolderIds.has(folder.id) ? "展开" : "收起"} ${folder.name}`}
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
                  <span>Tags</span>
                  <button
                    className="home-section-action"
                    type="button"
                    onClick={onCreateTag}
                    disabled={managerBusy}
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
              <button className="home-add-new-btn" type="button" onClick={onOpenImportNew}>
                <Icon name="add" />
                <span>Add New</span>
              </button>

              <div className="home-user-profile">
                <div className="home-avatar">{userInitials(user)}</div>
                <div className="home-user-info">
                  <span className="home-user-name">{displayName}</span>
                  <span className="home-user-plan">专业版</span>
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
                <span className="home-mobile-title-eyebrow">{mobileListSubtitle}</span>
                <span className="home-mobile-title">{mobileListTitle}</span>
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
            >
              <label className="home-search">
                <Icon className="home-search-icon" name="search" />
                <input
                  ref={mobileSearchInputRef}
                  className="home-search-input"
                  type="search"
                  value={searchInput}
                  onChange={(event) => onSearchChange(event.target.value)}
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
                <button className="home-mobile-cta" type="button" onClick={onOpenImportNew}>
                  <Icon name="add" />
                  <span>Add New</span>
                </button>
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
                  <Icon name="settings" />
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
            <button className="home-mobile-fab" type="button" onClick={onOpenImportNew} aria-label="新建归档导入">
              <Icon name="add" />
            </button>

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
