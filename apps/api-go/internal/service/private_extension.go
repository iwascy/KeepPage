package service

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
	"github.com/keeppage/keeppage/apps/api-go/internal/repository"
	"golang.org/x/crypto/scrypt"
)

const privateModeTokenTTL = 12 * time.Hour
const extensionConnectCodeTTL = 5 * time.Minute

type privateTokenPayload struct {
	Sub               string `json:"sub"`
	Kind              string `json:"kind"`
	PasswordUpdatedAt string `json:"passwordUpdatedAt"`
	Iat               int64  `json:"iat"`
	Exp               int64  `json:"exp"`
}

type PrivateExtensionService struct {
	repository repository.PrivateExtensionRepository
	secret     []byte
}

func NewPrivateExtensionService(repo repository.PrivateExtensionRepository, authTokenSecret string) *PrivateExtensionService {
	return &PrivateExtensionService{repository: repo, secret: []byte(authTokenSecret + ":private-mode")}
}

func (s *PrivateExtensionService) PrivateModeStatus(ctx context.Context, userID string, token string) (domain.PrivateVaultSummary, error) {
	summary, err := s.repository.GetPrivateVaultSummary(ctx, userID)
	if err != nil {
		return domain.PrivateVaultSummary{}, err
	}
	summary.Unlocked = token != "" && s.privateTokenValid(ctx, token, userID)
	return summary, nil
}

// RequirePrivateModeUnlocked is shared by private capture and bookmark routes.
func (s *PrivateExtensionService) RequirePrivateModeUnlocked(ctx context.Context, userID string, token string) error {
	if token == "" || !s.privateTokenValid(ctx, token, userID) {
		return httperror.Unauthorized("PrivateModeLocked", "请先输入私密模式密码。")
	}
	return nil
}

func (s *PrivateExtensionService) SetupPrivateMode(ctx context.Context, userID string, password string) (domain.PrivateModeUnlockResponse, error) {
	if err := validatePassword(password, 8); err != nil {
		return domain.PrivateModeUnlockResponse{}, err
	}
	hash, err := hashPrivatePassword(password)
	if err != nil {
		return domain.PrivateModeUnlockResponse{}, err
	}
	if _, err := s.repository.EnablePrivateMode(ctx, userID, hash, "scrypt"); err != nil {
		return domain.PrivateModeUnlockResponse{}, err
	}
	return s.createUnlockResponse(ctx, userID)
}

func (s *PrivateExtensionService) UnlockPrivateMode(ctx context.Context, userID string, password string) (domain.PrivateModeUnlockResponse, error) {
	if err := validatePassword(password, 1); err != nil {
		return domain.PrivateModeUnlockResponse{}, err
	}
	config, err := s.repository.GetPrivateModeConfig(ctx, userID)
	if err != nil {
		return domain.PrivateModeUnlockResponse{}, err
	}
	if config == nil {
		return domain.PrivateModeUnlockResponse{}, httperror.NotFound("PrivateModeNotEnabled", "请先启用私密模式。")
	}
	if !verifyPrivatePassword(password, config.PasswordHash) {
		return domain.PrivateModeUnlockResponse{}, httperror.Unauthorized("PrivateModeInvalidPassword", "私密模式密码错误。")
	}
	return s.createUnlockResponse(ctx, userID)
}

func (s *PrivateExtensionService) ChangePrivateModePassword(ctx context.Context, userID string, password string) (domain.PrivateModeUnlockResponse, error) {
	if err := validatePassword(password, 8); err != nil {
		return domain.PrivateModeUnlockResponse{}, err
	}
	config, err := s.repository.GetPrivateModeConfig(ctx, userID)
	if err != nil {
		return domain.PrivateModeUnlockResponse{}, err
	}
	if config == nil {
		return domain.PrivateModeUnlockResponse{}, httperror.NotFound("PrivateModeNotEnabled", "请先启用私密模式。")
	}
	hash, err := hashPrivatePassword(password)
	if err != nil {
		return domain.PrivateModeUnlockResponse{}, err
	}
	if _, err := s.repository.EnablePrivateMode(ctx, userID, hash, "scrypt"); err != nil {
		return domain.PrivateModeUnlockResponse{}, err
	}
	return s.createUnlockResponse(ctx, userID)
}

func (s *PrivateExtensionService) CreateExtensionConnectCode(ctx context.Context, userID string, input domain.ExtensionConnectInitRequest) (domain.ExtensionConnectInitResponse, error) {
	name := strings.TrimSpace(input.DeviceName)
	platform := strings.TrimSpace(input.Platform)
	if name == "" || utf8.RuneCountInString(name) > 120 || platform == "" || utf8.RuneCountInString(platform) > 80 || (input.ExtensionID != "" && utf8.RuneCountInString(strings.TrimSpace(input.ExtensionID)) > 120) {
		return domain.ExtensionConnectInitResponse{}, httperror.BadRequest("ValidationError", "Invalid extension device request.", nil)
	}
	code, err := randomURLToken(32)
	if err != nil {
		return domain.ExtensionConnectInitResponse{}, err
	}
	expiresAt := time.Now().UTC().Add(extensionConnectCodeTTL)
	if err := s.repository.SaveExtensionConnectCode(ctx, repository.ExtensionConnectCode{
		Code:        code,
		UserID:      userID,
		DeviceName:  name,
		Platform:    platform,
		ExtensionID: strings.TrimSpace(input.ExtensionID),
		ExpiresAt:   expiresAt,
	}); err != nil {
		return domain.ExtensionConnectInitResponse{}, err
	}
	return domain.ExtensionConnectInitResponse{Code: code, ExpiresAt: expiresAt}, nil
}

func (s *PrivateExtensionService) RedeemExtensionConnectCode(ctx context.Context, code string) (domain.ExtensionDeviceSession, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return domain.ExtensionDeviceSession{}, httperror.BadRequest("ValidationError", "Invalid extension connection code.", nil)
	}
	pending, err := s.repository.TakeExtensionConnectCode(ctx, code)
	if err != nil {
		return domain.ExtensionDeviceSession{}, err
	}
	if pending == nil {
		return domain.ExtensionDeviceSession{}, httperror.Unauthorized("ExtensionConnectCodeInvalid", "扩展连接码无效、已使用或已过期。")
	}
	user, err := s.repository.GetUserByID(ctx, pending.UserID)
	if err != nil {
		if err == repository.ErrNotFound {
			return domain.ExtensionDeviceSession{}, httperror.Unauthorized("Unauthorized", "连接码对应账号不存在。")
		}
		return domain.ExtensionDeviceSession{}, err
	}
	deviceID := auth.NewUUID()
	secret, err := randomURLToken(32)
	if err != nil {
		return domain.ExtensionDeviceSession{}, err
	}
	token := "kpd_" + deviceID + "." + secret
	device, err := s.repository.CreateExtensionDevice(ctx, user.ID, deviceID, pending.DeviceName, pending.Platform, deviceTokenPreview(deviceID, secret), sha256Hex(token), nil)
	if err != nil {
		return domain.ExtensionDeviceSession{}, err
	}
	return domain.ExtensionDeviceSession{Token: token, Device: device, User: user}, nil
}

func (s *PrivateExtensionService) ListExtensionDevices(ctx context.Context, userID string) ([]domain.ExtensionDevice, error) {
	return s.repository.ListExtensionDevices(ctx, userID)
}

func (s *PrivateExtensionService) RevokeExtensionDevice(ctx context.Context, userID string, deviceID string) (bool, error) {
	return s.repository.RevokeExtensionDevice(ctx, userID, deviceID, time.Now().UTC())
}

func (s *PrivateExtensionService) createUnlockResponse(ctx context.Context, userID string) (domain.PrivateModeUnlockResponse, error) {
	config, err := s.repository.GetPrivateModeConfig(ctx, userID)
	if err != nil {
		return domain.PrivateModeUnlockResponse{}, err
	}
	if config == nil {
		return domain.PrivateModeUnlockResponse{}, httperror.NotFound("PrivateModeNotEnabled", "请先启用私密模式。")
	}
	token, err := s.createPrivateToken(userID, config.PasswordUpdatedAt)
	if err != nil {
		return domain.PrivateModeUnlockResponse{}, err
	}
	summary, err := s.PrivateModeStatus(ctx, userID, token)
	if err != nil {
		return domain.PrivateModeUnlockResponse{}, err
	}
	return domain.PrivateModeUnlockResponse{Summary: summary, PrivateToken: token}, nil
}

func (s *PrivateExtensionService) createPrivateToken(userID string, passwordUpdatedAt time.Time) (string, error) {
	now := time.Now()
	payload, err := json.Marshal(privateTokenPayload{Sub: userID, Kind: "private-mode", PasswordUpdatedAt: passwordUpdatedAt.UTC().Format(time.RFC3339Nano), Iat: now.Unix(), Exp: now.Add(privateModeTokenTTL).Unix()})
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	return encoded + "." + s.signPrivateToken(encoded), nil
}

func (s *PrivateExtensionService) privateTokenValid(ctx context.Context, token string, userID string) bool {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" || subtle.ConstantTimeCompare([]byte(parts[1]), []byte(s.signPrivateToken(parts[0]))) != 1 {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	var payload privateTokenPayload
	if json.Unmarshal(raw, &payload) != nil || payload.Sub != userID || payload.Kind != "private-mode" || payload.Exp <= time.Now().Unix() {
		return false
	}
	config, err := s.repository.GetPrivateModeConfig(ctx, userID)
	return err == nil && config != nil && hmac.Equal([]byte(payload.PasswordUpdatedAt), []byte(config.PasswordUpdatedAt.UTC().Format(time.RFC3339Nano)))
}

func (s *PrivateExtensionService) signPrivateToken(encodedPayload string) string {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(encodedPayload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func validatePassword(password string, min int) error {
	length := utf8.RuneCountInString(password)
	if length < min || length > 128 {
		return httperror.BadRequest("ValidationError", fmt.Sprintf("password must be between %d and 128 characters.", min), nil)
	}
	return nil
}

func hashPrivatePassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	derived, err := scrypt.Key([]byte(password), salt, 16384, 8, 1, 64)
	if err != nil {
		return "", err
	}
	return "scrypt$" + base64.RawURLEncoding.EncodeToString(salt) + "$" + base64.RawURLEncoding.EncodeToString(derived), nil
}

func verifyPrivatePassword(password string, storedHash string) bool {
	parts := strings.Split(storedHash, "$")
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
	return err == nil && subtle.ConstantTimeCompare(actual, expected) == 1
}

func randomURLToken(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func deviceTokenPreview(deviceID string, secret string) string {
	return "kpd_" + deviceID[:8] + "." + secret[:6]
}
