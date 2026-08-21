package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
)

func (s *Server) handleGetAISettings(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	payload, err := s.aiOrganization.GetSettings(r.Context(), user.ID)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleSaveAISettings(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	var input domain.AISettingsUpdateRequest
	if err = decodeJSON(r, &input); err != nil {
		writeError(s.logger, w, err)
		return
	}
	payload, err := s.aiOrganization.SaveSettings(r.Context(), user.ID, input)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleTestAISettings(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	var input domain.AISettingsUpdateRequest
	if err = decodeJSON(r, &input); err != nil {
		writeError(s.logger, w, err)
		return
	}
	payload, err := s.aiOrganization.TestSettings(r.Context(), user.ID, input)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleCreateAIOrganizationJob(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	job, err := s.aiOrganization.Start(r.Context(), user.ID)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, job)
}

func (s *Server) handleGetCurrentAIOrganizationJob(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	job, err := s.repo.GetCurrentAIOrganizationJob(r.Context(), user.ID)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	if job == nil {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (s *Server) handleGetAIOrganizationJob(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	job, err := s.repo.GetAIOrganizationJob(r.Context(), user.ID, chi.URLParam(r, "jobID"))
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	if job == nil {
		writeError(s.logger, w, httperror.NotFound("AIJobNotFound", "整理任务不存在。"))
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (s *Server) handleListAIOrganizationJobItems(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	limit, err := parseIntQuery(r.URL.Query().Get("limit"), 50, 1, 100)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	offset, err := parseIntQuery(r.URL.Query().Get("offset"), 0, 0, 1_000_000)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	payload, err := s.repo.ListAIOrganizationJobItems(r.Context(), user.ID, chi.URLParam(r, "jobID"), status, limit, offset)
	if errors.Is(err, repository.ErrNotFound) {
		writeError(s.logger, w, httperror.NotFound("AIJobNotFound", "整理任务不存在。"))
		return
	}
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleCancelAIOrganizationJob(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	job, err := s.aiOrganization.Cancel(r.Context(), user.ID, chi.URLParam(r, "jobID"))
	if errors.Is(err, repository.ErrNotFound) {
		writeError(s.logger, w, httperror.NotFound("AIJobNotFound", "整理任务不存在。"))
		return
	}
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, job)
}
