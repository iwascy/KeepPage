package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/keeppage/keeppage/apps/api-go/internal/access"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/config"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	localmiddleware "github.com/keeppage/keeppage/apps/api-go/internal/middleware"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
	"github.com/keeppage/keeppage/apps/api-go/internal/service"
	"github.com/keeppage/keeppage/apps/api-go/internal/storage"
)

type Server struct {
	cfg            config.Config
	logger         *slog.Logger
	repo           repository.Repository
	taxonomy       repository.TaxonomyRepository
	auth           *auth.Service
	bookmarks      *service.BookmarkService
	bookmarkExtras *service.BookmarkExtrasService
	backups        *service.BackupService
	objects        storage.ObjectStorage
	tokens         *access.TokenService
	startedAt      time.Time
}

func NewServer(
	cfg config.Config,
	logger *slog.Logger,
	repo repository.Repository,
	authService *auth.Service,
	bookmarkService *service.BookmarkService,
	tokenService *access.TokenService,
	objectStorage storage.ObjectStorage,
) *Server {
	taxonomy, ok := repo.(repository.TaxonomyRepository)
	if !ok {
		panic("repository must implement taxonomy operations")
	}
	bookmarkExtras := service.NewBookmarkExtrasService(repo, objectStorage)
	return &Server{
		cfg:            cfg,
		logger:         logger,
		repo:           repo,
		taxonomy:       taxonomy,
		auth:           authService,
		bookmarks:      bookmarkService,
		bookmarkExtras: bookmarkExtras,
		backups:        service.NewBackupService(repo, bookmarkService, bookmarkExtras, objectStorage),
		objects:        objectStorage,
		tokens:         tokenService,
		startedAt:      time.Now(),
	}
}

func (s *Server) BackupService() *service.BackupService {
	return s.backups
}

func (s *Server) Router() http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.RealIP)
	router.Use(middleware.RequestID)
	router.Use(localmiddleware.RequestLog(s.logger))
	router.Use(localmiddleware.BodyLimit(s.cfg.UploadBodyLimitBytes()))
	router.Use(middleware.Recoverer)

	router.Get("/", s.handleRoot)
	router.Get("/health", s.handleHealth)
	router.Post("/auth/register", s.handleRegister)
	router.Post("/auth/login", s.handleLogin)
	router.Get("/auth/me", s.handleCurrentUser)
	router.Get("/api-tokens", s.handleListAPITokens)
	router.Post("/api-tokens", s.handleCreateAPIToken)
	router.Delete("/api-tokens/{tokenID}", s.handleRevokeAPIToken)
	router.Get("/workspace/bootstrap", s.handleWorkspaceBootstrap)
	router.Get("/folders", s.handleListFolders)
	router.Post("/folders", s.handleCreateFolder)
	router.Patch("/folders/{folderID}", s.handleUpdateFolder)
	router.Delete("/folders/{folderID}", s.handleDeleteFolder)
	router.Get("/tags", s.handleListTags)
	router.Post("/tags", s.handleCreateTag)
	router.Patch("/tags/{tagID}", s.handleUpdateTag)
	router.Delete("/tags/{tagID}", s.handleDeleteTag)
	router.Get("/bookmarks", s.handleSearchBookmarks)
	router.Get("/bookmarks/sidebar-stats", s.handleBookmarkSidebarStats)
	router.Get("/bookmarks/status", s.handleBookmarkStatus)
	router.Get("/bookmarks/{bookmarkID}", s.handleBookmarkDetail)
	router.Delete("/bookmarks/{bookmarkID}", s.handleDeleteBookmark)
	router.Patch("/bookmarks/{bookmarkID}/metadata", s.handleUpdateBookmarkMetadata)
	router.Post("/bookmarks/icons/refresh", s.handleRefreshBookmarkIcon)
	router.Post("/bookmarks/icons/refresh-all", s.handleRefreshAllBookmarkIcons)
	router.Get("/backups/bookmarks/export", s.handleBackupExport)
	router.Post("/backups/bookmarks/import/preview", s.handleBackupPreview)
	router.Post("/backups/bookmarks/import", s.handleBackupImport)
	router.Post("/imports/preview", s.handlePreviewImport)
	router.Post("/imports", s.handleCreateImportTask)
	router.Get("/imports", s.handleListImportTasks)
	router.Get("/imports/{taskID}", s.handleGetImportTaskDetail)
	router.Get("/shares", s.handleListShares)
	router.Post("/shares", s.handleCreateShare)
	router.Get("/shares/{shareID}", s.handleGetShareDetail)
	router.Patch("/shares/{shareID}", s.handleUpdateShare)
	router.Post("/shares/{shareID}/revoke", s.handleRevokeShare)
	router.Get("/public/shares/{token}", s.handleGetPublicShare)
	router.Post("/bookmarks", s.handleCreateBookmark)
	router.Post("/ingest/bookmarks", s.handleIngestBookmark)
	s.registerPrivateExtensionRoutes(router)
	s.registerCaptureUploadRoutes(router)
	s.registerPrivateBookmarkRoutes(router)
	return router
}

func (s *Server) handleWorkspaceBootstrap(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	folders, err := s.taxonomy.ListFolders(r.Context(), user.ID)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	tags, err := s.taxonomy.ListTags(r.Context(), user.ID)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	stats, err := s.taxonomy.GetBookmarkSidebarStats(r.Context(), user.ID)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.WorkspaceBootstrapResponse{Folders: folders, Tags: tags, FolderCounts: stats.FolderCounts})
}

func (s *Server) handleListFolders(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{AllowExtensionDevice: true})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	items, err := s.taxonomy.ListFolders(r.Context(), user.ID)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.FolderListResponse{Items: items})
}

func (s *Server) handleCreateFolder(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	var input domain.FolderCreateRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(s.logger, w, err)
		return
	}
	folder, err := s.taxonomy.CreateFolder(r.Context(), user.ID, input)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusCreated, folder)
}

func (s *Server) handleUpdateFolder(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	var input domain.FolderUpdateRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(s.logger, w, err)
		return
	}
	folder, err := s.taxonomy.UpdateFolder(r.Context(), user.ID, chi.URLParam(r, "folderID"), input)
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

func (s *Server) handleDeleteFolder(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	deleted, err := s.taxonomy.DeleteFolder(r.Context(), user.ID, chi.URLParam(r, "folderID"))
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

func (s *Server) handleListTags(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{AllowExtensionDevice: true})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	items, err := s.taxonomy.ListTags(r.Context(), user.ID)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, domain.TagListResponse{Items: items})
}

func (s *Server) handleCreateTag(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	var input domain.TagCreateRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(s.logger, w, err)
		return
	}
	tag, err := s.taxonomy.CreateTag(r.Context(), user.ID, input)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusCreated, tag)
}

func (s *Server) handleUpdateTag(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	var input domain.TagUpdateRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(s.logger, w, err)
		return
	}
	tag, err := s.taxonomy.UpdateTag(r.Context(), user.ID, chi.URLParam(r, "tagID"), input)
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

func (s *Server) handleDeleteTag(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	deleted, err := s.taxonomy.DeleteTag(r.Context(), user.ID, chi.URLParam(r, "tagID"))
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

func (s *Server) handleListAPITokens(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	payload, err := s.tokens.List(r.Context(), user.ID)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleCreateAPIToken(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	var input domain.APITokenCreateRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(s.logger, w, err)
		return
	}
	payload, err := s.tokens.Create(r.Context(), user.ID, input)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusCreated, payload)
}

func (s *Server) handleRevokeAPIToken(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	revoked, err := s.tokens.Revoke(r.Context(), user.ID, chi.URLParam(r, "tokenID"))
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	if !revoked {
		writeError(s.logger, w, httperror.NotFound("ApiTokenNotFound", "API token not found."))
		return
	}
	writeNoContent(w)
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var input domain.AuthRegisterRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(s.logger, w, err)
		return
	}
	session, err := s.auth.Register(r.Context(), input)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var input domain.AuthLoginRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(s.logger, w, err)
		return
	}
	session, err := s.auth.Login(r.Context(), input)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) handleCurrentUser(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{
		AllowAPIToken:        true,
		AllowExtensionDevice: true,
		RequiredAPIScope:     "bookmark:create",
	})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) handleRoot(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"name":    "KeepPage API",
		"storage": s.repo.Kind(),
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"storage":   s.repo.Kind(),
		"uptimeSec": time.Since(s.startedAt).Seconds(),
		"tables": []string{
			"users",
			"devices",
			"folders",
			"bookmarks",
			"capture_uploads",
			"bookmark_versions",
			"tags",
			"sync_ops",
		},
		"now": time.Now().UTC(),
	})
}

func (s *Server) handleSearchBookmarks(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{AllowExtensionDevice: true})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	query, err := parseBookmarkSearchQuery(r)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	payload, err := s.bookmarks.Search(r.Context(), user.ID, query)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleCreateBookmark(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{AllowExtensionDevice: true})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	s.createBookmarkWithUser(w, r, user.ID)
}

func (s *Server) handleIngestBookmark(w http.ResponseWriter, r *http.Request) {
	user, err := s.requireUser(r, auth.RequireOptions{
		AllowAPIToken:    true,
		RequiredAPIScope: "bookmark:create",
	})
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	s.createBookmarkWithUser(w, r, user.ID)
}

func (s *Server) createBookmarkWithUser(w http.ResponseWriter, r *http.Request, userID string) {
	var input domain.IngestBookmarkRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(s.logger, w, err)
		return
	}
	if input.DedupeStrategy == "" {
		input.DedupeStrategy = "merge"
	}
	result, err := s.bookmarks.Create(r.Context(), userID, input)
	if err != nil {
		writeError(s.logger, w, err)
		return
	}
	statusCode := http.StatusOK
	if result.Status == "created" {
		statusCode = http.StatusCreated
	}
	writeJSON(w, statusCode, domain.IngestBookmarkResponse{
		BookmarkID:   result.Bookmark.ID,
		Status:       result.Status,
		Deduplicated: result.Deduplicated,
		Bookmark:     result.Bookmark,
	})
}

func (s *Server) requireUser(r *http.Request, options auth.RequireOptions) (domain.AuthUser, error) {
	token := readBearerToken(r)
	if token == "" && options.AllowAPIToken {
		token = strings.TrimSpace(r.Header.Get("x-keeppage-api-key"))
	}
	user, err := s.auth.AuthenticateBearer(r.Context(), token, options)
	if errors.Is(err, repository.ErrNotFound) {
		return domain.AuthUser{}, httperror.Unauthorized("Unauthorized", "当前登录状态无效，请重新登录。")
	}
	if err != nil {
		return domain.AuthUser{}, err
	}
	return user, nil
}

func readBearerToken(r *http.Request) string {
	authorization := strings.TrimSpace(r.Header.Get("authorization"))
	if authorization == "" {
		return ""
	}
	parts := strings.Fields(authorization)
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return ""
	}
	return parts[1]
}

func parseBookmarkSearchQuery(r *http.Request) (domain.BookmarkSearchQuery, error) {
	values := r.URL.Query()
	limit, err := parseIntQuery(values.Get("limit"), 20, 1, 100)
	if err != nil {
		return domain.BookmarkSearchQuery{}, err
	}
	offset, err := parseIntQuery(values.Get("offset"), 0, 0, 1_000_000)
	if err != nil {
		return domain.BookmarkSearchQuery{}, err
	}
	query := domain.BookmarkSearchQuery{
		Q:        values.Get("q"),
		Quality:  values.Get("quality"),
		View:     values.Get("view"),
		Domain:   values.Get("domain"),
		FolderID: values.Get("folderId"),
		TagID:    values.Get("tagId"),
		Limit:    limit,
		Offset:   offset,
	}
	if query.View == "" {
		query.View = "all"
	}
	switch query.View {
	case "all", "recent", "favorites":
	default:
		return domain.BookmarkSearchQuery{}, httperror.BadRequest("ValidationError", "view must be all, recent, or favorites.", nil)
	}
	if query.Quality != "" && query.Quality != "high" && query.Quality != "medium" && query.Quality != "low" {
		return domain.BookmarkSearchQuery{}, httperror.BadRequest("ValidationError", "quality must be high, medium, or low.", nil)
	}
	return query, nil
}

func parseIntQuery(raw string, fallback int, minValue int, maxValue int) (int, error) {
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < minValue || value > maxValue {
		return 0, httperror.BadRequest("ValidationError", "query parameter is out of range.", nil)
	}
	return value, nil
}

func Shutdown(ctx context.Context, server *http.Server) error {
	return server.Shutdown(ctx)
}
