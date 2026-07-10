package domain

import "time"

// PrivateVaultSummary describes the current user's private vault without exposing its contents.
type PrivateVaultSummary struct {
	Enabled          bool       `json:"enabled"`
	Unlocked         bool       `json:"unlocked"`
	AutoLock         string     `json:"autoLock"`
	TotalItems       int        `json:"totalItems"`
	PendingSyncCount int        `json:"pendingSyncCount"`
	SyncEnabled      bool       `json:"syncEnabled"`
	LastUpdatedAt    *time.Time `json:"lastUpdatedAt,omitempty"`
}

type PrivateModeSetupRequest struct {
	Password string `json:"password"`
}

type PrivateModeUnlockRequest struct {
	Password string `json:"password"`
}

type PrivateModePasswordChangeRequest struct {
	LoginPassword string `json:"loginPassword"`
	NewPassword   string `json:"newPassword"`
}

type PrivateModeUnlockResponse struct {
	Summary      PrivateVaultSummary `json:"summary"`
	PrivateToken string              `json:"privateToken"`
}

type PrivateModeConfig struct {
	UserID            string
	PasswordHash      string
	PasswordAlgo      string
	EnabledAt         time.Time
	PasswordUpdatedAt time.Time
}

type ExtensionDevice struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Platform     string     `json:"platform"`
	TokenPreview string     `json:"tokenPreview"`
	LastUsedAt   *time.Time `json:"lastUsedAt,omitempty"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
	RevokedAt    *time.Time `json:"revokedAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
}

type ExtensionConnectInitRequest struct {
	DeviceName  string `json:"deviceName"`
	Platform    string `json:"platform"`
	ExtensionID string `json:"extensionId,omitempty"`
}

type ExtensionConnectInitResponse struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type ExtensionConnectRedeemRequest struct {
	Code string `json:"code"`
}

type ExtensionDeviceListResponse struct {
	Items []ExtensionDevice `json:"items"`
}

type ExtensionDeviceSession struct {
	Token  string          `json:"token"`
	Device ExtensionDevice `json:"device"`
	User   AuthUser        `json:"user"`
}
