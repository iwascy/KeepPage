package httpapi

import (
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/config"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
	"github.com/keeppage/keeppage/apps/api-go/internal/service"
)

// registerCaptureUploadRoutes is invoked by Server.Router once object storage is wired.
func (s *Server) registerCaptureUploadRoutes(router chi.Router) {
	repo, ok := s.repo.(repository.CaptureUploadRepository)
	if !ok {
		return
	}
	api := service.NewCaptureUploadService(repo, s.objects)
	router.Post("/captures/init", s.handleCaptureInit(api, false))
	router.Post("/captures/complete", s.handleCaptureComplete(api, false))
	router.Post("/private/captures/init", s.handleCaptureInit(api, true))
	router.Post("/private/captures/complete", s.handleCaptureComplete(api, true))
	router.Get("/public/objects", s.handleObjectGet(api, true))
	router.Get("/objects", s.handleObjectGet(api, false))
	router.Get("/objects/{encodedObjectKey}", s.handleObjectPathGet(api))
	router.Put("/uploads/{encodedObjectKey}", s.handleObjectPut(api))
	router.Put("/uploads/{encodedObjectKey}/chunks/{uploadID}", s.handleObjectChunkPut(api))
}
func (s *Server) handleCaptureInit(api *service.CaptureUploadService, private bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := s.requireUser(r, auth.RequireOptions{AllowAPIToken: true, AllowExtensionDevice: true, RequiredAPIScope: "bookmark:create"})
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		if private && !s.requirePrivateCaptureUnlock(w, r, user.ID) {
			return
		}
		var input domain.CaptureInitRequest
		if err = decodeJSON(r, &input); err != nil {
			writeError(s.logger, w, err)
			return
		}
		response, err := api.Init(r.Context(), user.ID, input, private)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		response.UploadURL = publicBaseURL(r, s.cfg) + "/uploads/" + url.PathEscape(response.ObjectKey)
		writeJSON(w, http.StatusOK, response)
	}
}
func (s *Server) handleCaptureComplete(api *service.CaptureUploadService, private bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := s.requireUser(r, auth.RequireOptions{AllowAPIToken: true, AllowExtensionDevice: true, RequiredAPIScope: "bookmark:create"})
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		if private && !s.requirePrivateCaptureUnlock(w, r, user.ID) {
			return
		}
		var input domain.CaptureCompleteRequest
		if err = decodeJSON(r, &input); err != nil {
			writeError(s.logger, w, err)
			return
		}
		result, err := api.Complete(r.Context(), user.ID, input, private)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		writeJSON(w, http.StatusOK, domain.CaptureCompleteResponse{BookmarkID: result.Bookmark.ID, VersionID: result.VersionID, CreatedNewVersion: result.CreatedNewVersion, Deduplicated: result.Deduplicated})
	}
}
func (s *Server) handleObjectGet(api *service.CaptureUploadService, public bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.URL.Query().Get("key")
		if key == "" {
			writeError(s.logger, w, httperror.BadRequest("ValidationError", "key is required.", nil))
			return
		}
		userID := ""
		if !public {
			user, err := s.requireUser(r, auth.RequireOptions{})
			if err != nil {
				writeError(s.logger, w, err)
				return
			}
			userID = user.ID
			if strings.HasPrefix(key, "private-captures/") && !s.requirePrivateCaptureUnlock(w, r, user.ID) {
				return
			}
		}
		body, contentType, err := api.Get(r.Context(), userID, key, public)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		w.Header().Set("Content-Type", contentType)
		if public {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "private, max-age=0, no-store")
		}
		_, _ = w.Write(body)
	}
}
func (s *Server) handleObjectPathGet(api *service.CaptureUploadService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := s.requireUser(r, auth.RequireOptions{})
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		key, err := url.PathUnescape(chi.URLParam(r, "encodedObjectKey"))
		if err != nil {
			writeError(s.logger, w, httperror.BadRequest("InvalidUploadObjectKey", "Invalid upload object key.", nil))
			return
		}
		if strings.HasPrefix(key, "private-captures/") && !s.requirePrivateCaptureUnlock(w, r, user.ID) {
			return
		}
		body, contentType, err := api.Get(r.Context(), user.ID, key, false)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "private, max-age=0, no-store")
		_, _ = w.Write(body)
	}
}
func (s *Server) handleObjectPut(api *service.CaptureUploadService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := s.requireUser(r, auth.RequireOptions{AllowAPIToken: true, AllowExtensionDevice: true, RequiredAPIScope: "bookmark:create"})
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		key, err := url.PathUnescape(chi.URLParam(r, "encodedObjectKey"))
		if err != nil {
			writeError(s.logger, w, httperror.BadRequest("InvalidUploadObjectKey", "Invalid upload object key.", nil))
			return
		}
		if strings.HasPrefix(key, "private-captures/") && !s.requirePrivateCaptureUnlock(w, r, user.ID) {
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		if err = api.Put(r.Context(), user.ID, key, body, r.Header.Get("Content-Type"), r.Header.Get("Content-Encoding")); err != nil {
			writeError(s.logger, w, err)
			return
		}
		writeNoContent(w)
	}
}
func (s *Server) handleObjectChunkPut(api *service.CaptureUploadService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := s.requireUser(r, auth.RequireOptions{AllowAPIToken: true, AllowExtensionDevice: true, RequiredAPIScope: "bookmark:create"})
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		key, err := url.PathUnescape(chi.URLParam(r, "encodedObjectKey"))
		if err != nil {
			writeError(s.logger, w, httperror.BadRequest("InvalidUploadObjectKey", "Invalid upload object key.", nil))
			return
		}
		if strings.HasPrefix(key, "private-captures/") && !s.requirePrivateCaptureUnlock(w, r, user.ID) {
			return
		}
		offset, err := service.ParseNonNegativeHeader(r.Header.Get("X-Keeppage-Upload-Offset"), "x-keeppage-upload-offset", true)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		var total *int64
		if raw := r.Header.Get("X-Keeppage-Upload-Total-Size"); raw != "" {
			value, parseErr := service.ParseNonNegativeHeader(raw, "x-keeppage-upload-total-size", false)
			if parseErr != nil {
				writeError(s.logger, w, parseErr)
				return
			}
			total = &value
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		result, err := api.PutChunk(r.Context(), user.ID, key, chi.URLParam(r, "uploadID"), body, offset, total, r.Header.Get("X-Keeppage-Upload-Complete") == "1" || strings.EqualFold(r.Header.Get("X-Keeppage-Upload-Complete"), "true"), r.Header.Get("X-Keeppage-Upload-Content-Type"), r.Header.Get("X-Keeppage-Upload-Content-Encoding"))
		if err != nil {
			writeError(s.logger, w, err)
			return
		}
		if result.Complete {
			writeNoContent(w)
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{"uploadId": result.UploadID, "receivedBytes": result.ReceivedBytes})
	}
}
func publicBaseURL(r *http.Request, cfg config.Config) string {
	if base := strings.TrimRight(strings.TrimSpace(cfg.APIPublicBaseURL), "/"); base != "" {
		return base
	}
	protocol := r.Header.Get("X-Forwarded-Proto")
	if protocol == "" {
		protocol = "http"
	}
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	if host != "" {
		return protocol + "://" + host
	}
	return "http://" + cfg.Addr()
}

func (s *Server) requirePrivateCaptureUnlock(w http.ResponseWriter, r *http.Request, userID string) bool {
	privateService, err := s.privateExtensionService()
	if err == nil {
		err = privateService.RequirePrivateModeUnlocked(r.Context(), userID, r.Header.Get("x-keeppage-private-token"))
	}
	if err != nil {
		writeError(s.logger, w, err)
		return false
	}
	return true
}
