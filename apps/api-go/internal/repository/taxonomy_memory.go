package repository

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
)

func (r *MemoryRepository) ListFolders(_ context.Context, userID string) ([]domain.Folder, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]domain.Folder, 0, len(r.folders[userID]))
	for _, folder := range r.folders[userID] {
		items = append(items, folder)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Path < items[j].Path })
	return items, nil
}

func (r *MemoryRepository) CreateFolder(_ context.Context, userID string, input domain.FolderCreateRequest) (domain.Folder, error) {
	name, err := validateFolderName(input.Name)
	if err != nil {
		return domain.Folder{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	folders := r.memoryFolders(userID)
	var parent *domain.Folder
	if input.ParentID != nil {
		value, ok := folders[*input.ParentID]
		if !ok {
			return domain.Folder{}, httperror.NotFound("FolderNotFound", "Parent folder not found.")
		}
		parent = &value
	}
	path := buildFolderPath(parent, name)
	for _, folder := range folders {
		if folder.Path == path {
			return domain.Folder{}, httperror.Conflict("FolderPathAlreadyExists", "Folder path already exists.")
		}
	}
	folder := domain.Folder{ID: auth.NewUUID(), Name: name, Path: path, ParentID: input.ParentID}
	folders[folder.ID] = folder
	return folder, nil
}

func (r *MemoryRepository) UpdateFolder(_ context.Context, userID string, folderID string, input domain.FolderUpdateRequest) (*domain.Folder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	folders := r.memoryFolders(userID)
	updated, affected, err := updateFolderTree(folders, folderID, input)
	if err != nil || updated == nil {
		return updated, err
	}
	r.syncMemoryBookmarkFolders(userID, folders, affected)
	return updated, nil
}

func (r *MemoryRepository) DeleteFolder(_ context.Context, userID string, folderID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	folders := r.memoryFolders(userID)
	deleted, affected, err := deleteFolderTree(folders, folderID)
	if err != nil || !deleted {
		return deleted, err
	}
	r.syncMemoryBookmarkFolders(userID, folders, affected)
	return true, nil
}

func (r *MemoryRepository) ListTags(_ context.Context, userID string) ([]domain.Tag, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]domain.Tag, 0, len(r.tags[userID]))
	for _, tag := range r.tags[userID] {
		items = append(items, tag)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	return items, nil
}

func (r *MemoryRepository) CreateTag(_ context.Context, userID string, input domain.TagCreateRequest) (domain.Tag, error) {
	name, err := validateTagName(input.Name)
	if err != nil {
		return domain.Tag{}, err
	}
	color, err := validateTagColor(input.Color)
	if err != nil {
		return domain.Tag{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	tags := r.memoryTags(userID)
	for _, tag := range tags {
		if tag.Name == name {
			return domain.Tag{}, httperror.Conflict("TagNameAlreadyExists", "Tag name already exists.")
		}
	}
	tag := domain.Tag{ID: auth.NewUUID(), Name: name, Color: color}
	tags[tag.ID] = tag
	return tag, nil
}

func (r *MemoryRepository) UpdateTag(_ context.Context, userID string, tagID string, input domain.TagUpdateRequest) (*domain.Tag, error) {
	if !input.Name.Present && !input.Color.Present {
		return nil, httperror.BadRequest("ValidationError", "At least one field must be updated.", nil)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	tags := r.memoryTags(userID)
	tag, ok := tags[tagID]
	if !ok {
		return nil, nil
	}
	if input.Name.Present {
		if input.Name.Value == nil {
			return nil, httperror.BadRequest("ValidationError", "name must be a string.", nil)
		}
		name, err := validateTagName(*input.Name.Value)
		if err != nil {
			return nil, err
		}
		for id, current := range tags {
			if id != tagID && current.Name == name {
				return nil, httperror.Conflict("TagNameAlreadyExists", "Tag name already exists.")
			}
		}
		tag.Name = name
	}
	if input.Color.Present {
		color, err := validateTagColor(input.Color.Value)
		if err != nil {
			return nil, err
		}
		tag.Color = color
	}
	tags[tagID] = tag
	r.syncMemoryBookmarkTag(userID, tag)
	return &tag, nil
}

func (r *MemoryRepository) DeleteTag(_ context.Context, userID string, tagID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	tags := r.memoryTags(userID)
	if _, ok := tags[tagID]; !ok {
		return false, nil
	}
	delete(tags, tagID)
	for index, bookmark := range r.bookmarks[userID] {
		next := bookmark.Tags[:0]
		for _, tag := range bookmark.Tags {
			if tag.ID != tagID {
				next = append(next, tag)
			}
		}
		bookmark.Tags = next
		bookmark.UpdatedAt = time.Now().UTC()
		r.bookmarks[userID][index] = bookmark
	}
	return true, nil
}

func (r *MemoryRepository) GetBookmarkSidebarStats(_ context.Context, userID string) (domain.BookmarkSidebarStatsResponse, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	counts := map[string]int{}
	for _, bookmark := range r.bookmarks[userID] {
		if bookmark.Folder != nil {
			counts[bookmark.Folder.ID]++
		}
	}
	items := make([]domain.FolderCount, 0, len(counts))
	for folderID, count := range counts {
		items = append(items, domain.FolderCount{FolderID: folderID, Count: count})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].FolderID < items[j].FolderID })
	return domain.BookmarkSidebarStatsResponse{FolderCounts: items}, nil
}

func (r *MemoryRepository) memoryFolders(userID string) map[string]domain.Folder {
	if r.folders[userID] == nil {
		r.folders[userID] = map[string]domain.Folder{}
	}
	return r.folders[userID]
}

func (r *MemoryRepository) memoryTags(userID string) map[string]domain.Tag {
	if r.tags[userID] == nil {
		r.tags[userID] = map[string]domain.Tag{}
	}
	return r.tags[userID]
}

func (r *MemoryRepository) syncMemoryBookmarkFolders(userID string, folders map[string]domain.Folder, affected map[string]bool) {
	for index, bookmark := range r.bookmarks[userID] {
		if bookmark.Folder == nil || !affected[bookmark.Folder.ID] {
			continue
		}
		if folder, ok := folders[bookmark.Folder.ID]; ok {
			bookmark.Folder = &folder
		} else {
			bookmark.Folder = nil
		}
		bookmark.UpdatedAt = time.Now().UTC()
		r.bookmarks[userID][index] = bookmark
	}
}

func (r *MemoryRepository) syncMemoryBookmarkTag(userID string, updated domain.Tag) {
	for index, bookmark := range r.bookmarks[userID] {
		for tagIndex, tag := range bookmark.Tags {
			if tag.ID == updated.ID {
				bookmark.Tags[tagIndex] = updated
				bookmark.UpdatedAt = time.Now().UTC()
			}
		}
		r.bookmarks[userID][index] = bookmark
	}
}

func (r *MemoryRepository) ensureMemoryFolderPath(userID string, rawPath string) *domain.Folder {
	segments := strings.Split(strings.Trim(strings.TrimSpace(rawPath), "/"), "/")
	var parent *domain.Folder
	for _, rawSegment := range segments {
		name := strings.TrimSpace(rawSegment)
		if name == "" {
			continue
		}
		path := buildFolderPath(parent, name)
		folders := r.memoryFolders(userID)
		var current *domain.Folder
		for _, candidate := range folders {
			if candidate.Path == path {
				value := candidate
				current = &value
				break
			}
		}
		if current == nil {
			value := domain.Folder{ID: auth.NewUUID(), Name: name, Path: path}
			if parent != nil {
				parentID := parent.ID
				value.ParentID = &parentID
			}
			folders[value.ID] = value
			current = &value
		}
		parent = current
	}
	return parent
}

func (r *MemoryRepository) ensureMemoryTags(userID string, names []string) []domain.Tag {
	tags := r.memoryTags(userID)
	items := []domain.Tag{}
	for _, rawName := range names {
		name := strings.TrimSpace(rawName)
		if name == "" {
			continue
		}
		var found *domain.Tag
		for _, candidate := range tags {
			if candidate.Name == name {
				value := candidate
				found = &value
				break
			}
		}
		if found == nil {
			value := domain.Tag{ID: auth.NewUUID(), Name: name}
			tags[value.ID] = value
			found = &value
		}
		items = append(items, *found)
	}
	return mergeTags(nil, items)
}

func (r *MemoryRepository) memoryFolderSubtreeContains(userID string, rootID string, candidateID string) bool {
	folders := r.folders[userID]
	root, ok := folders[rootID]
	if !ok {
		return false
	}
	candidate, ok := folders[candidateID]
	return ok && (candidate.Path == root.Path || strings.HasPrefix(candidate.Path, root.Path+"/"))
}

func bookmarkHasTag(bookmark domain.Bookmark, tagID string) bool {
	for _, tag := range bookmark.Tags {
		if tag.ID == tagID {
			return true
		}
	}
	return false
}

func mergeTags(existing []domain.Tag, next []domain.Tag) []domain.Tag {
	seen := map[string]bool{}
	result := make([]domain.Tag, 0, len(existing)+len(next))
	for _, tag := range append(existing, next...) {
		if !seen[tag.ID] {
			seen[tag.ID] = true
			result = append(result, tag)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result
}
