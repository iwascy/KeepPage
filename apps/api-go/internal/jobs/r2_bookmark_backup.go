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
	// BACKUP_R2_ENABLED is rejected in config.Validate until the scheduler is ported.
	if s.cfg.BackupR2Enabled {
		s.logger.Error("R2 bookmark backup scheduler is not implemented; refusing to start with BACKUP_R2_ENABLED=true")
	}
}

func (s *R2BookmarkBackupScheduler) Stop() {}
