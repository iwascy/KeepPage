package storage

import "github.com/keeppage/keeppage/apps/api-go/internal/config"

func New(cfg config.Config) (ObjectStorage, error) {
	if cfg.ObjectStorageDriver == "r2" {
		return NewR2(cfg)
	}
	return NewLocalFS(cfg.ObjectStorageRoot), nil
}
