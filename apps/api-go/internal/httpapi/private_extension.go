package httpapi

import (
	"net/http"
	"regexp"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
	"github.com/keeppage/keeppage/apps/api-go/internal/service"
)

var privateExtensionServices sync.Map // map[*Server]*service.PrivateExtensionService
var extensionDeviceIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// registerPrivateExtensionRoutes is wired into Server.Router by the coordinator.
func (s *Server) registerPrivateExtensionRoutes(router chi.Router) {
	router.Get("/private-mode/status", s.handlePrivateModeStatus)
	router.Post("/private-mode/setup", s.handlePrivateModeSetup)
	router.Post("/private-mode/unlock", s.handlePrivateModeUnlock)
	router.Post("/private-mode/password", s.handlePrivateModePassword)
	router.Post("/private-mode/lock", s.handlePrivateModeLock)
	router.Post("/extension/connect", s.handleExtensionConnect)
	router.Post("/extension/connect/redeem", s.handleExtensionConnectRedeem)
	router.Get("/extension/devices", s.handleListExtensionDevices)
	router.Delete("/extension/devices/{deviceID}", s.handleDeleteExtensionDevice)
}

func (s *Server) privateExtensionService() (*service.PrivateExtensionService, error) {
	if cached, ok := privateExtensionServices.Load(s); ok {
		return cached.(*service.PrivateExtensionService), nil
	}
	repo, ok := s.repo.(repository.PrivateExtensionRepository)
	if !ok {
		return nil, httperror.New(http.StatusNotImplemented, "NotImplemented", "当前存储不支持私密模式和扩展设备。", nil)
	}
	created := service.NewPrivateExtensionService(repo, s.cfg.AuthTokenSecret)
	actual, _ := privateExtensionServices.LoadOrStore(s, created)
	return actual.(*service.PrivateExtensionService), nil
}

func (s *Server) requirePrivateExtensionUser(w http.ResponseWriter, r *http.Request) (domain.AuthUser, *service.PrivateExtensionService, bool) {
	user, err := s.requireUser(r, auth.RequireOptions{AllowAPIToken: true, AllowExtensionDevice: true, RequiredAPIScope: "bookmark:create"})
	if err != nil {
		writeError(s.logger, w, err)
		return domain.AuthUser{}, nil, false
	}
	privateService, err := s.privateExtensionService()
	if err != nil {
		writeError(s.logger, w, err)
		return domain.AuthUser{}, nil, false
	}
	return user, privateService, true
}

func (s *Server) handlePrivateModeStatus(w http.ResponseWriter, r *http.Request) {
	user, privateService, ok := s.requirePrivateExtensionUser(w, r)
	if !ok {
		return
	}
	summary, err := privateService.PrivateModeStatus(r.Context(), user.ID, r.Header.Get("x-keeppage-private-token"))
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handlePrivateModeSetup(w http.ResponseWriter, r *http.Request) {
	user, privateService, ok := s.requirePrivateExtensionUser(w, r)
	if !ok {
		return
	}
	var input domain.PrivateModeSetupRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(s.logger, w, err)
		return
	}
	response, err := privateService.SetupPrivateMode(r.Context(), user.ID, input.Password)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

func (s *Server) handlePrivateModeUnlock(w http.ResponseWriter, r *http.Request) {
	user, privateService, ok := s.requirePrivateExtensionUser(w, r)
	if !ok {
		return
	}
	var input domain.PrivateModeUnlockRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(s.logger, w, err)
		return
	}
	response, err := privateService.UnlockPrivateMode(r.Context(), user.ID, input.Password)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handlePrivateModePassword(w http.ResponseWriter, r *http.Request) {
	user, privateService, ok := s.requirePrivateExtensionUser(w, r)
	if !ok {
		return
	}
	var input domain.PrivateModePasswordChangeRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(s.logger, w, err)
		return
	}
	valid, err := s.auth.VerifyLoginPassword(r.Context(), user.ID, input.LoginPassword)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	if !valid {
		writeError(s.logger, w, httperror.Unauthorized("InvalidCredentials", "登录密码错误。"))
		return
	}
	response, err := privateService.ChangePrivateModePassword(r.Context(), user.ID, input.NewPassword)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handlePrivateModeLock(w http.ResponseWriter, r *http.Request) {
	user, privateService, ok := s.requirePrivateExtensionUser(w, r)
	if !ok {
		return
	}
	summary, err := privateService.PrivateModeStatus(r.Context(), user.ID, "")
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handleExtensionConnect(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	privateService, err := s.privateExtensionService()
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	var input domain.ExtensionConnectInitRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(s.logger, w, err)
		return
	}
	response, err := privateService.CreateExtensionConnectCode(user.ID, input)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

func (s *Server) handleExtensionConnectRedeem(w http.ResponseWriter, r *http.Request) {
	privateService, err := s.privateExtensionService()
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	var input domain.ExtensionConnectRedeemRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(s.logger, w, err)
		return
	}
	response, err := privateService.RedeemExtensionConnectCode(r.Context(), input.Code)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleListExtensionDevices(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	privateService, err := s.privateExtensionService()
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	items, err := privateService.ListExtensionDevices(r.Context(), user.ID)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.ExtensionDeviceListResponse{Items: items})
}

func (s *Server) handleDeleteExtensionDevice(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	deviceID := chi.URLParam(r, "deviceID")
	if !extensionDeviceIDPattern.MatchString(deviceID) {
		writeError(s.logger, w, httperror.BadRequest("ValidationError", "Invalid extension device ID.", nil))
		return
	}
	privateService, err := s.privateExtensionService()
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	deleted, err := privateService.RevokeExtensionDevice(r.Context(), user.ID, deviceID)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	if !deleted {
		writeError(s.logger, w, httperror.NotFound("ExtensionDeviceNotFound", "扩展设备不存在。"))
		return
	}
	writeNoContent(w)
}
