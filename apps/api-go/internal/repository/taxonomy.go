package repository

import (
	"sort"
	"strings"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
)

func validateFolderName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" || len(name) > 120 || strings.Contains(name, "/") {
		return "", httperror.BadRequest("ValidationError", "Folder name must be between 1 and 120 characters and cannot contain '/'.", nil)
	}
	return name, nil
}

func validateTagName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" || len(name) > 80 {
		return "", httperror.BadRequest("ValidationError", "Tag name must be between 1 and 80 characters.", nil)
	}
	return name, nil
}

func validateTagColor(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	color := strings.TrimSpace(*value)
	if color == "" || len(color) > 32 {
		return nil, httperror.BadRequest("ValidationError", "Tag color must be between 1 and 32 characters.", nil)
	}
	return &color, nil
}

func buildFolderPath(parent *domain.Folder, name string) string {
	if parent == nil {
		return name
	}
	return parent.Path + "/" + name
}

func folderSubtree(folders map[string]domain.Folder, rootPath string) []domain.Folder {
	items := []domain.Folder{}
	for _, folder := range folders {
		if folder.Path == rootPath || strings.HasPrefix(folder.Path, rootPath+"/") {
			items = append(items, folder)
		}
	}
	sort.Slice(items, func(i, j int) bool { return len(items[i].Path) < len(items[j].Path) })
	return items
}

func folderPathsConflict(folders map[string]domain.Folder, replacements map[string]string, ignored map[string]bool) bool {
	seen := map[string]bool{}
	for _, path := range replacements {
		if seen[path] {
			return true
		}
		seen[path] = true
	}
	for id, folder := range folders {
		if !ignored[id] && seen[folder.Path] {
			return true
		}
	}
	return false
}

func updateFolderTree(folders map[string]domain.Folder, folderID string, input domain.FolderUpdateRequest) (*domain.Folder, map[string]bool, error) {
	if !input.Name.Present && !input.ParentID.Present {
		return nil, nil, httperror.BadRequest("ValidationError", "At least one field must be updated.", nil)
	}
	current, ok := folders[folderID]
	if !ok {
		return nil, nil, nil
	}
	nextName := current.Name
	if input.Name.Present {
		if input.Name.Value == nil {
			return nil, nil, httperror.BadRequest("ValidationError", "name must be a string.", nil)
		}
		var err error
		nextName, err = validateFolderName(*input.Name.Value)
		if err != nil {
			return nil, nil, err
		}
	}
	nextParentID := current.ParentID
	if input.ParentID.Present {
		nextParentID = input.ParentID.Value
	}
	if nextParentID != nil && *nextParentID == folderID {
		return nil, nil, httperror.BadRequest("InvalidFolderMove", "Folder cannot be its own parent.", nil)
	}
	descendants := folderSubtree(folders, current.Path)
	descendantIDs := map[string]bool{}
	for _, folder := range descendants {
		descendantIDs[folder.ID] = true
	}
	var parent *domain.Folder
	if nextParentID != nil {
		found, ok := folders[*nextParentID]
		if !ok {
			return nil, nil, httperror.NotFound("FolderNotFound", "Parent folder not found.")
		}
		if descendantIDs[found.ID] {
			return nil, nil, httperror.BadRequest("InvalidFolderMove", "Folder cannot be moved into its child.", nil)
		}
		parent = &found
	}
	nextPath := buildFolderPath(parent, nextName)
	nextPaths := map[string]string{}
	for _, folder := range descendants {
		if folder.ID == folderID {
			nextPaths[folder.ID] = nextPath
		} else {
			nextPaths[folder.ID] = nextPath + strings.TrimPrefix(folder.Path, current.Path)
		}
	}
	if folderPathsConflict(folders, nextPaths, descendantIDs) {
		return nil, nil, httperror.Conflict("FolderPathAlreadyExists", "Folder path already exists.")
	}
	for _, folder := range descendants {
		folder.Path = nextPaths[folder.ID]
		if folder.ID == folderID {
			folder.Name = nextName
			folder.ParentID = nextParentID
		}
		folders[folder.ID] = folder
	}
	updated := folders[folderID]
	return &updated, descendantIDs, nil
}

func deleteFolderTree(folders map[string]domain.Folder, folderID string) (bool, map[string]bool, error) {
	current, ok := folders[folderID]
	if !ok {
		return false, nil, nil
	}
	descendants := folderSubtree(folders, current.Path)
	descendantIDs := map[string]bool{}
	for _, folder := range descendants {
		descendantIDs[folder.ID] = true
	}
	var parent *domain.Folder
	if current.ParentID != nil {
		found := folders[*current.ParentID]
		parent = &found
	}
	nextPaths := map[string]string{}
	for _, folder := range descendants {
		if folder.ID != folderID {
			relative := strings.TrimPrefix(folder.Path, current.Path+"/")
			nextPaths[folder.ID] = buildFolderPath(parent, relative)
		}
	}
	if folderPathsConflict(folders, nextPaths, descendantIDs) {
		return false, nil, httperror.Conflict("FolderPathAlreadyExists", "Folder path already exists.")
	}
	for _, folder := range descendants {
		if folder.ID == folderID {
			delete(folders, folder.ID)
			continue
		}
		folder.Path = nextPaths[folder.ID]
		if folder.ParentID != nil && *folder.ParentID == folderID {
			folder.ParentID = current.ParentID
		}
		folders[folder.ID] = folder
	}
	return true, descendantIDs, nil
}
