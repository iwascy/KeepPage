package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

type usageStore struct {
	CredentialsStore
	api       APIAuthRecord
	device    DeviceAuthRecord
	touches   int
	reads     int
	failTouch bool
}

func (s *usageStore) GetAPIAuthRecord(context.Context, string) (APIAuthRecord, error) {
	s.reads++
	return s.api, nil
}
func (s *usageStore) GetDeviceAuthRecord(context.Context, string) (DeviceAuthRecord, error) {
	s.reads++
	return s.device, nil
}
func (s *usageStore) GetUserByID(context.Context, string) (domain.AuthUser, error) {
	return domain.AuthUser{ID: "user"}, nil
}
func (s *usageStore) TouchAPIToken(_ context.Context, _ string, now time.Time) error {
	s.touches++
	if s.failTouch {
		return errors.New("write failed")
	}
	s.api.LastUsedAt = &now
	return nil
}
func (s *usageStore) TouchDevice(_ context.Context, _ string, now time.Time) error {
	s.touches++
	if s.failTouch {
		return errors.New("write failed")
	}
	s.device.LastUsedAt = &now
	return nil
}
func TestUsageWritesThrottledWithoutCachingAuthorization(t *testing.T) {
	for _, kind := range []string{"api", "device"} {
		t.Run(kind, func(t *testing.T) {
			raw := "kp_id.secret"
			if kind == "device" {
				raw = "kpd_id.secret"
			}
			sum := sha256.Sum256([]byte(raw))
			hash := hex.EncodeToString(sum[:])
			store := &usageStore{api: APIAuthRecord{ID: "id", UserID: "user", TokenHash: hash, Scopes: []string{"bookmark:create"}}, device: DeviceAuthRecord{ID: "id", UserID: "user", TokenHash: hash}}
			service := NewService("test-secret", time.Hour, store)
			check := func() error {
				_, err := service.AuthenticateBearer(t.Context(), raw, RequireOptions{AllowAPIToken: true, AllowExtensionDevice: true, RequiredAPIScope: "bookmark:create"})
				return err
			}
			for i := 0; i < 10; i++ {
				if err := check(); err != nil {
					t.Fatal(err)
				}
			}
			if store.touches != 1 || store.reads != 10 {
				t.Fatalf("touches=%d reads=%d", store.touches, store.reads)
			}
			before := time.Now().Add(-6 * time.Minute)
			store.api.LastUsedAt = &before
			store.device.LastUsedAt = &before
			store.failTouch = true
			if err := check(); err != nil {
				t.Fatal(err)
			}
			store.failTouch = false
			if err := check(); err != nil {
				t.Fatal(err)
			}
			if store.touches != 3 {
				t.Fatal("failed usage update was not retried")
			}
			now := time.Now()
			store.api.RevokedAt = &now
			store.device.RevokedAt = &now
			if check() == nil {
				t.Fatal("revocation was cached away")
			}
			if store.touches != 3 {
				t.Fatal("revoked token touched")
			}
		})
	}
}
