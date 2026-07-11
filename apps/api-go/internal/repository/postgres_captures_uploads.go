package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
)

func (r *PostgresRepository) InitCapture(ctx context.Context, userID string, input domain.CaptureInitRequest) (domain.CaptureInitResponse, error) {
	return r.initPostgresCapture(ctx, userID, input, false)
}
func (r *PostgresRepository) InitPrivateCapture(ctx context.Context, userID string, input domain.CaptureInitRequest) (domain.CaptureInitResponse, error) {
	return r.initPostgresCapture(ctx, userID, input, true)
}

func (r *PostgresRepository) initPostgresCapture(ctx context.Context, userID string, input domain.CaptureInitRequest, private bool) (domain.CaptureInitResponse, error) {
	normalized, err := normalizeSourceURL(input.URL)
	if err != nil {
		return domain.CaptureInitResponse{}, httperror.BadRequest("ValidationError", "url must be a valid URL.", nil)
	}
	hash := hashNormalizedURL(normalized)
	uploadTable, bookmarkTable, versionTable, prefix := "capture_uploads", "bookmarks", "bookmark_versions", "captures/"
	if private {
		uploadTable, bookmarkTable, versionTable, prefix = "private_capture_uploads", "private_bookmarks", "private_bookmark_versions", "private-captures/"
	}
	var bookmarkID, versionID, objectKey string
	err = r.pool.QueryRow(ctx, fmt.Sprintf(`select b.id::text, v.id::text, v.html_object_key from %s b join %s v on v.bookmark_id=b.id where b.user_id=$1 and b.normalized_url_hash=$2 and v.html_sha256=$3 limit 1`, bookmarkTable, versionTable), userID, hash, input.HTMLSHA256).Scan(&bookmarkID, &versionID, &objectKey)
	if err == nil {
		return domain.CaptureInitResponse{AlreadyExists: true, BookmarkID: &bookmarkID, VersionID: &versionID, ObjectKey: objectKey}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return domain.CaptureInitResponse{}, err
	}
	err = r.pool.QueryRow(ctx, fmt.Sprintf(`select object_key from %s where user_id=$1 and normalized_url_hash=$2 and html_sha256=$3 order by created_at desc limit 1`, uploadTable), userID, hash, input.HTMLSHA256).Scan(&objectKey)
	if err == nil {
		return domain.CaptureInitResponse{ObjectKey: objectKey}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return domain.CaptureInitResponse{}, err
	}
	objectKey = fmt.Sprintf("%s%s/%s.html", prefix, userID, auth.NewUUID())
	_, err = r.pool.Exec(ctx, fmt.Sprintf(`insert into %s (object_key,user_id,normalized_url_hash,source_url,title,html_sha256,file_size,capture_profile,device_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (user_id,normalized_url_hash,html_sha256) do nothing`, uploadTable), objectKey, userID, hash, normalized, input.Title, input.HTMLSHA256, input.FileSize, input.Profile, input.DeviceID)
	if err != nil {
		return domain.CaptureInitResponse{}, err
	}
	err = r.pool.QueryRow(ctx, fmt.Sprintf(`select object_key from %s where user_id=$1 and normalized_url_hash=$2 and html_sha256=$3 order by created_at desc limit 1`, uploadTable), userID, hash, input.HTMLSHA256).Scan(&objectKey)
	if err != nil {
		return domain.CaptureInitResponse{}, err
	}
	return domain.CaptureInitResponse{ObjectKey: objectKey}, nil
}

func (r *PostgresRepository) CompleteCapture(ctx context.Context, userID string, input domain.CaptureCompleteRequest) (domain.CaptureCompleteResult, error) {
	return r.completePostgresCapture(ctx, userID, input, false)
}
func (r *PostgresRepository) CompletePrivateCapture(ctx context.Context, userID string, input domain.CaptureCompleteRequest) (domain.CaptureCompleteResult, error) {
	return r.completePostgresCapture(ctx, userID, input, true)
}

func (r *PostgresRepository) completePostgresCapture(ctx context.Context, userID string, input domain.CaptureCompleteRequest, private bool) (domain.CaptureCompleteResult, error) {
	normalized, err := normalizeSourceURL(input.Source.URL)
	if err != nil {
		return domain.CaptureCompleteResult{}, httperror.BadRequest("ValidationError", "source.url must be a valid URL.", nil)
	}
	uploadTable, bookmarkTable, versionTable := "capture_uploads", "bookmarks", "bookmark_versions"
	if private {
		uploadTable, bookmarkTable, versionTable = "private_capture_uploads", "private_bookmarks", "private_bookmark_versions"
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.CaptureCompleteResult{}, err
	}
	defer tx.Rollback(ctx)
	var existingBookmarkID, existingVersionID string
	err = tx.QueryRow(ctx, fmt.Sprintf(`select b.id::text,v.id::text from %s v join %s b on b.id=v.bookmark_id where b.user_id=$1 and v.html_object_key=$2 limit 1`, versionTable, bookmarkTable), userID, input.ObjectKey).Scan(&existingBookmarkID, &existingVersionID)
	if err == nil {
		if err := r.updateCaptureBookmark(ctx, tx, bookmarkTable, userID, existingBookmarkID, existingVersionID, input); err != nil {
			return domain.CaptureCompleteResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return domain.CaptureCompleteResult{}, err
		}
		bookmark, err := r.loadCaptureBookmark(ctx, userID, existingBookmarkID, private)
		return domain.CaptureCompleteResult{Bookmark: bookmark, VersionID: existingVersionID, Deduplicated: true}, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return domain.CaptureCompleteResult{}, err
	}
	var profile string
	err = tx.QueryRow(ctx, fmt.Sprintf(`select capture_profile from %s where object_key=$1 and user_id=$2`, uploadTable), input.ObjectKey, userID).Scan(&profile)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.CaptureCompleteResult{}, httperror.NotFound("PendingCaptureNotFound", "Pending capture not found for object key.")
	}
	if err != nil {
		return domain.CaptureCompleteResult{}, err
	}
	hash := hashNormalizedURL(normalized)
	var bookmarkID string
	err = tx.QueryRow(ctx, fmt.Sprintf(`select id::text from %s where user_id=$1 and normalized_url_hash=$2 order by updated_at desc limit 1`, bookmarkTable), userID, hash).Scan(&bookmarkID)
	if errors.Is(err, pgx.ErrNoRows) {
		parsed, _ := url.Parse(normalized)
		err = tx.QueryRow(ctx, fmt.Sprintf(`insert into %s (user_id,source_url,canonical_url,normalized_url_hash,title,domain,note,is_favorite,created_at,updated_at%s) values ($1,$2,$3,$4,$5,$6,'',false,now(),now()%s) returning id::text`, bookmarkTable, func() string {
			if !private {
				return ",is_pinned_offline"
			}
			return ""
		}(), func() string {
			if !private {
				return ",false"
			}
			return ""
		}()), userID, normalized, input.Source.CanonicalURL, hash, input.Source.Title, parsed.Hostname()).Scan(&bookmarkID)
	}
	if err != nil {
		return domain.CaptureCompleteResult{}, err
	}
	var duplicateID string
	err = tx.QueryRow(ctx, fmt.Sprintf(`select id::text from %s where bookmark_id=$1 and html_sha256=$2 limit 1`, versionTable), bookmarkID, input.HTMLSHA256).Scan(&duplicateID)
	if err == nil {
		_, err = tx.Exec(ctx, fmt.Sprintf(`delete from %s where object_key=$1`, uploadTable), input.ObjectKey)
		if err != nil {
			return domain.CaptureCompleteResult{}, err
		}
		if err = r.updateCaptureBookmark(ctx, tx, bookmarkTable, userID, bookmarkID, duplicateID, input); err != nil {
			return domain.CaptureCompleteResult{}, err
		}
		if err = tx.Commit(ctx); err != nil {
			return domain.CaptureCompleteResult{}, err
		}
		bookmark, err := r.loadCaptureBookmark(ctx, userID, bookmarkID, private)
		return domain.CaptureCompleteResult{Bookmark: bookmark, VersionID: duplicateID, Deduplicated: true}, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return domain.CaptureCompleteResult{}, err
	}
	var versionNo int
	if err = tx.QueryRow(ctx, fmt.Sprintf(`select coalesce(max(version_no),0)+1 from %s where bookmark_id=$1`, versionTable), bookmarkID).Scan(&versionNo); err != nil {
		return domain.CaptureCompleteResult{}, err
	}
	versionID := auth.NewUUID()
	qualityJSON, _ := json.Marshal(input.Quality)
	qualityReasonsJSON, _ := json.Marshal(input.Quality.Reasons)
	sourceJSON, _ := json.Marshal(map[string]any{"source": input.Source, "mediaFiles": input.MediaFiles, "screenshotObjectKey": input.ScreenshotObjectKey, "thumbnailObjectKey": input.ThumbnailObjectKey})
	_, err = tx.Exec(ctx, fmt.Sprintf(`insert into %s (id,bookmark_id,version_no,html_object_key,reader_html_object_key,html_sha256,text_sha256,text_simhash,capture_profile,capture_options_json,quality_score,quality_grade,quality_reasons_json,quality_report_json,source_meta_json,extracted_text,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())`, versionTable), versionID, bookmarkID, versionNo, input.ObjectKey, input.ReaderHTMLObjectKey, input.HTMLSHA256, input.TextSHA256, input.TextSimhash, profile, []byte(`{}`), input.Quality.Score, input.Quality.Grade, qualityReasonsJSON, qualityJSON, sourceJSON, input.ExtractedText)
	if err != nil {
		return domain.CaptureCompleteResult{}, err
	}
	if err = r.updateCaptureBookmark(ctx, tx, bookmarkTable, userID, bookmarkID, versionID, input); err != nil {
		return domain.CaptureCompleteResult{}, err
	}
	_, err = tx.Exec(ctx, fmt.Sprintf(`delete from %s where object_key=$1`, uploadTable), input.ObjectKey)
	if err != nil {
		return domain.CaptureCompleteResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return domain.CaptureCompleteResult{}, err
	}
	bookmark, err := r.loadCaptureBookmark(ctx, userID, bookmarkID, private)
	return domain.CaptureCompleteResult{Bookmark: bookmark, VersionID: versionID, CreatedNewVersion: true}, err
}

func (r *PostgresRepository) updateCaptureBookmark(ctx context.Context, tx pgx.Tx, table, userID, bookmarkID, versionID string, input domain.CaptureCompleteRequest) error {
	_, err := tx.Exec(ctx, fmt.Sprintf(`update %s set source_url=$3,canonical_url=$4,title=$5,domain=$6,latest_version_id=$7::uuid,updated_at=now() where user_id=$1 and id=$2`, table), userID, bookmarkID, input.Source.URL, input.Source.CanonicalURL, input.Source.Title, normalizeCaptureDomain(input.Source), versionID)
	return err
}
func (r *PostgresRepository) loadCaptureBookmark(ctx context.Context, userID, bookmarkID string, private bool) (domain.Bookmark, error) {
	if private {
		var b domain.Bookmark
		err := r.pool.QueryRow(ctx, `select id::text,source_url,canonical_url,title,domain,note,is_favorite,latest_version_id::text,created_at,updated_at from private_bookmarks where user_id=$1 and id=$2`, userID, bookmarkID).Scan(&b.ID, &b.SourceURL, &b.CanonicalURL, &b.Title, &b.Domain, &b.Note, &b.IsFavorite, &b.LatestVersionID, &b.CreatedAt, &b.UpdatedAt)
		b.Tags = []domain.Tag{}
		return b, err
	}
	return r.loadBookmark(ctx, userID, bookmarkID)
}
func normalizeCaptureDomain(source domain.CaptureSource) string {
	if strings.TrimSpace(source.Domain) != "" {
		return strings.ToLower(strings.TrimSpace(source.Domain))
	}
	parsed, _ := url.Parse(source.URL)
	return strings.ToLower(parsed.Hostname())
}

func (r *PostgresRepository) UserCanReadObject(ctx context.Context, userID, objectKey string) (bool, error) {
	return r.userCanObject(ctx, userID, objectKey, false)
}
func (r *PostgresRepository) UserCanWriteObject(ctx context.Context, userID, objectKey string) (bool, error) {
	ok, err := r.userCanObject(ctx, userID, objectKey, false)
	if ok || err != nil {
		return ok, err
	}
	owner := mediaOwnerKey(objectKey)
	for _, table := range []string{"capture_uploads", "private_capture_uploads"} {
		var key string
		err = r.pool.QueryRow(ctx, fmt.Sprintf(`select object_key from %s where user_id=$1 and object_key=$2 limit 1`, table), userID, owner).Scan(&key)
		if err == nil {
			return true, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return false, err
		}
	}
	return false, nil
}
func (r *PostgresRepository) userCanObject(ctx context.Context, userID, objectKey string, _ bool) (bool, error) {
	owner := mediaOwnerKey(objectKey)
	for _, set := range [][2]string{{"bookmarks", "bookmark_versions"}, {"private_bookmarks", "private_bookmark_versions"}} {
		var id string
		err := r.pool.QueryRow(ctx, fmt.Sprintf(`select v.id::text from %s v join %s b on b.id=v.bookmark_id where b.user_id=$1 and (v.html_object_key=$2 or v.reader_html_object_key=$2) limit 1`, set[1], set[0]), userID, owner).Scan(&id)
		if err == nil {
			return true, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return false, err
		}
	}
	return false, nil
}
