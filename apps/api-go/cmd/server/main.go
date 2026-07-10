package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/config"
	"github.com/keeppage/keeppage/apps/api-go/internal/httpapi"
	"github.com/keeppage/keeppage/apps/api-go/internal/jobs"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
	"github.com/keeppage/keeppage/apps/api-go/internal/service"
	"github.com/keeppage/keeppage/apps/api-go/internal/storage"
)

func main() {
	cfg, err := config.Read()
	if err != nil {
		slog.Error("failed to read config", "err", err)
		os.Exit(1)
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))

	ctx := context.Background()
	repo, err := repository.New(ctx, cfg)
	if err != nil {
		logger.Error("failed to initialize repository", "err", err)
		os.Exit(1)
	}
	defer repo.Close()

	objectStorage := storage.New(cfg)
	authService := auth.NewService(cfg.AuthTokenSecret, repo)
	bookmarkService := service.NewBookmarkService(repo, objectStorage)
	apiServer := httpapi.NewServer(cfg, logger, repo, authService, bookmarkService)
	backupScheduler := jobs.NewR2BookmarkBackupScheduler(cfg, logger)
	backupScheduler.Start()
	defer backupScheduler.Stop()

	server := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           apiServer.Router(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		logger.Info("KeepPage Go API listening", "addr", cfg.Addr(), "storage", repo.Kind())
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server failed", "err", err)
			os.Exit(1)
		}
	}()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	<-signals

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpapi.Shutdown(shutdownCtx, server); err != nil {
		logger.Error("server shutdown failed", "err", err)
		os.Exit(1)
	}
}
