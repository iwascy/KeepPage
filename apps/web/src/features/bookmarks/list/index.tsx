import {
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Bookmark,
  BookmarkListView,
  Folder,
  Tag,
} from "@keeppage/domain";
import { Icon } from "../../../components/Icon";
import { BrandBookmarkCard, BrandBookmarkSkeleton } from "./brand-card";

type LoadState = "idle" | "loading" | "ready" | "error";

type InlineFeedback = {
  kind: "success" | "error";
  message: string;
};

type BatchDropdownOption = {
  id: string;
  label: string;
  detail?: string;
  color?: string;
  onSelect: () => void;
};

function HomePage({
  items,
  totalItems,
  bookmarkView,
  loadState,
  listError,
  loadMoreError,
  hasActiveFilters,
  hasMoreItems,
  loadingMore,
  managerFeedback,
  onToggleFavorite,
  onLoadMore,
  contextMenuBookmarkId,
  onBookmarkContextMenu,
  onOpenBookmarkContextMenuAt,
  onOpenArchive,
  selectionMode,
  selectedIds,
  onToggleSelect,
  showSkeleton,
  onRetry,
  onRetryFailed,
  searchInput = "",
  onCreateArchive,
}: {
  items: Bookmark[];
  totalItems: number;
  bookmarkView: BookmarkListView;
  loadState: LoadState;
  listError: string | null;
  loadMoreError: string | null;
  hasActiveFilters: boolean;
  hasMoreItems: boolean;
  loadingMore: boolean;
  managerFeedback: InlineFeedback | null;
  onToggleFavorite: (bookmark: Bookmark) => void;
  onLoadMore: () => void;
  contextMenuBookmarkId: string | null;
  onBookmarkContextMenu: (bookmark: Bookmark, event: ReactMouseEvent<HTMLElement>) => void;
  onOpenBookmarkContextMenuAt: (bookmark: Bookmark, x: number, y: number) => void;
  onOpenArchive: (bookmark: Bookmark) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (bookmarkId: string) => void;
  showSkeleton?: boolean;
  onRetry?: () => void;
  onRetryFailed?: () => void;
  searchInput?: string;
  onCreateArchive?: (bookmark: Bookmark) => void;
}) {
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  const showLoading = loadState === "loading";
  const showError = loadState === "error" && items.length === 0;
  const showEmpty = !showLoading && !showError && items.length === 0 && totalItems === 0;
  const canLoadMore = hasMoreItems && !loadingMore && !loadMoreError && loadState === "ready";

  useEffect(() => {
    const node = loadMoreSentinelRef.current;
    if (!node || !canLoadMore) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canLoadMore, onLoadMore, items.length]);

  const emptyTitle = hasActiveFilters
    ? "当前筛选下没有匹配的书签"
    : bookmarkView === "favorites"
      ? "还没有星标书签"
      : bookmarkView === "recent"
        ? "最近 7 天还没有书签更新"
        : "还没有书签记录";
  const emptyDescription = hasActiveFilters
    ? "换个关键词，或者切换收藏夹和标签试试。"
    : bookmarkView === "favorites"
      ? "把常看的页面加入星标后，会显示在这里。"
      : bookmarkView === "recent"
        ? "最近新增或编辑过的书签会优先显示在这里。"
        : "扩展同步或导入的书签会显示在这里。";
  return (
    <>
      {managerFeedback ? (
        <p className={managerFeedback.kind === "error" ? "home-feedback is-error" : "home-feedback"}>
          {managerFeedback.message}
          {managerFeedback.kind === "error" && onRetryFailed ? <button className="library-inline-action" type="button" onClick={onRetryFailed}>重试失败项</button> : null}
        </p>
      ) : null}

      {listError && items.length > 0 ? (
        <div className="library-error" role="status">{listError} <button type="button" onClick={onRetry}>重试更新</button></div>
      ) : null}
      {showLoading && items.length === 0 && showSkeleton === false ? (
        <div className="library-loading-space" aria-busy="true" aria-label="正在加载书签" />
      ) : showLoading && items.length === 0 ? (
        <section className="home-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <BrandBookmarkSkeleton key={index} />
          ))}
        </section>
      ) : showError ? (
        <section className="home-empty-panel">
          <h2>书签列表加载失败</h2>
          <p>{listError ?? "暂时无法读取当前账号的书签列表。"}</p>
          <button className="secondary-button" type="button" onClick={onRetry}>重新加载</button>
        </section>
      ) : showEmpty ? (
        <section className="home-empty-panel">
          <h2>{emptyTitle}</h2>
          <p>{emptyDescription}</p>
        </section>
      ) : (
        <>
          <section className="home-grid">
            {items.map((bookmark) => (
              <BrandBookmarkCard
                key={bookmark.id}
                bookmark={bookmark}
                searchInput={searchInput}
                onCreateArchive={onCreateArchive}
                onToggleFavorite={onToggleFavorite}
                onContextMenu={onBookmarkContextMenu}
                onOpenContextMenuAt={onOpenBookmarkContextMenuAt}
                onOpenArchive={onOpenArchive}
                isContextOpen={contextMenuBookmarkId === bookmark.id}
                selectionMode={selectionMode}
                isSelected={selectedIds.has(bookmark.id)}
                onToggleSelect={onToggleSelect}
              />
            ))}
            {loadingMore
              ? Array.from({ length: 4 }).map((_, index) => (
                  <BrandBookmarkSkeleton key={`load-more-skeleton-${index}`} />
                ))
              : null}
          </section>
          {loadMoreError ? (
            <p className="home-feedback is-error home-loading-note-inline">{loadMoreError} <button type="button" onClick={onLoadMore}>重试加载</button></p>
          ) : null}
          {hasMoreItems ? (
            <div
              ref={loadMoreSentinelRef}
              className="home-load-more-sentinel"
              aria-hidden="true"
            />
          ) : null}
        </>
      )}

      <footer className="home-footer"><span>KeepPage · 你的个人资料库</span></footer>
    </>
  );
}

function SearchableBatchDropdown({
  id,
  label,
  placeholder,
  options,
  emptyLabel,
  children,
  onClose,
}: {
  id: string;
  label: string;
  placeholder: string;
  options: BatchDropdownOption[];
  emptyLabel: string;
  children?: ReactNode;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) {
      return options;
    }

    return options.filter((option) => {
      const searchableText = `${option.label} ${option.detail ?? ""}`.toLocaleLowerCase("zh-CN");
      return searchableText.includes(normalizedQuery);
    });
  }, [normalizedQuery, options]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery]);

  useEffect(() => {
    if (activeIndex > filteredOptions.length - 1) {
      setActiveIndex(Math.max(filteredOptions.length - 1, 0));
    }
  }, [activeIndex, filteredOptions.length]);

  function selectOption(option: BatchDropdownOption) {
    option.onSelect();
    onClose();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (filteredOptions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex((current) => Math.min(current + 1, filteredOptions.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      selectOption(filteredOptions[activeIndex] ?? filteredOptions[0]);
    }
  }

  return (
    <div className="selection-toolbar-dropdown is-searchable">
      {children}
      <label className="selection-toolbar-search" htmlFor={`${id}-search`}>
        <span>{label}</span>
        <input
          ref={inputRef}
          id={`${id}-search`}
          type="search"
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-options`}
          aria-activedescendant={filteredOptions[activeIndex] ? `${id}-option-${filteredOptions[activeIndex].id}` : undefined}
        />
      </label>

      {filteredOptions.length === 0 ? (
        <span className="selection-toolbar-dropdown-empty" role="status">{emptyLabel}</span>
      ) : (
        <div className="selection-toolbar-dropdown-list" id={`${id}-options`} role="listbox" aria-label={label}>
          {filteredOptions.map((option, index) => (
            <button
              key={option.id}
              id={`${id}-option-${option.id}`}
              type="button"
              className={[
                "selection-toolbar-dropdown-item",
                index === activeIndex ? "is-active" : "",
              ].filter(Boolean).join(" ")}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(option)}
            >
              {option.color ? <span className="selection-toolbar-tag-dot" style={{ background: option.color }} /> : null}
              <span className="selection-toolbar-option-copy">
                <span>{option.label}</span>
                {option.detail ? <small>{option.detail}</small> : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SelectionToolbar({
  selectedCount,
  totalCount,
  resultCount,
  selectedVisibleCount,
  onSelectAllResults,
  busy,
  folders,
  tags,
  batchDropdown,
  onBatchDropdownChange,
  onSelectAll,
  onDeselectAll,
  onBatchFavorite,
  onBatchLocalArchive,
  onBatchMoveTo,
  onBatchSetTags,
  onBatchShare,
  onBatchDelete,
  onExit,
}: {
  selectedCount: number;
  totalCount: number;
  resultCount: number;
  selectedVisibleCount: number;
  onSelectAllResults?: () => void;
  busy: boolean;
  folders: Folder[];
  tags: Tag[];
  batchDropdown: "closed" | "folder" | "tag";
  onBatchDropdownChange: (value: "closed" | "folder" | "tag") => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBatchFavorite: (isFavorite: boolean) => void;
  onBatchLocalArchive?: () => void;
  onBatchMoveTo: (folderId: string | null) => void;
  onBatchSetTags: (tagIds: string[], mode: "append" | "remove" | "replace") => void;
  onBatchShare?: () => void;
  onBatchDelete: () => void;
  onExit: () => void;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [tagMode, setTagMode] = useState<"append" | "remove" | "replace">("append");

  useEffect(() => {
    if (batchDropdown === "closed") {
      return;
    }

    const handleClickOutside = (event: globalThis.MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onBatchDropdownChange("closed");
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [batchDropdown, onBatchDropdownChange]);

  const allSelected = selectedVisibleCount === totalCount && totalCount > 0;
  const hasSelection = selectedCount > 0;
  const folderOptions = useMemo<BatchDropdownOption[]>(() => [
    {
      id: "uncategorized",
      label: "未归类",
      detail: "移出当前收藏夹",
      onSelect: () => onBatchMoveTo(null),
    },
    ...folders.map((folder) => ({
      id: folder.id,
      label: folder.path,
      detail: folder.name === folder.path ? undefined : folder.name,
      onSelect: () => onBatchMoveTo(folder.id),
    })),
  ], [folders, onBatchMoveTo]);
  const tagOptions = useMemo<BatchDropdownOption[]>(() => tags.map((tag) => ({
    id: tag.id,
    label: tag.name,
    color: tag.color,
    onSelect: () => onBatchSetTags([tag.id], tagMode),
  })), [onBatchSetTags, tags, tagMode]);

  return (
    <div className="selection-toolbar">
      <div className="selection-toolbar-left">
        <button
          type="button"
          className="selection-toolbar-check-all"
          onClick={allSelected ? onDeselectAll : onSelectAll}
          disabled={busy}
        >
          <span className={`selection-toolbar-checkbox${allSelected ? " is-checked" : ""}`}>
            {allSelected ? "✓" : ""}
          </span>
          {allSelected ? "清空选择" : `选中已加载 ${totalCount} 条`}
        </button>
        <span className="selection-toolbar-count">
          已选 {selectedCount} 条{selectedCount > selectedVisibleCount ? `（含当前未显示 ${selectedCount - selectedVisibleCount} 条）` : ""}
        </span>
      </div>
      {resultCount > totalCount && onSelectAllResults ? <button type="button" className="selection-toolbar-btn" disabled={busy} onClick={onSelectAllResults}>选择全部 {resultCount} 条结果</button> : null}
      <div className="selection-toolbar-actions" ref={dropdownRef}>
        <button
          type="button"
          className="selection-toolbar-btn"
          disabled={!hasSelection || busy}
          onClick={() => onBatchFavorite(true)}
          title="加入星标"
        >
          加入星标
        </button>
        <button
          type="button"
          className="selection-toolbar-btn"
          disabled={!hasSelection || busy}
          onClick={() => onBatchFavorite(false)}
          title="取消星标"
        >
          取消星标
        </button>
        {onBatchLocalArchive ? (
          <button
            type="button"
            className="selection-toolbar-btn"
            disabled={!hasSelection || busy}
            onClick={onBatchLocalArchive}
            title="发送到本地插件队列"
          >
            本地存档
          </button>
        ) : null}
        <div className="selection-toolbar-dropdown-wrapper">
          <button
            type="button"
            className="selection-toolbar-btn"
            disabled={!hasSelection || busy}
            aria-expanded={batchDropdown === "folder"}
            onClick={() => onBatchDropdownChange(batchDropdown === "folder" ? "closed" : "folder")}
          >
            移动到
          </button>
          {batchDropdown === "folder" ? (
            <SearchableBatchDropdown
              id="batch-folder"
              label="移动到收藏夹"
              placeholder="搜索收藏夹..."
              options={folderOptions}
              emptyLabel="没有匹配的收藏夹"
              onClose={() => onBatchDropdownChange("closed")}
            />
          ) : null}
        </div>
        <div className="selection-toolbar-dropdown-wrapper">
          <button
            type="button"
            className="selection-toolbar-btn"
            disabled={!hasSelection || busy}
            aria-expanded={batchDropdown === "tag"}
            onClick={() => onBatchDropdownChange(batchDropdown === "tag" ? "closed" : "tag")}
          >
            标签
          </button>
          {batchDropdown === "tag" ? (
            <SearchableBatchDropdown
              id="batch-tag"
              label={tagMode === "append" ? "追加标签" : tagMode === "remove" ? "移除标签" : "替换全部标签"}
              placeholder="搜索标签..."
              options={tagOptions}
              emptyLabel={tags.length === 0 ? "暂无标签" : "没有匹配的标签"}
              onClose={() => onBatchDropdownChange("closed")}
            >
              <label className="batch-tag-mode">标签操作<select value={tagMode} onChange={(event) => setTagMode(event.target.value as typeof tagMode)}><option value="append">追加标签</option><option value="remove">移除标签</option><option value="replace">替换全部标签</option></select>{tagMode === "replace" ? <small>会移除所选书签的其他标签</small> : null}</label>
            </SearchableBatchDropdown>
          ) : null}
        </div>
        {onBatchShare ? (
          <button
            type="button"
            className="selection-toolbar-btn"
            disabled={!hasSelection || busy}
            onClick={onBatchShare}
            title="生成公开分享链接"
          >
            分享
          </button>
        ) : null}
        <button
          type="button"
          className="selection-toolbar-btn is-danger"
          disabled={!hasSelection || busy}
          onClick={onBatchDelete}
        >
          删除
        </button>
      </div>
      <button
        type="button"
        className="selection-toolbar-exit"
        onClick={onExit}
        disabled={busy}
      >
        退出选择
      </button>
    </div>
  );
}

export function BookmarksListRoute({
  title,
  isPrivate = false,
  searchInput = "",
  selectedFolderId = "",
  selectedTagId = "",
  sort = "created",
  onSortChange,
  onClearFilters,
  onClearTag,
  onClearSearch,
  onSearchGlobally,
  onRetry,
  onRetryFailed,
  onSelectAllResults,
  onEnterSelection,
  showSkeleton,
  onCreateArchive,
  selectionMode,
  selectedIds,
  selectionBusy,
  items,
  totalItems,
  bookmarkView,
  loadState,
  listError,
  loadMoreError,
  hasActiveFilters,
  hasMoreItems,
  loadingMore,
  managerFeedback,
  contextMenuBookmarkId,
  folders,
  tags,
  batchDropdown,
  onBatchDropdownChange,
  onSelectAll,
  onDeselectAll,
  onBatchFavorite,
  onBatchLocalArchive,
  onBatchMoveTo,
  onBatchSetTags,
  onBatchShare,
  onBatchDelete,
  onExitSelection,
  onToggleFavorite,
  onLoadMore,
  onBookmarkContextMenu,
  onOpenBookmarkContextMenuAt,
  onOpenArchive,
  onToggleSelect,
}: {
  title?: string;
  /** Private workspace: same library UI, scoped to the unlocked vault. */
  isPrivate?: boolean;
  searchInput?: string;
  selectedFolderId?: string;
  selectedTagId?: string;
  sort?: "created" | "updated" | "title" | "relevance";
  onSortChange?: (value: "created" | "updated" | "title" | "relevance") => void;
  onClearFilters?: () => void;
  onClearTag?: () => void;
  onClearSearch?: () => void;
  onSearchGlobally?: () => void;
  onRetry?: () => void;
  onRetryFailed?: () => void;
  onSelectAllResults?: () => void;
  onEnterSelection?: () => void;
  showSkeleton?: boolean;
  onCreateArchive?: (bookmark: Bookmark) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  selectionBusy: boolean;
  items: Bookmark[];
  totalItems: number;
  bookmarkView: BookmarkListView;
  loadState: LoadState;
  listError: string | null;
  loadMoreError: string | null;
  hasActiveFilters: boolean;
  hasMoreItems: boolean;
  loadingMore: boolean;
  managerFeedback: InlineFeedback | null;
  contextMenuBookmarkId: string | null;
  folders: Folder[];
  tags: Tag[];
  batchDropdown: "closed" | "folder" | "tag";
  onBatchDropdownChange: (value: "closed" | "folder" | "tag") => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBatchFavorite: (isFavorite: boolean) => void;
  onBatchLocalArchive?: () => void;
  onBatchMoveTo: (folderId: string | null) => void;
  onBatchSetTags: (tagIds: string[], mode: "append" | "remove" | "replace") => void;
  onBatchShare?: () => void;
  onBatchDelete: () => void;
  onExitSelection: () => void;
  onToggleFavorite: (bookmark: Bookmark) => void;
  onLoadMore: () => void;
  onBookmarkContextMenu: (bookmark: Bookmark, event: ReactMouseEvent<HTMLElement>) => void;
  onOpenBookmarkContextMenuAt: (bookmark: Bookmark, x: number, y: number) => void;
  onOpenArchive: (bookmark: Bookmark) => void;
  onToggleSelect: (bookmarkId: string) => void;
}) {
  const [view, setView] = useState<"compact" | "gallery">(() => {
    try { return localStorage.getItem("keeppage.library-view") === "gallery" ? "gallery" : "compact"; } catch { return "compact"; }
  });
  const listTitle = title || folders.find((folder) => folder.id === selectedFolderId)?.path || (bookmarkView === "favorites" ? "星标收藏" : bookmarkView === "recent" ? "最近更新" : isPrivate ? "全部私密书签" : "全部书签");
  const countLabel = isPrivate ? "条私密书签" : "条书签";
  const selectedTag = tags.find((tag) => tag.id === selectedTagId);
  return (
    <div className={`bookmark-library is-${view}${isPrivate ? " is-private" : ""}`}>
      <header className="library-toolbar">
        <div className="library-heading"><h1 title={listTitle}>{isPrivate ? <span className="library-private-badge"><Icon name="lock" />私密</span> : null}{listTitle}</h1><p aria-live="polite">{loadState === "loading" && items.length === 0 ? (isPrivate ? "私密资料库" : "书签资料库") : `${totalItems} ${countLabel}`}{searchInput.trim() ? ` · 搜索“${searchInput.trim()}”` : ""}</p></div>
        <div className="library-tools">
          <label className="library-sort"><span className="sr-only">书签排序</span><select value={sort} onChange={(event) => onSortChange?.(event.target.value as typeof sort)}><option value="updated">最近更新</option><option value="created">收藏时间</option><option value="title">标题顺序</option>{searchInput.trim() ? <option value="relevance">搜索相关性</option> : null}</select></label>
          <div className="library-view-switch" role="group" aria-label="显示密度">
            {(["compact", "gallery"] as const).map((mode) => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => { setView(mode); try { localStorage.setItem("keeppage.library-view", mode); } catch { /* Storage may be unavailable. */ } }}>{mode === "compact" ? "紧凑" : "画廊"}</button>)}
          </div>
          {!selectionMode && onEnterSelection ? <button className="library-select" type="button" onClick={onEnterSelection}>多选</button> : null}
        </div>
      </header>
      {hasActiveFilters ? <div className="library-filter-bar"><span>范围：{listTitle}</span>{selectedTag ? <button className="library-filter-chip" type="button" onClick={onClearTag} aria-label={`清除标签筛选：${selectedTag.name}`}>标签 · {selectedTag.name} ×</button> : null}{searchInput.trim() ? <button className="library-filter-chip" type="button" onClick={onClearSearch} aria-label="清除关键词">关键词 · {searchInput.trim()} ×</button> : null}<button type="button" onClick={searchInput.trim() || selectedTag ? onClearFilters : onSearchGlobally}>{searchInput.trim() || selectedTag ? "清除筛选" : isPrivate ? "返回全部私密书签" : "返回全部书签"}</button>{searchInput.trim() && (selectedFolderId || selectedTagId || bookmarkView !== "all") ? <button type="button" onClick={onSearchGlobally}>{isPrivate ? "搜索全部私密书签" : "搜索全部书签"}</button> : null}</div> : null}
      {selectionMode ? (
        <SelectionToolbar
          selectedCount={selectedIds.size}
          totalCount={items.length}
          resultCount={totalItems}
          selectedVisibleCount={items.filter((item) => selectedIds.has(item.id)).length}
          onSelectAllResults={onSelectAllResults}
          busy={selectionBusy}
          folders={folders}
          tags={tags}
          batchDropdown={batchDropdown}
          onBatchDropdownChange={onBatchDropdownChange}
          onSelectAll={onSelectAll}
          onDeselectAll={onDeselectAll}
          onBatchFavorite={onBatchFavorite}
          onBatchLocalArchive={onBatchLocalArchive}
          onBatchMoveTo={onBatchMoveTo}
          onBatchSetTags={onBatchSetTags}
          onBatchShare={onBatchShare}
          onBatchDelete={onBatchDelete}
          onExit={onExitSelection}
        />
      ) : null}
      <HomePage
        searchInput={searchInput}
        showSkeleton={showSkeleton}
        onRetry={onRetry}
        onRetryFailed={onRetryFailed}
        onCreateArchive={onCreateArchive}
        items={items}
        totalItems={totalItems}
        bookmarkView={bookmarkView}
        loadState={loadState}
        listError={listError}
        loadMoreError={loadMoreError}
        hasActiveFilters={hasActiveFilters}
        hasMoreItems={hasMoreItems}
        loadingMore={loadingMore}
        managerFeedback={managerFeedback}
        onToggleFavorite={onToggleFavorite}
        onLoadMore={onLoadMore}
        contextMenuBookmarkId={contextMenuBookmarkId}
        onBookmarkContextMenu={onBookmarkContextMenu}
        onOpenBookmarkContextMenuAt={onOpenBookmarkContextMenuAt}
        onOpenArchive={onOpenArchive}
        selectionMode={selectionMode}
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
      />
    </div>
  );
}
