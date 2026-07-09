import {
  memo,
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
import {
  formatCompactRelativeWhen,
} from "../../../lib/date-format";
import type { ListUiVersion } from "../../../app/list-ui-preference";
import { Icon } from "../../../components/Icon";
import { DefaultSiteIcon } from "../shared/DefaultSiteIcon";
import { useBookmarkSiteIcon } from "../shared/site-icon";
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

function homeCoverTone(domain: string) {
  const tones = ["peach", "mist", "sand", "sky"] as const;
  let hash = 0;
  for (const char of domain) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return tones[hash % tones.length];
}

function formatDomain(domain: string) {
  return domain.replace(/^www\./i, "");
}

const HomeBookmarkCard = memo(function HomeBookmarkCard({
  bookmark,
  onToggleFavorite,
  onContextMenu,
  onOpenContextMenuAt,
  isContextOpen,
  selectionMode,
  isSelected,
  onToggleSelect,
}: {
  bookmark: Bookmark;
  onToggleFavorite: (bookmark: Bookmark) => void;
  onContextMenu: (bookmark: Bookmark, event: ReactMouseEvent<HTMLElement>) => void;
  onOpenContextMenuAt: (bookmark: Bookmark, x: number, y: number) => void;
  isContextOpen: boolean;
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: (bookmarkId: string) => void;
}) {
  const {
    siteIconSrc,
    useDefaultSiteIcon,
    handleSiteIconError,
    handleSiteIconLoad,
  } = useBookmarkSiteIcon(bookmark, 96);

  const coverTone = homeCoverTone(bookmark.domain);

  const cardClasses = [
    "home-bookmark-card",
    isContextOpen ? "is-context-open" : "",
    selectionMode ? "is-selection-mode" : "",
    isSelected ? "is-selected" : "",
  ].filter(Boolean).join(" ");

  return (
    <article
      className={cardClasses}
      onContextMenuCapture={(event) => onContextMenu(bookmark, event)}
      onContextMenu={(event) => onContextMenu(bookmark, event)}
    >
      {selectionMode ? (
        <span
          className={`home-bookmark-checkbox${isSelected ? " is-checked" : ""}`}
          aria-hidden="true"
        >
          {isSelected ? "✓" : ""}
        </span>
      ) : null}
      {selectionMode ? (
        <button
          className="home-bookmark-hitarea"
          type="button"
          onContextMenuCapture={(event) => onContextMenu(bookmark, event)}
          onClick={() => onToggleSelect(bookmark.id)}
          aria-label={`选择书签：${bookmark.title}`}
        />
      ) : (
        <a
          className="home-bookmark-hitarea"
          href={bookmark.sourceUrl}
          target="_blank"
          rel="noreferrer"
          onContextMenuCapture={(event) => onContextMenu(bookmark, event)}
          aria-label={`打开原网页：${bookmark.title}`}
        />
      )}
      <div
        className={`home-bookmark-thumb is-${coverTone}${useDefaultSiteIcon ? " has-default-icon" : ""}`}
        aria-hidden="true"
      >
        {siteIconSrc ? (
          <img
            className="home-bookmark-thumb-icon"
            src={siteIconSrc}
            alt=""
            loading="lazy"
            decoding="async"
            onError={handleSiteIconError}
            onLoad={(event) => handleSiteIconLoad(event.currentTarget)}
          />
        ) : (
          <DefaultSiteIcon />
        )}
      </div>
      <div className="home-bookmark-body">
        <div className="home-bookmark-top">
          <span className="home-bookmark-domain">{formatDomain(bookmark.domain)}</span>
          <span className="home-bookmark-time">{formatCompactRelativeWhen(bookmark.updatedAt)}</span>
        </div>
        <h2 className="home-bookmark-title">{bookmark.title}</h2>
        {!selectionMode ? (
          <footer className="home-bookmark-actions">
            <button
              className={`home-bookmark-iconbtn home-bookmark-star${bookmark.isFavorite ? " is-active" : ""}`}
              type="button"
              aria-pressed={bookmark.isFavorite}
              aria-label={bookmark.isFavorite ? `取消收藏：${bookmark.title}` : `收藏：${bookmark.title}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleFavorite(bookmark);
              }}
            >
              <Icon name="star" />
            </button>
            <button
              className="home-bookmark-iconbtn"
              type="button"
              aria-label={`打开归档菜单：${bookmark.title}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                onOpenContextMenuAt(bookmark, rect.right - 8, rect.bottom + 8);
              }}
            >
              <Icon name="more_horiz" />
            </button>
          </footer>
        ) : null}
      </div>
    </article>
  );
});

function HomeBookmarkSkeleton() {
  return (
    <article className="home-bookmark-card home-bookmark-card-skeleton">
      <div className="home-skeleton-thumb" />
      <div className="home-bookmark-body">
        <span className="home-skeleton-line is-meta" />
        <span className="home-skeleton-line is-title" />
        <span className="home-skeleton-line is-short" />
      </div>
    </article>
  );
}

function HomePage({
  items,
  totalItems,
  bookmarkView,
  listUiVersion,
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
}: {
  items: Bookmark[];
  totalItems: number;
  bookmarkView: BookmarkListView;
  listUiVersion: ListUiVersion;
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
}) {
  const isBrandUi = listUiVersion === "brand";
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  const showLoading = loadState === "loading";
  const showError = loadState === "error";
  const showEmpty = !showLoading && !showError && items.length === 0 && totalItems === 0;
  const canLoadMore = hasMoreItems && !loadingMore && loadState === "ready";

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
  const mobileHeroKicker = hasActiveFilters
    ? "FILTERED LIST"
    : bookmarkView === "favorites"
      ? "STARRED PICKS"
      : bookmarkView === "recent"
        ? "RECENT UPDATES"
        : "BOOKMARK LIBRARY";
  const mobileHeroTitle = hasActiveFilters
    ? "筛选结果"
    : bookmarkView === "favorites"
      ? "星标收藏"
      : bookmarkView === "recent"
        ? "最近添加"
        : "全部书签";
  const mobileHeroCount = `${Math.max(totalItems, items.length)} 条${bookmarkView === "recent" ? "更新" : "书签"}`;
  const gridClassName = isBrandUi ? "home-grid is-brand" : "home-grid";

  return (
    <>
      {managerFeedback ? (
        <p className={managerFeedback.kind === "error" ? "home-feedback is-error" : "home-feedback"}>
          {managerFeedback.message}
        </p>
      ) : null}

      <section className="home-mobile-hero" aria-label="移动端书签概览">
        <div className="home-mobile-hero-copy">
          <p className="home-mobile-hero-kicker">{mobileHeroKicker}</p>
          <div className="home-mobile-hero-title-row">
            <h1 className="home-mobile-hero-title">{mobileHeroTitle}</h1>
            <span className="home-mobile-hero-count">{mobileHeroCount}</span>
          </div>
        </div>
      </section>

      {showLoading && items.length > 0 ? (
        <p className="home-loading-note">正在刷新书签列表...</p>
      ) : null}

      {showLoading && items.length === 0 ? (
        <section className={gridClassName}>
          {Array.from({ length: 8 }).map((_, index) => (
            isBrandUi
              ? <BrandBookmarkSkeleton key={index} />
              : <HomeBookmarkSkeleton key={index} />
          ))}
        </section>
      ) : showError ? (
        <section className="home-empty-panel">
          <h2>书签列表加载失败</h2>
          <p>{listError ?? "暂时无法读取当前账号的书签列表。"}</p>
        </section>
      ) : showEmpty ? (
        <section className="home-empty-panel">
          <h2>{emptyTitle}</h2>
          <p>{emptyDescription}</p>
        </section>
      ) : (
        <>
          <section className={gridClassName}>
            {items.map((bookmark) => (
              isBrandUi ? (
                <BrandBookmarkCard
                  key={bookmark.id}
                  bookmark={bookmark}
                  onToggleFavorite={onToggleFavorite}
                  onContextMenu={onBookmarkContextMenu}
                  onOpenContextMenuAt={onOpenBookmarkContextMenuAt}
                  onOpenArchive={onOpenArchive}
                  isContextOpen={contextMenuBookmarkId === bookmark.id}
                  selectionMode={selectionMode}
                  isSelected={selectedIds.has(bookmark.id)}
                  onToggleSelect={onToggleSelect}
                />
              ) : (
                <HomeBookmarkCard
                  key={bookmark.id}
                  bookmark={bookmark}
                  onToggleFavorite={onToggleFavorite}
                  onContextMenu={onBookmarkContextMenu}
                  onOpenContextMenuAt={onOpenBookmarkContextMenuAt}
                  isContextOpen={contextMenuBookmarkId === bookmark.id}
                  selectionMode={selectionMode}
                  isSelected={selectedIds.has(bookmark.id)}
                  onToggleSelect={onToggleSelect}
                />
              )
            ))}
            {loadingMore
              ? Array.from({ length: 4 }).map((_, index) => (
                  isBrandUi
                    ? <BrandBookmarkSkeleton key={`load-more-skeleton-${index}`} />
                    : <HomeBookmarkSkeleton key={`load-more-skeleton-${index}`} />
                ))
              : null}
          </section>
          {loadMoreError ? (
            <p className="home-feedback is-error home-loading-note-inline">{loadMoreError}</p>
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

      <footer className="home-footer">
        <span>Privacy</span>
        <span>Terms</span>
        <span>Support</span>
        <span>KeepPage</span>
      </footer>
    </>
  );
}

function SearchableBatchDropdown({
  id,
  label,
  placeholder,
  options,
  emptyLabel,
  onClose,
}: {
  id: string;
  label: string;
  placeholder: string;
  options: BatchDropdownOption[];
  emptyLabel: string;
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
  busy: boolean;
  folders: Folder[];
  tags: Tag[];
  batchDropdown: "closed" | "folder" | "tag";
  onBatchDropdownChange: (value: "closed" | "folder" | "tag") => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBatchFavorite: (isFavorite: boolean) => void;
  onBatchLocalArchive: () => void;
  onBatchMoveTo: (folderId: string | null) => void;
  onBatchSetTags: (tagIds: string[]) => void;
  onBatchShare: () => void;
  onBatchDelete: () => void;
  onExit: () => void;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const allSelected = selectedCount === totalCount && totalCount > 0;
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
    onSelect: () => onBatchSetTags([tag.id]),
  })), [onBatchSetTags, tags]);

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
          {allSelected ? "取消全选" : "全选"}
        </button>
        <span className="selection-toolbar-count">
          已选 {selectedCount} / {totalCount}
        </span>
      </div>
      <div className="selection-toolbar-actions" ref={dropdownRef}>
        <button
          type="button"
          className="selection-toolbar-btn"
          disabled={!hasSelection || busy}
          onClick={() => onBatchFavorite(true)}
          title="加入收藏"
        >
          收藏
        </button>
        <button
          type="button"
          className="selection-toolbar-btn"
          disabled={!hasSelection || busy}
          onClick={() => onBatchFavorite(false)}
          title="取消收藏"
        >
          取消收藏
        </button>
        <button
          type="button"
          className="selection-toolbar-btn"
          disabled={!hasSelection || busy}
          onClick={onBatchLocalArchive}
          title="发送到本地插件队列"
        >
          本地存档
        </button>
        <div className="selection-toolbar-dropdown-wrapper">
          <button
            type="button"
            className="selection-toolbar-btn"
            disabled={!hasSelection || busy}
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
            onClick={() => onBatchDropdownChange(batchDropdown === "tag" ? "closed" : "tag")}
          >
            标签
          </button>
          {batchDropdown === "tag" ? (
            <SearchableBatchDropdown
              id="batch-tag"
              label="设置标签"
              placeholder="搜索标签..."
              options={tagOptions}
              emptyLabel={tags.length === 0 ? "暂无标签" : "没有匹配的标签"}
              onClose={() => onBatchDropdownChange("closed")}
            />
          ) : null}
        </div>
        <button
          type="button"
          className="selection-toolbar-btn"
          disabled={!hasSelection || busy}
          onClick={onBatchShare}
          title="生成公开分享链接"
        >
          分享
        </button>
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
  selectionMode,
  selectedIds,
  selectionBusy,
  items,
  totalItems,
  bookmarkView,
  listUiVersion,
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
  selectionMode: boolean;
  selectedIds: Set<string>;
  selectionBusy: boolean;
  items: Bookmark[];
  totalItems: number;
  bookmarkView: BookmarkListView;
  listUiVersion: ListUiVersion;
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
  onBatchLocalArchive: () => void;
  onBatchMoveTo: (folderId: string | null) => void;
  onBatchSetTags: (tagIds: string[]) => void;
  onBatchShare: () => void;
  onBatchDelete: () => void;
  onExitSelection: () => void;
  onToggleFavorite: (bookmark: Bookmark) => void;
  onLoadMore: () => void;
  onBookmarkContextMenu: (bookmark: Bookmark, event: ReactMouseEvent<HTMLElement>) => void;
  onOpenBookmarkContextMenuAt: (bookmark: Bookmark, x: number, y: number) => void;
  onOpenArchive: (bookmark: Bookmark) => void;
  onToggleSelect: (bookmarkId: string) => void;
}) {
  return (
    <>
      {selectionMode ? (
        <SelectionToolbar
          selectedCount={selectedIds.size}
          totalCount={items.length}
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
        items={items}
        totalItems={totalItems}
        bookmarkView={bookmarkView}
        listUiVersion={listUiVersion}
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
    </>
  );
}
