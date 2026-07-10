package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
)

func (s *Server) registerPrivateBookmarkRoutes(router chi.Router) {
	router.Get("/private/bookmarks", s.handleListPrivateBookmarks)
	router.Get("/private/bookmarks/{bookmarkID}", s.handleGetPrivateBookmarkDetail)
}

func (s *Server) handleListPrivateBookmarks(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	if !s.requirePrivateCaptureUnlock(w, r, user.ID) {
		return
	}
	repo, ok := s.repo.(repository.PrivateBookmarkRepository)
	if !ok {
		writeError(s.logger, w, httperror.New(http.StatusNotImplemented, "NotImplemented", "当前存储不支持私密书签。", nil))
		return
	}
	query, err := parseBookmarkSearchQuery(r)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	query.FolderID = ""
	query.TagID = ""
	payload, err := repo.SearchPrivateBookmarks(r.Context(), user.ID, query)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}
func (s *Server) handleGetPrivateBookmarkDetail(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	if !s.requirePrivateCaptureUnlock(w, r, user.ID) {
		return
	}
	repo, ok := s.repo.(repository.PrivateBookmarkRepository)
	if !ok {
		writeError(s.logger, w, httperror.New(http.StatusNotImplemented, "NotImplemented", "当前存储不支持私密书签。", nil))
		return
	}
	payload, err := repo.GetPrivateBookmarkDetail(r.Context(), user.ID, chi.URLParam(r, "bookmarkID"))
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
