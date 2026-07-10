package repository

import (
	"context"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

type MemoryRepository struct {
	mu        sync.RWMutex
	bookmarks map[string][]domain.Bookmark
	users     map[string]domain.AuthUser
}

func NewMemoryRepository() *MemoryRepository {
	now := time.Now().UTC()
	return &MemoryRepository{
		bookmarks: map[string][]domain.Bookmark{},
		users: map[string]domain.AuthUser{
			"dev-user": {
				ID:        "dev-user",
				Email:     "dev@keeppage.local",
				CreatedAt: now,
			},
		},
	}
}

func (r *MemoryRepository) Kind() string {
	return "memory"
}

func (r *MemoryRepository) Close() {}

func (r *MemoryRepository) GetUserByID(_ context.Context, userID string) (domain.AuthUser, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	user, ok := r.users[userID]
	if !ok {
		return domain.AuthUser{}, ErrNotFound
	}
	return user, nil
}

func (r *MemoryRepository) GetAPIAuthRecord(context.Context, string) (auth.APIAuthRecord, error) {
	return auth.APIAuthRecord{}, ErrNotFound
}

func (r *MemoryRepository) GetDeviceAuthRecord(context.Context, string) (auth.DeviceAuthRecord, error) {
	return auth.DeviceAuthRecord{}, ErrNotFound
}

func (r *MemoryRepository) TouchAPIToken(context.Context, string, time.Time) error {
	return nil
}

func (r *MemoryRepository) TouchDevice(context.Context, string, time.Time) error {
	return nil
}

func (r *MemoryRepository) SearchBookmarks(_ context.Context, userID string, query domain.BookmarkSearchQuery) (domain.BookmarkSearchResponse, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := append([]domain.Bookmark(nil), r.bookmarks[userID]...)
	filtered := make([]domain.Bookmark, 0, len(items))
	for _, item := range items {
		if query.Domain != "" && item.Domain != query.Domain {
			continue
		}
		if query.View == "favorites" && !item.IsFavorite {
			continue
		}
		if query.Q != "" && !bookmarkMatches(item, query.Q) {
			continue
		}
		filtered = append(filtered, item)
	}
	sort.SliceStable(filtered, func(i, j int) bool {
		return filtered[i].UpdatedAt.After(filtered[j].UpdatedAt)
	})
	total := len(filtered)
	start := min(query.Offset, total)
	end := min(start+query.Limit, total)
	return domain.BookmarkSearchResponse{
		Items: filtered[start:end],
		Total: total,
	}, nil
}

func (r *MemoryRepository) IngestBookmark(_ context.Context, userID string, input domain.IngestBookmarkRequest) (domain.IngestBookmarkResult, error) {
	normalizedURL, err := normalizeSourceURL(input.URL)
	if err != nil {
		return domain.IngestBookmarkResult{}, err
	}
	parsed, err := url.Parse(normalizedURL)
	if err != nil {
		return domain.IngestBookmarkResult{}, err
	}
	hash := hashNormalizedURL(normalizedURL)
	now := time.Now().UTC()

	r.mu.Lock()
	defer r.mu.Unlock()
	items := r.bookmarks[userID]
	for i, item := range items {
		if hashNormalizedURL(item.SourceURL) != hash {
			continue
		}
		if input.DedupeStrategy == "skip" {
			return domain.IngestBookmarkResult{Bookmark: item, Status: "skipped", Deduplicated: true}, nil
		}
		if strings.TrimSpace(input.Title) != "" {
			item.Title = strings.TrimSpace(input.Title)
		}
		if input.Note != nil {
			item.Note = *input.Note
		}
		item.UpdatedAt = now
		items[i] = item
		r.bookmarks[userID] = items
		return domain.IngestBookmarkResult{Bookmark: item, Status: "merged", Deduplicated: true}, nil
	}

	bookmark := domain.Bookmark{
		ID:           pseudoID(hash),
		SourceURL:    normalizedURL,
		Title:        resolveTitle(input.Title, normalizedURL),
		Domain:       parsed.Hostname(),
		Note:         derefString(input.Note),
		IsFavorite:   false,
		Tags:         []domain.Tag{},
		VersionCount: 0,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	r.bookmarks[userID] = append(items, bookmark)
	return domain.IngestBookmarkResult{Bookmark: bookmark, Status: "created", Deduplicated: false}, nil
}

func bookmarkMatches(bookmark domain.Bookmark, query string) bool {
	needle := strings.ToLower(strings.TrimSpace(query))
	return strings.Contains(strings.ToLower(bookmark.Title), needle) ||
		strings.Contains(strings.ToLower(bookmark.SourceURL), needle) ||
		strings.Contains(strings.ToLower(bookmark.Domain), needle) ||
		strings.Contains(strings.ToLower(bookmark.Note), needle)
}

func resolveTitle(title string, fallbackURL string) string {
	if normalized := strings.TrimSpace(title); normalized != "" {
		return normalized
	}
	return fallbackURL
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func pseudoID(seed string) string {
	if len(seed) >= 32 {
		return seed[:8] + "-" + seed[8:12] + "-" + seed[12:16] + "-" + seed[16:20] + "-" + seed[20:32]
	}
	return seed
}
