package storage

import (
	"context"
	"errors"
)

type R2 struct{}

func NewR2() *R2 {
	return &R2{}
}

func (s *R2) StatObject(context.Context, string) (ObjectInfo, error) {
	return ObjectInfo{}, errors.New("R2 object storage is not implemented in the Go vertical slice yet")
}

func (s *R2) PutObject(context.Context, string, []byte, string) error {
	return errors.New("R2 object storage is not implemented in the Go vertical slice yet")
}

func (s *R2) GetObject(context.Context, string) ([]byte, error) {
	return nil, errors.New("R2 object storage is not implemented in the Go vertical slice yet")
}

func (s *R2) DeleteObject(context.Context, string) error {
	return errors.New("R2 object storage is not implemented in the Go vertical slice yet")
}
