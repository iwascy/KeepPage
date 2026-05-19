import {
  memo,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
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
import { Icon } from "../../../components/Icon";
import { DefaultSiteIcon } from "../shared/DefaultSiteIcon";

type LoadState = "idle" | "loading" | "ready" | "error";

type InlineFeedback = {
  kind: "success" | "error";
  message: string;
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
        className={`home-bookmark-thumb is-${coverTone} has-default-icon`}
        aria-hidden="true"
      >
        <DefaultSiteIcon />
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
  selectionMode,
  selectedIds,
  onToggleSelect,
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
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (bookmarkId: string) => void;
}) {
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
    ? "当前筛选下没有匹配的归档"
    : bookmarkView === "favorites"
      ? "还没有收藏的归档"
      : bookmarkView === "recent"
        ? "最近 7 天还没有归档更新"
        : "还没有归档记录";
  const emptyDescription = hasActiveFilters
    ? "换个关键词，或者切换收藏夹和标签试试。"
    : bookmarkView === "favorites"
      ? "把常看的页面加入收藏后，会显示在这里。"
      : bookmarkView === "recent"
        ? "最近新归档或编辑过的页面会优先显示在这里。"
        : "扩展同步的网页归档会优先显示在这里。";
  const mobileHeroKicker = hasActiveFilters
    ? "FILTERED ARCHIVE"
    : bookmarkView === "favorites"
      ? "STARRED PICKS"
      : bookmarkView === "recent"
        ? "RECENT UPDATES"
        : "TODAY'S COLLECTIONS";
  const mobileHeroTitle = hasActiveFilters
    ? "筛选结果"
    : bookmarkView === "favorites"
      ? "星标归档"
      : bookmarkView === "recent"
        ? "最近更新"
        : "归档总览";
  const mobileHeroCount = `${Math.max(totalItems, items.length)} 条${bookmarkView === "recent" ? "更新" : "归档"}`;

  return (
    <>
      {managerFeedback ? (
        <p className={managerFeedback.kind === "error" ? "home-feedback is-error" : "home-feedback"}>
          {managerFeedback.message}
        </p>
      ) : null}

      <section className="home-mobile-hero" aria-label="移动端归档概览">
        <div className="home-mobile-hero-copy">
          <p className="home-mobile-hero-kicker">{mobileHeroKicker}</p>
          <div className="home-mobile-hero-title-row">
            <h1 className="home-mobile-hero-title">{mobileHeroTitle}</h1>
            <span className="home-mobile-hero-count">{mobileHeroCount}</span>
          </div>
        </div>
      </section>

      {showLoading && items.length > 0 ? (
        <p className="home-loading-note">正在刷新归档列表...</p>
      ) : null}

      {showLoading && items.length === 0 ? (
        <section className="home-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <HomeBookmarkSkeleton key={index} />
          ))}
        </section>
      ) : showError ? (
        <section className="home-empty-panel">
          <h2>归档列表加载失败</h2>
          <p>{listError ?? "暂时无法读取当前账号的归档列表。"}</p>
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
            ))}
            {loadingMore
              ? Array.from({ length: 4 }).map((_, index) => (
                  <HomeBookmarkSkeleton key={`load-more-skeleton-${index}`} />
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
            <div className="selection-toolbar-dropdown">
              <button
                type="button"
                className="selection-toolbar-dropdown-item"
                onClick={() => {
                  onBatchMoveTo(null);
                  onBatchDropdownChange("closed");
                }}
              >
                未归类
              </button>
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className="selection-toolbar-dropdown-item"
                  onClick={() => {
                    onBatchMoveTo(folder.id);
                    onBatchDropdownChange("closed");
                  }}
                >
                  {folder.path}
                </button>
              ))}
            </div>
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
            <div className="selection-toolbar-dropdown">
              {tags.length === 0 ? (
                <span className="selection-toolbar-dropdown-empty">暂无标签</span>
              ) : null}
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="selection-toolbar-dropdown-item"
                  onClick={() => {
                    onBatchSetTags([tag.id]);
                    onBatchDropdownChange("closed");
                  }}
                >
                  {tag.color ? <span className="selection-toolbar-tag-dot" style={{ background: tag.color }} /> : null}
                  {tag.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
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
  onBatchDelete,
  onExitSelection,
  onToggleFavorite,
  onLoadMore,
  onBookmarkContextMenu,
  onOpenBookmarkContextMenuAt,
  onToggleSelect,
}: {
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
  onBatchLocalArchive: () => void;
  onBatchMoveTo: (folderId: string | null) => void;
  onBatchSetTags: (tagIds: string[]) => void;
  onBatchDelete: () => void;
  onExitSelection: () => void;
  onToggleFavorite: (bookmark: Bookmark) => void;
  onLoadMore: () => void;
  onBookmarkContextMenu: (bookmark: Bookmark, event: ReactMouseEvent<HTMLElement>) => void;
  onOpenBookmarkContextMenuAt: (bookmark: Bookmark, x: number, y: number) => void;
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
          onBatchDelete={onBatchDelete}
          onExit={onExitSelection}
        />
      ) : null}
      <HomePage
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
        selectionMode={selectionMode}
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
      />
    </>
  );
}
