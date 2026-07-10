package repository

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
	"github.com/keeppage/keeppage/apps/api-go/internal/httperror"
)

type memoryImportShareState struct {
	mu       sync.RWMutex
	tasks    map[string]map[string]domain.ImportTaskDetailResponse
	shares   map[string]memoryShare
	tokenIDs map[string]string
}
type memoryShare struct {
	userID      string
	value       domain.Share
	bookmarkIDs []string
}

var memoryImportShareStates sync.Map // map[*MemoryRepository]*memoryImportShareState
func (r *MemoryRepository) importShareState() *memoryImportShareState {
	v, _ := memoryImportShareStates.LoadOrStore(r, &memoryImportShareState{tasks: map[string]map[string]domain.ImportTaskDetailResponse{}, shares: map[string]memoryShare{}, tokenIDs: map[string]string{}})
	return v.(*memoryImportShareState)
}

func (r *MemoryRepository) FindImportBookmarkMatches(_ context.Context, userID string, hashes []string) ([]domain.ImportBookmarkMatch, error) {
	wanted := map[string]bool{}
	for _, v := range hashes {
		wanted[v] = true
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := []domain.ImportBookmarkMatch{}
	for _, b := range r.bookmarks[userID] {
		h := hashNormalizedURL(b.SourceURL)
		if wanted[h] {
			out = append(out, domain.ImportBookmarkMatch{NormalizedURLHash: h, BookmarkID: b.ID, Title: b.Title, HasArchive: b.LatestVersionID != nil, LatestVersionID: b.LatestVersionID})
		}
	}
	return out, nil
}
func (r *MemoryRepository) CreateImportTask(ctx context.Context, userID string, input domain.CreateImportTaskInput) (domain.ImportTaskDetailResponse, error) {
	matches, err := r.FindImportBookmarkMatches(ctx, userID, hashesFromPrepared(input.Items))
	if err != nil {
		return domain.ImportTaskDetailResponse{}, err
	}
	matchByHash := map[string]domain.ImportBookmarkMatch{}
	for _, m := range matches {
		matchByHash[m.NormalizedURLHash] = m
	}
	now := time.Now().UTC()
	task := domain.ImportTask{ID: newImportID("imp_"), Name: input.TaskName, SourceType: input.SourceType, Mode: input.Options.Mode, Status: "completed", FileName: input.FileName, TotalCount: input.Preview.Summary.TotalCount, ValidCount: input.Preview.Summary.ValidCount, InvalidCount: input.Preview.Summary.InvalidCount, DuplicateInFileCount: input.Preview.Summary.DuplicateInFileCount, DuplicateExistingCount: input.Preview.Summary.DuplicateExistingCount, CreatedAt: now, UpdatedAt: now, CompletedAt: &now}
	items := make([]domain.ImportTaskItem, 0, len(input.Items))
	for _, prepared := range input.Items {
		item := domain.ImportTaskItem{ID: newImportID("imp_item_"), TaskID: task.ID, Index: prepared.Index, Title: prepared.Title, URL: prepared.URL, Domain: prepared.Domain, FolderPath: prepared.FolderPath, HasArchive: false, CreatedAt: now, UpdatedAt: now}
		if !prepared.Valid {
			item.Status = "skipped"
			item.DedupeResult = "invalid_input"
			item.Reason = prepared.Reason
			task.SkippedCount++
			items = append(items, item)
			continue
		}
		if prepared.DuplicateInFile {
			item.Status = "skipped"
			item.DedupeResult = "skipped_duplicate"
			item.Reason = prepared.Reason
			task.SkippedCount++
			items = append(items, item)
			continue
		}
		var existing *domain.ImportBookmarkMatch
		if prepared.NormalizedURLHash != nil {
			if v, ok := matchByHash[*prepared.NormalizedURLHash]; ok {
				existing = &v
			}
		}
		if existing != nil {
			item.BookmarkID = &existing.BookmarkID
			item.ArchivedVersionID = existing.LatestVersionID
			item.HasArchive = existing.HasArchive
			if input.Options.DedupeStrategy == "skip" {
				item.Status = "skipped"
				item.DedupeResult = "skipped_existing"
				reason := "站内已存在同一链接，按当前策略跳过。"
				item.Reason = &reason
				task.SkippedCount++
			} else {
				item.Status = "deduplicated"
				item.DedupeResult = "merged_existing"
				reason := "已合并到现有书签。"
				if existing.HasArchive {
					reason = "已合并到现有书签，且该书签已有归档。"
				}
				item.Reason = &reason
				task.MergedCount++
				if input.Options.DedupeStrategy == "update_metadata" {
					_, _ = r.IngestBookmark(ctx, userID, importIngest(prepared, input.Options))
				}
			}
			items = append(items, item)
			continue
		}
		result, err := r.IngestBookmark(ctx, userID, importIngest(prepared, input.Options))
		if err != nil {
			item.Status = "failed"
			item.DedupeResult = "none"
			reason := err.Error()
			item.Reason = &reason
			task.FailedCount++
			items = append(items, item)
			continue
		}
		item.Status = "created_bookmark"
		item.DedupeResult = "created_bookmark"
		reason := "已完成轻导入。"
		item.Reason = &reason
		item.BookmarkID = &result.Bookmark.ID
		task.CreatedCount++
		items = append(items, item)
	}
	if task.FailedCount > 0 || task.InvalidCount > 0 {
		task.Status = "partial_failed"
	}
	detail := domain.ImportTaskDetailResponse{Task: task, Items: items}
	state := r.importShareState()
	state.mu.Lock()
	if state.tasks[userID] == nil {
		state.tasks[userID] = map[string]domain.ImportTaskDetailResponse{}
	}
	state.tasks[userID][task.ID] = detail
	state.mu.Unlock()
	return detail, nil
}
func importIngest(i domain.PreparedImportItem, o domain.ImportExecutionOptions) domain.IngestBookmarkRequest {
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
	title := i.Title
	if i.URL == nil {
		title = ""
	}
	u := ""
	if i.URL != nil {
		u = *i.URL
	}
	return domain.IngestBookmarkRequest{URL: u, Title: title, Tags: tags, FolderPath: path, DedupeStrategy: "merge"}
}
func (r *MemoryRepository) ListImportTasks(_ context.Context, userID string) ([]domain.ImportTask, error) {
	state := r.importShareState()
	state.mu.RLock()
	defer state.mu.RUnlock()
	out := []domain.ImportTask{}
	for _, v := range state.tasks[userID] {
		out = append(out, v.Task)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}
func (r *MemoryRepository) GetImportTaskDetail(_ context.Context, userID, taskID string) (*domain.ImportTaskDetailResponse, error) {
	state := r.importShareState()
	state.mu.RLock()
	defer state.mu.RUnlock()
	v, ok := state.tasks[userID][taskID]
	if !ok {
		return nil, nil
	}
	return &v, nil
}

func (r *MemoryRepository) CountActiveShares(_ context.Context, userID string) (int, error) {
	state := r.importShareState()
	state.mu.RLock()
	defer state.mu.RUnlock()
	n := 0
	for _, v := range state.shares {
		if v.userID == userID && v.value.Status == "active" {
			n++
		}
	}
	return n, nil
}
func (r *MemoryRepository) FindMissingOwnedBookmarkIDs(_ context.Context, userID string, ids []string) ([]string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	found := map[string]bool{}
	for _, b := range r.bookmarks[userID] {
		found[b.ID] = true
	}
	missing := []string{}
	for _, id := range ids {
		if !found[id] {
			missing = append(missing, id)
		}
	}
	return missing, nil
}
func (r *MemoryRepository) CreateShare(ctx context.Context, userID string, input domain.CreateShareRecordInput) (domain.Share, error) {
	state := r.importShareState()
	state.mu.Lock()
	defer state.mu.Unlock()
	active := 0
	for _, v := range state.shares {
		if v.userID == userID && v.value.Status == "active" {
			active++
		}
	}
	if active >= 50 {
		return domain.Share{}, httperror.BadRequest("ShareActiveLimitExceeded", "每个账号最多保留 50 个活跃分享，请先撤销旧分享。", nil)
	}
	r.mu.RLock()
	found := map[string]bool{}
	for _, b := range r.bookmarks[userID] {
		found[b.ID] = true
	}
	r.mu.RUnlock()
	for _, id := range input.BookmarkIDs {
		if !found[id] {
			return domain.Share{}, httperror.BadRequest("ShareBookmarkInvalid", "部分书签不存在、不属于当前账号，或无法分享（例如私密书签）。", map[string]any{"missingIds": []string{id}})
		}
	}
	now := time.Now().UTC()
	value := domain.Share{ID: input.ID, Title: input.Title, Description: input.Description, Status: "active", PublicToken: input.PublicToken, ItemCount: len(input.BookmarkIDs), CreatedAt: now, UpdatedAt: now}
	state.shares[value.ID] = memoryShare{userID: userID, value: value, bookmarkIDs: append([]string(nil), input.BookmarkIDs...)}
	state.tokenIDs[value.PublicToken] = value.ID
	return value, nil
}
func (r *MemoryRepository) ListShares(_ context.Context, userID string) ([]domain.Share, error) {
	state := r.importShareState()
	state.mu.RLock()
	defer state.mu.RUnlock()
	out := []domain.Share{}
	for _, v := range state.shares {
		if v.userID == userID {
			out = append(out, shareSummaryMemory(r, v))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}
func (r *MemoryRepository) GetShareDetail(_ context.Context, userID, id string) (*domain.ShareDetail, error) {
	state := r.importShareState()
	state.mu.RLock()
	v, ok := state.shares[id]
	state.mu.RUnlock()
	if !ok || v.userID != userID {
		return nil, nil
	}
	return shareDetailMemory(r, v), nil
}
func (r *MemoryRepository) UpdateShare(ctx context.Context, userID, id string, input domain.UpdateShareRecordInput) (*domain.ShareDetail, error) {
	state := r.importShareState()
	state.mu.Lock()
	v, ok := state.shares[id]
	if !ok || v.userID != userID {
		state.mu.Unlock()
		return nil, nil
	}
	if v.value.Status != "active" {
		state.mu.Unlock()
		return nil, httperror.BadRequest("ShareRevoked", "已撤销的分享不可编辑。", nil)
	}
	if input.Title != nil {
		v.value.Title = *input.Title
	}
	if input.Description != nil {
		v.value.Description = *input.Description
	}
	if input.BookmarkIDs != nil {
		state.mu.Unlock()
		missing, err := r.FindMissingOwnedBookmarkIDs(ctx, userID, *input.BookmarkIDs)
		if err != nil {
			return nil, err
		}
		if len(missing) > 0 {
			return nil, httperror.BadRequest("ShareBookmarkInvalid", "部分书签不存在、不属于当前账号，或无法分享（例如私密书签）。", map[string]any{"missingIds": missing})
		}
		state.mu.Lock()
		v = state.shares[id]
		v.bookmarkIDs = append([]string(nil), *input.BookmarkIDs...)
	}
	v.value.UpdatedAt = time.Now().UTC()
	v.value.ItemCount = len(v.bookmarkIDs)
	state.shares[id] = v
	state.mu.Unlock()
	return shareDetailMemory(r, v), nil
}
func (r *MemoryRepository) RevokeShare(_ context.Context, userID, id string) (*domain.Share, error) {
	state := r.importShareState()
	state.mu.Lock()
	defer state.mu.Unlock()
	v, ok := state.shares[id]
	if !ok || v.userID != userID {
		return nil, nil
	}
	if v.value.Status != "revoked" {
		now := time.Now().UTC()
		v.value.Status = "revoked"
		v.value.RevokedAt = &now
		v.value.UpdatedAt = now
		state.shares[id] = v
	}
	out := shareSummaryMemory(r, v)
	return &out, nil
}
func (r *MemoryRepository) GetPublicShareByToken(ctx context.Context, token string) (*domain.PublicShareResponse, error) {
	state := r.importShareState()
	state.mu.RLock()
	id, ok := state.tokenIDs[token]
	v := state.shares[id]
	state.mu.RUnlock()
	if !ok || v.value.Status != "active" {
		return nil, nil
	}
	owner, err := r.GetUserByID(ctx, v.userID)
	if err != nil {
		return nil, err
	}
	detail := shareDetailMemory(r, v)
	items := make([]domain.PublicShareItem, 0, len(detail.Items))
	r.mu.RLock()
	byID := map[string]domain.Bookmark{}
	for _, b := range r.bookmarks[v.userID] {
		byID[b.ID] = b
	}
	r.mu.RUnlock()
	for _, it := range detail.Items {
		b, ok := byID[it.BookmarkID]
		if !ok {
			continue
		}
		tags := make([]domain.PublicShareTag, 0, len(b.Tags))
		for _, t := range b.Tags {
			tags = append(tags, domain.PublicShareTag{Name: t.Name, Color: t.Color})
		}
		items = append(items, domain.PublicShareItem{Title: b.Title, SourceURL: b.SourceURL, Domain: b.Domain, FaviconURL: b.FaviconURL, Note: b.Note, Tags: tags, UpdatedAt: b.UpdatedAt, HasArchive: b.LatestVersionID != nil})
	}
	name := owner.Email
	if owner.Name != nil && *owner.Name != "" {
		name = *owner.Name
	} else if at := len(owner.Email); at > 0 {
		for i, c := range owner.Email {
			if c == '@' {
				name = owner.Email[:i]
				break
			}
		}
	}
	return &domain.PublicShareResponse{Title: v.value.Title, Description: v.value.Description, OwnerDisplayName: name, ItemCount: len(items), UpdatedAt: v.value.UpdatedAt, Items: items}, nil
}
func shareSummaryMemory(r *MemoryRepository, v memoryShare) domain.Share {
	out := v.value
	r.mu.RLock()
	n := 0
	ids := map[string]bool{}
	for _, b := range r.bookmarks[v.userID] {
		ids[b.ID] = true
	}
	r.mu.RUnlock()
	for _, id := range v.bookmarkIDs {
		if ids[id] {
			n++
		}
	}
	out.ItemCount = n
	return out
}
func shareDetailMemory(r *MemoryRepository, v memoryShare) *domain.ShareDetail {
	out := domain.ShareDetail{Share: shareSummaryMemory(r, v), Items: []domain.ShareOwnerItem{}}
	r.mu.RLock()
	byID := map[string]domain.Bookmark{}
	for _, b := range r.bookmarks[v.userID] {
		byID[b.ID] = b
	}
	r.mu.RUnlock()
	for pos, id := range v.bookmarkIDs {
		if b, ok := byID[id]; ok {
			out.Items = append(out.Items, domain.ShareOwnerItem{BookmarkID: id, Position: pos, Title: b.Title, Domain: b.Domain, SourceURL: b.SourceURL})
		}
	}
	out.ItemCount = len(out.Items)
	return &out
}
func hashesFromPrepared(items []domain.PreparedImportItem) []string {
	out := []string{}
	for _, i := range items {
		if i.NormalizedURLHash != nil {
			out = append(out, *i.NormalizedURLHash)
		}
	}
	return out
}
func newImportID(prefix string) string {
	return prefix + auth.NewUUID()
}
