package repository

import (
	"context"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

type BookmarkExtrasRepository interface {
	FindBookmarkByURL(ctx context.Context, userID, rawURL string) (*domain.Bookmark, error)
	GetBookmarkDetail(ctx context.Context, userID, bookmarkID string) (*domain.BookmarkDetailResponse, error)
	DeleteBookmark(ctx context.Context, userID, bookmarkID string) (bool, error)
	UpdateBookmarkMetadata(ctx context.Context, userID, bookmarkID string, input domain.BookmarkMetadataUpdateRequest) (*domain.Bookmark, error)
	RefreshBookmarkIcon(ctx context.Context, userID string, input domain.BookmarkIconRefreshRequest) (domain.BookmarkIconRefreshResponse, error)
	RefreshAllBookmarkIcons(ctx context.Context, userID string) (domain.BookmarkIconRefreshResponse, error)
}
