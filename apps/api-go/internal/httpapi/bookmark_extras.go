package httpapi

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
)

func (s *Server) handleBookmarkSidebarStats(w http.ResponseWriter, r *http.Request) {
	u, e := s.requireUser(r, auth.RequireOptions{AllowExtensionDevice: true})
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	p, e := s.taxonomy.GetBookmarkSidebarStats(r.Context(), u.ID)
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	writeJSON(w, http.StatusOK, p)
}
func (s *Server) handleBookmarkStatus(w http.ResponseWriter, r *http.Request) {
	u, e := s.requireUser(r, auth.RequireOptions{AllowExtensionDevice: true})
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	raw := strings.TrimSpace(r.URL.Query().Get("url"))
	if raw == "" {
		writeError(s.logger, w, httperror.BadRequest("ValidationError", "url must be a valid URL.", nil))
		return
	}
	p, e := s.bookmarkExtras.Status(r.Context(), u.ID, raw)
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	writeJSON(w, http.StatusOK, p)
}
func (s *Server) handleBookmarkDetail(w http.ResponseWriter, r *http.Request) {
	u, e := s.requireUser(r, auth.RequireOptions{AllowExtensionDevice: true})
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	p, e := s.bookmarkExtras.Detail(r.Context(), u.ID, chi.URLParam(r, "bookmarkID"))
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	writeJSON(w, http.StatusOK, p)
}
func (s *Server) handleDeleteBookmark(w http.ResponseWriter, r *http.Request) {
	u, e := s.requireUser(r, auth.RequireOptions{})
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	if e = s.bookmarkExtras.Delete(r.Context(), u.ID, chi.URLParam(r, "bookmarkID")); e != nil {
		writeError(s.logger, w, e)
		return
	}
	writeNoContent(w)
}
func (s *Server) handleUpdateBookmarkMetadata(w http.ResponseWriter, r *http.Request) {
	u, e := s.requireUser(r, auth.RequireOptions{AllowExtensionDevice: true})
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	var in domain.BookmarkMetadataUpdateRequest
	if e = decodeJSON(r, &in); e != nil {
		writeError(s.logger, w, e)
		return
	}
	if !in.Note.Present && !in.FolderID.Present && !in.FolderPath.Present && in.TagIDs == nil && in.Tags == nil && in.IsFavorite == nil {
		writeError(s.logger, w, httperror.BadRequest("ValidationError", "At least one field must be updated.", nil))
		return
	}
	p, e := s.bookmarkExtras.Update(r.Context(), u.ID, chi.URLParam(r, "bookmarkID"), in)
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	writeJSON(w, http.StatusOK, p)
}
func (s *Server) handleRefreshBookmarkIcon(w http.ResponseWriter, r *http.Request) {
	u, e := s.requireUser(r, auth.RequireOptions{AllowExtensionDevice: true})
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	var in domain.BookmarkIconRefreshRequest
	if e = decodeJSON(r, &in); e != nil {
		writeError(s.logger, w, e)
		return
	}
	if in.BookmarkID == "" && in.Domain == "" && in.SourceURL == "" {
		writeError(s.logger, w, httperror.BadRequest("ValidationError", "bookmarkId, domain, or sourceUrl is required.", nil))
		return
	}
	p, e := s.bookmarkExtras.RefreshIcon(r.Context(), u.ID, in)
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	writeJSON(w, http.StatusOK, p)
}
func (s *Server) handleRefreshAllBookmarkIcons(w http.ResponseWriter, r *http.Request) {
	u, e := s.requireUser(r, auth.RequireOptions{AllowExtensionDevice: true})
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	p, e := s.bookmarkExtras.RefreshAllIcons(r.Context(), u.ID)
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	writeJSON(w, http.StatusOK, p)
}
