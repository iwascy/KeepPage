package jobs

import (
	"log/slog"

	"github.com/keeppage/keeppage/apps/api-go/internal/config"
)

type R2BookmarkBackupScheduler struct {
	cfg    config.Config
	logger *slog.Logger
}

func NewR2BookmarkBackupScheduler(cfg config.Config, logger *slog.Logger) *R2BookmarkBackupScheduler {
	return &R2BookmarkBackupScheduler{cfg: cfg, logger: logger}
}

func (s *R2BookmarkBackupScheduler) Start() {
	if !s.cfg.BackupR2Enabled {
		return
	}
	s.logger.Warn("R2 bookmark backup scheduler is configured but not implemented in the Go vertical slice yet")
}

func (s *R2BookmarkBackupScheduler) Stop() {}
