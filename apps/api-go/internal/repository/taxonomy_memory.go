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

// memoryTaxonomy is one independent folder/tag namespace in the memory store
// (public or private) plus a visitor over the user's bookmarks that use it.
// Callers must hold r.mu.
type memoryTaxonomy struct {
	folders map[string]map[string]domain.Folder
	tags    map[string]map[string]domain.Tag
	each    func(userID string, fn func(*domain.Bookmark))
	// strictFolderIDs rejects metadata folderId values that are not the user's folders.
	strictFolderIDs bool
}

func (r *MemoryRepository) publicMemoryTaxonomy() memoryTaxonomy {
	return memoryTaxonomy{folders: r.folders, tags: r.tags, each: func(userID string, fn func(*domain.Bookmark)) {
		for index := range r.bookmarks[userID] {
			fn(&r.bookmarks[userID][index])
		}
	}}
}

func (r *MemoryRepository) privateMemoryTaxonomy() memoryTaxonomy {
	state := r.captureState()
	return memoryTaxonomy{folders: state.privateFolders, tags: state.privateTags, strictFolderIDs: true, each: func(userID string, fn func(*domain.Bookmark)) {
		for id, bookmark := range state.privateBookmarks {
			if !versionBelongsToMemoryUser(r, state, userID, id, true) {
				continue
			}
			fn(&bookmark)
			state.privateBookmarks[id] = bookmark
		}
	}}
}

func (m memoryTaxonomy) userFolders(userID string) map[string]domain.Folder {
	if m.folders[userID] == nil {
		m.folders[userID] = map[string]domain.Folder{}
	}
	return m.folders[userID]
}

func (m memoryTaxonomy) userTags(userID string) map[string]domain.Tag {
	if m.tags[userID] == nil {
		m.tags[userID] = map[string]domain.Tag{}
	}
	return m.tags[userID]
}

func (r *MemoryRepository) ListFolders(_ context.Context, userID string) ([]domain.Folder, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return listMemoryFolders(r.publicMemoryTaxonomy(), userID), nil
}

func (r *MemoryRepository) CreateFolder(_ context.Context, userID string, input domain.FolderCreateRequest) (domain.Folder, error) {
	return r.createMemoryFolder(r.publicMemoryTaxonomy(), userID, input)
}

func (r *MemoryRepository) UpdateFolder(_ context.Context, userID string, folderID string, input domain.FolderUpdateRequest) (*domain.Folder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return updateMemoryFolder(r.publicMemoryTaxonomy(), userID, folderID, input)
}

func (r *MemoryRepository) DeleteFolder(_ context.Context, userID string, folderID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return deleteMemoryFolder(r.publicMemoryTaxonomy(), userID, folderID)
}

func (r *MemoryRepository) ListTags(_ context.Context, userID string) ([]domain.Tag, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return listMemoryTags(r.publicMemoryTaxonomy(), userID), nil
}

func (r *MemoryRepository) CreateTag(_ context.Context, userID string, input domain.TagCreateRequest) (domain.Tag, error) {
	return r.createMemoryTag(r.publicMemoryTaxonomy(), userID, input)
}

func (r *MemoryRepository) UpdateTag(_ context.Context, userID string, tagID string, input domain.TagUpdateRequest) (*domain.Tag, error) {
	if !input.Name.Present && !input.Color.Present {
		return nil, httperror.BadRequest("ValidationError", "At least one field must be updated.", nil)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return updateMemoryTag(r.publicMemoryTaxonomy(), userID, tagID, input)
}

func (r *MemoryRepository) DeleteTag(_ context.Context, userID string, tagID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return deleteMemoryTag(r.publicMemoryTaxonomy(), userID, tagID), nil
}

func (r *MemoryRepository) GetBookmarkSidebarStats(_ context.Context, userID string) (domain.BookmarkSidebarStatsResponse, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return memorySidebarStats(r.publicMemoryTaxonomy(), userID), nil
}

func listMemoryFolders(m memoryTaxonomy, userID string) []domain.Folder {
	items := make([]domain.Folder, 0, len(m.folders[userID]))
	for _, folder := range m.folders[userID] {
		items = append(items, folder)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Path < items[j].Path })
	return items
}

func (r *MemoryRepository) createMemoryFolder(m memoryTaxonomy, userID string, input domain.FolderCreateRequest) (domain.Folder, error) {
	name, err := validateFolderName(input.Name)
	if err != nil {
		return domain.Folder{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	folders := m.userFolders(userID)
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

func updateMemoryFolder(m memoryTaxonomy, userID string, folderID string, input domain.FolderUpdateRequest) (*domain.Folder, error) {
	folders := m.userFolders(userID)
	updated, affected, err := updateFolderTree(folders, folderID, input)
	if err != nil || updated == nil {
		return updated, err
	}
	syncMemoryBookmarkFolders(m, userID, folders, affected)
	return updated, nil
}

func deleteMemoryFolder(m memoryTaxonomy, userID string, folderID string) (bool, error) {
	folders := m.userFolders(userID)
	deleted, affected, err := deleteFolderTree(folders, folderID)
	if err != nil || !deleted {
		return deleted, err
	}
	syncMemoryBookmarkFolders(m, userID, folders, affected)
	return true, nil
}

func listMemoryTags(m memoryTaxonomy, userID string) []domain.Tag {
	items := make([]domain.Tag, 0, len(m.tags[userID]))
	for _, tag := range m.tags[userID] {
		items = append(items, tag)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	return items
}

func (r *MemoryRepository) createMemoryTag(m memoryTaxonomy, userID string, input domain.TagCreateRequest) (domain.Tag, error) {
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
	tags := m.userTags(userID)
	for _, tag := range tags {
		if tag.Name == name {
			return domain.Tag{}, httperror.Conflict("TagNameAlreadyExists", "Tag name already exists.")
		}
	}
	tag := domain.Tag{ID: auth.NewUUID(), Name: name, Color: color}
	tags[tag.ID] = tag
	return tag, nil
}

func updateMemoryTag(m memoryTaxonomy, userID string, tagID string, input domain.TagUpdateRequest) (*domain.Tag, error) {
	tags := m.userTags(userID)
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
	syncMemoryBookmarkTag(m, userID, tag)
	return &tag, nil
}

func deleteMemoryTag(m memoryTaxonomy, userID string, tagID string) bool {
	tags := m.userTags(userID)
	if _, ok := tags[tagID]; !ok {
		return false
	}
	delete(tags, tagID)
	m.each(userID, func(bookmark *domain.Bookmark) {
		next := bookmark.Tags[:0]
		for _, tag := range bookmark.Tags {
			if tag.ID != tagID {
				next = append(next, tag)
			}
		}
		bookmark.Tags = next
		bookmark.UpdatedAt = time.Now().UTC()
	})
	return true
}

func memorySidebarStats(m memoryTaxonomy, userID string) domain.BookmarkSidebarStatsResponse {
	counts := map[string]int{}
	m.each(userID, func(bookmark *domain.Bookmark) {
		if bookmark.Folder != nil {
			counts[bookmark.Folder.ID]++
		}
	})
	items := make([]domain.FolderCount, 0, len(counts))
	for folderID, count := range counts {
		items = append(items, domain.FolderCount{FolderID: folderID, Count: count})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].FolderID < items[j].FolderID })
	return domain.BookmarkSidebarStatsResponse{FolderCounts: items}
}

func syncMemoryBookmarkFolders(m memoryTaxonomy, userID string, folders map[string]domain.Folder, affected map[string]bool) {
	m.each(userID, func(bookmark *domain.Bookmark) {
		if bookmark.Folder == nil || !affected[bookmark.Folder.ID] {
			return
		}
		if folder, ok := folders[bookmark.Folder.ID]; ok {
			bookmark.Folder = &folder
		} else {
			bookmark.Folder = nil
		}
		bookmark.UpdatedAt = time.Now().UTC()
	})
}

func syncMemoryBookmarkTag(m memoryTaxonomy, userID string, updated domain.Tag) {
	m.each(userID, func(bookmark *domain.Bookmark) {
		for tagIndex, tag := range bookmark.Tags {
			if tag.ID == updated.ID {
				bookmark.Tags[tagIndex] = updated
				bookmark.UpdatedAt = time.Now().UTC()
			}
		}
	})
}

// applyMemoryBookmarkMetadata applies a metadata update to item using taxonomy m.
// Validation runs before any mutation so a rejected request leaves item untouched.
func applyMemoryBookmarkMetadata(m memoryTaxonomy, userID string, item *domain.Bookmark, input domain.BookmarkMetadataUpdateRequest) error {
	if m.strictFolderIDs && !input.FolderPath.Present && input.FolderID.Present && input.FolderID.Value != nil {
		if _, ok := m.folders[userID][*input.FolderID.Value]; !ok {
			return httperror.NotFound("FolderNotFound", "Folder not found.")
		}
	}
	if input.Note.Present {
		item.Note = derefString(input.Note.Value)
	}
	if input.IsFavorite != nil {
		item.IsFavorite = *input.IsFavorite
	}
	if input.FolderPath.Present {
		item.Folder = ensureMemoryFolderPathIn(m, userID, derefString(input.FolderPath.Value))
	} else if input.FolderID.Present {
		if input.FolderID.Value == nil {
			item.Folder = nil
		} else if f, ok := m.folders[userID][*input.FolderID.Value]; ok {
			copy := f
			item.Folder = &copy
		}
	}
	if input.Tags != nil {
		item.Tags = ensureMemoryTagsIn(m, userID, *input.Tags)
	} else if input.TagIDs != nil {
		item.Tags = []domain.Tag{}
		for _, id := range *input.TagIDs {
			if tag, ok := m.tags[userID][id]; ok {
				item.Tags = append(item.Tags, tag)
			}
		}
	}
	item.UpdatedAt = time.Now().UTC()
	return nil
}

func (r *MemoryRepository) ensureMemoryFolderPath(userID string, rawPath string) *domain.Folder {
	return ensureMemoryFolderPathIn(r.publicMemoryTaxonomy(), userID, rawPath)
}

func ensureMemoryFolderPathIn(m memoryTaxonomy, userID string, rawPath string) *domain.Folder {
	segments := strings.Split(strings.Trim(strings.TrimSpace(rawPath), "/"), "/")
	var parent *domain.Folder
	for _, rawSegment := range segments {
		name := strings.TrimSpace(rawSegment)
		if name == "" {
			continue
		}
		path := buildFolderPath(parent, name)
		folders := m.userFolders(userID)
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
	return ensureMemoryTagsIn(r.publicMemoryTaxonomy(), userID, names)
}

func ensureMemoryTagsIn(m memoryTaxonomy, userID string, names []string) []domain.Tag {
	tags := m.userTags(userID)
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
	return memoryFolderSubtreeContainsIn(r.folders[userID], rootID, candidateID)
}

func memoryFolderSubtreeContainsIn(folders map[string]domain.Folder, rootID string, candidateID string) bool {
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
