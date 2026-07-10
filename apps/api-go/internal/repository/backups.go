package repository

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

type BookmarkBackupRepository interface {
	AddRestoredBookmarkVersion(ctx context.Context, userID, bookmarkID string, version domain.BookmarkVersion) (domain.BookmarkVersion, error)
}

func (r *MemoryRepository) AddRestoredBookmarkVersion(_ context.Context, userID, bookmarkID string, version domain.BookmarkVersion) (domain.BookmarkVersion, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	bookmark := r.findMemoryBookmarkByID(userID, bookmarkID)
	if bookmark == nil {
		return domain.BookmarkVersion{}, ErrNotFound
	}
	state := r.captureState()
	version.ID = auth.NewUUID()
	version.BookmarkID = bookmarkID
	version.VersionNo = bookmark.VersionCount + 1
	if version.CreatedAt.IsZero() {
		version.CreatedAt = time.Now().UTC()
	}
	objects := map[string]struct{}{version.HTMLObjectKey: {}}
	if version.ReaderHTMLObjectKey != nil {
		objects[*version.ReaderHTMLObjectKey] = struct{}{}
	}
	for _, media := range version.MediaFiles {
		objects[media.ObjectKey] = struct{}{}
	}
	state.versions[version.HTMLObjectKey] = memoryCaptureVersion{userID: userID, bookmarkID: bookmarkID, versionID: version.ID, hash: version.HTMLSHA256, objectKey: version.HTMLObjectKey, objects: objects, mediaFiles: append([]domain.CaptureMediaFile(nil), version.MediaFiles...)}
	bookmark.LatestVersionID = &version.ID
	bookmark.VersionCount = version.VersionNo
	bookmark.UpdatedAt = time.Now().UTC()
	return version, nil
}

func (r *PostgresRepository) AddRestoredBookmarkVersion(ctx context.Context, userID, bookmarkID string, version domain.BookmarkVersion) (domain.BookmarkVersion, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domain.BookmarkVersion{}, err
	}
	defer tx.Rollback(ctx)
	var versionNo int
	if err = tx.QueryRow(ctx, `select coalesce(max(version_no),0)+1 from bookmark_versions where bookmark_id=$1`, bookmarkID).Scan(&versionNo); err != nil {
		return domain.BookmarkVersion{}, err
	}
	quality, err := json.Marshal(version.Quality)
	if err != nil {
		return domain.BookmarkVersion{}, err
	}
	if version.CreatedAt.IsZero() {
		version.CreatedAt = time.Now().UTC()
	}
	meta, err := json.Marshal(map[string]any{"mediaFiles": version.MediaFiles})
	if err != nil {
		return domain.BookmarkVersion{}, err
	}
	err = tx.QueryRow(ctx, `insert into bookmark_versions (bookmark_id,version_no,html_object_key,reader_html_object_key,html_sha256,text_sha256,text_simhash,capture_profile,quality_score,quality_grade,quality_report_json,quality_reasons_json,source_meta_json,created_at) select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'[]'::jsonb,$12::jsonb,$13 where exists(select 1 from bookmarks where id=$1 and user_id=$14) returning id::text`, bookmarkID, versionNo, version.HTMLObjectKey, version.ReaderHTMLObjectKey, version.HTMLSHA256, version.TextSHA256, version.TextSimhash, version.CaptureProfile, version.Quality.Score, version.Quality.Grade, quality, meta, version.CreatedAt, userID).Scan(&version.ID)
	if err == pgx.ErrNoRows {
		return domain.BookmarkVersion{}, ErrNotFound
	}
	if err != nil {
		return domain.BookmarkVersion{}, err
	}
	if _, err = tx.Exec(ctx, `update bookmarks set latest_version_id=$3,updated_at=now() where id=$1 and user_id=$2`, bookmarkID, userID, version.ID); err != nil {
		return domain.BookmarkVersion{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return domain.BookmarkVersion{}, err
	}
	version.BookmarkID = bookmarkID
	version.VersionNo = versionNo
	return version, nil
}
