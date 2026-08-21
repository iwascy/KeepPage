package repository

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

func (r *PostgresRepository) GetAIProviderSetting(ctx context.Context, userID string) (*domain.AIProviderSettingRecord, error) {
	var record domain.AIProviderSettingRecord
	err := r.pool.QueryRow(ctx, `select user_id::text,base_url,api_key_ciphertext,model,connection_status,verified_at,created_at,updated_at from ai_provider_settings where user_id=$1`, userID).
		Scan(&record.UserID, &record.BaseURL, &record.APIKeyCiphertext, &record.Model, &record.ConnectionStatus, &record.VerifiedAt, &record.CreatedAt, &record.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &record, err
}

func (r *PostgresRepository) UpsertAIProviderSetting(ctx context.Context, record domain.AIProviderSettingRecord) (domain.AIProviderSettingRecord, error) {
	err := r.pool.QueryRow(ctx, `
		insert into ai_provider_settings(user_id,base_url,api_key_ciphertext,model,connection_status,verified_at)
		values($1,$2,$3,$4,$5,$6)
		on conflict(user_id) do update set base_url=excluded.base_url,api_key_ciphertext=excluded.api_key_ciphertext,model=excluded.model,connection_status=excluded.connection_status,verified_at=excluded.verified_at,updated_at=now()
		returning user_id::text,base_url,api_key_ciphertext,model,connection_status,verified_at,created_at,updated_at`, record.UserID, record.BaseURL, record.APIKeyCiphertext, record.Model, record.ConnectionStatus, record.VerifiedAt).
		Scan(&record.UserID, &record.BaseURL, &record.APIKeyCiphertext, &record.Model, &record.ConnectionStatus, &record.VerifiedAt, &record.CreatedAt, &record.UpdatedAt)
	return record, err
}

func (r *PostgresRepository) ListAIOrganizationSourceItems(ctx context.Context, userID string) ([]domain.AIOrganizationSourceItem, error) {
	rows, err := r.pool.Query(ctx, `select b.id::text,b.updated_at,b.title,b.domain,b.folder_id::text,f.path from bookmarks b left join folders f on f.id=b.folder_id where b.user_id=$1 and (btrim(b.title)<>'' or btrim(b.domain)<>'') order by b.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.AIOrganizationSourceItem{}
	index := map[string]int{}
	for rows.Next() {
		var item domain.AIOrganizationSourceItem
		if err := rows.Scan(&item.BookmarkID, &item.UpdatedAt, &item.Title, &item.Site, &item.FolderID, &item.FolderPath); err != nil {
			return nil, err
		}
		index[item.BookmarkID] = len(items)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	tagRows, err := r.pool.Query(ctx, `select bt.bookmark_id::text,t.id::text,t.name from bookmark_tags bt join tags t on t.id=bt.tag_id join bookmarks b on b.id=bt.bookmark_id where b.user_id=$1 order by bt.bookmark_id,t.name`, userID)
	if err != nil {
		return nil, err
	}
	defer tagRows.Close()
	for tagRows.Next() {
		var bookmarkID, id, name string
		if err := tagRows.Scan(&bookmarkID, &id, &name); err != nil {
			return nil, err
		}
		if i, ok := index[bookmarkID]; ok {
			items[i].TagIDs = append(items[i].TagIDs, id)
			items[i].TagNames = append(items[i].TagNames, name)
		}
	}
	return items, tagRows.Err()
}

func (r *PostgresRepository) CreateAIOrganizationJob(ctx context.Context, userID string, totalItems int) (domain.AIOrganizationJob, error) {
	var job domain.AIOrganizationJob
	err := r.pool.QueryRow(ctx, `insert into ai_organization_jobs(id,user_id,status,total_items,started_at) values($1,$2,$3,$4,now()) returning `+aiJobColumns, auth.NewUUID(), userID, domain.AIJobQueued, totalItems).Scan(aiJobScan(&job)...)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			current, e := r.GetCurrentAIOrganizationJob(ctx, userID)
			if e != nil {
				return job, e
			}
			if current != nil {
				return *current, nil
			}
		}
	}
	return job, err
}

const aiJobColumns = `id::text,user_id::text,status,total_items,processed_items,updated_items,unchanged_items,low_confidence_items,skipped_items,folder_updated_items,tags_updated_items,request_count,error_code,error_message,started_at,completed_at,created_at,updated_at`

func aiJobScan(job *domain.AIOrganizationJob) []any {
	return []any{&job.ID, &job.UserID, &job.Status, &job.TotalItems, &job.ProcessedItems, &job.UpdatedItems, &job.UnchangedItems, &job.LowConfidenceItems, &job.SkippedItems, &job.FolderUpdatedItems, &job.TagsUpdatedItems, &job.RequestCount, &job.ErrorCode, &job.ErrorMessage, &job.StartedAt, &job.CompletedAt, &job.CreatedAt, &job.UpdatedAt}
}

func (r *PostgresRepository) GetCurrentAIOrganizationJob(ctx context.Context, userID string) (*domain.AIOrganizationJob, error) {
	var job domain.AIOrganizationJob
	err := r.pool.QueryRow(ctx, `select `+aiJobColumns+` from ai_organization_jobs where user_id=$1 order by created_at desc limit 1`, userID).Scan(aiJobScan(&job)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &job, err
}
func (r *PostgresRepository) GetAIOrganizationJob(ctx context.Context, userID, jobID string) (*domain.AIOrganizationJob, error) {
	var job domain.AIOrganizationJob
	err := r.pool.QueryRow(ctx, `select `+aiJobColumns+` from ai_organization_jobs where user_id=$1 and id=$2`, userID, jobID).Scan(aiJobScan(&job)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &job, err
}

func (r *PostgresRepository) UpdateAIOrganizationJob(ctx context.Context, userID, jobID string, p domain.AIOrganizationJobProgress) error {
	command, err := r.pool.Exec(ctx, `update ai_organization_jobs set status=$3,processed_items=$4,updated_items=$5,unchanged_items=$6,low_confidence_items=$7,skipped_items=$8,folder_updated_items=$9,tags_updated_items=$10,request_count=$11,error_code=$12,error_message=$13,completed_at=$14,updated_at=now() where user_id=$1 and id=$2`, userID, jobID, p.Status, p.ProcessedItems, p.UpdatedItems, p.UnchangedItems, p.LowConfidenceItems, p.SkippedItems, p.FolderUpdatedItems, p.TagsUpdatedItems, p.RequestCount, p.ErrorCode, p.ErrorMessage, p.CompletedAt)
	if err == nil && command.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (r *PostgresRepository) ApplyAIOrganizationAssignments(ctx context.Context, userID, jobID string, source []domain.AIOrganizationSourceItem, assignments []domain.AIOrganizationAssignment, folders []domain.Folder, tags []domain.Tag, threshold float64) (domain.AIOrganizationJobProgress, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domain.AIOrganizationJobProgress{}, err
	}
	defer tx.Rollback(ctx)
	currentFolderIDs := map[string]bool{}
	folderRows, err := tx.Query(ctx, `select id::text from folders where user_id=$1`, userID)
	if err != nil {
		return domain.AIOrganizationJobProgress{}, err
	}
	for folderRows.Next() {
		var id string
		if err = folderRows.Scan(&id); err != nil {
			folderRows.Close()
			return domain.AIOrganizationJobProgress{}, err
		}
		currentFolderIDs[id] = true
	}
	folderRows.Close()
	if err = folderRows.Err(); err != nil {
		return domain.AIOrganizationJobProgress{}, err
	}
	currentTagIDs := map[string]bool{}
	tagRows, err := tx.Query(ctx, `select id::text from tags where user_id=$1`, userID)
	if err != nil {
		return domain.AIOrganizationJobProgress{}, err
	}
	for tagRows.Next() {
		var id string
		if err = tagRows.Scan(&id); err != nil {
			tagRows.Close()
			return domain.AIOrganizationJobProgress{}, err
		}
		currentTagIDs[id] = true
	}
	tagRows.Close()
	if err = tagRows.Err(); err != nil {
		return domain.AIOrganizationJobProgress{}, err
	}
	folderByID := map[string]domain.Folder{}
	for _, f := range folders {
		folderByID[f.ID] = f
	}
	tagByID := map[string]domain.Tag{}
	for _, t := range tags {
		tagByID[t.ID] = t
	}
	assignmentByID := map[string]domain.AIOrganizationAssignment{}
	for _, a := range assignments {
		assignmentByID[a.BookmarkID] = a
	}
	p := domain.AIOrganizationJobProgress{Status: domain.AIJobCompleted, ProcessedItems: len(source)}
	for _, s := range source {
		a, assigned := assignmentByID[s.BookmarkID]
		status := domain.AIItemSkipped
		var confidence *float64
		sourceFolderID := s.FolderID
		if sourceFolderID != nil && !currentFolderIDs[*sourceFolderID] {
			sourceFolderID = nil
		}
		targetFolderID := sourceFolderID
		targetTagIDs := append([]string(nil), s.TagIDs...)
		errorCode := ""
		var currentUpdatedAt time.Time
		rowErr := tx.QueryRow(ctx, `select updated_at from bookmarks where id=$1 and user_id=$2 for update`, s.BookmarkID, userID).Scan(&currentUpdatedAt)
		if rowErr != nil || !currentUpdatedAt.Equal(s.UpdatedAt) || !assigned {
			p.SkippedItems++
			errorCode = "BookmarkChanged"
		} else {
			value := a.Confidence
			confidence = &value
			if a.Confidence < threshold {
				status = domain.AIItemLowConfidence
				p.LowConfidenceItems++
			} else if !validCurrentAssignment(a, currentFolderIDs, currentTagIDs) {
				status = domain.AIItemSkipped
				p.SkippedItems++
				errorCode = "UnknownTaxonomyID"
			} else {
				targetFolderID = a.FolderID
				targetTagIDs = uniqueStrings(a.TagIDs)
				folderChanged := !sameOptionalString(s.FolderID, a.FolderID)
				tagsChanged := !sameStringSet(s.TagIDs, targetTagIDs)
				if !folderChanged && !tagsChanged {
					status = domain.AIItemUnchanged
					p.UnchangedItems++
				} else {
					status = domain.AIItemUpdated
					p.UpdatedItems++
					if folderChanged {
						p.FolderUpdatedItems++
					}
					if tagsChanged {
						p.TagsUpdatedItems++
					}
					if _, err = tx.Exec(ctx, `update bookmarks set folder_id=$3,updated_at=now() where id=$1 and user_id=$2`, s.BookmarkID, userID, targetFolderID); err != nil {
						return p, err
					}
					if _, err = tx.Exec(ctx, `delete from bookmark_tags where bookmark_id=$1`, s.BookmarkID); err != nil {
						return p, err
					}
					for _, tagID := range targetTagIDs {
						if _, err = tx.Exec(ctx, `insert into bookmark_tags(bookmark_id,tag_id) values($1,$2)`, s.BookmarkID, tagID); err != nil {
							return p, err
						}
					}
				}
			}
		}
		sourceTagsJSON, _ := json.Marshal(s.TagIDs)
		targetTagsJSON, _ := json.Marshal(targetTagIDs)
		var errorValue *string
		if errorCode != "" {
			errorValue = &errorCode
		}
		_, err = tx.Exec(ctx, `insert into ai_organization_job_items(job_id,bookmark_id,bookmark_updated_at_snapshot,title_snapshot,site_snapshot,source_folder_id,target_folder_id,source_tag_ids,target_tag_ids,confidence,status,error_code) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)`, jobID, s.BookmarkID, s.UpdatedAt, s.Title, s.Site, sourceFolderID, targetFolderID, string(sourceTagsJSON), string(targetTagsJSON), confidence, status, errorValue)
		if err != nil {
			return p, err
		}
	}
	now := time.Now().UTC()
	p.CompletedAt = &now
	if _, err = tx.Exec(ctx, `update ai_organization_jobs set status=$3,processed_items=$4,updated_items=$5,unchanged_items=$6,low_confidence_items=$7,skipped_items=$8,folder_updated_items=$9,tags_updated_items=$10,completed_at=$11,updated_at=now() where id=$1 and user_id=$2`, jobID, userID, p.Status, p.ProcessedItems, p.UpdatedItems, p.UnchangedItems, p.LowConfidenceItems, p.SkippedItems, p.FolderUpdatedItems, p.TagsUpdatedItems, p.CompletedAt); err != nil {
		return p, err
	}
	if err = tx.Commit(ctx); err != nil {
		return p, err
	}
	return p, nil
}

func validAssignment(a domain.AIOrganizationAssignment, folders map[string]domain.Folder, tags map[string]domain.Tag) bool {
	if a.FolderID != nil {
		if _, ok := folders[*a.FolderID]; !ok {
			return false
		}
	}
	for _, id := range a.TagIDs {
		if _, ok := tags[id]; !ok {
			return false
		}
	}
	return true
}

func validCurrentAssignment(a domain.AIOrganizationAssignment, folders, tags map[string]bool) bool {
	if a.FolderID != nil && !folders[*a.FolderID] {
		return false
	}
	for _, id := range a.TagIDs {
		if !tags[id] {
			return false
		}
	}
	return true
}
func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, v := range values {
		if !seen[v] {
			seen[v] = true
			result = append(result, v)
		}
	}
	sort.Strings(result)
	return result
}

func (r *PostgresRepository) ListAIOrganizationJobItems(ctx context.Context, userID, jobID, status string, limit, offset int) (domain.AIOrganizationJobItemList, error) {
	var exists bool
	if err := r.pool.QueryRow(ctx, `select exists(select 1 from ai_organization_jobs where id=$1 and user_id=$2)`, jobID, userID).Scan(&exists); err != nil {
		return domain.AIOrganizationJobItemList{}, err
	}
	if !exists {
		return domain.AIOrganizationJobItemList{}, ErrNotFound
	}
	where := `i.job_id=$1`
	args := []any{jobID}
	if status != "" {
		args = append(args, status)
		where += ` and i.status=$2`
	}
	var total int
	if err := r.pool.QueryRow(ctx, `select count(*) from ai_organization_job_items i where `+where, args...).Scan(&total); err != nil {
		return domain.AIOrganizationJobItemList{}, err
	}
	args = append(args, limit, offset)
	limitPos := len(args) - 1
	offsetPos := len(args)
	rows, err := r.pool.Query(ctx, `select i.bookmark_id::text,i.title_snapshot,i.site_snapshot,i.status,i.source_folder_id::text,sf.path,i.target_folder_id::text,tf.path,i.source_tag_ids,i.target_tag_ids,i.confidence,i.error_code from ai_organization_job_items i left join folders sf on sf.id=i.source_folder_id left join folders tf on tf.id=i.target_folder_id where `+where+` order by i.title_snapshot limit $`+itoa(limitPos)+` offset $`+itoa(offsetPos), args...)
	if err != nil {
		return domain.AIOrganizationJobItemList{}, err
	}
	defer rows.Close()
	allTags, err := r.ListTags(ctx, userID)
	if err != nil {
		return domain.AIOrganizationJobItemList{}, err
	}
	tagNames := map[string]string{}
	for _, tag := range allTags {
		tagNames[tag.ID] = tag.Name
	}
	result := domain.AIOrganizationJobItemList{Items: []domain.AIOrganizationJobItem{}, Total: total}
	for rows.Next() {
		var item domain.AIOrganizationJobItem
		var sourceJSON, targetJSON []byte
		if err := rows.Scan(&item.BookmarkID, &item.Title, &item.Site, &item.Status, &item.SourceFolderID, &item.SourceFolderPath, &item.TargetFolderID, &item.TargetFolderPath, &sourceJSON, &targetJSON, &item.Confidence, &item.ErrorCode); err != nil {
			return result, err
		}
		_ = json.Unmarshal(sourceJSON, &item.SourceTagIDs)
		_ = json.Unmarshal(targetJSON, &item.TargetTagIDs)
		for _, id := range item.SourceTagIDs {
			if name := tagNames[id]; name != "" {
				item.SourceTags = append(item.SourceTags, name)
			}
		}
		for _, id := range item.TargetTagIDs {
			if name := tagNames[id]; name != "" {
				item.TargetTags = append(item.TargetTags, name)
			}
		}
		result.Items = append(result.Items, item)
	}
	return result, rows.Err()
}

func (r *PostgresRepository) FailInterruptedAIOrganizationJobs(ctx context.Context) error {
	_, err := r.pool.Exec(ctx, `
		update ai_organization_jobs
		set status='failed', error_code='AIJobInterrupted', error_message='服务重启导致任务中断，请重新整理。', completed_at=now(), updated_at=now()
		where status in ('queued','classifying','applying')
	`)
	return err
}

func itoa(value int) string {
	const digits = "0123456789"
	if value < 10 {
		return string(digits[value])
	}
	return string(digits[value/10]) + string(digits[value%10])
}
