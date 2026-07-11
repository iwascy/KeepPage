package domain

import "time"

type ImportExecutionOptions struct {
	Mode             string `json:"mode"`
	TargetFolderMode string `json:"targetFolderMode"`
	TargetFolderPath string `json:"targetFolderPath,omitempty"`
	TagStrategy      string `json:"tagStrategy"`
	TitleStrategy    string `json:"titleStrategy"`
	DedupeStrategy   string `json:"dedupeStrategy"`
}

type ImportRequest struct {
	TaskName   string                  `json:"taskName,omitempty"`
	Name       string                  `json:"name,omitempty"`
	SourceType string                  `json:"sourceType,omitempty"`
	Content    string                  `json:"content,omitempty"`
	RawInput   string                  `json:"rawInput,omitempty"`
	FileName   string                  `json:"fileName,omitempty"`
	Options    *ImportExecutionOptions `json:"options,omitempty"`
}

type PreparedImportItem struct {
	Index             int      `json:"index"`
	Title             string   `json:"title"`
	URL               *string  `json:"url,omitempty"`
	NormalizedURL     *string  `json:"-"`
	NormalizedURLHash *string  `json:"-"`
	Domain            *string  `json:"domain,omitempty"`
	FolderPath        *string  `json:"folderPath,omitempty"`
	SourceTags        []string `json:"sourceTags"`
	Valid             bool     `json:"valid"`
	DuplicateInFile   bool     `json:"duplicateInFile"`
	Reason            *string  `json:"reason,omitempty"`
}

type ImportBookmarkMatch struct {
	NormalizedURLHash string
	BookmarkID        string
	Title             string
	HasArchive        bool
	LatestVersionID   *string
}

type ImportPreviewSummary struct {
	TotalCount             int `json:"totalCount"`
	ValidCount             int `json:"validCount"`
	InvalidCount           int `json:"invalidCount"`
	DuplicateInFileCount   int `json:"duplicateInFileCount"`
	DuplicateExistingCount int `json:"duplicateExistingCount"`
	EstimatedCreateCount   int `json:"estimatedCreateCount"`
	EstimatedMergeCount    int `json:"estimatedMergeCount"`
	EstimatedSkipCount     int `json:"estimatedSkipCount"`
}

type ImportPreviewDistribution struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}

type ImportPreviewResponse struct {
	SourceType string                      `json:"sourceType"`
	FileName   *string                     `json:"fileName,omitempty"`
	Summary    ImportPreviewSummary        `json:"summary"`
	Folders    []ImportPreviewDistribution `json:"folders"`
	Domains    []ImportPreviewDistribution `json:"domains"`
	Samples    []PreparedImportItem        `json:"samples"`
}

type ImportTask struct {
	ID                     string     `json:"id"`
	Name                   string     `json:"name"`
	SourceType             string     `json:"sourceType"`
	Mode                   string     `json:"mode"`
	Status                 string     `json:"status"`
	FileName               *string    `json:"fileName,omitempty"`
	TotalCount             int        `json:"totalCount"`
	ValidCount             int        `json:"validCount"`
	InvalidCount           int        `json:"invalidCount"`
	DuplicateInFileCount   int        `json:"duplicateInFileCount"`
	DuplicateExistingCount int        `json:"duplicateExistingCount"`
	CreatedCount           int        `json:"createdCount"`
	MergedCount            int        `json:"mergedCount"`
	SkippedCount           int        `json:"skippedCount"`
	FailedCount            int        `json:"failedCount"`
	ArchiveQueuedCount     int        `json:"archiveQueuedCount"`
	ArchiveSuccessCount    int        `json:"archiveSuccessCount"`
	ArchiveFailedCount     int        `json:"archiveFailedCount"`
	CreatedAt              time.Time  `json:"createdAt"`
	UpdatedAt              time.Time  `json:"updatedAt"`
	CompletedAt            *time.Time `json:"completedAt,omitempty"`
}

type ImportTaskItem struct {
	ID                string    `json:"id"`
	TaskID            string    `json:"taskId"`
	Index             int       `json:"index"`
	Title             string    `json:"title"`
	URL               *string   `json:"url,omitempty"`
	Domain            *string   `json:"domain,omitempty"`
	FolderPath        *string   `json:"folderPath,omitempty"`
	Status            string    `json:"status"`
	DedupeResult      string    `json:"dedupeResult"`
	Reason            *string   `json:"reason,omitempty"`
	BookmarkID        *string   `json:"bookmarkId,omitempty"`
	ArchivedVersionID *string   `json:"archivedVersionId,omitempty"`
	HasArchive        bool      `json:"hasArchive"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type ImportTaskListResponse struct {
	Items []ImportTask `json:"items"`
}
type ImportTaskDetailResponse struct {
	Task  ImportTask       `json:"task"`
	Items []ImportTaskItem `json:"items"`
}
type ImportTaskCreateResponse struct {
	TaskID string           `json:"taskId"`
	Task   ImportTask       `json:"task"`
	Items  []ImportTaskItem `json:"items"`
}

type Share struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Status      string     `json:"status"`
	PublicToken string     `json:"publicToken"`
	PublicURL   string     `json:"publicUrl"`
	ItemCount   int        `json:"itemCount"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	RevokedAt   *time.Time `json:"revokedAt,omitempty"`
}

type ShareOwnerItem struct {
	BookmarkID string `json:"bookmarkId"`
	Position   int    `json:"position"`
	Title      string `json:"title"`
	Domain     string `json:"domain"`
	SourceURL  string `json:"sourceUrl"`
}
type ShareDetail struct {
	Share
	Items []ShareOwnerItem `json:"items"`
}
type ShareCreateRequest struct {
	Title       string   `json:"title"`
	Description *string  `json:"description,omitempty"`
	BookmarkIDs []string `json:"bookmarkIds"`
}
type ShareUpdateRequest struct {
	Title       *string   `json:"title,omitempty"`
	Description *string   `json:"description,omitempty"`
	BookmarkIDs *[]string `json:"bookmarkIds,omitempty"`
}
type ShareListResponse struct {
	Items []Share `json:"items"`
}
type ShareResponse struct {
	Share Share `json:"share"`
}
type ShareDetailResponse struct {
	Share ShareDetail `json:"share"`
}
type PublicShareTag struct {
	Name  string  `json:"name"`
	Color *string `json:"color,omitempty"`
}
type PublicShareItem struct {
	Title      string           `json:"title"`
	SourceURL  string           `json:"sourceUrl"`
	Domain     string           `json:"domain"`
	FaviconURL *string          `json:"faviconUrl,omitempty"`
	Note       string           `json:"note"`
	Tags       []PublicShareTag `json:"tags"`
	UpdatedAt  time.Time        `json:"updatedAt"`
	HasArchive bool             `json:"hasArchive"`
}
type PublicShareResponse struct {
	Title            string            `json:"title"`
	Description      string            `json:"description"`
	OwnerDisplayName string            `json:"ownerDisplayName"`
	ItemCount        int               `json:"itemCount"`
	UpdatedAt        time.Time         `json:"updatedAt"`
	Items            []PublicShareItem `json:"items"`
}

type CreateImportTaskInput struct {
	TaskName   string
	SourceType string
	FileName   *string
	Options    ImportExecutionOptions
	Preview    ImportPreviewResponse
	Items      []PreparedImportItem
}
type CreateShareRecordInput struct {
	ID          string
	PublicToken string
	Title       string
	Description string
	BookmarkIDs []string
}
type UpdateShareRecordInput struct {
	Title       *string
	Description *string
	BookmarkIDs *[]string
}
