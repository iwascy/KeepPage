package domain

import "time"

// CaptureInitRequest reserves the object key before an archive is uploaded.
type CaptureInitRequest struct {
	URL        string `json:"url"`
	Title      string `json:"title"`
	FileSize   int64  `json:"fileSize"`
	HTMLSHA256 string `json:"htmlSha256"`
	Profile    string `json:"profile"`
	DeviceID   string `json:"deviceId"`
}

type CaptureInitResponse struct {
	AlreadyExists bool    `json:"alreadyExists"`
	BookmarkID    *string `json:"bookmarkId,omitempty"`
	VersionID     *string `json:"versionId,omitempty"`
	ObjectKey     string  `json:"objectKey"`
	UploadURL     string  `json:"uploadUrl"`
}

type CaptureSource struct {
	URL           string  `json:"url"`
	Title         string  `json:"title"`
	CanonicalURL  *string `json:"canonicalUrl,omitempty"`
	Domain        string  `json:"domain"`
	FaviconURL    *string `json:"faviconUrl,omitempty"`
	CoverImageURL *string `json:"coverImageUrl,omitempty"`
}

type CaptureMediaFile struct {
	ID          string  `json:"id"`
	Kind        string  `json:"kind"`
	ObjectKey   string  `json:"objectKey"`
	PublicURL   *string `json:"publicUrl,omitempty"`
	OriginalURL string  `json:"originalUrl"`
	MIMEType    *string `json:"mimeType,omitempty"`
	FileSize    *int64  `json:"fileSize,omitempty"`
	Width       *int    `json:"width,omitempty"`
	Height      *int    `json:"height,omitempty"`
}

type CaptureCompleteRequest struct {
	ObjectKey           string             `json:"objectKey"`
	HTMLSHA256          string             `json:"htmlSha256"`
	ReaderHTML          *string            `json:"readerHtml,omitempty"`
	ReaderHTMLObjectKey *string            `json:"-"`
	TextSHA256          *string            `json:"textSha256,omitempty"`
	TextSimhash         *string            `json:"textSimhash,omitempty"`
	ExtractedText       *string            `json:"extractedText,omitempty"`
	MediaFiles          []CaptureMediaFile `json:"mediaFiles,omitempty"`
	ScreenshotObjectKey *string            `json:"screenshotObjectKey,omitempty"`
	ThumbnailObjectKey  *string            `json:"thumbnailObjectKey,omitempty"`
	Quality             QualityReport      `json:"quality"`
	Source              CaptureSource      `json:"source"`
	DeviceID            string             `json:"deviceId"`
}

type CaptureCompleteResponse struct {
	BookmarkID        string `json:"bookmarkId"`
	VersionID         string `json:"versionId"`
	CreatedNewVersion bool   `json:"createdNewVersion"`
	Deduplicated      bool   `json:"deduplicated"`
}

type CaptureCompleteResult struct {
	Bookmark          Bookmark
	VersionID         string
	CreatedNewVersion bool
	Deduplicated      bool
}

type CaptureUpload struct {
	ObjectKey         string
	UserID            string
	NormalizedURLHash string
	SourceURL         string
	Title             string
	HTMLSHA256        string
	FileSize          int64
	Profile           string
	DeviceID          string
	CreatedAt         time.Time
}
