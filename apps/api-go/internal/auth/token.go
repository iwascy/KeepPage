package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
)

type contextKey string

const UserContextKey contextKey = "keeppage.user"

type UserLookup interface {
	GetUserByID(ctx context.Context, userID string) (domain.AuthUser, error)
	GetAPIAuthRecord(ctx context.Context, tokenID string) (APIAuthRecord, error)
	GetDeviceAuthRecord(ctx context.Context, deviceID string) (DeviceAuthRecord, error)
	TouchAPIToken(ctx context.Context, tokenID string, usedAt time.Time) error
	TouchDevice(ctx context.Context, deviceID string, usedAt time.Time) error
}

type APIAuthRecord struct {
	ID        string
	UserID    string
	TokenHash string
	Scopes    []string
	ExpiresAt *time.Time
	RevokedAt *time.Time
}

type DeviceAuthRecord struct {
	ID        string
	UserID    string
	TokenHash string
	ExpiresAt *time.Time
	RevokedAt *time.Time
}

type Service struct {
	secret []byte
	users  UserLookup
}

type TokenPayload struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Iat   int64  `json:"iat"`
	Exp   int64  `json:"exp"`
}

func NewService(secret string, users UserLookup) *Service {
	return &Service{
		secret: []byte(secret),
		users:  users,
	}
}

func UserFromContext(ctx context.Context) (domain.AuthUser, bool) {
	user, ok := ctx.Value(UserContextKey).(domain.AuthUser)
	return user, ok
}

func ContextWithUser(ctx context.Context, user domain.AuthUser) context.Context {
	return context.WithValue(ctx, UserContextKey, user)
}

func (s *Service) AuthenticateBearer(ctx context.Context, token string, options RequireOptions) (domain.AuthUser, error) {
	if token == "" {
		return domain.AuthUser{}, httperror.Unauthorized("Unauthorized", "请先登录。")
	}
	if options.AllowAPIToken && strings.HasPrefix(token, "kp_") {
		return s.authenticateAPIToken(ctx, token, options.RequiredAPIScope)
	}
	if options.AllowExtensionDevice && strings.HasPrefix(token, "kpd_") {
		return s.authenticateDeviceToken(ctx, token)
	}
	payload, err := s.verifySessionToken(token)
	if err != nil {
		return domain.AuthUser{}, err
	}
	if payload.Exp*1000 <= time.Now().UnixMilli() {
		return domain.AuthUser{}, httperror.Unauthorized("TokenExpired", "登录状态已过期，请重新登录。")
	}
	return s.users.GetUserByID(ctx, payload.Sub)
}

type RequireOptions struct {
	AllowAPIToken        bool
	AllowExtensionDevice bool
	RequiredAPIScope     string
}

func (s *Service) verifySessionToken(token string) (TokenPayload, error) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return TokenPayload{}, httperror.Unauthorized("Unauthorized", "登录令牌格式无效。")
	}
	expected := s.sign(parts[0])
	if subtle.ConstantTimeCompare([]byte(parts[1]), []byte(expected)) != 1 {
		return TokenPayload{}, httperror.Unauthorized("Unauthorized", "登录令牌签名无效。")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return TokenPayload{}, httperror.Unauthorized("Unauthorized", "登录令牌内容无效。")
	}
	var payload TokenPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return TokenPayload{}, httperror.Unauthorized("Unauthorized", "登录令牌内容无效。")
	}
	if payload.Sub == "" || payload.Email == "" || payload.Exp == 0 {
		return TokenPayload{}, httperror.Unauthorized("Unauthorized", "登录令牌内容无效。")
	}
	return payload, nil
}

func (s *Service) sign(encodedPayload string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(encodedPayload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Service) authenticateAPIToken(ctx context.Context, rawToken string, requiredScope string) (domain.AuthUser, error) {
	tokenID, err := parsePrefixedToken(rawToken, "kp_")
	if err != nil {
		return domain.AuthUser{}, httperror.Unauthorized("Unauthorized", "API token 格式无效。")
	}
	record, err := s.users.GetAPIAuthRecord(ctx, tokenID)
	if err != nil {
		return domain.AuthUser{}, err
	}
	if record.RevokedAt != nil {
		return domain.AuthUser{}, httperror.Unauthorized("ApiTokenRevoked", "API token 已被吊销。")
	}
	if record.ExpiresAt != nil && !record.ExpiresAt.After(time.Now()) {
		return domain.AuthUser{}, httperror.Unauthorized("ApiTokenExpired", "API token 已过期。")
	}
	if requiredScope != "" && !hasScope(record.Scopes, requiredScope) {
		return domain.AuthUser{}, httperror.Forbidden("InsufficientScope", "API token 权限不足。")
	}
	if !sha256HexEqual(rawToken, record.TokenHash) {
		return domain.AuthUser{}, httperror.Unauthorized("Unauthorized", "API token 无效。")
	}
	user, err := s.users.GetUserByID(ctx, record.UserID)
	if err != nil {
		return domain.AuthUser{}, err
	}
	_ = s.users.TouchAPIToken(ctx, record.ID, time.Now())
	return user, nil
}

func (s *Service) authenticateDeviceToken(ctx context.Context, rawToken string) (domain.AuthUser, error) {
	deviceID, err := parsePrefixedToken(rawToken, "kpd_")
	if err != nil {
		return domain.AuthUser{}, httperror.Unauthorized("Unauthorized", "扩展设备令牌格式无效。")
	}
	record, err := s.users.GetDeviceAuthRecord(ctx, deviceID)
	if err != nil {
		return domain.AuthUser{}, err
	}
	if record.RevokedAt != nil {
		return domain.AuthUser{}, httperror.Unauthorized("ExtensionDeviceRevoked", "扩展设备授权已撤销。")
	}
	if record.ExpiresAt != nil && !record.ExpiresAt.After(time.Now()) {
		return domain.AuthUser{}, httperror.Unauthorized("ExtensionDeviceExpired", "扩展设备授权已过期。")
	}
	if !sha256HexEqual(rawToken, record.TokenHash) {
		return domain.AuthUser{}, httperror.Unauthorized("Unauthorized", "扩展设备令牌无效。")
	}
	user, err := s.users.GetUserByID(ctx, record.UserID)
	if err != nil {
		return domain.AuthUser{}, err
	}
	_ = s.users.TouchDevice(ctx, record.ID, time.Now())
	return user, nil
}

func parsePrefixedToken(rawToken string, prefix string) (string, error) {
	content := strings.TrimPrefix(rawToken, prefix)
	separatorIndex := strings.Index(content, ".")
	if separatorIndex <= 0 || separatorIndex == len(content)-1 {
		return "", httperror.Unauthorized("Unauthorized", "token 格式无效。")
	}
	return content[:separatorIndex], nil
}

func sha256HexEqual(rawToken string, expectedHash string) bool {
	sum := sha256.Sum256([]byte(rawToken))
	actual := hex.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(actual), []byte(expectedHash)) == 1
}

func hasScope(scopes []string, required string) bool {
	for _, scope := range scopes {
		if scope == required {
			return true
		}
	}
	return false
}
