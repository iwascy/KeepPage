package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
)

const RefreshGracePeriod = 30 * time.Second

type RefreshSession struct {
	ID           string
	UserID       string
	Generation   int64
	TokenHash    string
	PreviousHash string
	RotatedAt    time.Time
	ExpiresAt    time.Time
	RevokedAt    *time.Time
}

type RefreshStore interface {
	CreateRefreshSession(context.Context, RefreshSession) error
	GetRefreshSession(context.Context, string) (RefreshSession, error)
	RotateRefreshSession(context.Context, string, string, string, time.Time) (RefreshSession, error)
	RevokeRefreshSession(context.Context, string, time.Time) error
}

func invalidSession() error {
	return httperror.Unauthorized("SessionExpired", "登录状态已失效，请重新登录。")
}

// RotateRefreshRecord is called under the repository's row lock / mutex.
// A short grace period returns the same successor for retries and concurrent tabs.
func RotateRefreshRecord(record RefreshSession, hash, nextHash string, now time.Time) (RefreshSession, error) {
	if record.RevokedAt != nil || !record.ExpiresAt.After(now) {
		return record, invalidSession()
	}
	if subtle.ConstantTimeCompare([]byte(hash), []byte(record.TokenHash)) == 1 {
		record.PreviousHash = record.TokenHash
		record.TokenHash = nextHash
		record.Generation++
		record.RotatedAt = now
		return record, nil
	}
	if record.PreviousHash != "" && subtle.ConstantTimeCompare([]byte(hash), []byte(record.PreviousHash)) == 1 && now.Before(record.RotatedAt.Add(RefreshGracePeriod)) {
		return record, nil
	}
	// A correctly signed but superseded credential is a replay. Revoke the family.
	record.RevokedAt = &now
	return record, invalidSession()
}

func (s *Service) refreshToken(id string, generation int64) string {
	value := "kpr_" + id + "." + strconv.FormatInt(generation, 10)
	return value + "." + s.sign("refresh:"+value)
}

func refreshHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *Service) parseRefresh(token string) (string, int64, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || !strings.HasPrefix(parts[0], "kpr_") {
		return "", 0, invalidSession()
	}
	id := strings.TrimPrefix(parts[0], "kpr_")
	generation, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || generation < 0 || len(id) != 36 || subtle.ConstantTimeCompare([]byte(token), []byte(s.refreshToken(id, generation))) != 1 {
		return "", 0, invalidSession()
	}
	return id, generation, nil
}

func (s *Service) browserSession(user domain.AuthUser, record RefreshSession, accessTTL time.Duration) domain.AuthSession {
	now := time.Now()
	expires := now.Add(accessTTL)
	if expires.After(record.ExpiresAt) {
		expires = record.ExpiresAt
	}
	raw, _ := json.Marshal(TokenPayload{Sub: user.ID, Email: user.Email, Iat: now.Unix(), Exp: expires.Unix(), SessionID: record.ID})
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	return domain.AuthSession{Token: encoded + "." + s.sign(encoded), User: user}
}

func (s *Service) NewBrowserSession(ctx context.Context, user domain.AuthUser, accessTTL, refreshTTL time.Duration) (domain.AuthSession, string, time.Time, error) {
	now := time.Now().UTC()
	record := RefreshSession{ID: NewUUID(), UserID: user.ID, RotatedAt: now, ExpiresAt: now.Add(refreshTTL)}
	token := s.refreshToken(record.ID, 0)
	record.TokenHash = refreshHash(token)
	if err := s.users.(RefreshStore).CreateRefreshSession(ctx, record); err != nil {
		return domain.AuthSession{}, "", time.Time{}, err
	}
	return s.browserSession(user, record, accessTTL), token, record.ExpiresAt, nil
}

func (s *Service) RefreshBrowserSession(ctx context.Context, token string, accessTTL time.Duration) (domain.AuthSession, string, time.Time, error) {
	id, generation, err := s.parseRefresh(token)
	if err != nil {
		return domain.AuthSession{}, "", time.Time{}, err
	}
	record, err := s.users.(RefreshStore).RotateRefreshSession(ctx, id, refreshHash(token), refreshHash(s.refreshToken(id, generation+1)), time.Now().UTC())
	if err != nil {
		return domain.AuthSession{}, "", time.Time{}, err
	}
	user, err := s.users.GetUserByID(ctx, record.UserID)
	if err != nil {
		return domain.AuthSession{}, "", time.Time{}, err
	}
	return s.browserSession(user, record, accessTTL), s.refreshToken(id, record.Generation), record.ExpiresAt, nil
}

func (s *Service) RevokeBrowserSession(ctx context.Context, token string) error {
	id, _, err := s.parseRefresh(token)
	if err != nil {
		return nil
	}
	return s.users.(RefreshStore).RevokeRefreshSession(ctx, id, time.Now().UTC())
}
