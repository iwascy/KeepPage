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

const DESKTOP_GRID_MIN_COLUMN_WIDTH = 280;
const DESKTOP_GRID_GAP = 23.2;
const DESKTOP_GRID_ROW_HEIGHT = 430;
const MOBILE_GRID_GAP = 14.4;
const MOBILE_FEATURED_ROW_HEIGHT = 398;
const MOBILE_COMPACT_ROW_HEIGHT = 136;
const VIRTUAL_GRID_OVERSCAN_ROWS = 4;

function summarizeBookmark(bookmark: Bookmark) {
  const note = bookmark.note.trim();
  if (note) {
    return note;
  }

  const firstReason = bookmark.latestQuality?.reasons.find((reason) => reason.code !== "screenshot-missing")?.message?.trim();
  if (firstReason) {
    return firstReason;
  }

  if (bookmark.folder?.path) {
    return `已归档到 ${bookmark.folder.path}，当前共保留 ${bookmark.versionCount} 个版本，可随时打开查看。`;
  }

  if (bookmark.tags.length > 0) {
    const tagNames = bookmark.tags.slice(0, 3).map((tag) => `#${tag.name}`).join("、");
    return `标签：${tagNames}。当前共保留 ${bookmark.versionCount} 个版本。`;
  }

  return `已保存来自 ${bookmark.domain} 的网页归档，当前共保留 ${bookmark.versionCount} 个版本。`;
}

function homeCoverTone(domain: string) {
  const tones = ["peach", "mist", "sand", "sky"] as const;
  let hash = 0;
  for (const char of domain) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return tones[hash % tones.length];
}

function useVirtualBookmarkGrid(
  items: Bookmark[],
  selectionMode: boolean,
) {
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
    const totalSize = calculateVirtualGridTotalSize(rowCount, columns, selectionMode);
    const viewportStart = Math.max(0, viewport.scrollY - gridRect.top);
    const viewportEnd = viewportStart + viewport.height;
    const startIndex = Math.max(0, findVirtualRowIndex(viewportStart, rowCount, columns, selectionMode) - VIRTUAL_GRID_OVERSCAN_ROWS);
    const endIndex = Math.min(
      rowCount - 1,
      findVirtualRowIndex(viewportEnd, rowCount, columns, selectionMode) + VIRTUAL_GRID_OVERSCAN_ROWS,
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
        start: calculateVirtualRowStart(rowIndex, columns, selectionMode),
        height: calculateVirtualRowHeight(rowIndex, columns, selectionMode),
        items: rowItems,
      });
    }

    return {
      columns,
      totalSize,
      virtualRows,
    };
  }, [gridRect.top, gridRect.width, items, selectionMode, viewport.height, viewport.scrollY]);

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

function calculateVirtualGridTotalSize(rowCount: number, columns: number, selectionMode: boolean) {
  if (rowCount === 0) {
    return 0;
  }
  if (columns > 1) {
    return rowCount * DESKTOP_GRID_ROW_HEIGHT + (rowCount - 1) * DESKTOP_GRID_GAP;
  }
  if (selectionMode) {
    return rowCount * MOBILE_COMPACT_ROW_HEIGHT + (rowCount - 1) * MOBILE_GRID_GAP;
  }
  return MOBILE_FEATURED_ROW_HEIGHT
    + Math.max(0, rowCount - 1) * MOBILE_COMPACT_ROW_HEIGHT
    + (rowCount - 1) * MOBILE_GRID_GAP;
}

function calculateVirtualRowStart(rowIndex: number, columns: number, selectionMode: boolean) {
  if (columns > 1) {
    return rowIndex * (DESKTOP_GRID_ROW_HEIGHT + DESKTOP_GRID_GAP);
  }
  if (selectionMode || rowIndex === 0) {
    return rowIndex === 0 ? 0 : rowIndex * (MOBILE_COMPACT_ROW_HEIGHT + MOBILE_GRID_GAP);
  }
  return MOBILE_FEATURED_ROW_HEIGHT + MOBILE_GRID_GAP + (rowIndex - 1) * (MOBILE_COMPACT_ROW_HEIGHT + MOBILE_GRID_GAP);
}

function calculateVirtualRowHeight(rowIndex: number, columns: number, selectionMode: boolean) {
  if (columns > 1) {
    return DESKTOP_GRID_ROW_HEIGHT;
  }
  if (selectionMode || rowIndex > 0) {
    return MOBILE_COMPACT_ROW_HEIGHT;
  }
  return MOBILE_FEATURED_ROW_HEIGHT;
}

function findVirtualRowIndex(offset: number, rowCount: number, columns: number, selectionMode: boolean) {
  if (rowCount === 0) {
    return 0;
  }
  if (columns > 1) {
    return Math.min(rowCount - 1, Math.floor(offset / (DESKTOP_GRID_ROW_HEIGHT + DESKTOP_GRID_GAP)));
  }
  if (selectionMode) {
    return Math.min(rowCount - 1, Math.floor(offset / (MOBILE_COMPACT_ROW_HEIGHT + MOBILE_GRID_GAP)));
  }
  if (offset <= MOBILE_FEATURED_ROW_HEIGHT + MOBILE_GRID_GAP) {
    return 0;
  }
  return Math.min(
    rowCount - 1,
    1 + Math.floor((offset - MOBILE_FEATURED_ROW_HEIGHT - MOBILE_GRID_GAP) / (MOBILE_COMPACT_ROW_HEIGHT + MOBILE_GRID_GAP)),
  );
}

const HomeBookmarkCard = memo(function HomeBookmarkCard({
  bookmark,
  onOpen,
  onContextMenu,
  onOpenContextMenuAt,
  isContextOpen,
  selectionMode,
  isSelected,
  onToggleSelect,
  mobileVariant,
  priority,
}: {
  bookmark: Bookmark;
  onOpen: (bookmarkId: string) => void;
  onContextMenu: (bookmark: Bookmark, event: ReactMouseEvent<HTMLElement>) => void;
  onOpenContextMenuAt: (bookmark: Bookmark, x: number, y: number) => void;
  isContextOpen: boolean;
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: (bookmarkId: string) => void;
  mobileVariant: "featured" | "compact";
  priority: boolean;
}) {
  const [coverImageFailed, setCoverImageFailed] = useState(false);
  const { siteIconSrc, handleSiteIconError } = useBookmarkSiteIcon(bookmark, 192);

  useEffect(() => {
    setCoverImageFailed(false);
  }, [bookmark.id, bookmark.coverImageUrl]);

  const summary = summarizeBookmark(bookmark);
  const hasCoverImage = Boolean(bookmark.coverImageUrl) && !coverImageFailed;
  const folderLabel = bookmark.folder?.name ?? "未归类";
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
    mobileVariant === "featured" ? "is-mobile-featured" : "is-mobile-compact",
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
      <button
        className="home-bookmark-hitarea"
        type="button"
        onContextMenuCapture={(event) => onContextMenu(bookmark, event)}
        onClick={() => selectionMode ? onToggleSelect(bookmark.id) : onOpen(bookmark.id)}
        aria-label={selectionMode ? `选择书签：${bookmark.title}` : `打开归档：${bookmark.title}`}
      >
        <div
          className={`home-bookmark-cover is-${coverTone}${hasCoverImage ? " has-image" : " has-summary-preview"}`}
          aria-hidden="true"
        >
          {hasCoverImage ? (
            <>
              <img
                className="home-bookmark-cover-media"
                src={coverImageSrc}
                srcSet={buildCoverImageSrcSet(coverImageVariants)}
                sizes="(max-width: 720px) 96px, (max-width: 1180px) 50vw, 400px"
                alt=""
                loading={priority ? "eager" : "lazy"}
                decoding="async"
                fetchPriority={priority ? "high" : "low"}
                onError={() => setCoverImageFailed(true)}
              />
              <div className="home-bookmark-cover-shade" aria-hidden="true" />
            </>
          ) : (
            <div className="home-bookmark-paper" aria-hidden="true">
              <div className="home-bookmark-paper-eyebrow">
                <span>{bookmark.domain}</span>
                <strong>
                  {siteIconSrc ? (
                  <img
                    className="home-bookmark-paper-icon"
                    src={siteIconSrc ?? undefined}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={handleSiteIconError}
                  />
                  ) : coverInitial}
                </strong>
              </div>
              <div className="home-bookmark-paper-title">
                <span>{bookmark.title}</span>
              </div>
              <div className="home-bookmark-paper-lines">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
          {hasCoverImage ? (
            <div className="home-bookmark-cover-overlay">
              <div className="home-bookmark-cover-overlay-meta">
                <span className="home-bookmark-overlay-badge">{folderLabel}</span>
                <span className="home-bookmark-overlay-time">{formatRelativeWhen(bookmark.updatedAt)}</span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="home-bookmark-body">
          <div className="home-bookmark-title-row">
            <h2>{bookmark.title}</h2>
            {bookmark.isFavorite ? (
              <Icon className="home-bookmark-favorite" name="star" />
            ) : null}
          </div>
          <p>{summary}</p>
          <footer className="home-bookmark-meta">
            <span className="home-bookmark-domain">{bookmark.domain}</span>
            <span className="home-bookmark-time">{formatRelativeWhen(bookmark.updatedAt)}</span>
          </footer>
        </div>
      </button>
    </article>
  );
});

function HomeBookmarkSkeleton() {
  return (
    <article className="home-bookmark-card home-bookmark-card-skeleton">
      <div className="home-bookmark-hitarea is-skeleton">
        <div className="home-skeleton-cover" />
        <div className="home-bookmark-body">
          <span className="home-skeleton-line is-title" />
          <span className="home-skeleton-line" />
          <span className="home-skeleton-line is-short" />
          <footer className="home-bookmark-meta">
            <span className="home-skeleton-line is-meta" />
            <span className="home-skeleton-line is-meta-short" />
          </footer>
        </div>
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
  const { gridRef, metrics } = useVirtualBookmarkGrid(visibleItems, selectionMode);
  const mobileFeaturedBookmarkId = !selectionMode ? items[0]?.id ?? null : null;
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
                    onContextMenu={onBookmarkContextMenu}
                    onOpenContextMenuAt={onOpenBookmarkContextMenuAt}
                    isContextOpen={contextMenuBookmarkId === bookmark.id}
                    selectionMode={selectionMode}
                    isSelected={selectedIds.has(bookmark.id)}
                    onToggleSelect={onToggleSelect}
                    mobileVariant={bookmark.id === mobileFeaturedBookmarkId ? "featured" : "compact"}
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
