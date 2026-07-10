package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"golang.org/x/crypto/scrypt"
)

type contextKey string

const UserContextKey contextKey = "keeppage.user"

var ErrEmailExists = errors.New("email already exists")

type UserLookup interface {
	GetUserByID(ctx context.Context, userID string) (domain.AuthUser, error)
	GetAPIAuthRecord(ctx context.Context, tokenID string) (APIAuthRecord, error)
	GetDeviceAuthRecord(ctx context.Context, deviceID string) (DeviceAuthRecord, error)
	TouchAPIToken(ctx context.Context, tokenID string, usedAt time.Time) error
	TouchDevice(ctx context.Context, deviceID string, usedAt time.Time) error
}

type UserAuthRecord struct {
	User         domain.AuthUser
	PasswordHash string
}

type CredentialsStore interface {
	UserLookup
	FindUserByEmail(ctx context.Context, email string) (*UserAuthRecord, error)
	CreateUser(ctx context.Context, email string, name *string, passwordHash string) (domain.AuthUser, error)
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
	ttl    time.Duration
	users  CredentialsStore
}

type TokenPayload struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Iat   int64  `json:"iat"`
	Exp   int64  `json:"exp"`
}

func NewService(secret string, ttl time.Duration, users CredentialsStore) *Service {
	return &Service{
		secret: []byte(secret),
		ttl:    ttl,
		users:  users,
	}
}

func (s *Service) Register(ctx context.Context, input domain.AuthRegisterRequest) (domain.AuthSession, error) {
	email, name, err := validateRegistration(input)
	if err != nil {
		return domain.AuthSession{}, err
	}
	existing, err := s.users.FindUserByEmail(ctx, email)
	if err != nil {
		return domain.AuthSession{}, err
	}
	if existing != nil {
		return domain.AuthSession{}, httperror.Conflict("EmailAlreadyExists", "该邮箱已注册。")
	}
	passwordHash, err := hashPassword(input.Password)
	if err != nil {
		return domain.AuthSession{}, err
	}
	user, err := s.users.CreateUser(ctx, email, name, passwordHash)
	if err != nil {
		if errors.Is(err, ErrEmailExists) {
			return domain.AuthSession{}, httperror.Conflict("EmailAlreadyExists", "该邮箱已注册。")
		}
		return domain.AuthSession{}, err
	}
	return s.createSession(user), nil
}

func (s *Service) Login(ctx context.Context, input domain.AuthLoginRequest) (domain.AuthSession, error) {
	email := strings.ToLower(strings.TrimSpace(input.Email))
	if email == "" || len(input.Password) == 0 || len(input.Password) > 128 {
		return domain.AuthSession{}, httperror.Unauthorized("InvalidCredentials", "邮箱或密码错误。")
	}
	record, err := s.users.FindUserByEmail(ctx, email)
	if err != nil {
		return domain.AuthSession{}, err
	}
	if record == nil || !verifyPassword(input.Password, record.PasswordHash) {
		return domain.AuthSession{}, httperror.Unauthorized("InvalidCredentials", "邮箱或密码错误。")
	}
	return s.createSession(record.User), nil
}

// VerifyLoginPassword checks the account password without issuing a session.
func (s *Service) VerifyLoginPassword(ctx context.Context, userID string, password string) (bool, error) {
	user, err := s.users.GetUserByID(ctx, userID)
	if err != nil {
		return false, err
	}
	record, err := s.users.FindUserByEmail(ctx, user.Email)
	if err != nil || record == nil {
		return false, err
	}
	return verifyPassword(password, record.PasswordHash), nil
}

func (s *Service) createSession(user domain.AuthUser) domain.AuthSession {
	now := time.Now()
	payload := TokenPayload{
		Sub:   user.ID,
		Email: user.Email,
		Iat:   now.Unix(),
		Exp:   now.Add(s.ttl).Unix(),
	}
	raw, _ := json.Marshal(payload)
	encodedPayload := base64.RawURLEncoding.EncodeToString(raw)
	return domain.AuthSession{Token: encodedPayload + "." + s.sign(encodedPayload), User: user}
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

func validateRegistration(input domain.AuthRegisterRequest) (string, *string, error) {
	email := strings.ToLower(strings.TrimSpace(input.Email))
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email {
		return "", nil, httperror.BadRequest("ValidationError", "email must be a valid email address.", nil)
	}
	if len(input.Password) < 8 || len(input.Password) > 128 {
		return "", nil, httperror.BadRequest("ValidationError", "password must be between 8 and 128 characters.", nil)
	}
	name := strings.TrimSpace(input.Name)
	if len(name) > 120 {
		return "", nil, httperror.BadRequest("ValidationError", "name must be at most 120 characters.", nil)
	}
	if name == "" {
		return email, nil, nil
	}
	return email, &name, nil
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	derived, err := scrypt.Key([]byte(password), salt, 16384, 8, 1, 64)
	if err != nil {
		return "", fmt.Errorf("derive password hash: %w", err)
	}
	return "scrypt$" + base64.RawURLEncoding.EncodeToString(salt) + "$" + base64.RawURLEncoding.EncodeToString(derived), nil
}

func verifyPassword(password string, stored string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 3 || parts[0] != "scrypt" {
		return false
	}
	salt, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	expected, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	actual, err := scrypt.Key([]byte(password), salt, 16384, 8, 1, len(expected))
	if err != nil || len(actual) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func NewUUID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		panic("failed to generate UUID: " + err.Error())
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16])
}
