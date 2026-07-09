import { memo, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { Bookmark } from "@keeppage/domain";
import {
  brandCoverTone,
  domainMonogram,
  formatDisplayDomain,
  isUsableCoverImageUrl,
} from "../../../lib/brand-cover";
import { formatCompactRelativeWhen } from "../../../lib/date-format";
import { Icon } from "../../../components/Icon";
import { useBookmarkSiteIcon } from "../shared/site-icon";

export const BrandBookmarkCard = memo(function BrandBookmarkCard({
  bookmark,
  onToggleFavorite,
  onContextMenu,
  onOpenContextMenuAt,
  onOpenArchive,
  isContextOpen,
  selectionMode,
  isSelected,
  onToggleSelect,
}: {
  bookmark: Bookmark;
  onToggleFavorite: (bookmark: Bookmark) => void;
  onContextMenu: (bookmark: Bookmark, event: ReactMouseEvent<HTMLElement>) => void;
  onOpenContextMenuAt: (bookmark: Bookmark, x: number, y: number) => void;
  onOpenArchive: (bookmark: Bookmark) => void;
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
  } = useBookmarkSiteIcon(bookmark, 128);

  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    setCoverFailed(false);
  }, [bookmark.id, bookmark.coverImageUrl]);

  const coverUrl = isUsableCoverImageUrl(bookmark.coverImageUrl) && !coverFailed
    ? bookmark.coverImageUrl
    : null;
  const tone = brandCoverTone(bookmark.domain);
  const monogram = domainMonogram(bookmark.domain);
  const domain = formatDisplayDomain(bookmark.domain);
  const folderName = bookmark.folder?.name?.trim() || "";
  const excerpt = bookmark.note.trim();
  const hasArchive = Boolean(bookmark.latestVersionId || bookmark.versionCount > 0);

  const cardClasses = [
    "brand-bookmark-card",
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

      <div className="brand-bookmark-cover" aria-hidden="true">
        {coverUrl ? (
          <img
            className="brand-bookmark-cover-image"
            src={coverUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <div
            className={[
              "brand-bookmark-tile",
              `is-${tone}`,
              useDefaultSiteIcon || !siteIconSrc ? "is-fallback" : "",
            ].filter(Boolean).join(" ")}
          >
            {siteIconSrc ? (
              <img
                className="brand-bookmark-tile-icon"
                src={siteIconSrc}
                alt=""
                loading="lazy"
                decoding="async"
                onError={handleSiteIconError}
                onLoad={(event) => handleSiteIconLoad(event.currentTarget)}
              />
            ) : (
              <span className="brand-bookmark-monogram">{monogram}</span>
            )}
          </div>
        )}
        {folderName ? <span className="brand-bookmark-folder">{folderName}</span> : null}
      </div>

      <div className="brand-bookmark-body">
        <div className="brand-bookmark-meta">
          <span className="brand-bookmark-domain">{domain}</span>
          <span className="brand-bookmark-dot" aria-hidden="true">·</span>
          <span className="brand-bookmark-time">{formatCompactRelativeWhen(bookmark.updatedAt)}</span>
        </div>
        <h2 className="brand-bookmark-title">{bookmark.title}</h2>
        {excerpt ? <p className="brand-bookmark-excerpt">{excerpt}</p> : null}

        {!selectionMode ? (
          <footer className="brand-bookmark-actions">
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
            {hasArchive ? (
              <button
                className="home-bookmark-iconbtn"
                type="button"
                aria-label={`查看存档：${bookmark.title}`}
                title="查看存档"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenArchive(bookmark);
                }}
              >
                <Icon name="book_open" />
              </button>
            ) : null}
            <button
              className="home-bookmark-iconbtn"
              type="button"
              aria-label={`打开菜单：${bookmark.title}`}
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

export function BrandBookmarkSkeleton() {
  return (
    <article className="brand-bookmark-card brand-bookmark-card-skeleton">
      <div className="brand-skeleton-cover" />
      <div className="brand-bookmark-body">
        <span className="home-skeleton-line is-meta" />
        <span className="home-skeleton-line is-title" />
        <span className="home-skeleton-line is-short" />
      </div>
    </article>
  );
}
