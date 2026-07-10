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
	users     map[string]auth.UserAuthRecord
	emailIDs  map[string]string
	apiTokens map[string]memoryAPIToken
	folders   map[string]map[string]domain.Folder
	tags      map[string]map[string]domain.Tag
}

type memoryAPIToken struct {
	userID    string
	tokenHash string
	item      domain.APIToken
}

func NewMemoryRepository() *MemoryRepository {
	now := time.Now().UTC()
	return &MemoryRepository{
		bookmarks: map[string][]domain.Bookmark{},
		users: map[string]auth.UserAuthRecord{
			"dev-user": {
				User: domain.AuthUser{
					ID:        "dev-user",
					Email:     "dev@keeppage.local",
					CreatedAt: now,
				},
			},
		},
		emailIDs:  map[string]string{"dev@keeppage.local": "dev-user"},
		apiTokens: map[string]memoryAPIToken{},
		folders:   map[string]map[string]domain.Folder{},
		tags:      map[string]map[string]domain.Tag{},
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
	return user.User, nil
}

func (r *MemoryRepository) FindUserByEmail(_ context.Context, email string) (*auth.UserAuthRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	id, ok := r.emailIDs[email]
	if !ok {
		return nil, nil
	}
	record := r.users[id]
	return &record, nil
}

func (r *MemoryRepository) CreateUser(_ context.Context, email string, name *string, passwordHash string) (domain.AuthUser, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.emailIDs[email]; exists {
		return domain.AuthUser{}, auth.ErrEmailExists
	}
	user := domain.AuthUser{ID: auth.NewUUID(), Email: email, Name: name, CreatedAt: time.Now().UTC()}
	r.users[user.ID] = auth.UserAuthRecord{User: user, PasswordHash: passwordHash}
	r.emailIDs[email] = user.ID
	return user, nil
}

func (r *MemoryRepository) GetAPIAuthRecord(_ context.Context, tokenID string) (auth.APIAuthRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	token, ok := r.apiTokens[tokenID]
	if !ok {
		return auth.APIAuthRecord{}, ErrNotFound
	}
	return auth.APIAuthRecord{
		ID: token.item.ID, UserID: token.userID, TokenHash: token.tokenHash, Scopes: append([]string(nil), token.item.Scopes...), ExpiresAt: token.item.ExpiresAt, RevokedAt: token.item.RevokedAt,
	}, nil
}

func (r *MemoryRepository) GetDeviceAuthRecord(_ context.Context, deviceID string) (auth.DeviceAuthRecord, error) {
	return r.MemoryDeviceAuthRecord(deviceID)
}

func (r *MemoryRepository) TouchAPIToken(_ context.Context, tokenID string, usedAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	token, ok := r.apiTokens[tokenID]
	if ok {
		token.item.LastUsedAt = &usedAt
		r.apiTokens[tokenID] = token
	}
	return nil
}

func (r *MemoryRepository) CreateAPIToken(_ context.Context, userID string, id string, name string, tokenPreview string, tokenHash string, scopes []string, expiresAt *time.Time) (domain.APIToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	item := domain.APIToken{ID: id, Name: name, TokenPreview: tokenPreview, Scopes: append([]string(nil), scopes...), ExpiresAt: expiresAt, CreatedAt: now}
	r.apiTokens[id] = memoryAPIToken{userID: userID, tokenHash: tokenHash, item: item}
	return item, nil
}

func (r *MemoryRepository) ListAPITokens(_ context.Context, userID string) ([]domain.APIToken, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := []domain.APIToken{}
	for _, token := range r.apiTokens {
		if token.userID == userID {
			items = append(items, token.item)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	return items, nil
}

func (r *MemoryRepository) RevokeAPIToken(_ context.Context, userID string, tokenID string, revokedAt time.Time) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	token, ok := r.apiTokens[tokenID]
	if !ok || token.userID != userID {
		return false, nil
	}
	if token.item.RevokedAt == nil {
		token.item.RevokedAt = &revokedAt
		r.apiTokens[tokenID] = token
	}
	return true, nil
}

func (r *MemoryRepository) TouchDevice(_ context.Context, deviceID string, usedAt time.Time) error {
	return r.TouchMemoryDevice(deviceID, usedAt)
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
		if query.View == "recent" && item.UpdatedAt.Before(time.Now().Add(-7*24*time.Hour)) {
			continue
		}
		if query.FolderID != "" {
			if item.Folder == nil || !r.memoryFolderSubtreeContains(userID, query.FolderID, item.Folder.ID) {
				continue
			}
		}
		if query.TagID != "" && !bookmarkHasTag(item, query.TagID) {
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
		if input.FolderPath != "" {
			item.Folder = r.ensureMemoryFolderPath(userID, input.FolderPath)
		}
		item.Tags = mergeTags(item.Tags, r.ensureMemoryTags(userID, input.Tags))
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
		Tags:         r.ensureMemoryTags(userID, input.Tags),
		VersionCount: 0,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if input.FolderPath != "" {
		bookmark.Folder = r.ensureMemoryFolderPath(userID, input.FolderPath)
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
