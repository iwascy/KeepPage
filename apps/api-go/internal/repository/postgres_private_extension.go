package repository

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

func (r *PostgresRepository) GetPrivateModeConfig(ctx context.Context, userID string) (*domain.PrivateModeConfig, error) {
	var config domain.PrivateModeConfig
	err := r.pool.QueryRow(ctx, `
		select user_id::text, password_hash, password_algo, enabled_at, password_updated_at
		from private_mode_configs where user_id = $1 limit 1
	`, userID).Scan(&config.UserID, &config.PasswordHash, &config.PasswordAlgo, &config.EnabledAt, &config.PasswordUpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &config, nil
}

func (r *PostgresRepository) EnablePrivateMode(ctx context.Context, userID string, passwordHash string, passwordAlgo string) (domain.PrivateModeConfig, error) {
	var config domain.PrivateModeConfig
	err := r.pool.QueryRow(ctx, `
		insert into private_mode_configs (user_id, password_hash, password_algo)
		values ($1, $2, $3)
		on conflict (user_id) do update set
			password_hash = excluded.password_hash,
			password_algo = excluded.password_algo,
			password_updated_at = now()
		returning user_id::text, password_hash, password_algo, enabled_at, password_updated_at
	`, userID, passwordHash, passwordAlgo).Scan(&config.UserID, &config.PasswordHash, &config.PasswordAlgo, &config.EnabledAt, &config.PasswordUpdatedAt)
	return config, err
}

func (r *PostgresRepository) GetPrivateVaultSummary(ctx context.Context, userID string) (domain.PrivateVaultSummary, error) {
	config, err := r.GetPrivateModeConfig(ctx, userID)
	if err != nil {
		return domain.PrivateVaultSummary{}, err
	}
	if config == nil {
		return domain.PrivateVaultSummary{Enabled: false, Unlocked: false, AutoLock: "browser", TotalItems: 0, PendingSyncCount: 0, SyncEnabled: true}, nil
	}
	var totalItems, pendingSyncCount int
	var lastUpdatedAt *time.Time
	err = r.pool.QueryRow(ctx, `
		select
			(select count(*)::int from private_bookmarks where user_id = $1),
			(select count(*)::int from private_capture_uploads where user_id = $1),
			(select max(updated_at) from private_bookmarks where user_id = $1)
	`, userID).Scan(&totalItems, &pendingSyncCount, &lastUpdatedAt)
	if err != nil {
		return domain.PrivateVaultSummary{}, err
	}
	return domain.PrivateVaultSummary{Enabled: true, Unlocked: false, AutoLock: "browser", TotalItems: totalItems, PendingSyncCount: pendingSyncCount, SyncEnabled: true, LastUpdatedAt: lastUpdatedAt}, nil
}

func (r *PostgresRepository) CreateExtensionDevice(ctx context.Context, userID string, id string, name string, platform string, tokenPreview string, tokenHash string, expiresAt *time.Time) (domain.ExtensionDevice, error) {
	var item domain.ExtensionDevice
	err := r.pool.QueryRow(ctx, `
		insert into devices (id, user_id, label, platform, token_preview, token_hash, expires_at)
		values ($1, $2, $3, $4, $5, $6, $7)
		returning id::text, label, platform, token_preview, last_used_at, expires_at, revoked_at, created_at
	`, id, userID, name, platform, tokenPreview, tokenHash, expiresAt).Scan(&item.ID, &item.Name, &item.Platform, &item.TokenPreview, &item.LastUsedAt, &item.ExpiresAt, &item.RevokedAt, &item.CreatedAt)
	return item, err
}

func (r *PostgresRepository) ListExtensionDevices(ctx context.Context, userID string) ([]domain.ExtensionDevice, error) {
	rows, err := r.pool.Query(ctx, `
		select id::text, label, platform, token_preview, last_used_at, expires_at, revoked_at, created_at
		from devices where user_id = $1 and token_preview is not null order by created_at desc
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.ExtensionDevice{}
	for rows.Next() {
		var item domain.ExtensionDevice
		if err := rows.Scan(&item.ID, &item.Name, &item.Platform, &item.TokenPreview, &item.LastUsedAt, &item.ExpiresAt, &item.RevokedAt, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepository) RevokeExtensionDevice(ctx context.Context, userID string, deviceID string, revokedAt time.Time) (bool, error) {
	command, err := r.pool.Exec(ctx, `
		update devices set revoked_at = coalesce(revoked_at, $3)
		where id = $1 and user_id = $2 and token_preview is not null
	`, deviceID, userID, revokedAt)
	return command.RowsAffected() > 0, err
}
