package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
)

func (s *Server) registerPrivateBookmarkRoutes(router chi.Router) {
	repo, ok := s.repo.(repository.PrivateBookmarkRepository)
	if !ok {
		return
	}
	guard := s.privateGuard
	taxonomy := privateTaxonomyStore(repo)
	router.Get("/private/workspace/bootstrap", s.handleWorkspaceBootstrapWith(guard, taxonomy))
	router.Get("/private/folders", s.handleListFoldersWith(guard, taxonomy))
	router.Post("/private/folders", s.handleCreateFolderWith(guard, taxonomy))
	router.Patch("/private/folders/{folderID}", s.handleUpdateFolderWith(guard, taxonomy))
	router.Delete("/private/folders/{folderID}", s.handleDeleteFolderWith(guard, taxonomy))
	router.Get("/private/tags", s.handleListTagsWith(guard, taxonomy))
	router.Post("/private/tags", s.handleCreateTagWith(guard, taxonomy))
	router.Patch("/private/tags/{tagID}", s.handleUpdateTagWith(guard, taxonomy))
	router.Delete("/private/tags/{tagID}", s.handleDeleteTagWith(guard, taxonomy))
	router.Get("/private/bookmarks", s.handleListPrivateBookmarks(repo))
	router.Get("/private/bookmarks/sidebar-stats", s.handleSidebarStatsWith(guard, taxonomy))
	router.Get("/private/bookmarks/{bookmarkID}", s.handleGetPrivateBookmarkDetail(repo))
	router.Patch("/private/bookmarks/{bookmarkID}/metadata", s.handleUpdatePrivateBookmarkMetadata(repo))
	router.Delete("/private/bookmarks/{bookmarkID}", s.handleDeletePrivateBookmark(repo))
}

// privateGuard requires a session or extension device credential plus an unlocked private mode.
func (s *Server) privateGuard(w http.ResponseWriter, r *http.Request) (string, bool) {
	user, err := s.requireUser(r, auth.RequireOptions{AllowExtensionDevice: true})
	if err != nil {
		writeError(s.logger, w, err)
		return "", false
	}
	if !s.requirePrivateCaptureUnlock(w, r, user.ID) {
		return "", false
	}
	return user.ID, true
}

func (s *Server) handleListPrivateBookmarks(repo repository.PrivateBookmarkRepository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.privateGuard(w, r)
		if !ok {
			return
		}
		query, err := parseBookmarkSearchQuery(r)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		payload, err := repo.SearchPrivateBookmarks(r.Context(), userID, query)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		writeJSON(w, http.StatusOK, payload)
	}
}

func (s *Server) handleGetPrivateBookmarkDetail(repo repository.PrivateBookmarkRepository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.privateGuard(w, r)
		if !ok {
			return
		}
		payload, err := repo.GetPrivateBookmarkDetail(r.Context(), userID, chi.URLParam(r, "bookmarkID"))
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		if payload == nil {
			writeError(s.logger, w, httperror.NotFound("PrivateBookmarkNotFound", "Private bookmark not found."))
			return
		}
		for i := range payload.Versions {
			v := &payload.Versions[i]
			if info, e := s.objects.StatObject(r.Context(), v.HTMLObjectKey); e == nil {
				v.ArchiveAvailable = true
				v.ArchiveSizeBytes = &info.Size
			}
			if v.ReaderHTMLObjectKey != nil {
				if info, e := s.objects.StatObject(r.Context(), *v.ReaderHTMLObjectKey); e == nil {
					v.ReaderArchiveAvailable = true
					v.ReaderArchiveSizeBytes = &info.Size
				}
			}
		}
		writeJSON(w, http.StatusOK, payload)
	}
}

func (s *Server) handleUpdatePrivateBookmarkMetadata(repo repository.PrivateBookmarkRepository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.privateGuard(w, r)
		if !ok {
			return
		}
		in, err := decodeBookmarkMetadata(r)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		bookmark, err := repo.UpdatePrivateBookmarkMetadata(r.Context(), userID, chi.URLParam(r, "bookmarkID"), in)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		if bookmark == nil {
			writeError(s.logger, w, httperror.NotFound("PrivateBookmarkNotFound", "Private bookmark not found."))
			return
		}
		writeJSON(w, http.StatusOK, bookmark)
	}
}

// handleDeletePrivateBookmark mirrors the public delete: rows go first, then the archived HTML objects.
func (s *Server) handleDeletePrivateBookmark(repo repository.PrivateBookmarkRepository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.privateGuard(w, r)
		if !ok {
			return
		}
		bookmarkID := chi.URLParam(r, "bookmarkID")
		detail, err := repo.GetPrivateBookmarkDetail(r.Context(), userID, bookmarkID)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		deleted, err := repo.DeletePrivateBookmark(r.Context(), userID, bookmarkID)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		if !deleted {
			writeError(s.logger, w, httperror.NotFound("PrivateBookmarkNotFound", "Private bookmark not found."))
			return
		}
		if detail != nil {
			for _, v := range detail.Versions {
				_ = s.objects.DeleteObject(r.Context(), v.HTMLObjectKey)
				if v.ReaderHTMLObjectKey != nil {
					_ = s.objects.DeleteObject(r.Context(), *v.ReaderHTMLObjectKey)
				}
			}
		}
		writeNoContent(w)
	}
}
