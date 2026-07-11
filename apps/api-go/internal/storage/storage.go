package storage

import (
	"context"
	"errors"
)

var ErrNotFound = errors.New("object not found")

type ObjectInfo struct {
	Key  string
	Size int64
}

type ObjectStorage interface {
	StatObject(ctx context.Context, key string) (ObjectInfo, error)
	PutObject(ctx context.Context, key string, content []byte, contentType string) error
	GetObject(ctx context.Context, key string) ([]byte, error)
	DeleteObject(ctx context.Context, key string) error
}
