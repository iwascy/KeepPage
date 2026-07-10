package repository

import (
	"context"
	"sync"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

type memoryExtensionDevice struct {
	userID    string
	tokenHash string
	item      domain.ExtensionDevice
}

type memoryPrivateExtensionState struct {
	mu      sync.RWMutex
	configs map[string]domain.PrivateModeConfig
	devices map[string]memoryExtensionDevice
}

var memoryPrivateExtensionStates sync.Map // map[*MemoryRepository]*memoryPrivateExtensionState

func memoryPrivateExtensionStateFor(r *MemoryRepository) *memoryPrivateExtensionState {
	state, _ := memoryPrivateExtensionStates.LoadOrStore(r, &memoryPrivateExtensionState{
		configs: map[string]domain.PrivateModeConfig{},
		devices: map[string]memoryExtensionDevice{},
	})
	return state.(*memoryPrivateExtensionState)
}

func (r *MemoryRepository) GetPrivateModeConfig(_ context.Context, userID string) (*domain.PrivateModeConfig, error) {
	state := memoryPrivateExtensionStateFor(r)
	state.mu.RLock()
	defer state.mu.RUnlock()
	config, ok := state.configs[userID]
	if !ok {
		return nil, nil
	}
	return &config, nil
}

func (r *MemoryRepository) EnablePrivateMode(_ context.Context, userID string, passwordHash string, passwordAlgo string) (domain.PrivateModeConfig, error) {
	state := memoryPrivateExtensionStateFor(r)
	state.mu.Lock()
	defer state.mu.Unlock()
	now := time.Now().UTC()
	config, exists := state.configs[userID]
	if !exists {
		config = domain.PrivateModeConfig{UserID: userID, EnabledAt: now}
	}
	config.PasswordHash = passwordHash
	config.PasswordAlgo = passwordAlgo
	config.PasswordUpdatedAt = now
	state.configs[userID] = config
	return config, nil
}

func (r *MemoryRepository) GetPrivateVaultSummary(_ context.Context, userID string) (domain.PrivateVaultSummary, error) {
	state := memoryPrivateExtensionStateFor(r)
	state.mu.RLock()
	_, enabled := state.configs[userID]
	state.mu.RUnlock()
	r.mu.RLock()
	captures := r.captureState()
	bookmarkIDs := map[string]struct{}{}
	var lastUpdatedAt *time.Time
	for _, version := range captures.privateVersions {
		if version.userID != userID {
			continue
		}
		bookmarkIDs[version.bookmarkID] = struct{}{}
		if bookmark, ok := captures.privateBookmarks[version.bookmarkID]; ok && (lastUpdatedAt == nil || bookmark.UpdatedAt.After(*lastUpdatedAt)) {
			updated := bookmark.UpdatedAt
			lastUpdatedAt = &updated
		}
	}
	r.mu.RUnlock()
	return domain.PrivateVaultSummary{
		Enabled:          enabled,
		Unlocked:         false,
		AutoLock:         "browser",
		TotalItems:       len(bookmarkIDs),
		PendingSyncCount: 0,
		SyncEnabled:      true,
		LastUpdatedAt:    lastUpdatedAt,
	}, nil
}

func (r *MemoryRepository) CreateExtensionDevice(_ context.Context, userID string, id string, name string, platform string, tokenPreview string, tokenHash string, expiresAt *time.Time) (domain.ExtensionDevice, error) {
	state := memoryPrivateExtensionStateFor(r)
	state.mu.Lock()
	defer state.mu.Unlock()
	item := domain.ExtensionDevice{ID: id, Name: name, Platform: platform, TokenPreview: tokenPreview, ExpiresAt: expiresAt, CreatedAt: time.Now().UTC()}
	state.devices[id] = memoryExtensionDevice{userID: userID, tokenHash: tokenHash, item: item}
	return item, nil
}

func (r *MemoryRepository) ListExtensionDevices(_ context.Context, userID string) ([]domain.ExtensionDevice, error) {
	state := memoryPrivateExtensionStateFor(r)
	state.mu.RLock()
	defer state.mu.RUnlock()
	items := make([]domain.ExtensionDevice, 0)
	for _, device := range state.devices {
		if device.userID == userID {
			items = append(items, device.item)
		}
	}
	for i := range items {
		for j := i + 1; j < len(items); j++ {
			if items[j].CreatedAt.After(items[i].CreatedAt) {
				items[i], items[j] = items[j], items[i]
			}
		}
	}
	return items, nil
}

func (r *MemoryRepository) RevokeExtensionDevice(_ context.Context, userID string, deviceID string, revokedAt time.Time) (bool, error) {
	state := memoryPrivateExtensionStateFor(r)
	state.mu.Lock()
	defer state.mu.Unlock()
	device, ok := state.devices[deviceID]
	if !ok || device.userID != userID {
		return false, nil
	}
	if device.item.RevokedAt == nil {
		device.item.RevokedAt = &revokedAt
		state.devices[deviceID] = device
	}
	return true, nil
}

// MemoryDeviceAuthRecord and TouchMemoryDevice are used by the existing auth
// repository methods in memory.go, which predate the extension-device port.
func (r *MemoryRepository) MemoryDeviceAuthRecord(deviceID string) (auth.DeviceAuthRecord, error) {
	state := memoryPrivateExtensionStateFor(r)
	state.mu.RLock()
	defer state.mu.RUnlock()
	device, ok := state.devices[deviceID]
	if !ok {
		return auth.DeviceAuthRecord{}, ErrNotFound
	}
	return auth.DeviceAuthRecord{ID: device.item.ID, UserID: device.userID, TokenHash: device.tokenHash, ExpiresAt: device.item.ExpiresAt, RevokedAt: device.item.RevokedAt}, nil
}

func (r *MemoryRepository) TouchMemoryDevice(deviceID string, usedAt time.Time) error {
	state := memoryPrivateExtensionStateFor(r)
	state.mu.Lock()
	defer state.mu.Unlock()
	device, ok := state.devices[deviceID]
	if !ok {
		return nil
	}
	device.item.LastUsedAt = &usedAt
	state.devices[deviceID] = device
	return nil
}
