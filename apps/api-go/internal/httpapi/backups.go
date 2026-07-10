package httpapi

import (
	"io"
	"net/http"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
)

func (s *Server) handleBackupExport(w http.ResponseWriter, r *http.Request) {
	u, e := s.requireUser(r, auth.RequireOptions{})
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	folders, e := s.taxonomy.ListFolders(r.Context(), u.ID)
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	tags, e := s.taxonomy.ListTags(r.Context(), u.ID)
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	body, name, preview, e := s.backups.Export(r.Context(), u, folders, tags)
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	w.Header().Set("content-type", "application/x-keeppage-package")
	w.Header().Set("content-disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("x-keeppage-backup-format", preview.Format)
	w.Header().Set("x-keeppage-backup-version", "1")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
func (s *Server) handleBackupPreview(w http.ResponseWriter, r *http.Request) {
	u, e := s.requireUser(r, auth.RequireOptions{})
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	body, e := io.ReadAll(r.Body)
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	p, e := s.backups.Preview(r.Context(), u.ID, body)
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	writeJSON(w, http.StatusOK, p)
}
func (s *Server) handleBackupImport(w http.ResponseWriter, r *http.Request) {
	u, e := s.requireUser(r, auth.RequireOptions{})
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	body, e := io.ReadAll(r.Body)
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	p, e := s.backups.Import(r.Context(), u.ID, body)
	if e != nil {
		writeError(s.logger, w, e)
		return
	}
	writeJSON(w, http.StatusOK, p)
}
