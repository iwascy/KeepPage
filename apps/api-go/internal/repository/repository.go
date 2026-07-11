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
	auth.CredentialsStore
	Kind() string
	Close()
	ListUsersForBackup(ctx context.Context) ([]domain.AuthUser, error)
	HitRateLimit(ctx context.Context, scope string, key string, maxHits int, window time.Duration) (bool, int, error)
	SearchBookmarks(ctx context.Context, userID string, query domain.BookmarkSearchQuery) (domain.BookmarkSearchResponse, error)
	IngestBookmark(ctx context.Context, userID string, input domain.IngestBookmarkRequest) (domain.IngestBookmarkResult, error)
	CreateAPIToken(ctx context.Context, userID string, id string, name string, tokenPreview string, tokenHash string, scopes []string, expiresAt *time.Time) (domain.APIToken, error)
	ListAPITokens(ctx context.Context, userID string) ([]domain.APIToken, error)
	RevokeAPIToken(ctx context.Context, userID string, tokenID string, revokedAt time.Time) (bool, error)
}

type TaxonomyRepository interface {
	ListFolders(ctx context.Context, userID string) ([]domain.Folder, error)
	CreateFolder(ctx context.Context, userID string, input domain.FolderCreateRequest) (domain.Folder, error)
	UpdateFolder(ctx context.Context, userID string, folderID string, input domain.FolderUpdateRequest) (*domain.Folder, error)
	DeleteFolder(ctx context.Context, userID string, folderID string) (bool, error)
	ListTags(ctx context.Context, userID string) ([]domain.Tag, error)
	CreateTag(ctx context.Context, userID string, input domain.TagCreateRequest) (domain.Tag, error)
	UpdateTag(ctx context.Context, userID string, tagID string, input domain.TagUpdateRequest) (*domain.Tag, error)
	DeleteTag(ctx context.Context, userID string, tagID string) (bool, error)
	GetBookmarkSidebarStats(ctx context.Context, userID string) (domain.BookmarkSidebarStatsResponse, error)
}

type UserRecord struct {
	ID        string
	Email     string
	Name      *string
	CreatedAt time.Time
}
