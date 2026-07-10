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
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

func (r *PostgresRepository) FindBookmarkByURL(ctx context.Context, userID, rawURL string) (*domain.Bookmark, error) {
	normalized, err := normalizeSourceURL(rawURL)
	if err != nil {
		return nil, err
	}
	var id string
	err = r.pool.QueryRow(ctx, `select id::text from bookmarks where user_id=$1 and normalized_url_hash=$2 order by updated_at desc limit 1`, userID, hashNormalizedURL(normalized)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	b, err := r.loadBookmark(ctx, userID, id)
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	return &b, err
}

func (r *PostgresRepository) GetBookmarkDetail(ctx context.Context, userID, bookmarkID string) (*domain.BookmarkDetailResponse, error) {
	b, err := r.loadBookmark(ctx, userID, bookmarkID)
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `select id::text, bookmark_id::text, version_no, html_object_key, reader_html_object_key, html_sha256, text_sha256, text_simhash, capture_profile::text, quality_report_json, source_meta_json, created_at from bookmark_versions where bookmark_id=$1 order by version_no desc`, bookmarkID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	versions := []domain.BookmarkVersion{}
	for rows.Next() {
		var v domain.BookmarkVersion
		var quality, meta []byte
		if err := rows.Scan(&v.ID, &v.BookmarkID, &v.VersionNo, &v.HTMLObjectKey, &v.ReaderHTMLObjectKey, &v.HTMLSHA256, &v.TextSHA256, &v.TextSimhash, &v.CaptureProfile, &quality, &meta, &v.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(quality, &v.Quality)
		var source struct {
			MediaFiles []domain.CaptureMediaFile `json:"mediaFiles"`
		}
		_ = json.Unmarshal(meta, &source)
		v.MediaFiles = source.MediaFiles
		versions = append(versions, v)
	}
	return &domain.BookmarkDetailResponse{Bookmark: b, Versions: versions}, rows.Err()
}

func (r *PostgresRepository) DeleteBookmark(ctx context.Context, userID, bookmarkID string) (bool, error) {
	c, err := r.pool.Exec(ctx, `delete from bookmarks where id=$1 and user_id=$2`, bookmarkID, userID)
	return c.RowsAffected() > 0, err
}

func (r *PostgresRepository) UpdateBookmarkMetadata(ctx context.Context, userID, bookmarkID string, input domain.BookmarkMetadataUpdateRequest) (*domain.Bookmark, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var exists bool
	if err = tx.QueryRow(ctx, `select exists(select 1 from bookmarks where id=$1 and user_id=$2)`, bookmarkID, userID).Scan(&exists); err != nil || !exists {
		if err == nil {
			return nil, nil
		}
		return nil, err
	}
	sets := []string{}
	args := []any{bookmarkID, userID}
	add := func(col string, value any) {
		args = append(args, value)
		sets = append(sets, fmt.Sprintf("%s=$%d", col, len(args)))
	}
	if input.Note.Present {
		add("note", derefString(input.Note.Value))
	}
	if input.IsFavorite != nil {
		add("is_favorite", *input.IsFavorite)
	}
	if input.FolderID.Present {
		add("folder_id", input.FolderID.Value)
	}
	if input.FolderPath.Present {
		id, e := r.ensureFolderPathID(ctx, tx, userID, derefString(input.FolderPath.Value), time.Now().UTC())
		if e != nil {
			return nil, e
		}
		add("folder_id", id)
	}
	if len(sets) > 0 {
		sets = append(sets, "updated_at=now()")
		if _, err = tx.Exec(ctx, `update bookmarks set `+strings.Join(sets, ",")+` where id=$1 and user_id=$2`, args...); err != nil {
			return nil, err
		}
	}
	if input.Tags != nil || input.TagIDs != nil {
		if _, err = tx.Exec(ctx, `delete from bookmark_tags where bookmark_id=$1`, bookmarkID); err != nil {
			return nil, err
		}
		if input.Tags != nil {
			if err = r.attachTagNames(ctx, tx, userID, bookmarkID, *input.Tags, time.Now().UTC()); err != nil {
				return nil, err
			}
		} else {
			for _, tagID := range *input.TagIDs {
				if _, err = tx.Exec(ctx, `insert into bookmark_tags (bookmark_id,tag_id,created_at) select $1,id,now() from tags where id=$2 and user_id=$3 on conflict do nothing`, bookmarkID, tagID, userID); err != nil {
					return nil, err
				}
			}
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	b, err := r.loadBookmark(ctx, userID, bookmarkID)
	return &b, err
}

func (r *PostgresRepository) RefreshBookmarkIcon(ctx context.Context, userID string, input domain.BookmarkIconRefreshRequest) (domain.BookmarkIconRefreshResponse, error) {
	host, source := strings.TrimSpace(input.Domain), strings.TrimSpace(input.SourceURL)
	if input.BookmarkID != "" {
		_ = r.pool.QueryRow(ctx, `select domain,source_url from bookmarks where id=$1 and user_id=$2`, input.BookmarkID, userID).Scan(&host, &source)
	}
	if host == "" && source != "" {
		if u, e := url.Parse(source); e == nil {
			host = u.Hostname()
		}
	}
	if host == "" {
		return domain.BookmarkIconRefreshResponse{Skipped: 1, Icons: []domain.BookmarkIcon{}}, nil
	}
	iconURL, sourceType := "https://"+host+"/favicon.ico", "favicon-ico"
	var width, height *int
	if len(input.Candidates) > 0 && validHTTPURL(input.Candidates[0].URL) {
		iconURL = input.Candidates[0].URL
		sourceType = input.Candidates[0].Source
		width = input.Candidates[0].Width
		height = input.Candidates[0].Height
	}
	var icon domain.BookmarkIcon
	err := r.pool.QueryRow(ctx, `insert into bookmark_icons (hostname,icon_url,source_url,source_type,width,height,refreshed_at,updated_at) values($1,$2,nullif($3,''),$4::bookmark_icon_source_type,$5,$6,now(),now()) on conflict(hostname) do update set icon_url=excluded.icon_url,source_url=excluded.source_url,source_type=excluded.source_type,width=excluded.width,height=excluded.height,refreshed_at=now(),updated_at=now() returning id::text,hostname,icon_url,source_url,source_type::text,width,height,format,refreshed_at,created_at,updated_at`, host, iconURL, source, sourceType, width, height).Scan(&icon.ID, &icon.Hostname, &icon.IconURL, &icon.SourceURL, &icon.SourceType, &icon.Width, &icon.Height, &icon.Format, &icon.RefreshedAt, &icon.CreatedAt, &icon.UpdatedAt)
	if err != nil {
		return domain.BookmarkIconRefreshResponse{}, err
	}
	return domain.BookmarkIconRefreshResponse{Refreshed: 1, Icons: []domain.BookmarkIcon{icon}}, nil
}

func (r *PostgresRepository) RefreshAllBookmarkIcons(ctx context.Context, userID string) (domain.BookmarkIconRefreshResponse, error) {
	rows, err := r.pool.Query(ctx, `select distinct domain,min(source_url) from bookmarks where user_id=$1 group by domain order by domain`, userID)
	if err != nil {
		return domain.BookmarkIconRefreshResponse{}, err
	}
	defer rows.Close()
	out := domain.BookmarkIconRefreshResponse{Icons: []domain.BookmarkIcon{}}
	for rows.Next() {
		var d, s string
		if err = rows.Scan(&d, &s); err != nil {
			return out, err
		}
		one, e := r.RefreshBookmarkIcon(ctx, userID, domain.BookmarkIconRefreshRequest{Domain: d, SourceURL: s})
		if e != nil {
			return out, e
		}
		out.Refreshed += one.Refreshed
		out.Skipped += one.Skipped
		out.Icons = append(out.Icons, one.Icons...)
	}
	return out, rows.Err()
}
