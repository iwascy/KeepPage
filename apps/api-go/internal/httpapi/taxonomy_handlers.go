package httpapi

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
)

// userGuard authenticates a request and returns the user id; on failure it has
// already written the error response.
type userGuard func(w http.ResponseWriter, r *http.Request) (string, bool)

// taxonomyStore is one independent folder/tag namespace (public or private).
type taxonomyStore struct {
	listFolders  func(ctx context.Context, userID string) ([]domain.Folder, error)
	createFolder func(ctx context.Context, userID string, input domain.FolderCreateRequest) (domain.Folder, error)
	updateFolder func(ctx context.Context, userID string, folderID string, input domain.FolderUpdateRequest) (*domain.Folder, error)
	deleteFolder func(ctx context.Context, userID string, folderID string) (bool, error)
	listTags     func(ctx context.Context, userID string) ([]domain.Tag, error)
	createTag    func(ctx context.Context, userID string, input domain.TagCreateRequest) (domain.Tag, error)
	updateTag    func(ctx context.Context, userID string, tagID string, input domain.TagUpdateRequest) (*domain.Tag, error)
	deleteTag    func(ctx context.Context, userID string, tagID string) (bool, error)
	sidebarStats func(ctx context.Context, userID string) (domain.BookmarkSidebarStatsResponse, error)
}

func publicTaxonomyStore(repo repository.TaxonomyRepository) taxonomyStore {
	return taxonomyStore{
		listFolders: repo.ListFolders, createFolder: repo.CreateFolder, updateFolder: repo.UpdateFolder, deleteFolder: repo.DeleteFolder,
		listTags: repo.ListTags, createTag: repo.CreateTag, updateTag: repo.UpdateTag, deleteTag: repo.DeleteTag,
		sidebarStats: repo.GetBookmarkSidebarStats,
	}
}

func privateTaxonomyStore(repo repository.PrivateBookmarkRepository) taxonomyStore {
	return taxonomyStore{
		listFolders: repo.ListPrivateFolders, createFolder: repo.CreatePrivateFolder, updateFolder: repo.UpdatePrivateFolder, deleteFolder: repo.DeletePrivateFolder,
		listTags: repo.ListPrivateTags, createTag: repo.CreatePrivateTag, updateTag: repo.UpdatePrivateTag, deleteTag: repo.DeletePrivateTag,
		sidebarStats: repo.GetPrivateBookmarkSidebarStats,
	}
}

func (s *Server) publicGuard(options auth.RequireOptions) userGuard {
	return func(w http.ResponseWriter, r *http.Request) (string, bool) {
		user, err := s.requireUser(r, options)
		if err != nil {
			writeError(s.logger, w, err)
			return "", false
		}
		return user.ID, true
	}
}

func (s *Server) handleWorkspaceBootstrapWith(guard userGuard, store taxonomyStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := guard(w, r)
		if !ok {
			return
		}
		folders, err := store.listFolders(r.Context(), userID)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		tags, err := store.listTags(r.Context(), userID)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		stats, err := store.sidebarStats(r.Context(), userID)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		writeJSON(w, http.StatusOK, domain.WorkspaceBootstrapResponse{Folders: folders, Tags: tags, FolderCounts: stats.FolderCounts})
	}
}

func (s *Server) handleListFoldersWith(guard userGuard, store taxonomyStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := guard(w, r)
		if !ok {
			return
		}
		items, err := store.listFolders(r.Context(), userID)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		writeJSON(w, http.StatusOK, domain.FolderListResponse{Items: items})
	}
}

func (s *Server) handleCreateFolderWith(guard userGuard, store taxonomyStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := guard(w, r)
		if !ok {
			return
		}
		var input domain.FolderCreateRequest
		if err := decodeJSON(r, &input); err != nil {
			writeError(s.logger, w, err)
			return
		}
		folder, err := store.createFolder(r.Context(), userID, input)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		writeJSON(w, http.StatusCreated, folder)
	}
}

func (s *Server) handleUpdateFolderWith(guard userGuard, store taxonomyStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := guard(w, r)
		if !ok {
			return
		}
		var input domain.FolderUpdateRequest
		if err := decodeJSON(r, &input); err != nil {
			writeError(s.logger, w, err)
			return
		}
		folder, err := store.updateFolder(r.Context(), userID, chi.URLParam(r, "folderID"), input)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		if folder == nil {
			writeError(s.logger, w, httperror.NotFound("FolderNotFound", "Folder not found."))
			return
		}
		writeJSON(w, http.StatusOK, folder)
	}
}

func (s *Server) handleDeleteFolderWith(guard userGuard, store taxonomyStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := guard(w, r)
		if !ok {
			return
		}
		deleted, err := store.deleteFolder(r.Context(), userID, chi.URLParam(r, "folderID"))
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		if !deleted {
			writeError(s.logger, w, httperror.NotFound("FolderNotFound", "Folder not found."))
			return
		}
		writeNoContent(w)
	}
}

func (s *Server) handleListTagsWith(guard userGuard, store taxonomyStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := guard(w, r)
		if !ok {
			return
		}
		items, err := store.listTags(r.Context(), userID)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		writeJSON(w, http.StatusOK, domain.TagListResponse{Items: items})
	}
}

func (s *Server) handleCreateTagWith(guard userGuard, store taxonomyStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := guard(w, r)
		if !ok {
			return
		}
		var input domain.TagCreateRequest
		if err := decodeJSON(r, &input); err != nil {
			writeError(s.logger, w, err)
			return
		}
		tag, err := store.createTag(r.Context(), userID, input)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		writeJSON(w, http.StatusCreated, tag)
	}
}

func (s *Server) handleUpdateTagWith(guard userGuard, store taxonomyStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := guard(w, r)
		if !ok {
			return
		}
		var input domain.TagUpdateRequest
		if err := decodeJSON(r, &input); err != nil {
			writeError(s.logger, w, err)
			return
		}
		tag, err := store.updateTag(r.Context(), userID, chi.URLParam(r, "tagID"), input)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		if tag == nil {
			writeError(s.logger, w, httperror.NotFound("TagNotFound", "Tag not found."))
			return
		}
		writeJSON(w, http.StatusOK, tag)
	}
}

func (s *Server) handleDeleteTagWith(guard userGuard, store taxonomyStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := guard(w, r)
		if !ok {
			return
		}
		deleted, err := store.deleteTag(r.Context(), userID, chi.URLParam(r, "tagID"))
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		if !deleted {
			writeError(s.logger, w, httperror.NotFound("TagNotFound", "Tag not found."))
			return
		}
		writeNoContent(w)
	}
}

func (s *Server) handleSidebarStatsWith(guard userGuard, store taxonomyStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := guard(w, r)
		if !ok {
			return
		}
		payload, err := store.sidebarStats(r.Context(), userID)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		writeJSON(w, http.StatusOK, payload)
	}
}

// decodeBookmarkMetadata decodes a metadata update and rejects empty updates.
func decodeBookmarkMetadata(r *http.Request) (domain.BookmarkMetadataUpdateRequest, error) {
	var in domain.BookmarkMetadataUpdateRequest
	if err := decodeJSON(r, &in); err != nil {
		return in, err
	}
	if !in.Note.Present && !in.FolderID.Present && !in.FolderPath.Present && in.TagIDs == nil && in.Tags == nil && in.IsFavorite == nil {
		return in, httperror.BadRequest("ValidationError", "At least one field must be updated.", nil)
	}
	return in, nil
}
