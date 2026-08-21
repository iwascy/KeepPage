package repository

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/keeppage/keeppage/apps/api-go/internal/auth"
	"github.com/keeppage/keeppage/apps/api-go/internal/domain"
)

func (r *MemoryRepository) GetAIProviderSetting(_ context.Context, userID string) (*domain.AIProviderSettingRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	record, ok := r.aiSettings[userID]
	if !ok {
		return nil, nil
	}
	copy := record
	return &copy, nil
}

func (r *MemoryRepository) UpsertAIProviderSetting(_ context.Context, record domain.AIProviderSettingRecord) (domain.AIProviderSettingRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	if current, ok := r.aiSettings[record.UserID]; ok {
		record.CreatedAt = current.CreatedAt
	} else {
		record.CreatedAt = now
	}
	record.UpdatedAt = now
	r.aiSettings[record.UserID] = record
	return record, nil
}

func (r *MemoryRepository) ListAIOrganizationSourceItems(_ context.Context, userID string) ([]domain.AIOrganizationSourceItem, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]domain.AIOrganizationSourceItem, 0, len(r.bookmarks[userID]))
	for _, bookmark := range r.bookmarks[userID] {
		if strings.TrimSpace(bookmark.Title) == "" && strings.TrimSpace(bookmark.Domain) == "" {
			continue
		}
		item := domain.AIOrganizationSourceItem{BookmarkID: bookmark.ID, UpdatedAt: bookmark.UpdatedAt, Title: bookmark.Title, Site: bookmark.Domain}
		if bookmark.Folder != nil {
			id, path := bookmark.Folder.ID, bookmark.Folder.Path
			item.FolderID, item.FolderPath = &id, &path
		}
		for _, tag := range bookmark.Tags {
			item.TagIDs = append(item.TagIDs, tag.ID)
			item.TagNames = append(item.TagNames, tag.Name)
		}
		result = append(result, item)
	}
	return result, nil
}

func (r *MemoryRepository) CreateAIOrganizationJob(_ context.Context, userID string, totalItems int) (domain.AIOrganizationJob, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, job := range r.aiJobs {
		if job.UserID == userID && isActiveAIJob(job.Status) {
			return job, nil
		}
	}
	now := time.Now().UTC()
	started := now
	job := domain.AIOrganizationJob{ID: auth.NewUUID(), UserID: userID, Status: domain.AIJobQueued, TotalItems: totalItems, StartedAt: &started, CreatedAt: now, UpdatedAt: now}
	r.aiJobs[job.ID] = job
	return job, nil
}

func isActiveAIJob(status string) bool {
	return status == domain.AIJobQueued || status == domain.AIJobClassifying || status == domain.AIJobApplying
}

func (r *MemoryRepository) GetCurrentAIOrganizationJob(_ context.Context, userID string) (*domain.AIOrganizationJob, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var found *domain.AIOrganizationJob
	for _, job := range r.aiJobs {
		if job.UserID == userID && (found == nil || job.CreatedAt.After(found.CreatedAt)) {
			copy := job
			found = &copy
		}
	}
	return found, nil
}

func (r *MemoryRepository) GetAIOrganizationJob(_ context.Context, userID, jobID string) (*domain.AIOrganizationJob, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	job, ok := r.aiJobs[jobID]
	if !ok || job.UserID != userID {
		return nil, nil
	}
	copy := job
	return &copy, nil
}

func (r *MemoryRepository) UpdateAIOrganizationJob(_ context.Context, userID, jobID string, p domain.AIOrganizationJobProgress) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	job, ok := r.aiJobs[jobID]
	if !ok || job.UserID != userID {
		return ErrNotFound
	}
	job.Status, job.ProcessedItems, job.UpdatedItems, job.UnchangedItems = p.Status, p.ProcessedItems, p.UpdatedItems, p.UnchangedItems
	job.LowConfidenceItems, job.SkippedItems, job.FolderUpdatedItems, job.TagsUpdatedItems = p.LowConfidenceItems, p.SkippedItems, p.FolderUpdatedItems, p.TagsUpdatedItems
	job.RequestCount, job.ErrorCode, job.ErrorMessage, job.CompletedAt, job.UpdatedAt = p.RequestCount, p.ErrorCode, p.ErrorMessage, p.CompletedAt, time.Now().UTC()
	r.aiJobs[jobID] = job
	return nil
}

func (r *MemoryRepository) ApplyAIOrganizationAssignments(_ context.Context, userID, jobID string, source []domain.AIOrganizationSourceItem, assignments []domain.AIOrganizationAssignment, folders []domain.Folder, tags []domain.Tag, threshold float64) (domain.AIOrganizationJobProgress, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
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
	indexByID := map[string]int{}
	for i, b := range r.bookmarks[userID] {
		indexByID[b.ID] = i
	}
	p := domain.AIOrganizationJobProgress{Status: domain.AIJobCompleted, ProcessedItems: len(source)}
	items := make([]domain.AIOrganizationJobItem, 0, len(source))
	for _, s := range source {
		item := domain.AIOrganizationJobItem{JobID: jobID, BookmarkID: s.BookmarkID, BookmarkUpdatedAtSnapshot: s.UpdatedAt, Title: s.Title, Site: s.Site, SourceFolderID: s.FolderID, SourceFolderPath: s.FolderPath, SourceTagIDs: append([]string(nil), s.TagIDs...), SourceTags: append([]string(nil), s.TagNames...)}
		item.TargetFolderID = s.FolderID
		item.TargetFolderPath = s.FolderPath
		item.TargetTagIDs = append([]string(nil), s.TagIDs...)
		item.TargetTags = append([]string(nil), s.TagNames...)
		i, exists := indexByID[s.BookmarkID]
		a, assigned := assignmentByID[s.BookmarkID]
		if !exists || !r.bookmarks[userID][i].UpdatedAt.Equal(s.UpdatedAt) || !assigned {
			item.Status = domain.AIItemSkipped
			p.SkippedItems++
			items = append(items, item)
			continue
		}
		confidence := a.Confidence
		item.Confidence = &confidence
		if confidence < threshold {
			item.Status = domain.AIItemLowConfidence
			p.LowConfidenceItems++
			items = append(items, item)
			continue
		}
		if a.FolderID != nil {
			if _, ok := folderByID[*a.FolderID]; !ok {
				item.Status = domain.AIItemSkipped
				p.SkippedItems++
				items = append(items, item)
				continue
			}
		}
		valid := true
		for _, id := range a.TagIDs {
			if _, ok := tagByID[id]; !ok {
				valid = false
			}
		}
		if !valid {
			item.Status = domain.AIItemSkipped
			p.SkippedItems++
			items = append(items, item)
			continue
		}
		bookmark := &r.bookmarks[userID][i]
		folderChanged := !sameOptionalString(s.FolderID, a.FolderID)
		tagsChanged := !sameStringSet(s.TagIDs, a.TagIDs)
		if !folderChanged && !tagsChanged {
			item.Status = domain.AIItemUnchanged
			p.UnchangedItems++
		} else {
			item.Status = domain.AIItemUpdated
			p.UpdatedItems++
			if folderChanged {
				p.FolderUpdatedItems++
			}
			if tagsChanged {
				p.TagsUpdatedItems++
			}
			if a.FolderID == nil {
				bookmark.Folder = nil
			} else {
				folder := folderByID[*a.FolderID]
				bookmark.Folder = &folder
			}
			bookmark.Tags = nil
			for _, id := range a.TagIDs {
				bookmark.Tags = append(bookmark.Tags, tagByID[id])
			}
			bookmark.UpdatedAt = time.Now().UTC()
		}
		item.TargetFolderID = a.FolderID
		if a.FolderID != nil {
			path := folderByID[*a.FolderID].Path
			item.TargetFolderPath = &path
		}
		item.TargetTagIDs = append([]string(nil), a.TagIDs...)
		for _, id := range a.TagIDs {
			item.TargetTags = append(item.TargetTags, tagByID[id].Name)
		}
		items = append(items, item)
	}
	r.aiJobItems[jobID] = items
	now := time.Now().UTC()
	p.CompletedAt = &now
	return p, nil
}

func sameOptionalString(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
func sameStringSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	aa, bb := append([]string(nil), a...), append([]string(nil), b...)
	sort.Strings(aa)
	sort.Strings(bb)
	for i := range aa {
		if aa[i] != bb[i] {
			return false
		}
	}
	return true
}

func (r *MemoryRepository) ListAIOrganizationJobItems(_ context.Context, userID, jobID, status string, limit, offset int) (domain.AIOrganizationJobItemList, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	job, ok := r.aiJobs[jobID]
	if !ok || job.UserID != userID {
		return domain.AIOrganizationJobItemList{}, ErrNotFound
	}
	filtered := []domain.AIOrganizationJobItem{}
	for _, item := range r.aiJobItems[jobID] {
		if status == "" || item.Status == status {
			filtered = append(filtered, item)
		}
	}
	total := len(filtered)
	start := min(offset, total)
	end := min(start+limit, total)
	return domain.AIOrganizationJobItemList{Items: filtered[start:end], Total: total}, nil
}

func (r *MemoryRepository) FailInterruptedAIOrganizationJobs(_ context.Context) error {
	return nil
}
