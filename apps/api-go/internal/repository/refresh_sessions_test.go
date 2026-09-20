package repository

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/migrations"
)

func TestRefreshStoresAndUsageThrottling(t *testing.T) {
	t.Run("memory", func(t *testing.T) { testRefreshStore(t, NewMemoryRepository()) })
	t.Run("postgres", func(t *testing.T) {
		databaseURL := os.Getenv("KEEPPAGE_AUTH_TEST_DATABASE_URL")
		if databaseURL == "" {
			t.Skip("set KEEPPAGE_AUTH_TEST_DATABASE_URL to a disposable database")
		}
		if err := migrations.EnsureDatabase(t.Context(), databaseURL); err != nil {
			t.Fatal(err)
		}
		if err := migrations.Apply(t.Context(), databaseURL); err != nil {
			t.Fatal(err)
		}
		repo, err := NewPostgresRepository(t.Context(), databaseURL)
		if err != nil {
			t.Fatal(err)
		}
		defer repo.Close()
		testRefreshStore(t, repo)
	})
}
func testRefreshStore(t *testing.T, repo Repository) {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	user, err := repo.CreateUser(ctx, auth.NewUUID()+"@test.local", nil, "test-password-hash")
	if err != nil {
		t.Fatal(err)
	}
	if pg, ok := repo.(*PostgresRepository); ok {
		defer pg.pool.Exec(ctx, `delete from users where id=$1`, user.ID)
	}
	store := repo.(auth.RefreshStore)
	record := auth.RefreshSession{ID: auth.NewUUID(), UserID: user.ID, TokenHash: "original", RotatedAt: now, ExpiresAt: now.Add(time.Hour)}
	if err := store.CreateRefreshSession(ctx, record); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rotated, err := store.RotateRefreshSession(ctx, record.ID, "original", "successor", now)
			if err != nil || rotated.Generation != 1 || rotated.TokenHash != "successor" {
				t.Errorf("concurrent rotate failed: %+v %v", rotated, err)
			}
		}()
	}
	wg.Wait()
	rotated, err := store.GetRefreshSession(ctx, record.ID)
	if err != nil || !rotated.ExpiresAt.Equal(record.ExpiresAt) {
		t.Fatalf("expiry changed: %+v %v", rotated, err)
	}
	if _, err := store.RotateRefreshSession(ctx, record.ID, "original", "successor", now.Add(time.Minute)); err == nil {
		t.Fatal("replay accepted beyond grace")
	}
	if _, err := store.RotateRefreshSession(ctx, record.ID, "successor", "next", now.Add(time.Minute)); err == nil {
		t.Fatal("replay family was not revoked")
	}
	record.ID = auth.NewUUID()
	if err := store.CreateRefreshSession(ctx, record); err != nil {
		t.Fatal(err)
	}
	if err := store.RevokeRefreshSession(ctx, record.ID, now); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RotateRefreshSession(ctx, record.ID, "original", "successor", now); err == nil {
		t.Fatal("revoked refresh accepted")
	}
	record.ID = auth.NewUUID()
	record.ExpiresAt = now.Add(-time.Second)
	store.CreateRefreshSession(ctx, record)
	if _, err := store.RotateRefreshSession(ctx, record.ID, "original", "successor", now); err == nil {
		t.Fatal("expired refresh accepted")
	}
	// The conditional update prevents concurrent instances from writing each request.
	apiToken, err := repo.CreateAPIToken(ctx, user.ID, auth.NewUUID(), "test", "test", "hash", []string{"bookmark:create"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	privateRepo := repo.(PrivateExtensionRepository)
	device, err := privateRepo.CreateExtensionDevice(ctx, user.ID, auth.NewUUID(), "test", "test", "test", "hash", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"api", "device"} {
		touch := func(at time.Time) error {
			if kind == "api" {
				return repo.TouchAPIToken(ctx, apiToken.ID, at)
			}
			return repo.TouchDevice(ctx, device.ID, at)
		}
		read := func() *time.Time {
			if kind == "api" {
				value, err := repo.GetAPIAuthRecord(ctx, apiToken.ID)
				if err != nil {
					t.Fatal(err)
				}
				return value.LastUsedAt
			}
			value, err := repo.GetDeviceAuthRecord(ctx, device.ID)
			if err != nil {
				t.Fatal(err)
			}
			return value.LastUsedAt
		}
		for _, delta := range []time.Duration{0, time.Second, time.Minute, 4 * time.Minute} {
			if err := touch(now.Add(delta)); err != nil {
				t.Fatal(err)
			}
		}
		if last := read(); last == nil || !last.Equal(now) {
			t.Fatalf("%s wrote inside interval: %v", kind, last)
		}
		later := now.Add(5 * time.Minute)
		if err := touch(later); err != nil {
			t.Fatal(err)
		}
		if last := read(); last == nil || !last.Equal(later) {
			t.Fatalf("%s failed to update after interval: %v", kind, last)
		}
	}
	// Revocation fields are still read without a cached authorization result.
	if _, err := repo.RevokeAPIToken(ctx, user.ID, apiToken.ID, now); err != nil {
		t.Fatal(err)
	}
	if value, err := repo.GetAPIAuthRecord(ctx, apiToken.ID); err != nil || value.RevokedAt == nil {
		t.Fatal("missing revocation")
	}
}
