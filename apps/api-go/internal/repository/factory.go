package repository

import (
	"context"

	"github.com/keeppage/keeppage/apps/api-go/internal/config"
)

func New(ctx context.Context, cfg config.Config) (Repository, error) {
	if cfg.StorageDriver == "postgres" {
		return NewPostgresRepository(ctx, cfg.DatabaseURL)
	}
	return NewMemoryRepository(), nil
}
