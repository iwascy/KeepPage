package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

type PrivateBookmarkRepository interface {
	SearchPrivateBookmarks(ctx context.Context, userID string, query domain.BookmarkSearchQuery) (domain.BookmarkSearchResponse, error)
	GetPrivateBookmarkDetail(ctx context.Context, userID, bookmarkID string) (*domain.BookmarkDetailResponse, error)
}

func (r *MemoryRepository) SearchPrivateBookmarks(_ context.Context, userID string, query domain.BookmarkSearchQuery) (domain.BookmarkSearchResponse, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	state := r.captureState()
	items := []domain.Bookmark{}
	for _, version := range state.privateVersions {
		if version.userID != userID {
			continue
		}
		bookmark, ok := state.privateBookmarks[version.bookmarkID]
		if !ok || (query.Q != "" && !bookmarkMatches(bookmark, query.Q)) || (query.Domain != "" && bookmark.Domain != query.Domain) || (query.View == "favorites" && !bookmark.IsFavorite) {
			continue
		}
		found := false
		for _, existing := range items {
			if existing.ID == bookmark.ID {
				found = true
				break
			}
		}
		if !found {
			items = append(items, bookmark)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].UpdatedAt.After(items[j].UpdatedAt) })
	total := len(items)
	start := min(query.Offset, total)
	end := min(start+query.Limit, total)
	return domain.BookmarkSearchResponse{Items: items[start:end], Total: total}, nil
}

func (r *MemoryRepository) GetPrivateBookmarkDetail(_ context.Context, userID, bookmarkID string) (*domain.BookmarkDetailResponse, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	state := r.captureState()
	bookmark, ok := state.privateBookmarks[bookmarkID]
	if !ok {
		return nil, nil
	}
	versions := []domain.BookmarkVersion{}
	for _, version := range state.privateVersions {
		if version.userID == userID && version.bookmarkID == bookmarkID {
			versions = append(versions, domain.BookmarkVersion{ID: version.versionID, BookmarkID: bookmarkID, VersionNo: len(versions) + 1, HTMLObjectKey: version.objectKey, HTMLSHA256: version.hash, MediaFiles: append([]domain.CaptureMediaFile(nil), version.mediaFiles...), CaptureProfile: "standard", CreatedAt: bookmark.UpdatedAt})
		}
	}
	if len(versions) == 0 {
		return nil, nil
	}
	return &domain.BookmarkDetailResponse{Bookmark: bookmark, Versions: versions}, nil
}

func (r *PostgresRepository) SearchPrivateBookmarks(ctx context.Context, userID string, query domain.BookmarkSearchQuery) (domain.BookmarkSearchResponse, error) {
	args := []any{userID}
	conditions := []string{"user_id=$1"}
	if strings.TrimSpace(query.Q) != "" {
		args = append(args, "%"+strings.TrimSpace(query.Q)+"%")
		conditions = append(conditions, "(title ilike $2 or source_url ilike $2 or domain ilike $2 or note ilike $2)")
	}
	if query.Domain != "" {
		args = append(args, query.Domain)
		conditions = append(conditions, fmt.Sprintf("domain=$%d", len(args)))
	}
	if query.View == "favorites" {
		conditions = append(conditions, "is_favorite=true")
	}
	var total int
	if err := r.pool.QueryRow(ctx, `select count(*) from private_bookmarks where `+strings.Join(conditions, " and "), args...).Scan(&total); err != nil {
		return domain.BookmarkSearchResponse{}, err
	}
	args = append(args, query.Limit, query.Offset)
	rows, err := r.pool.Query(ctx, `select id::text,source_url,canonical_url,title,domain,note,is_favorite,latest_version_id::text,created_at,updated_at from private_bookmarks where `+strings.Join(conditions, " and ")+fmt.Sprintf(` order by updated_at desc limit $%d offset $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		return domain.BookmarkSearchResponse{}, err
	}
	defer rows.Close()
	items := []domain.Bookmark{}
	for rows.Next() {
		var b domain.Bookmark
		if err := rows.Scan(&b.ID, &b.SourceURL, &b.CanonicalURL, &b.Title, &b.Domain, &b.Note, &b.IsFavorite, &b.LatestVersionID, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return domain.BookmarkSearchResponse{}, err
		}
		b.Tags = []domain.Tag{}
		items = append(items, b)
	}
	return domain.BookmarkSearchResponse{Items: items, Total: total}, rows.Err()
}

func (r *PostgresRepository) GetPrivateBookmarkDetail(ctx context.Context, userID, bookmarkID string) (*domain.BookmarkDetailResponse, error) {
	var b domain.Bookmark
	err := r.pool.QueryRow(ctx, `select id::text,source_url,canonical_url,title,domain,note,is_favorite,latest_version_id::text,created_at,updated_at from private_bookmarks where user_id=$1 and id=$2`, userID, bookmarkID).Scan(&b.ID, &b.SourceURL, &b.CanonicalURL, &b.Title, &b.Domain, &b.Note, &b.IsFavorite, &b.LatestVersionID, &b.CreatedAt, &b.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	b.Tags = []domain.Tag{}
	rows, err := r.pool.Query(ctx, `select id::text,bookmark_id::text,version_no,html_object_key,reader_html_object_key,html_sha256,text_sha256,text_simhash,capture_profile::text,quality_report_json,source_meta_json,created_at from private_bookmark_versions where bookmark_id=$1 order by version_no desc`, bookmarkID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	versions := []domain.BookmarkVersion{}
	for rows.Next() {
		var v domain.BookmarkVersion
		var quality, meta []byte
		if err = rows.Scan(&v.ID, &v.BookmarkID, &v.VersionNo, &v.HTMLObjectKey, &v.ReaderHTMLObjectKey, &v.HTMLSHA256, &v.TextSHA256, &v.TextSimhash, &v.CaptureProfile, &quality, &meta, &v.CreatedAt); err != nil {
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
