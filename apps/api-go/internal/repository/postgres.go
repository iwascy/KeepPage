package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(ctx context.Context, databaseURL string) (*PostgresRepository, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	config.MaxConns = 16
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &PostgresRepository{pool: pool}, nil
}

func (r *PostgresRepository) Kind() string {
	return "postgres"
}

func (r *PostgresRepository) Close() {
	r.pool.Close()
}

func (r *PostgresRepository) ListUsersForBackup(ctx context.Context) ([]domain.AuthUser, error) {
	rows, err := r.pool.Query(ctx, `select id::text, email, name, created_at from users order by id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := make([]domain.AuthUser, 0)
	for rows.Next() {
		var user domain.AuthUser
		if err := rows.Scan(&user.ID, &user.Email, &user.Name, &user.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (r *PostgresRepository) HitRateLimit(ctx context.Context, scope string, key string, maxHits int, window time.Duration) (bool, int, error) {
	now := time.Now().UTC()
	windowStart := now.Truncate(window)
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, 0, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `delete from rate_limit_buckets where window_start < $1`, now.Add(-window)); err != nil {
		return false, 0, err
	}
	var hits int
	if err := tx.QueryRow(ctx, `
		insert into rate_limit_buckets (scope, bucket_key, window_start, hits)
		values ($1, $2, $3, 0)
		on conflict (scope, bucket_key, window_start) do update set hits = rate_limit_buckets.hits
		returning hits
	`, scope, key, windowStart).Scan(&hits); err != nil {
		return false, 0, err
	}
	if hits >= maxHits {
		if err := tx.Commit(ctx); err != nil {
			return false, 0, err
		}
		return false, retryAfter(windowStart, window), nil
	}
	if _, err := tx.Exec(ctx, `update rate_limit_buckets set hits = hits + 1 where scope=$1 and bucket_key=$2 and window_start=$3`, scope, key, windowStart); err != nil {
		return false, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, 0, err
	}
	return true, 0, nil
}

func (r *PostgresRepository) GetUserByID(ctx context.Context, userID string) (domain.AuthUser, error) {
	var user domain.AuthUser
	err := r.pool.QueryRow(ctx, `
		select id::text, email, name, created_at
		from users
		where id = $1
		limit 1
	`, userID).Scan(&user.ID, &user.Email, &user.Name, &user.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.AuthUser{}, ErrNotFound
	}
	return user, err
}

func (r *PostgresRepository) FindUserByEmail(ctx context.Context, email string) (*auth.UserAuthRecord, error) {
	var record auth.UserAuthRecord
	err := r.pool.QueryRow(ctx, `
		select id::text, email, name, created_at, password_hash
		from users
		where email = $1
		limit 1
	`, email).Scan(&record.User.ID, &record.User.Email, &record.User.Name, &record.User.CreatedAt, &record.PasswordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *PostgresRepository) CreateUser(ctx context.Context, email string, name *string, passwordHash string) (domain.AuthUser, error) {
	var user domain.AuthUser
	err := r.pool.QueryRow(ctx, `
		insert into users (email, name, password_hash)
		values ($1, $2, $3)
		returning id::text, email, name, created_at
	`, email, name, passwordHash).Scan(&user.ID, &user.Email, &user.Name, &user.CreatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.AuthUser{}, auth.ErrEmailExists
		}
		return domain.AuthUser{}, err
	}
	return user, nil
}

func (r *PostgresRepository) GetAPIAuthRecord(ctx context.Context, tokenID string) (auth.APIAuthRecord, error) {
	var record auth.APIAuthRecord
	var scopesJSON []byte
	err := r.pool.QueryRow(ctx, `
		select id::text, user_id::text, token_hash, scopes_json, expires_at, revoked_at
		from api_tokens
		where id = $1
		limit 1
	`, tokenID).Scan(&record.ID, &record.UserID, &record.TokenHash, &scopesJSON, &record.ExpiresAt, &record.RevokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.APIAuthRecord{}, ErrNotFound
	}
	if err != nil {
		return auth.APIAuthRecord{}, err
	}
	if len(scopesJSON) > 0 {
		_ = json.Unmarshal(scopesJSON, &record.Scopes)
	}
	return record, nil
}

func (r *PostgresRepository) GetDeviceAuthRecord(ctx context.Context, deviceID string) (auth.DeviceAuthRecord, error) {
	var record auth.DeviceAuthRecord
	err := r.pool.QueryRow(ctx, `
		select id::text, user_id::text, token_hash, expires_at, revoked_at
		from devices
		where id = $1
		limit 1
	`, deviceID).Scan(&record.ID, &record.UserID, &record.TokenHash, &record.ExpiresAt, &record.RevokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.DeviceAuthRecord{}, ErrNotFound
	}
	return record, err
}

func (r *PostgresRepository) TouchAPIToken(ctx context.Context, tokenID string, usedAt time.Time) error {
	_, err := r.pool.Exec(ctx, `update api_tokens set last_used_at = $2 where id = $1`, tokenID, usedAt)
	return err
}

func (r *PostgresRepository) CreateAPIToken(ctx context.Context, userID string, id string, name string, tokenPreview string, tokenHash string, scopes []string, expiresAt *time.Time) (domain.APIToken, error) {
	scopesJSON, err := json.Marshal(scopes)
	if err != nil {
		return domain.APIToken{}, err
	}
	var item domain.APIToken
	err = r.pool.QueryRow(ctx, `
		insert into api_tokens (id, user_id, name, token_preview, token_hash, scopes_json, expires_at)
		values ($1, $2, $3, $4, $5, $6::jsonb, $7)
		returning id::text, name, token_preview, scopes_json, last_used_at, expires_at, revoked_at, created_at
	`, id, userID, name, tokenPreview, tokenHash, scopesJSON, expiresAt).Scan(&item.ID, &item.Name, &item.TokenPreview, &scopesJSON, &item.LastUsedAt, &item.ExpiresAt, &item.RevokedAt, &item.CreatedAt)
	if err != nil {
		return domain.APIToken{}, err
	}
	if err := json.Unmarshal(scopesJSON, &item.Scopes); err != nil {
		return domain.APIToken{}, err
	}
	return item, nil
}

func (r *PostgresRepository) ListAPITokens(ctx context.Context, userID string) ([]domain.APIToken, error) {
	rows, err := r.pool.Query(ctx, `
		select id::text, name, token_preview, scopes_json, last_used_at, expires_at, revoked_at, created_at
		from api_tokens where user_id = $1 order by created_at desc
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.APIToken{}
	for rows.Next() {
		var item domain.APIToken
		var scopesJSON []byte
		if err := rows.Scan(&item.ID, &item.Name, &item.TokenPreview, &scopesJSON, &item.LastUsedAt, &item.ExpiresAt, &item.RevokedAt, &item.CreatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(scopesJSON, &item.Scopes); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepository) RevokeAPIToken(ctx context.Context, userID string, tokenID string, revokedAt time.Time) (bool, error) {
	command, err := r.pool.Exec(ctx, `update api_tokens set revoked_at = coalesce(revoked_at, $3) where id = $1 and user_id = $2`, tokenID, userID, revokedAt)
	return command.RowsAffected() > 0, err
}

func (r *PostgresRepository) TouchDevice(ctx context.Context, deviceID string, usedAt time.Time) error {
	_, err := r.pool.Exec(ctx, `update devices set last_used_at = $2 where id = $1`, deviceID, usedAt)
	return err
}

func (r *PostgresRepository) SearchBookmarks(ctx context.Context, userID string, query domain.BookmarkSearchQuery) (domain.BookmarkSearchResponse, error) {
	args := []any{userID}
	conditions := []string{"b.user_id = $1"}
	joins := `
		left join bookmark_versions bv on b.latest_version_id = bv.id
		left join folders f on b.folder_id = f.id
	`
	if query.View == "favorites" {
		conditions = append(conditions, "b.is_favorite = true")
	}
	if query.View == "recent" {
		args = append(args, time.Now().Add(-7*24*time.Hour))
		conditions = append(conditions, fmt.Sprintf("b.updated_at >= $%d", len(args)))
	}
	if query.Domain != "" {
		args = append(args, query.Domain)
		conditions = append(conditions, fmt.Sprintf("b.domain = $%d", len(args)))
	}
	if query.Quality != "" {
		args = append(args, query.Quality)
		conditions = append(conditions, fmt.Sprintf("bv.quality_grade = $%d", len(args)))
	}
	if query.FolderID != "" {
		folderIDs, err := r.loadFolderSubtreeIDs(ctx, userID, query.FolderID)
		if err != nil {
			return domain.BookmarkSearchResponse{}, err
		}
		if len(folderIDs) == 0 {
			return domain.BookmarkSearchResponse{Items: []domain.Bookmark{}, Total: 0}, nil
		}
		args = append(args, folderIDs)
		conditions = append(conditions, fmt.Sprintf("b.folder_id = any($%d::uuid[])", len(args)))
	}
	if query.TagID != "" {
		args = append(args, query.TagID)
		conditions = append(conditions, fmt.Sprintf(`exists (
			select 1 from bookmark_tags bt
			where bt.bookmark_id = b.id and bt.tag_id = $%d
		)`, len(args)))
	}
	if strings.TrimSpace(query.Q) != "" {
		args = append(args, "%"+strings.TrimSpace(query.Q)+"%")
		placeholder := fmt.Sprintf("$%d", len(args))
		conditions = append(conditions, fmt.Sprintf(`(
			b.title ilike %[1]s or b.source_url ilike %[1]s or b.domain ilike %[1]s or b.note ilike %[1]s
			or f.path ilike %[1]s
			or bv.extracted_text ilike %[1]s
			or exists (
				select 1 from bookmark_tags bt
				inner join tags t on t.id = bt.tag_id
				where bt.bookmark_id = b.id and t.name ilike %[1]s
			)
		)`, placeholder))
	}
	whereClause := strings.Join(conditions, " and ")

	var total int
	countSQL := `select count(*) from bookmarks b ` + joins + ` where ` + whereClause
	if err := r.pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return domain.BookmarkSearchResponse{}, err
	}
	if total == 0 {
		return domain.BookmarkSearchResponse{Items: []domain.Bookmark{}, Total: 0}, nil
	}

	args = append(args, query.Limit, query.Offset)
	rows, err := r.pool.Query(ctx, `
		select
			b.id::text,
			b.source_url,
			b.canonical_url,
			b.title,
			b.domain,
			b.note,
			b.is_favorite,
			b.latest_version_id::text,
			b.created_at,
			b.updated_at,
			f.id::text,
			f.name,
			f.path,
			f.parent_id::text,
			bv.quality_report_json,
			bv.source_meta_json,
			bi.icon_url,
			(
				select count(*)
				from bookmark_versions count_bv
				where count_bv.bookmark_id = b.id
			)::int
		from bookmarks b
	`+joins+`
		left join bookmark_icons bi on bi.hostname = b.domain
		where `+whereClause+`
		order by b.updated_at desc
		limit $`+fmt.Sprint(len(args)-1)+` offset $`+fmt.Sprint(len(args))+`
	`, args...)
	if err != nil {
		return domain.BookmarkSearchResponse{}, err
	}
	defer rows.Close()

	items := []domain.Bookmark{}
	for rows.Next() {
		bookmark, err := scanBookmark(rows)
		if err != nil {
			return domain.BookmarkSearchResponse{}, err
		}
		items = append(items, bookmark)
	}
	if err := rows.Err(); err != nil {
		return domain.BookmarkSearchResponse{}, err
	}
	if len(items) > 0 {
		if err := r.attachTags(ctx, items); err != nil {
			return domain.BookmarkSearchResponse{}, err
		}
	}
	return domain.BookmarkSearchResponse{Items: items, Total: total}, nil
}

func (r *PostgresRepository) IngestBookmark(ctx context.Context, userID string, input domain.IngestBookmarkRequest) (domain.IngestBookmarkResult, error) {
	normalizedURL, err := normalizeSourceURL(input.URL)
	if err != nil {
		return domain.IngestBookmarkResult{}, err
	}
	parsedURL, err := url.Parse(normalizedURL)
	if err != nil {
		return domain.IngestBookmarkResult{}, err
	}
	normalizedHash := hashNormalizedURL(normalizedURL)
	now := time.Now().UTC()

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.IngestBookmarkResult{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var existingID string
	err = tx.QueryRow(ctx, `
		select id::text
		from bookmarks
		where user_id = $1 and normalized_url_hash = $2
		order by updated_at desc
		limit 1
	`, userID, normalizedHash).Scan(&existingID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return domain.IngestBookmarkResult{}, err
	}

	status := "created"
	deduplicated := false
	bookmarkID := existingID
	if existingID != "" {
		if input.DedupeStrategy == "skip" {
			status = "skipped"
			deduplicated = true
		} else {
			folderID, err := r.ensureFolderPathID(ctx, tx, userID, input.FolderPath, now)
			if err != nil {
				return domain.IngestBookmarkResult{}, err
			}
			if err := updateExistingBookmark(ctx, tx, userID, existingID, input, folderID, now); err != nil {
				return domain.IngestBookmarkResult{}, err
			}
			if err := r.attachTagNames(ctx, tx, userID, existingID, input.Tags, now); err != nil {
				return domain.IngestBookmarkResult{}, err
			}
			status = "merged"
			deduplicated = true
		}
	} else {
		folderID, err := r.ensureFolderPathID(ctx, tx, userID, input.FolderPath, now)
		if err != nil {
			return domain.IngestBookmarkResult{}, err
		}
		err = tx.QueryRow(ctx, `
			insert into bookmarks (
				user_id, source_url, canonical_url, normalized_url_hash, title, domain,
				latest_version_id, folder_id, note, is_favorite, is_pinned_offline, created_at, updated_at
			)
			values ($1, $2, null, $3, $4, $5, null, $6, $7, false, false, $8, $8)
			returning id::text
		`, userID, normalizedURL, normalizedHash, resolveTitle(input.Title, normalizedURL), parsedURL.Hostname(), folderID, derefString(input.Note), now).Scan(&bookmarkID)
		if err != nil {
			return domain.IngestBookmarkResult{}, err
		}
		if err := r.attachTagNames(ctx, tx, userID, bookmarkID, input.Tags, now); err != nil {
			return domain.IngestBookmarkResult{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.IngestBookmarkResult{}, err
	}

	bookmark, err := r.loadBookmark(ctx, userID, bookmarkID)
	if err != nil {
		return domain.IngestBookmarkResult{}, err
	}
	return domain.IngestBookmarkResult{Bookmark: bookmark, Status: status, Deduplicated: deduplicated}, nil
}

func updateExistingBookmark(ctx context.Context, tx pgx.Tx, userID string, bookmarkID string, input domain.IngestBookmarkRequest, folderID *string, now time.Time) error {
	title := strings.TrimSpace(input.Title)
	if title != "" && input.Note != nil && folderID != nil {
		_, err := tx.Exec(ctx, `update bookmarks set title = $3, note = $4, folder_id = $5, updated_at = $6 where user_id = $1 and id = $2`, userID, bookmarkID, title, *input.Note, *folderID, now)
		return err
	}
	if title != "" && input.Note != nil {
		_, err := tx.Exec(ctx, `update bookmarks set title = $3, note = $4, updated_at = $5 where user_id = $1 and id = $2`, userID, bookmarkID, title, *input.Note, now)
		return err
	}
	if title != "" && folderID != nil {
		_, err := tx.Exec(ctx, `update bookmarks set title = $3, folder_id = $4, updated_at = $5 where user_id = $1 and id = $2`, userID, bookmarkID, title, *folderID, now)
		return err
	}
	if input.Note != nil && folderID != nil {
		_, err := tx.Exec(ctx, `update bookmarks set note = $3, folder_id = $4, updated_at = $5 where user_id = $1 and id = $2`, userID, bookmarkID, *input.Note, *folderID, now)
		return err
	}
	if title != "" {
		_, err := tx.Exec(ctx, `update bookmarks set title = $3, updated_at = $4 where user_id = $1 and id = $2`, userID, bookmarkID, title, now)
		return err
	}
	if input.Note != nil {
		_, err := tx.Exec(ctx, `update bookmarks set note = $3, updated_at = $4 where user_id = $1 and id = $2`, userID, bookmarkID, *input.Note, now)
		return err
	}
	if folderID != nil {
		_, err := tx.Exec(ctx, `update bookmarks set folder_id = $3, updated_at = $4 where user_id = $1 and id = $2`, userID, bookmarkID, *folderID, now)
		return err
	}
	_, err := tx.Exec(ctx, `update bookmarks set updated_at = $3 where user_id = $1 and id = $2`, userID, bookmarkID, now)
	return err
}

func (r *PostgresRepository) loadBookmark(ctx context.Context, userID string, bookmarkID string) (domain.Bookmark, error) {
	row := r.pool.QueryRow(ctx, `
		select
			b.id::text, b.source_url, b.canonical_url, b.title, b.domain, b.note,
			b.is_favorite, b.latest_version_id::text, b.created_at, b.updated_at,
			f.id::text, f.name, f.path, f.parent_id::text,
			bv.quality_report_json, bv.source_meta_json, bi.icon_url,
			(select count(*) from bookmark_versions count_bv where count_bv.bookmark_id = b.id)::int
		from bookmarks b
		left join bookmark_versions bv on b.latest_version_id = bv.id
		left join folders f on b.folder_id = f.id
		left join bookmark_icons bi on bi.hostname = b.domain
		where b.user_id = $1 and b.id = $2
		limit 1
	`, userID, bookmarkID)
	bookmark, err := scanBookmark(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Bookmark{}, ErrNotFound
	}
	if err != nil {
		return domain.Bookmark{}, err
	}
	items := []domain.Bookmark{bookmark}
	if err := r.attachTags(ctx, items); err != nil {
		return domain.Bookmark{}, err
	}
	return items[0], nil
}

type bookmarkScanner interface {
	Scan(dest ...any) error
}

func scanBookmark(row bookmarkScanner) (domain.Bookmark, error) {
	var bookmark domain.Bookmark
	var folderID, folderName, folderPath, folderParentID *string
	var latestQualityJSON, sourceMetaJSON []byte
	var iconURL *string
	err := row.Scan(
		&bookmark.ID,
		&bookmark.SourceURL,
		&bookmark.CanonicalURL,
		&bookmark.Title,
		&bookmark.Domain,
		&bookmark.Note,
		&bookmark.IsFavorite,
		&bookmark.LatestVersionID,
		&bookmark.CreatedAt,
		&bookmark.UpdatedAt,
		&folderID,
		&folderName,
		&folderPath,
		&folderParentID,
		&latestQualityJSON,
		&sourceMetaJSON,
		&iconURL,
		&bookmark.VersionCount,
	)
	if err != nil {
		return domain.Bookmark{}, err
	}
	bookmark.Tags = []domain.Tag{}
	bookmark.FaviconURL = iconURL
	if folderID != nil && folderName != nil && folderPath != nil {
		bookmark.Folder = &domain.Folder{
			ID:       *folderID,
			Name:     *folderName,
			Path:     *folderPath,
			ParentID: folderParentID,
		}
	}
	if len(latestQualityJSON) > 0 && string(latestQualityJSON) != "null" {
		var quality domain.QualityReport
		if err := json.Unmarshal(latestQualityJSON, &quality); err == nil && quality.Grade != "" {
			bookmark.LatestQuality = &quality
		}
	}
	if len(sourceMetaJSON) > 0 && string(sourceMetaJSON) != "null" {
		readCaptureSource(sourceMetaJSON, &bookmark)
	}
	return bookmark, nil
}

func readCaptureSource(raw []byte, bookmark *domain.Bookmark) {
	var meta struct {
		Source struct {
			FaviconURL    string `json:"faviconUrl"`
			CoverImageURL string `json:"coverImageUrl"`
		} `json:"source"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		return
	}
	if bookmark.FaviconURL == nil && meta.Source.FaviconURL != "" {
		bookmark.FaviconURL = &meta.Source.FaviconURL
	}
	if meta.Source.CoverImageURL != "" {
		bookmark.CoverImageURL = &meta.Source.CoverImageURL
	}
}

func (r *PostgresRepository) attachTags(ctx context.Context, bookmarks []domain.Bookmark) error {
	ids := make([]string, 0, len(bookmarks))
	indexByID := map[string]int{}
	for i, item := range bookmarks {
		ids = append(ids, item.ID)
		indexByID[item.ID] = i
	}
	rows, err := r.pool.Query(ctx, `
		select bt.bookmark_id::text, t.id::text, t.name, t.color
		from bookmark_tags bt
		inner join tags t on t.id = bt.tag_id
		where bt.bookmark_id = any($1::uuid[])
		order by t.name asc
	`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var bookmarkID string
		var tag domain.Tag
		if err := rows.Scan(&bookmarkID, &tag.ID, &tag.Name, &tag.Color); err != nil {
			return err
		}
		if index, ok := indexByID[bookmarkID]; ok {
			bookmarks[index].Tags = append(bookmarks[index].Tags, tag)
		}
	}
	return rows.Err()
}

func (r *PostgresRepository) loadFolderSubtreeIDs(ctx context.Context, userID string, folderID string) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		with recursive subtree as (
			select id
			from folders
			where user_id = $1 and id = $2
			union all
			select f.id
			from folders f
			inner join subtree s on f.parent_id = s.id
			where f.user_id = $1
		)
		select id::text from subtree
	`, userID, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *PostgresRepository) ensureFolderPathID(ctx context.Context, tx pgx.Tx, userID string, folderPath string, now time.Time) (*string, error) {
	trimmed := strings.Trim(strings.TrimSpace(folderPath), "/")
	if trimmed == "" {
		return nil, nil
	}
	segments := strings.Split(trimmed, "/")
	var parentID *string
	var currentPath string
	var currentID string
	for _, rawSegment := range segments {
		name := strings.TrimSpace(rawSegment)
		if name == "" {
			continue
		}
		if currentPath == "" {
			currentPath = name
		} else {
			currentPath += "/" + name
		}
		err := tx.QueryRow(ctx, `
			insert into folders (user_id, name, path, parent_id, created_at, updated_at)
			values ($1, $2, $3, $4, $5, $5)
			on conflict (user_id, path)
			do update set name = excluded.name
			returning id::text
		`, userID, name, currentPath, parentID, now).Scan(&currentID)
		if err != nil {
			return nil, err
		}
		parentID = &currentID
	}
	if currentID == "" {
		return nil, nil
	}
	return &currentID, nil
}

func (r *PostgresRepository) attachTagNames(ctx context.Context, tx pgx.Tx, userID string, bookmarkID string, tagNames []string, now time.Time) error {
	for _, rawName := range tagNames {
		name := strings.TrimSpace(rawName)
		if name == "" {
			continue
		}
		var tagID string
		if err := tx.QueryRow(ctx, `
			insert into tags (user_id, name, created_at)
			values ($1, $2, $3)
			on conflict (user_id, name)
			do update set name = excluded.name
			returning id::text
		`, userID, name, now).Scan(&tagID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			insert into bookmark_tags (bookmark_id, tag_id, created_at)
			values ($1, $2, $3)
			on conflict do nothing
		`, bookmarkID, tagID, now); err != nil {
			return err
		}
	}
	return nil
}
