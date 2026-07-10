package storage

import "github.com/keeppage/keeppage/apps/api-go/internal/config"

func New(cfg config.Config) ObjectStorage {
	if cfg.ObjectStorageDriver == "r2" {
		return NewR2()
	}
	return NewLocalFS(cfg.ObjectStorageRoot)
}
