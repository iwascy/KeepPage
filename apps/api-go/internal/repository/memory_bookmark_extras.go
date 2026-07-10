package repository

import (
	"context"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

func (r *MemoryRepository) FindBookmarkByURL(_ context.Context, userID, rawURL string) (*domain.Bookmark, error) {
	normalized, err := normalizeSourceURL(rawURL)
	if err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, item := range r.bookmarks[userID] {
		if item.SourceURL == normalized {
			copy := item
			return &copy, nil
		}
	}
	return nil, nil
}

func (r *MemoryRepository) GetBookmarkDetail(_ context.Context, userID, bookmarkID string) (*domain.BookmarkDetailResponse, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, item := range r.bookmarks[userID] {
		if item.ID == bookmarkID {
			versions := []domain.BookmarkVersion{}
			state := r.captureState()
			for _, capture := range state.versions {
				if capture.userID == userID && capture.bookmarkID == bookmarkID {
					versions = append(versions, domain.BookmarkVersion{ID: capture.versionID, BookmarkID: bookmarkID, VersionNo: len(versions) + 1, HTMLObjectKey: capture.objectKey, HTMLSHA256: capture.hash, MediaFiles: append([]domain.CaptureMediaFile(nil), capture.mediaFiles...), CaptureProfile: "standard", CreatedAt: item.UpdatedAt})
				}
			}
			sort.Slice(versions, func(i, j int) bool { return versions[i].VersionNo > versions[j].VersionNo })
			return &domain.BookmarkDetailResponse{Bookmark: item, Versions: versions}, nil
		}
	}
	return nil, nil
}

func (r *MemoryRepository) DeleteBookmark(_ context.Context, userID, bookmarkID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := r.bookmarks[userID]
	for i, item := range items {
		if item.ID == bookmarkID {
			r.bookmarks[userID] = append(items[:i], items[i+1:]...)
			return true, nil
		}
	}
	return false, nil
}

func (r *MemoryRepository) UpdateBookmarkMetadata(_ context.Context, userID, bookmarkID string, input domain.BookmarkMetadataUpdateRequest) (*domain.Bookmark, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := r.bookmarks[userID]
	for i := range items {
		item := &items[i]
		if item.ID != bookmarkID {
			continue
		}
		if input.Note.Present {
			item.Note = derefString(input.Note.Value)
		}
		if input.IsFavorite != nil {
			item.IsFavorite = *input.IsFavorite
		}
		if input.FolderPath.Present {
			item.Folder = r.ensureMemoryFolderPath(userID, derefString(input.FolderPath.Value))
		} else if input.FolderID.Present {
			if input.FolderID.Value == nil {
				item.Folder = nil
			} else if f, ok := r.folders[userID][*input.FolderID.Value]; ok {
				copy := f
				item.Folder = &copy
			}
		}
		if input.Tags != nil {
			item.Tags = r.ensureMemoryTags(userID, *input.Tags)
		} else if input.TagIDs != nil {
			item.Tags = []domain.Tag{}
			for _, id := range *input.TagIDs {
				if tag, ok := r.tags[userID][id]; ok {
					item.Tags = append(item.Tags, tag)
				}
			}
		}
		item.UpdatedAt = time.Now().UTC()
		r.bookmarks[userID] = items
		copy := *item
		return &copy, nil
	}
	return nil, nil
}

func (r *MemoryRepository) RefreshBookmarkIcon(_ context.Context, userID string, input domain.BookmarkIconRefreshRequest) (domain.BookmarkIconRefreshResponse, error) {
	hostname, sourceURL := strings.TrimSpace(input.Domain), strings.TrimSpace(input.SourceURL)
	if input.BookmarkID != "" {
		for _, b := range r.bookmarks[userID] {
			if b.ID == input.BookmarkID {
				hostname, sourceURL = b.Domain, b.SourceURL
				break
			}
		}
	}
	if hostname == "" && sourceURL != "" {
		if u, err := url.Parse(sourceURL); err == nil {
			hostname = u.Hostname()
		}
	}
	if hostname == "" {
		return domain.BookmarkIconRefreshResponse{Skipped: 1, Icons: []domain.BookmarkIcon{}}, nil
	}
	iconURL := "https://" + hostname + "/favicon.ico"
	sourceType := "favicon-ico"
	if len(input.Candidates) > 0 && validHTTPURL(input.Candidates[0].URL) {
		iconURL = input.Candidates[0].URL
		sourceType = input.Candidates[0].Source
	}
	now := time.Now().UTC()
	icon := domain.BookmarkIcon{ID: pseudoID("icon:" + hostname), Hostname: hostname, IconURL: iconURL, SourceType: sourceType, RefreshedAt: now, CreatedAt: now, UpdatedAt: now}
	if sourceURL != "" {
		icon.SourceURL = &sourceURL
	}
	return domain.BookmarkIconRefreshResponse{Refreshed: 1, Icons: []domain.BookmarkIcon{icon}}, nil
}

func (r *MemoryRepository) RefreshAllBookmarkIcons(ctx context.Context, userID string) (domain.BookmarkIconRefreshResponse, error) {
	r.mu.RLock()
	domains := map[string]string{}
	for _, b := range r.bookmarks[userID] {
		domains[b.Domain] = b.SourceURL
	}
	r.mu.RUnlock()
	keys := make([]string, 0, len(domains))
	for k := range domains {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	result := domain.BookmarkIconRefreshResponse{Icons: []domain.BookmarkIcon{}}
	for _, host := range keys {
		one, err := r.RefreshBookmarkIcon(ctx, userID, domain.BookmarkIconRefreshRequest{Domain: host, SourceURL: domains[host]})
		if err != nil {
			return result, err
		}
		result.Refreshed += one.Refreshed
		result.Skipped += one.Skipped
		result.Icons = append(result.Icons, one.Icons...)
	}
	return result, nil
}

func validHTTPURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}
