package repository

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
)

func missingSession() error {
	return httperror.Unauthorized("SessionExpired", "登录状态已失效，请重新登录。")
}

func (r *MemoryRepository) CreateRefreshSession(_ context.Context, record auth.RefreshSession) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, old := range r.refreshSessions {
		if !old.ExpiresAt.After(time.Now()) {
			delete(r.refreshSessions, id)
		}
	}
	r.refreshSessions[record.ID] = record
	return nil
}
func (r *MemoryRepository) GetRefreshSession(_ context.Context, id string) (auth.RefreshSession, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	record, ok := r.refreshSessions[id]
	if !ok {
		return record, missingSession()
	}
	return record, nil
}
func (r *MemoryRepository) RotateRefreshSession(_ context.Context, id, hash, nextHash string, now time.Time) (auth.RefreshSession, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	record, ok := r.refreshSessions[id]
	if !ok {
		return record, missingSession()
	}
	record, err := auth.RotateRefreshRecord(record, hash, nextHash, now)
	r.refreshSessions[id] = record
	return record, err
}
func (r *MemoryRepository) RevokeRefreshSession(_ context.Context, id string, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if record, ok := r.refreshSessions[id]; ok {
		record.RevokedAt = &now
		r.refreshSessions[id] = record
	}
	return nil
}

func (r *PostgresRepository) CreateRefreshSession(ctx context.Context, record auth.RefreshSession) error {
	_, err := r.pool.Exec(ctx, `insert into auth_refresh_sessions (id,user_id,generation,token_hash,previous_hash,rotated_at,expires_at) values ($1,$2,$3,$4,$5,$6,$7)`, record.ID, record.UserID, record.Generation, record.TokenHash, record.PreviousHash, record.RotatedAt, record.ExpiresAt)
	if err == nil {
		_, _ = r.pool.Exec(ctx, `delete from auth_refresh_sessions where expires_at <= now()`)
	}
	return err
}

const refreshColumns = `id::text,user_id::text,generation,token_hash,previous_hash,rotated_at,expires_at,revoked_at`

func scanRefresh(row pgx.Row) (auth.RefreshSession, error) {
	var record auth.RefreshSession
	err := row.Scan(&record.ID, &record.UserID, &record.Generation, &record.TokenHash, &record.PreviousHash, &record.RotatedAt, &record.ExpiresAt, &record.RevokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		err = missingSession()
	}
	return record, err
}
func (r *PostgresRepository) GetRefreshSession(ctx context.Context, id string) (auth.RefreshSession, error) {
	return scanRefresh(r.pool.QueryRow(ctx, `select `+refreshColumns+` from auth_refresh_sessions where id=$1`, id))
}
func (r *PostgresRepository) RotateRefreshSession(ctx context.Context, id, hash, nextHash string, now time.Time) (auth.RefreshSession, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return auth.RefreshSession{}, err
	}
	defer tx.Rollback(ctx)
	record, err := scanRefresh(tx.QueryRow(ctx, `select `+refreshColumns+` from auth_refresh_sessions where id=$1 for update`, id))
	if err != nil {
		return record, err
	}
	record, rotateErr := auth.RotateRefreshRecord(record, hash, nextHash, now)
	_, err = tx.Exec(ctx, `update auth_refresh_sessions set generation=$2,token_hash=$3,previous_hash=$4,rotated_at=$5,revoked_at=$6 where id=$1`, id, record.Generation, record.TokenHash, record.PreviousHash, record.RotatedAt, record.RevokedAt)
	if err != nil {
		return record, err
	}
	if err = tx.Commit(ctx); err != nil {
		return record, err
	}
	return record, rotateErr
}
func (r *PostgresRepository) RevokeRefreshSession(ctx context.Context, id string, now time.Time) error {
	_, err := r.pool.Exec(ctx, `update auth_refresh_sessions set revoked_at=$2 where id=$1 and revoked_at is null`, id, now)
	return err
}
