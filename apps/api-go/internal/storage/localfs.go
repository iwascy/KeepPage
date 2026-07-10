package storage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type LocalFS struct {
	root string
}

func NewLocalFS(root string) *LocalFS {
	return &LocalFS{root: root}
}

func (s *LocalFS) StatObject(_ context.Context, key string) (ObjectInfo, error) {
	path, err := s.pathForKey(key)
	if err != nil {
		return ObjectInfo{}, err
	}
	stat, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return ObjectInfo{}, ErrNotFound
	}
	if err != nil {
		return ObjectInfo{}, err
	}
	return ObjectInfo{Key: key, Size: stat.Size()}, nil
}

func (s *LocalFS) PutObject(_ context.Context, key string, content []byte, _ string) error {
	path, err := s.pathForKey(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, content, 0o644)
}

func (s *LocalFS) GetObject(_ context.Context, key string) ([]byte, error) {
	path, err := s.pathForKey(key)
	if err != nil {
		return nil, err
	}
	content, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	return content, err
}

func (s *LocalFS) DeleteObject(_ context.Context, key string) error {
	path, err := s.pathForKey(key)
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (s *LocalFS) pathForKey(key string) (string, error) {
	clean := filepath.Clean(strings.TrimPrefix(key, "/"))
	if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return "", os.ErrPermission
	}
	return filepath.Join(s.root, clean), nil
}
