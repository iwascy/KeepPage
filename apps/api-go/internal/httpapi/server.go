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
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/config"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	localmiddleware "github.com/keeppage/keeppage/apps/api-go/internal/middleware"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
	"github.com/keeppage/keeppage/apps/api-go/internal/service"
)

type Server struct {
	cfg       config.Config
	logger    *slog.Logger
	repo      repository.Repository
	auth      *auth.Service
	bookmarks *service.BookmarkService
	startedAt time.Time
}

func NewServer(
	cfg config.Config,
	logger *slog.Logger,
	repo repository.Repository,
	authService *auth.Service,
	bookmarkService *service.BookmarkService,
) *Server {
	return &Server{
		cfg:       cfg,
		logger:    logger,
		repo:      repo,
		auth:      authService,
		bookmarks: bookmarkService,
		startedAt: time.Now(),
	}
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
	router.Get("/bookmarks", s.handleSearchBookmarks)
	router.Post("/bookmarks", s.handleCreateBookmark)
	router.Post("/ingest/bookmarks", s.handleIngestBookmark)
	return router
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
