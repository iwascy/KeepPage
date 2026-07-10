package repository

import (
	"context"
	"errors"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

var ErrNotFound = errors.New("repository record not found")

type Repository interface {
	auth.UserLookup
	Kind() string
	Close()
	SearchBookmarks(ctx context.Context, userID string, query domain.BookmarkSearchQuery) (domain.BookmarkSearchResponse, error)
	IngestBookmark(ctx context.Context, userID string, input domain.IngestBookmarkRequest) (domain.IngestBookmarkResult, error)
}

type UserRecord struct {
	ID        string
	Email     string
	Name      *string
	CreatedAt time.Time
}
