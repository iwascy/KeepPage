package httpapi

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"github.com/keeppage/keeppage/apps/api-go/internal/service"
)

func (s *Server) importShareService() (*service.ImportShareService, error) {
	return service.NewImportShareService(s.repo, s.cfg.WebPublicBaseURL)
}

func (s *Server) handlePreviewImport(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	var in domain.ImportRequest
	if err = decodeJSON(r, &in); err != nil {
		writeError(s.logger, w, err)
		return
	}
	svc, err := s.importShareService()
	if err == nil {
		var out domain.ImportPreviewResponse
		out, err = svc.PreviewImport(r.Context(), user.ID, in)
		if err == nil {
			writeJSON(w, http.StatusOK, out)
			return
		}
	}
	writeError(s.logger, w, err)
}
func (s *Server) handleCreateImportTask(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	var in domain.ImportRequest
	if err = decodeJSON(r, &in); err != nil {
		writeError(s.logger, w, err)
		return
	}
	svc, err := s.importShareService()
	if err == nil {
		var out domain.ImportTaskCreateResponse
		out, err = svc.CreateImportTask(r.Context(), user.ID, in)
		if err == nil {
			writeJSON(w, http.StatusOK, out)
			return
		}
	}
	writeError(s.logger, w, err)
}
func (s *Server) handleListImportTasks(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	svc, err := s.importShareService()
	if err == nil {
		var out domain.ImportTaskListResponse
		out, err = svc.ListImportTasks(r.Context(), user.ID)
		if err == nil {
			writeJSON(w, http.StatusOK, out)
			return
		}
	}
	writeError(s.logger, w, err)
}
func (s *Server) handleGetImportTaskDetail(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	svc, err := s.importShareService()
	if err == nil {
		var out domain.ImportTaskDetailResponse
		out, err = svc.GetImportTaskDetail(r.Context(), user.ID, chi.URLParam(r, "taskID"))
		if err == nil {
			writeJSON(w, http.StatusOK, out)
			return
		}
	}
	writeError(s.logger, w, err)
}

func (s *Server) handleListShares(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	svc, err := s.importShareService()
	if err == nil {
		var out domain.ShareListResponse
		out, err = svc.ListShares(r.Context(), user.ID)
		if err == nil {
			writeJSON(w, http.StatusOK, out)
			return
		}
	}
	writeError(s.logger, w, err)
}
func (s *Server) handleCreateShare(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	ok, retry, rateErr := s.repo.HitRateLimit(r.Context(), "share-create", user.ID, 10, time.Minute)
	if rateErr != nil {
		writeError(s.logger, w, rateErr)
		return
	}
	if !ok {
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		writeError(s.logger, w, httperror.New(http.StatusTooManyRequests, "RateLimited", "创建分享过于频繁，请稍后再试。", nil))
		return
	}
	var in domain.ShareCreateRequest
	if err = decodeJSON(r, &in); err != nil {
		writeError(s.logger, w, err)
		return
	}
	svc, err := s.importShareService()
	if err == nil {
		var out domain.Share
		out, err = svc.CreateShare(r.Context(), user.ID, in)
		if err == nil {
			writeJSON(w, http.StatusCreated, domain.ShareResponse{Share: out})
			return
		}
	}
	writeError(s.logger, w, err)
}
func (s *Server) handleGetShareDetail(w http.ResponseWriter, r *http.Request) {
	s.writeShareDetail(w, r, false)
}
func (s *Server) handleUpdateShare(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	var in domain.ShareUpdateRequest
	if err = decodeJSON(r, &in); err != nil {
		writeError(s.logger, w, err)
		return
	}
	svc, err := s.importShareService()
	if err == nil {
		var out domain.ShareDetailResponse
		out, err = svc.UpdateShare(r.Context(), user.ID, chi.URLParam(r, "shareID"), in)
		if err == nil {
			writeJSON(w, http.StatusOK, out)
			return
		}
	}
	writeError(s.logger, w, err)
}
func (s *Server) handleRevokeShare(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	svc, err := s.importShareService()
	if err == nil {
		var out domain.ShareResponse
		out, err = svc.RevokeShare(r.Context(), user.ID, chi.URLParam(r, "shareID"))
		if err == nil {
			writeJSON(w, http.StatusOK, out)
			return
		}
	}
	writeError(s.logger, w, err)
}
func (s *Server) writeShareDetail(w http.ResponseWriter, r *http.Request, _ bool) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	svc, err := s.importShareService()
	if err == nil {
		var out domain.ShareDetailResponse
		out, err = svc.GetShareDetail(r.Context(), user.ID, chi.URLParam(r, "shareID"))
		if err == nil {
			writeJSON(w, http.StatusOK, out)
			return
		}
	}
	writeError(s.logger, w, err)
}
func (s *Server) handleGetPublicShare(w http.ResponseWriter, r *http.Request) {
	ip := r.RemoteAddr
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		ip = host
	}
	ok, retry, rateErr := s.repo.HitRateLimit(r.Context(), "public-share", ip, 120, time.Minute)
	if rateErr != nil {
		writeError(s.logger, w, rateErr)
		return
	}
	if !ok {
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		writeError(s.logger, w, httperror.New(http.StatusTooManyRequests, "RateLimited", "请求过于频繁，请稍后再试。", nil))
		return
	}
	svc, err := s.importShareService()
	if err == nil {
		var out domain.PublicShareResponse
		out, err = svc.GetPublicShare(r.Context(), strings.TrimSpace(chi.URLParam(r, "token")))
		if err == nil {
			w.Header().Set("Cache-Control", "public, max-age=0, s-maxage=15, must-revalidate")
			w.Header().Set("X-Robots-Tag", "noindex, nofollow")
			writeJSON(w, http.StatusOK, out)
			return
		}
	}
	writeError(s.logger, w, err)
}
