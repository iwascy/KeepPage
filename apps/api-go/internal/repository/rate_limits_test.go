package repository

import (
	"context"
	"testing"
	"time"
)

func TestMemoryRateLimitUsesSharedWindow(t *testing.T) {
	repo := NewMemoryRepository()
	ctx := context.Background()
	ok, retry, err := repo.HitRateLimit(ctx, "public-share", "127.0.0.1", 2, time.Minute)
	if err != nil || !ok || retry != 0 {
		t.Fatalf("first hit = %v, %d, %v", ok, retry, err)
	}
	ok, _, _ = repo.HitRateLimit(ctx, "public-share", "127.0.0.1", 2, time.Minute)
	if !ok {
		t.Fatal("second hit should be allowed")
	}
	ok, retry, err = repo.HitRateLimit(ctx, "public-share", "127.0.0.1", 2, time.Minute)
	if err != nil || ok || retry < 1 {
		t.Fatalf("third hit = %v, %d, %v", ok, retry, err)
	}
}
