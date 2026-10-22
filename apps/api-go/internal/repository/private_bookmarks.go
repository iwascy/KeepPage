package repository

import (
	"context"
	"strings"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
)

// PrivateTaxonomyRepository manages the private folders and tags, which are
// fully independent of the public taxonomy.
type PrivateTaxonomyRepository interface {
	ListPrivateFolders(ctx context.Context, userID string) ([]domain.Folder, error)
	CreatePrivateFolder(ctx context.Context, userID string, input domain.FolderCreateRequest) (domain.Folder, error)
	UpdatePrivateFolder(ctx context.Context, userID string, folderID string, input domain.FolderUpdateRequest) (*domain.Folder, error)
	DeletePrivateFolder(ctx context.Context, userID string, folderID string) (bool, error)
	ListPrivateTags(ctx context.Context, userID string) ([]domain.Tag, error)
	CreatePrivateTag(ctx context.Context, userID string, input domain.TagCreateRequest) (domain.Tag, error)
	UpdatePrivateTag(ctx context.Context, userID string, tagID string, input domain.TagUpdateRequest) (*domain.Tag, error)
	DeletePrivateTag(ctx context.Context, userID string, tagID string) (bool, error)
}

type PrivateBookmarkRepository interface {
	PrivateTaxonomyRepository
	SearchPrivateBookmarks(ctx context.Context, userID string, query domain.BookmarkSearchQuery) (domain.BookmarkSearchResponse, error)
	GetPrivateBookmarkDetail(ctx context.Context, userID, bookmarkID string) (*domain.BookmarkDetailResponse, error)
	GetPrivateBookmarkSidebarStats(ctx context.Context, userID string) (domain.BookmarkSidebarStatsResponse, error)
	// UpdatePrivateBookmarkMetadata returns nil when the bookmark is not the user's.
	UpdatePrivateBookmarkMetadata(ctx context.Context, userID, bookmarkID string, input domain.BookmarkMetadataUpdateRequest) (*domain.Bookmark, error)
	DeletePrivateBookmark(ctx context.Context, userID, bookmarkID string) (bool, error)
}

func (r *MemoryRepository) SearchPrivateBookmarks(_ context.Context, userID string, query domain.BookmarkSearchQuery) (domain.BookmarkSearchResponse, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	state := r.captureState()
	items := []domain.Bookmark{}
	for _, version := range state.privateVersions {
		if version.userID != userID {
			continue
		}
		bookmark, ok := state.privateBookmarks[version.bookmarkID]
		if ok && query.FolderID != "" && (bookmark.Folder == nil || !memoryFolderSubtreeContainsIn(state.privateFolders[userID], query.FolderID, bookmark.Folder.ID)) {
			continue
		}
		if ok && query.TagID != "" && !bookmarkHasTag(bookmark, query.TagID) {
			continue
		}
		if !ok || (query.Q != "" && !bookmarkMatches(bookmark, query.Q) && !strings.Contains(strings.ToLower(r.memoryBookmarkText(userID, bookmark, true)), strings.ToLower(strings.TrimSpace(query.Q)))) || (query.Domain != "" && bookmark.Domain != query.Domain) || (query.View == "favorites" && !bookmark.IsFavorite) {
			continue
		}
		if query.View == "recent" && bookmark.UpdatedAt.Before(time.Now().Add(-7*24*time.Hour)) {
			continue
		}
		if query.Quality != "" && (bookmark.LatestQuality == nil || bookmark.LatestQuality.Grade != query.Quality) {
			continue
		}
		bookmark.SearchSnippet = bookmarkSearchSnippet(bookmark, query.Q, r.memoryBookmarkText(userID, bookmark, true))
		found := false
		for _, existing := range items {
			if existing.ID == bookmark.ID {
				found = true
				break
			}
		}
		if !found {
			items = append(items, bookmark)
		}
	}
	sortBookmarks(items, query)
	total := len(items)
	start := min(query.Offset, total)
	end := min(start+query.Limit, total)
	return domain.BookmarkSearchResponse{Items: items[start:end], Total: total}, nil
}

func (r *MemoryRepository) GetPrivateBookmarkDetail(_ context.Context, userID, bookmarkID string) (*domain.BookmarkDetailResponse, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	state := r.captureState()
	bookmark, ok := state.privateBookmarks[bookmarkID]
	if !ok || !versionBelongsToMemoryUser(r, state, userID, bookmarkID, true) {
		return nil, nil
	}
	versions := []domain.BookmarkVersion{}
	for _, version := range state.privateVersions {
		if version.userID == userID && version.bookmarkID == bookmarkID {
			versions = append(versions, domain.BookmarkVersion{ID: version.versionID, BookmarkID: bookmarkID, VersionNo: len(versions) + 1, HTMLObjectKey: version.objectKey, HTMLSHA256: version.hash, MediaFiles: append([]domain.CaptureMediaFile(nil), version.mediaFiles...), CaptureProfile: "standard", Quality: version.quality, CreatedAt: bookmark.UpdatedAt})
		}
	}
	if len(versions) == 0 {
		return nil, nil
	}
	return &domain.BookmarkDetailResponse{Bookmark: bookmark, Versions: versions}, nil
}

func (r *MemoryRepository) GetPrivateBookmarkSidebarStats(_ context.Context, userID string) (domain.BookmarkSidebarStatsResponse, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return memorySidebarStats(r.privateMemoryTaxonomy(), userID), nil
}

func (r *MemoryRepository) UpdatePrivateBookmarkMetadata(_ context.Context, userID, bookmarkID string, input domain.BookmarkMetadataUpdateRequest) (*domain.Bookmark, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	state := r.captureState()
	bookmark, ok := state.privateBookmarks[bookmarkID]
	if !ok || !versionBelongsToMemoryUser(r, state, userID, bookmarkID, true) {
		return nil, nil
	}
	bookmark.Tags = append([]domain.Tag(nil), bookmark.Tags...)
	if err := applyMemoryBookmarkMetadata(r.privateMemoryTaxonomy(), userID, &bookmark, input); err != nil {
		return nil, err
	}
	if bookmark.Tags == nil {
		bookmark.Tags = []domain.Tag{}
	}
	state.privateBookmarks[bookmarkID] = bookmark
	return &bookmark, nil
}

func (r *MemoryRepository) DeletePrivateBookmark(_ context.Context, userID, bookmarkID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	state := r.captureState()
	if _, ok := state.privateBookmarks[bookmarkID]; !ok || !versionBelongsToMemoryUser(r, state, userID, bookmarkID, true) {
		return false, nil
	}
	for key, version := range state.privateVersions {
		if version.bookmarkID == bookmarkID && version.userID == userID {
			delete(state.privateVersions, key)
		}
	}
	delete(state.privateBookmarks, bookmarkID)
	return true, nil
}

func (r *MemoryRepository) ListPrivateFolders(_ context.Context, userID string) ([]domain.Folder, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return listMemoryFolders(r.privateMemoryTaxonomy(), userID), nil
}

func (r *MemoryRepository) CreatePrivateFolder(_ context.Context, userID string, input domain.FolderCreateRequest) (domain.Folder, error) {
	return r.createMemoryFolder(r.privateMemoryTaxonomy(), userID, input)
}

func (r *MemoryRepository) UpdatePrivateFolder(_ context.Context, userID string, folderID string, input domain.FolderUpdateRequest) (*domain.Folder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return updateMemoryFolder(r.privateMemoryTaxonomy(), userID, folderID, input)
}

func (r *MemoryRepository) DeletePrivateFolder(_ context.Context, userID string, folderID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return deleteMemoryFolder(r.privateMemoryTaxonomy(), userID, folderID)
}

func (r *MemoryRepository) ListPrivateTags(_ context.Context, userID string) ([]domain.Tag, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return listMemoryTags(r.privateMemoryTaxonomy(), userID), nil
}

func (r *MemoryRepository) CreatePrivateTag(_ context.Context, userID string, input domain.TagCreateRequest) (domain.Tag, error) {
	return r.createMemoryTag(r.privateMemoryTaxonomy(), userID, input)
}

func (r *MemoryRepository) UpdatePrivateTag(_ context.Context, userID string, tagID string, input domain.TagUpdateRequest) (*domain.Tag, error) {
	if !input.Name.Present && !input.Color.Present {
		return nil, httperror.BadRequest("ValidationError", "At least one field must be updated.", nil)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return updateMemoryTag(r.privateMemoryTaxonomy(), userID, tagID, input)
}

func (r *MemoryRepository) DeletePrivateTag(_ context.Context, userID string, tagID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return deleteMemoryTag(r.privateMemoryTaxonomy(), userID, tagID), nil
}

func (r *PostgresRepository) SearchPrivateBookmarks(ctx context.Context, userID string, query domain.BookmarkSearchQuery) (domain.BookmarkSearchResponse, error) {
	return r.searchTaxonomyBookmarks(ctx, privateTaxonomy, userID, query)
}

func (r *PostgresRepository) GetPrivateBookmarkDetail(ctx context.Context, userID, bookmarkID string) (*domain.BookmarkDetailResponse, error) {
	return r.getTaxonomyBookmarkDetail(ctx, privateTaxonomy, userID, bookmarkID)
}

func (r *PostgresRepository) GetPrivateBookmarkSidebarStats(ctx context.Context, userID string) (domain.BookmarkSidebarStatsResponse, error) {
	return r.taxonomySidebarStats(ctx, privateTaxonomy, userID)
}

func (r *PostgresRepository) UpdatePrivateBookmarkMetadata(ctx context.Context, userID, bookmarkID string, input domain.BookmarkMetadataUpdateRequest) (*domain.Bookmark, error) {
	return r.updateTaxonomyBookmarkMetadata(ctx, privateTaxonomy, userID, bookmarkID, input)
}

func (r *PostgresRepository) DeletePrivateBookmark(ctx context.Context, userID, bookmarkID string) (bool, error) {
	return r.deleteTaxonomyBookmark(ctx, privateTaxonomy, userID, bookmarkID)
}

func (r *PostgresRepository) ListPrivateFolders(ctx context.Context, userID string) ([]domain.Folder, error) {
	return r.listTaxonomyFolders(ctx, privateTaxonomy, userID)
}

func (r *PostgresRepository) CreatePrivateFolder(ctx context.Context, userID string, input domain.FolderCreateRequest) (domain.Folder, error) {
	return r.createTaxonomyFolder(ctx, privateTaxonomy, userID, input)
}

func (r *PostgresRepository) UpdatePrivateFolder(ctx context.Context, userID string, folderID string, input domain.FolderUpdateRequest) (*domain.Folder, error) {
	return r.updateTaxonomyFolder(ctx, privateTaxonomy, userID, folderID, input)
}

func (r *PostgresRepository) DeletePrivateFolder(ctx context.Context, userID string, folderID string) (bool, error) {
	return r.deleteTaxonomyFolder(ctx, privateTaxonomy, userID, folderID)
}

func (r *PostgresRepository) ListPrivateTags(ctx context.Context, userID string) ([]domain.Tag, error) {
	return r.listTaxonomyTags(ctx, privateTaxonomy, userID)
}

func (r *PostgresRepository) CreatePrivateTag(ctx context.Context, userID string, input domain.TagCreateRequest) (domain.Tag, error) {
	return r.createTaxonomyTag(ctx, privateTaxonomy, userID, input)
}

func (r *PostgresRepository) UpdatePrivateTag(ctx context.Context, userID string, tagID string, input domain.TagUpdateRequest) (*domain.Tag, error) {
	return r.updateTaxonomyTag(ctx, privateTaxonomy, userID, tagID, input)
}

func (r *PostgresRepository) DeletePrivateTag(ctx context.Context, userID string, tagID string) (bool, error) {
	return r.deleteTaxonomyTag(ctx, privateTaxonomy, userID, tagID)
}
