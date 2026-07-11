package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
)

func (r *PostgresRepository) FindImportBookmarkMatches(ctx context.Context, userID string, hashes []string) ([]domain.ImportBookmarkMatch, error) {
	if len(hashes) == 0 {
		return []domain.ImportBookmarkMatch{}, nil
	}
	rows, err := r.pool.Query(ctx, `select normalized_url_hash,id::text,title,latest_version_id::text from bookmarks where user_id=$1 and normalized_url_hash=any($2::varchar[])`, userID, hashes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ImportBookmarkMatch{}
	for rows.Next() {
		var v domain.ImportBookmarkMatch
		if err := rows.Scan(&v.NormalizedURLHash, &v.BookmarkID, &v.Title, &v.LatestVersionID); err != nil {
			return nil, err
		}
		v.HasArchive = v.LatestVersionID != nil
		out = append(out, v)
	}
	return out, rows.Err()
}
func (r *PostgresRepository) CreateImportTask(ctx context.Context, userID string, input domain.CreateImportTaskInput) (domain.ImportTaskDetailResponse, error) {
	matches, err := r.FindImportBookmarkMatches(ctx, userID, preparedHashes(input.Items))
	if err != nil {
		return domain.ImportTaskDetailResponse{}, err
	}
	byHash := map[string]domain.ImportBookmarkMatch{}
	for _, m := range matches {
		byHash[m.NormalizedURLHash] = m
	}
	now := time.Now().UTC()
	task := domain.ImportTask{
		ID: inputTaskID(), Name: input.TaskName, SourceType: input.SourceType, Mode: input.Options.Mode,
		Status: "running", FileName: input.FileName,
		TotalCount: input.Preview.Summary.TotalCount, ValidCount: input.Preview.Summary.ValidCount,
		InvalidCount: input.Preview.Summary.InvalidCount, DuplicateInFileCount: input.Preview.Summary.DuplicateInFileCount,
		DuplicateExistingCount: input.Preview.Summary.DuplicateExistingCount, CreatedAt: now, UpdatedAt: now,
	}
	// Persist the task shell first so a crash mid-ingest leaves an auditable running task
	// instead of ghost bookmarks with no import history.
	items := make([]domain.ImportTaskItem, 0, len(input.Items))
	for _, p := range input.Items {
		items = append(items, domain.ImportTaskItem{
			ID: newPgImportID("imp_item_"), TaskID: task.ID, Index: p.Index, Title: p.Title, URL: p.URL,
			Domain: p.Domain, FolderPath: p.FolderPath, Status: "pending", DedupeResult: "none",
			CreatedAt: now, UpdatedAt: now,
		})
	}
	meta, _ := json.Marshal(map[string]any{"options": input.Options, "preview": input.Preview.Summary})
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.ImportTaskDetailResponse{}, err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `insert into import_tasks (id,user_id,name,source_type,mode,status,file_name,total_count,valid_count,invalid_count,duplicate_in_file_count,duplicate_existing_count,created_count,merged_count,skipped_count,failed_count,archive_queued_count,archive_success_count,archive_failed_count,source_meta_json,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,0,0,0,0,0,0,$13::jsonb,$14,$14)`, task.ID, userID, task.Name, task.SourceType, task.Mode, task.Status, task.FileName, task.TotalCount, task.ValidCount, task.InvalidCount, task.DuplicateInFileCount, task.DuplicateExistingCount, meta, now)
	if err != nil {
		return domain.ImportTaskDetailResponse{}, err
	}
	for _, item := range items {
		tags, _ := json.Marshal([]string{})
		_, err = tx.Exec(ctx, `insert into import_items (id,task_id,user_id,position,title,source_url,normalized_url,normalized_url_hash,domain,folder_path,source_tags_json,status,dedupe_result,reason,bookmark_id,archived_version_id,has_archive,source_meta_json,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$6,null,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,'{}'::jsonb,$16,$16)`, item.ID, item.TaskID, userID, item.Index, item.Title, item.URL, item.Domain, item.FolderPath, tags, item.Status, item.DedupeResult, item.Reason, item.BookmarkID, item.ArchivedVersionID, item.HasArchive, now)
		if err != nil {
			return domain.ImportTaskDetailResponse{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.ImportTaskDetailResponse{}, err
	}

	for i, p := range input.Items {
		item := &items[i]
		item.UpdatedAt = time.Now().UTC()
		if !p.Valid {
			item.Status = "skipped"
			item.DedupeResult = "invalid_input"
			item.Reason = p.Reason
			task.SkippedCount++
		} else if p.DuplicateInFile {
			item.Status = "skipped"
			item.DedupeResult = "skipped_duplicate"
			item.Reason = p.Reason
			task.SkippedCount++
		} else {
			var existing *domain.ImportBookmarkMatch
			if p.NormalizedURLHash != nil {
				if x, ok := byHash[*p.NormalizedURLHash]; ok {
					existing = &x
				}
			}
			if existing != nil {
				item.BookmarkID = &existing.BookmarkID
				item.ArchivedVersionID = existing.LatestVersionID
				item.HasArchive = existing.HasArchive
				if input.Options.DedupeStrategy == "skip" {
					item.Status = "skipped"
					item.DedupeResult = "skipped_existing"
					x := "站内已存在同一链接，按当前策略跳过。"
					item.Reason = &x
					task.SkippedCount++
				} else {
					item.Status = "deduplicated"
					item.DedupeResult = "merged_existing"
					x := "已合并到现有书签。"
					if existing.HasArchive {
						x = "已合并到现有书签，且该书签已有归档。"
					}
					item.Reason = &x
					task.MergedCount++
					if input.Options.DedupeStrategy == "update_metadata" {
						_, _ = r.IngestBookmark(ctx, userID, postgresImportIngest(p, input.Options))
					}
				}
			} else {
				result, e := r.IngestBookmark(ctx, userID, postgresImportIngest(p, input.Options))
				if e != nil {
					item.Status = "failed"
					item.DedupeResult = "none"
					x := e.Error()
					item.Reason = &x
					task.FailedCount++
				} else {
					item.Status = "created_bookmark"
					item.DedupeResult = "created_bookmark"
					x := "已完成轻导入。"
					item.Reason = &x
					item.BookmarkID = &result.Bookmark.ID
					task.CreatedCount++
				}
			}
		}
		if err := r.updateImportItem(ctx, userID, *item); err != nil {
			return domain.ImportTaskDetailResponse{}, err
		}
	}

	task.Status = "completed"
	if task.FailedCount > 0 || task.InvalidCount > 0 {
		task.Status = "partial_failed"
	}
	completedAt := time.Now().UTC()
	task.CompletedAt = &completedAt
	task.UpdatedAt = completedAt
	if err := r.finalizeImportTask(ctx, userID, task); err != nil {
		return domain.ImportTaskDetailResponse{}, err
	}
	return domain.ImportTaskDetailResponse{Task: task, Items: items}, nil
}

func inputTaskID() string {
	return newPgImportID("imp_")
}

func (r *PostgresRepository) updateImportItem(ctx context.Context, userID string, item domain.ImportTaskItem) error {
	_, err := r.pool.Exec(ctx, `
		update import_items
		set status=$4, dedupe_result=$5, reason=$6, bookmark_id=$7, archived_version_id=$8, has_archive=$9, updated_at=$10
		where id=$1 and task_id=$2 and user_id=$3
	`, item.ID, item.TaskID, userID, item.Status, item.DedupeResult, item.Reason, item.BookmarkID, item.ArchivedVersionID, item.HasArchive, item.UpdatedAt)
	return err
}

func (r *PostgresRepository) finalizeImportTask(ctx context.Context, userID string, task domain.ImportTask) error {
	_, err := r.pool.Exec(ctx, `
		update import_tasks
		set status=$3, created_count=$4, merged_count=$5, skipped_count=$6, failed_count=$7, updated_at=$8, completed_at=$9
		where id=$1 and user_id=$2
	`, task.ID, userID, task.Status, task.CreatedCount, task.MergedCount, task.SkippedCount, task.FailedCount, task.UpdatedAt, task.CompletedAt)
	return err
}
func postgresImportIngest(i domain.PreparedImportItem, o domain.ImportExecutionOptions) domain.IngestBookmarkRequest {
	path := ""
	if o.TargetFolderMode == "specific" {
		path = o.TargetFolderPath
	} else if o.TargetFolderMode == "preserve" && i.FolderPath != nil {
		path = *i.FolderPath
	}
	tags := []string{}
	if o.TagStrategy == "keep_source_tags" {
		tags = i.SourceTags
	}
	url := ""
	if i.URL != nil {
		url = *i.URL
	}
	return domain.IngestBookmarkRequest{URL: url, Title: i.Title, Tags: tags, FolderPath: path, DedupeStrategy: "merge"}
}
func (r *PostgresRepository) ListImportTasks(ctx context.Context, userID string) ([]domain.ImportTask, error) {
	rows, err := r.pool.Query(ctx, `select id,name,source_type,mode,status,file_name,total_count,valid_count,invalid_count,duplicate_in_file_count,duplicate_existing_count,created_count,merged_count,skipped_count,failed_count,archive_queued_count,archive_success_count,archive_failed_count,created_at,updated_at,completed_at from import_tasks where user_id=$1 order by created_at desc`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ImportTask{}
	for rows.Next() {
		v, e := scanImportTask(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (r *PostgresRepository) GetImportTaskDetail(ctx context.Context, userID, id string) (*domain.ImportTaskDetailResponse, error) {
	task, err := scanImportTaskRow(r.pool.QueryRow(ctx, `select id,name,source_type,mode,status,file_name,total_count,valid_count,invalid_count,duplicate_in_file_count,duplicate_existing_count,created_count,merged_count,skipped_count,failed_count,archive_queued_count,archive_success_count,archive_failed_count,created_at,updated_at,completed_at from import_tasks where user_id=$1 and id=$2`, userID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `select id,task_id,position,title,source_url,domain,folder_path,status,dedupe_result,reason,bookmark_id,archived_version_id,has_archive,created_at,updated_at from import_items where user_id=$1 and task_id=$2 order by position`, userID, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.ImportTaskItem{}
	for rows.Next() {
		var v domain.ImportTaskItem
		if err := rows.Scan(&v.ID, &v.TaskID, &v.Index, &v.Title, &v.URL, &v.Domain, &v.FolderPath, &v.Status, &v.DedupeResult, &v.Reason, &v.BookmarkID, &v.ArchivedVersionID, &v.HasArchive, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, v)
	}
	return &domain.ImportTaskDetailResponse{Task: task, Items: items}, rows.Err()
}

type importTaskScanner interface{ Scan(...any) error }

func scanImportTask(row importTaskScanner) (domain.ImportTask, error) { return scanImportTaskRow(row) }
func scanImportTaskRow(row importTaskScanner) (domain.ImportTask, error) {
	var v domain.ImportTask
	err := row.Scan(&v.ID, &v.Name, &v.SourceType, &v.Mode, &v.Status, &v.FileName, &v.TotalCount, &v.ValidCount, &v.InvalidCount, &v.DuplicateInFileCount, &v.DuplicateExistingCount, &v.CreatedCount, &v.MergedCount, &v.SkippedCount, &v.FailedCount, &v.ArchiveQueuedCount, &v.ArchiveSuccessCount, &v.ArchiveFailedCount, &v.CreatedAt, &v.UpdatedAt, &v.CompletedAt)
	return v, err
}

func (r *PostgresRepository) CountActiveShares(ctx context.Context, userID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `select count(*)::int from shares where user_id=$1 and status='active'`, userID).Scan(&n)
	return n, err
}
func (r *PostgresRepository) FindMissingOwnedBookmarkIDs(ctx context.Context, userID string, ids []string) ([]string, error) {
	if len(ids) == 0 {
		return []string{}, nil
	}
	rows, err := r.pool.Query(ctx, `select id::text from bookmarks where user_id=$1 and id=any($2::uuid[])`, userID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	found := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		found[id] = true
	}
	out := []string{}
	for _, id := range ids {
		if !found[id] {
			out = append(out, id)
		}
	}
	return out, rows.Err()
}
func (r *PostgresRepository) CreateShare(ctx context.Context, userID string, in domain.CreateShareRecordInput) (domain.Share, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.Share{}, err
	}
	defer tx.Rollback(ctx)
	var n int
	// Locking the user row serializes active-share capacity checks without using FOR UPDATE on an aggregate.
	if err := tx.QueryRow(ctx, `select id from users where id=$1 for update`, userID).Scan(new(string)); err != nil {
		return domain.Share{}, err
	}
	if err := tx.QueryRow(ctx, `select count(*)::int from shares where user_id=$1 and status='active'`, userID).Scan(&n); err != nil {
		return domain.Share{}, err
	}
	if n >= 50 {
		return domain.Share{}, httperror.BadRequest("ShareActiveLimitExceeded", "每个账号最多保留 50 个活跃分享，请先撤销旧分享。", nil)
	}
	now := time.Now().UTC()
	_, err = tx.Exec(ctx, `insert into shares (id,user_id,public_token,title,description,status,created_at,updated_at) values ($1,$2,$3,$4,$5,'active',$6,$6)`, in.ID, userID, in.PublicToken, in.Title, in.Description, now)
	if err != nil {
		return domain.Share{}, err
	}
	for pos, id := range in.BookmarkIDs {
		_, err = tx.Exec(ctx, `insert into share_items (share_id,bookmark_id,position,created_at) values ($1,$2,$3,$4)`, in.ID, id, pos, now)
		if err != nil {
			return domain.Share{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return domain.Share{}, err
	}
	v, err := r.GetShareDetail(ctx, userID, in.ID)
	if err != nil || v == nil {
		if err == nil {
			err = fmt.Errorf("created share not found")
		}
		return domain.Share{}, err
	}
	return v.Share, nil
}
func (r *PostgresRepository) ListShares(ctx context.Context, userID string) ([]domain.Share, error) {
	rows, err := r.pool.Query(ctx, `select s.id::text,s.title,s.description,s.status,s.public_token,s.created_at,s.updated_at,s.revoked_at,count(si.bookmark_id)::int from shares s left join share_items si on si.share_id=s.id where s.user_id=$1 group by s.id order by s.updated_at desc`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Share{}
	for rows.Next() {
		var v domain.Share
		if err := rows.Scan(&v.ID, &v.Title, &v.Description, &v.Status, &v.PublicToken, &v.CreatedAt, &v.UpdatedAt, &v.RevokedAt, &v.ItemCount); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (r *PostgresRepository) GetShareDetail(ctx context.Context, userID, id string) (*domain.ShareDetail, error) {
	var out domain.ShareDetail
	err := r.pool.QueryRow(ctx, `select id::text,title,description,status,public_token,created_at,updated_at,revoked_at from shares where user_id=$1 and id=$2`, userID, id).Scan(&out.ID, &out.Title, &out.Description, &out.Status, &out.PublicToken, &out.CreatedAt, &out.UpdatedAt, &out.RevokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `select b.id::text,si.position,b.title,b.domain,b.source_url from share_items si inner join bookmarks b on b.id=si.bookmark_id where si.share_id=$1 order by si.position`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out.Items = []domain.ShareOwnerItem{}
	for rows.Next() {
		var item domain.ShareOwnerItem
		if err := rows.Scan(&item.BookmarkID, &item.Position, &item.Title, &item.Domain, &item.SourceURL); err != nil {
			return nil, err
		}
		out.Items = append(out.Items, item)
	}
	out.ItemCount = len(out.Items)
	return &out, rows.Err()
}
func (r *PostgresRepository) UpdateShare(ctx context.Context, userID, id string, in domain.UpdateShareRecordInput) (*domain.ShareDetail, error) {
	current, err := r.GetShareDetail(ctx, userID, id)
	if err != nil || current == nil {
		return current, err
	}
	if current.Status != "active" {
		return nil, httperror.BadRequest("ShareRevoked", "已撤销的分享不可编辑。", nil)
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	title := current.Title
	if in.Title != nil {
		title = *in.Title
	}
	desc := current.Description
	if in.Description != nil {
		desc = *in.Description
	}
	now := time.Now().UTC()
	_, err = tx.Exec(ctx, `update shares set title=$3,description=$4,updated_at=$5 where id=$1 and user_id=$2`, id, userID, title, desc, now)
	if err != nil {
		return nil, err
	}
	if in.BookmarkIDs != nil {
		_, err = tx.Exec(ctx, `delete from share_items where share_id=$1`, id)
		if err != nil {
			return nil, err
		}
		for pos, bid := range *in.BookmarkIDs {
			_, err = tx.Exec(ctx, `insert into share_items (share_id,bookmark_id,position,created_at) values ($1,$2,$3,$4)`, id, bid, pos, now)
			if err != nil {
				return nil, err
			}
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetShareDetail(ctx, userID, id)
}
func (r *PostgresRepository) RevokeShare(ctx context.Context, userID, id string) (*domain.Share, error) {
	now := time.Now().UTC()
	result, err := r.pool.Exec(ctx, `update shares set status='revoked',revoked_at=coalesce(revoked_at,$3),updated_at=$3 where id=$1 and user_id=$2`, id, userID, now)
	if err != nil {
		return nil, err
	}
	if result.RowsAffected() == 0 {
		return nil, nil
	}
	v, err := r.GetShareDetail(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	return &v.Share, nil
}
func (r *PostgresRepository) GetPublicShareByToken(ctx context.Context, token string) (*domain.PublicShareResponse, error) {
	var id, userID, title, desc, email string
	var name *string
	var updated time.Time
	err := r.pool.QueryRow(ctx, `select s.id::text,s.user_id::text,s.title,s.description,u.name,u.email,s.updated_at from shares s inner join users u on u.id=s.user_id where s.public_token=$1 and s.status='active'`, token).Scan(&id, &userID, &title, &desc, &name, &email, &updated)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `select b.id::text,b.title,b.source_url,b.domain,b.note,b.updated_at,b.latest_version_id::text,bi.icon_url from share_items si inner join bookmarks b on b.id=si.bookmark_id left join bookmark_icons bi on bi.hostname=b.domain where si.share_id=$1 and b.user_id=$2 order by si.position`, id, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.PublicShareItem{}
	for rows.Next() {
		var bid string
		var item domain.PublicShareItem
		var latest *string
		if err := rows.Scan(&bid, &item.Title, &item.SourceURL, &item.Domain, &item.Note, &item.UpdatedAt, &latest, &item.FaviconURL); err != nil {
			return nil, err
		}
		item.HasArchive = latest != nil
		item.Tags = []domain.PublicShareTag{}
		tagRows, e := r.pool.Query(ctx, `select t.name,t.color from bookmark_tags bt inner join tags t on t.id=bt.tag_id where bt.bookmark_id=$1 order by t.name`, bid)
		if e != nil {
			return nil, e
		}
		for tagRows.Next() {
			var t domain.PublicShareTag
			if e := tagRows.Scan(&t.Name, &t.Color); e != nil {
				tagRows.Close()
				return nil, e
			}
			item.Tags = append(item.Tags, t)
		}
		tagRows.Close()
		items = append(items, item)
	}
	owner := strings.Split(email, "@")[0]
	if name != nil && strings.TrimSpace(*name) != "" {
		owner = strings.TrimSpace(*name)
	}
	return &domain.PublicShareResponse{Title: title, Description: desc, OwnerDisplayName: owner, ItemCount: len(items), UpdatedAt: updated, Items: items}, rows.Err()
}
func preparedHashes(items []domain.PreparedImportItem) []string {
	r := []string{}
	for _, v := range items {
		if v.NormalizedURLHash != nil {
			r = append(r, *v.NormalizedURLHash)
		}
	}
	return r
}
func newPgImportID(prefix string) string {
	return prefix + auth.NewUUID()
}
