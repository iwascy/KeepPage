import {
  memo,
  type CSSProperties,
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
  formatRelativeWhen,
  formatWhen,
} from "../../../lib/date-format";
import {
  buildCoverImageSrcSet,
  buildCoverImageVariants,
  getLargestCoverImageUrl,
} from "../../../lib/cover-image";
import { Icon } from "../../../components/Icon";
import { useBookmarkSiteIcon } from "../shared/site-icon";

type LoadState = "idle" | "loading" | "ready" | "error";

type InlineFeedback = {
  kind: "success" | "error";
  message: string;
};

type VirtualGridMetrics = {
  columns: number;
  totalSize: number;
  virtualRows: Array<{
    index: number;
    start: number;
    height: number;
    items: Array<{
      bookmark: Bookmark;
      itemIndex: number;
    }>;
  }>;
};

const DESKTOP_GRID_MIN_COLUMN_WIDTH = 260;
const DESKTOP_GRID_GAP = 16;
const DESKTOP_GRID_ROW_HEIGHT = 150;
const MOBILE_GRID_GAP = 12;
const MOBILE_GRID_ROW_HEIGHT = 132;
const VIRTUAL_GRID_OVERSCAN_ROWS = 4;

function homeCoverTone(domain: string) {
  const tones = ["peach", "mist", "sand", "sky"] as const;
  let hash = 0;
  for (const char of domain) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return tones[hash % tones.length];
}

function useVirtualBookmarkGrid(items: Bookmark[]) {
  const gridRef = useRef<HTMLElement | null>(null);
  const [viewport, setViewport] = useState(() => ({
    height: typeof window === "undefined" ? 800 : window.innerHeight,
    scrollY: typeof window === "undefined" ? 0 : window.scrollY,
  }));
  const [gridRect, setGridRect] = useState(() => ({
    top: 0,
    width: getInitialGridWidth(),
  }));

  useEffect(() => {
    let frame = 0;

    function measure() {
      frame = 0;
      setViewport({
        height: window.innerHeight,
        scrollY: window.scrollY,
      });
      const element = gridRef.current;
      if (element) {
        const rect = element.getBoundingClientRect();
        setGridRect({
          top: rect.top + window.scrollY,
          width: rect.width,
        });
      }
    }

    function scheduleMeasure() {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(measure);
    }

    measure();
    window.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleMeasure);
    if (gridRef.current && resizeObserver) {
      resizeObserver.observe(gridRef.current);
    }

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      resizeObserver?.disconnect();
    };
  }, []);

  const metrics = useMemo<VirtualGridMetrics>(() => {
    const columns = calculateGridColumns(gridRect.width);
    const rowCount = Math.ceil(items.length / columns);
    const totalSize = calculateVirtualGridTotalSize(rowCount, columns);
    const viewportStart = Math.max(0, viewport.scrollY - gridRect.top);
    const viewportEnd = viewportStart + viewport.height;
    const startIndex = Math.max(0, findVirtualRowIndex(viewportStart, rowCount, columns) - VIRTUAL_GRID_OVERSCAN_ROWS);
    const endIndex = Math.min(
      rowCount - 1,
      findVirtualRowIndex(viewportEnd, rowCount, columns) + VIRTUAL_GRID_OVERSCAN_ROWS,
    );
    const virtualRows = [];

    for (let rowIndex = startIndex; rowIndex <= endIndex; rowIndex += 1) {
      const rowItems = items
        .slice(rowIndex * columns, rowIndex * columns + columns)
        .map((bookmark, offset) => ({
          bookmark,
          itemIndex: rowIndex * columns + offset,
        }));
      virtualRows.push({
        index: rowIndex,
        start: calculateVirtualRowStart(rowIndex, columns),
        height: calculateVirtualRowHeight(columns),
        items: rowItems,
      });
    }

    return {
      columns,
      totalSize,
      virtualRows,
    };
  }, [gridRect.top, gridRect.width, items, viewport.height, viewport.scrollY]);

  return {
    gridRef,
    metrics,
  };
}

function getInitialGridWidth() {
  if (typeof window === "undefined") {
    return DESKTOP_GRID_MIN_COLUMN_WIDTH;
  }

  if (window.innerWidth < 720) {
    return window.innerWidth;
  }

  return Math.max(DESKTOP_GRID_MIN_COLUMN_WIDTH, window.innerWidth - 320);
}

function calculateGridColumns(width: number) {
  if (width < 720) {
    return 1;
  }
  return Math.max(1, Math.floor((width + DESKTOP_GRID_GAP) / (DESKTOP_GRID_MIN_COLUMN_WIDTH + DESKTOP_GRID_GAP)));
}

function rowMetrics(columns: number) {
  if (columns > 1) {
    return { rowHeight: DESKTOP_GRID_ROW_HEIGHT, gap: DESKTOP_GRID_GAP };
  }
  return { rowHeight: MOBILE_GRID_ROW_HEIGHT, gap: MOBILE_GRID_GAP };
}

function calculateVirtualGridTotalSize(rowCount: number, columns: number) {
  if (rowCount === 0) {
    return 0;
  }
  const { rowHeight, gap } = rowMetrics(columns);
  return rowCount * rowHeight + (rowCount - 1) * gap;
}

function calculateVirtualRowStart(rowIndex: number, columns: number) {
  const { rowHeight, gap } = rowMetrics(columns);
  return rowIndex * (rowHeight + gap);
}

function calculateVirtualRowHeight(columns: number) {
  return rowMetrics(columns).rowHeight;
}

function findVirtualRowIndex(offset: number, rowCount: number, columns: number) {
  if (rowCount === 0) {
    return 0;
  }
  const { rowHeight, gap } = rowMetrics(columns);
  return Math.min(rowCount - 1, Math.floor(offset / (rowHeight + gap)));
}

const HomeBookmarkCard = memo(function HomeBookmarkCard({
  bookmark,
  onOpen,
  onOpenOriginal,
  onContextMenu,
  onOpenContextMenuAt,
  isContextOpen,
  selectionMode,
  isSelected,
  onToggleSelect,
  priority,
}: {
  bookmark: Bookmark;
  onOpen: (bookmarkId: string) => void;
  onOpenOriginal: (bookmark: Bookmark) => void;
  onContextMenu: (bookmark: Bookmark, event: ReactMouseEvent<HTMLElement>) => void;
  onOpenContextMenuAt: (bookmark: Bookmark, x: number, y: number) => void;
  isContextOpen: boolean;
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: (bookmarkId: string) => void;
  priority: boolean;
}) {
  const [coverImageFailed, setCoverImageFailed] = useState(false);
  const { siteIconSrc, handleSiteIconError } = useBookmarkSiteIcon(bookmark, 96);

  useEffect(() => {
    setCoverImageFailed(false);
  }, [bookmark.id, bookmark.coverImageUrl]);

  const hasCoverImage = Boolean(bookmark.coverImageUrl) && !coverImageFailed;
  const tagCount = bookmark.tags.length;
  const coverTone = homeCoverTone(bookmark.domain);
  const coverInitial = (bookmark.title.trim()[0] ?? bookmark.domain.trim()[0] ?? "K").toUpperCase();
  const coverImageVariants = buildCoverImageVariants(bookmark.coverImageUrl);
  const coverImageSrc = bookmark.coverImageUrl
    ? getLargestCoverImageUrl(coverImageVariants, bookmark.coverImageUrl)
    : undefined;

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
      <button
        className="home-bookmark-hitarea"
        type="button"
        onContextMenuCapture={(event) => onContextMenu(bookmark, event)}
        onClick={() => selectionMode ? onToggleSelect(bookmark.id) : onOpen(bookmark.id)}
        aria-label={selectionMode ? `选择书签：${bookmark.title}` : `打开归档：${bookmark.title}`}
      />
      <div
        className={`home-bookmark-thumb is-${coverTone}${hasCoverImage ? " has-image" : ""}`}
        aria-hidden="true"
      >
        {hasCoverImage ? (
          <img
            className="home-bookmark-thumb-media"
            src={coverImageSrc}
            srcSet={buildCoverImageSrcSet(coverImageVariants)}
            sizes="72px"
            alt=""
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={priority ? "high" : "low"}
            onError={() => setCoverImageFailed(true)}
          />
        ) : siteIconSrc ? (
          <img
            className="home-bookmark-thumb-icon"
            src={siteIconSrc}
            alt=""
            loading="lazy"
            decoding="async"
            onError={handleSiteIconError}
          />
        ) : (
          <span className="home-bookmark-thumb-initial">{coverInitial}</span>
        )}
      </div>
      <div className="home-bookmark-body">
        <div className="home-bookmark-top">
          <span className="home-bookmark-domain">{bookmark.domain}</span>
          <span className="home-bookmark-time">{formatRelativeWhen(bookmark.updatedAt)}</span>
        </div>
        <h2 className="home-bookmark-title">{bookmark.title}</h2>
        <footer className="home-bookmark-actions">
          {!selectionMode ? (
            <button
              className="home-bookmark-open"
              type="button"
              aria-label={`新标签打开原网页：${bookmark.title}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenOriginal(bookmark);
              }}
            >
              <Icon name="open_in_new" />
            </button>
          ) : null}
          <span className="home-bookmark-pills" aria-label="归档标签">
            {bookmark.folder ? (
              <span className="home-bookmark-pill">已归档</span>
            ) : null}
            {tagCount > 0 ? (
              <span className="home-bookmark-pill">{tagCount} 个标签</span>
            ) : null}
          </span>
          <span className="home-bookmark-actions-spacer" />
          {bookmark.isFavorite ? (
            <Icon className="home-bookmark-favorite" name="star" />
          ) : null}
          {!selectionMode ? (
            <button
              className="home-bookmark-menu-button"
              type="button"
              aria-label={`打开归档菜单：${bookmark.title}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                onOpenContextMenuAt(bookmark, rect.right - 8, rect.bottom + 8);
              }}
            >
              <Icon name="more_vert" />
            </button>
          ) : null}
        </footer>
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
  bookmarkView,
  loadState,
  listError,
  loadMoreError,
  hasActiveFilters,
  hasMoreItems,
  loadingMore,
  managerFeedback,
  onOpenBookmark,
  onOpenOriginal,
  onLoadMore,
  contextMenuBookmarkId,
  onBookmarkContextMenu,
  onOpenBookmarkContextMenuAt,
  selectionMode,
  selectedIds,
  onToggleSelect,
}: {
  items: Bookmark[];
  bookmarkView: BookmarkListView;
  loadState: LoadState;
  listError: string | null;
  loadMoreError: string | null;
  hasActiveFilters: boolean;
  hasMoreItems: boolean;
  loadingMore: boolean;
  managerFeedback: InlineFeedback | null;
  onOpenBookmark: (bookmarkId: string) => void;
  onOpenOriginal: (bookmark: Bookmark) => void;
  onLoadMore: () => void;
  contextMenuBookmarkId: string | null;
  onBookmarkContextMenu: (bookmark: Bookmark, event: ReactMouseEvent<HTMLElement>) => void;
  onOpenBookmarkContextMenuAt: (bookmark: Bookmark, x: number, y: number) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (bookmarkId: string) => void;
}) {
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const showLoading = loadState === "loading";
  const showError = loadState === "error";
  const showEmpty = !showLoading && !showError && items.length === 0;
  const visibleItems = items;
  const { gridRef, metrics } = useVirtualBookmarkGrid(visibleItems);
  const highPriorityImageCount = 4;
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
  const mobileHeroCount = `${items.length} 条${bookmarkView === "recent" ? "更新" : "归档"}`;

  useEffect(() => {
    if (
      !hasMoreItems
      || loadingMore
      || showLoading
      || showError
      || showEmpty
      || typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const target = loadMoreRef.current;
    if (!target) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      {
        rootMargin: "280px 0px",
      },
    );

    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [hasMoreItems, loadingMore, onLoadMore, showEmpty, showError, showLoading]);

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
          {Array.from({ length: 6 }).map((_, index) => (
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
          <section
            ref={gridRef}
            className="home-grid home-grid-virtual"
            style={{
              "--home-grid-total-size": `${metrics.totalSize}px`,
            } as CSSProperties}
          >
            {metrics.virtualRows.map((row) => (
              <div
                key={row.index}
                className="home-grid-virtual-row"
                style={{
                  "--home-grid-row-start": `${row.start}px`,
                  "--home-grid-row-height": `${row.height}px`,
                  "--home-grid-columns": metrics.columns,
                } as CSSProperties}
              >
                {row.items.map(({ bookmark, itemIndex }) => (
                  <HomeBookmarkCard
                    key={bookmark.id}
                    bookmark={bookmark}
                    onOpen={onOpenBookmark}
                    onOpenOriginal={onOpenOriginal}
                    onContextMenu={onBookmarkContextMenu}
                    onOpenContextMenuAt={onOpenBookmarkContextMenuAt}
                    isContextOpen={contextMenuBookmarkId === bookmark.id}
                    selectionMode={selectionMode}
                    isSelected={selectedIds.has(bookmark.id)}
                    onToggleSelect={onToggleSelect}
                    priority={itemIndex < highPriorityImageCount}
                  />
                ))}
              </div>
            ))}
          </section>
          {hasMoreItems ? (
            <div className="home-load-more-anchor" ref={loadMoreRef} aria-hidden="true" />
          ) : null}
          {loadingMore ? (
            <p className="home-loading-note home-loading-note-inline">正在加载更多归档...</p>
          ) : null}
          {loadMoreError ? (
            <p className="home-feedback is-error home-loading-note-inline">{loadMoreError}</p>
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
  onOpenBookmark,
  onOpenOriginal,
  onLoadMore,
  onBookmarkContextMenu,
  onOpenBookmarkContextMenuAt,
  onToggleSelect,
}: {
  selectionMode: boolean;
  selectedIds: Set<string>;
  selectionBusy: boolean;
  items: Bookmark[];
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
  onOpenBookmark: (bookmarkId: string) => void;
  onOpenOriginal: (bookmark: Bookmark) => void;
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
        bookmarkView={bookmarkView}
        loadState={loadState}
        listError={listError}
        loadMoreError={loadMoreError}
        hasActiveFilters={hasActiveFilters}
        hasMoreItems={hasMoreItems}
        loadingMore={loadingMore}
        managerFeedback={managerFeedback}
        onOpenBookmark={onOpenBookmark}
        onOpenOriginal={onOpenOriginal}
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
