package domain

import "time"

const (
	AIJobQueued         = "queued"
	AIJobClassifying    = "classifying"
	AIJobApplying       = "applying"
	AIJobCompleted      = "completed"
	AIJobFailed         = "failed"
	AIJobCancelled      = "cancelled"
	AIItemUpdated       = "updated"
	AIItemUnchanged     = "unchanged"
	AIItemLowConfidence = "low_confidence"
	AIItemSkipped       = "skipped"
)

type AIProviderSettingRecord struct {
	UserID           string
	BaseURL          string
	APIKeyCiphertext string
	Model            string
	ConnectionStatus string
	VerifiedAt       *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type AISettingsResponse struct {
	BaseURL          string     `json:"baseUrl"`
	Model            string     `json:"model"`
	HasAPIKey        bool       `json:"hasApiKey"`
	KeyPreview       string     `json:"keyPreview,omitempty"`
	ConnectionStatus string     `json:"connectionStatus"`
	VerifiedAt       *time.Time `json:"verifiedAt,omitempty"`
}

type AISettingsUpdateRequest struct {
	BaseURL string  `json:"baseUrl"`
	APIKey  *string `json:"apiKey,omitempty"`
	Model   string  `json:"model"`
}

type AISettingsTestResponse struct {
	OK            bool   `json:"ok"`
	ResponseModel string `json:"responseModel,omitempty"`
	LatencyMS     int64  `json:"latencyMs"`
}

type AIOrganizationJob struct {
	ID                 string     `json:"id"`
	UserID             string     `json:"-"`
	Status             string     `json:"status"`
	TotalItems         int        `json:"totalItems"`
	ProcessedItems     int        `json:"processedItems"`
	UpdatedItems       int        `json:"updatedItems"`
	UnchangedItems     int        `json:"unchangedItems"`
	LowConfidenceItems int        `json:"lowConfidenceItems"`
	SkippedItems       int        `json:"skippedItems"`
	FolderUpdatedItems int        `json:"folderUpdatedItems"`
	TagsUpdatedItems   int        `json:"tagsUpdatedItems"`
	RequestCount       int        `json:"requestCount"`
	ErrorCode          *string    `json:"errorCode,omitempty"`
	ErrorMessage       *string    `json:"errorMessage,omitempty"`
	StartedAt          *time.Time `json:"startedAt,omitempty"`
	CompletedAt        *time.Time `json:"completedAt,omitempty"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"-"`
}

type AIOrganizationSourceItem struct {
	BookmarkID string
	UpdatedAt  time.Time
	Title      string
	Site       string
	FolderID   *string
	FolderPath *string
	TagIDs     []string
	TagNames   []string
}

type AIOrganizationAssignment struct {
	BookmarkID string
	FolderID   *string
	TagIDs     []string
	Confidence float64
}

type AIOrganizationJobItem struct {
	JobID                     string
	BookmarkID                string `json:"bookmarkId"`
	BookmarkUpdatedAtSnapshot time.Time
	Title                     string `json:"title"`
	Site                      string `json:"site"`
	Status                    string `json:"status"`
	SourceFolderID            *string
	SourceFolderPath          *string `json:"sourceFolderPath,omitempty"`
	TargetFolderID            *string
	TargetFolderPath          *string `json:"targetFolderPath,omitempty"`
	SourceTagIDs              []string
	TargetTagIDs              []string
	SourceTags                []string `json:"sourceTags"`
	TargetTags                []string `json:"targetTags"`
	Confidence                *float64 `json:"confidence,omitempty"`
	ErrorCode                 *string  `json:"errorCode,omitempty"`
}

type AIOrganizationJobItemList struct {
	Items []AIOrganizationJobItem `json:"items"`
	Total int                     `json:"total"`
}

type AIOrganizationJobProgress struct {
	Status             string
	ProcessedItems     int
	UpdatedItems       int
	UnchangedItems     int
	LowConfidenceItems int
	SkippedItems       int
	FolderUpdatedItems int
	TagsUpdatedItems   int
	RequestCount       int
	ErrorCode          *string
	ErrorMessage       *string
	CompletedAt        *time.Time
}
