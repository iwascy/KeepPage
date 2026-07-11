package repository

import (
	"context"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

// ExtensionConnectCode is a short-lived pending extension pairing request.
type ExtensionConnectCode struct {
	Code        string
	UserID      string
	DeviceName  string
	Platform    string
	ExtensionID string
	ExpiresAt   time.Time
}

// PrivateExtensionRepository is deliberately separate from Repository while the
// remaining Go routes are being ported. HTTP handlers assert this capability.
type PrivateExtensionRepository interface {
	GetUserByID(ctx context.Context, userID string) (domain.AuthUser, error)
	GetPrivateModeConfig(ctx context.Context, userID string) (*domain.PrivateModeConfig, error)
	EnablePrivateMode(ctx context.Context, userID string, passwordHash string, passwordAlgo string) (domain.PrivateModeConfig, error)
	GetPrivateVaultSummary(ctx context.Context, userID string) (domain.PrivateVaultSummary, error)
	CreateExtensionDevice(ctx context.Context, userID string, id string, name string, platform string, tokenPreview string, tokenHash string, expiresAt *time.Time) (domain.ExtensionDevice, error)
	ListExtensionDevices(ctx context.Context, userID string) ([]domain.ExtensionDevice, error)
	RevokeExtensionDevice(ctx context.Context, userID string, deviceID string, revokedAt time.Time) (bool, error)
	SaveExtensionConnectCode(ctx context.Context, code ExtensionConnectCode) error
	TakeExtensionConnectCode(ctx context.Context, code string) (*ExtensionConnectCode, error)
}
