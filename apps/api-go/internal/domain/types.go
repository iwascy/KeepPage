package domain

import (
	"encoding/json"
	"time"
)

type AuthUser struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Name      *string   `json:"name,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type AuthRegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name,omitempty"`
}

type AuthLoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type AuthSession struct {
	Token string   `json:"token"`
	User  AuthUser `json:"user"`
}

type APIToken struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	TokenPreview string     `json:"tokenPreview"`
	Scopes       []string   `json:"scopes"`
	LastUsedAt   *time.Time `json:"lastUsedAt,omitempty"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
	RevokedAt    *time.Time `json:"revokedAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
}

type APITokenCreateRequest struct {
	Name      string     `json:"name"`
	Scopes    []string   `json:"scopes"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

type APITokenListResponse struct {
	Items []APIToken `json:"items"`
}

type APITokenCreateResponse struct {
	Token string   `json:"token"`
	Item  APIToken `json:"item"`
}

type Tag struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Color *string `json:"color,omitempty"`
}

type Folder struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Path     string  `json:"path"`
	ParentID *string `json:"parentId"`
}

type FolderListResponse struct {
	Items []Folder `json:"items"`
}

type FolderCreateRequest struct {
	Name     string  `json:"name"`
	ParentID *string `json:"parentId"`
}

type OptionalString struct {
	Present bool
	Value   *string
}

func (o *OptionalString) UnmarshalJSON(data []byte) error {
	o.Present = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	o.Value = &value
	return nil
}

type FolderUpdateRequest struct {
	Name     OptionalString `json:"name"`
	ParentID OptionalString `json:"parentId"`
}

type TagListResponse struct {
	Items []Tag `json:"items"`
}

type TagCreateRequest struct {
	Name  string  `json:"name"`
	Color *string `json:"color"`
}

type TagUpdateRequest struct {
	Name  OptionalString `json:"name"`
	Color OptionalString `json:"color"`
}

type FolderCount struct {
	FolderID string `json:"folderId"`
	Count    int    `json:"count"`
}

type BookmarkSidebarStatsResponse struct {
	FolderCounts []FolderCount `json:"folderCounts"`
}

type WorkspaceBootstrapResponse struct {
	Folders      []Folder      `json:"folders"`
	Tags         []Tag         `json:"tags"`
	FolderCounts []FolderCount `json:"folderCounts"`
}

type QualityReason struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Impact  int    `json:"impact"`
}

type PageSignals struct {
	TextLength          int  `json:"textLength"`
	ImageCount          int  `json:"imageCount"`
	IframeCount         int  `json:"iframeCount"`
	ScrollHeight        int  `json:"scrollHeight"`
	RenderHeight        *int `json:"renderHeight,omitempty"`
	FileSize            *int `json:"fileSize,omitempty"`
	HasCanvas           bool `json:"hasCanvas"`
	HasVideo            bool `json:"hasVideo"`
	Previewable         bool `json:"previewable"`
	ScreenshotGenerated bool `json:"screenshotGenerated"`
}

type QualityReport struct {
	Score          int             `json:"score"`
	Grade          string          `json:"grade"`
	Reasons        []QualityReason `json:"reasons"`
	LiveSignals    PageSignals     `json:"liveSignals"`
	ArchiveSignals PageSignals     `json:"archiveSignals"`
}

type Bookmark struct {
	ID              string         `json:"id"`
	SourceURL       string         `json:"sourceUrl"`
	CanonicalURL    *string        `json:"canonicalUrl,omitempty"`
	Title           string         `json:"title"`
	Domain          string         `json:"domain"`
	FaviconURL      *string        `json:"faviconUrl,omitempty"`
	CoverImageURL   *string        `json:"coverImageUrl,omitempty"`
	Note            string         `json:"note"`
	IsFavorite      bool           `json:"isFavorite"`
	Tags            []Tag          `json:"tags"`
	Folder          *Folder        `json:"folder,omitempty"`
	LatestVersionID *string        `json:"latestVersionId,omitempty"`
	VersionCount    int            `json:"versionCount"`
	LatestQuality   *QualityReport `json:"latestQuality,omitempty"`
	CreatedAt       time.Time      `json:"createdAt"`
	UpdatedAt       time.Time      `json:"updatedAt"`
}

type BookmarkSearchQuery struct {
	Q        string
	Quality  string
	View     string
	Domain   string
	FolderID string
	TagID    string
	Limit    int
	Offset   int
}

type BookmarkSearchResponse struct {
	Items []Bookmark `json:"items"`
	Total int        `json:"total"`
}

type IngestBookmarkRequest struct {
	URL            string   `json:"url"`
	Title          string   `json:"title,omitempty"`
	Note           *string  `json:"note,omitempty"`
	Tags           []string `json:"tags,omitempty"`
	FolderPath     string   `json:"folderPath,omitempty"`
	DedupeStrategy string   `json:"dedupeStrategy,omitempty"`
}

type IngestBookmarkResult struct {
	Bookmark     Bookmark
	Status       string
	Deduplicated bool
}

type IngestBookmarkResponse struct {
	BookmarkID   string   `json:"bookmarkId"`
	Status       string   `json:"status"`
	Deduplicated bool     `json:"deduplicated"`
	Bookmark     Bookmark `json:"bookmark"`
}
