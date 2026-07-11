package domain

import "time"

// BookmarkVersion is the persisted archive projection returned by the detail API.
type BookmarkVersion struct {
	ID                     string             `json:"id"`
	BookmarkID             string             `json:"bookmarkId"`
	VersionNo              int                `json:"versionNo"`
	HTMLObjectKey          string             `json:"htmlObjectKey"`
	ReaderHTMLObjectKey    *string            `json:"readerHtmlObjectKey,omitempty"`
	HTMLSHA256             string             `json:"htmlSha256"`
	TextSHA256             *string            `json:"textSha256,omitempty"`
	TextSimhash            *string            `json:"textSimhash,omitempty"`
	MediaFiles             []CaptureMediaFile `json:"mediaFiles,omitempty"`
	CaptureProfile         string             `json:"captureProfile"`
	Quality                QualityReport      `json:"quality"`
	CreatedAt              time.Time          `json:"createdAt"`
	ArchiveAvailable       bool               `json:"archiveAvailable"`
	ArchiveSizeBytes       *int64             `json:"archiveSizeBytes,omitempty"`
	ReaderArchiveAvailable bool               `json:"readerArchiveAvailable"`
	ReaderArchiveSizeBytes *int64             `json:"readerArchiveSizeBytes,omitempty"`
}

type BookmarkDetailResponse struct {
	Bookmark Bookmark          `json:"bookmark"`
	Versions []BookmarkVersion `json:"versions"`
}

type BookmarkStatusResponse struct {
	Exists   bool      `json:"exists"`
	Bookmark *Bookmark `json:"bookmark,omitempty"`
}

type BookmarkMetadataUpdateRequest struct {
	Note       OptionalString `json:"note"`
	FolderID   OptionalString `json:"folderId"`
	FolderPath OptionalString `json:"folderPath"`
	TagIDs     *[]string      `json:"tagIds"`
	Tags       *[]string      `json:"tags"`
	IsFavorite *bool          `json:"isFavorite"`
}

type BookmarkIconCandidate struct {
	URL    string `json:"url"`
	Source string `json:"source"`
	Sizes  string `json:"sizes,omitempty"`
	Type   string `json:"type,omitempty"`
	Width  *int   `json:"width,omitempty"`
	Height *int   `json:"height,omitempty"`
}

type BookmarkIconRefreshRequest struct {
	BookmarkID string                  `json:"bookmarkId,omitempty"`
	Domain     string                  `json:"domain,omitempty"`
	SourceURL  string                  `json:"sourceUrl,omitempty"`
	Candidates []BookmarkIconCandidate `json:"candidates,omitempty"`
}

type BookmarkIcon struct {
	ID          string    `json:"id"`
	Hostname    string    `json:"hostname"`
	IconURL     string    `json:"iconUrl"`
	SourceURL   *string   `json:"sourceUrl,omitempty"`
	SourceType  string    `json:"sourceType"`
	Width       *int      `json:"width,omitempty"`
	Height      *int      `json:"height,omitempty"`
	Format      *string   `json:"format,omitempty"`
	RefreshedAt time.Time `json:"refreshedAt"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type BookmarkIconRefreshResponse struct {
	Refreshed int            `json:"refreshed"`
	Skipped   int            `json:"skipped"`
	Icons     []BookmarkIcon `json:"icons"`
}
